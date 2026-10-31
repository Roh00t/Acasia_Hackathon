"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_URL, approveRun, getHealth, listScenarios, startRun, type Health } from "@/lib/api";
import { AGENT_COLOR, AGENTS, type AgentMessage, type CandidateSummary, type Run, type StoryChapter, type Subsystem } from "@/lib/types";
import { CandidateGrid } from "@/components/console/CandidateGrid";
import { HashChain, PlanTable, agentFacts } from "@/components/console/RunParts";

// ---------------------------------------------------------------- plain-language helpers

const LEVEL_WORDS: Record<string, string> = {
  L0: "Agents agreed (LLM agents)",
  L1: "Agents agreed (rule agents: offline mode, or standing in for a failed LLM reply)",
  L2: "No agreement in 3 rounds: code picked the lowest-cost legal plan",
  L3: "Nothing legal: escalated to the duty manager",
};
const LADDER: [string, string][] = [
  ["L0", "LLM agents agree"],
  ["L1", "rule agents agree (offline, or standing in)"],
  ["L2", "no agreement: deterministic pick"],
  ["L3", "nothing legal: a person decides"],
];
const SYNTHETIC_LABEL: Record<string, string> = {
  runway: "Runway", arrival_cap: "Arrival cap", queue: "Traffic queue", wake: "Wake category", fuel: "Fuel on board",
  alternate_time: "Alternate airport time", turbulence: "Turbulence", connections: "Passenger connections",
  gates: "Gate occupancy", crew_shift: "Crew shift", turnaround: "Turnaround time", taxiway_block: "Taxiway block",
  runway_closure: "Runway closure", equipment_failure: "Equipment failure",
};
const DISRUPTIONS: { key: Subsystem; title: string; line: string }[] = [
  { key: "ROUTINE", title: "Routine", line: "A late inbound aircraft and a failed jet bridge. Real row with LATE_AIRCRAFT_DELAY > 20." },
  { key: "WEATHER", title: "Weather", line: "A storm cuts the arrival rate. Real row with WEATHER_DELAY > 15." },
  { key: "EMERGENCY", title: "Emergency", line: "A drone closes the runway (synthetic) on top of a real row." },
];
const PROGRESS = ["Round 1: agents ranking the legal options…", "Round 2: coordinator proposes, agents respond…",
  "Round 3 if needed: counter-offers…", "Validators re-checking the chosen plan…"];

function addMin(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const tot = (h * 60 + m + Math.round(minutes) + 1440) % 1440;
  return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
}

/** "S04-A2" → "Land T+4 (21:54) · Gate A2"; "DIVERT-ACT" → "Divert to ACT". */
function optionWords(id: string | null | undefined, t0: string) {
  if (!id) return "—";
  if (id.startsWith("DIVERT-")) return `Divert to ${id.slice(7)}`;
  const m = id.match(/^S(\d+)-(A\d+)$/);
  if (!m) return id;
  const t = Number(m[1]);
  return `Land T+${t} (${addMin(t0, t)}) · Gate ${m[2]}`;
}

function pickOne<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function firstSentence(text: string) {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : text;
}

function Badge({ kind }: { kind: "REAL" | "SYNTHETIC" | "MODELLED" }) {
  const color = { REAL: "var(--color-ok)", SYNTHETIC: "var(--color-pilot)", MODELLED: "var(--color-muted)" }[kind];
  return (
    <span className="ml-2 inline-block rounded-sm border px-1.5 align-middle font-mono text-[11px] tracking-[0.12em]" style={{ color, borderColor: color }}>
      {kind}
    </span>
  );
}

