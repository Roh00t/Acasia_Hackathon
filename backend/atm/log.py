"""Append-only consensus log with a SHA-256 hash chain.

Each entry carries the hash of the previous entry, so editing, deleting or
reordering any line breaks verification from that point on.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GENESIS = "0" * 64


def _digest(entry: dict) -> str:
    body = {k: v for k, v in entry.items() if k != "hash"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


class ConsensusLog:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.entries: list[dict] = []

    def append(self, kind: str, payload: Any, sender: str = "COORDINATOR", round: int | None = None) -> dict:
        entry = {
            "seq": len(self.entries),
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "run_id": self.run_id,
            "kind": kind,
            "sender": sender,
            "round": round,
            "payload": payload,
            "prev_hash": self.entries[-1]["hash"] if self.entries else GENESIS,
        }
        entry["hash"] = _digest(entry)
        self.entries.append(entry)
        return entry

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(e, default=str) + "\n" for e in self.entries))


def verify(entries: list[dict]) -> tuple[bool, int | None]:
    """Return (valid, first_bad_seq)."""
    prev = GENESIS
    for i, e in enumerate(entries):
        if e.get("prev_hash") != prev or _digest(e) != e.get("hash"):
            return False, i
        prev = e["hash"]
    return True, None


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
