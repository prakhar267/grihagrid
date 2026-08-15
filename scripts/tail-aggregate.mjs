#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_COUNT = Number.MAX_SAFE_INTEGER;

export function createTailCounter(startedAt = new Date().toISOString()) {
  let eventCount = 0;
  let byteCount = 0;
  let hasUnterminatedLine = false;

  return {
    add(chunk) {
      assert.ok(Buffer.isBuffer(chunk), "tail input must remain an opaque byte stream");
      assert.ok(byteCount <= MAX_COUNT - chunk.length, "tail byte count exceeds the safe integer range");
      byteCount += chunk.length;

      for (const byte of chunk) {
        if (byte === 0x0a) {
          assert.ok(eventCount < MAX_COUNT, "tail event count exceeds the safe integer range");
          eventCount += 1;
          hasUnterminatedLine = false;
        } else {
          hasUnterminatedLine = true;
        }
      }
    },

    finish(finishedAt = new Date().toISOString()) {
      assert.ok(eventCount < MAX_COUNT || !hasUnterminatedLine, "tail event count exceeds the safe integer range");
      return {
        eventCount: eventCount + Number(hasUnterminatedLine),
        byteCount,
        startedAt,
        finishedAt,
      };
    },
  };
}

export async function writeAggregateAtomically(outputPath, aggregate) {
  const target = resolve(outputPath);
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;

  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(aggregate)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export function runTailAggregate(input, outputPath, options = {}) {
  assert.ok(outputPath, "usage: node scripts/tail-aggregate.mjs <aggregate-json-path>");
  const counter = createTailCounter();
  const stopOnEvent = options.stopOnEvent === true;
  const processGroup = Number(options.processGroup || 0);
  assert.ok(Number.isSafeInteger(processGroup) && processGroup >= 0, "tail process group must be a non-negative integer");
  let finalizing;

  const finalize = () => {
    if (!finalizing) {
      input.pause();
      finalizing = writeAggregateAtomically(outputPath, counter.finish());
    }
    return finalizing;
  };

  input.on("data", (chunk) => {
    counter.add(chunk);
    if (stopOnEvent && chunk.length > 0) {
      void finalize()
        .then(() => {
          if (processGroup > 0) {
            try {
              process.kill(-processGroup, "SIGTERM");
              return;
            } catch {
              // Fall through to the dedicated first-event exit code.
            }
          }
          process.exit(3);
        })
        .catch(failClosed);
    }
  });
  input.once("end", () => void finalize().catch(failClosed));
  input.once("error", () => void finalize().then(() => failClosed()).catch(failClosed));

  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.once(signal, () => {
      void finalize()
        .then(() => process.exit(exitCode))
        .catch(failClosed);
    });
  }
}

function failClosed() {
  process.stderr.write("tail aggregate failed\n");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runTailAggregate(process.stdin, process.argv[2], {
      stopOnEvent: process.env.TAIL_STOP_ON_EVENT === "true",
      processGroup: process.env.TAIL_PROCESS_GROUP,
    });
  } catch {
    failClosed();
  }
}