function Section({ step, title, children, aside }: { step: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border bg-slate/60 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl tracking-tight"><span className="label mr-2">{step}</span>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function AgentCard({ m, t0, facts }: { m: AgentMessage; t0: string; facts: string[] }) {
  const tone = m.decision === "ACCEPT" ? "text-ok" : m.decision === "REJECT" ? "text-crimson" : "text-primary";
  const headline = m.decision === "RANK" ? `Prefers ${optionWords(m.ranking[0], t0)}` : m.decision === "ACCEPT" ? "Accepts" : "Rejects";
  return (
    <div className="min-w-0 border-l-4 bg-carbon/70 p-3" style={{ borderColor: AGENT_COLOR[m.agent] }}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-sm tracking-[0.15em]" style={{ color: AGENT_COLOR[m.agent] }}>{m.agent}</span>
        <span className="label">{m.level === "L0" ? "LLM" : "rule agent"}</span>
      </div>
      <div className={`mt-1 text-lg ${tone}`}>{headline}</div>
      {m.counter && <div className="text-base text-pilot">Counter: {optionWords(m.counter, t0)}</div>}
      <p className="mt-1 text-base leading-snug text-primary/85">{firstSentence(m.reason)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="border px-1.5 font-mono text-[11px] text-muted">{m.reason_code}</span>
        {m.meta?.unverified_numbers && m.meta.unverified_numbers.length > 0 && (
          <span className="border border-pilot px-1.5 font-mono text-[11px] text-pilot">flagged: {m.meta.unverified_numbers.join(", ")}</span>
        )}
      </div>
      {m.meta?.fallback_reason && (
        <p className="mt-1 text-sm text-crimson" title={m.meta.fallback_reason}>
          {/Timeout|timed out/i.test(m.meta.fallback_reason)
            ? "Claude agent timed out; deterministic rule agent took over."
            : /Skipped/.test(m.meta.fallback_reason)
              ? "Claude unreachable earlier in this run; deterministic rule agent took over."
              : "Claude agent failed; deterministic rule agent took over."}
          <span className="ml-1 font-mono text-[11px] text-muted">{m.meta.fallback_reason.slice(0, 80)}</span>
        </p>
      )}
      {facts.length > 0 && <div className="mt-1 font-mono text-[11px] text-muted">checked: {facts.join(" · ")}</div>}
    </div>
  );
}

const TABS = ["Candidate grid", "Legal options", "Agent inputs", "Consensus log", "Flags", "Baselines", "Raw JSON"] as const;

function Evidence({ run }: { run: Run }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Candidate grid");
  const s = run.scenario;
  const t0 = s.t0_clock;
  const silo = run.outcome.baseline_uncoordinated;
  const flags = run.rounds.flatMap((r) => r.messages.filter((m) => m.meta?.unverified_numbers?.length).map((m) => ({ r: r.round, m })));
  return (
    <details className="border bg-slate/40">
      <summary className="cursor-pointer select-none p-4 text-lg">
        Evidence <span className="label ml-2">validators · agent inputs · log · raw data</span>
      </summary>
      <div className="border-t p-4">
        <div className="mb-4 flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`border px-2.5 py-1 font-mono text-xs ${tab === t ? "border-primary text-primary" : "text-muted"}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === "Candidate grid" && (
          <div>
            <p className="mb-2 text-base text-muted">{run.candidates.feasible} of {run.candidates.total} options passed every validator. Vetoed options are struck out.</p>
            <CandidateGrid run={run} highlight={run.outcome.candidate?.id} />
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(run.candidates.fail_counts).map(([c, n]) => <span key={c} className="border px-2 font-mono text-xs text-muted">{c} × {n}</span>)}
            </div>
          </div>
        )}
        {tab === "Legal options" && (
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="label py-1 font-normal">Option</th>{AGENTS.map((a) => <th key={a} className="py-1 text-right font-mono text-xs" style={{ color: AGENT_COLOR[a] }}>{a} cost</th>)}<th className="label py-1 text-right font-normal">Total</th></tr></thead>
            <tbody>
              {run.candidates.feasible_list.slice(0, 12).map((c) => (
                <tr key={c.id} className={`border-t ${c.id === run.outcome.candidate?.id ? "text-ok" : ""}`}>
                  <td className="py-1">{optionWords(c.id, t0)} <span className="font-mono text-[11px] text-muted">{c.id}</span></td>
                  {AGENTS.map((a) => <td key={a} className="py-1 text-right font-mono">{c.costs[a]}</td>)}
                  <td className="py-1 text-right font-mono">{c.total_cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "Agent inputs" && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border-l-4 p-3" style={{ borderColor: AGENT_COLOR.ATC }}>
              <div className="font-mono text-sm" style={{ color: AGENT_COLOR.ATC }}>ATC sees</div>
              <p className="mt-1 text-sm text-muted">Runway {s.runway.name}, arrival cap {s.runway.arrival_cap_per_hr}/hr, {s.runway.queue.length} other arrivals, closures and taxiway blocks. Per option: load, knock-on, wake margin.</p>
            </div>
            <div className="border-l-4 p-3" style={{ borderColor: AGENT_COLOR.PILOT }}>
              <div className="font-mono text-sm" style={{ color: AGENT_COLOR.PILOT }}>PILOT sees</div>
              <p className="mt-1 text-sm text-muted">Fuel {s.flight.fuel_endurance_min} min, reserve {s.flight.reserve_min} min, alternate {s.flight.alternate}, {s.flight.connections.length} connections. Per option: hold, fuel margin, turbulence, missed passengers. <strong className="text-primary">Never gates or crew.</strong></p>
            </div>
            <div className="border-l-4 p-3" style={{ borderColor: AGENT_COLOR.GROUND }}>
              <div className="font-mono text-sm" style={{ color: AGENT_COLOR.GROUND }}>GROUND sees</div>
              <p className="mt-1 text-sm text-muted">Planned gate {s.ground.planned_gate}, turnaround {s.ground.turnaround_min} min, crew shift to T+{s.ground.crew_shift_end}{s.ground.equipment_failure ? `, ${s.ground.equipment_failure.equipment} failed at ${s.ground.equipment_failure.gate}` : ""}. Per option: overtime, gate change, next-departure delay. <strong className="text-primary">Never fuel.</strong></p>
            </div>
          </div>
        )}
        {tab === "Consensus log" && (
          <div>
            <p className="mb-2 text-base text-muted">{run.log.length} entries, each carrying the digest of the one before. Editing any line breaks the chain.</p>
            <HashChain run={run} max={30} />
          </div>
        )}
        {tab === "Flags" && (
          flags.length ? (
            <ul className="space-y-1 text-base">
              {flags.map(({ r, m }, i) => (
                <li key={i}><span style={{ color: AGENT_COLOR[m.agent] }}>{m.agent}</span> round {r}: quoted {m.meta!.unverified_numbers!.join(", ")}, which are not in the data it was shown. The plan is still re-checked by code.</li>
              ))}
            </ul>
          ) : <p className="text-base text-muted">No agent quoted a number that is missing from its data.</p>
        )}
        {tab === "Baselines" && (
          <div>
            <PlanTable plans={[
              { label: "Negotiated", c: run.outcome.candidate },
              { label: "FCFS", c: run.outcome.baseline_fcfs },
              { label: "Each acting alone", c: silo ?? null, note: silo ? Object.values(silo.violations).map((v) => v.code).join(", ") || "none" : undefined },
            ]} />
            {silo && Object.keys(silo.violations).length > 0 && (
              <p className="mt-2 text-base text-muted">
                Rules broken if each organisation acted alone: {Object.values(silo.violations).map((v) => v.detail).join("; ")}.
              </p>
            )}
          </div>
        )}
        {tab === "Raw JSON" && (
          <pre className="max-h-96 overflow-auto bg-carbon p-3 font-mono text-[11px] text-muted">{JSON.stringify({ ...run, log: `${run.log.length} entries` }, null, 2)}</pre>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- page

export default function ConsolePage() {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [live, setLive] = useState(false);
  const [inject, setInject] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [replay, setReplay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shown, setShown] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getHealth().then(setHealth);
  }, []);
  const offlineApi = health === null;

  async function go(kind: Subsystem | "RANDOM") {
    setBusy(true);
    setError(null);
    setProgress(0);
    timer.current = setInterval(() => setProgress((p) => Math.min(p + 1, PROGRESS.length - 1)), live ? 5000 : 400);
    try {
      let rowId: number | null = null;
      if (kind === "ROUTINE" || kind === "WEATHER") {
        const rows = await listScenarios(kind, 200);
        rowId = pickOne(rows).ROW_ID;
      }
      const r = await startRun({ row_id: rowId, emergency: kind === "EMERGENCY", live, inject_unsafe: inject });
      setRun(r);
      setReplay(false);
      setShown(1);
    } catch (e) {
      setError(`The run failed: ${String(e)}. Untick "Live Claude agents" to use the offline rule agents.`);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }

  async function replaySaved(key: "s1" | "s2" | "s3") {
    const res = await fetch(`/story/${key}.json`);
    const ch = (await res.json()) as StoryChapter;
    setRun(ch.live);
    setReplay(true);
    setShown(1);
  }

  async function decide(decision: "APPROVE" | "OVERRIDE") {
    if (!run) return;
    if (decision === "OVERRIDE" && !note.trim()) {
      setError("Add a note saying why you are rejecting the plan.");
      return;
    }
    if (replay) {
      setRun({ ...run, approval: { approver: "Station duty manager", decision, note: note.trim() } });
      return;
    }
    try {
      const res = await approveRun(run.run_id, decision, note.trim());
      const entry = res.entry as Run["log"][number];
      setRun({ ...run, chain_valid: res.chain_valid, chain_head: entry.hash,
               approval: { approver: "Station duty manager", decision, note: note.trim() }, log: [...run.log, entry] });
      setNote("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const s = run?.scenario;
  const o = run?.outcome;
  const t0 = s?.t0_clock ?? "00:00";
  const chosen: CandidateSummary | null | undefined = o?.candidate;
  const rounds = run?.rounds ?? [];

  return (
    <main className="mx-auto max-w-[78rem] px-5 py-6 text-base">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="label">Station duty manager console</div>
          <h1 className="text-3xl tracking-tight">Live negotiation</h1>
        </div>
        <div className="flex items-center gap-3">
          {health && (
            <span className="border px-2 py-1 font-mono text-xs" style={{ color: live ? "var(--color-ok)" : "var(--color-pilot)", borderColor: "currentColor" }}>
              {live ? `LIVE · ${health.model}` : "OFFLINE · rule agents"}
            </span>
          )}
          {offlineApi && <span className="border border-pilot px-2 py-1 font-mono text-xs text-pilot">REPLAY · saved real runs</span>}
          <Link href="/" className="label hover:text-primary">← Story</Link>
        </div>
      </header>

      <div className="mt-5 space-y-5">
        <Section step="1" title="Pick a disruption" aside={<span className="label">How to read this: situation → outcome → the negotiation that produced it</span>}>
          {offlineApi ? (
            <div>
              <p className="mb-3 text-base text-pilot">
                The live negotiation API isn&apos;t connected here ({API_URL}). Replay one of the real saved runs instead;
                to run live, start the API with <code className="font-mono text-sm">uv run uvicorn atm.api:app --port 8010</code>.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {(["s1", "s2", "s3"] as const).map((k, i) => (
                  <button key={k} onClick={() => replaySaved(k)} className="border p-4 text-left hover:border-primary">
                    <div className="text-xl">{DISRUPTIONS[i].title}</div>
                    <div className="mt-1 text-sm text-muted">{DISRUPTIONS[i].line}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="grid gap-3 md:grid-cols-3">
                {DISRUPTIONS.map((d) => (
                  <button key={d.key} disabled={busy || health === undefined} onClick={() => go(d.key)}
                    className="border p-4 text-left hover:border-primary disabled:opacity-50">
                    <div className="text-xl">{d.title}</div>
                    <div className="mt-1 text-sm text-muted">{d.line}</div>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <button disabled={busy || health === undefined} onClick={() => go("RANDOM")} className="border border-atc px-3 py-1.5 font-mono text-sm text-atc disabled:opacity-50">Random row</button>
                <label className="flex items-center gap-2 text-sm">
                  <input id="live" type="checkbox" checked={live} disabled={!health?.live_available} onChange={(e) => setLive(e.target.checked)} />
                  Live Claude agents {health && !health.live_available && <span className="text-muted">(not enabled on this deployment)</span>}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input id="inject" type="checkbox" checked={inject} onChange={(e) => setInject(e.target.checked)} />
                  Red team: Pilot pushes an unsafe hold
                </label>
              </div>
              {busy && <p className="mt-3 font-mono text-base text-atc" aria-live="polite">{PROGRESS[progress]}</p>}
            </div>
          )}
          {error && <p className="mt-3 text-base text-crimson">{error}</p>}
        </Section>

        {run && s && o && (
          <>
            <Section step="2" title="The situation">
              <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
                <div>
                  <div className="font-mono text-2xl">
                    {String(s.row.AIRLINE)}{String(s.row.FLIGHT_NUMBER)} · {String(s.row.ORIGIN_AIRPORT)} → {String(s.row.DESTINATION_AIRPORT)}<Badge kind="REAL" />
                  </div>
                  <p className="mt-1 text-base text-muted">
                    2015-{String(s.row.MONTH).padStart(2, "0")}-{String(s.row.DAY).padStart(2, "0")} · arrival delay {String(s.row.ARRIVAL_DELAY)} min
                    (weather {String(s.row.WEATHER_DELAY)}, late aircraft {String(s.row.LATE_AIRCRAFT_DELAY)}) · US DOT row {s.row_id}
                  </p>
                </div>
                <div>
                  <div className="label">What went wrong<Badge kind="SYNTHETIC" /></div>
                  <p className="mt-1 text-base">{s.narrative.replace(/^SYNTHETIC: /, "")}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="label mr-1">Generated from the row:</span>
                {s.synthetic.map((k) => <span key={k} className="border px-2 py-0.5 text-xs text-muted">{SYNTHETIC_LABEL[k] ?? k}</span>)}
              </div>
            </Section>

            <Section step="3" title="The outcome" aside={
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {LADDER.map(([l, w]) => <span key={l} className={`label ${l === o.level ? "text-primary" : ""}`}>{l} {w}</span>)}
              </div>
            }>
              <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
                <div>
                  <div className="text-3xl tracking-tight">{chosen ? optionWords(chosen.id, t0) : "Escalated: no legal plan"}</div>
                  <div className="mt-1 text-lg" style={{ color: o.level === "L2" ? "var(--color-pilot)" : o.level === "L3" ? "var(--color-crimson)" : "var(--color-ok)" }}>
                    {o.level}: {LEVEL_WORDS[o.level]} · {o.rounds_used} round{o.rounds_used === 1 ? "" : "s"}
                  </div>
                  {run.vetoes.length > 0 && (
                    <p className="mt-2 text-base text-crimson">
                      {run.vetoes.length} unsafe suggestion{run.vetoes.length === 1 ? "" : "s"} vetoed by the validators, e.g. {run.vetoes[0].agent} pushed {optionWords(run.vetoes[0].candidate, t0)}: {Object.values(run.vetoes[0].failed)[0]?.detail}.
                    </p>
                  )}
                </div>
                {chosen && (
                  <div className="grid grid-cols-3 gap-3">
                    {[["Holding", `${chosen.metrics.hold_min} min`], ["Extra fuel", `${chosen.metrics.fuel_hold_kg} kg`], ["Missed connections", `${chosen.metrics.missed_pax}`]].map(([k, v]) => (
                      <div key={k}><div className="label">{k}<Badge kind="MODELLED" /></div><div className="mt-1 font-mono text-2xl">{v}</div></div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {run.approval ? (
                  <span className={`text-lg ${run.approval.decision === "APPROVE" ? "text-ok" : "text-pilot"}`}>
                    {run.approval.decision === "APPROVE" ? "Approved" : "Rejected"} by the duty manager{replay ? " (replay, not logged)" : " · logged in the chain"}{run.approval.note ? `: ${run.approval.note}` : ""}
                  </span>
                ) : chosen ? (
                  <>
                    <button onClick={() => decide("APPROVE")} className="border border-ok px-4 py-2 text-lg text-ok">Approve plan</button>
                    <input id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason to reject (required)"
                      className="min-w-0 flex-1 border bg-carbon px-3 py-2 text-base" />
                    <button onClick={() => decide("OVERRIDE")} className="border border-pilot px-4 py-2 text-lg text-pilot">Reject</button>
                  </>
                ) : (
                  <span className="text-lg text-crimson">Nothing to approve. Decide with ATC outside the system.</span>
                )}
              </div>
            </Section>

            <Section step="4" title="The negotiation" aside={
              <div className="flex gap-2">
                <button disabled={shown >= rounds.length} onClick={() => setShown((n) => Math.min(rounds.length, n + 1))}
                  className="border px-3 py-1 font-mono text-sm disabled:opacity-40">Next round</button>
                <button disabled={shown >= rounds.length} onClick={() => setShown(rounds.length)}
                  className="border px-3 py-1 font-mono text-sm disabled:opacity-40">Play all</button>
              </div>
            }>
              <ol className="space-y-4">
                {rounds.slice(0, shown).map((r) => (
                  <li key={r.round}>
                    <div className="label mb-1">
                      Round {r.round} · {r.proposal ? `coordinator proposes ${optionWords(r.proposal.id, t0)}` : "each agent ranks the legal options"}
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {r.messages.map((m) => {
                        const subj = r.proposal ?? run.candidates.feasible_list.find((c) => c.id === m.ranking[0]) ?? null;
                        return <AgentCard key={m.agent} m={m} t0={t0} facts={agentFacts(m.agent, subj)} />;
                      })}
                    </div>
                    {run.vetoes.filter((v) => v.round === r.round).map((v, i) => (
                      <div key={i} className="mt-2 border border-crimson/60 bg-crimson/10 p-2 text-sm text-crimson">
                        Vetoed: {v.agent} named {optionWords(v.candidate, t0)}. {Object.values(v.failed).map((c) => c.detail).join("; ")}
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
              {shown < rounds.length && <p className="mt-3 label">{rounds.length - shown} more round{rounds.length - shown === 1 ? "" : "s"}: press Next round</p>}
            </Section>

            <Evidence run={run} />
          </>
        )}
      </div>
    </main>
  );
}
