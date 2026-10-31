"""Turn one DOT row into a disruption scenario with seeded synthetic airport state.

The DOT row gives the flight, its delay and the cause. It has no runway, gates,
fuel, wake category, connections or crew, so those are generated from a RNG
seeded by (row, subsystem): the same row always gives the same state. Every
generated field is listed in Scenario.synthetic and labelled in the UI.

Row parameters drive the state:
- WEATHER_DELAY scales the arrival-rate cut and the storm length.
- LATE_AIRCRAFT_DELAY scales how long the planned gate stays blocked.
"""

from __future__ import annotations

import math
import random

from .data import get_row, load_airports
from .schemas import (
    Arrival, Closure, Connection, FlightState, Gate, GroundState, RunwayState,
    Scenario, Subsystem, TaxiwayBlock, Wake,
)

HORIZON = 64            # minutes of arrival slots considered
EARLIEST_LANDING = 4.0  # minutes from the arrival fix to touchdown with no delay
QUEUE_LOAD = 0.55       # share of the arrival cap already sequenced ahead of and behind the flight
AIRLINE_CALLSIGNS = {
    "AA": "AAL", "AS": "ASA", "B6": "JBU", "DL": "DAL", "EV": "ASQ", "F9": "FFT", "HA": "HAL",
    "MQ": "ENY", "NK": "NKS", "OO": "SKW", "UA": "UAL", "US": "AWE", "VX": "VRD", "WN": "SWA",
}
BURN_KG_PER_MIN = {Wake.SMALL: 25.0, Wake.LARGE: 40.0, Wake.HEAVY: 100.0}
TURNAROUND_MIN = {Wake.SMALL: 30.0, Wake.LARGE: 40.0, Wake.HEAVY: 65.0}


def classify(row: dict) -> Subsystem:
    if (row.get("WEATHER_DELAY") or 0) > 15:
        return Subsystem.WEATHER
    return Subsystem.ROUTINE


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3440.065 * 2 * math.asin(math.sqrt(a))


def nearest_alternate(code: str) -> tuple[str, float]:
    """Nearest other airport more than 40 NM away, and the minutes to fly there."""
    airports = load_airports().dropna(subset=["LATITUDE", "LONGITUDE"])
    if code not in airports.index:
        return "UNKNOWN", 45.0
    lat, lon = airports.loc[code, ["LATITUDE", "LONGITUDE"]]
    best, best_nm = None, float("inf")
    for other, r in airports.iterrows():
        if other == code:
            continue
        nm = _haversine_nm(lat, lon, r["LATITUDE"], r["LONGITUDE"])
        if 40 < nm < best_nm:
            best, best_nm = other, nm
    return str(best), round(best_nm / 250 * 60 + 12, 1)  # 250 kt plus approach


def _clock_add(hhmm: str, minutes: float) -> str:
    h, m = int(hhmm[:2]) % 24, int(hhmm[2:])
    total = (h * 60 + m + int(round(minutes))) % 1440
    return f"{total // 60:02d}:{total % 60:02d}"


def _queue(rng: random.Random, cap: int, load: float, start: float, end: float) -> list[Arrival]:
    """Other arrivals already sequenced, spaced around the load factor of the cap."""
    mean_gap = 60.0 / max(cap * load, 1)
    out, t, n = [], start + rng.uniform(0, mean_gap), 0
    while t < end:
        wake = rng.choices([Wake.SMALL, Wake.LARGE, Wake.HEAVY], [0.1, 0.7, 0.2])[0]
        airline = rng.choice(list(AIRLINE_CALLSIGNS.values()))
        out.append(Arrival(callsign=f"{airline}{rng.randint(100, 2999)}", wake=wake, t=round(t, 1)))
        t += max(2.0, rng.gauss(mean_gap, mean_gap * 0.35))
        n += 1
    return out


