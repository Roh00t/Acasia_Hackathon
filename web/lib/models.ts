// Optimised GLBs available in public/models/. A missing entry means the scene
// uses primitive geometry for that object. After `npm run models:optimize`,
// register the output file here.
//
// Generated models arrive at arbitrary scale and facing, so each entry says how
// big the model should be in world units (longest side) and how to turn it so
// the nose points +x and the top points +y. The scene fits and grounds it.
export type ModelSpec = {
  src: string;
  /** Longest bounding-box side in world units. */
  size: number;
  /** Euler rotation [x, y, z] in radians applied before fitting. */
  rotation?: [number, number, number];
  /** "center" for things in the air (matches the primitives), "ground" (default) to stand on y = 0. */
  anchor?: "center" | "ground";
};

export type ModelName =
  | "airliner" | "airlinerB" | "tower" | "radarTower" | "drone" | "droneDark" | "jetbridge" | "jointApron";

// Optimised from assets/raw with: npm run models:optimize -- "<raw>.glb=<name>:<triangle budget>"
//   airliner      Meshy commercial airliner          209k → 12k triangles
//   airliner-b    Meshy low-poly commercial jet      285k → 10k
//   control-tower commercial control tower           587k → 20k
//   radar-tower   C2 tower with radar (approach radar) 831k → 20k
//   drone         consumer quadcopter                383k →  8k
//   drone-dark    dark quadcopter (second sighting)  445k →  8k
//   jetbridge     low-poly boarding bridge           920k → 12k
//   joint-apron   ground node (joint-use apron)      900k → 15k
// Both airliners' raw noses point -x, so they turn 180° to face +x like the scene.
export const MODELS: Partial<Record<ModelName, ModelSpec>> = {
  airliner: { src: "/models/airliner.glb", size: 3.4, rotation: [0, Math.PI, 0], anchor: "center" },
  airlinerB: { src: "/models/airliner-b.glb", size: 3.2, rotation: [0, Math.PI, 0], anchor: "center" },
  tower: { src: "/models/control-tower.glb", size: 9.5 },
  radarTower: { src: "/models/radar-tower.glb", size: 7 },
  drone: { src: "/models/drone.glb", size: 3.2, anchor: "center" },
  droneDark: { src: "/models/drone-dark.glb", size: 2.6, anchor: "center" },
  jetbridge: { src: "/models/jetbridge.glb", size: 3.6, rotation: [0, Math.PI / 2, 0] },
  jointApron: { src: "/models/joint-apron.glb", size: 9 },
};
