// Story beats as windows of scroll progress (0–1). The copy panels, the
// camera keyframes and the 3D choreography all key off these.

export const BEATS = [
  { key: "hero", at: 0.0 },
  { key: "row", at: 0.1 },
  { key: "disruption", at: 0.22 },
  { key: "validators", at: 0.36 },
  { key: "round1", at: 0.5 },
  { key: "rounds", at: 0.62 },
  { key: "outcome", at: 0.76 },
  { key: "evidence", at: 0.88 },
] as const;

export type BeatKey = (typeof BEATS)[number]["key"];

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
