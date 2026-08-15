import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/tail-aggregate.mjs", import.meta.url));
const processGroupFixturePath = fileURLToPath(new URL("./tail-process-group-fixture.mjs", import.meta.url));

function spawnAggregator(outputPath, env = {}) {
  const child = spawn(process.execPath, [scriptPath, outputPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, exited };
}

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "grihagrid-tail-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertSafeAggregate(aggregate, expected) {
  assert.deepEqual(Object.keys(aggregate), ["eventCount", "byteCount", "startedAt", "finishedAt"]);
  assert.equal(aggregate.eventCount, expected.eventCount);
  assert.equal(aggregate.byteCount, expected.byteCount);
  assert.ok(Number.isFinite(Date.parse(aggregate.startedAt)));
  assert.ok(Number.isFinite(Date.parse(aggregate.finishedAt)));
  assert.ok(Date.parse(aggregate.finishedAt) >= Date.parse(aggregate.startedAt));
}

test("tail aggregate records only bounded counts on EOF and never echoes secrets", async () => {
  await withTemporaryDirectory(async (directory) => {
    const outputPath = join(directory, "tail.json");
    const bearer = "Bearer TOP-SECRET-TAIL-TOKEN";
    const header = "x-internal-header: private-value";
    const input = Buffer.from(
      `{"request":{"headers":{"authorization":"${bearer}"}}}\n${header}\nunterminated-π`,
      "utf8",
    );
    const { child, exited } = spawnAggregator(outputPath);
    child.stdin.end(input);

    const result = await exited;
    assert.deepEqual(result, { code: 0, signal: null, stdout: "", stderr: "" });

    const stored = await readFile(outputPath, "utf8");
    const aggregate = JSON.parse(stored);
    assertSafeAggregate(aggregate, { eventCount: 3, byteCount: input.length });
    assert.equal(stored.includes(bearer), false);
    assert.equal(stored.includes(header), false);
    assert.deepEqual(await readdir(directory), ["tail.json"]);
  });
});

test("tail aggregate atomically finalizes metadata on SIGTERM without persisting raw lines", async () => {
  await withTemporaryDirectory(async (directory) => {
    const outputPath = join(directory, "signal.json");
    const bearer = "Bearer SIGNAL-ONLY-SECRET";
    const input = Buffer.from(`authorization: ${bearer}\nx-api-key: never-store-this`, "utf8");
    const { child, exited } = spawnAggregator(outputPath);
    child.stdin.write(input);
    await new Promise((resolve) => setTimeout(resolve, 250));
    child.kill("SIGTERM");

    const result = await exited;
    assert.equal(result.code, 143);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");

    const stored = await readFile(outputPath, "utf8");
    assertSafeAggregate(JSON.parse(stored), { eventCount: 2, byteCount: input.length });
    assert.equal(stored.includes(bearer), false);
    assert.equal(stored.includes("never-store-this"), false);
    assert.deepEqual(await readdir(directory), ["signal.json"]);
  });
});

test("tail aggregate stops immediately on the first monitored error event", async () => {
  await withTemporaryDirectory(async (directory) => {
    const outputPath = join(directory, "first-error.json");
    const input = Buffer.from('{"outcome":"server_error","private":"never-store"}\n', "utf8");
    const { child, exited } = spawnAggregator(outputPath, { TAIL_STOP_ON_EVENT: "true" });
    child.stdin.write(input);

    const result = await exited;
    assert.deepEqual(result, { code: 3, signal: null, stdout: "", stderr: "" });
    const stored = await readFile(outputPath, "utf8");
    assertSafeAggregate(JSON.parse(stored), { eventCount: 1, byteCount: input.length });
    assert.equal(stored.includes("never-store"), false);
  });
});

test("tail aggregate terminates its supervised process group after durable first-event capture", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX process groups are required by the production supervisor");
    return;
  }

  await withTemporaryDirectory(async (directory) => {
    const outputPath = join(directory, "process-group.json");
    const child = spawn(process.execPath, [processGroupFixturePath, scriptPath, outputPath], {
      detached: true,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    let timeoutId;
    try {
      const result = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("supervised tail did not terminate promptly")), 3_000);
        }),
      ]);
      assert.ok(result.signal === "SIGTERM" || result.code === 143, JSON.stringify(result));
      assert.equal(stdout, "");
      assert.equal(stderr, "");
      const stored = await readFile(outputPath, "utf8");
      assertSafeAggregate(JSON.parse(stored), {
        eventCount: 1,
        byteCount: Buffer.byteLength('{"outcome":"server_error","private":"never-store"}\n'),
      });
      assert.equal(stored.includes("never-store"), false);
    } finally {
      clearTimeout(timeoutId);
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if (!["EPERM", "ESRCH"].includes(error.code)) throw error;
      }
    }
  });
});
