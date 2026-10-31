# Live check, 31 Oct 2026, 14:55–15:05 SGT

Submission tagged first: `submission-1530` → `90a7771` (build clean, 30 tests passing). Everything below is on
branch `post-submit`.

## 1. The AI agents run live (claude-opus-5-5, via the console API `POST /run`)

| Subsystem | Run ID | Level | Plan | Rounds | Agent calls per round | Model | Stand-ins | Latency | Cost (ESTIMATE) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ROUTINE | 1714727-ROUTINE-23b1be | L0 | S10-A6 | 2 | R1: 3, R2: 3 | claude-opus-5-5 | 0 | 23.0 s | $0.0504 |
| WEATHER | 2339595-WEATHER-ba73f2 | L0 | S04-A2 | 2 | R1: 3, R2: 3 | claude-opus-5-5 | 0 | 17.3 s | $0.0409 |
| EMERGENCY | 55520-EMERGENCY-d36f27 | L0 | S22-A1 | 2 | R1: 3, R2: 3 | claude-opus-5-5 | 0 | 20.4 s | $0.0503 |

Calls counted from the consensus log (MESSAGE entries per round, each carrying `meta.model`). HMAC-keyed chain valid on
all three. Live spend for this task: **$0.14** (cap $1.50).

## 2. Fallback drill (row 2339595, live mode)

Change made for this drill: each Claude call now has a **25 s timeout with no hidden SDK retries**, and a per-run
circuit breaker: after a timeout, connection error or auth error, the other agents in that run skip straight to the
deterministic rule agent (one wait, not nine). The console says it in words: "Claude agent timed out; deterministic
rule agent took over". Agent logic, prompts, validators and scoring are unchanged.

| Drill | How | Time to finish | Result |
| --- | --- | --- | --- |
| Hung connection | `ANTHROPIC_BASE_URL` → blackhole IP | **26.6 s** | L1, plan S04-A2, first agent `APITimeoutError`, others "Skipped: earlier Claude call failed" |
| Network off | `ANTHROPIC_BASE_URL` → refused port | **0.0 s** | L1, plan S04-A2 (`APIConnectionError`) |
| Invalid API key | bogus `ANTHROPIC_API_KEY` | **0.3 s** | L1, plan S04-A2 (`AuthenticationError` 401) |
| API down entirely | uvicorn stopped, console reloaded | instant | Console shows **REPLAY** badge and replays the saved real runs; no errors |
| Red team (offline) | `inject_unsafe=True` | instant | 3 VETO entries; unsafe S58-A1 never chosen; plan S04-A2 at L2 |

Before this change a hung call could block for the SDK default (10 min, with retries). New test:
`backend/tests/test_hardening.py::test_timeout_opens_circuit_so_run_finishes_fast`. `uv run pytest` → 31 passed.

## 3. Display check

- Story and console screenshotted at 1280 × 657 CSS px (true projector width) and in a 1440 × 900 window
  (browser zoom made it 1800 × 1038 CSS px). No horizontal scroll, no console errors.
- FPS (requestAnimationFrame counter, 5 s programmatic scroll through the Weather chapter with rain on, M-series
  laptop, DPR 2 capped to 1.5 in the canvas): **99.7 fps average** on a 120 Hz display; worst single frame 116.7 ms
  (one hitch, likely a texture upload at a chapter change).

## 4. Secrets

`sk-ant-` and the `.env` values (API key, log key) searched in `runs/`, `web/public/`, `results/`, source, and
`git log --all -p`: **0 hits**. `.env` was never committed; only `.env.example` is tracked.

## 5. Not done

- No true 1440 × 900 CSS-pixel check (browser zoom); the 1280 px check covers the projector case.
- The 103 MB `presentation/air traffic.pptx` is untracked and must stay out of git (GitHub's 100 MB limit).
