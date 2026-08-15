#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const [aggregatorScript, outputPath] = process.argv.slice(2);
assert.ok(aggregatorScript && outputPath, "tail process-group fixture requires aggregator and output paths");

const producer = spawn(process.execPath, [
  "-e",
  `process.stdout.write('{"outcome":"server_error","private":"never-store"}\\n'); setInterval(() => {}, 60_000);`,
], {
  env: {},
  stdio: ["ignore", "pipe", "inherit"],
});
const aggregator = spawn(process.execPath, [aggregatorScript, outputPath], {
  env: {
    TAIL_PROCESS_GROUP: String(process.pid),
    TAIL_STOP_ON_EVENT: "true",
  },
  stdio: ["pipe", "inherit", "inherit"],
});

const fail = () => process.exit(1);
producer.once("error", fail);
aggregator.once("error", fail);
producer.stdout.pipe(aggregator.stdin);
