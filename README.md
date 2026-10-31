# Arrival disruption: 3-agent negotiation

Autonomous SG 2026 · Airbus track · Challenge #2.

[Website](https://acasiahackathon.vercel.app/) · [Canva presentation](https://canva.link/5m7ex0ekavm6kiy)

When weather, a late inbound aircraft or a runway closure hits an arrival hub, ATC, the flight crew and ramp
control renegotiate by phone while the aircraft holds. Here three **independent** AI agents (ATC, Pilot, Ground)
negotiate a revised arrival slot, gate or divert from a real 2015 US DOT delay row in at most 3 rounds.
**Code enforces every safety margin; a station duty manager approves.**

```
DOT row ─► seeded scenario ─► 241 options ─► validators (code) ─► legal options
                                                                     │
                     ATC agent ◄── coordinator (code, ≤3 rounds) ──► Pilot agent
                                          │                         Ground agent
                     consensus (L0/L1) │ fallback (L2) │ escalate (L3)
                                          ▼
                       hash-chained log ─► duty manager approves
```

## Quick start

```bash
# backend (Python 3.12, uv)
cd backend
uv sync
uv run pytest
uv run python -m atm.cli --random                  # one offline negotiation
uv run python -m atm.cli --random --emergency      # drone runway closure (synthetic)
uv run python -m atm.cli --random --inject-unsafe  # Pilot pushes an illegal hold; watch the veto
uv run python -m atm.batch --n 50                  # evaluation over 150 scenarios
uv run uvicorn atm.api:app --reload --port 8010    # API for the console

# web (Node 20+)
cd web
npm install
npm run dev     # http://localhost:3000 story · http://localhost:3000/console live demo
```

Live Claude agents: copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, then add `--live` (CLI) or tick
**Live Claude agents** in the console. Without a key everything runs offline on the deterministic rule agents.

`data/flights.csv` (592 MB) is not in git. To rebuild `data/scenarios.csv`, download it from the organiser's
Drive into `data/` and run `uv run python -m atm.data`.

## Layout

| Path | What |
| --- | --- |
| `backend/atm/scenario.py` | DOT row → ROUTINE / WEATHER / EMERGENCY scenario with seeded synthetic state |
| `backend/atm/validators.py` | Wake separation, arrival cap, runway closure, taxiway, fuel reserve, turbulence, gate conflict |
| `backend/atm/agents/` | Domain-sliced views, L1 rule agents, L0 Claude agents (structured output) |
| `backend/atm/coordinator.py` | 3-round protocol, veto of illegal ids, L2/L3 fallback, FCFS and siloed baselines |
| `backend/atm/log.py` | Append-only consensus log, HMAC-SHA256 chained when `ATM_LOG_KEY` is set (plain SHA-256 otherwise) |
| `backend/atm/batch.py` | Evaluation: consensus rate, rounds, vetoes, unsafe accepted, vs FCFS / fallback / siloed |
| `web/components/story/` | Scroll-driven 3D story (GSAP ScrollTrigger + React Three Fiber) |
| `web/app/console/` | Duty-manager console: live runs, validator grid, approve, log |
| `CLAUDE.md` | Build rules and never-cut list |

## Limits

Runway, gates, fuel, connections and crew are synthetic, seeded from each row and labelled as such. One flight at
a time; the model does not re-sequence the whole arrival bank. All impact numbers are modelled, not measured.

## Deploying the services (Vercel)

Import the repository root as one Vercel project. The root `vercel.json` defines two independently built
services: `web` (Next.js) and `backend` (FastAPI). Public requests route to `web`; its `/api/*` Next.js route
handler proxies to the internal `backend` service using the Vercel-injected `BACKEND_URL` binding. The backend
has no public rewrite of its own. Do not define `BACKEND_URL` manually.

Connect a PostgreSQL provider (for example through the Vercel Marketplace) and configure its `DATABASE_URL` for
the backend service. The API creates its `atm_runs` and `atm_log_entries` tables automatically. Vercel requests
fail clearly if `DATABASE_URL` is missing; local development without it uses in-memory run state. Configure
`ANTHROPIC_API_KEY`, `ATM_MODEL` (optional), and `ATM_LOG_KEY` (recommended) for the backend service only. The web
story remains static and reads files from `web/public/`. The console uses same-origin `/api/*` requests; when the
backend is unavailable, it falls back to replay mode. For local `npm run dev`, the proxy targets
`http://localhost:8010` unless `vercel dev` supplies the service binding.

The backend service includes copies of `data/scenarios.csv` and `data/airports.csv` under `backend/data/`, because
its Vercel service root is `backend`. Running `uv run python -m atm.data` refreshes these deployment copies too.
PostgreSQL stores each run and its hash-chain entries so approvals can be handled by another function invocation;
configure `ATM_LOG_KEY` to HMAC-sign the chain.
