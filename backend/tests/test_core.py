"""Validators, hash chain and coordinator guarantees."""

from __future__ import annotations

import pytest

from atm.candidates import enumerate_candidates
from atm.coordinator import MAX_ROUNDS, run
from atm.data import load_scenarios
from atm.log import ConsensusLog, verify
from atm.scenario import build_scenario
from atm.schemas import Arrival, Candidate, Closure, Wake
from atm.validators import assess, assess_all, check_atc, check_ground, check_pilot, wake_sep_min


@pytest.fixture(scope="module")
def rows():
    df = load_scenarios()
    return {
        "routine": int(df[df.WEATHER_DELAY <= 15].ROW_ID.iloc[0]),
        "weather": int(df[df.WEATHER_DELAY > 15].ROW_ID.iloc[0]),
    }


# ---------------------------------------------------------------- scenario

def test_scenario_is_deterministic(rows):
    a = build_scenario(rows["weather"])
    b = build_scenario(rows["weather"])
    assert a.model_dump() == b.model_dump()


def test_subsystem_classification(rows):
    assert build_scenario(rows["routine"]).subsystem.value == "ROUTINE"
    assert build_scenario(rows["weather"]).subsystem.value == "WEATHER"
    em = build_scenario(rows["routine"], emergency=True)
    assert em.subsystem.value == "EMERGENCY" and em.runway.closure is not None
    assert "runway_closure" in em.synthetic


# ---------------------------------------------------------------- validators

def test_wake_separation_table():
    assert wake_sep_min(Wake.HEAVY, Wake.SMALL) > wake_sep_min(Wake.HEAVY, Wake.LARGE) > wake_sep_min(Wake.LARGE, Wake.LARGE)
    assert wake_sep_min(Wake.LARGE, Wake.LARGE) == pytest.approx(3 / 140 * 60)


def test_wake_veto_behind_heavy(rows):
    s = build_scenario(rows["routine"])
    s.runway.queue = [Arrival(callsign="HVY1", wake=Wake.HEAVY, t=10.0)]
    s.flight.wake = Wake.LARGE
    check, _ = check_atc(s, Candidate(id="x", kind="LAND", t=11.0, gate="A1"))
    assert not check.ok and check.code == "WAKE_SEPARATION"
    check, _ = check_atc(s, Candidate(id="x", kind="LAND", t=13.0, gate="A1"))
    assert check.ok


def test_runway_closure_veto(rows):
    s = build_scenario(rows["routine"])
    s.runway.closure = Closure(start=0, end=30, cause="drone")
    s.runway.queue = []
    assert check_atc(s, Candidate(id="x", kind="LAND", t=20, gate="A1"))[0].code == "RUNWAY_CLOSED"
    assert check_atc(s, Candidate(id="x", kind="LAND", t=32, gate="A1"))[0].ok


def test_fuel_reserve_veto(rows):
    s = build_scenario(rows["routine"])
    s.flight.fuel_endurance_min = 45 + s.flight.alternate_min + 10  # 10 min of holding fuel
    s.flight.turbulence = []
    assert check_pilot(s, Candidate(id="x", kind="LAND", t=8, gate="A1"))[0].ok
    check, _ = check_pilot(s, Candidate(id="x", kind="LAND", t=12, gate="A1"))
    assert not check.ok and check.code == "FUEL_RESERVE"


def test_gate_conflict_with_buffer(rows):
    s = build_scenario(rows["routine"])
    g = s.ground.gates[0]
    g.busy = [(30.0, 60.0)]
    s.flight.wake = Wake.LARGE
    taxi = s.ground.taxi_in_min
    # On-block 5 min after the gate frees up is inside the 10 min buffer.
    assert check_ground(s, Candidate(id="x", kind="LAND", t=65 - taxi, gate=g.id))[0].code == "GATE_CONFLICT"
    assert check_ground(s, Candidate(id="x", kind="LAND", t=71 - taxi, gate=g.id))[0].ok


def test_every_feasible_candidate_passes_all_domains(rows):
    s = build_scenario(rows["weather"])
    for a in assess_all(s, enumerate_candidates(s)):
        assert a.feasible == all(c.ok for c in a.checks.values())


# ---------------------------------------------------------------- log

def test_hash_chain_detects_tampering():
    log = ConsensusLog("t")
    for i in range(5):
        log.append("MESSAGE", {"i": i})
    assert verify(log.entries) == (True, None)
    log.entries[2]["payload"]["i"] = 99
    assert verify(log.entries) == (False, 2)


def test_hash_chain_detects_deletion():
    log = ConsensusLog("t")
    for i in range(4):
        log.append("MESSAGE", {"i": i})
    del log.entries[1]
    ok, bad = verify(log.entries)
    assert not ok and bad == 1


# ---------------------------------------------------------------- coordinator

@pytest.mark.parametrize("kind,emergency", [("routine", False), ("weather", False), ("routine", True)])
def test_run_is_bounded_and_safe(rows, kind, emergency):
    r = run(rows[kind], emergency=emergency, write=False)
    o = r["outcome"]
    assert o["rounds_used"] <= MAX_ROUNDS
    assert len(r["rounds"]) <= MAX_ROUNDS
    assert r["chain_valid"]
    assert o["level"] in {"L0", "L1", "L2", "L3"}
    if o["candidate"]:
        assert all(c["ok"] for c in o["checks"].values())


def test_injected_unsafe_hold_is_vetoed(rows):
    r = run(rows["weather"], inject_unsafe=True, write=False)
    unsafe = r["unsafe_candidate"]
    assert unsafe
    assert any(v["candidate"] == unsafe for v in r["vetoes"])
    assert r["outcome"]["candidate"]["id"] != unsafe
    assert all(c["ok"] for c in r["outcome"]["checks"].values())


def test_no_feasible_option_escalates_l3(rows, monkeypatch):
    import atm.coordinator as coord
    real = coord.assess_all

    def all_fail(s, cands):
        out = real(s, cands)
        for a in out:
            a.checks["PILOT"] = a.checks["PILOT"].model_copy(update={"ok": False, "code": "FUEL_RESERVE"})
        return out

    monkeypatch.setattr(coord, "assess_all", all_fail)
    r = run(rows["routine"], write=False)
    assert r["outcome"]["level"] == "L3" and r["outcome"]["candidate"] is None
