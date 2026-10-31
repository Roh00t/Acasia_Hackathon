"""First-come-first-served baseline: what happens today without negotiation.

ATC gives the earliest legal slot; ground takes the planned gate if it is free
then, otherwise the first free gate. Nobody weighs fuel, connections or crew.
"""

from __future__ import annotations

from .schemas import Assessment, Scenario


def fcfs(s: Scenario, assessments: list[Assessment]) -> Assessment | None:
    lands = sorted((a for a in assessments if a.feasible and a.candidate.kind == "LAND"),
                   key=lambda a: (a.candidate.t, a.candidate.gate != s.ground.planned_gate, a.candidate.gate))
    if lands:
        return lands[0]
    return next((a for a in assessments if a.feasible and a.candidate.kind == "DIVERT"), None)


def uncoordinated(s: Scenario, assessments: list[Assessment]) -> Assessment | None:
    """Siloed status quo: ATC issues the earliest slot that passes ATC's own checks
    on the planned gate; nobody checks fuel, turbulence or the gate before acting."""
    lands = sorted((a for a in assessments if a.candidate.kind == "LAND" and a.checks["ATC"].ok
                    and a.candidate.gate == s.ground.planned_gate), key=lambda a: a.candidate.t)
    return lands[0] if lands else None
