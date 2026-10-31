# Fault injection (offline (fake clients, no API calls))

10 scenarios x 5 faults = 50 runs. Expected level reached in **48/50**. **Unsafe plans accepted: 0** (chosen plan re-checked with the real validators, independent of the coordinator's own gate). Hash chain valid in every run: True.

Of the 2 runs that missed the expected level, 2 reached the same level the rule agents reach on that scenario with no fault at all (column *No-fault*): the stand-in took over every message, the rule agents did not agree within 3 rounds, and the ladder dropped one more rung to L2 as designed.

Regenerate: `cd backend && uv run python -m atm.faults`

| Fault | Injection | Expected | Matched | Levels seen | Stand-ins | Vetoes | Unsafe accepted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| timeout | fake client raises `TimeoutError` | L1 | 9/10 | L1: 9, L2: 1 | 63 | 0 | 0 |
| malformed | fake client raises `ValueError` | L1 | 9/10 | L1: 9, L2: 1 | 63 | 0 | 0 |
| stubborn | Pilot LLM (fake) REJECTs every proposal, no counter | L2 | 10/10 | L2: 10 | 0 | 0 | 0 |
| no_feasible | `assess_all` patched so every candidate fails FUEL_RESERVE | L3 | 10/10 | L3: 10 | 0 | 0 | 0 |
| red_team | `inject_unsafe=True`: Pilot ranks and counters with an illegal long hold | VETO, unsafe not chosen | 10/10 | L2: 10 | 0 | 28 | 0 |

## Every run

| Row | Subsystem | Fault | Expected | Actual | No-fault | Rounds | Stand-ins | Vetoes | Chosen | Unsafe id | OK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3725311 | ROUTINE | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S04-A1 | - | yes |
| 3725311 | ROUTINE | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S04-A1 | - | yes |
| 3725311 | ROUTINE | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S04-A1 | - | yes |
| 3725311 | ROUTINE | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 3725311 | ROUTINE | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S04-A1 | S62-A1 | yes |
| 2167594 | ROUTINE | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S06-A2 | - | yes |
| 2167594 | ROUTINE | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S06-A2 | - | yes |
| 2167594 | ROUTINE | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S06-A2 | - | yes |
| 2167594 | ROUTINE | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 2167594 | ROUTINE | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S06-A2 | S62-A4 | yes |
| 160031 | ROUTINE | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S10-A2 | - | yes |
| 160031 | ROUTINE | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S10-A2 | - | yes |
| 160031 | ROUTINE | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S10-A2 | - | yes |
| 160031 | ROUTINE | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 160031 | ROUTINE | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S10-A2 | S62-A1 | yes |
| 3072818 | ROUTINE | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S10-A3 | - | yes |
| 3072818 | ROUTINE | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S10-A3 | - | yes |
| 3072818 | ROUTINE | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S10-A3 | - | yes |
| 3072818 | ROUTINE | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 3072818 | ROUTINE | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S10-A3 | S56-A3 | yes |
| 3709540 | WEATHER | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S04-A3 | - | yes |
| 3709540 | WEATHER | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S04-A3 | - | yes |
| 3709540 | WEATHER | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S04-A3 | - | yes |
| 3709540 | WEATHER | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 3709540 | WEATHER | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S04-A3 | S62-A1 | yes |
| 2001502 | WEATHER | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S06-A7 | - | yes |
| 2001502 | WEATHER | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S06-A7 | - | yes |
| 2001502 | WEATHER | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S06-A7 | - | yes |
| 2001502 | WEATHER | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 2001502 | WEATHER | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S06-A7 | S62-A1 | yes |
| 152753 | WEATHER | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | S04-A1 | - | yes |
| 152753 | WEATHER | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | S04-A1 | - | yes |
| 152753 | WEATHER | stubborn | L2 | L2 | L1 | 3 | 0/9 | 0 | S04-A1 | - | yes |
| 152753 | WEATHER | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 152753 | WEATHER | red_team | VETO, unsafe not chosen | L2, 3 VETO | L1 | 3 | 0/9 | 3 | S04-A1 | S62-A1 | yes |
| 353791 | EMERGENCY | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | DIVERT-MIA | - | yes |
| 353791 | EMERGENCY | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | DIVERT-MIA | - | yes |
| 353791 | EMERGENCY | stubborn | L2 | L2 | L1 | 2 | 0/6 | 0 | DIVERT-MIA | - | yes |
| 353791 | EMERGENCY | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 353791 | EMERGENCY | red_team | VETO, unsafe not chosen | L2, 2 VETO | L1 | 2 | 0/6 | 2 | DIVERT-MIA | S60-A5 | yes |
| 4882283 | EMERGENCY | timeout | L1 | L2 | L2 | 3 | 9/9 | 0 | S30-A1 | - | NO |
| 4882283 | EMERGENCY | malformed | L1 | L2 | L2 | 3 | 9/9 | 0 | S30-A1 | - | NO |
| 4882283 | EMERGENCY | stubborn | L2 | L2 | L2 | 3 | 0/9 | 0 | S30-A1 | - | yes |
| 4882283 | EMERGENCY | no_feasible | L3 | L3 | L2 | 0 | 0/0 | 0 | - | - | yes |
| 4882283 | EMERGENCY | red_team | VETO, unsafe not chosen | L2, 3 VETO | L2 | 3 | 0/9 | 3 | S30-A1 | S60-A1 | yes |
| 1109428 | EMERGENCY | timeout | L1 | L1 | L1 | 2 | 6/6 | 0 | DIVERT-ONT | - | yes |
| 1109428 | EMERGENCY | malformed | L1 | L1 | L1 | 2 | 6/6 | 0 | DIVERT-ONT | - | yes |
| 1109428 | EMERGENCY | stubborn | L2 | L2 | L1 | 2 | 0/6 | 0 | DIVERT-ONT | - | yes |
| 1109428 | EMERGENCY | no_feasible | L3 | L3 | L1 | 0 | 0/0 | 0 | - | - | yes |
| 1109428 | EMERGENCY | red_team | VETO, unsafe not chosen | L2, 2 VETO | L1 | 2 | 0/6 | 2 | DIVERT-ONT | S56-A2 | yes |
