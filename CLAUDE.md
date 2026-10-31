# Autonomous SG 2026 — Airbus Challenge #2 (Team Killswitch)

Three independent AI agents (ATC, Pilot, Ground) negotiate a disrupted arrival from one real 2015 US DOT
delay row. Submit by 15:30 on 31 Oct 2026; demo 16:30. Brief: `Autonomous SG 2026_Airbus Track.pdf`.
Team plan and timeline: `Killswitch Autonomous SG 2026 Game Plan.md`.

## The one rule

**LLMs negotiate trade-offs. Code decides what is safe and when to stop.** The rubric marks down "an LLM doing
scheduling or legality checks". Never let an agent's output reach the plan without the validators re-checking it.

| Job | Owner | File |
| --- | --- | --- |
| DOT row → scenario + seeded synthetic state | code | `backend/atm/scenario.py` |
| Enumerate options (2-min slots × 8 gates + divert) | code | `backend/atm/candidates.py` |
| Wake separation, arrival cap, runway closure, taxiway, fuel reserve, turbulence, gate conflict | code | `backend/atm/validators.py` |
| Rank / accept / reject / counter among legal options | 3 separate agents | `backend/atm/agents/` |
| ≤3 rounds, veto illegal ids, L2/L3 fallback | code | `backend/atm/coordinator.py` |
| Hash-chained consensus log | code | `backend/atm/log.py` |
| Final approval | human (duty manager) | `/console` Approve button |

Fallback ladder (always shown in UI and log): **L0** LLM consensus · **L1** rule-agent consensus (stand-in on
timeout / bad JSON after 1 retry / illegal id) · **L2** lowest weighted cost among feasible, no consensus ·
**L3** nothing feasible → escalate to duty manager.

## Three subsystems

- **ROUTINE** — `LATE_AIRCRAFT_DELAY > 20` (weather ≤ 15). Planned gate still occupied, crew shift ending.
- **WEATHER** — `WEATHER_DELAY > 15`. Arrival cap cut (scaled by the weather minutes), storm turbulence window.
- **EMERGENCY** — synthetic overlay on any row (`--emergency` / console toggle): drone sighting closes the runway
  15–40 min, arrivals stack behind it, gate surge on reopening. Labelled SYNTHETIC everywhere.

Synthetic state is seeded by `(ROW_ID, subsystem)`: same row → same state. Every generated field is listed in
`Scenario.synthetic` and shown on screen. Never present synthetic numbers as measured.

## Agents

- Code default is `claude-haiku-5-5`; the team runs **`claude-opus-5-5`** via `ATM_MODEL` in `.env` (chosen 31 Oct for
  live demo quality, about $0.05 per negotiation vs about $0.0013 on Haiku). Neither model accepts `temperature`/`top_p`/`top_k`:
  don't send them. Always state which model produced which numbers.
- Structured output via `client.messages.parse(..., output_format=LLMReply)`; system prompt cached.
- Domain slicing in `agents/views.py`: Pilot never sees gates/crew, Ground never sees fuel. Keep it that way;
  it is the evidence that this is not "three roles in one prompt".
- `--offline` (default in CLI/batch) runs all agents on the L1 rules, no API calls. This is the stage backup.

## Commands

```bash
cd backend && uv sync
uv run python -m atm.data                         # rebuild data/scenarios.csv from data/flights.csv (gitignored)
uv run pytest                                     # validators, hash chain, coordinator guarantees
uv run python -m atm.cli --random [--emergency] [--inject-unsafe] [--live]
uv run python -m atm.batch --n 50 --out ../web/public/evidence/batch.json            # offline rule agents
uv run python -m atm.batch --n 20 --live --workers 6 --out ../web/public/evidence/batch-live.json  # ~$3 on Opus 5.5
uv run uvicorn atm.api:app --reload --port 8010   # API for /console (8000 is often taken)
cd web && npm install && npm run dev              # http://localhost:3000 (story) and /console
```

Regenerate the showcase runs after changing the backend:

```bash
uv run python -m atm.cli --row 336875 --out ../web/public/runs/showcase-weather.json
uv run python -m atm.cli --row 7445 --out ../web/public/runs/showcase-routine.json
uv run python -m atm.cli --row 9133 --emergency --out ../web/public/runs/showcase-emergency.json
```

## Never cut

The 3 separate agents, the validators, the 3-round cap, the fallback ladder, the hash log, the injected-unsafe
veto demo. Cut order if late: counter-offers → GLB models (primitives already work) → story beats → batch size.

## Facts allowed in the pitch (verified)

- Gatwick, Dec 2018: ~1,000 flights and ~140,000 passengers affected over ~33 hours.
- Munich, 3 Oct 2025: 23 inbound diversions and 12 cancellations.
- FAA: more than 100 drone sighting reports near airports per month (faa.gov UAS sightings report).

Do **not** use: the "75th Arsenal" strikes, the AWS data-centre drone disruption, "139 NMACs" (unverified).
Never say "no human needed" or "autonomous ATC". Say "agents negotiate, code enforces safety, a person approves".
Military airfields: one future-scope line only.

## Repo hygiene

- `data/flights.csv` (592 MB) is gitignored; only `data/scenarios.csv` (3,000 rows, no October) is committed.
- Keys live in `.env` (gitignored); copy `.env.example`.
- Raw Meshy/OpenGen exports go in `assets/raw/` (gitignored); `cd web && npm run models:optimize`, then register
  the file in `web/lib/models.ts`. The scene falls back to primitives for any missing model.
