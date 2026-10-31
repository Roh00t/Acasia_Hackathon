// Small presentational pieces shared by the scroll story and the live console.
import { AGENT_COLOR, LEVEL_TEXT, type AgentMessage, type CandidateSummary, type Run } from "@/lib/types";

export function AgentTag({ agent }: { agent: AgentMessage["agent"] }) {
  return (
    <span className="font-mono text-xs tracking-telemetry" style={{ color: AGENT_COLOR[agent] }}>
      {agent}
    </span>
  );
}

export function MessageCard({ m }: { m: AgentMessage }) {
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
