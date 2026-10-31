"""Run one negotiation from the terminal.

  uv run python -m atm.cli --row 1635                 # offline (rule agents, no API)
  uv run python -m atm.cli --random --emergency       # drone closure overlay
  uv run python -m atm.cli --row 1635 --live          # three Claude agents
  uv run python -m atm.cli --row 1635 --inject-unsafe # adversarial veto demo
  uv run python -m atm.cli --row 1635 --out ../web/public/runs/showcase-routine.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from .coordinator import run
from .data import random_row_id

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def print_run(r: dict) -> None:
    s, o = r["scenario"], r["outcome"]
    row = s["row"]
    print(f"\n== {r['run_id']}  [{s['subsystem']}]  mode={r['mode']}")
    print(f"   DOT row {s['row_id']}: {row['AIRLINE']}{row['FLIGHT_NUMBER']} {row['ORIGIN_AIRPORT']}->{row['DESTINATION_AIRPORT']} "
          f"arr delay {row['ARRIVAL_DELAY']} (weather {row['WEATHER_DELAY']}, late aircraft {row['LATE_AIRCRAFT_DELAY']})")
    print(f"   {s['narrative']}")
    c = r["candidates"]
    print(f"   candidates: {c['total']} total, {c['feasible']} pass all validators; vetoed: {c['fail_counts']}")
    for rd in r["rounds"]:
        prop = rd["proposal"]["id"] if rd["proposal"] else "-"
        print(f"   R{rd['round']} proposal={prop}")
        for m in rd["messages"]:
            extra = f" ranking={m['ranking'][:3]}" if m["decision"] == "RANK" else \
                (f" counter={m['counter']}" if m.get("counter") else "")
            print(f"      {m['agent']:6} {m['level']} {m['decision']:6} {m['reason_code']:20}{extra}  | {m['reason']}")
    for v in r["vetoes"]:
        print(f"   VETO R{v['round']} {v['agent']} named {v['candidate']}: {v['failed']}")
    cand = o.get("candidate")
    print(f"   OUTCOME {o['level']} {o['action']}")
    if cand:
        print(f"      -> {cand['id']}  {cand['metrics']}")
    if o.get("baseline_fcfs"):
        b = o["baseline_fcfs"]
        print(f"      FCFS baseline {b['id']}  {b['metrics']}")
    print(f"   log: {len(r['log'])} entries, hash chain valid={r['chain_valid']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Negotiate one disrupted arrival")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--row", type=int, help="ROW_ID from data/scenarios.csv")
    g.add_argument("--random", action="store_true")
    ap.add_argument("--emergency", action="store_true", help="Overlay the synthetic drone runway closure")
    ap.add_argument("--live", action="store_true", help="Use three Claude agents (needs ANTHROPIC_API_KEY)")
    ap.add_argument("--inject-unsafe", action="store_true", help="Pilot agent pushes an illegal hold")
    ap.add_argument("--out", type=Path, help="Also write the full run JSON here")
    ap.add_argument("--json", action="store_true", help="Print the full run JSON")
    args = ap.parse_args()

    row_id = args.row if args.row else random_row_id()
    r = run(row_id, emergency=args.emergency, live=args.live, inject_unsafe=args.inject_unsafe)
    if args.json:
        print(json.dumps(r, indent=2, default=str))
    else:
        print_run(r)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(r, default=str))
        print(f"   wrote {args.out}")


if __name__ == "__main__":
    main()
