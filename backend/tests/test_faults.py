"""Fault injection on 3 scenarios (one ROUTINE, one WEATHER, one EMERGENCY): ladder holds, nothing unsafe."""

from __future__ import annotations

import pytest

import atm.coordinator as coord
from atm.faults import FAULTS, evaluate


@pytest.fixture(scope="module")
def res():
    return evaluate(3)


def test_no_unsafe_plan_accepted(res):
    assert res["runs"] == 3 * len(FAULTS)
    assert res["unsafe_plans_accepted"] == 0
    assert res["chain_valid_all"]


def test_llm_failures_hand_every_message_to_the_rule_agent(res):
    for r in res["rows"]:
        if r["fault"] in ("timeout", "malformed"):
            assert r["stand_ins"] == r["messages"] > 0
            assert r["level"] == r["no_fault_offline_level"]  # stand-in behaves exactly like the L1 rules


def test_stubborn_agent_forces_l2_and_no_feasible_escalates_l3(res):
    for r in res["rows"]:
        if r["fault"] == "stubborn":
            assert r["level"] == "L2" and r["chosen"]
        if r["fault"] == "no_feasible":
            assert r["level"] == "L3" and r["chosen"] is None


def test_red_team_hold_is_vetoed_and_never_chosen(res):
    for r in res["rows"]:
        if r["fault"] == "red_team":
            assert r["unsafe_candidate"] and r["vetoes"] > 0
            assert r["chosen"] != r["unsafe_candidate"]
            assert not r["independent_check_failed"]


def test_assess_all_is_restored_after_no_feasible(res):
    assert coord.assess_all.__name__ == "assess_all"
