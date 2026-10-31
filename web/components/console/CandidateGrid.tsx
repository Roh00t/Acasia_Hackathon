import type { Run } from "@/lib/types";

const FAIL_COLOR: Record<string, string> = {
  ATC: "rgb(0 229 255 / 0.28)",
  PILOT: "rgb(255 176 32 / 0.32)",
  GROUND: "rgb(126 231 135 / 0.28)",
};

/** Every candidate: slot (x) by gate (y). Green = passes all validators;
 * tinted = vetoed, coloured by the domain whose validator failed first. */
export function CandidateGrid({ run, highlight }: { run: Run; highlight?: string | null }) {
  const grid = run.candidates.grid;
  const gates = run.scenario.ground.gates.map((g) => g.id);
  const slots = Array.from(new Set(grid.filter((c) => c.kind === "LAND").map((c) => c.t as number))).sort((a, b) => a - b);
  const byKey = new Map(grid.map((c) => [`${c.t}-${c.gate}`, c]));
  const divert = grid.find((c) => c.kind === "DIVERT");

  const first = slots[0] ?? 0;
  const last = slots[slots.length - 1] ?? 1;
  const ticks = [4, 20, 40, 62].filter((t) => t >= first && t <= last + 2);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">Gate ↓</span>
        <span className="label">colour = first check that failed</span>
      </div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `2.2rem repeat(${slots.length}, minmax(0, 1fr))` }}>
        {gates.map((g) => (
          <div key={g} className="contents">
            <div className="label flex items-center">{g}</div>
            {slots.map((t) => {
              const c = byKey.get(`${t}-${g}`);
              const domain = c?.fail?.split(":")[0];
              const isHi = c?.id === highlight;
              return (
                <div
                  key={t}
                  title={c ? `${c.id}: ${c.ok ? "legal" : c.fail}` : ""}
                  className="aspect-square rounded-sm"
                  style={{
                    // Vetoed options are struck through as well as tinted by the failing domain.
                    background: c?.ok
                      ? "var(--color-ok)"
                      : domain
                        ? `linear-gradient(135deg, transparent 44%, rgb(240 242 245 / 0.35) 46%, rgb(240 242 245 / 0.35) 54%, transparent 56%), ${FAIL_COLOR[domain]}`
                        : "transparent",
                    outline: isHi ? "2px solid white" : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4" style={{ marginLeft: "2.2rem" }}>
        {ticks.map((t) => (
          <span key={t} className="label absolute -translate-x-1/2" style={{ left: `${((Math.min(t, last) - first) / Math.max(1, last - first)) * 100}%` }}>
            T+{t}
          </span>
        ))}
      </div>
      <div className="label mt-1 text-center" style={{ marginLeft: "2.2rem" }}>Landing slot, minutes from now →</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {divert && (
          <span className="label" style={{ color: divert.ok ? "var(--color-ok)" : undefined }}>
            {divert.id}: {divert.ok ? "legal" : divert.fail}
          </span>
        )}
        <span className="label"><i className="mr-1 inline-block size-2" style={{ background: FAIL_COLOR.ATC }} />ATC veto</span>
        <span className="label"><i className="mr-1 inline-block size-2" style={{ background: FAIL_COLOR.PILOT }} />Pilot veto</span>
        <span className="label"><i className="mr-1 inline-block size-2" style={{ background: FAIL_COLOR.GROUND }} />Ground veto</span>
        <span className="label"><i className="mr-1 inline-block size-2 bg-ok" />Legal</span>
      </div>
    </div>
  );
}
