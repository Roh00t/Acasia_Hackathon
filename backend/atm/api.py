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
from . import storage

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

app = FastAPI(title="ATM multi-agent negotiation")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])

RUNS = storage.MEMORY_RUNS


def live_allowed() -> bool:
    """Live Claude runs cost money; on a public Vercel deployment they need ATM_ALLOW_LIVE=1."""
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    return os.environ.get("VERCEL") != "1" or os.environ.get("ATM_ALLOW_LIVE") == "1"


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
    import os
    try:
        storage.ensure_available()
        mode = storage.storage_mode()
    except storage.StorageConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"ok": True, "scenarios": len(load_scenarios()),
            "model": os.environ.get("ATM_MODEL", "claude-haiku-5-5"),
            "live_available": live_allowed(), "storage": mode}


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
    if req.live and not live_allowed():
        raise HTTPException(403, "Live Claude runs are not enabled on this deployment; run offline, "
                                 "or set ATM_ALLOW_LIVE=1 on the backend service.")
    try:
        storage.ensure_available()
    except storage.StorageConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc
    row_id = req.row_id or random_row_id()
    try:
        r = run(row_id, emergency=req.emergency, live=req.live, inject_unsafe=req.inject_unsafe,
                write=not storage.uses_database())
    except KeyError as e:
        raise HTTPException(404, str(e))
    storage.create_run(r)
    return r


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    try:
        storage.ensure_available()
        r = storage.get_run(run_id)
    except storage.StorageConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc
    if r is None:
        raise HTTPException(404, "unknown run")
    return r


@app.post("/runs/{run_id}/approve")
def approve(run_id: str, req: ApproveRequest):
    try:
        storage.ensure_available()
        r = storage.get_run(run_id)
    except storage.StorageConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc
    if r is None:
        raise HTTPException(404, "unknown run")
    if r.get("approval"):
        raise HTTPException(409, "run already has a decision")
    if r["outcome"]["candidate"] is None:
        raise HTTPException(409, "escalated run: no plan to approve; decide outside the system")
    if req.decision == "OVERRIDE" and not req.note.strip():
        raise HTTPException(422, "an override needs a note saying why")
    try:
        result = storage.approve_run(run_id, req.model_dump())
    except storage.RunNotFoundError as exc:
        raise HTTPException(404, "unknown run") from exc
    except storage.RunAlreadyDecidedError as exc:
        raise HTTPException(409, "run already has a decision") from exc
    except storage.EscalatedRunError as exc:
        raise HTTPException(409, "escalated run: no plan to approve; decide outside the system") from exc
    if not storage.uses_database():
        log_entry = result["entry"]
        from .log import ConsensusLog

        log = ConsensusLog(run_id)
        log.append_to(RUNS_DIR / f"{run_id}.jsonl", log_entry)
    return result
