"""Filter the 5.8M-row DOT flights.csv down to a small, committed scenarios.csv.

Run once:  uv run python -m atm.data
Keeps rows that meet the brief (WEATHER_DELAY > 15 or LATE_AIRCRAFT_DELAY > 20),
drops October (airport columns hold numeric IDs that month), drops cancelled
and diverted flights, and keeps the original row number as ROW_ID so every
scenario traces back to one line of the source file.
"""

from __future__ import annotations

import argparse
from functools import lru_cache
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
FLIGHTS = DATA / "flights.csv"
SCENARIOS = DATA / "scenarios.csv"

COLUMNS = [
    "YEAR", "MONTH", "DAY", "DAY_OF_WEEK", "AIRLINE", "FLIGHT_NUMBER", "TAIL_NUMBER",
    "ORIGIN_AIRPORT", "DESTINATION_AIRPORT", "SCHEDULED_DEPARTURE", "DEPARTURE_DELAY",
    "DISTANCE", "SCHEDULED_ARRIVAL", "ARRIVAL_TIME", "ARRIVAL_DELAY", "TAXI_IN",
    "DIVERTED", "CANCELLED", "AIR_SYSTEM_DELAY", "SECURITY_DELAY", "AIRLINE_DELAY",
    "LATE_AIRCRAFT_DELAY", "WEATHER_DELAY",
]

WEATHER_MIN = 15  # brief: WEATHER_DELAY > 15
LATE_MIN = 20     # brief: LATE_AIRCRAFT_DELAY > 20


def qualifies(df: pd.DataFrame) -> pd.Series:
    return (df["WEATHER_DELAY"] > WEATHER_MIN) | (df["LATE_AIRCRAFT_DELAY"] > LATE_MIN)


def build(per_cause: int = 1500, seed: int = 2015, chunksize: int = 500_000) -> pd.DataFrame:
    if not FLIGHTS.exists():
        raise SystemExit(f"{FLIGHTS} not found. Download flights.csv from the organiser's Drive into data/.")

    airports = set(pd.read_csv(DATA / "airports.csv")["IATA_CODE"])
    kept = []
    offset = 0
    for chunk in pd.read_csv(FLIGHTS, usecols=COLUMNS, chunksize=chunksize, dtype={"TAIL_NUMBER": str, "ORIGIN_AIRPORT": str, "DESTINATION_AIRPORT": str}):
        chunk.index = range(offset, offset + len(chunk))
        offset += len(chunk)
        chunk = chunk[
            (chunk["MONTH"] != 10)
            & (chunk["CANCELLED"] == 0)
            & (chunk["DIVERTED"] == 0)
            & chunk["ARRIVAL_DELAY"].notna()
            & chunk["DESTINATION_AIRPORT"].isin(airports)
            & chunk["ORIGIN_AIRPORT"].isin(airports)
            & qualifies(chunk)
        ]
        kept.append(chunk)

    df = pd.concat(kept)
    df.insert(0, "ROW_ID", df.index + 2)  # +2: 1-based line number including the header
    print(f"qualifying rows: {len(df):,}")

    weather = df[df["WEATHER_DELAY"] > WEATHER_MIN]
    late = df[(df["LATE_AIRCRAFT_DELAY"] > LATE_MIN) & ~(df["WEATHER_DELAY"] > WEATHER_MIN)]
    print(f"  weather-caused: {len(weather):,}   late-aircraft only: {len(late):,}")

    sample = pd.concat([
        weather.sample(min(per_cause, len(weather)), random_state=seed),
        late.sample(min(per_cause, len(late)), random_state=seed),
    ]).sort_values("ROW_ID")
    for col in ["SCHEDULED_DEPARTURE", "SCHEDULED_ARRIVAL", "ARRIVAL_TIME"]:
        sample[col] = sample[col].astype("Int64").astype(str).str.zfill(4)
    return sample


@lru_cache(maxsize=1)
def load_scenarios() -> pd.DataFrame:
    return pd.read_csv(SCENARIOS, dtype={"SCHEDULED_ARRIVAL": str, "SCHEDULED_DEPARTURE": str, "ARRIVAL_TIME": str})


@lru_cache(maxsize=1)
def load_airports() -> pd.DataFrame:
    return pd.read_csv(DATA / "airports.csv").set_index("IATA_CODE")


def get_row(row_id: int) -> dict:
    df = load_scenarios()
    match = df[df["ROW_ID"] == row_id]
    if match.empty:
        raise KeyError(f"ROW_ID {row_id} is not in scenarios.csv")
    return {k: (None if pd.isna(v) else v) for k, v in match.iloc[0].to_dict().items()}


def random_row_id(seed: int | None = None) -> int:
    return int(load_scenarios().sample(1, random_state=seed)["ROW_ID"].iloc[0])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--per-cause", type=int, default=1500)
    args = ap.parse_args()
    sample = build(args.per_cause)
    sample.to_csv(SCENARIOS, index=False)
    print(f"wrote {len(sample):,} rows to {SCENARIOS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
