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

export type ModelName = "airliner" | "tower" | "drone" | "jetbridge" | "tug";

// Example once the files exist:
//   airliner: { src: "/models/airliner.glb", size: 3.4, rotation: [0, -Math.PI / 2, 0], anchor: "center" },
//   tower: { src: "/models/tower.glb", size: 9.5 },
//   drone: { src: "/models/drone.glb", size: 1.2, anchor: "center" },
//   jetbridge: { src: "/models/jetbridge.glb", size: 2.5 },
//   tug: { src: "/models/tug.glb", size: 1.0 },
export const MODELS: Partial<Record<ModelName, ModelSpec>> = {};
