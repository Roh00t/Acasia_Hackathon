"""Enumerate every resolution the agents may choose between.

Agents choose and argue; they never invent options. A candidate is either
LAND at a 2-minute arrival slot on a gate, or DIVERT to the nearest alternate.
"""

from __future__ import annotations

from .scenario import HORIZON
from .schemas import Candidate, Scenario

SLOT_STEP = 2


def enumerate_candidates(s: Scenario) -> list[Candidate]:
    out = []
    t = s.flight.earliest_landing
    while t < HORIZON:
        for g in s.ground.gates:
            out.append(Candidate(id=f"S{int(t):02d}-{g.id}", kind="LAND", t=t, gate=g.id))
        t += SLOT_STEP
    out.append(Candidate(id=f"DIVERT-{s.flight.alternate}", kind="DIVERT", alternate=s.flight.alternate))
    return out
