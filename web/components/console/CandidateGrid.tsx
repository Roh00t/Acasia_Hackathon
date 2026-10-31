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

  return (
    <div>
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
                    background: c?.ok ? "var(--color-ok)" : domain ? FAIL_COLOR[domain] : "transparent",
                    outline: isHi ? "2px solid white" : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="label">T+{slots[0]} → T+{slots[slots.length - 1]} min</span>
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
