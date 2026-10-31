// Optimised GLBs available in public/models/. Empty means the scene uses
// primitive geometry for everything. After `npm run models:optimize`, add the
// output file name here, e.g. airliner: "/models/airliner.glb".
export const MODELS: Partial<Record<"airliner" | "tower" | "drone" | "jetbridge" | "tug", string>> = {};
