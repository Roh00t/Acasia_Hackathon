// Optimizes raw Meshy / OpenGen exports in ../assets/raw/*.glb (gitignored)
// into public/models/ for the scroll story. Usage: npm run models:optimize
// Then add the file name to MODELS in lib/models.ts so the scene loads it.
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, quantize, meshopt, resample, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const RAW = "../assets/raw";
const OUT = "public/models";

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
await mkdir(OUT, { recursive: true });

for (const file of (await readdir(RAW)).filter((f) => f.toLowerCase().endsWith(".glb"))) {
  const doc = await io.read(path.join(RAW, file));
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder }),
  );
  const out = path.join(OUT, file.toLowerCase().replace(/\s+/g, "-"));
  await io.write(out, doc);
  console.log(`optimized ${file} -> ${out}`);
}
