"""Persist run state and hash-chain entries across serverless invocations."""

from __future__ import annotations

import os
from threading import RLock
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .log import ConsensusLog, verify

MEMORY_RUNS: dict[str, dict] = {}
_MEMORY_LOCK = RLock()


class StorageConfigurationError(RuntimeError):
    pass


class RunNotFoundError(LookupError):
    pass


class RunAlreadyDecidedError(RuntimeError):
    pass


class EscalatedRunError(RuntimeError):
    pass


def uses_database() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


def storage_mode() -> str:
    if uses_database():
        return "postgres"
    if os.environ.get("VERCEL") == "1":
        raise StorageConfigurationError("DATABASE_URL is required for durable Vercel run storage.")
    return "memory"


def _connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise StorageConfigurationError("DATABASE_URL is required for PostgreSQL storage.")
    conn = psycopg.connect(url, row_factory=dict_row)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS atm_runs (
            run_id TEXT PRIMARY KEY,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS atm_log_entries (
            run_id TEXT NOT NULL REFERENCES atm_runs(run_id) ON DELETE CASCADE,
            seq INTEGER NOT NULL,
            entry JSONB NOT NULL,
            PRIMARY KEY (run_id, seq)
        )
        """
    )
    return conn


def ensure_available() -> None:
    if storage_mode() == "postgres":
        with _connect():
            pass


def create_run(run: dict) -> None:
    if storage_mode() == "memory":
        with _MEMORY_LOCK:
            MEMORY_RUNS[run["run_id"]] = run
        return

    with _connect() as conn:
        conn.execute(
            "INSERT INTO atm_runs (run_id, payload) VALUES (%s, %s)",
            (run["run_id"], Jsonb(run)),
        )
        for entry in run["log"]:
            conn.execute(
                "INSERT INTO atm_log_entries (run_id, seq, entry) VALUES (%s, %s, %s)",
                (run["run_id"], entry["seq"], Jsonb(entry)),
            )


def get_run(run_id: str) -> dict | None:
    if storage_mode() == "memory":
        with _MEMORY_LOCK:
            return MEMORY_RUNS.get(run_id)

    with _connect() as conn:
        row = conn.execute("SELECT payload FROM atm_runs WHERE run_id = %s", (run_id,)).fetchone()
        if row is None:
            return None
        run = row["payload"]
        rows = conn.execute(
            "SELECT entry FROM atm_log_entries WHERE run_id = %s ORDER BY seq",
            (run_id,),
        ).fetchall()
        run["log"] = [entry["entry"] for entry in rows]
        return run


def approve_run(run_id: str, approval: dict) -> dict[str, Any]:
    if storage_mode() == "memory":
        with _MEMORY_LOCK:
            run = MEMORY_RUNS.get(run_id)
            if run is None:
                raise RunNotFoundError(run_id)
            return _append_approval(run, approval)

    with _connect() as conn:
        row = conn.execute(
            "SELECT payload FROM atm_runs WHERE run_id = %s FOR UPDATE",
            (run_id,),
        ).fetchone()
        if row is None:
            raise RunNotFoundError(run_id)
        run = row["payload"]
        rows = conn.execute(
            "SELECT entry FROM atm_log_entries WHERE run_id = %s ORDER BY seq",
            (run_id,),
        ).fetchall()
        run["log"] = [entry["entry"] for entry in rows]
        result = _append_approval(run, approval)
        conn.execute(
            "UPDATE atm_runs SET payload = %s WHERE run_id = %s",
            (Jsonb(run), run_id),
        )
        entry = result["entry"]
        conn.execute(
            "INSERT INTO atm_log_entries (run_id, seq, entry) VALUES (%s, %s, %s)",
            (run_id, entry["seq"], Jsonb(entry)),
        )
        return result


def _append_approval(run: dict, approval: dict) -> dict[str, Any]:
    if run.get("approval"):
        raise RunAlreadyDecidedError(run["run_id"])
    if run["outcome"]["candidate"] is None:
        raise EscalatedRunError(run["run_id"])

    log = ConsensusLog(run["run_id"])
    log.entries = run["log"]
    entry = log.append("APPROVAL", approval, sender="HUMAN")
    run["chain_valid"], run["chain_first_bad"] = verify(log.entries)
    run["chain_head"] = entry["hash"]
    run["approval"] = approval
    return {"ok": True, "chain_valid": run["chain_valid"], "entry": entry}
