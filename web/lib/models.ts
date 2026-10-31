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

export type ModelName = "airliner" | "radarMast" | "quadcopter" | "hangar" | "jetbridge";

export const MODELS: Partial<Record<ModelName, ModelSpec>> = {
  airliner: {
    src: "/models/Airliner-opt.glb",
    size: 3.4,
    rotation: [0, -Math.PI / 2, 0],
    anchor: "center",
  },
  radarMast: { src: "/models/RadarMast-opt.glb", size: 9.5 },
  quadcopter: { src: "/models/Quadcopter-opt.glb", size: 1.2, anchor: "center" },
  hangar: { src: "/models/Hangar-opt.glb", size: 18 },
};
