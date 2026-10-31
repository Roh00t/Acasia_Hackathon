"""L1: deterministic rule-based policy for each agent.

Stands in for an LLM agent when it times out, returns invalid JSON after one
retry, or names an illegal candidate. `--offline` runs every agent on this.
"""

from __future__ import annotations

from ..schemas import AgentMessage, AgentName, Assessment, ReasonCode

TOP_K = 10
# Accept a proposal if it costs this domain no more than best + max(ABS, REL * best).
TOLERANCE = {"ATC": (4.0, 0.25), "PILOT": (6.0, 0.25), "GROUND": (6.0, 0.25)}
RED_LINES = {
    "ATC": ["Wake separation behind the leader", "Arrival cap per hour", "No landing while the runway is closed"],
    "PILOT": ["Land with 45 min reserve plus fuel to the alternate", "No approach through severe turbulence"],
    "GROUND": ["No gate overlap inside a 10 min buffer", "HEAVY aircraft only on widebody gates"],
}


def _dominant_reason(agent: AgentName, a: Assessment) -> ReasonCode:
    m = a.metrics
    if a.candidate.kind == "DIVERT":
        return ReasonCode.DIVERT_COST if agent == "PILOT" else ReasonCode.THROUGHPUT_LOSS
    if agent == "ATC":
        return ReasonCode.SEQUENCE_CONGESTION if m["knock_on_min"] > 1 else ReasonCode.THROUGHPUT_LOSS
    if agent == "PILOT":
        parts = {ReasonCode.HOLD_TOO_LONG: m["fuel_hold_kg"] / 40, ReasonCode.TURBULENCE_EXPOSURE: 15 * m["turbulence"],
                 ReasonCode.MISSED_CONNECTIONS: 0.4 * m["missed_pax"],
                 ReasonCode.FUEL_MARGIN_THIN: max(0.0, 15 - m["fuel_margin_min"])}
        return max(parts, key=parts.get)
    parts = {ReasonCode.CREW_OVERTIME: m["overtime_min"], ReasonCode.GATE_CHANGE: 6 * m["gate_change"],
             ReasonCode.TURNAROUND_DELAY: 0.3 * m["departure_delay_min"]}
    return max(parts, key=parts.get)


def plain_option(a: Assessment) -> str:
    c = a.candidate
    return f"divert to {c.alternate}" if c.kind == "DIVERT" else f"land T+{c.t:.0f} at gate {c.gate}"


def _facts(agent: AgentName, a: Assessment) -> str:
    """One plain sentence of what this organisation cares about, from validator-computed numbers."""
    m = a.metrics
    if a.candidate.kind == "DIVERT":
        return {"ATC": "takes the flight out of our sequence",
                "PILOT": f"strands all {m['missed_pax']:.0f} connecting passengers",
                "GROUND": "leaves the aircraft out of position for its next departure"}[agent]
    if agent == "ATC":
        return f"{m['knock_on_min']:.1f} min knock-on to other arrivals, {m['wake_margin_min']:.1f} min wake margin"
    if agent == "PILOT":
        return (f"{m['hold_min']:.0f} min holding ({m['fuel_hold_kg']:.0f} kg fuel), lands {m['fuel_margin_min']:.0f} min "
                f"above minimum fuel, {m['missed_pax']:.0f} missed connections")
    gate = "planned gate" if m["gate_change"] == 0 else "gate change"
    return f"{gate}, {m['overtime_min']:.0f} min crew overtime, next departure {m['departure_delay_min']:.0f} min late"


_REJECT_WHY = {
    ReasonCode.HOLD_TOO_LONG: "too much holding",
    ReasonCode.TURBULENCE_EXPOSURE: "flies through turbulence",
    ReasonCode.MISSED_CONNECTIONS: "too many missed connections",
    ReasonCode.FUEL_MARGIN_THIN: "fuel margin too thin",
    ReasonCode.DIVERT_COST: "a divert strands passengers",
    ReasonCode.THROUGHPUT_LOSS: "costs arrival throughput",
    ReasonCode.SEQUENCE_CONGESTION: "pushes back the aircraft behind",
    ReasonCode.CREW_OVERTIME: "too much crew overtime",
    ReasonCode.GATE_CHANGE: "forces a gate change",
    ReasonCode.TURNAROUND_DELAY: "delays the next departure",
}


class RuleAgent:
    level = "L1"

    def __init__(self, name: AgentName):
        self.name = name

    def _sorted(self, feasible: list[Assessment]) -> list[Assessment]:
        return sorted(feasible, key=lambda a: (a.costs[self.name], a.candidate.id))

    def rank(self, round: int, state: dict, feasible: list[Assessment]) -> AgentMessage:
        ranked = self._sorted(feasible)
        best = ranked[0]
        return AgentMessage(
            agent=self.name, round=round, decision="RANK", ranking=[a.candidate.id for a in ranked[:TOP_K]],
            reason_code=ReasonCode.PREFERRED, red_lines=RED_LINES[self.name], level="L1",
            reason=f"Prefers {plain_option(best)}: {_facts(self.name, best)}.",
        )

    def respond(self, round: int, state: dict, feasible: list[Assessment], proposal: Assessment) -> AgentMessage:
        ranked = self._sorted(feasible)
        best = ranked[0].costs[self.name]
        mine = proposal.costs[self.name]
        abs_tol, rel_tol = TOLERANCE[self.name]
        if mine <= best + max(abs_tol, rel_tol * best):
            return AgentMessage(agent=self.name, round=round, decision="ACCEPT", candidate_id=proposal.candidate.id,
                                reason_code=ReasonCode.OK, level="L1",
                                reason=f"Accept: {_facts(self.name, proposal)}, close to our best option.")
        counter = next((a for a in ranked if a.candidate.id != proposal.candidate.id), None)
        code = _dominant_reason(self.name, proposal)
        return AgentMessage(
            agent=self.name, round=round, decision="REJECT", candidate_id=proposal.candidate.id,
            reason_code=code, counter=counter.candidate.id if counter else None, level="L1",
            reason=f"Reject: {_REJECT_WHY.get(code, 'worse for us')} ({_facts(self.name, proposal)})."
                   + (f" We counter with {plain_option(counter)}." if counter else ""),
        )
