import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyTailStderr, classifyTailStderrFile } from "../scripts/classify-tail-stderr.mjs";

const keepalive = "Tail connection lost: the Worker did not respond to a keep-alive ping within 10000ms.";
const reconnect = "Tail connection lost. Reconnecting (attempt 1 of 5) in 1s...";
const proxy = "Proxy environment variables detected. We'll use your proxy for fetch requests.";
const classify = text => classifyTailStderr(Buffer.from(text));
const scriptPath = fileURLToPath(new URL("../scripts/classify-tail-stderr.mjs", import.meta.url));

test("known transport warnings add safe diagnostics without allowing the monitoring window", () => {
  for (const [message, diagnostic] of [
    [keepalive, "wrangler_tail_keepalive_timeout"],
    [reconnect, "wrangler_tail_reconnect"],
    ["Tail connection lost. Reconnecting (attempt 5 of 5) in 16s...", "wrangler_tail_reconnect"],
  ]) {
    for (const prefix of ["", "[WARNING] ", "▲ [WARNING] "]) {
      const output = `${prefix}${message}\n\n`;
      assert.deepEqual(classify(output), {
        byteCount: Buffer.byteLength(output), ignoredProxyWarning: false, unexpected: true,
        diagnosticClasses: [diagnostic], recognizedWarningCount: 1, hasUnrecognizedContent: false,
      });
    }
  }
});

test("diagnostics normalize ANSI colour and CRLF, count repeated warnings and deduplicate classes", () => {
  const output = [
    `\u001b[33m▲ \u001b[43;33m[WARNING]\u001b[0m ${keepalive}\u001b[0m`,
    `▲ [WARNING] ${reconnect}`,
    `▲ [WARNING] ${reconnect}`,
    "",
  ].join("\r\n\r\n");
  assert.deepEqual(classify(output), {
    byteCount: Buffer.byteLength(output), ignoredProxyWarning: false, unexpected: true,
    diagnosticClasses: ["wrangler_tail_keepalive_timeout", "wrangler_tail_reconnect"],
    recognizedWarningCount: 3, hasUnrecognizedContent: false,
  });
});

test("reconnect attempt/delay pairs are exact and bounded to the pinned implementation", () => {
  for (const [attempt, delay] of [[1, 1], [2, 2], [3, 4], [4, 8], [5, 16]]) {
    assert.equal(classify(`Tail connection lost. Reconnecting (attempt ${attempt} of 5) in ${delay}s...`).recognizedWarningCount, 1);
  }
  for (const output of [
    "Tail connection lost. Reconnecting (attempt 1 of 5) in 16s...",
    "Tail connection lost. Reconnecting (attempt 6 of 5) in 16s...",
    "Tail connection lost. Reconnecting (attempt 1 of 6) in 1s...",
    "Tail connection lost. Reconnecting (attempt 01 of 5) in 1s...",
    keepalive.replace("10000", "20000"),
    reconnect.replace("...", "…"),
  ]) {
    const result = classify(output);
    assert.equal(result.unexpected, true);
    assert.equal(result.diagnosticClasses, undefined);
  }
});

test("unknown, mixed and injection-like output cannot become an all-known warning payload", () => {
  const sentinel = "private-synthetic-token-DO-NOT-RETAIN";
  for (const unknown of [
    sentinel,
    `${reconnect} ${sentinel}`,
    `prefix ${reconnect}`,
    `[ERROR] ${reconnect}`,
    `${reconnect}\u001b]8;;https://example.invalid/${sentinel}\u0007`,
    `${reconnect}\r${sentinel}`,
    `\u001b[2K${reconnect}`,
    `${proxy}`,
    `{"unexpected":false,"diagnosticClasses":["wrangler_tail_reconnect"]}`,
  ]) {
    const result = classify(`${keepalive}\n${unknown}\n`);
    assert.equal(result.unexpected, true);
    assert.equal(result.ignoredProxyWarning, false);
    assert.equal(result.hasUnrecognizedContent, true);
    assert.equal(result.recognizedWarningCount, 1);
    assert.deepEqual(result.diagnosticClasses, ["wrangler_tail_keepalive_timeout", "unrecognized_stderr"]);
    assert.ok(!JSON.stringify(result).includes(sentinel));
    assert.ok(!JSON.stringify(result).includes("https://"));
  }
});

