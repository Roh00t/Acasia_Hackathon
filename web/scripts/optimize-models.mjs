// Optimizes raw Meshy / OpenGen exports in ../assets/raw/ (gitignored) into
// public/models/ for the scroll story. Then register the output in lib/models.ts.
//
//   npm run models:optimize                                  every .glb, 50% triangles, lowercase names
//   npm run models:optimize -- "Raw File.glb=airliner:12000"  one file, output name, triangle budget
import { readdir, mkdir, stat } from "node:fs/promises";
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

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3;
    }
  return tris;
}

// "file.glb=name:budget" → { file, name, budget }
const jobs = process.argv.slice(2).length
  ? process.argv.slice(2).map((arg) => {
      const [file, rest = ""] = arg.split("=");
      const [name, budget] = rest.split(":");
      return { file, name: name || null, budget: budget ? Number(budget) : null };
    })
  : (await readdir(RAW)).filter((f) => f.toLowerCase().endsWith(".glb")).map((file) => ({ file, name: null, budget: null }));

for (const { file, name, budget } of jobs) {
  const doc = await io.read(path.join(RAW, file));
  const before = countTriangles(doc);
  const ratio = budget ? Math.min(1, budget / before) : 0.5;
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: budget ? 0.02 : 0.001 }),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder }),
  );
  const out = path.join(OUT, `${name ?? path.parse(file).name.toLowerCase().replace(/\s+/g, "-")}.glb`);
  await io.write(out, doc);
  const kb = Math.round((await stat(out)).size / 1024);
  console.log(`optimized ${file} -> ${out}  (${before.toLocaleString()} → ${countTriangles(doc).toLocaleString()} triangles, ${kb} KB)`);
}
