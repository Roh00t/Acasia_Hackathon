"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BEATS, beatAt, chapterStart } from "@/lib/beats";
import { director, stepDirector } from "@/lib/sceneDirector";
import { AGENT_COLOR, LEVEL_TEXT, SUBSYSTEMS, type AgentMessage, type Batch, type StoryChapter, type Subsystem } from "@/lib/types";
import { CandidateGrid } from "@/components/console/CandidateGrid";
import { HashChain, agentFacts, messageSubject } from "@/components/console/RunParts";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// three.js stays out of the initial bundle and never server-renders.
const Airfield = dynamic(() => import("./Airfield"), { ssr: false });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TAGLINE: Record<Subsystem, string> = {
  ROUTINE: "A late inbound, a failed gate.",
  WEATHER: "A storm cuts arrivals.",
  EMERGENCY: "A drone closes the runway.",
};
const TRIGGER: Record<Subsystem, string> = {
  ROUTINE: "Brief triggers: LATE_AIRCRAFT_DELAY > 20 · ground equipment fails",
  WEATHER: "Brief trigger: WEATHER_DELAY > 15",
  EMERGENCY: "Synthetic closure layered on a real row",
};

function addMin(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const tot = (h * 60 + m + Math.round(minutes) + 1440) % 1440;
  return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
}

type Kind = "REAL" | "DERIVED" | "SYNTHETIC" | "MODELLED";

function Badge({ kind }: { kind: Kind }) {
  const color = { REAL: "var(--color-ok)", DERIVED: "var(--color-atc)", SYNTHETIC: "var(--color-pilot)", MODELLED: "var(--color-muted)" }[kind];
  return (
    <span className="ml-2 inline-block rounded-sm border px-1.5 align-middle font-mono text-[11px] tracking-[0.12em]" style={{ color, borderColor: color }}>
      {kind}
    </span>
  );
}

function Fact({ label, value, kind }: { label: string; value: React.ReactNode; kind: Kind }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}<Badge kind={kind} /></div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}

