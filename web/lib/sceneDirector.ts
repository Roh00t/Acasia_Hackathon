// Shared scroll state for the story, adapted from the Killswitch website.
// Native scroll stays native. The scene (camera and copy) follows a damped,
// speed-capped copy of it, so a fast flick still reads as a deliberate move.
// Written by ScrollStory on the GSAP ticker; read by the canvas in useFrame.

export const director = {
  /** ScrollTrigger progress across #story-track (0–1). */
  raw: 0,
  /** Damped scene progress. Camera and copy are keyed to this, not `raw`. */
  scene: 0,
};

/** Chase rate toward raw scroll (1/s); lower is heavier. */
const DAMPING = 6;
/** Max scene speed in viewports per second. */
const CAP = 3;
/** Max lag behind raw scroll, in viewports, before the scene is dragged along. */
const BACKLOG = 1.5;

export function stepDirector(dt: number, viewports: number, reduced: boolean) {
  const { raw } = director;
  if (reduced || viewports <= 0) {
    director.scene = raw;
    return;
  }
  const backlog = BACKLOG / viewports;
  let scene = Math.min(Math.max(director.scene, raw - backlog), raw + backlog);
  const d = raw - scene;
  if (Math.abs(d) * viewports < 0.0005) {
    scene = raw;
  } else {
    const cap = (CAP / viewports) * dt;
    const step = d * (1 - Math.exp(-DAMPING * Math.min(dt, 0.05)));
    scene += Math.max(-cap, Math.min(cap, step));
  }
  director.scene = scene;
}
