"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { director } from "@/lib/sceneDirector";
import { BEATS, PHASES, beatAt, beatProgress, ramp } from "@/lib/beats";
import { MODELS, type ModelName, type ModelSpec } from "@/lib/models";
import type { StoryChapter } from "@/lib/types";

// World layout: runway along +x with the threshold at x = -30; approach from -x.
// Gates A1..A8 are 4 units apart in front of the terminal; a taxiway runs at z = -4.5.
const THRESHOLD_X = -30;
const GATE_Z = -10;
const STAND_Z = -7.4;
const TAXI_Z = -4.5;
const GROUND_Y = 0.55;
const gateX = (gate: string | null | undefined) => (gate ? -14 + (parseInt(gate.slice(1), 10) - 1) * 4 : 0);
const GATE_IDS = Array.from({ length: 8 }, (_, i) => `A${i + 1}`);

const COLOR = {
  atc: "#2cc7e4",
  pilot: "#ffb23a",
  ground: "#7ee787",
  crimson: "#ff3b30",
  amber: "#ffb23a",
  runway: "#30353d",
  ground_plane: "#1c2128",
  terminal: "#3b4350",
};

const RUNWAY_DRY = new THREE.Color(COLOR.runway);
const RUNWAY_CLOSED = new THREE.Color("#6a1612");
const RUNWAY_OPEN = new THREE.Color("#1f5a34");

// Camera keyframes per phase: [position, lookAt]. Disruption has one per subsystem.
type Key = [[number, number, number], [number, number, number]];
const CAM: Record<string, Key> = {
  intro: [[-6, 34, 58], [0, 0, 0]],
  title: [[-40, 26, 58], [-30, 2, 0]],
  "disruption-ROUTINE": [[2, 15, 22], [-6, 0, -9]],
  "disruption-WEATHER": [[-132, 14, 26], [-100, 8, 0]],
  "disruption-EMERGENCY": [[-14, 11, 24], [-24, 3, 2]],
  validators: [[0, 50, 20], [0, 0, -4]],
  negotiation: [[-36, 24, 46], [-40, 6, 4]],
  outcome: [[6, 16, 30], [-10, 0, -4]],
  outro: [[28, 42, 56], [0, 0, -2]],
};

class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Fit a generated GLB to its spec: turn it, scale its longest side to
 * `spec.size`, then centre it (aircraft, drone) or stand it on y = 0. */
function FittedGltf({ spec, scale }: { spec: ModelSpec; scale: number }) {
  const { scene } = useGLTF(spec.src);
  const object = useMemo(() => {
    const root = scene.clone(true);
    if (spec.rotation) root.rotation.set(...spec.rotation);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, spec.anchor === "center" ? -center.y : -box.min.y, -center.z);
    const fitted = new THREE.Group();
    fitted.add(root);
    fitted.scale.setScalar(spec.size / Math.max(size.x, size.y, size.z, 1e-6));
    return fitted;
  }, [scene, spec]);
  return (
    <group scale={scale}>
      <primitive object={object} />
    </group>
  );
}

/** A GLB from lib/models.ts if one is registered, else the primitive fallback. */
function Model({ name, scale = 1, children }: { name: ModelName; scale?: number; children: ReactNode }) {
  const spec = MODELS[name];
  if (!spec) return <>{children}</>;
  return (
    <ModelBoundary fallback={children}>
      <Suspense fallback={children}>
        <FittedGltf spec={spec} scale={scale} />
      </Suspense>
    </ModelBoundary>
  );
}

function Plane({ scale = 1, variant = "airliner" }: { scale?: number; variant?: "airliner" | "airlinerB" }) {
  return (
    <Model name={variant} scale={scale}>
      <group scale={scale}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.32, 2.6, 4, 12]} />
          <meshStandardMaterial color="#d9dde3" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0.1, 0, 0]}>
          <boxGeometry args={[0.7, 0.06, 3.4]} />
          <meshStandardMaterial color="#d9dde3" />
        </mesh>
        <mesh position={[-1.4, 0.45, 0]}>
          <boxGeometry args={[0.45, 0.8, 0.06]} />
          <meshStandardMaterial color="#d9dde3" />
        </mesh>
      </group>
    </Model>
  );
}