function Panel({ beat, active, children, wide, mid }: { beat: number; active: number; children: React.ReactNode; wide?: boolean; mid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const on = beat === active;
  // The outgoing panel fades out first (180 ms); the incoming one waits, then reveals its lines.
  useGSAP(
    () => {
      if (!on || !ref.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.fromTo(ref.current.querySelectorAll("[data-line]"), { yPercent: reduced ? 0 : 115 },
        { yPercent: 0, duration: reduced ? 0 : 0.9, ease: "expo.out", stagger: 0.08, delay: 0.25 });
      gsap.fromTo(ref.current.querySelectorAll("[data-body]"), { opacity: 0, y: reduced ? 0 : 12 },
        { opacity: 1, y: 0, duration: 0.7, ease: "expo.out", delay: 0.45, stagger: 0.05 });
    },
    { dependencies: [on], scope: ref },
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{
        opacity: on ? 1 : 0,
        visibility: on ? "visible" : "hidden",
        transition: on ? "opacity 260ms ease 130ms, visibility 0s linear 130ms" : "opacity 130ms ease, visibility 0s linear 130ms",
      }}
      aria-hidden={!on}
    >
      <div className="w-full px-5 pt-24 md:pl-12 md:pr-6">
        <div className={`${wide ? "max-w-[42rem]" : mid ? "max-w-[38rem]" : "max-w-[34rem]"} ${on ? "pointer-events-auto" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

function Heading({ lines }: { lines: string[] }) {
  return (
    <h2 className="text-[clamp(2.2rem,4.6vw,4.2rem)] leading-[0.98] font-normal tracking-tighter">
      {lines.map((l) => (
        <span key={l} className="-mb-[0.14em] block overflow-hidden pb-[0.14em]">
          <span data-line className="block">{l}</span>
        </span>
      ))}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div data-body className="mt-6 border bg-carbon/85 p-5 backdrop-blur-sm">{children}</div>;
}

/** Agent card sized for a projector: 16 px body, the checked numbers underneath. */
function StoryAgentCard({ m, facts, subject }: { m: AgentMessage; facts: string[]; subject?: string | null }) {
  const tone = m.decision === "ACCEPT" ? "text-ok" : m.decision === "REJECT" ? "text-crimson" : "text-primary";
  return (
    <div className="min-w-0 border-l-2 bg-slate/90 px-3 py-2.5" style={{ borderColor: AGENT_COLOR[m.agent] }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm tracking-[0.15em]" style={{ color: AGENT_COLOR[m.agent] }}>{m.agent}</span>
        <span className="label">{m.level === "L0" ? "LLM" : "rule"}</span>
      </div>
      <div className={`mt-1 font-mono text-base ${tone}`}>
        {m.decision === "RANK" ? `RANKS ${m.ranking[0] ?? ""} FIRST` : m.decision}
        {m.decision !== "RANK" && <span className="text-muted"> · {m.reason_code}</span>}
      </div>
      <p className="mt-1 line-clamp-3 text-base leading-snug text-primary/85">{m.reason}</p>
      {facts.length > 0 && (
        <div className="mt-1.5 border-t pt-1 font-mono text-xs text-muted">checked{subject ? ` ${subject}` : ""}: {facts.slice(0, 3).join(" · ")}</div>
      )}
      {m.meta?.unverified_numbers && m.meta.unverified_numbers.length > 0 && (
        <div className="mt-1 font-mono text-xs text-pilot">
          Flagged: {m.meta.unverified_numbers.join(", ")} not in this agent&apos;s data
        </div>
      )}
    </div>
  );
}

export default function StoryPage() {
  const [chapters, setChapters] = useState<(StoryChapter | null)[]>([null, null, null]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    ["s1", "s2", "s3"].forEach((k, i) =>
      fetch(`/story/${k}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setChapters((prev) => prev.map((c, n) => (n === i ? j : c)))),
    );
    // Prefer the live-agent batch; fall back to the offline rule-agent batch.
    fetch("/evidence/batch-live.json")
      .then((r) => (r.ok ? r.json() : fetch("/evidence/batch.json").then((o) => (o.ok ? o.json() : null))))
      .then(setBatch);
  }, []);

  // Scroll drives the shared director; the canvas and copy follow its damped value.
  useGSAP(() => {
    const track = document.getElementById("story-track");
    if (!track) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let viewports = 1;
    const measure = () => {
      viewports = Math.max((track.offsetHeight - innerHeight) / innerHeight, 0.01);
    };
    ScrollTrigger.create({
      trigger: track,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        director.raw = self.progress;
      },
      onRefresh: (self) => {
        director.raw = self.progress;
        measure();
      },
    });
    measure();
    let last = -1;
    const tick = (_t: number, deltaMs: number) => {
      stepDirector(deltaMs / 1000, viewports, reduced);
      const b = beatAt(director.scene);
      if (b !== last) {
        last = b;
        setBeat(b);
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  });

  const jumpTo = (c: number) => {
    const track = document.getElementById("story-track");
    if (!track) return;
    const top = track.offsetTop + (chapterStart(c) + 0.004) * (track.offsetHeight - innerHeight);
    window.scrollTo({ top, behavior: "smooth" });
  };
  const activeChapter = BEATS[beat]?.chapter ?? null;
  const beatIndex = (c: number, phase: string) => BEATS.findIndex((b) => b.chapter === c && b.phase === phase);

  return (
    <main className="relative">
      <div className="fixed inset-0 z-0">
        <Airfield chapters={chapters} />
      </div>
      {/* Keeps the copy readable over the scene; the scene itself is offset to the right. */}
      <div className="pointer-events-none fixed inset-0 z-10 bg-[linear-gradient(90deg,rgba(9,10,12,0.94)_0%,rgba(9,10,12,0.85)_30%,rgba(9,10,12,0.3)_46%,transparent_54%)]" />

      <header className="fixed inset-x-0 top-0 z-30 border-b bg-carbon/75 backdrop-blur">
        <div className="mx-auto flex max-w-frame flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="label text-primary">Arrival disruption · 3-agent negotiation</div>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Chapters">
            {chapters.map((c, i) => (
              <button
                key={i}
                onClick={() => jumpTo(i)}
                className={`border px-2.5 py-1 font-mono text-xs ${activeChapter === i ? "border-primary text-primary" : "text-muted hover:text-primary"}`}
              >
                {i + 1} · {c?.title ?? SUBSYSTEMS[i]}
              </button>
            ))}
            <Link href="/console" className="ml-2 border border-atc px-2.5 py-1 font-mono text-xs text-atc">Live console →</Link>
          </nav>
        </div>
        <div className="relative h-[3px] bg-tactical">
          <div className="h-full bg-atc transition-[width] duration-300" style={{ width: `${(beat / (BEATS.length - 1)) * 100}%` }} />
          {[0, 1, 2].map((c) => (
            <button
              key={c}
              onClick={() => jumpTo(c)}
              aria-label={`Jump to chapter ${c + 1}`}
              className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border ${activeChapter !== null && activeChapter >= c ? "border-atc bg-atc" : "border-muted bg-carbon"}`}
              style={{ left: `${(chapterStart(c) / BEATS[BEATS.length - 1].at) * 100}%` }}
            />
          ))}
        </div>
      </header>

      <div className="pointer-events-none fixed inset-0 z-20">
        <Panel beat={0} active={beat}>
          <p data-body className="label mb-4">Station duty manager · arrival hub · real 2015 flights</p>
          <Heading lines={["One late aircraft.", "Three organisations.", "One phone line."]} />
          <p data-body className="mt-6 max-w-xl text-lg text-primary/80">
            When weather, a late inbound or a runway closure hits, ATC, the flight crew and ramp control
            renegotiate by phone while the aircraft holds and burns fuel. Here three independent AI agents
            negotiate instead. Code enforces every safety margin. A person approves.
          </p>
          <div data-body className="mt-8 grid max-w-xl grid-cols-3 gap-2">
            {chapters.map((c, i) => (
              <div key={i} className="border bg-carbon/80 p-3">
                <div className="label">Subsystem {i + 1}</div>
                <div className="mt-1 text-lg">{c?.title ?? SUBSYSTEMS[i]}</div>
                <div className="mt-1 text-sm text-muted">{c ? TAGLINE[c.subsystem] : ""}</div>
              </div>
            ))}
          </div>
          <p data-body className="label mt-10">Scroll ↓</p>
        </Panel>

        {chapters.map((d, c) => {
          if (!d) return null;
          const run = d.live;
          const s = run.scenario;
          const r = d.real;
          const o = run.outcome;
          const chosen = o.candidate;
          const date = `${r.DAY} ${MONTHS[Number(r.MONTH) - 1]} 2015`;
          const delay = d.subsystem === "WEATHER" ? `${r.WEATHER_DELAY} min weather delay` : d.subsystem === "ROUTINE"
            ? `${r.LATE_AIRCRAFT_DELAY} min late-aircraft delay` : `${r.ARRIVAL_DELAY} min arrival delay`;
          const r1 = run.rounds.find((x) => x.round === 1);
          const later = run.rounds.filter((x) => x.round > 1);
          const plannedBusy = s.ground.gates.find((g) => g.id === s.ground.planned_gate)?.busy?.find(([a, b]) => a <= 2 && b > 2);
          const silo = o.baseline_uncoordinated;
          return (
            <div key={c} className="contents">
              {/* Title */}
              <Panel beat={beatIndex(c, "title")} active={beat}>
                <p data-body className="label mb-4">Subsystem {c + 1} of 3 · {TRIGGER[d.subsystem]}</p>
                <Heading lines={[`${d.title}.`, TAGLINE[d.subsystem]]} />
                <Card>
                  <div className="font-mono text-2xl">
                    {String(r.AIRLINE)}{String(r.FLIGHT_NUMBER)} into {String(r.DESTINATION_AIRPORT)}<Badge kind="REAL" />
                  </div>
                  <p className="mt-2 text-lg text-primary/85">
                    {date}, {delay}, from {String(r.ORIGIN_AIRPORT)}. US DOT on-time data, row {d.row_id}.
                  </p>
                  {d.subsystem === "ROUTINE" && Number(r.LATE_AIRCRAFT_DELAY) > 180 && (
                    <p className="mt-2 text-base text-muted">
                      Real row; an unusually long late-aircraft delay, chosen because it shows a gate clash, an equipment
                      failure and a flagged agent number together.
                    </p>
                  )}
                </Card>
              </Panel>

              {/* Disruption */}
              <Panel beat={beatIndex(c, "disruption")} active={beat}>
                <Heading lines={[
                  d.subsystem === "ROUTINE"
                    ? s.ground.equipment_failure
                      ? `Gate ${s.ground.planned_gate} occupied. ${s.ground.equipment_failure.gate} out of service.`
                      : `Gate ${s.ground.planned_gate} is still occupied.`
                    : d.subsystem === "WEATHER" ? `Arrivals cut to ${s.runway.arrival_cap_per_hr} an hour.` : "Runway closed.",
                ]} />
                {d.subsystem === "EMERGENCY" && s.runway.closure && (
                  <div data-body className="mt-5 inline-block border border-crimson bg-crimson/15 px-3 py-2 font-mono text-base text-crimson">
                    RUNWAY {s.runway.name} CLOSED · drone sighting · T+{s.runway.closure.start.toFixed(0)} to T+{s.runway.closure.end.toFixed(0)} min<Badge kind="SYNTHETIC" />
                  </div>
                )}
                <Card>
                  <p className="text-lg text-primary/90">{s.narrative}</p>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    {d.subsystem === "ROUTINE" && (
                      <>
                        <Fact label={`Gate ${s.ground.planned_gate} occupied until`} value={plannedBusy ? `T+${plannedBusy[1].toFixed(0)} min` : "—"} kind="SYNTHETIC" />
                        <Fact label="Ramp crew shift ends" value={`T+${s.ground.crew_shift_end} min`} kind="SYNTHETIC" />
                        {d.derived.next_leg && (
                          <Fact label={`Tail ${String(r.TAIL_NUMBER)} next leg`} value={`${d.derived.next_leg.flight} to ${d.derived.next_leg.dest} at ${d.derived.next_leg.dep}`} kind="REAL" />
                        )}
                        {s.ground.equipment_failure && (
                          <Fact
                            label={`Gate ${s.ground.equipment_failure.gate} ${s.ground.equipment_failure.equipment} failed`}
                            value={`out until T+${s.ground.equipment_failure.until} min`}
                            kind="SYNTHETIC"
                          />
                        )}
                      </>
                    )}
                    {d.subsystem === "WEATHER" && (
                      <>
                        <Fact label="Arrival rate" value={`${s.runway.normal_cap_per_hr} → ${s.runway.arrival_cap_per_hr}/hr`} kind="DERIVED" />
                        <Fact
                          label={`Same-hour arrivals at ${String(r.DESTINATION_AIRPORT)} weather-delayed`}
                          value={`${d.derived.window_weather_delayed} of ${d.derived.window_arrivals} (${Math.round((d.derived.weather_share ?? 0) * 100)}%)`}
                          kind="DERIVED"
                        />
                        <Fact label="Fuel endurance" value={`${s.flight.fuel_endurance_min} min`} kind="SYNTHETIC" />
                        <Fact label="Alternate" value={`${s.flight.alternate} (+${s.flight.alternate_min} min)`} kind="SYNTHETIC" />
                      </>
                    )}
                    {d.subsystem === "EMERGENCY" && (
                      <>
                        <Fact label="Drones sighted" value="2, near the threshold" kind="SYNTHETIC" />
                        <Fact label="Fuel endurance" value={`${s.flight.fuel_endurance_min} min`} kind="SYNTHETIC" />
                        <Fact label="Alternate" value={`${s.flight.alternate} (+${s.flight.alternate_min} min)`} kind="SYNTHETIC" />
                        <Fact label="Real delay on this row" value={`${r.ARRIVAL_DELAY} min`} kind="REAL" />
                      </>
                    )}
                  </div>
                  {d.subsystem === "ROUTINE" && chosen && (
                    <div className="mt-4">
                      <div className="label">Crew shift clock</div>
                      <div className="relative mt-2 h-2 overflow-hidden rounded-sm bg-tactical">
                        <div className="h-full bg-pilot" style={{ width: beat === beatIndex(c, "disruption") ? "100%" : "0%", transition: "width 6s linear" }} />
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted">
                        shift ends T+{s.ground.crew_shift_end} min · agreed plan runs {chosen.metrics.overtime_min} min past it
                      </div>
                    </div>
                  )}
                </Card>
              </Panel>

              {/* Validators */}
              <Panel beat={beatIndex(c, "validators")} active={beat} mid>
                <Heading lines={[`${run.candidates.total} options.`, `${run.candidates.feasible} are legal.`]} />
                <Card>
                  <p className="mb-3 text-lg text-primary/85">
                    Code, not an LLM, checks every option. Vetoed options are struck out; agents only ever see the legal ones.
                  </p>
                  <CandidateGrid run={run} highlight={chosen?.id} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(run.candidates.fail_counts).map(([code, n]) => (
                      <span key={code} className="border px-2 py-0.5 font-mono text-xs text-muted">{code} × {n}</span>
                    ))}
                  </div>
                </Card>
              </Panel>

              {/* Negotiation */}
              <Panel beat={beatIndex(c, "negotiation")} active={beat} wide>
                <Heading lines={["Three agents.", "Separate calls."]} />
                <div data-body className="mt-5 space-y-3">
                  {r1 && (
                    <div>
                      <div className="label mb-1">Round 1 · each agent ranks the legal options</div>
                      <div className="grid gap-2 md:grid-cols-3">
                        {r1.messages.map((m) => {
                          const subj = messageSubject(run, m, null);
                          return <StoryAgentCard key={m.agent} m={m} facts={agentFacts(m.agent, subj)} subject={subj?.id} />;
                        })}
                      </div>
                    </div>
                  )}
                  {later.map((rd) => (
                    <div key={rd.round}>
                      <div className="label mb-1">Round {rd.round} · coordinator proposes {rd.proposal?.id}</div>
                      <div className="grid gap-2 md:grid-cols-3">
                        {rd.messages.map((m) => <StoryAgentCard key={m.agent} m={m} facts={agentFacts(m.agent, rd.proposal)} subject={rd.proposal?.id} />)}
                      </div>
                    </div>
                  ))}
                  <p className="font-mono text-xs text-muted">
                    {d.model ?? "rule agents"} · {run.rounds.reduce((n, x) => n + x.messages.length, 0)} separate calls · ${d.cost.usd.toFixed(4)} · {d.latency_s}s · offline rule agents chose {d.offline.outcome.candidate?.id ?? "—"}
                  </p>
                </div>
              </Panel>

              {/* Outcome */}
              <Panel beat={beatIndex(c, "outcome")} active={beat} mid>
                <Heading lines={[o.consensus ? "Consensus." : `Fallback ${o.level}.`, "A person approves."]} />
                <Card>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="border px-2 py-1 font-mono text-base" style={{ color: o.level === "L2" ? "var(--color-pilot)" : o.level === "L3" ? "var(--color-crimson)" : "var(--color-ok)" }}>
                      {o.level} · {LEVEL_TEXT[o.level]}
                    </span>
                    <span className="label">{o.rounds_used} rounds</span>
                  </div>
                  {chosen && (
                    <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                      <Fact label="Revised arrival" value={chosen.t != null ? `${addMin(s.t0_clock, chosen.t)} (T+${chosen.t})` : chosen.id} kind="MODELLED" />
                      <Fact label="Gate" value={chosen.gate ?? chosen.kind} kind="MODELLED" />
                      <Fact label="Holding" value={`${chosen.metrics.hold_min} min · ${chosen.metrics.fuel_hold_kg} kg`} kind="MODELLED" />
                      <Fact label="Missed connections" value={`${chosen.metrics.missed_pax} pax`} kind="MODELLED" />
                      <Fact label="Crew overtime" value={`${chosen.metrics.overtime_min} min`} kind="MODELLED" />
                      <Fact label="Siloed plan would break" value={silo ? Object.values(silo.violations).map((v) => v.code).join(", ") || "nothing" : "—"} kind="MODELLED" />
                    </div>
                  )}
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <span className="border border-ok px-3 py-1.5 font-mono text-base text-ok">Duty manager: Approve</span>
                    <Link href="/console" className="label text-atc">Approve in the live console →</Link>
                  </div>
                  <div className="mt-4"><HashChain run={run} max={6} /></div>
                </Card>
              </Panel>
            </div>
          );
        })}

        <Panel beat={BEATS.length - 1} active={beat} wide>
          <Heading lines={["Tested on many rows,", "not one script."]} />
          {batch && (
            <Card>
              <table className="w-full font-mono text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="label py-1 font-normal">{batch.n_per_subsystem} rows each · {batch.mode}{batch.model ? ` · ${batch.model}` : ""}</th>
                    {SUBSYSTEMS.map((x) => <th key={x} className="label py-1 text-right font-normal">{x}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Consensus in ≤3 rounds", (b) => `${b.consensus_pct}%`],
                    ["Mean rounds", (b) => b.mean_rounds],
                    ["Unsafe plans accepted", (b) => b.unsafe_plans_accepted],
                    ["Siloed plans that break a constraint", (b) => `${b.uncoordinated_plans_broken_pct}%`],
                    ["LLM replies replaced by rule agents", (b) => b.llm_stand_ins ?? 0],
                  ] as [string, (b: Batch["subsystems"][Subsystem]) => React.ReactNode][]).map(([label, f]) => (
                    <tr key={label} className="border-t">
                      <td className="py-1.5 text-muted">{label}</td>
                      {SUBSYSTEMS.map((x) => <td key={x} className="py-1.5 text-right">{f(batch.subsystems[x])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="label mt-3">MODELLED on synthetic airport state seeded from real DOT rows. Not measured.</p>
              <div className="mt-4 flex gap-2">
                <Link href="/console" className="border border-atc px-3 py-2 font-mono text-sm text-atc">Run a random row live →</Link>
              </div>
            </Card>
          )}
        </Panel>
      </div>

      <div id="story-track" className="relative z-10" style={{ height: `${BEATS.length * 100}vh` }} />

      <section className="relative z-30 border-t bg-carbon">
        <div className="mx-auto grid max-w-frame gap-8 px-4 py-16 md:grid-cols-3 md:px-8">
          <div>
            <div className="label">What the AI does</div>
            <p className="mt-2 text-base text-muted">
              Three separate Claude calls per round, one per organisation, each with only its own data. They rank
              the legal options, accept or reject proposals with reason codes, and counter-offer. A coordinator
              written in code proposes, caps talk at 3 rounds and falls back deterministically.
            </p>
          </div>
          <div>
            <div className="label">Safety split</div>
            <p className="mt-2 text-base text-muted">
              LLMs negotiate trade-offs. Validators decide what is legal and re-check the final plan. Every message
              is in an HMAC-keyed, hash-chained log, and nothing happens until the duty manager approves.
            </p>
          </div>
          <div>
            <div className="label">Limits</div>
            <p className="mt-2 text-base text-muted">
              Runway, gates, fuel, connections and crew are synthetic, seeded from each row. One flight at a time.
              Drone closures are synthetic. Real results need airline and airport feeds.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
