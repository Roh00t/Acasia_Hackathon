"""Domain slicing: each agent sees only its own organisation's state and metrics.

The Pilot never sees gates or crew; Ground never sees fuel; ATC sees the runway
and sequence. This is what makes the roles independent rather than one prompt.
"""

from __future__ import annotations

from ..schemas import AgentName, Assessment, Scenario

DOMAIN_METRICS: dict[str, tuple[str, ...]] = {
    "ATC": ("window_load", "knock_on_min", "wake_margin_min"),
    "PILOT": ("hold_min", "fuel_margin_min", "fuel_hold_kg", "turbulence", "missed_pax"),
    "GROUND": ("overtime_min", "gate_change", "departure_delay_min"),
}


def domain_state(agent: AgentName, s: Scenario) -> dict:
    row = s.row
    event = {
        "subsystem": s.subsystem.value,
        "narrative": s.narrative,
        "flight": s.flight.callsign,
        "route": f"{row['ORIGIN_AIRPORT']}-{row['DESTINATION_AIRPORT']}",
        "dot_row": {k: row.get(k) for k in ("ROW_ID", "ARRIVAL_DELAY", "WEATHER_DELAY", "LATE_AIRCRAFT_DELAY")},
    }
    if agent == "ATC":
        rw = s.runway
        return {**event, "runway": rw.name, "arrival_cap_per_hr": rw.arrival_cap_per_hr,
                "normal_cap_per_hr": rw.normal_cap_per_hr,
                "closure": rw.closure.model_dump() if rw.closure else None,
                "taxiway_block": rw.taxiway_block.model_dump() if rw.taxiway_block else None,
                "queue_size": len(rw.queue)}
    if agent == "PILOT":
        f = s.flight
        return {**event, "wake": f.wake.value, "fuel_endurance_min": f.fuel_endurance_min,
                "reserve_min": f.reserve_min, "alternate": f.alternate, "alternate_min": f.alternate_min,
                "connections": [c.model_dump() for c in f.connections]}
    g = s.ground
    return {**event, "planned_gate": g.planned_gate, "turnaround_min": g.turnaround_min,
            "crew_shift_end": g.crew_shift_end, "next_departure": g.next_departure}


def domain_candidates(agent: AgentName, feasible: list[Assessment], limit: int | None = None) -> list[dict]:
    """Feasible candidates with only this domain's metrics and cost, best first."""
    rows = sorted(feasible, key=lambda a: (a.costs[agent], a.candidate.id))
    if limit:
        rows = rows[:limit]
    out = []
    for a in rows:
        c = a.candidate
        item = {"id": c.id, "kind": c.kind, "t": c.t}
        if agent == "GROUND":
            item["gate"] = c.gate
        item.update({k: a.metrics[k] for k in DOMAIN_METRICS[agent]})
        item["cost"] = a.costs[agent]
        out.append(item)
    return out
