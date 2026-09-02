import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyTailStderr } from "../scripts/classify-tail-stderr.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/classify-tail-stderr.mjs", import.meta.url));
const proxyWarning = "Proxy environment variables detected. We'll use your proxy for fetch requests.";

test("tail stderr classifier accepts empty output and only the known proxy notice", () => {
  assert.deepEqual(classifyTailStderr(Buffer.alloc(0)), {
    byteCount: 0,
    ignoredProxyWarning: false,
    unexpected: false,
  });

  for (const output of [
    `${proxyWarning}\n`,
    `[WARNING] ${proxyWarning}\n`,
    `▲ [WARNING] ${proxyWarning}\n\n`,
    `\u001b[33m▲ \u001b[43;33m[WARNING]\u001b[0m ${proxyWarning}\u001b[0m\n`,
  ]) {
    assert.deepEqual(classifyTailStderr(Buffer.from(output)), {
      byteCount: Buffer.byteLength(output),
      ignoredProxyWarning: true,
      unexpected: false,
    });
  }
});

test("tail stderr classifier fails closed for every other payload", () => {
  for (const output of [
    `[WARNING] Tail connection lost. Reconnecting (attempt 1)...\n`,
    `▲ [WARNING] ${proxyWarning}\n[WARNING] Tail connection lost\n`,
    `${proxyWarning}\n${proxyWarning}\n`,
    `prefix ${proxyWarning}\n`,
    Buffer.from([0xc3, 0x28]),
    Buffer.alloc(4_097, 0x61),
  ]) {
    const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output);
    assert.deepEqual(classifyTailStderr(bytes), {
      byteCount: bytes.length,
      ignoredProxyWarning: false,
      unexpected: true,
    });
  }
});

test("tail stderr classifier CLI emits bounded metadata without raw stderr or its path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "grihagrid-tail-stderr-"));
  const stderrPath = join(directory, "private-secret-tail.stderr");
  try {
    await writeFile(stderrPath, `sensitive-token ${proxyWarning}\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [scriptPath, stderrPath], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /sensitive-token|private-secret-tail/u);
    assert.deepEqual(JSON.parse(result.stdout), {
      byteCount: Buffer.byteLength(`sensitive-token ${proxyWarning}\n`),
      ignoredProxyWarning: false,
      unexpected: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
