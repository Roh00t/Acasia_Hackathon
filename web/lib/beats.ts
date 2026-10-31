// Story beats as windows of scroll progress (0–1): an intro, five beats for each
// of the three chapters (one per subsystem), and a closing evidence beat. The
// copy panels, the camera and the 3D choreography all key off these.

export const PHASES = ["title", "disruption", "validators", "negotiation", "outcome"] as const;
export type Phase = (typeof PHASES)[number];

export type Beat = { key: string; chapter: number | null; phase: Phase | "intro" | "outro"; at: number };

const keys: Omit<Beat, "at">[] = [
  { key: "intro", chapter: null, phase: "intro" },
  ...[0, 1, 2].flatMap((c) => PHASES.map((phase) => ({ key: `c${c}-${phase}`, chapter: c, phase }))),
  { key: "outro", chapter: null, phase: "outro" },
];

export const BEATS: Beat[] = keys.map((b, i) => ({ ...b, at: i / keys.length }));

/** Scroll progress where chapter c (0-based) starts. */
export const chapterStart = (c: number) => BEATS.find((b) => b.chapter === c && b.phase === "title")!.at;

export function beatAt(p: number): number {
  let i = 0;
  for (let k = 0; k < BEATS.length; k++) if (p >= BEATS[k].at) i = k;
  return i;
}

/** 0–1 progress through beat `i`. */
export function beatProgress(p: number, i: number): number {
  const a = BEATS[i].at;
  const b = i + 1 < BEATS.length ? BEATS[i + 1].at : 1;
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

/** Smooth 0–1 ramp of progress p between a and b. */
export function ramp(p: number, a: number, b: number): number {
  const x = Math.min(1, Math.max(0, (p - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
