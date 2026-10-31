# Killswitch Base Defense — 3-minute pitch

**Autonomous SG 2026 · Airbus Challenge #2 · Team Killswitch**

**Thesis:** Agents negotiate the trade-offs; deterministic code enforces safety; a duty manager approves the plan.

## Slide 1 — The arrival bank is under pressure (0:00–0:25)

**On screen:** The airfield scene. An inbound flight is approaching; a drone alert closes the runway and arrivals begin stacking.

**Say:**  
“Picture an airport base under pressure: an inbound aircraft is low on fuel, the runway is temporarily closed, and the gate it was meant to use is still occupied. ATC, the cockpit, and the ramp each see a different part of the problem. Killswitch gives them a way to negotiate one safe, coordinated plan.”

**Visual note:** The drone/runway closure is a **synthetic emergency overlay**, not an event reported by the flight data.

## Slide 2 — Start with a real disruption, label what we simulate (0:25–0:55)

**On screen:** A selected 2015 U.S. DOT delay row beside its seeded scenario.

**Say:**  
“We start from one real 2015 DOT delay row. It gives us the flight and delay context, but not live fuel, runway, gate, or crew state. We generate those operational details synthetically and deterministically from the row, and show every generated field as synthetic. The same row and subsystem reproduce the same scenario.”

## Slide 3 — Three agents, three evidence windows (0:55–1:25)

**On screen:** ATC, Pilot, and Ground agents exchange proposals; show each agent’s domain-only view.

**Say:**  
“This is not one prompt pretending to be three experts. ATC sees arrival sequencing and runway limits. Pilot sees fuel and turbulence constraints, not gates or crew. Ground sees gates and shift limits, not fuel. They rank, accept, reject, and counter-propose using a shared set of options, while keeping their evidence separate.”

## Slide 4 — Code has the veto, and the final word is human (1:25–1:55)

**On screen:** Candidate options → deterministic validators → consensus log → duty-manager approval.

**Say:**  
“The agents never decide what is legal. Code enumerates the arrival slots, gates, and divert option, then checks wake separation, capacity, closures, taxiway, fuel reserve, turbulence, and gate conflicts. Every proposal is revalidated. Negotiation stops after three rounds; illegal options are vetoed, and the L0-to-L3 fallback ladder is explicit in the log. A duty manager reviews and approves the final plan.”

## Slide 5 — Measure the behavior, not the hype (1:55–2:30)

**On screen:** Batch results with sample size, model/mode, and synthetic-data label visible.

**Say:**  
“Our batch runner measures consensus, latency, validator vetoes, and unsafe accepted plans across Routine, Weather, and synthetic Emergency cases. For the demo run, the current figures are **{{ROUTINE_CONSENSUS}}** routine consensus, **{{WEATHER_CONSENSUS}}** weather consensus, **{{EMERGENCY_CONSENSUS}}** emergency consensus, and **{{BATCH_LATENCY}}** batch latency. These are modeled scenario results, not measured airport outcomes.”

## Slide 6 — A safety layer, not autonomous ATC (2:30–3:00)

**On screen:** Hash-chained decision record and the human Approve button.

**Say:**  
“The need is real: the FAA receives more than 100 drone-sighting reports near airports per month. Killswitch is a transparent coordination layer for disruption—not autonomous air traffic control. Agents negotiate, code enforces safety, and a person approves. Our next step is testing with operational stakeholders and real, authorized airport feeds.”

**Close:** “When the plan changes, keep the safety rules fixed—and keep a human in command.”

## Honest Evaluation

- On routine scenarios, negotiated choices are close to standard FCFS behavior: the earliest legal slot often also minimizes the modeled hold, connection, and overtime costs. We do not claim broad routine scheduling superiority over FCFS.
- In the initial offline batch of 50 seeded scenarios per subsystem, the **uncoordinated silo baseline** had at least one cross-domain constraint violation in 98% of Routine, 76% of Weather, and 98% of Emergency cases. These figures describe modeled scenarios; they are not observed incident rates or a measured reduction in accidents.
- The validator-checked negotiated path accepted zero plans that failed its checks in that batch. The violation categories include gate conflicts; the 76%–98% rates must not be presented as “catastrophic fuel/turbulence violations prevented.”
- These results do not mean “without human intervention.” The duty manager remains responsible for final approval. The system demonstrates bounded agent negotiation under deterministic checks, with escalation when no feasible plan exists.

**Before presenting:** Replace the four slide-5 placeholders with values from the same batch run. State the row count, offline/live mode, model (when live), and that the airport state and impact metrics are modeled/synthetic.
