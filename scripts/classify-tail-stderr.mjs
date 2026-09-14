#!/usr/bin/env node
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { pathToFileURL } from "node:url";

const MAX_STDERR_BYTES = 4_096;
const PROXY_WARNING = "Proxy environment variables detected. We'll use your proxy for fetch requests.";
const ALLOWED_PROXY_WARNINGS = new Set([
  PROXY_WARNING,
  `[WARNING] ${PROXY_WARNING}`,
  `▲ [WARNING] ${PROXY_WARNING}`,
]);

// Diagnostic labels only: a recognized transport warning still invalidates the
// monitored window. These complete messages are from pinned Wrangler 4.131.1.
const KEEPALIVE_WARNING = "Tail connection lost: the Worker did not respond to a keep-alive ping within 10000ms.";
const RECONNECT_WARNINGS = [1, 2, 4, 8, 16].map((delay, index) =>
  `Tail connection lost. Reconnecting (attempt ${index + 1} of 5) in ${delay}s...`
);
const DIAGNOSTIC_WARNINGS = new Map();
for (const [message, diagnostic] of [
  [KEEPALIVE_WARNING, "wrangler_tail_keepalive_timeout"],
  ...RECONNECT_WARNINGS.map(message => [message, "wrangler_tail_reconnect"]),
]) {
  for (const prefix of ["", "[WARNING] ", "▲ [WARNING] "]) {
    DIAGNOSTIC_WARNINGS.set(`${prefix}${message}`, diagnostic);
  }
}

function diagnosticMetadata(decoded) {
  // Only normalize SGR colour sequences and CRLF for diagnostics; arbitrary
  // terminal controls, URLs, identifiers and error text never enter metadata.
  const lines = decoded.replaceAll("\r\n", "\n").replace(/\u001b\[[0-9;]*m/gu, "")
    .split("\n").map(line => line.trim()).filter(Boolean);
  const recognized = lines.map(line => DIAGNOSTIC_WARNINGS.get(line)).filter(Boolean);
  if (!recognized.length) return {};
  const hasUnrecognizedContent = recognized.length !== lines.length;
  const diagnosticClasses = [...new Set(recognized)].sort();
  if (hasUnrecognizedContent) diagnosticClasses.push("unrecognized_stderr");
  return { diagnosticClasses, recognizedWarningCount: recognized.length, hasUnrecognizedContent };
}

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
  if (!ALLOWED_PROXY_WARNINGS.has(normalized)) return { ...failure, ...diagnosticMetadata(decoded) };

  return { byteCount, ignoredProxyWarning: true, unexpected: false };
}

export async function classifyTailStderrFile(stderrPath) {
  const handle = await open(stderrPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && Number.isSafeInteger(before.size), "tail stderr must be a regular bounded-size file");
    const failure = byteCount => ({ byteCount, ignoredProxyWarning: false, unexpected: true });
    // Stat and reads use one handle. Oversized input reports its actual observed
    // length without allocating or reading the complete diagnostic file.
    if (before.size > MAX_STDERR_BYTES) return failure(before.size);
    const buffer = Buffer.alloc(MAX_STDERR_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    assert.ok(Number.isSafeInteger(after.size), "tail stderr length must remain bounded");
    if (after.size !== before.size || length !== after.size || length > MAX_STDERR_BYTES) {
      return failure(after.size);
    }
    return classifyTailStderr(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

async function main(stderrPath) {
  assert.ok(stderrPath, "usage: node scripts/classify-tail-stderr.mjs <stderr-path>");
  const result = await classifyTailStderrFile(stderrPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function failClosed() {
  process.stderr.write("tail stderr classification failed\n");
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(failClosed);
}