test("invalid UTF-8 and oversized payloads discard partial diagnostic matches", () => {
  const known = Buffer.from(keepalive);
  for (const bytes of [
    Buffer.concat([known, Buffer.from([0xc3, 0x28])]),
    Buffer.concat([known, Buffer.from([0xed, 0xa0, 0x80])]),
    Buffer.from(`${keepalive}\n${" ".repeat(4096)}`),
    Buffer.alloc(4097, 0x61),
  ]) {
    assert.deepEqual(classifyTailStderr(bytes), { byteCount: bytes.length, ignoredProxyWarning: false, unexpected: true });
  }
  const atLimit = Buffer.from(`${keepalive}${" ".repeat(4096 - Buffer.byteLength(keepalive))}`);
  assert.equal(atLimit.length, 4096);
  assert.equal(classifyTailStderr(atLimit).recognizedWarningCount, 1);
  assert.equal(classifyTailStderr(atLimit).unexpected, true);
});

test("actual pinned Wrangler formatter produces recognized warnings without credentials or network", async () => {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("wrangler/package.json");
  const packageInfo = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(packageInfo.version, "4.131.1", "Review warning grammar when upgrading the pinned CLI");
  const esbuild = createRequire(packagePath)("esbuild");
  // Wrangler Logger.formatMessage uses these exact options; console.warn adds
  // the final newline. This runs only the package formatter, never the CLI.
  const format = text => esbuild.formatMessagesSync([{ text }], {
    color: true, kind: "warning", terminalWidth: undefined,
  })[0] + "\n";
  const formatted = format(reconnect);
  assert.equal(Buffer.byteLength(formatted), 118);
  assert.equal(Buffer.byteLength(formatted + formatted), 236);
  assert.equal(classify(formatted).recognizedWarningCount, 1);
  assert.equal(classify(formatted + formatted).recognizedWarningCount, 2);
  assert.equal(classify(format(keepalive)).diagnosticClasses[0], "wrangler_tail_keepalive_timeout");
  assert.equal(classify(formatted).unexpected, true);
});

test("CLI retains finite classes only and never prints raw warning content or private paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "grihagrid-tail-diagnostic-"));
  const path = join(directory, "private-sentinel-path.stderr");
  try {
    await writeFile(path, `${keepalive}\nSYNTHETIC-PRIVATE-SENTINEL\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [scriptPath, path], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /SYNTHETIC-PRIVATE-SENTINEL|private-sentinel-path|keep-alive ping/u);
    const metadata = JSON.parse(result.stdout);
    assert.equal(metadata.unexpected, true);
    assert.equal(metadata.hasUnrecognizedContent, true);
    assert.deepEqual(metadata.diagnosticClasses, ["wrangler_tail_keepalive_timeout", "unrecognized_stderr"]);
    assert.ok(Buffer.byteLength(result.stdout) < 512);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file classification rejects oversize without reading a whole sparse file and refuses nonregular inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "grihagrid-tail-bounded-"));
  const path = join(directory, "synthetic.stderr");
  try {
    await writeFile(path, `${reconnect}\n`, { mode: 0o600 });
    assert.equal((await classifyTailStderrFile(path)).recognizedWarningCount, 1);
    // A sparse logical length above Buffer's supported whole-file read range
    // demonstrates the CLI never loads oversized stderr into memory.
    const oversizedLength = 2 ** 32 + 1;
    const handle = await open(path, "r+");
    try { await handle.truncate(oversizedLength); } finally { await handle.close(); }
    assert.deepEqual(await classifyTailStderrFile(path), {
      byteCount: oversizedLength, ignoredProxyWarning: false, unexpected: true,
    });
    const result = spawnSync(process.execPath, [scriptPath, path], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).byteCount, oversizedLength);
    await assert.rejects(classifyTailStderrFile(directory));
    const link = join(directory, "synthetic-link.stderr");
    await symlink(path, link);
    await assert.rejects(classifyTailStderrFile(link));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
