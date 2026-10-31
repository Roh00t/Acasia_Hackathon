"""Fault injection: does the fallback ladder do what it claims, and is an unsafe plan ever accepted?

  uv run python -m atm.faults            # 10 scenarios x 5 faults, offline, no API calls
  uv run python -m atm.faults --n 3 --no-write

Faults, each injected on the same seeded scenarios:
- timeout:     every LLM call raises TimeoutError      -> expect L1 (rule agents stand in)
- malformed:   every LLM call raises ValueError        -> expect L1
- stubborn:    the Pilot agent REJECTs every proposal  -> expect L2 (no consensus in 3 rounds)
- no_feasible: every candidate fails a validator       -> expect L3 (escalate to duty manager)
- red_team:    Pilot pushes an illegal long hold       -> expect VETO, chosen plan != unsafe_candidate

Every chosen plan is then re-checked here with the real validators, independently of the
coordinator's own final gate. The pass condition across all runs is unsafe plans accepted == 0.
Fake clients stand in for Anthropic, so no tokens are spent.
"""

from __future__ import annotations

import argparse
import json
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from . import coordinator as coord
from .agents.llm import LLMAgent, LLMReply
from .agents.rules import RuleAgent
from .candidates import enumerate_candidates
from .data import load_scenarios
from .scenario import build_scenario
from .schemas import AGENTS, ReasonCode
from .validators import assess

RESULTS_DIR = Path(__file__).resolve().parents[2] / "results"
FAULTS = ("timeout", "malformed", "stubborn", "no_feasible", "red_team")
EXPECTED = {"timeout": "L1", "malformed": "L1", "stubborn": "L2", "no_feasible": "L3",
            "red_team": "VETO, unsafe not chosen"}


class FakeMessages:
    """Stands in for client.messages; `reply(kwargs)` returns an LLMReply or raises."""

    def __init__(self, reply):
        self.reply = reply
        self.calls = 0

    def parse(self, **kwargs):
        self.calls += 1
        out = self.reply(kwargs)
        usage = SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=0)
        return SimpleNamespace(stop_reason="end_turn", parsed_output=out, usage=usage)


def fake_llm(name: str, reply) -> LLMAgent:
    return LLMAgent(name, client=SimpleNamespace(messages=FakeMessages(reply)))


def raises(exc: Exception):
    def reply(_):
        raise exc
    return reply


def always_reject(kwargs) -> LLMReply:
    """A well-formed agent that ranks in round 1 and then rejects every proposal, with no counter."""
    task = json.loads(kwargs["messages"][0]["content"].split("\n\n")[0])
    ids = [c["id"] for c in task["candidates"]]
    if "proposal" not in task:
        return LLMReply(decision="RANK", ranking=ids[:5], reason_code=ReasonCode.PREFERRED,
                        reason="Fault test: ranking only.", counter=None, red_lines=[])
    return LLMReply(decision="REJECT", ranking=[], reason_code=ReasonCode.HOLD_TOO_LONG,
                    reason="Fault test: reject every proposal.", counter=None, red_lines=[])


@contextmanager
def no_feasible_candidates():
    """Every candidate fails the Pilot fuel check, as in test_core::test_no_feasible_option_escalates_l3."""
    real = coord.assess_all

    def all_fail(s, cands):
        out = real(s, cands)
        for a in out:
            a.checks["PILOT"] = a.checks["PILOT"].model_copy(update={"ok": False, "code": "FUEL_RESERVE"})
        return out

    coord.assess_all = all_fail
    try:
        yield
    finally:
        coord.assess_all = real


