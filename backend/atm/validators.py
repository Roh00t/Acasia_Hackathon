"""Deterministic safety validators, one per domain. Code, never an LLM.

A candidate that fails any validator never reaches an agent, and a validator
veto overrides any agent ACCEPT. Thresholds are simplified and marked:
- Wake separation: FAA-style radar minima by leader/follower category,
  3-6 NM, converted to minutes at a 140 kt approach speed. [Likely, check FAA JO 7110.65]
  Too close behind the leader is a veto; followers pushed back is ATC's throughput cost.
- Fuel: land with at least 45 min final reserve plus fuel to the alternate. [Likely, 14 CFR 121.639]
- Gates: no overlap with a 10 min buffer; HEAVY needs a widebody gate.
"""

from __future__ import annotations

from .schemas import Assessment, Candidate, Check, Scenario, Wake

APPROACH_KT = 140.0
SEVERE_TURBULENCE = 0.8

# Leader -> follower minimum separation in NM.
WAKE_NM: dict[tuple[Wake, Wake], float] = {
    (Wake.HEAVY, Wake.HEAVY): 4.0, (Wake.HEAVY, Wake.LARGE): 5.0, (Wake.HEAVY, Wake.SMALL): 6.0,
    (Wake.LARGE, Wake.HEAVY): 3.0, (Wake.LARGE, Wake.LARGE): 3.0, (Wake.LARGE, Wake.SMALL): 4.0,
    (Wake.SMALL, Wake.HEAVY): 3.0, (Wake.SMALL, Wake.LARGE): 3.0, (Wake.SMALL, Wake.SMALL): 3.0,
}


def wake_sep_min(leader: Wake, follower: Wake) -> float:
    return WAKE_NM[(leader, follower)] / APPROACH_KT * 60.0


def turbulence_at(s: Scenario, t: float) -> float:
    return max((i for a, b, i in s.flight.turbulence if a <= t < b), default=0.0)


def _ok(detail: str = "") -> Check:
    return Check(ok=True, code="OK", detail=detail)


# ---------------------------------------------------------------- ATC

def check_atc(s: Scenario, c: Candidate) -> tuple[Check, dict[str, float]]:
    rw = s.runway
    if c.kind == "DIVERT":
        return _ok("Divert leaves the arrival sequence"), {"window_load": 0.0, "wake_margin_min": 99.0, "knock_on_min": 0.0}
    t = c.t
    window = sum(1 for a in rw.queue if t - 30 <= a.t < t + 30) + 1
    load = window / rw.arrival_cap_per_hr
    prev = max((a for a in rw.queue if a.t <= t), key=lambda a: a.t, default=None)
    margin = t - prev.t - wake_sep_min(prev.wake, s.flight.wake) if prev else 99.0
    # Followers can be pushed back to restore separation: a throughput cost, not a veto.
    knock_on, cur, cur_wake = 0.0, t, s.flight.wake
    for a in sorted((a for a in rw.queue if a.t > t), key=lambda a: a.t):
        need = cur + wake_sep_min(cur_wake, a.wake)
        if a.t >= need:
            break
        knock_on += need - a.t
        cur, cur_wake = need, a.wake
    metrics = {"window_load": round(load, 2), "wake_margin_min": round(margin, 2),
               "knock_on_min": round(knock_on, 1)}

    if rw.closure and rw.closure.start <= t < rw.closure.end:
        return Check(ok=False, code="RUNWAY_CLOSED",
                     detail=f"Runway {rw.name} closed T+{rw.closure.start:.0f} to T+{rw.closure.end:.0f}"), metrics
    if margin < 0:
        return Check(ok=False, code="WAKE_SEPARATION",
                     detail=f"{abs(margin) * 60:.0f} s short of wake separation behind {prev.callsign} ({prev.wake.value})"), metrics
    if window > rw.arrival_cap_per_hr:
        return Check(ok=False, code="ARRIVAL_CAP",
                     detail=f"{window} arrivals in the hour around T+{t:.0f} exceeds the cap of {rw.arrival_cap_per_hr}/hr"), metrics
    tb = rw.taxiway_block
    if tb and c.gate in tb.gates and t + s.ground.taxi_in_min < tb.until:
        return Check(ok=False, code="TAXIWAY_BLOCKED",
                     detail=f"Taxiway {tb.taxiway} to {c.gate} blocked until T+{tb.until:.0f}"), metrics
    return _ok(f"Wake margin {margin * 60:.0f} s behind leader, followers pushed {knock_on:.1f} min, "
               f"{window}/{rw.arrival_cap_per_hr} in the hour"), metrics


# ---------------------------------------------------------------- PILOT

