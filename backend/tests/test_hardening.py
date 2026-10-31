"""Failure paths from the pre-flight red team: LLM fallback, keyed log, final gate, approvals."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import atm.coordinator as coord
from atm.agents.llm import LLMAgent, LLMReply, unverified_numbers
from atm.coordinator import run
from atm.data import load_scenarios
from atm.log import ConsensusLog, chain_alg, verify
from atm.schemas import AGENTS, ReasonCode


@pytest.fixture(scope="module")
def row_id():
    df = load_scenarios()
    return int(df[df.WEATHER_DELAY > 15].ROW_ID.iloc[0])


class FakeMessages:
    """Stands in for client.messages; `reply` is a callable returning an LLMReply or raising."""

    def __init__(self, reply):
        self.reply = reply
        self.calls = 0

    def parse(self, **kwargs):
        self.calls += 1
        out = self.reply(kwargs)
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0)
        return SimpleNamespace(stop_reason="end_turn", parsed_output=out, usage=usage)


def fake_agents(reply):
    msgs = FakeMessages(reply)
    client = SimpleNamespace(messages=msgs)
    return {n: LLMAgent(n, client=client) for n in AGENTS}, msgs


# ---------------------------------------------------------------- LLM fallback (L0 -> L1)

def test_malformed_llm_output_falls_back_to_rules(row_id):
    def broken(_):
        raise ValueError("invalid JSON from model")

    agents, msgs = fake_agents(broken)
    r = run(row_id, agents=agents, write=False)
    first = r["rounds"][0]["messages"]
    assert all(m["level"] == "L1" for m in first)
    assert all("invalid JSON" in m["meta"]["fallback_reason"] for m in first)
    assert all(m["meta"]["attempts"] == 2 for m in first)  # one retry, then the rule agent
    assert r["stand_ins"] == sum(len(rd["messages"]) for rd in r["rounds"])
    assert r["outcome"]["level"] in {"L1", "L2"}


def test_llm_naming_unknown_candidate_is_rejected(row_id):
    def invents(_):
        return LLMReply(decision="RANK", ranking=["S99-Z9"], reason_code=ReasonCode.PREFERRED,
                        reason="made up", counter=None, red_lines=[])

    agents, _ = fake_agents(invents)
    r = run(row_id, agents=agents, write=False)
    assert all("unknown candidate ids" in m["meta"]["fallback_reason"] for m in r["rounds"][0]["messages"])
    assert r["outcome"]["candidate"] is None or all(c["ok"] for c in r["outcome"]["checks"].values())


def test_unverified_numbers_flags_invented_figures():
    shown = {"candidates": [{"id": "S18-A3", "fuel_margin_min": 16.8, "missed_pax": 52}], "reserve_min": 45}
    assert unverified_numbers("S18-A3: 16.8 min margin, 52 pax, 45 min reserve, round 2", shown) == []
    assert unverified_numbers("S18-A3 leaves 21.4 min and saves 700 kg", shown) == ["21.4", "700"]


# ---------------------------------------------------------------- keyed log

def test_hmac_chain_needs_the_key(monkeypatch):
    monkeypatch.setenv("ATM_LOG_KEY", "test-key")
    assert chain_alg() == "hmac-sha256"
    log = ConsensusLog("t")
    for i in range(4):
        log.append("MESSAGE", {"i": i})
    assert verify(log.entries) == (True, None)
    monkeypatch.setenv("ATM_LOG_KEY", "wrong-key")
    assert verify(log.entries) == (False, 0)
    monkeypatch.delenv("ATM_LOG_KEY")
    assert chain_alg() == "sha256"
    assert verify(log.entries)[0] is False


# ---------------------------------------------------------------- final safety gate

def test_final_gate_escalates_when_recheck_fails(row_id, monkeypatch):
    real = coord.assess

    def failing(s, c):
        a = real(s, c)
        a.checks["PILOT"] = a.checks["PILOT"].model_copy(update={"ok": False, "code": "FUEL_RESERVE"})
        return a

    monkeypatch.setattr(coord, "assess", failing)
    r = run(row_id, write=False)
    assert r["outcome"]["level"] == "L3" and r["outcome"]["candidate"] is None
    assert any(e["kind"] == "VETO" and e["payload"]["agent"] == "COORDINATOR" for e in r["log"])


# ---------------------------------------------------------------- approvals

@pytest.fixture()
def client(tmp_path, monkeypatch):
    import atm.api as api
    monkeypatch.setattr(api, "RUNS_DIR", tmp_path)
    api.RUNS.clear()
    return TestClient(api.app)


def test_approve_appends_once_and_override_needs_note(client, row_id):
    r = client.post("/run", json={"row_id": row_id}).json()
    rid = r["run_id"]
    assert client.post(f"/runs/{rid}/approve", json={"decision": "OVERRIDE", "note": " "}).status_code == 422
    ok = client.post(f"/runs/{rid}/approve", json={"decision": "APPROVE"})
    assert ok.status_code == 200 and ok.json()["chain_valid"]
    assert client.post(f"/runs/{rid}/approve", json={"decision": "APPROVE"}).status_code == 409
    assert client.post(f"/runs/{rid}/approve", json={"decision": "MAYBE"}).status_code == 422


def test_cannot_approve_an_escalation(client, row_id):
    import atm.api as api
    r = client.post("/run", json={"row_id": row_id}).json()
    api.RUNS[r["run_id"]]["outcome"]["candidate"] = None  # simulate L3
    assert client.post(f"/runs/{r['run_id']}/approve", json={"decision": "APPROVE"}).status_code == 409


def test_vercel_requires_database_url_for_durable_storage(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    response = client.get("/health")
    assert response.status_code == 503
    assert "DATABASE_URL is required" in response.json()["detail"]


def test_timeout_opens_circuit_so_run_finishes_fast(row_id):
    """One timeout and the rest of the run goes straight to the rule agents: no 9 x 25 s hang."""
    def hangs(_):
        raise TimeoutError("read timed out")

    msgs = FakeMessages(hangs)
    client = SimpleNamespace(messages=msgs)
    circuit: dict = {}
    agents = {n: LLMAgent(n, client=client, circuit=circuit) for n in AGENTS}
    r = run(row_id, agents=agents, write=False)
    assert msgs.calls == 1  # no retry after a timeout, and later agents skip the call
    first = r["rounds"][0]["messages"]
    assert all(m["level"] == "L1" for m in first)
    assert "TimeoutError" in first[0]["meta"]["fallback_reason"]
    assert first[1]["meta"]["fallback_reason"].startswith("Skipped")
    assert r["outcome"]["candidate"] is None or all(c["ok"] for c in r["outcome"]["checks"].values())