def build_scenario(row_id: int, emergency: bool = False) -> Scenario:
    row = get_row(row_id)
    base = classify(row)
    subsystem = Subsystem.EMERGENCY if emergency else base
    rng = random.Random(f"{row_id}:{subsystem.value}")

    dest = row["DESTINATION_AIRPORT"]
    airports = load_airports()
    airport = {"code": dest}
    if dest in airports.index:
        a = airports.loc[dest]
        airport.update(name=a["AIRPORT"], city=a["CITY"], state=a["STATE"],
                       lat=float(a["LATITUDE"]), lon=float(a["LONGITUDE"]))

    weather_delay = float(row.get("WEATHER_DELAY") or 0)
    late_delay = float(row.get("LATE_AIRCRAFT_DELAY") or 0)
    callsign = f"{AIRLINE_CALLSIGNS.get(row['AIRLINE'], row['AIRLINE'])}{int(row['FLIGHT_NUMBER'])}"

    # ---------------- ATC: runway, cap, queue
    normal_cap = rng.choice([32, 36, 40, 44, 48])
    cap = normal_cap
    closure = None
    if base == Subsystem.WEATHER:
        factor = min(0.75, max(0.45, 0.75 - weather_delay / 300))
        cap = max(12, int(normal_cap * factor))
    # Upstream flow control has already metered the other traffic to the (possibly reduced) cap.
    queue = _queue(rng, cap, QUEUE_LOAD, -6, 75)
    if subsystem == Subsystem.EMERGENCY:
        start = round(rng.uniform(0, 4), 1)
        closure = Closure(start=start, end=round(start + rng.uniform(15, 40), 1),
                          cause="Drone sighting within 2 NM of the runway threshold; runway closed until cleared")
        # Arrivals that would have landed during the closure stack up behind it: the surge.
        stacked, t = [], closure.end + 2
        for arr in queue:
            if closure.start <= arr.t < closure.end:
                stacked.append(arr.model_copy(update={"t": round(t, 1)}))
                t += rng.uniform(2.4, 3.6)
            else:
                stacked.append(arr)
        queue = sorted(stacked, key=lambda a: a.t)
    taxiway_block = None
    if rng.random() < (0.5 if subsystem == Subsystem.EMERGENCY else 0.3):
        taxiway_block = TaxiwayBlock(taxiway=rng.choice(["B", "C", "K"]), gates=["A7", "A8"],
                                     until=round(rng.uniform(15, 40), 1))
    runway = RunwayState(name=rng.choice(["26R", "27L", "08L", "17C", "28R"]), normal_cap_per_hr=normal_cap,
                         arrival_cap_per_hr=cap, closure=closure, taxiway_block=taxiway_block, queue=queue)

    # ---------------- PILOT: fuel, alternate, turbulence, connections
    distance = float(row.get("DISTANCE") or 800)
    wake = Wake.HEAVY if distance > 2200 and rng.random() < 0.5 else Wake.LARGE
    alternate, alt_min = nearest_alternate(dest)
    margin = {Subsystem.ROUTINE: (18, 40), Subsystem.WEATHER: (12, 35), Subsystem.EMERGENCY: (14, 52)}[subsystem]
    endurance = 45 + alt_min + rng.uniform(*margin)
    turbulence: list[tuple[float, float, float]] = [(-1e9, 1e9, 0.1)]
    if base == Subsystem.WEATHER:
        a = rng.uniform(4, 18)
        b = a + min(30, 8 + weather_delay / 6)
        turbulence = [(-1e9, 1e9, 0.15), (a - 8, b + 8, 0.5), (a, b, 0.9)]
    connections = [
        Connection(flight=f"{row['AIRLINE']}{rng.randint(100, 2999)}", pax=rng.randint(3, 28),
                   departs=round(rng.uniform(45, 150), 0))
        for _ in range(rng.randint(3, 6))
    ]
    flight = FlightState(callsign=callsign, wake=wake, earliest_landing=EARLIEST_LANDING,
                         fuel_endurance_min=round(endurance, 1), burn_kg_per_min=BURN_KG_PER_MIN[wake],
                         alternate=alternate, alternate_min=alt_min,
                         turbulence=[(round(s, 1), round(e, 1), i) for s, e, i in turbulence],
                         connections=connections)

    # ---------------- GROUND: gates, crew, turnaround
    gates = []
    for i in range(1, 9):
        busy, t = [], rng.uniform(-40, 10)
        while t < HORIZON + 90:
            length = rng.uniform(35, 70)
            if rng.random() < 0.55:
                busy.append((round(t, 1), round(t + length, 1)))
            t += length + rng.uniform(15, 50)
        gates.append(Gate(id=f"A{i}", widebody=i <= 2, busy=busy))
    compatible = [g for g in gates if g.widebody or wake != Wake.HEAVY]
    planned = rng.choice(compatible)
    if base == Subsystem.ROUTINE:
        # The late inbound clashes with the aircraft still on its planned gate.
        blocked_until = EARLIEST_LANDING + min(60.0, 10 + late_delay * 0.5)
        planned.busy = [b for b in planned.busy if b[0] > blocked_until + 15] + [(-30.0, round(blocked_until, 1))]
    if subsystem == Subsystem.EMERGENCY and closure:
        # Gate surge on reopening: the stacked arrivals need gates at the same time.
        for g in rng.sample(gates, 4):
            g.busy.append((closure.end + 4, closure.end + rng.uniform(40, 70)))
    taxi_in = float(row.get("TAXI_IN") or 8)
    turnaround = TURNAROUND_MIN[wake]
    ground = GroundState(
        gates=gates, planned_gate=planned.id, taxi_in_min=taxi_in, turnaround_min=turnaround,
        next_departure=round(EARLIEST_LANDING + taxi_in + turnaround + rng.uniform(5, 25), 0),
        crew_shift_end=round(rng.uniform(35, 80), 0),
    )

    arrival_delay = float(row.get("ARRIVAL_DELAY") or 0)
    t0_clock = _clock_add(str(row["SCHEDULED_ARRIVAL"]).zfill(4), arrival_delay - EARLIEST_LANDING - taxi_in)
    narrative = {
        Subsystem.ROUTINE: f"{callsign} arrives {late_delay:.0f} min late on a late inbound aircraft. "
                           f"Its planned gate {planned.id} is still occupied and the ramp crew shift ends soon.",
        Subsystem.WEATHER: f"Weather at {dest} ({weather_delay:.0f} min weather delay in the DOT row) cuts the "
                           f"arrival rate from {normal_cap} to {cap}/hr with turbulence on final.",
        Subsystem.EMERGENCY: f"SYNTHETIC: a drone sighting closes runway {runway.name} at {dest} from "
                             f"T+{closure.start:.0f} to T+{closure.end:.0f} min while {callsign} is on approach."
        if closure else "",
    }[subsystem]

    synthetic = ["runway", "arrival_cap", "queue", "wake", "fuel", "alternate_time", "turbulence",
                 "connections", "gates", "crew_shift", "turnaround", "taxiway_block"]
    if closure:
        synthetic.append("runway_closure")

    return Scenario(
        scenario_id=f"{row_id}-{subsystem.value}", row_id=row_id, subsystem=subsystem, base_cause=base,
        row=row, airport=airport, t0_clock=t0_clock, narrative=narrative,
        runway=runway, flight=flight, ground=ground, synthetic=synthetic,
    )