/** A text label drawn to a canvas and shown as a sprite: no DOM roots, nothing to fetch. */
function Label({ text, color, scale = 1, boxed = true }: { text: string; color: string; scale?: number; boxed?: boolean }) {
  const { material, aspect } = useMemo(() => {
    const fs = 44;
    const font = `500 ${fs}px "Geist Mono", ui-monospace, Menlo, monospace`;
    const probe = document.createElement("canvas").getContext("2d")!;
    probe.font = font;
    const c = document.createElement("canvas");
    c.width = Math.ceil(probe.measureText(text).width + fs * 1.2);
    c.height = Math.ceil(fs * 1.8);
    const g = c.getContext("2d")!;
    if (boxed) {
      g.fillStyle = "rgba(9,10,12,0.85)";
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
    }
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = "middle";
    g.fillText(text, fs * 0.6, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { material: new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }), aspect: c.width / c.height };
  }, [text, color, boxed]);
  useEffect(() => () => {
    material.map?.dispose();
    material.dispose();
  }, [material]);
  return <sprite material={material} scale={[0.9 * scale * aspect, 0.9 * scale, 1]} />;
}

// ---------------------------------------------------------------- weather

const RAIN_DROPS = 5000;
const RAIN_BOX = { x: [-110, 30], y: [0, 32], z: [-30, 40] } as const;

// Starting positions for every drop, built once at module load (client-only module).
const RAIN_START = (() => {
  const pos = new Float32Array(RAIN_DROPS * 6);
  for (let i = 0; i < RAIN_DROPS; i++) {
    const x = RAIN_BOX.x[0] + Math.random() * (RAIN_BOX.x[1] - RAIN_BOX.x[0]);
    const y = RAIN_BOX.y[0] + Math.random() * (RAIN_BOX.y[1] - RAIN_BOX.y[0]);
    const z = RAIN_BOX.z[0] + Math.random() * (RAIN_BOX.z[1] - RAIN_BOX.z[0]);
    pos.set([x, y, z, x + 0.25, y + 0.9, z], i * 6);
  }
  return pos;
})();

/** Instanced rain: one LineSegments buffer, recycled in place, no per-frame allocation. */
function Rain({ intensity, reduced }: { intensity: React.RefObject<number>; reduced: boolean }) {
  const lines = useRef<THREE.LineSegments>(null);
  const mat = useRef<THREE.LineBasicMaterial>(null);

  useFrame((_, dt) => {
    const ls = lines.current;
    if (!ls || !mat.current) return;
    const k = intensity.current ?? 0;
    mat.current.opacity = 0.45 * k;
    ls.geometry.setDrawRange(0, Math.floor(RAIN_DROPS * k) * 2);
    ls.visible = k > 0.02;
    if (reduced || k <= 0.02) return;
    const attr = ls.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const fall = 34 * Math.min(dt, 0.05);
    const drift = -fall * 0.28; // wind slants the drops
    const n = Math.floor(RAIN_DROPS * k);
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      arr[o + 1] -= fall;
      arr[o + 4] -= fall;
      arr[o] += drift;
      arr[o + 3] += drift;
      if (arr[o + 1] < 0) {
        const y = RAIN_BOX.y[1];
        arr[o + 1] = y;
        arr[o + 4] = y + 0.9;
        const x = RAIN_BOX.x[0] + Math.random() * (RAIN_BOX.x[1] - RAIN_BOX.x[0]);
        arr[o] = x;
        arr[o + 3] = x + 0.25;
      }
    }
    attr.needsUpdate = true;
  });
  return (
    <lineSegments ref={lines} frustumCulled={false} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[RAIN_START, 3]} />
      </bufferGeometry>
      <lineBasicMaterial ref={mat} color="#a9bccf" transparent opacity={0} depthWrite={false} />
    </lineSegments>
  );
}

function cloudTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const CLOUDS = Array.from({ length: 14 }, (_, i) => ({
  x: -100 + ((i * 37) % 130),
  y: 19 + ((i * 7) % 6),
  z: -26 + ((i * 23) % 60),
  s: 26 + ((i * 11) % 18),
}));

