// Small presentational pieces shared by the scroll story and the live console.
import { AGENT_COLOR, LEVEL_TEXT, type AgentMessage, type CandidateSummary, type Run } from "@/lib/types";

export function AgentTag({ agent }: { agent: AgentMessage["agent"] }) {
  return (
    <span className="font-mono text-xs tracking-telemetry" style={{ color: AGENT_COLOR[agent] }}>
      {agent}
    </span>
  );
}

// The validator-computed numbers each organisation cares about, so the duty manager
// reads code-checked figures beside the agent's prose (OWASP LLM09).
const FACTS: Record<AgentMessage["agent"], [string, string, string][]> = {
  ATC: [["knock_on_min", "knock-on", "min"], ["wake_margin_min", "wake margin", "min"], ["window_load", "load", "× cap"]],
  PILOT: [["fuel_margin_min", "fuel margin", "min"], ["hold_min", "hold", "min"], ["turbulence", "turbulence", ""], ["missed_pax", "missed", "pax"]],
  GROUND: [["overtime_min", "overtime", "min"], ["gate_change", "gate change", ""], ["departure_delay_min", "next dep. delay", "min"]],
};

export function agentFacts(agent: AgentMessage["agent"], c: CandidateSummary | null | undefined): string[] {
  if (!c) return [];
  return FACTS[agent]
    .filter(([k]) => c.metrics[k] !== undefined)
    .map(([k, label, unit]) => `${label} ${c.metrics[k]}${unit ? ` ${unit}` : ""}`);
}

/** The candidate a message is about: the proposal it answers, or its top-ranked pick. */
export function messageSubject(run: Run, m: AgentMessage, proposal: CandidateSummary | null): CandidateSummary | null {
  if (proposal) return proposal;
  return run.candidates.feasible_list.find((c) => c.id === m.ranking[0]) ?? null;
}

export function MessageCard({ m, facts = [], subject }: { m: AgentMessage; facts?: string[]; subject?: string | null }) {
  const tone = m.decision === "ACCEPT" ? "text-ok" : m.decision === "REJECT" ? "text-crimson" : "text-primary";
  return (
    <div className="border-l-2 bg-slate/80 px-3 py-2" style={{ borderColor: AGENT_COLOR[m.agent] }}>
      <div className="flex items-center justify-between gap-2">
        <AgentTag agent={m.agent} />
        <span className="label">{m.level === "L0" ? "LLM" : "rule"}</span>
      </div>
      <div className={`mt-1 font-mono text-sm ${tone}`}>
        {m.decision} <span className="text-muted">· {m.reason_code}</span>
      </div>
      {m.decision === "RANK" && m.ranking.length > 0 && (
        <div className="mt-1 font-mono text-xs text-muted">top: {m.ranking.slice(0, 3).join(", ")}</div>
      )}
      {m.counter && <div className="mt-1 font-mono text-xs text-pilot">counter → {m.counter}</div>}
      <p className="mt-1 text-xs leading-snug text-muted">{m.reason}</p>
      {facts.length > 0 && (
        <div className="mt-2 border-t pt-1 font-mono text-[10px] text-primary/80" title="Computed by the validators, not by the agent">
          <span className="text-muted">checked{subject ? ` · ${subject}` : ""}: </span>{facts.join(" · ")}
        </div>
      )}
      {m.meta?.unverified_numbers && m.meta.unverified_numbers.length > 0 && (
        <div className="mt-1 font-mono text-[10px] text-pilot">
          Not in this agent&apos;s data: {m.meta.unverified_numbers.join(", ")}. Trust the checked numbers.
        </div>
      )}
      {m.meta?.fallback_reason && (
        <div className="mt-1 font-mono text-[10px] text-crimson" title={m.meta.fallback_reason}>
          LLM reply rejected, rule agent stood in: {m.meta.fallback_reason.slice(0, 90)}
        </div>
      )}
    </div>
  );
}

const METRIC_LABEL: Record<string, string> = {
  hold_min: "Hold (min)",
  fuel_hold_kg: "Extra fuel (kg)",
  missed_pax: "Missed connections (pax)",
  overtime_min: "Crew overtime (min)",
  gate_change: "Gate change",
  departure_delay_min: "Next departure delay (min)",
  knock_on_min: "Knock-on to others (min)",
};

export function PlanTable({ plans }: { plans: { label: string; c: CandidateSummary | null; note?: string }[] }) {
  const keys = Object.keys(METRIC_LABEL);
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="text-left">
          <th className="label py-1 font-normal">Modelled</th>
          {plans.map((p) => (
            <th key={p.label} className="label py-1 text-right font-normal">{p.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t">
          <td className="py-1 text-muted">Plan</td>
          {plans.map((p) => (
            <td key={p.label} className="py-1 text-right">{p.c?.id ?? "—"}</td>
          ))}
        </tr>
        {keys.map((k) => (
          <tr key={k} className="border-t">
            <td className="py-1 text-muted">{METRIC_LABEL[k]}</td>
            {plans.map((p) => (
              <td key={p.label} className="py-1 text-right">{p.c?.metrics[k] ?? "—"}</td>
            ))}
          </tr>
        ))}
        {plans.some((p) => p.note) && (
          <tr className="border-t">
            <td className="py-1 text-muted">Breaks</td>
            {plans.map((p) => (
              <td key={p.label} className="py-1 text-right text-crimson">{p.note ?? ""}</td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function LevelBadge({ run }: { run: Run }) {
  const o = run.outcome;
  const color = o.level === "L3" ? "var(--color-crimson)" : o.level === "L2" ? "var(--color-pilot)" : "var(--color-ok)";
  return (
    <div className="inline-flex items-center gap-2 border px-2 py-1" style={{ borderColor: color }}>
      <span className="font-mono text-sm" style={{ color }}>{o.level}</span>
      <span className="text-xs text-primary">{LEVEL_TEXT[o.level]}</span>
      <span className="label">· {o.rounds_used} round{o.rounds_used === 1 ? "" : "s"}</span>
    </div>
  );
}

export function HashChain({ run, max = 12 }: { run: Run; max?: number }) {
  const entries = run.log.slice(-max);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map((e, i) => (
        <div key={e.seq} className="flex items-center gap-1">
          <div className="border bg-slate px-1.5 py-0.5 font-mono text-[10px]" title={`${e.kind} ${e.sender}\nprev ${e.prev_hash}\nhash ${e.hash}`}>
            <span className={e.kind === "VETO" ? "text-crimson" : e.kind === "APPROVAL" ? "text-ok" : "text-muted"}>{e.kind}</span>{" "}
            {e.hash.slice(0, 6)}
          </div>
          {i < entries.length - 1 && <span className="text-muted">→</span>}
        </div>
      ))}
      <span className={`label ml-2 ${run.chain_valid ? "text-ok" : "text-crimson"}`}>
        chain {run.chain_valid ? "valid" : "BROKEN"}
      </span>
      {run.chain_alg && (
        <span className="label ml-2" title={run.chain_head}>
          {run.chain_alg === "hmac-sha256" ? "HMAC-keyed" : "unkeyed SHA-256"} · head {run.chain_head?.slice(0, 10)}
        </span>
      )}
    </div>
  );
}

export function SyntheticNote({ run }: { run: Run }) {
  return (
    <p className="label mt-3">
      Synthetic, seeded from the row: {run.scenario.synthetic.join(", ")}
    </p>
  );
}