def check_pilot(s: Scenario, c: Candidate) -> tuple[Check, dict[str, float]]:
    f = s.flight
    if c.kind == "DIVERT":
        at_alt = f.fuel_endurance_min - f.alternate_min
        metrics = {"hold_min": 0.0, "fuel_hold_kg": round(f.alternate_min * f.burn_kg_per_min),
                   "fuel_margin_min": round(at_alt - f.reserve_min, 1), "turbulence": 0.0,
                   "missed_pax": float(sum(x.pax for x in f.connections))}
        if at_alt < f.reserve_min:
            return Check(ok=False, code="FUEL_RESERVE",
                         detail=f"Would reach {f.alternate} with {at_alt:.0f} min, below the {f.reserve_min:.0f} min reserve"), metrics
        return _ok(f"Reaches {f.alternate} with {at_alt:.0f} min fuel"), metrics

    hold = c.t - f.earliest_landing
    at_landing = f.fuel_endurance_min - c.t
    required = f.reserve_min + f.alternate_min
    turb = turbulence_at(s, c.t)
    on_block = c.t + s.ground.taxi_in_min
    missed = sum(x.pax for x in f.connections if on_block + f.min_connect_min > x.departs)
    metrics = {"hold_min": hold, "fuel_hold_kg": round(hold * f.burn_kg_per_min),
               "fuel_margin_min": round(at_landing - required, 1), "turbulence": turb, "missed_pax": float(missed)}
    if at_landing < required:
        return Check(ok=False, code="FUEL_RESERVE",
                     detail=f"Lands with {at_landing:.0f} min fuel; needs {required:.0f} (45 reserve + {f.alternate_min:.0f} to {f.alternate})"), metrics
    if turb >= SEVERE_TURBULENCE:
        return Check(ok=False, code="TURBULENCE_SEVERE",
                     detail=f"Severe turbulence (index {turb:.1f}) on final at T+{c.t:.0f}"), metrics
    return _ok(f"Lands with {at_landing - required:.0f} min above minimum fuel"), metrics


# ---------------------------------------------------------------- GROUND

def check_ground(s: Scenario, c: Candidate) -> tuple[Check, dict[str, float]]:
    g = s.ground
    if c.kind == "DIVERT":
        return _ok("No gate needed"), {"overtime_min": 0.0, "gate_change": 0.0, "departure_delay_min": 180.0}
    gate = next(x for x in g.gates if x.id == c.gate)
    on_block = c.t + g.taxi_in_min
    occ = (on_block - g.gate_buffer_min, on_block + g.turnaround_min + g.gate_buffer_min)
    metrics = {
        "overtime_min": round(max(0.0, on_block + g.turnaround_min - g.crew_shift_end), 1),
        "gate_change": float(c.gate != g.planned_gate),
        "departure_delay_min": round(max(0.0, on_block + g.turnaround_min - g.next_departure), 1),
    }
    if s.flight.wake == Wake.HEAVY and not gate.widebody:
        return Check(ok=False, code="GATE_SIZE", detail=f"{c.gate} cannot take a HEAVY aircraft"), metrics
    for a, b in gate.busy:
        if occ[0] < b and a < occ[1]:
            return Check(ok=False, code="GATE_CONFLICT",
                         detail=f"{c.gate} occupied T+{a:.0f} to T+{b:.0f}; needs T+{occ[0]:.0f} to T+{occ[1]:.0f} incl. buffer"), metrics
    return _ok(f"{c.gate} free; turnaround done T+{on_block + g.turnaround_min:.0f}"), metrics


# ---------------------------------------------------------------- costs

def domain_costs(c: Candidate, m: dict[str, float], s: Scenario) -> dict[str, float]:
    """Soft preferences each domain negotiates over. Lower is better."""
    if c.kind == "DIVERT":
        return {"ATC": 8.0,
                "PILOT": round(m["fuel_hold_kg"] / 40 + 0.4 * m["missed_pax"] + 60, 2),
                "GROUND": 40.0}
    atc = 10 * m["window_load"] + 0.8 * m["knock_on_min"] + 0.15 * m["hold_min"] + (3.0 if m["wake_margin_min"] < 0.5 else 0.0)
    pilot = (m["fuel_hold_kg"] / 40 + 15 * m["turbulence"] + 0.4 * m["missed_pax"]
             + max(0.0, 15 - m["fuel_margin_min"]))
    ground = m["overtime_min"] + 6 * m["gate_change"] + 0.3 * m["departure_delay_min"]
    return {"ATC": round(atc, 2), "PILOT": round(pilot, 2), "GROUND": round(ground, 2)}


def assess(s: Scenario, c: Candidate) -> Assessment:
    checks, metrics = {}, {}
    for name, fn in (("ATC", check_atc), ("PILOT", check_pilot), ("GROUND", check_ground)):
        checks[name], m = fn(s, c)
        metrics.update(m)
    return Assessment(candidate=c, checks=checks, metrics=metrics, costs=domain_costs(c, metrics, s))


def assess_all(s: Scenario, candidates: list[Candidate]) -> list[Assessment]:
    return [assess(s, c) for c in candidates]


def total_cost(a: Assessment) -> float:
    return round(sum(a.costs.values()), 2)
