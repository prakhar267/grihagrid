import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

test("operational routes never log Decision share bearer tokens", () => {
  const token = "this-is-a-private-share-token-that-must-not-be-logged";
  assert.equal(__test.operationalRoute(`/share/decision/${token}`), "/share/decision/:token");
  assert.equal(__test.operationalRoute(`/api/shared/decision-compare/${token}`), "/api/shared/decision-compare/:token");
  assert.equal(__test.operationalRoute(`/share/decision/${token}`).includes(token), false);
});

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("serves the app shell to extensionless health-check requests with Accept */*", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/pricing"),
    {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          calls.push(pathname);
          return new Response(pathname === "/index.html" ? "app" : "missing", {
            status: pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "app");
  assert.deepEqual(calls, ["/pricing", "/index.html"]);
});

test("shared-estimate documents are no-store, noindex, and never log query values for GET or HEAD", async () => {
  const query = "v=1&width=499.9&length=488.8&city=Mumbai&floors=G%2B2&quality=Luxury";
  const forbiddenLogValues = [query, "499.9", "488.8", "Mumbai", "G%2B2", "Luxury"];

  for (const method of ["GET", "HEAD"]) {
    const calls = [];
    const logs = [];
    const originalLog = console.log;
    console.log = (line) => { logs.push(String(line)); };
    let response;
    try {
      response = await worker.fetch(new Request(`https://example.test/estimate?${query}`, {
        method,
        headers: { accept: "text/html" },
      }), {
        APP_ENV: "test",
        CF_VERSION_METADATA: { id: "shared-estimate-test-version" },
        ASSETS: {
          fetch: async (request) => {
            const url = new URL(request.url);
            calls.push(`${url.pathname}${url.search}`);
            if (url.pathname !== "/index.html") return new Response(null, { status: 404 });
            return new Response(method === "HEAD" ? null : "app", {
              status: 200,
              headers: {
                "cache-control": "public, max-age=3600",
                "content-type": "text/html; charset=utf-8",
                "x-robots-tag": "index,follow",
              },
            });
          },
        },
      });
    } finally {
      console.log = originalLog;
    }

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex,nofollow,noarchive");
    assert.equal(await response.text(), method === "HEAD" ? "" : "app");
    assert.equal(calls.length, 2);
    assert.ok(calls[0].startsWith("/estimate?"));
    assert.equal(calls[1], "/index.html", "the app-shell fallback must strip the shared query");

    const completionLogs = logs.filter((line) => line.includes('"type":"request_complete"'));
    assert.equal(completionLogs.length, 1, JSON.stringify(logs));
    const completion = JSON.parse(completionLogs[0]);
    assert.equal(completion.method, method);
    assert.equal(completion.route, "/:frontend");
    assert.equal(completion.status, 200);
    assert.equal(completion.outcome, "success");
    for (const forbidden of forbiddenLogValues) {
      assert.equal(completionLogs[0].includes(forbidden), false, `${method} log leaked query value: ${forbidden}`);
    }
  }
});

test("overrides platform HTML fallbacks for known SPA routes", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/register", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          calls.push(pathname);
          return new Response(pathname === "/index.html" ? "app" : "platform fallback", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "app");
  assert.deepEqual(calls, ["/register", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const [request, expectedAssetCalls, expectJson] of [
    [new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }), 0, true],
    [new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }), 1, false],
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, expectedAssetCalls);
    if (expectJson) {
      assert.match(response.headers.get("content-type") || "", /^application\/json\b/u);
      assert.deepEqual(await response.json(), { error: "not found", code: "not_found" });
    }
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test("readiness fails closed when required production bindings are absent", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/readiness"), {
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "not_ready");
  assert.equal(body.capabilities.freePlanning, false);
  assert.equal(body.capabilities.privateUploads, false);
  assert.deepEqual(body.checks.acceptingPaidPlans, []);
});
