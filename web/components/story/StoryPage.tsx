"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BEATS, beatAt } from "@/lib/beats";
import { director, stepDirector } from "@/lib/sceneDirector";
import { SUBSYSTEMS, type Batch, type Run, type Subsystem } from "@/lib/types";
import { CandidateGrid } from "@/components/console/CandidateGrid";
import { HashChain, LevelBadge, MessageCard, PlanTable, SyntheticNote, agentFacts, messageSubject } from "@/components/console/RunParts";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// three.js stays out of the initial bundle and never server-renders.
const Airfield = dynamic(() => import("./Airfield"), { ssr: false });

const SUB_LABEL: Record<Subsystem, string> = {
  ROUTINE: "Routine: late inbound",
  WEATHER: "Weather: rate cut",
  EMERGENCY: "Emergency: drone closure",
};

function Panel({ beat, active, children, wide }: { beat: number; active: number; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const on = beat === active;
  // Copy plays on time, not scrub: entering a beat starts a fixed-length masked reveal.
  useGSAP(
    () => {
      if (!on || !ref.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.fromTo(ref.current.querySelectorAll("[data-line]"), { yPercent: reduced ? 0 : 115 },
        { yPercent: 0, duration: reduced ? 0 : 1.0, ease: "expo.out", stagger: 0.1 });
      gsap.fromTo(ref.current.querySelectorAll("[data-body]"), { opacity: 0, y: reduced ? 0 : 12 },
        { opacity: 1, y: 0, duration: 0.8, ease: "expo.out", delay: 0.3, stagger: 0.06 });
    },
    { dependencies: [on], scope: ref },
  );
  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute inset-x-0 top-0 transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`}
      aria-hidden={!on}
    >
      <div className="mx-auto w-full max-w-frame px-4 pt-24 md:px-8">
        <div className={`${wide ? "max-w-3xl" : "max-w-xl"} ${on ? "pointer-events-auto" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

function Heading({ lines }: { lines: string[] }) {
  return (
    <h2 className="text-[clamp(2.2rem,5.5vw,4.8rem)] leading-[0.95] font-normal tracking-tighter">
      {lines.map((l) => (
        <span key={l} className="-mb-[0.14em] block overflow-hidden pb-[0.14em]">
          <span data-line className="block">{l}</span>
        </span>
      ))}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div data-body className="mt-6 border bg-carbon/80 p-4 backdrop-blur-sm">{children}</div>;
}

export default function StoryPage() {
  const [sub, setSub] = useState<Subsystem>("WEATHER");
  const [runs, setRuns] = useState<Partial<Record<Subsystem, Run>>>({});
  const [batch, setBatch] = useState<Batch | null>(null);
  const [beat, setBeat] = useState(0);
  const run = runs[sub] ?? null;

  useEffect(() => {
    SUBSYSTEMS.forEach((s) =>
      fetch(`/runs/showcase-${s.toLowerCase()}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setRuns((prev) => ({ ...prev, [s]: j }))),
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

  const s = run?.scenario;
  const row = s?.row;
  const r1 = run?.rounds.find((r) => r.round === 1);
  const later = run?.rounds.filter((r) => r.round > 1) ?? [];
  const silo = run?.outcome.baseline_uncoordinated;

  return (
    <main className="relative">
      <div className="fixed inset-0 z-0">
        <Airfield run={run} />
      </div>

      <header className="fixed inset-x-0 top-0 z-30 border-b bg-carbon/70 backdrop-blur">
        <div className="mx-auto flex max-w-frame items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="label text-primary">Arrival disruption · 3-agent negotiation</div>
          <div className="flex items-center gap-1">
            {SUBSYSTEMS.map((x) => (
              <button
                key={x}
                onClick={() => setSub(x)}
                className={`border px-2 py-1 font-mono text-[11px] ${x === sub ? "border-primary text-primary" : "text-muted"}`}
              >
                {SUB_LABEL[x]}
              </button>
            ))}
            <Link href="/console" className="ml-2 border border-atc px-2 py-1 font-mono text-[11px] text-atc">
              Live console →
            </Link>
          </div>
        </div>
        <div className="h-[2px] bg-tactical">
          <div className="h-full bg-atc transition-[width] duration-300" style={{ width: `${(beat / (BEATS.length - 1)) * 100}%` }} />
        </div>
      </header>

      <div className="pointer-events-none fixed inset-0 z-20">
        <Panel beat={0} active={beat}>
          <p data-body className="label mb-4">Station duty manager · arrival hub · today</p>
          <Heading lines={["One late aircraft.", "Three organisations.", "One phone line."]} />
          <p data-body className="mt-6 max-w-md text-muted">
            When weather, a late inbound or a runway closure hits, ATC, the flight crew and ramp control
            renegotiate by phone while the aircraft holds and burns fuel. Here three independent AI agents
            negotiate instead. Code enforces every safety margin. A person approves.
          </p>
          <p data-body className="label mt-10">Scroll ↓</p>
        </Panel>

        <Panel beat={1} active={beat}>
          <Heading lines={["A real flight.", "A real delay."]} />
          {row && (
            <Card>
              <div className="label">US DOT 2015 on-time data · row {s?.row_id}</div>
              <div className="mt-2 font-mono text-2xl">
                {String(row.AIRLINE)}{String(row.FLIGHT_NUMBER)} · {String(row.ORIGIN_AIRPORT)} → {String(row.DESTINATION_AIRPORT)}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-sm">
                <div><div className="label">Arrival delay</div>{String(row.ARRIVAL_DELAY)} min</div>
                <div><div className="label">Weather delay</div>{String(row.WEATHER_DELAY)} min</div>
                <div><div className="label">Late aircraft</div>{String(row.LATE_AIRCRAFT_DELAY)} min</div>
                <div><div className="label">Date</div>2015-{String(row.MONTH).padStart(2, "0")}-{String(row.DAY).padStart(2, "0")}</div>
                <div><div className="label">Tail</div>{String(row.TAIL_NUMBER)}</div>
                <div><div className="label">Distance</div>{String(row.DISTANCE)} mi</div>
              </div>
            </Card>
          )}
        </Panel>

        <Panel beat={2} active={beat}>
          <Heading lines={[sub === "EMERGENCY" ? "Runway closed." : sub === "WEATHER" ? "Capacity cut." : "Gate still occupied."]} />
          {run && (
            <Card>
              <div className="label" style={{ color: sub === "EMERGENCY" ? "var(--color-crimson)" : undefined }}>
                Subsystem · {sub}
              </div>
              <p className="mt-2 text-sm">{s?.narrative}</p>
              <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-sm">
                <div><div className="label">Arrival cap</div>{s?.runway.arrival_cap_per_hr}/{s?.runway.normal_cap_per_hr} per hr</div>
                <div><div className="label">Fuel endurance</div>{s?.flight.fuel_endurance_min} min</div>
                <div><div className="label">Alternate</div>{s?.flight.alternate} (+{s?.flight.alternate_min} min)</div>
              </div>
              <SyntheticNote run={run} />
            </Card>
          )}
        </Panel>

        <Panel beat={3} active={beat} wide>
          <Heading lines={[`${run?.candidates.total ?? "—"} options.`, `${run?.candidates.feasible ?? "—"} are legal.`]} />
          {run && (
            <Card>
              <p className="mb-3 text-sm text-muted">
                Code, not an LLM, checks wake separation, fuel reserve, turbulence, runway closure and gate conflicts.
                Agents only ever see the legal options.
              </p>
              <CandidateGrid run={run} highlight={run.outcome.candidate?.id} />
            </Card>
          )}
        </Panel>

        <Panel beat={4} active={beat} wide>
          <Heading lines={["Round 1.", "Each side ranks."]} />
          {r1 && (
            <div data-body className="mt-6 grid gap-2 md:grid-cols-3">
              {run && r1.messages.map((m) => {
                const subject = messageSubject(run, m, null);
                return <MessageCard key={m.agent} m={m} facts={agentFacts(m.agent, subject)} subject={subject?.id} />;
              })}
            </div>
          )}
          <p data-body className="label mt-3">Three separate calls. Each agent sees only its own organisation&apos;s data.</p>
        </Panel>

        <Panel beat={5} active={beat} wide>
          <Heading lines={["Propose. Counter.", "Three rounds, max."]} />
          <div data-body className="mt-6 space-y-3">
            {later.map((r) => (
              <div key={r.round}>
                <div className="label mb-1">Round {r.round} · coordinator proposes {r.proposal?.id}</div>
                <div className="grid gap-2 md:grid-cols-3">
                  {r.messages.map((m) => <MessageCard key={m.agent} m={m} facts={agentFacts(m.agent, r.proposal)} subject={r.proposal?.id} />)}
                </div>
              </div>
            ))}
            {run && run.vetoes.length > 0 && (
              <p className="font-mono text-xs text-crimson">
                {run.vetoes.length} veto(es): {run.vetoes[0].agent} named {run.vetoes[0].candidate}, which failed{" "}
                {Object.values(run.vetoes[0].failed)[0]?.code}
              </p>
            )}
          </div>
        </Panel>

        <Panel beat={6} active={beat} wide>
          <Heading lines={[run?.outcome.consensus ? "Consensus." : "No consensus: fallback.", "A person approves."]} />
          {run && (
            <Card>
              <LevelBadge run={run} />
              <div className="mt-4">
                <PlanTable
                  plans={[
                    { label: "Negotiated", c: run.outcome.candidate },
                    { label: "FCFS", c: run.outcome.baseline_fcfs },
                    { label: "Siloed today", c: silo ?? null, note: silo ? Object.values(silo.violations).map((v) => v.code).join(", ") || "none" : undefined },
                  ]}
                />
              </div>
              <div className="mt-4"><HashChain run={run} max={8} /></div>
            </Card>
          )}
        </Panel>

        <Panel beat={7} active={beat} wide>
          <Heading lines={["Tested on many rows,", "not one script."]} />
          {batch && (
            <Card>
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="label py-1 font-normal">
                      {batch.n_per_subsystem} rows each · {batch.mode}{batch.model ? ` · ${batch.model}` : ""}
                    </th>
                    {SUBSYSTEMS.map((x) => <th key={x} className="label py-1 text-right font-normal">{x}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Consensus in ≤3 rounds", (b) => `${b.consensus_pct}%`],
                    ["Mean rounds", (b) => b.mean_rounds],
                    ["Unsafe plans accepted", (b) => b.unsafe_plans_accepted],
                    ["Siloed plans that break a constraint", (b) => `${b.uncoordinated_plans_broken_pct}%`],
                    ["Diverts (negotiated)", (b) => `${b.divert_pct.neg}%`],
                    ...(batch.mode === "live"
                      ? ([["LLM replies replaced by rule agents", (b) => b.llm_stand_ins]] as [string, (b: Batch["subsystems"][Subsystem]) => React.ReactNode][])
                      : []),
                  ] as [string, (b: Batch["subsystems"][Subsystem]) => React.ReactNode][]).map(([label, f]) => (
                    <tr key={label} className="border-t">
                      <td className="py-1 text-muted">{label}</td>
                      {SUBSYSTEMS.map((x) => <td key={x} className="py-1 text-right">{f(batch.subsystems[x])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="label mt-3">MODELLED on synthetic airport state seeded from real DOT rows. Not measured.</p>
              <div className="mt-4 flex gap-2">
                <Link href="/console" className="border border-atc px-3 py-2 font-mono text-xs text-atc">Run a random row live →</Link>
              </div>
            </Card>
          )}
        </Panel>
      </div>

      <div id="story-track" className="relative z-10 h-[900vh]" />

      <section className="relative z-30 border-t bg-carbon">
        <div className="mx-auto grid max-w-frame gap-8 px-4 py-16 md:grid-cols-3 md:px-8">
          <div>
            <div className="label">Limits</div>
            <p className="mt-2 text-sm text-muted">
              Runway, gates, fuel, connections and crew are synthetic, seeded from each row. One flight at a time;
              the model does not re-sequence the whole arrival bank. Real results need airline and airport feeds.
            </p>
          </div>
          <div>
            <div className="label">Safety split</div>
            <p className="mt-2 text-sm text-muted">
              LLMs negotiate trade-offs. Validators decide what is legal, the coordinator caps talk at 3 rounds,
              and a deterministic fallback decides without consensus. Every message is in a hash-chained log.
            </p>
          </div>
          <div>
            <div className="label">Why the drone case</div>
            <p className="mt-2 text-sm text-muted">
              Gatwick, Dec 2018: about 1,000 flights affected over ~33 hours. Munich, Oct 2025: 23 diversions,
              12 cancellations. The FAA receives more than 100 drone reports near airports every month.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
