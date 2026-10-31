"""HTTP API for the /console page.

  uv run uvicorn atm.api:app --reload --port 8010
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .coordinator import RUNS_DIR, run
from .data import load_scenarios, random_row_id
from .log import ConsensusLog, verify

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

app = FastAPI(title="ATM multi-agent negotiation")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])

RUNS: dict[str, dict] = {}


class RunRequest(BaseModel):
    row_id: int | None = None
    emergency: bool = False
    live: bool = False
    inject_unsafe: bool = False


class ApproveRequest(BaseModel):
    approver: str = "Station duty manager"
    decision: Literal["APPROVE", "OVERRIDE"] = "APPROVE"
    note: str = ""


@app.get("/health")
def health():
    return {"ok": True, "scenarios": len(load_scenarios())}


@app.get("/scenarios")
def scenarios(cause: str | None = None, limit: int = 50):
    df = load_scenarios()
    if cause == "WEATHER":
        df = df[df["WEATHER_DELAY"] > 15]
    elif cause == "ROUTINE":
        df = df[df["WEATHER_DELAY"] <= 15]
    cols = ["ROW_ID", "MONTH", "DAY", "AIRLINE", "FLIGHT_NUMBER", "ORIGIN_AIRPORT", "DESTINATION_AIRPORT",
            "ARRIVAL_DELAY", "WEATHER_DELAY", "LATE_AIRCRAFT_DELAY"]
    return df[cols].head(limit).fillna(0).to_dict(orient="records")


@app.post("/run")
def post_run(req: RunRequest):
    row_id = req.row_id or random_row_id()
    try:
        r = run(row_id, emergency=req.emergency, live=req.live, inject_unsafe=req.inject_unsafe)
    except KeyError as e:
        raise HTTPException(404, str(e))
    RUNS[r["run_id"]] = r
    return r


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    if run_id not in RUNS:
        raise HTTPException(404, "unknown run")
    return RUNS[run_id]


@app.post("/runs/{run_id}/approve")
def approve(run_id: str, req: ApproveRequest):
    r = RUNS.get(run_id)
    if not r:
        raise HTTPException(404, "unknown run")
    if r.get("approval"):
        raise HTTPException(409, "run already has a decision")
    if r["outcome"]["candidate"] is None:
        raise HTTPException(409, "escalated run: no plan to approve; decide outside the system")
    if req.decision == "OVERRIDE" and not req.note.strip():
        raise HTTPException(422, "an override needs a note saying why")
    log = ConsensusLog(run_id)
    log.entries = r["log"]
    entry = log.append("APPROVAL", req.model_dump(), sender="HUMAN")
    log.append_to(RUNS_DIR / f"{run_id}.jsonl", entry)
    r["chain_valid"], r["chain_first_bad"] = verify(log.entries)
    r["chain_head"] = entry["hash"]
    r["approval"] = req.model_dump()
    return {"ok": True, "chain_valid": r["chain_valid"], "entry": log.entries[-1]}
