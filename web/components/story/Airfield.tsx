"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Component, Suspense, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { director } from "@/lib/sceneDirector";
import { BEATS, ramp } from "@/lib/beats";
import { MODELS, type ModelName, type ModelSpec } from "@/lib/models";
import type { Run } from "@/lib/types";

// World layout: runway along +x with the threshold at x = -30; approach from -x.
const THRESHOLD = new THREE.Vector3(-30, 0, 0);
const GATE_Z = -10;
const gateX = (gate: string | null | undefined) => (gate ? -14 + (parseInt(gate.slice(1), 10) - 1) * 4 : 0);

const COLOR = {
  atc: "#00e5ff",
  pilot: "#ffb020",
  ground: "#7ee787",
  crimson: "#ff3b30",
  runway: "#2a2f38",
  concrete: "#171b21",
  body: "#d9dde3",
};

// Camera keyframes, one per beat: [position, lookAt].
const CAMERA: [number, number, number][][] = [
  [[-6, 34, 58], [0, 0, 0]],
  [[-48, 16, 34], [-48, 6, 4]],
  [[-18, 14, 30], [-30, 3, 0]],
  [[0, 52, 18], [0, 0, -4]],
  [[-34, 20, 42], [-40, 6, 4]],
  [[-12, 22, 38], [-22, 5, -3]],
  [[8, 16, 26], [-2, 0, -6]],
  [[28, 42, 56], [0, 0, -2]],
];

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

function Plane({ color = COLOR.body, scale = 1 }: { color?: string; scale?: number }) {
  return (
    <Model name="airliner" scale={scale}>
      <group scale={scale}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.32, 2.6, 4, 12]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0.1, 0, 0]}>
          <boxGeometry args={[0.7, 0.06, 3.4]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[-1.4, 0.45, 0]}>
          <boxGeometry args={[0.45, 0.8, 0.06]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[-1.4, 0.1, 0]}>
          <boxGeometry args={[0.35, 0.05, 1.2]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
    </Model>
  );
}

function Drone({ refObj }: { refObj: React.RefObject<THREE.Group | null> }) {
  const light = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.emissiveIntensity = Math.sin(clock.elapsedTime * 10) > 0 ? 4 : 0.2;
  });
  return (
    <group ref={refObj}>
      <Model name="drone" scale={0.6}>
        <mesh>
          <boxGeometry args={[0.5, 0.12, 0.5]} />
          <meshStandardMaterial color="#444" />
        </mesh>
        {[[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.08, z]}>
            <cylinderGeometry args={[0.22, 0.22, 0.02, 16]} />
            <meshStandardMaterial color="#666" transparent opacity={0.6} />
          </mesh>
        ))}
      </Model>
      <mesh position={[0, -0.15, 0]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial ref={light} color={COLOR.crimson} emissive={COLOR.crimson} />
      </mesh>
    </group>
  );
}

