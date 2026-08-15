import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAuthenticatedSmoke } from "../scripts/authenticated-smoke.mjs";
import { monitorRelease, ReleaseTailCoverageError, summarizeSamples } from "../scripts/monitor-release.mjs";
import { changedFiles, classifyReleaseFiles, isDocumentationOnly } from "../scripts/release-scope.mjs";

test("release scope skips only documentation and treats deletions as deployable file paths", () => {
  assert.equal(isDocumentationOnly("docs/operations-runbook.md"), true);
  assert.equal(isDocumentationOnly("AGENTS.md"), true);
  assert.equal(isDocumentationOnly("src/runtime-contract.md"), false);
  assert.equal(isDocumentationOnly("worker/index.js"), false);
  assert.deepEqual(classifyReleaseFiles(["AGENTS.md", "docs/test-plan.md"]), {
    files: ["AGENTS.md", "docs/test-plan.md"],
    deploy: false,
    migrations: false,
  });
  assert.equal(classifyReleaseFiles(["docs/test-plan.md", "worker/removed-module.js"]).deploy, true);
  assert.equal(classifyReleaseFiles(["migrations/0013_release_guard.sql"]).migrations, true);
  assert.throws(() => classifyReleaseFiles([]), /at least one file/u);
});

test("release scope cannot hide a runtime deletion inside a documentation rename", async () => {
  const repository = await mkdtemp(join(tmpdir(), "grihagrid-release-scope-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    git("init", "--quiet");
    git("config", "user.name", "Release Scope Test");
    git("config", "user.email", "release-scope@example.test");
    await mkdir(join(repository, "worker"));
    await writeFile(join(repository, "worker", "index.js"), "export default {};\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Add runtime");
    const base = git("rev-parse", "HEAD");

    await mkdir(join(repository, "docs"));
    await rename(join(repository, "worker", "index.js"), join(repository, "docs", "retired-runtime.md"));
    git("add", "--all");
    git("commit", "--quiet", "-m", "Move runtime into docs");
    const head = git("rev-parse", "HEAD");

    const files = changedFiles(base, head, repository);
    assert.deepEqual(files.sort(), ["docs/retired-runtime.md", "worker/index.js"]);
    assert.equal(classifyReleaseFiles(files).deploy, true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("release monitor summary counts actual requests including bounded retries", () => {
  const sample = {
    checks: [
      { latencyMs: 10, attempts: 1 },
      { latencyMs: 30, attempts: 2 },
      { latencyMs: 20, attempts: 1 },
    ],
  };
  assert.deepEqual(
    summarizeSamples("https://example.test", "11111111-1111-4111-8111-111111111111", "start", "finish", [sample]),
    {
      origin: "https://example.test",
      releaseId: "11111111-1111-4111-8111-111111111111",
      startedAt: "start",
      finishedAt: "finish",
      samples: 1,
      successfulChecks: 3,
      requests: 4,
      latencyMs: { minimum: 10, maximum: 30, average: 20 },
    },
  );
});

test("release monitor distinguishes lost tail coverage from an application regression", async () => {
  await assert.rejects(
    () => monitorRelease(
      "https://worker.example.test",
      "11111111-1111-4111-8111-111111111111",
      { durationMs: 1, intervalMs: 1, watchPids: [99_999_999] },
    ),
    ReleaseTailCoverageError,
  );
});

test("authenticated smoke proves checkout and private uploads fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const projectId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  let marker = "";
  let deleted = false;
  const denied = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    if (url.pathname === "/api/auth/login") {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "__Host-grihagrid_session=session-value; Path=/; Secure; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "grihagrid_csrf=csrf-value; Path=/; Secure; SameSite=Strict");
      return new Response(JSON.stringify({ csrfToken: "csrf-value" }), { headers });
    }
    if (url.pathname === "/api/readiness") {
      return Response.json({
        releaseId,
        capabilities: { paidCheckout: false, paidFulfillment: false, privateUploads: false },
      });
    }
    if (url.pathname === "/api/auth/me") return Response.json({ user: { email: "release@example.test" } });
    if (url.pathname === "/api/projects" && method === "POST") {
      marker = JSON.parse(init.body).name;
      return Response.json({ project: { id: projectId } }, { status: 201 });
    }
    if (url.pathname === "/api/projects" && method === "GET") {
      return Response.json({ projects: deleted ? [] : [{ id: projectId, name: marker }] });
    }
    if (url.pathname === `/api/projects/${projectId}` && method === "GET") {
      return deleted
        ? Response.json({ code: "project_not_found" }, { status: 404 })
        : Response.json({ project: { id: projectId } });
    }
    if (url.pathname === `/api/projects/${projectId}/report`) {
      return Response.json({ report: { status: "ready" } }, { status: method === "POST" ? 201 : 200 });
    }
    if (url.pathname === `/api/projects/${projectId}/orders` && method === "POST") {
      assert.match(new Headers(init.headers).get("idempotency-key") || "", /^closed-/u);
      denied.push("checkout");
      return Response.json({ code: "payments_disabled" }, { status: 503 });
    }
    if (url.pathname === `/api/projects/${projectId}/files` && method === "POST") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/pdf");
      denied.push("upload");
      return Response.json({ code: "storage_unavailable" }, { status: 503 });
    }
    if (url.pathname === `/api/projects/${projectId}` && method === "DELETE") {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/auth/logout") return new Response(null, { status: 204 });
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  };

  try {
    const result = await runAuthenticatedSmoke(
      "https://worker.example.test",
      { email: "release@example.test", password: "a-secure-canary-password" },
      { expectedReleaseId: releaseId },
    );
    assert.deepEqual(denied, ["checkout", "upload"]);
    assert.equal(result.projectDeleted, true);
    assert.equal(deleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticated smoke deletes only its exact marker after an ambiguous create timeout", async () => {
  const originalFetch = globalThis.fetch;
  let marker = "";
  let deletedId = "";
  let logoutCalled = false;
  const projectId = "11111111-1111-4111-8111-111111111111";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/api/auth/login") {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "__Host-grihagrid_session=session-value; Path=/; Secure; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "grihagrid_csrf=csrf-value; Path=/; Secure; SameSite=Strict");
      return new Response(JSON.stringify({ csrfToken: "csrf-value" }), { headers });
    }
    if (url.pathname === "/api/readiness") {
      return Response.json({
        releaseId: "22222222-2222-4222-8222-222222222222",
        capabilities: { paidCheckout: false, paidFulfillment: false, privateUploads: false },
      });
    }
    if (url.pathname === "/api/auth/me") {
      return Response.json({ user: { email: "release@example.test" } });
    }
    if (url.pathname === "/api/projects" && init.method === "POST") {
      marker = JSON.parse(init.body).name;
      throw new DOMException("ambiguous timeout", "TimeoutError");
    }
    if (url.pathname === "/api/projects" && (!init.method || init.method === "GET")) {
      assert.equal(url.searchParams.get("offset"), "0");
      return Response.json({ projects: [
        { id: "33333333-3333-4333-8333-333333333333", name: "Customer project" },
        { id: projectId, name: marker },
      ] });
    }
    if (url.pathname === `/api/projects/${projectId}` && init.method === "DELETE") {
      deletedId = projectId;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `/api/projects/${projectId}` && (!init.method || init.method === "GET")) {
      return Response.json({ code: "project_not_found" }, { status: 404 });
    }
    if (url.pathname === "/api/auth/logout") {
      logoutCalled = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request ${init.method || "GET"} ${url.pathname}`);
  };

  try {
    await assert.rejects(
      () => runAuthenticatedSmoke(
        "https://worker.example.test",
        { email: "release@example.test", password: "a-secure-canary-password" },
        { expectedReleaseId: "22222222-2222-4222-8222-222222222222" },
      ),
      /ambiguous timeout/u,
    );
    assert.match(marker, /^Release canary [0-9a-f-]{36}$/u);
    assert.equal(deletedId, projectId);
    assert.equal(logoutCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
