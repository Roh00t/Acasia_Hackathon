"""Data for the three-chapter scroll story: one real showcase run per subsystem.

  uv run python -m atm.story derive    # one pass over data/flights.csv -> data/story_derived.csv
  ATM_MODEL=claude-haiku-5-5 uv run python -m atm.story export

`derive` adds two facts the scenario builder doesn't use, both from the real DOT file:
- weather_share: of arrivals at the same airport, same day, within an hour of this
  flight's scheduled arrival, the share that had a weather delay (DERIVED).
- next leg: the same tail number's next scheduled departure from this airport (REAL).

`export` picks one row per subsystem, runs it once with live agents and once offline,
and writes web/public/story/s{1,2,3}.json. The story reads only these files.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from .data import DATA, FLIGHTS, ROOT, load_scenarios

load_dotenv(ROOT / ".env")

DERIVED = DATA / "story_derived.csv"
OUT = ROOT / "web" / "public" / "story"
PRICES = {"claude-opus-5-5": (4.0, 20.0, 0.20), "claude-haiku-5-5": (0.10, 0.50, 0.01)}
COLS = ["MONTH", "DAY", "AIRLINE", "FLIGHT_NUMBER", "TAIL_NUMBER", "ORIGIN_AIRPORT", "DESTINATION_AIRPORT",
        "SCHEDULED_DEPARTURE", "SCHEDULED_ARRIVAL", "WEATHER_DELAY", "CANCELLED"]


def _hhmm_to_min(s: pd.Series) -> pd.Series:
    v = pd.to_numeric(s, errors="coerce").fillna(0).astype(int)
    return (v // 100) * 60 + v % 100


def derive() -> pd.DataFrame:
    sc = load_scenarios().copy()
    sc["arr_min"] = _hhmm_to_min(sc["SCHEDULED_ARRIVAL"])
    tails = set(sc["TAIL_NUMBER"].dropna())
    dests = set(sc["DESTINATION_AIRPORT"])
    windows, legs = [], []
    for chunk in pd.read_csv(FLIGHTS, usecols=COLS, chunksize=500_000,
                             dtype={"TAIL_NUMBER": str, "ORIGIN_AIRPORT": str, "DESTINATION_AIRPORT": str,
                                    "SCHEDULED_DEPARTURE": str, "SCHEDULED_ARRIVAL": str}):
        chunk = chunk[(chunk["MONTH"] != 10) & (chunk["CANCELLED"] == 0)]
        arr = chunk[chunk["DESTINATION_AIRPORT"].isin(dests)].copy()
        arr["arr_min"] = _hhmm_to_min(arr["SCHEDULED_ARRIVAL"])
        arr["wx"] = (arr["WEATHER_DELAY"].fillna(0) > 0).astype(int)
        windows.append(arr[["MONTH", "DAY", "DESTINATION_AIRPORT", "arr_min", "wx"]])
        dep = chunk[chunk["TAIL_NUMBER"].isin(tails)].copy()
        dep["dep_min"] = _hhmm_to_min(dep["SCHEDULED_DEPARTURE"])
        legs.append(dep[["MONTH", "DAY", "TAIL_NUMBER", "ORIGIN_AIRPORT", "DESTINATION_AIRPORT",
                         "AIRLINE", "FLIGHT_NUMBER", "dep_min"]])
    win = pd.concat(windows)
    leg = pd.concat(legs)

    rows = []
    win_g = {k: g for k, g in win.groupby(["MONTH", "DAY", "DESTINATION_AIRPORT"])}
    leg_g = {k: g for k, g in leg.groupby(["MONTH", "DAY", "TAIL_NUMBER"])}
    for r in sc.itertuples():
        w = win_g.get((r.MONTH, r.DAY, r.DESTINATION_AIRPORT))
        n = wx = 0
        if w is not None:
            near = w[(w["arr_min"] - r.arr_min).abs() <= 60]
            n, wx = len(near), int(near["wx"].sum())
        nxt = None
        lg = leg_g.get((r.MONTH, r.DAY, r.TAIL_NUMBER))
        if lg is not None:
            after = lg[(lg["ORIGIN_AIRPORT"] == r.DESTINATION_AIRPORT) & (lg["dep_min"] > r.arr_min)]
            if len(after):
                nxt = after.sort_values("dep_min").iloc[0]
        rows.append({
            "ROW_ID": r.ROW_ID, "window_arrivals": n, "window_weather_delayed": wx,
            "weather_share": round(wx / n, 3) if n else None,
            "next_leg_flight": f"{nxt.AIRLINE}{int(nxt.FLIGHT_NUMBER)}" if nxt is not None else None,
            "next_leg_dest": nxt.DESTINATION_AIRPORT if nxt is not None else None,
            "next_leg_dep": f"{int(nxt.dep_min) // 60:02d}:{int(nxt.dep_min) % 60:02d}" if nxt is not None else None,
        })
    out = pd.DataFrame(rows)
    out.to_csv(DERIVED, index=False)
    print(f"wrote {len(out)} rows to {DERIVED.relative_to(ROOT)}; "
          f"{out['next_leg_flight'].notna().sum()} with a real next leg, "
          f"weather share max {out['weather_share'].max()}")
    return out


def _cost(run: dict, model: str | None) -> dict:
    tin = tout = tcache = 0
    for e in run["log"]:
        u = e["payload"].get("meta", {}).get("usage", {}) if e["kind"] == "MESSAGE" else {}
        tin, tout, tcache = tin + u.get("input", 0), tout + u.get("output", 0), tcache + u.get("cache_read", 0)
    p = PRICES.get(model or "", (0, 0, 0))
    return {"input": tin, "output": tout, "cache_read": tcache,
            "usd": round((tin * p[0] + tout * p[1] + tcache * p[2]) / 1e6, 5)}


def pick(d: pd.DataFrame) -> dict[str, tuple[int, bool]]:
    """One row per chapter, chosen by a rule, not by hand."""
    from .coordinator import run

    sc = load_scenarios().merge(d, on="ROW_ID")
    hubs = sc["DESTINATION_AIRPORT"].value_counts().head(15).index
    routine = sc[(sc["WEATHER_DELAY"] <= 15) & sc["next_leg_flight"].notna() & sc["DESTINATION_AIRPORT"].isin(hubs)]
    s1 = None
    for rid in routine.sort_values("LATE_AIRCRAFT_DELAY", ascending=False)["ROW_ID"].head(80):
        r = run(int(rid), write=False)
        c = r["outcome"]["candidate"]
        if r["outcome"]["consensus"] and c and c["kind"] == "LAND" and c["gate"] != r["scenario"]["ground"]["planned_gate"]:
            s1 = int(rid)
            break
    weather = sc[(sc["WEATHER_DELAY"] > 15) & (sc["window_arrivals"] >= 15)]
    s2 = None
    for rid in weather.sort_values(["weather_share", "WEATHER_DELAY"], ascending=False)["ROW_ID"].head(40):
        r = run(int(rid), write=False)
        c = r["outcome"]["candidate"]
        if c and c["kind"] == "LAND":
            s2 = int(rid)
            break
    s3 = None
    for rid in sc[sc["DESTINATION_AIRPORT"].isin(hubs)].sort_values("ROW_ID")["ROW_ID"]:
        r = run(int(rid), emergency=True, write=False)
        c = r["outcome"]["candidate"]
        closure = r["scenario"]["runway"]["closure"]
        if r["outcome"]["consensus"] and c and c["kind"] == "LAND" and closure and c["t"] >= closure["end"]:
            s3 = int(rid)
            break
    return {"s1": (s1, False), "s2": (s2, False), "s3": (s3, True)}


def export() -> None:
    from .coordinator import run

    d = pd.read_csv(DERIVED)
    picks = pick(d)
    model = os.environ.get("ATM_MODEL")
    OUT.mkdir(parents=True, exist_ok=True)
    titles = {"s1": "Routine", "s2": "Weather", "s3": "Emergency"}
    for i, (key, (rid, emergency)) in enumerate(picks.items(), start=1):
        if rid is None:
            raise SystemExit(f"no row matched the rule for {key}")
        t0 = time.monotonic()
        live = run(rid, emergency=emergency, live=True, write=False)
        live_s = round(time.monotonic() - t0, 1)
        offline = run(rid, emergency=emergency, live=False, write=False)
        row = live["scenario"]["row"]
        der = d[d["ROW_ID"] == rid].iloc[0].to_dict()
        der = {k: (None if pd.isna(v) else v) for k, v in der.items()}
        story = {
            "chapter": i, "key": key, "title": titles[key], "subsystem": live["scenario"]["subsystem"],
            "row_id": rid, "model": model,
            "real": {k: row.get(k) for k in ("AIRLINE", "FLIGHT_NUMBER", "TAIL_NUMBER", "ORIGIN_AIRPORT",
                                            "DESTINATION_AIRPORT", "MONTH", "DAY", "SCHEDULED_ARRIVAL",
                                            "ARRIVAL_DELAY", "WEATHER_DELAY", "LATE_AIRCRAFT_DELAY", "DISTANCE")},
            "derived": {
                "weather_share": der["weather_share"], "window_arrivals": int(der["window_arrivals"]),
                "window_weather_delayed": int(der["window_weather_delayed"]),
                "next_leg": ({"flight": der["next_leg_flight"], "dest": der["next_leg_dest"], "dep": der["next_leg_dep"]}
                             if der["next_leg_flight"] else None),
            },
            "synthetic": live["scenario"]["synthetic"],
            "cost": _cost(live, model), "latency_s": live_s,
            "live": live, "offline": offline,
        }
        path = OUT / f"{key}.json"
        path.write_text(json.dumps(story, default=str))
        o = live["outcome"]
        print(f"{key}: row {rid} {story['subsystem']} -> {o['level']} {o['candidate']['id'] if o['candidate'] else '-'} "
              f"in {o['rounds_used']} rounds, ${story['cost']['usd']}, {live_s}s, stand-ins {live['stand_ins']} "
              f"| offline {offline['outcome']['level']} {offline['outcome']['candidate']['id'] if offline['outcome']['candidate'] else '-'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["derive", "export"])
    args = ap.parse_args()
    derive() if args.step == "derive" else export()


if __name__ == "__main__":
    main()