function Scene({ run }: { run: Run | null }) {
  const { camera } = useThree();
  const sub = run?.scenario.subsystem ?? "ROUTINE";
  const chosen = run?.outcome.candidate;
  const diverts = chosen?.kind === "DIVERT";
  const finalGate = gateX(chosen?.gate);
  const planned = run?.scenario.ground.planned_gate ?? "A3";
  const gateIds = (run?.scenario.ground.gates ?? Array.from({ length: 8 }, (_, i) => ({ id: `A${i + 1}` }))).map((g) => g.id);

  const focal = useRef<THREE.Group>(null);
  const queue = useRef<THREE.Group>(null);
  const runwayMat = useRef<THREE.MeshStandardMaterial>(null);
  const storm = useRef<THREE.Group>(null);
  const drone = useRef<THREE.Group>(null);
  const pilotNode = useRef<THREE.Mesh>(null);
  const packets = useRef<THREE.Group>(null);
  const look = useMemo(() => new THREE.Vector3(), []);
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);

  const ATC_POS = useMemo(() => new THREE.Vector3(22, 9.5, -8), []);
  const GROUND_POS = useMemo(() => new THREE.Vector3(0, 3.5, -16), []);

  useFrame(({ clock }) => {
    const p = director.scene;
    const time = clock.elapsedTime;

    // ---- camera: blend between the keyframes of the two beats around p
    let i = 0;
    for (let k = 0; k < BEATS.length; k++) if (p >= BEATS[k].at) i = k;
    const j = Math.min(i + 1, BEATS.length - 1);
    const span = (BEATS[j]?.at ?? 1) - BEATS[i].at || 1;
    const f = ramp(p, BEATS[i].at + span * 0.55, BEATS[i].at + span);
    tmpA.fromArray(CAMERA[i][0]).lerp(tmpB.fromArray(CAMERA[j][0]), f);
    camera.position.lerp(tmpA, 0.12);
    tmpA.fromArray(CAMERA[i][1]).lerp(tmpB.fromArray(CAMERA[j][1]), f);
    look.lerp(tmpA, 0.12);
    camera.lookAt(look);

    // ---- focal aircraft: approach, hold, then land + taxi or divert
    const g = focal.current;
    if (g) {
      const holdStart = BEATS[2].at;
      const outcome = BEATS[6].at;
      const center = tmpB.set(-55, 9, 14);
      if (p < holdStart) {
        const a = ramp(p, 0, holdStart);
        g.position.set(-95 + 40 * a, 14 - 5 * a, 0);
        g.rotation.set(0, 0, 0);
      } else if (p < outcome) {
        const ang = time * 0.45;
        g.position.set(center.x + Math.cos(ang) * 10, center.y, center.z + Math.sin(ang) * 10);
        g.rotation.set(0, -ang - Math.PI / 2, -0.25);
      } else if (diverts) {
        const a = ramp(p, outcome, outcome + 0.1);
        g.position.set(-55 - 50 * a, 9 + 8 * a, 14 + 40 * a);
        g.rotation.set(0, Math.PI * 0.8, 0);
      } else {
        const land = ramp(p, outcome, outcome + 0.05);
        const taxi = ramp(p, outcome + 0.05, outcome + 0.11);
        if (taxi <= 0) {
          g.position.lerpVectors(tmpA.set(-60, 8, 0), tmpB.set(THRESHOLD.x + 12, 0.35, 0), land);
          g.rotation.set(0, 0, 0);
        } else {
          g.position.lerpVectors(tmpA.set(THRESHOLD.x + 12, 0.35, 0), tmpB.set(finalGate, 0.35, GATE_Z + 2), taxi);
          g.rotation.set(0, Math.atan2(-(GATE_Z + 2), finalGate - (THRESHOLD.x + 12)) * taxi, 0);
        }
      }
    }

    // ---- traffic sequenced ahead: a slow conveyor down the approach
    queue.current?.children.forEach((c, k) => {
      const u = ((time * 0.02 + k / 5) % 1);
      c.position.set(-90 + 60 * u, 10 * (1 - u) + 0.4, 0);
      c.visible = !(sub === "EMERGENCY" && p >= BEATS[2].at && p < BEATS[6].at && u > 0.8);
    });

    // ---- disruption visuals
    const disrupt = ramp(p, BEATS[2].at - 0.04, BEATS[2].at + 0.04) * (1 - ramp(p, BEATS[6].at, BEATS[6].at + 0.06));
    if (storm.current) {
      storm.current.visible = sub === "WEATHER" && disrupt > 0.01;
      storm.current.scale.setScalar(0.2 + disrupt);
      storm.current.rotation.y = time * 0.05;
    }
    if (drone.current) {
      drone.current.visible = sub === "EMERGENCY" && disrupt > 0.01;
      drone.current.position.set(-24 + Math.sin(time) * 1.5, 3 + Math.sin(time * 2.3) * 0.4, 4);
    }
    if (runwayMat.current) {
      runwayMat.current.color.set(sub === "EMERGENCY" && disrupt > 0.3 ? "#5a1512" : COLOR.runway);
    }

    // ---- agent nodes and message packets during the negotiation beats
    if (pilotNode.current && g) pilotNode.current.position.copy(g.position).add(tmpA.set(0, 1.4, 0));
    const talk = ramp(p, BEATS[4].at - 0.02, BEATS[4].at + 0.02) * (1 - ramp(p, BEATS[6].at - 0.02, BEATS[6].at + 0.02));
    packets.current?.children.forEach((c, k) => {
      const ends = [ATC_POS, pilotNode.current?.position ?? ATC_POS, GROUND_POS];
      const from = ends[k % 3];
      const to = ends[(k + 1) % 3];
      const u = (time * 0.6 + k * 0.37) % 1;
      c.position.lerpVectors(from, to, u);
      c.visible = talk > 0.05;
    });
  });

  return (
    <>
      <color attach="background" args={["#090a0c"]} />
      <fog attach="fog" args={["#090a0c", 60, 170]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 40, 20]} intensity={1.4} />

      {/* Ground, runway, centreline */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={COLOR.concrete} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[64, 3]} />
        <meshStandardMaterial ref={runwayMat} color={COLOR.runway} />
      </mesh>
      {Array.from({ length: 14 }, (_, k) => (
        <mesh key={k} rotation={[-Math.PI / 2, 0, 0]} position={[-28 + k * 4.3, 0.01, 0]}>
          <planeGeometry args={[1.6, 0.12]} />
          <meshStandardMaterial color="#9aa3ad" />
        </mesh>
      ))}

      {/* Terminal and gates */}
      <mesh position={[0, 1.5, -16]}>
        <boxGeometry args={[36, 3, 6]} />
        <meshStandardMaterial color="#1f242d" />
      </mesh>
      {gateIds.map((id) => {
        const x = gateX(id);
        const isPlanned = id === planned;
        const isChosen = chosen?.gate === id;
        return (
          <group key={id} position={[x, 0, GATE_Z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
              <planeGeometry args={[3, 4]} />
              <meshStandardMaterial
                color={isChosen ? COLOR.ground : sub === "ROUTINE" && isPlanned ? COLOR.crimson : "#262c35"}
                transparent
                opacity={0.55}
              />
            </mesh>
            <Model name="jetbridge">
              <mesh position={[0, 1, -2.4]}>
                <boxGeometry args={[0.6, 0.6, 2]} />
                <meshStandardMaterial color="#3a414c" />
              </mesh>
            </Model>
            {sub === "ROUTINE" && isPlanned && (
              <group position={[0, 0.35, 0.5]} rotation={[0, Math.PI / 2, 0]}>
                <Plane color="#8b949e" scale={0.9} />
              </group>
            )}
          </group>
        );
      })}

      {/* Tower = ATC */}
      <group position={[22, 0, -8]}>
        <Model name="tower" scale={1.2}>
          <mesh position={[0, 4, 0]}>
            <cylinderGeometry args={[0.6, 0.9, 8, 12]} />
            <meshStandardMaterial color="#2b313b" />
          </mesh>
          <mesh position={[0, 8.6, 0]}>
            <cylinderGeometry args={[1.6, 1.2, 1.4, 8]} />
            <meshStandardMaterial color="#1b3a44" emissive={COLOR.atc} emissiveIntensity={0.15} />
          </mesh>
        </Model>
      </group>

      {/* Agent nodes */}
      <mesh position={ATC_POS}>
        <sphereGeometry args={[0.55, 20, 20]} />
        <meshStandardMaterial color={COLOR.atc} emissive={COLOR.atc} emissiveIntensity={1.5} />
      </mesh>
      <mesh ref={pilotNode}>
        <sphereGeometry args={[0.45, 20, 20]} />
        <meshStandardMaterial color={COLOR.pilot} emissive={COLOR.pilot} emissiveIntensity={1.5} />
      </mesh>
      <mesh position={GROUND_POS}>
        <sphereGeometry args={[0.55, 20, 20]} />
        <meshStandardMaterial color={COLOR.ground} emissive={COLOR.ground} emissiveIntensity={1.5} />
      </mesh>
      <group ref={packets}>
        {Array.from({ length: 9 }, (_, k) => (
          <mesh key={k}>
            <sphereGeometry args={[0.18, 10, 10]} />
            <meshBasicMaterial color={[COLOR.atc, COLOR.pilot, COLOR.ground][k % 3]} />
          </mesh>
        ))}
      </group>

      {/* Focal flight and the sequence */}
      <group ref={focal}>
        <Plane color="#ffffff" scale={1.2} />
      </group>
      <group ref={queue}>
        {Array.from({ length: 5 }, (_, k) => (
          <group key={k}>
            <Plane color="#6b7480" scale={0.8} />
          </group>
        ))}
      </group>

      {/* Disruptions */}
      <group ref={storm} position={[-48, 7, 2]}>
        {[[0, 0, 0, 6], [5, 1, 4, 4.5], [-6, -1, -3, 5], [2, 2, -6, 4]].map(([x, y, z, r], k) => (
          <mesh key={k} position={[x, y, z]}>
            <sphereGeometry args={[r, 16, 16]} />
            <meshStandardMaterial color="#2c3440" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <Drone refObj={drone} />
    </>
  );
}

export default function Airfield({ run }: { run: Run | null }) {
  return (
    <Canvas camera={{ position: [-6, 34, 58], fov: 42 }} dpr={[1, 1.75]} gl={{ antialias: true }}>
      <Scene run={run} />
    </Canvas>
  );
}
