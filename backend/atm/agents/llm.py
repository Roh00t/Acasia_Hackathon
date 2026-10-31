"""L0: one independent Claude call per agent per round.

Each call carries only that agent's system prompt, domain state and domain
metrics. The reply must parse into LLMReply and name only listed candidates;
otherwise one retry with the error, then the L1 rule policy stands in.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Literal

from pydantic import BaseModel

from ..schemas import AgentMessage, AgentName, Assessment, ReasonCode
from .prompts import prompt_hash, system_prompt
from .rules import RuleAgent
from .views import domain_candidates

MODEL = os.environ.get("ATM_MODEL", "claude-haiku-5-5")
CANDIDATES_SHOWN = 25
# A number not preceded by a letter, digit or dot, so ids like S18-A3 don't count.
NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def unverified_numbers(reason: str, shown: dict) -> list[str]:
    """Numbers quoted in an agent's reason that appear nowhere in the data it was shown.

    The plan is always re-checked by the validators; this only flags prose a duty
    manager should not take on trust (OWASP LLM09). Small counts (0-3) are ignored.
    """
    known = [float(x) for x in NUMBER.findall(json.dumps(shown, default=str))]
    flagged = []
    for text in NUMBER.findall(reason):
        x = float(text)
        if abs(x) <= 3:
            continue
        tol = 0.051 if "." in text else 0.5
        if not any(abs(v - x) <= tol for v in known):
            flagged.append(text)
    return flagged



class LLMReply(BaseModel):
    decision: Literal["RANK", "ACCEPT", "REJECT"]
    ranking: list[str]
    reason_code: ReasonCode
    reason: str
    counter: str | None
    red_lines: list[str]


class LLMAgent:
    level = "L0"

    def __init__(self, name: AgentName, client=None):
        import anthropic

        self.name = name
        self.client = client or anthropic.Anthropic()
        self.fallback = RuleAgent(name)
        self.last_meta: dict = {}
        self.extra_instruction: str | None = None  # used by the adversarial test only

    def _call(self, task: dict) -> LLMReply:
        user = json.dumps(task, default=str)
        if self.extra_instruction:
            user += "\n\n" + self.extra_instruction
        resp = self.client.messages.parse(
            model=MODEL,
            max_tokens=2000,
            system=[{"type": "text", "text": system_prompt(self.name), "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_format=LLMReply,
            output_config={"effort": "low"},
        )
        if resp.stop_reason == "refusal" or resp.parsed_output is None:
            raise ValueError(f"no parsed output (stop_reason={resp.stop_reason})")
        self.last_meta["usage"] = {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens,
                                   "cache_read": getattr(resp.usage, "cache_read_input_tokens", 0) or 0}
        return resp.parsed_output

    def _run(self, round: int, task: dict, valid_ids: set[str], proposal_id: str | None, fallback) -> AgentMessage:
        self.last_meta = {"model": MODEL, "prompt_hash": prompt_hash(self.name), "attempts": 0}
        error = None
        t0 = time.monotonic()
        for _ in range(2):
            self.last_meta["attempts"] += 1
            try:
                if error:
                    task = {**task, "previous_error": error}
                r = self._call(task)
                bad = [i for i in r.ranking + ([r.counter] if r.counter else []) if i not in valid_ids]
                if bad:
                    raise ValueError(f"unknown candidate ids {bad}; use only ids from the list")
                if proposal_id is None and r.decision != "RANK":
                    raise ValueError("round 1 requires decision RANK")
                if proposal_id is not None and r.decision == "RANK":
                    raise ValueError("rounds 2-3 require ACCEPT or REJECT")
                self.last_meta["latency_s"] = round_(time.monotonic() - t0)
                self.last_meta["unverified_numbers"] = unverified_numbers(r.reason, task)
                return AgentMessage(agent=self.name, round=round, decision=r.decision, candidate_id=proposal_id,
                                    ranking=r.ranking[:10], reason_code=r.reason_code, reason=r.reason[:400],
                                    counter=r.counter if r.decision == "REJECT" else None,
                                    red_lines=r.red_lines[:5], level="L0")
            except Exception as e:  # invalid JSON, schema, API error, timeout
                error = f"{type(e).__name__}: {e}"[:300]
        self.last_meta.update(latency_s=round_(time.monotonic() - t0), fallback_reason=error)
        return fallback()

    def rank(self, round: int, state: dict, feasible: list[Assessment]) -> AgentMessage:
        cands = domain_candidates(self.name, feasible, CANDIDATES_SHOWN)
        task = {"round": round, "your_state": state, "candidates": cands,
                "instruction": "Rank up to 10 candidates, best first, and state your red lines."}
        return self._run(round, task, {c["id"] for c in cands}, None,
                         lambda: self.fallback.rank(round, state, feasible))

    def respond(self, round: int, state: dict, feasible: list[Assessment], proposal: Assessment) -> AgentMessage:
        cands = domain_candidates(self.name, feasible, CANDIDATES_SHOWN)
        prop = domain_candidates(self.name, [proposal])[0]
        if prop["id"] not in {c["id"] for c in cands}:
            cands.append(prop)
        task = {"round": round, "your_state": state, "proposal": prop, "candidates": cands,
                "instruction": "ACCEPT the proposal, or REJECT it with a reason_code and at most one counter id."}
        return self._run(round, task, {c["id"] for c in cands}, proposal.candidate.id,
                         lambda: self.fallback.respond(round, state, feasible, proposal))


def round_(x: float) -> float:
    return round(x, 2)
