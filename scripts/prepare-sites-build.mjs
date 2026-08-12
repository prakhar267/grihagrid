#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");
const migrations = path.join(root, "migrations");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

const packagedMigrations = path.join(dist, ".openai", "drizzle");
rmSync(packagedMigrations, { force: true, recursive: true });
mkdirSync(packagedMigrations, { recursive: true });
for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
  copyFileSync(path.join(migrations, file), path.join(packagedMigrations, file));
}

console.log("Prepared Sites build with Worker, hosting metadata, and D1 migrations");
