"""Append-only consensus log with a hash chain.

Each entry carries the digest of the previous entry, so editing, deleting or
reordering any line breaks verification from that point on. With ATM_LOG_KEY
set, digests are HMAC-SHA256: someone with the file but not the key cannot
regenerate a valid chain. Without it, digests are plain SHA-256, which only
detects edits to individual lines; `chain_alg()` says which is in use.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GENESIS = "0" * 64


def _key() -> bytes | None:
    key = os.environ.get("ATM_LOG_KEY", "")
    return key.encode() if key else None


def chain_alg() -> str:
    return "hmac-sha256" if _key() else "sha256"


def _digest(entry: dict) -> str:
    body = json.dumps({k: v for k, v in entry.items() if k != "hash"}, sort_keys=True, default=str).encode()
    key = _key()
    return hmac.new(key, body, hashlib.sha256).hexdigest() if key else hashlib.sha256(body).hexdigest()


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
        """Write the run's entries once, at the end of the run."""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(e, default=str) + "\n" for e in self.entries))

    def append_to(self, path: Path, entry: dict) -> None:
        """Add one later entry (an approval) without rewriting earlier lines."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(entry, default=str) + "\n")


def verify(entries: list[dict]) -> tuple[bool, int | None]:
    """Return (valid, first_bad_seq)."""
    prev = GENESIS
    for i, e in enumerate(entries):
        if e.get("prev_hash") != prev or not hmac.compare_digest(_digest(e), e.get("hash", "")):
            return False, i
        prev = e["hash"]
    return True, None


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
