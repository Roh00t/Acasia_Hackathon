"""Honest evaluation: run many rows per subsystem and compare against baselines.

  uv run python -m atm.batch --n 50                  # offline, 50 rows x 3 subsystems
  uv run python -m atm.batch --n 20 --live           # costs API credits
  uv run python -m atm.batch --n 50 --out ../web/public/evidence/batch.json

Methods compared on identical seeded scenarios:
- negotiated: the 3-agent protocol (L0/L1 consensus, else L2/L3)
- fcfs:       earliest legal slot, planned gate if free (today's default)
- fallback:   L2 only, lowest weighted cost with no negotiation
- uncoordinated: today's silo; ATC's earliest slot on the planned gate, no fuel/gate cross-check
All impact numbers are MODELLED on synthetic airport state, not measured.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

from .coordinator import run
from .data import load_scenarios

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

METRICS = ("hold_min", "fuel_hold_kg", "missed_pax", "overtime_min", "gate_change", "knock_on_min")


def pick_rows(n: int, seed: int = 7) -> dict[str, list[int]]:
    df = load_scenarios()
    weather = df[df["WEATHER_DELAY"] > 15].sample(n, random_state=seed)["ROW_ID"].tolist()
    routine = df[df["WEATHER_DELAY"] <= 15].sample(n, random_state=seed)["ROW_ID"].tolist()
    emergency = df.sample(n, random_state=seed + 1)["ROW_ID"].tolist()
    return {"ROUTINE": routine, "WEATHER": weather, "EMERGENCY": emergency}


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.mean(xs), 2) if xs else None


def evaluate(n: int, live: bool) -> dict:
    out = {"n_per_subsystem": n, "mode": "live" if live else "offline", "subsystems": {}, "label": "MODELLED"}
    for sub, rows in pick_rows(n).items():
        levels, rounds, vetoes, unsafe, diverts, latency = Counter(), [], 0, 0, Counter(), []
        neg = {m: [] for m in METRICS}
        base = {m: [] for m in METRICS}
        fb = {m: [] for m in METRICS}
        stand_ins = 0
        silo_broken, silo_codes = 0, Counter()
        for rid in rows:
            t0 = time.monotonic()
            r = run(int(rid), emergency=sub == "EMERGENCY", live=live, write=False)
            latency.append(time.monotonic() - t0)
            o = r["outcome"]
            levels[o["level"]] += 1
            rounds.append(o["rounds_used"])
            vetoes += len(r["vetoes"])
            stand_ins += r["stand_ins"]
            # Unsafe = the chosen plan fails any validator. Must be 0 by construction.
            if o.get("checks") and not all(c["ok"] for c in o["checks"].values()):
                unsafe += 1
            silo = o.get("baseline_uncoordinated")
            if silo and silo["violations"]:
                silo_broken += 1
                silo_codes.update(v["code"] for v in silo["violations"].values())
            cand, b = o.get("candidate"), o.get("baseline_fcfs")
            fallback = min(r["candidates"]["feasible_list"], key=lambda a: a["total_cost"], default=None)
            for tag, src, acc in (("neg", cand, neg), ("fcfs", b, base), ("fb", fallback, fb)):
                if src:
                    diverts[tag] += src["kind"] == "DIVERT"
                    for m in METRICS:
                        acc[m].append(src["metrics"].get(m))
        k = len(rows)
        out["subsystems"][sub] = {
            "rows": k,
            "consensus_pct": round(100 * (levels["L0"] + levels["L1"]) / k, 1),
            "levels": dict(levels),
            "mean_rounds": _mean(rounds),
            "validator_vetoes": vetoes,
            "llm_stand_ins": stand_ins,
            "unsafe_plans_accepted": unsafe,
            "uncoordinated_plans_broken_pct": round(100 * silo_broken / k, 1),
            "uncoordinated_violations": dict(silo_codes),
            "divert_pct": {t: round(100 * diverts[t] / k, 1) for t in ("neg", "fcfs", "fb")},
            "negotiated": {m: _mean(v) for m, v in neg.items()},
            "fcfs": {m: _mean(v) for m, v in base.items()},
            "fallback_only": {m: _mean(v) for m, v in fb.items()},
            "mean_latency_s": _mean(latency),
        }
    return out


def print_table(res: dict) -> None:
    print(f"\nBatch ({res['mode']}, {res['n_per_subsystem']} rows per subsystem). Impact is MODELLED.\n")
    for sub, s in res["subsystems"].items():
        print(f"[{sub}] consensus {s['consensus_pct']}%  levels {s['levels']}  mean rounds {s['mean_rounds']}  "
              f"vetoes {s['validator_vetoes']}  unsafe accepted {s['unsafe_plans_accepted']}  divert% {s['divert_pct']}")
        print(f"   siloed status quo (ATC slot, planned gate, no cross-checks): {s['uncoordinated_plans_broken_pct']}% "
              f"of plans break another domain's constraint {s['uncoordinated_violations']}")
        print(f"   {'metric':16}{'negotiated':>12}{'fcfs':>10}{'fallback':>10}")
        for m in METRICS:
            print(f"   {m:16}{str(s['negotiated'][m]):>12}{str(s['fcfs'][m]):>10}{str(s['fallback_only'][m]):>10}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    res = evaluate(args.n, args.live)
    print_table(res)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(res, indent=2))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