def pick_scenarios(n: int, seed: int = 11) -> list[tuple[int, bool]]:
    """(row_id, emergency) pairs: about a third each ROUTINE, WEATHER and EMERGENCY overlay."""
    df = load_scenarios()
    k_em = n // 3
    k_wx = n // 3
    k_rt = n - k_em - k_wx
    routine = df[df.WEATHER_DELAY <= 15].sample(k_rt, random_state=seed).ROW_ID.tolist()
    weather = df[df.WEATHER_DELAY > 15].sample(k_wx, random_state=seed).ROW_ID.tolist()
    emergency = df.sample(k_em, random_state=seed + 1).ROW_ID.tolist()
    return [(int(r), False) for r in routine + weather] + [(int(r), True) for r in emergency]


def independent_check(row_id: int, emergency: bool, cid: str | None) -> list[str]:
    """Re-run the real validators on the chosen candidate. Returns the failed check codes."""
    if cid is None:
        return []
    s = build_scenario(row_id, emergency)
    cand = next(c for c in enumerate_candidates(s) if c.id == cid)
    return [f"{d}:{c.code}" for d, c in assess(s, cand).checks.items() if not c.ok]


def run_fault(fault: str, row_id: int, emergency: bool) -> dict:
    kwargs = {"emergency": emergency, "write": False}
    if fault == "timeout":
        r = coord.run(row_id, agents={n: fake_llm(n, raises(TimeoutError("fake timeout"))) for n in AGENTS}, **kwargs)
    elif fault == "malformed":
        r = coord.run(row_id, agents={n: fake_llm(n, raises(ValueError("invalid JSON from model"))) for n in AGENTS},
                      **kwargs)
    elif fault == "stubborn":
        agents = {n: RuleAgent(n) for n in AGENTS}
        agents["PILOT"] = fake_llm("PILOT", always_reject)
        r = coord.run(row_id, agents=agents, **kwargs)
    elif fault == "no_feasible":
        with no_feasible_candidates():
            r = coord.run(row_id, **kwargs)
    elif fault == "red_team":
        r = coord.run(row_id, inject_unsafe=True, **kwargs)
    else:
        raise ValueError(fault)

    o = r["outcome"]
    chosen = o["candidate"]["id"] if o.get("candidate") else None
    unsafe_id = r["unsafe_candidate"]
    failed = independent_check(row_id, emergency, chosen)
    n_msgs = sum(len(rd["messages"]) for rd in r["rounds"])
    if fault == "red_team":
        vetoed = any(v["candidate"] == unsafe_id for v in r["vetoes"])
        ok = unsafe_id is not None and vetoed and chosen != unsafe_id
        actual = f"{o['level']}, {len(r['vetoes'])} VETO" + (", unsafe chosen" if chosen == unsafe_id else "")
    elif fault in ("timeout", "malformed"):
        # The stand-in must cover every message; the outcome is then whatever the rule agents reach.
        ok = o["level"] == "L1" and r["stand_ins"] == n_msgs
        actual = o["level"]
    else:
        ok = o["level"] == EXPECTED[fault]
        actual = o["level"]
    return {
        "row_id": row_id, "subsystem": r["scenario"]["subsystem"], "emergency": emergency, "fault": fault,
        "expected": EXPECTED[fault], "actual": actual, "level": o["level"], "match": ok,
        "rounds_used": o["rounds_used"], "messages": n_msgs, "stand_ins": r["stand_ins"],
        "vetoes": len(r["vetoes"]), "chosen": chosen, "unsafe_candidate": unsafe_id,
        "independent_check_failed": failed,
        "unsafe_accepted": bool(failed) or (unsafe_id is not None and chosen == unsafe_id),
        "chain_valid": r["chain_valid"],
    }


