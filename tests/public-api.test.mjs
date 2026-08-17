import assert from "node:assert/strict";
import test from "node:test";

import { api, ApiError, clearCsrfToken, publicApi } from "../src/api.js";

test("public estimator requests omit cookies and CSRF material", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let captured;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = { cookie: "grihagrid_csrf=private-csrf-value" };
  globalThis.fetch = async (path, options) => {
    captured = { path, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const payload = await publicApi("/api/estimate", {
      method: "POST",
      headers: {
        authorization: "Bearer private-token",
        cookie: "private-cookie=value",
        "x-csrf-token": "explicit-private-csrf",
      },
      body: { width: 30, length: 50 },
    });
    assert.deepEqual(payload, { ok: true });
    assert.equal(captured.path, "/api/estimate");
    assert.equal(captured.options.credentials, "omit");
    assert.equal(captured.options.headers.get("x-csrf-token"), null);
    assert.equal(captured.options.headers.get("cookie"), null);
    assert.equal(captured.options.headers.get("authorization"), null);
    assert.equal(captured.options.headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(captured.options.body), { width: 30, length: 50 });
    assert.equal(Object.hasOwn(captured.options, "anonymous"), false);
    assert.equal(Object.hasOwn(captured.options, "timeoutMs"), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("public Family Alignment writes omit ambient credentials but retain the opaque response receipt", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let captured;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = { cookie: "grihagrid_csrf=private-cookie-csrf" };
  globalThis.fetch = async (path, options) => {
    captured = { path, options };
    return new Response(JSON.stringify({ saved: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const receipt = "r".repeat(43);
    const token = "f".repeat(43);
    await publicApi("/api/shared/family-alignment/response", {
      method: "PUT",
      headers: {
        authorization: "Bearer private-account-token",
        cookie: "__Host-grihagrid_session=private-session",
        "x-csrf-token": "private-explicit-csrf",
        "x-family-response-token": receipt,
      },
      body: {
        token,
        response: { role: "parent", preference: "A", confidence: "medium", reasons: ["budget"] },
      },
    });

    assert.equal(captured.path, "/api/shared/family-alignment/response");
    assert.equal(captured.options.credentials, "omit");
    assert.equal(captured.options.headers.get("authorization"), null);
    assert.equal(captured.options.headers.get("cookie"), null);
    assert.equal(captured.options.headers.get("x-csrf-token"), null);
    assert.equal(captured.options.headers.get("x-family-response-token"), receipt);
    assert.equal(captured.options.headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(captured.options.body), {
      token,
      response: { role: "parent", preference: "A", confidence: "medium", reasons: ["budget"] },
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("public estimator requests forward caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (_path, options) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const controller = new AbortController();
    const pending = publicApi("/api/estimate", {
      method: "POST",
      body: { width: 30, length: 50 },
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("public estimator timeouts become retryable 408 errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  try {
    await assert.rejects(
      publicApi("/api/estimate", {
        method: "POST",
        body: { width: 30, length: 50 },
        timeoutMs: 5,
      }),
      (error) => error instanceof ApiError && error.status === 408,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("public estimator timeout remains active while a response body stalls", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (_path, options) => ({
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }),
  });
  try {
    await assert.rejects(
      publicApi("/api/estimate", {
        method: "POST",
        body: { width: 30, length: 50 },
        timeoutMs: 5,
      }),
      (error) => error instanceof ApiError && error.status === 408,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("anonymous responses cannot poison a later authenticated CSRF header", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const requests = [];
  clearCsrfToken();
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = { cookie: "grihagrid_csrf=cookie-csrf" };
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify(
      path === "/api/estimate" ? { csrfToken: "poisoned-by-public-response" } : { ok: true },
    ), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await publicApi("/api/estimate", { method: "POST", body: { width: 30, length: 50 } });
    await api("/api/projects", { method: "POST", body: { name: "Safe request" } });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[1].options.credentials, "include");
    assert.equal(requests[1].options.headers.get("x-csrf-token"), "cookie-csrf");
    assert.notEqual(requests[1].options.headers.get("x-csrf-token"), "poisoned-by-public-response");
  } finally {
    clearCsrfToken();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("authenticated writes prefer the live rotated CSRF cookie over stale in-memory state", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const requests = [];
  clearCsrfToken();
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = { cookie: "grihagrid_csrf=first-cookie-token" };
  globalThis.fetch = async (path, options) => {
    requests.push({ path, csrf: options.headers.get("x-csrf-token") });
    return new Response(JSON.stringify(
      path === "/api/auth/me" ? { csrfToken: "stale-memory-token" } : { ok: true },
    ), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await api("/api/auth/me");
    globalThis.document.cookie = "grihagrid_csrf=replacement-cookie-token";
    await api("/api/projects", { method: "POST", body: { name: "Rotated session" } });
    assert.deepEqual(requests, [
      { path: "/api/auth/me", csrf: null },
      { path: "/api/projects", csrf: "replacement-cookie-token" },
    ]);
  } finally {
    clearCsrfToken();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
