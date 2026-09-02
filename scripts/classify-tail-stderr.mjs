#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { pathToFileURL } from "node:url";

const MAX_STDERR_BYTES = 4_096;
const PROXY_WARNING = "Proxy environment variables detected. We'll use your proxy for fetch requests.";
const ALLOWED_PROXY_WARNINGS = new Set([
  PROXY_WARNING,
  `[WARNING] ${PROXY_WARNING}`,
  `▲ [WARNING] ${PROXY_WARNING}`,
]);

export function classifyTailStderr(bytes) {
  assert.ok(Buffer.isBuffer(bytes), "tail stderr must be provided as a Buffer");

  const byteCount = bytes.length;
  const failure = { byteCount, ignoredProxyWarning: false, unexpected: true };
  if (byteCount === 0) return { ...failure, unexpected: false };
  if (byteCount > MAX_STDERR_BYTES) return failure;

  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure;
  }

  const normalized = stripVTControlCharacters(decoded).replaceAll("\r", "").trim();
  if (!ALLOWED_PROXY_WARNINGS.has(normalized)) return failure;

  return { byteCount, ignoredProxyWarning: true, unexpected: false };
}

async function main(stderrPath) {
  assert.ok(stderrPath, "usage: node scripts/classify-tail-stderr.mjs <stderr-path>");
  const result = classifyTailStderr(await readFile(stderrPath));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function failClosed() {
  process.stderr.write("tail stderr classification failed\n");
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(failClosed);
}