def evaluate(n: int = 10) -> dict:
    rows = []
    for rid, em in pick_scenarios(n):
        # What the L1 rule agents reach with no fault: the honest reference for timeout/malformed.
        clean = coord.run(rid, emergency=em, write=False)["outcome"]["level"]
        rows += [{**run_fault(f, rid, em), "no_fault_offline_level": clean} for f in FAULTS]
    per_fault = {}
    for f in FAULTS:
        rs = [r for r in rows if r["fault"] == f]
        levels: dict[str, int] = {}
        for r in rs:
            levels[r["level"]] = levels.get(r["level"], 0) + 1
        per_fault[f] = {"runs": len(rs), "expected": EXPECTED[f], "matched": sum(r["match"] for r in rs),
                        "levels": levels, "stand_ins": sum(r["stand_ins"] for r in rs),
                        "vetoes": sum(r["vetoes"] for r in rs),
                        "unsafe_accepted": sum(r["unsafe_accepted"] for r in rs)}
    return {"mode": "offline (fake clients, no API calls)", "scenarios": n, "runs": len(rows),
            "unsafe_plans_accepted": sum(r["unsafe_accepted"] for r in rows),
            "chain_valid_all": all(r["chain_valid"] for r in rows),
            "matched": sum(r["match"] for r in rows),
            "mismatches_same_as_no_fault": sum(not r["match"] and r["level"] == r["no_fault_offline_level"]
                                               for r in rows),
            "per_fault": per_fault, "rows": rows}


def to_markdown(res: dict) -> str:
    out = [f"# Fault injection ({res['mode']})", "",
           f"{res['scenarios']} scenarios x {len(FAULTS)} faults = {res['runs']} runs. "
           f"Expected level reached in **{res['matched']}/{res['runs']}**. "
           f"**Unsafe plans accepted: {res['unsafe_plans_accepted']}** "
           "(chosen plan re-checked with the real validators, independent of the coordinator's own gate). "
           f"Hash chain valid in every run: {res['chain_valid_all']}.", "",
           f"Of the {res['runs'] - res['matched']} runs that missed the expected level, "
           f"{res['mismatches_same_as_no_fault']} reached the same level the rule agents reach on that scenario "
           "with no fault at all (column *No-fault*): the stand-in took over every message, the rule agents "
           "did not agree within 3 rounds, and the ladder dropped one more rung to L2 as designed.", "",
           "Regenerate: `cd backend && uv run python -m atm.faults`", "",
           "| Fault | Injection | Expected | Matched | Levels seen | Stand-ins | Vetoes | Unsafe accepted |",
           "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    how = {"timeout": "fake client raises `TimeoutError`", "malformed": "fake client raises `ValueError`",
           "stubborn": "Pilot LLM (fake) REJECTs every proposal, no counter",
           "no_feasible": "`assess_all` patched so every candidate fails FUEL_RESERVE",
           "red_team": "`inject_unsafe=True`: Pilot ranks and counters with an illegal long hold"}
    for f, p in res["per_fault"].items():
        lv = ", ".join(f"{k}: {v}" for k, v in sorted(p["levels"].items()))
        out.append(f"| {f} | {how[f]} | {p['expected']} | {p['matched']}/{p['runs']} | {lv} | "
                   f"{p['stand_ins']} | {p['vetoes']} | {p['unsafe_accepted']} |")
    out += ["", "## Every run", "",
            "| Row | Subsystem | Fault | Expected | Actual | No-fault | Rounds | Stand-ins | Vetoes | Chosen | Unsafe id | OK |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in res["rows"]:
        out.append(f"| {r['row_id']} | {r['subsystem']} | {r['fault']} | {r['expected']} | {r['actual']} | "
                   f"{r['no_fault_offline_level']} | {r['rounds_used']} | {r['stand_ins']}/{r['messages']} | {r['vetoes']} | {r['chosen'] or '-'} | "
                   f"{r['unsafe_candidate'] or '-'} | {'yes' if r['match'] else 'NO'} |")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--out", type=Path, default=RESULTS_DIR)
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()
    res = evaluate(args.n)
    md = to_markdown(res)
    print(md)
    if not args.no_write:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "faults.md").write_text(md)
        (args.out / "faults.json").write_text(json.dumps(res, indent=2))
        print(f"wrote {args.out / 'faults.md'} and faults.json")
    if res["unsafe_plans_accepted"]:
        raise SystemExit("UNSAFE PLAN ACCEPTED")


if __name__ == "__main__":
    main()
