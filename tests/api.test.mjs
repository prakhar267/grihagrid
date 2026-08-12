import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

const assets = { fetch: async () => new Response("missing", { status: 404 }) };

test("health endpoint is safe without optional bindings", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.database, "not-configured");
});

test("estimate endpoint validates and computes normalized results", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" }),
  }), { ASSETS: assets });
  assert.equal(response.status, 200);
  const { estimate } = await response.json();
  assert.equal(estimate.builtUpSqft, 1830);
  assert.equal(estimate.lowInr, 3703920);
  assert.equal(estimate.highInr, 4428600);
});

test("estimate endpoint rejects unsafe dimensions", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 2, length: 900 }),
  }), { ASSETS: assets });
  assert.equal(response.status, 400);
});
