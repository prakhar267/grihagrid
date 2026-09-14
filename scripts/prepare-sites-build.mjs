#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const architectReport = path.join(root, "src", "architect-report.js");
const hosting = path.join(root, ".openai", "hosting.json");
const migrations = path.join(root, "migrations");

for (const file of [index, worker, architectReport, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, "src"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(architectReport, path.join(dist, "src", "architect-report.js"));
for (const file of ["spatial.js", "spatial-intent.js", "spatial-viewpoints.js"]) copyFileSync(path.join(root, "worker", file), path.join(dist, "server", file));
mkdirSync(path.join(dist, "src", "spatial"), { recursive: true });
for (const file of readdirSync(path.join(root, "src", "spatial")).filter(name => name.endsWith(".js"))) {
  copyFileSync(path.join(root, "src", "spatial", file), path.join(dist, "src", "spatial", file));
}
// Sites artifacts must resolve geometry imports without the checkout's node_modules.
const triangulation = path.join(dist, "vendor", "three", "extras");
mkdirSync(path.join(triangulation, "lib"), { recursive: true });
copyFileSync(path.join(root, "node_modules/three/src/extras/Earcut.js"), path.join(triangulation, "Earcut.js"));
copyFileSync(path.join(root, "node_modules/three/src/extras/lib/earcut.js"), path.join(triangulation, "lib", "earcut.js"));
copyFileSync(path.join(root, "node_modules/three/LICENSE"), path.join(triangulation, "LICENSE-THREE.txt"));
copyFileSync(path.join(root, "public/licenses/Earcut-3.0.2.txt"), path.join(triangulation, "LICENSE-EARCUT.txt"));
const spatialModel = path.join(dist, "src", "spatial", "model-v2.js");
writeFileSync(spatialModel, readFileSync(spatialModel, "utf8").replace("'three/src/extras/Earcut.js'", "'../../vendor/three/extras/Earcut.js'"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

const packagedMigrations = path.join(dist, ".openai", "drizzle");
rmSync(packagedMigrations, { force: true, recursive: true });
mkdirSync(packagedMigrations, { recursive: true });
for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
  copyFileSync(path.join(migrations, file), path.join(packagedMigrations, file));
}

console.log("Prepared Sites build with Worker, hosting metadata, and D1 migrations");
