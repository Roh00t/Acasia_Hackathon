"""Non-determinism: 5 scenarios x 5 repeats, live LLM agents. Same seeded state each repeat.

  cd backend && ATM_MODEL=claude-haiku-5-5 uv run python ../results/nondeterminism.py

Writes results/nondeterminism.json. Cost is an estimate from logged token usage.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")  # does not override ATM_MODEL set on the command line
sys.path.insert(0, str(ROOT / "backend"))

from atm.batch import PRICES, _usage  # noqa: E402
from atm.coordinator import run  # noqa: E402
from atm.data import load_scenarios  # noqa: E402

MODEL = os.environ.get("ATM_MODEL", "claude-haiku-5-5")
REPEATS = 5


def scenarios() -> list[tuple[int, bool]]:
    df = load_scenarios()
    rt = df[df.WEATHER_DELAY <= 15].sample(2, random_state=23).ROW_ID.tolist()
    wx = df[df.WEATHER_DELAY > 15].sample(2, random_state=23).ROW_ID.tolist()
    em = df.sample(1, random_state=24).ROW_ID.tolist()
    return [(int(r), False) for r in rt + wx] + [(int(em[0]), True)]


def one(rid: int, em: bool) -> dict:
    t0 = time.monotonic()
    r = run(rid, emergency=em, live=True, write=False)
    secs = time.monotonic() - t0
    tin, tout, tcache = _usage(r)
    o = r["outcome"]
    models = {e["payload"].get("meta", {}).get("model") for e in r["log"] if e["kind"] == "MESSAGE"}
    return {"row_id": rid, "emergency": em, "subsystem": r["scenario"]["subsystem"], "level": o["level"],
            "rounds_used": o["rounds_used"], "chosen": o["candidate"]["id"] if o.get("candidate") else None,
            "stand_ins": r["stand_ins"], "vetoes": len(r["vetoes"]),
            "messages": sum(len(rd["messages"]) for rd in r["rounds"]),
            "latency_s": round(secs, 2), "tokens": {"input": tin, "output": tout, "cache_read": tcache},
            "models": sorted(m for m in models if m)}


def main() -> None:
    jobs = [(rid, em) for rid, em in scenarios() for _ in range(REPEATS)]
    with ThreadPoolExecutor(max_workers=5) as pool:
        runs = list(pool.map(lambda j: one(*j), jobs))
    per = []
    for rid, em in scenarios():
        rs = [r for r in runs if r["row_id"] == rid and r["emergency"] == em]
        plans = Counter(r["chosen"] for r in rs)
        modal, k = plans.most_common(1)[0]
        per.append({"row_id": rid, "subsystem": rs[0]["subsystem"], "plans": dict(plans), "modal_plan": modal,
                    "agreement": f"{k}/{len(rs)}", "all_same": k == len(rs),
                    "levels": dict(Counter(r["level"] for r in rs)),
                    "rounds": dict(Counter(r["rounds_used"] for r in rs)),
                    "stand_ins": sum(r["stand_ins"] for r in rs),
                    "mean_latency_s": round(sum(r["latency_s"] for r in rs) / len(rs), 2)})
    tok = {k: sum(r["tokens"][k] for r in runs) for k in ("input", "output", "cache_read")}
    pin, pout, pcache = PRICES.get(MODEL, (0.10, 0.50, 0.01))
    cost = (tok["input"] * pin + tok["output"] * pout + tok["cache_read"] * pcache) / 1e6
    res = {"model": MODEL, "scenarios": len(per), "repeats": REPEATS, "runs": len(runs),
           "llm_calls_logged": sum(r["messages"] for r in runs),
           "plan_agreement_scenarios": sum(p["all_same"] for p in per),
           "modal_plan_share": round(sum(int(p["agreement"].split("/")[0]) for p in per) / len(runs), 3),
           "levels": dict(Counter(r["level"] for r in runs)),
           "stand_ins": sum(r["stand_ins"] for r in runs), "vetoes": sum(r["vetoes"] for r in runs),
           "tokens": tok, "price_usd_per_mtok": {"input": pin, "output": pout, "cache_read": pcache},
           "est_cost_usd_total": round(cost, 4), "est_cost_usd_per_negotiation": round(cost / len(runs), 5),
           "mean_latency_s": round(sum(r["latency_s"] for r in runs) / len(runs), 2),
           "per_scenario": per, "runs_detail": runs}
    out = Path(__file__).with_name("nondeterminism.json")
    out.write_text(json.dumps(res, indent=2))
    print(json.dumps({k: v for k, v in res.items() if k != "runs_detail"}, indent=2))


if __name__ == "__main__":
    main()
