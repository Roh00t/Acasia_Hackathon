"""Typed state and the structured message every agent exchanges.

All times are minutes relative to T0: the moment the disruption is raised,
with the focal flight at the arrival fix.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Subsystem(str, Enum):
    ROUTINE = "ROUTINE"      # LATE_AIRCRAFT_DELAY > 20: late inbound, gate clash, crew shift
    WEATHER = "WEATHER"      # WEATHER_DELAY > 15: arrival rate cut, turbulence on approach
    EMERGENCY = "EMERGENCY"  # synthetic overlay: drone sighting closes the runway


class Wake(str, Enum):
    SMALL = "SMALL"
    LARGE = "LARGE"
    HEAVY = "HEAVY"


AgentName = Literal["ATC", "PILOT", "GROUND"]
AGENTS: tuple[AgentName, ...] = ("ATC", "PILOT", "GROUND")


# ---------------------------------------------------------------- scenario state

class Arrival(BaseModel):
    callsign: str
    wake: Wake
    t: float


class Closure(BaseModel):
    start: float
    end: float
    cause: str


class TaxiwayBlock(BaseModel):
    taxiway: str
    gates: list[str]
    until: float


class RunwayState(BaseModel):
    """ATC domain."""
    name: str
    normal_cap_per_hr: int
    arrival_cap_per_hr: int
    closure: Closure | None = None
    taxiway_block: TaxiwayBlock | None = None
    queue: list[Arrival]


class Connection(BaseModel):
    flight: str
    pax: int
    departs: float


class FlightState(BaseModel):
    """PILOT domain."""
    callsign: str
    wake: Wake
    earliest_landing: float
    fuel_endurance_min: float
    burn_kg_per_min: float
    reserve_min: float = 45.0
    alternate: str
    alternate_min: float
    turbulence: list[tuple[float, float, float]] = Field(
        default_factory=list, description="(start, end, index 0-1) windows on the approach"
    )
    connections: list[Connection]
    min_connect_min: float = 40.0


class Gate(BaseModel):
    id: str
    widebody: bool
    busy: list[tuple[float, float]]


class GroundState(BaseModel):
    """GROUND domain."""
    gates: list[Gate]
    planned_gate: str
    taxi_in_min: float
    turnaround_min: float
    next_departure: float
    crew_shift_end: float
    overtime_cost_per_min: float = 12.0
    gate_buffer_min: float = 10.0


class Scenario(BaseModel):
    scenario_id: str
    row_id: int
    subsystem: Subsystem
    base_cause: Subsystem
    row: dict
    airport: dict
    t0_clock: str
    narrative: str
    runway: RunwayState
    flight: FlightState
    ground: GroundState
    synthetic: list[str] = Field(description="Fields generated from a seeded RNG, not from the DOT row")


# ---------------------------------------------------------------- candidates

class Candidate(BaseModel):
    id: str
    kind: Literal["LAND", "DIVERT"]
    t: float | None = None
    gate: str | None = None
    alternate: str | None = None


class Check(BaseModel):
    ok: bool
    code: str
    detail: str


class Assessment(BaseModel):
    """A candidate with every validator verdict and the per-domain soft costs."""
    candidate: Candidate
    checks: dict[str, Check]
    metrics: dict[str, float]
    costs: dict[str, float]

    @property
    def feasible(self) -> bool:
        return all(c.ok for c in self.checks.values())


# ---------------------------------------------------------------- messages

class ReasonCode(str, Enum):
    OK = "OK"
    PREFERRED = "PREFERRED"
    FUEL_MARGIN_THIN = "FUEL_MARGIN_THIN"
    HOLD_TOO_LONG = "HOLD_TOO_LONG"
    MISSED_CONNECTIONS = "MISSED_CONNECTIONS"
    TURBULENCE_EXPOSURE = "TURBULENCE_EXPOSURE"
    DIVERT_COST = "DIVERT_COST"
    THROUGHPUT_LOSS = "THROUGHPUT_LOSS"
    SEQUENCE_CONGESTION = "SEQUENCE_CONGESTION"
    CREW_OVERTIME = "CREW_OVERTIME"
    GATE_CHANGE = "GATE_CHANGE"
    TURNAROUND_DELAY = "TURNAROUND_DELAY"


class AgentMessage(BaseModel):
    """The only thing an agent may say. Validated before anyone else sees it."""
    agent: AgentName
    round: int = Field(ge=1, le=3)
    decision: Literal["RANK", "ACCEPT", "REJECT"]
    candidate_id: str | None = Field(None, description="The proposal being answered (R2/R3)")
    ranking: list[str] = Field(default_factory=list, description="Candidate ids, best first (R1)")
    reason_code: ReasonCode
    reason: str = Field(max_length=400)
    counter: str | None = Field(None, description="One counter-offer candidate id (on REJECT)")
    red_lines: list[str] = Field(default_factory=list)
    level: Literal["L0", "L1"] = "L1"