function Clouds({ intensity, reduced }: { intensity: React.RefObject<number>; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const mats = useRef<(THREE.SpriteMaterial | null)[]>([]);
  const tex = useMemo(() => cloudTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame(({ clock }) => {
    const k = intensity.current ?? 0;
    mats.current.forEach((m) => {
      if (m) m.opacity = 0.55 * k;
    });
    if (group.current) {
      group.current.visible = k > 0.02;
      if (!reduced) group.current.position.x = (clock.elapsedTime * 0.6) % 20;
    }
  });
  return (
    <group ref={group} visible={false}>
      {CLOUDS.map((c, i) => (
        <sprite key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.45, 1]}>
          <spriteMaterial
            ref={(m) => { mats.current[i] = m; }}
            map={tex}
            color="#7d8898"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- choreography

const lerp3 = (out: THREE.Vector3, a: [number, number, number], b: [number, number, number], t: number) =>
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
const ease = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const FINAL: [number, number, number] = [-100, 12, 0];
const HOLD_ENTRY: [number, number, number] = [-60, 9, 0];
const HOLD_CENTER = { x: -60, y: 9, z: 10, r: 10 };

/** The shared landing: glide path, flare, touchdown, rollout, taxi to the agreed gate. */
function landingPos(out: THREE.Vector3, u: number, gx: number) {
  if (u < 0.35) {
    const t = u / 0.35;
    const x = HOLD_ENTRY[0] + (THRESHOLD_X + 4 - HOLD_ENTRY[0]) * t;
    // ~3° glide, then a flare over the last 15% to a soft touchdown.
    const glide = HOLD_ENTRY[1] * (1 - t);
    const flare = t > 0.85 ? (1 - (t - 0.85) / 0.15) * 0.4 : 0;
    return out.set(x, Math.max(GROUND_Y, glide + GROUND_Y * t + flare), 0);
  }
  if (u < 0.5) {
    const t = easeOut((u - 0.35) / 0.15);
    return out.set(THRESHOLD_X + 4 + (-8 - (THRESHOLD_X + 4)) * t, GROUND_Y, 0);
  }
  if (u < 0.58) {
    // Quadratic turn off the runway onto the taxiway.
    const t = (u - 0.5) / 0.08;
    const x = (1 - t) * (1 - t) * -8 + 2 * (1 - t) * t * -5 + t * t * -5;
    const z = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * 0 + t * t * TAXI_Z;
    return out.set(x, GROUND_Y, z);
  }
  if (u < 0.85) {
    const t = ease((u - 0.58) / 0.27);
    return out.set(-5 + (gx - -5) * t, GROUND_Y, TAXI_Z);
  }
  const t = ease((u - 0.85) / 0.15);
  return out.set(gx, GROUND_Y, TAXI_Z + (STAND_Z - TAXI_Z) * t);
}

/** Where the chapter's aircraft is during the beats before the outcome. */
function waitingPos(out: THREE.Vector3, v: number, holds: boolean) {
  if (!holds || v < 0.15) {
    const t = holds ? v / 0.15 : v;
    return lerp3(out, FINAL, HOLD_ENTRY, ease(t));
  }
  const th = -Math.PI / 2 + 2 * Math.PI * ((v - 0.15) / 0.85);
  return out.set(HOLD_CENTER.x + Math.cos(th) * HOLD_CENTER.r, HOLD_CENTER.y, HOLD_CENTER.z + Math.sin(th) * HOLD_CENTER.r);
}

function Scene({ chapters, reduced }: { chapters: (StoryChapter | null)[]; reduced: boolean }) {
  const { camera, size } = useThree();
  const fog = useRef<THREE.Fog>(null);

  // Shift the render right on wide screens so the left column of text never covers the action.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (size.width >= 900) cam.setViewOffset(size.width, size.height, -size.width * 0.17, 0, size.width, size.height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }, [camera, size]);

  const focal = useRef<THREE.Group>(null);
  const queue = useRef<THREE.Group>(null);
  const parked = useRef<THREE.Group>(null);
  const runwayMat = useRef<THREE.MeshStandardMaterial>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const droneA = useRef<THREE.Group>(null);
  const droneB = useRef<THREE.Group>(null);
  const droneLight = useRef<THREE.MeshStandardMaterial>(null);
  const pilotNode = useRef<THREE.Group>(null);
  const packets = useRef<THREE.Group>(null);
  const padMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const rain = useRef(0);
  const closure = useRef(0);
  const flash = useRef(0);
  const look = useMemo(() => new THREE.Vector3(), []);
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);

  const ATC_POS = useMemo(() => new THREE.Vector3(22, 13, -8), []);
  const GROUND_POS = useMemo(() => new THREE.Vector3(0, 4.2, -16), []);

  useFrame(({ clock }, dt) => {
    const p = director.scene;
    const t = clock.elapsedTime;
    const bi = beatAt(p);
    const beat = BEATS[bi];
    const u = beatProgress(p, bi);
    const story = beat.chapter !== null ? chapters[beat.chapter] : null;
    const run = story?.live ?? null;
    const sub = story?.subsystem ?? null;
    const phaseIdx = (PHASES as readonly string[]).indexOf(beat.phase);
    const chosen = run?.outcome.candidate ?? null;

    // ---- data-driven environment, eased over about a second
    const k = 1 - Math.exp(-3 * Math.min(dt, 0.1));
    const rainTarget = sub === "WEATHER" ? Math.min(1, Math.max(0.3, story?.derived.weather_share ?? 0.3)) : 0;
    rain.current += (rainTarget - rain.current) * k;
    const closed = sub === "EMERGENCY" && phaseIdx >= 1 && phaseIdx <= 3;
    closure.current += ((closed ? 1 : 0) - closure.current) * k;
    const reopened = sub === "EMERGENCY" && beat.phase === "outcome" && u < 0.3;

    if (!reduced && rain.current > 0.6 && Math.random() < dt / 7) flash.current = 1;
    flash.current = Math.max(0, flash.current - dt * 10);
    if (hemi.current) hemi.current.intensity = 1.15 * (1 - 0.5 * rain.current) + flash.current * 2.5;
    if (sun.current) sun.current.intensity = 1.7 * (1 - 0.45 * rain.current);
    if (fog.current) fog.current.far = 200 - 120 * rain.current;
    if (runwayMat.current) {
      if (reopened) runwayMat.current.color.copy(RUNWAY_OPEN);
      else runwayMat.current.color.copy(RUNWAY_DRY).lerp(RUNWAY_CLOSED, closure.current);
      runwayMat.current.roughness = 0.9 - 0.65 * rain.current; // wet runway
      runwayMat.current.metalness = 0.35 * rain.current;
    }

    // ---- camera
    const keyOf = (b: (typeof BEATS)[number]) => {
      if (b.phase === "disruption") {
        const s = b.chapter !== null ? chapters[b.chapter]?.subsystem : "ROUTINE";
        return CAM[`disruption-${s ?? "ROUTINE"}`];
      }
      return CAM[b.phase];
    };
    const next = BEATS[Math.min(bi + 1, BEATS.length - 1)];
    const f = ramp(u, 0.6, 1);
    const [pa, la] = keyOf(beat);
    const [pb, lb] = keyOf(next);
    lerp3(tmpA, pa, pb, f);
    camera.position.lerp(tmpA, 0.08);
    lerp3(tmpA, la, lb, f);
    look.lerp(tmpA, 0.08);
    camera.lookAt(look);

    // ---- the chapter's aircraft
    const g = focal.current;
    if (g) {
      const holds = (chosen?.metrics.hold_min ?? 0) > 0;
      const pose = (q: number, out: THREE.Vector3) => {
        if (beat.phase === "intro") return lerp3(out, [-130, 14, 0], FINAL, ease(u));
        if (beat.phase === "outro" || !run) return out.set(gateX(chapters[2]?.live.outcome.candidate?.gate ?? "A3"), GROUND_Y, STAND_Z);
        if (beat.phase === "title") return lerp3(out, [-130, 14, 0], FINAL, ease(q));
        if (beat.phase === "outcome") {
          if (chosen?.kind === "DIVERT") return lerp3(out, HOLD_ENTRY, [-130, 18, 60], ease(q));
          return landingPos(out, q, gateX(chosen?.gate));
        }
        return waitingPos(out, (phaseIdx - 1 + q) / 3, holds);
      };
      pose(u, g.position);
      pose(Math.min(1, u + 0.004), ahead);
      const dx = ahead.x - g.position.x;
      const dz = ahead.z - g.position.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) g.rotation.set(0, Math.atan2(-dz, dx), 0);
    }

    // ---- traffic sequenced ahead: spacing widens as the arrival cap drops; held during a closure
    const cap = run?.scenario.runway.arrival_cap_per_hr ?? 40;
    const normal = run?.scenario.runway.normal_cap_per_hr ?? 40;
    const ratio = cap / normal;
    queue.current?.children.forEach((c, i) => {
      if (closure.current > 0.5) {
        const th = t * 0.35 + (i * Math.PI) / 2;
        c.position.set(-78 + Math.cos(th) * 8, 12 + i * 1.6, 20 + Math.sin(th) * 8);
        c.rotation.set(0, -th - Math.PI / 2, -0.25);
        c.visible = true;
        return;
      }
      const spacing = 1 / (4 * ratio);
      const uu = (t * 0.016 * ratio + i * spacing) % 1;
      c.position.set(-140 + 100 * uu, 13 * (1 - uu) + 1.5, 0);
      c.rotation.set(0, 0, 0);
      c.visible = i < Math.max(2, Math.round(4 * ratio)) && uu < 0.92;
    });

    // ---- gates: amber clash on the planned gate (Routine), green on the agreed gate at the outcome
    const planned = run?.scenario.ground.planned_gate;
    GATE_IDS.forEach((id, i) => {
      const m = padMats.current[i];
      if (!m) return;
      const clash = sub === "ROUTINE" && id === planned && phaseIdx >= 1 && phaseIdx <= 3;
      const agreed = id === chosen?.gate && (beat.phase === "outcome" || beat.phase === "negotiation");
      m.color.set(agreed ? COLOR.ground : clash ? COLOR.amber : "#2a313b");
      m.emissive.set(agreed ? COLOR.ground : clash ? COLOR.amber : "#000000");
      m.emissiveIntensity = agreed || clash ? 0.35 + 0.25 * Math.sin(t * 4) : 0;
    });
    // Aircraft parked where the scenario says a gate is occupied at T0 (never the agreed gate).
    const busy = new Set(
      (run?.scenario.ground.gates ?? [])
        .filter((gt) => (gt.busy ?? []).some(([a, b]) => a <= 2 && b > 2) && gt.id !== chosen?.gate)
        .map((gt) => gt.id),
    );
    parked.current?.children.forEach((c, i) => (c.visible = busy.has(GATE_IDS[i])));

    // ---- drones over the closed runway (Emergency only); they leave when it reopens
    const leave = sub === "EMERGENCY" && beat.phase === "outcome" ? u * 30 : 0;
    const showDrones = sub === "EMERGENCY" && phaseIdx >= 1;
    if (droneA.current) {
      droneA.current.visible = showDrones;
      droneA.current.position.set(-24 + Math.sin(t) * 1.5, 3.4 + Math.sin(t * 2.3) * 0.35 + leave, 4);
    }
    if (droneB.current) {
      droneB.current.visible = showDrones;
      droneB.current.position.set(-10 + Math.cos(t * 0.8) * 2, 4.6 + Math.cos(t * 1.9) * 0.3 + leave, -2.5);
    }
    if (droneLight.current) droneLight.current.emissiveIntensity = Math.sin(t * 10) > 0 ? 4 : 0.2;

    // ---- agent nodes and message packets while they negotiate
    if (pilotNode.current && g) pilotNode.current.position.copy(g.position).add(tmpB.set(0, 1.6, 0));
    const talking = beat.phase === "validators" || beat.phase === "negotiation";
    packets.current?.children.forEach((c, i) => {
      const ends = [ATC_POS, pilotNode.current?.position ?? ATC_POS, GROUND_POS];
      const u2 = (t * 0.6 + i * 0.37) % 1;
      c.position.lerpVectors(ends[i % 3], ends[(i + 1) % 3], u2);
      c.visible = talking;
    });
  });

  return (
    <>
      <color attach="background" args={["#090a0c"]} />
      <fog ref={fog} attach="fog" args={["#0b0e12", 60, 200]} />
      <hemisphereLight ref={hemi} args={["#c9d6e6", "#1a1f26", 1.15]} />
      <directionalLight ref={sun} position={[20, 40, 20]} intensity={1.7} />

      {/* Ground, runway, threshold stripes, centreline, edge lights */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color={COLOR.ground_plane} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[64, 3.2]} />
        <meshStandardMaterial ref={runwayMat} color={COLOR.runway} roughness={0.9} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`th${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[THRESHOLD_X - 0.8, 0.012, -1.25 + i * 0.5]}>
          <planeGeometry args={[1.6, 0.22]} />
          <meshStandardMaterial color="#e6e9ee" />
        </mesh>
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={`cl${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-27 + i * 4.3, 0.01, 0]}>
          <planeGeometry args={[1.6, 0.12]} />
          <meshStandardMaterial color="#aeb6c0" />
        </mesh>
      ))}
      {Array.from({ length: 17 }, (_, i) =>
        [-1.75, 1.75].map((z) => (
          <mesh key={`el${i}${z}`} position={[-32 + i * 4, 0.08, z]}>
            <boxGeometry args={[0.18, 0.12, 0.18]} />
            <meshStandardMaterial color="#dff6ff" emissive="#bfeeff" emissiveIntensity={1.6} />
          </mesh>
        )),
      )}
      {/* Taxiway line and stubs to each stand */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3, 0.012, TAXI_Z]}>
        <planeGeometry args={[34, 0.14]} />
        <meshStandardMaterial color="#e3b341" emissive="#e3b341" emissiveIntensity={0.25} />
      </mesh>
      {GATE_IDS.map((id) => (
        <mesh key={`stub${id}`} rotation={[-Math.PI / 2, 0, 0]} position={[gateX(id), 0.012, (TAXI_Z + STAND_Z) / 2 - 0.4]}>
          <planeGeometry args={[0.12, Math.abs(STAND_Z - TAXI_Z) + 0.8]} />
          <meshStandardMaterial color="#e3b341" emissive="#e3b341" emissiveIntensity={0.25} />
        </mesh>
      ))}

      {/* Terminal, stands, jet bridges, parked aircraft */}
      <mesh position={[0, 1.6, -16]}>
        <boxGeometry args={[36, 3.2, 6]} />
        <meshStandardMaterial color={COLOR.terminal} emissive="#1d2530" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0, 2.2, -12.95]}>
        <boxGeometry args={[36, 1.2, 0.08]} />
        <meshStandardMaterial color="#9fd6e8" emissive="#5fb7d6" emissiveIntensity={0.35} />
      </mesh>
      {GATE_IDS.map((id, i) => (
        <group key={id} position={[gateX(id), 0, GATE_Z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.6]}>
            <planeGeometry args={[3.2, 4.4]} />
            <meshStandardMaterial ref={(m) => { padMats.current[i] = m; }} color="#2a313b" transparent opacity={0.7} />
          </mesh>
          <group position={[0.9, 0, -2.2]}>
            <Model name="jetbridge">
              <mesh position={[0, 1, 0]}>
                <boxGeometry args={[0.6, 0.6, 2]} />
                <meshStandardMaterial color="#5a6270" />
              </mesh>
            </Model>
          </group>
          <group position={[0, 0.5, 3.1]}>
            <Label text={id} color="#9aa4b0" scale={0.6} boxed={false} />
          </group>
        </group>
      ))}
      <group ref={parked}>
        {GATE_IDS.map((id) => (
          <group key={`p${id}`} position={[gateX(id), GROUND_Y, STAND_Z]} rotation={[0, Math.PI / 2, 0]} visible={false}>
            <Plane variant="airlinerB" scale={0.95} />
          </group>
        ))}
      </group>

      {/* Control tower = ATC; approach radar; joint-use apron in the far corner */}
      <group position={[22, 0, -8]}>
        <Model name="tower" scale={1.2}>
          <mesh position={[0, 4, 0]}>
            <cylinderGeometry args={[0.6, 0.9, 8, 12]} />
            <meshStandardMaterial color="#2b313b" />
          </mesh>
        </Model>
      </group>
      <group position={[36, 0, 12]}>
        <Model name="radarTower">
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[0.5, 0.8, 6, 10]} />
            <meshStandardMaterial color="#2b313b" />
          </mesh>
        </Model>
        <group position={[0, 8.5, 0]}>
          <Label text="APPROACH RADAR" color="#8d97a3" />
        </group>
      </group>
      <group position={[46, 0, -32]} rotation={[0, -Math.PI / 5, 0]}>
        <Model name="jointApron">
          <mesh position={[0, 2, 0]}>
            <boxGeometry args={[8, 4, 6]} />
            <meshStandardMaterial color="#2b313b" />
          </mesh>
        </Model>
        <group position={[0, 7, 0]}>
          <Label text="JOINT-USE APRON" color="#8d97a3" />
        </group>
      </group>

      {/* Agent nodes with labels */}
      <group position={ATC_POS}>
        <mesh>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshStandardMaterial color={COLOR.atc} emissive={COLOR.atc} emissiveIntensity={1.5} />
        </mesh>
        <group position={[0, 1.4, 0]}>
          <Label text="ATC" color={COLOR.atc} />
        </group>
      </group>
      <group ref={pilotNode}>
        <mesh>
          <sphereGeometry args={[0.45, 20, 20]} />
          <meshStandardMaterial color={COLOR.pilot} emissive={COLOR.pilot} emissiveIntensity={1.5} />
        </mesh>
        <group position={[0, 1.2, 0]}>
          <Label text="PILOT" color={COLOR.pilot} />
        </group>
      </group>
      <group position={GROUND_POS}>
        <mesh>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshStandardMaterial color={COLOR.ground} emissive={COLOR.ground} emissiveIntensity={1.5} />
        </mesh>
        <group position={[0, 1.4, 0]}>
          <Label text="GROUND" color={COLOR.ground} />
        </group>
      </group>
      <group ref={packets}>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.2, 10, 10]} />
            <meshBasicMaterial color={[COLOR.atc, COLOR.pilot, COLOR.ground][i % 3]} />
          </mesh>
        ))}
      </group>

      {/* The chapter's flight and the traffic around it */}
      <group ref={focal}>
        <Plane scale={1.2} />
      </group>
      <group ref={queue}>
        {Array.from({ length: 4 }, (_, i) => (
          <group key={i}>
            <Plane scale={0.85} variant={i % 2 ? "airlinerB" : "airliner"} />
          </group>
        ))}
      </group>

      {/* Emergency: two drone sightings near the threshold */}
      <group ref={droneA} visible={false}>
        <Model name="drone" scale={0.6}>
          <mesh>
            <boxGeometry args={[0.5, 0.12, 0.5]} />
            <meshStandardMaterial color="#444" />
          </mesh>
        </Model>
        <mesh position={[0, -0.3, 0]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshStandardMaterial ref={droneLight} color={COLOR.crimson} emissive={COLOR.crimson} />
        </mesh>
      </group>
      <group ref={droneB} visible={false}>
        <Model name="droneDark" scale={0.6}>
          <mesh>
            <boxGeometry args={[0.5, 0.12, 0.5]} />
            <meshStandardMaterial color="#333" />
          </mesh>
        </Model>
      </group>

      <Rain intensity={rain} reduced={reduced} />
      <Clouds intensity={rain} reduced={reduced} />
    </>
  );
}

export default function Airfield({ chapters }: { chapters: (StoryChapter | null)[] }) {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <Canvas camera={{ position: [-6, 34, 58], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
      <Scene chapters={chapters} reduced={reduced} />
    </Canvas>
  );
}
