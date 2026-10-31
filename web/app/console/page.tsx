"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { approveRun, listScenarios, startRun, API_URL, type ScenarioRow } from "@/lib/api";
import { AGENTS, type Run } from "@/lib/types";
import { CandidateGrid } from "@/components/console/CandidateGrid";
import { AgentTag, HashChain, LevelBadge, MessageCard, PlanTable, SyntheticNote, agentFacts, messageSubject } from "@/components/console/RunParts";

export default function ConsolePage() {
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [rowId, setRowId] = useState<number | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [live, setLive] = useState(false);
  const [inject, setInject] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    listScenarios().then(setRows).catch(() => setError(`Backend not reachable at ${API_URL}. Start it with: uv run uvicorn atm.api:app --port 8010`));
  }, []);

  async function go(random = false) {
    setBusy(true);
    setError(null);
    try {
      setRun(await startRun({ row_id: random ? null : rowId, emergency, live, inject_unsafe: inject }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "APPROVE" | "OVERRIDE") {
    if (!run) return;
    if (decision === "OVERRIDE" && !note.trim()) {
      setError("Add a note saying why you are overriding the plan.");
      return;
    }
    try {
      const res = await approveRun(run.run_id, decision, note.trim());
      const entry = res.entry as Run["log"][number];
      setRun({ ...run, chain_valid: res.chain_valid, chain_head: entry.hash,
               approval: { approver: "Station duty manager", decision, note: note.trim() },
               log: [...run.log, entry] });
      setNote("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const s = run?.scenario;
  const silo = run?.outcome.baseline_uncoordinated;

  return (
    <main className="mx-auto max-w-frame px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="label">Duty manager console</div>
          <h1 className="text-2xl tracking-tight">Live negotiation</h1>
        </div>
        <Link href="/" className="label hover:text-primary">← Story</Link>
      </header>

      <section className="mt-4 flex flex-wrap items-end gap-3 border bg-slate p-3">
        <label className="flex flex-col gap-1">
          <span className="label">DOT row</span>
          <select
            className="border bg-carbon px-2 py-1 font-mono text-xs"
            value={rowId ?? ""}
            onChange={(e) => setRowId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Pick a row…</option>
            {rows.map((r) => (
              <option key={r.ROW_ID} value={r.ROW_ID}>
                {r.ROW_ID} · {r.AIRLINE}{r.FLIGHT_NUMBER} {r.ORIGIN_AIRPORT}→{r.DESTINATION_AIRPORT} · wx {r.WEATHER_DELAY} / late {r.LATE_AIRCRAFT_DELAY}
              </option>
            ))}
          </select>
        </label>
        {[
          ["Drone emergency (synthetic)", emergency, setEmergency],
          ["Live Claude agents", live, setLive],
          ["Inject unsafe Pilot", inject, setInject],
        ].map(([label, val, set]) => (
          <label key={label as string} className="flex items-center gap-2 font-mono text-xs">
            <input type="checkbox" checked={val as boolean} onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} />
            {label as string}
          </label>
        ))}
        <button disabled={busy || !rowId} onClick={() => go(false)} className="border border-primary px-3 py-1 font-mono text-xs disabled:opacity-40">
          Run row
        </button>
        <button disabled={busy} onClick={() => go(true)} className="border border-atc px-3 py-1 font-mono text-xs text-atc disabled:opacity-40">
          Random row
        </button>
        {busy && <span className="label">negotiating…</span>}
      </section>
      {error && <p className="mt-3 font-mono text-xs text-crimson">{error}</p>}

      {run && s && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <div className="border p-4">
              <div className="label">Row {s.row_id} · {s.subsystem} · T0 {s.t0_clock} local · run {run.run_id} · {run.mode}</div>
              <div className="mt-1 font-mono text-lg">
                {String(s.row.AIRLINE)}{String(s.row.FLIGHT_NUMBER)} {String(s.row.ORIGIN_AIRPORT)} → {String(s.row.DESTINATION_AIRPORT)}
              </div>
              <p className="mt-2 text-sm">{s.narrative}</p>
              <SyntheticNote run={run} />
            </div>
            <div className="border p-4">
              <div className="label mb-2">
                Validators · {run.candidates.feasible}/{run.candidates.total} legal ·{" "}
                {Object.entries(run.candidates.fail_counts).map(([k, v]) => `${k} ${v}`).join(" · ")}
              </div>
              <CandidateGrid run={run} highlight={run.outcome.candidate?.id} />
            </div>
            <div className="border p-4">
              <div className="label mb-2">Legal options, lowest total cost first</div>
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="label font-normal">Option</th>
                    {AGENTS.map((a) => <th key={a} className="text-right font-normal"><AgentTag agent={a} /></th>)}
                    <th className="label text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {run.candidates.feasible_list.slice(0, 10).map((c) => (
                    <tr key={c.id} className={`border-t ${c.id === run.outcome.candidate?.id ? "text-ok" : ""}`}>
                      <td className="py-1">{c.id}</td>
                      {AGENTS.map((a) => <td key={a} className="text-right">{c.costs[a]}</td>)}
                      <td className="text-right">{c.total_cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            {run.rounds.map((r) => (
              <div key={r.round}>
                <div className="label mb-1">
                  Round {r.round}{r.proposal ? ` · coordinator proposes ${r.proposal.id}` : " · rank and red lines"}
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  {r.messages.map((m) => {
                    const subject = messageSubject(run, m, r.proposal);
                    return <MessageCard key={m.agent} m={m} facts={agentFacts(m.agent, subject)} subject={subject?.id} />;
                  })}
                </div>
              </div>
            ))}
            {run.vetoes.map((v, i) => (
              <div key={i} className="border border-crimson/60 bg-crimson/10 p-2 font-mono text-xs text-crimson">
                VETO R{v.round}: {v.agent} named {v.candidate} → {Object.entries(v.failed).map(([d, c]) => `${d} ${c.code}: ${c.detail}`).join("; ")}
              </div>
            ))}
            <div className="border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <LevelBadge run={run} />
                {run.stand_ins > 0 && <span className="label text-pilot">{run.stand_ins} LLM reply(ies) replaced by rule policy</span>}
              </div>
              <p className="mt-2 text-sm text-muted">{run.outcome.action}</p>
              <div className="mt-3">
                <PlanTable
                  plans={[
                    { label: "Negotiated", c: run.outcome.candidate },
                    { label: "FCFS", c: run.outcome.baseline_fcfs },
                    { label: "Siloed today", c: silo ?? null, note: silo ? Object.values(silo.violations).map((v) => v.code).join(", ") || "none" : undefined },
                  ]}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {run.approval ? (
                  <span className={`font-mono text-sm ${run.approval.decision === "APPROVE" ? "text-ok" : "text-pilot"}`}>
                    {run.approval.decision} by {run.approval.approver} (logged){run.approval.note ? `: ${run.approval.note}` : ""}
                  </span>
                ) : !run.outcome.candidate ? (
                  <span className="font-mono text-sm text-crimson">
                    Escalated: no legal plan to approve. Decide with ATC outside the system.
                  </span>
                ) : (
                  <>
                    <button onClick={() => decide("APPROVE")} className="border border-ok px-3 py-1 font-mono text-xs text-ok">Approve plan</button>
                    <input
                      id="override-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Override note (required)"
                      className="min-w-0 flex-1 border bg-carbon px-2 py-1 font-mono text-xs"
                    />
                    <button onClick={() => decide("OVERRIDE")} className="border border-pilot px-3 py-1 font-mono text-xs text-pilot">Override</button>
                  </>
                )}
              </div>
            </div>
            <div className="border p-4">
              <div className="label mb-2">Consensus log · {run.log.length} entries · {run.chain_alg === "hmac-sha256" ? "HMAC-SHA256" : "SHA-256"} chained</div>
              <HashChain run={run} max={20} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
