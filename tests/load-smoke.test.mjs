import assert from "node:assert/strict";
import test from "node:test";
import { boundedLoadSettings, nearestRank, safeLoadTarget } from "../scripts/load-smoke.mjs";

test("load smoke settings are bounded and remote targets require an explicit gate", () => {
  assert.deepEqual(boundedLoadSettings({}), { requests: 60, concurrency: 6, p95LimitMs: 750 });
  assert.throws(() => boundedLoadSettings({ GRIHAGRID_LOAD_REQUESTS: "201" }), /3-200/u);
  assert.throws(() => boundedLoadSettings({ GRIHAGRID_LOAD_CONCURRENCY: "11" }), /1-10/u);
  assert.equal(safeLoadTarget("http://127.0.0.1:8787/").origin, "http://127.0.0.1:8787");
  assert.throws(() => safeLoadTarget("https://example.test"), /ALLOW_REMOTE_LOAD/u);
  assert.equal(safeLoadTarget("https://example.test/path", true).pathname, "/path");
  assert.throws(() => safeLoadTarget("http://example.test", true), /HTTPS/u);
});

test("load smoke uses a deterministic nearest-rank latency gate", () => {
  assert.equal(nearestRank([1, 2, 3, 4, 100], 0.5), 3);
  assert.equal(nearestRank([1, 2, 3, 4, 100], 0.95), 100);
});
