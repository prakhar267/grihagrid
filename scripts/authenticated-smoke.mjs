#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_COOKIE = "__Host-grihagrid_session";
const CSRF_COOKIE = "grihagrid_csrf";

function canonicalOrigin(raw) {
  const origin = new URL(raw);
  assert.equal(origin.protocol, "https:", "authenticated smoke target must use HTTPS");
  assert.equal(origin.username, "", "authenticated smoke target cannot include credentials");
  assert.equal(origin.password, "", "authenticated smoke target cannot include credentials");
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin;
}

function cookieValues(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = new Map();
  for (const value of values) {
    const match = String(value).match(/(?:^|,\s*)([^=;,\s]+)=([^;,]*)/gu) || [];
    for (const entry of match) {
      const pair = entry.replace(/^,\s*/u, "").split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  return cookies;
}

function mergeCookies(jar, response) {
  for (const [name, value] of cookieValues(response)) {
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function responsePayload(response) {
  if (response.status === 204) return null;
  if ((response.headers.get("content-type") || "").startsWith("application/json")) {
    return response.json();
  }
  return null;
}

export async function runAuthenticatedSmoke(rawOrigin, credentials, options = {}) {
  const origin = canonicalOrigin(rawOrigin);
  const email = String(credentials?.email || "").trim();
  const password = String(credentials?.password || "");
  assert.ok(email && password, "authenticated smoke credentials are required");

  const jar = new Map();
  const completed = [];
  let csrfToken = "";
  let projectId = "";
  let releaseId = "";
  let sessionRevocationVerified = false;
  let primaryError = null;
  const marker = `Release canary ${crypto.randomUUID()}`;

  function safeRoute(path) {
    return path.replace(/\/([0-9a-f]{8}-[0-9a-f-]{27})(?=\/|$)/giu, "/:projectId");
  }

  async function call(path, init = {}, expected = [200]) {
    const startedAt = performance.now();
    const method = init.method || "GET";
    const headers = new Headers(init.headers || {});
    if (jar.size && !headers.has("cookie")) headers.set("cookie", cookieHeader(jar));
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers.set("origin", origin.origin);
      const effectiveCsrf = csrfToken || decodeURIComponent(jar.get(CSRF_COOKIE) || "");
      if (effectiveCsrf && !path.startsWith("/api/auth/login")) headers.set("x-csrf-token", effectiveCsrf);
    }
    const response = await fetch(new URL(path, origin), {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs || REQUEST_TIMEOUT_MS),
    });
    mergeCookies(jar, response);
    const payload = await responsePayload(response);
    if (!expected.includes(response.status)) {
      throw new Error(`${method} ${safeRoute(path)} returned ${response.status}`);
    }
    completed.push({ method, route: safeRoute(path), status: response.status, latencyMs: Math.round(performance.now() - startedAt) });
    return payload;
  }

  try {
    const login = await call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    csrfToken = String(login?.csrfToken || "");
    assert.ok(csrfToken, "login response did not include a CSRF token");
    assert.ok(jar.has(SESSION_COOKIE), "login response did not set the secure session cookie");
    assert.ok(jar.has(CSRF_COOKIE), "login response did not set the CSRF cookie");

    const readiness = await call("/api/readiness");
    releaseId = String(readiness?.releaseId || "");
    if (options.expectedReleaseId) assert.equal(releaseId, options.expectedReleaseId, "authenticated canary reached the wrong Worker version");
    assert.equal(readiness?.capabilities?.paidCheckout, false, "authenticated canary requires checkout to remain closed");
    assert.equal(readiness?.capabilities?.paidFulfillment, false, "authenticated canary requires fulfillment to remain closed");
    assert.equal(readiness?.capabilities?.privateUploads, false, "authenticated canary requires uploads to remain closed");

    const me = await call("/api/auth/me");
    assert.ok(
      String(me?.user?.email || "").toLowerCase() === email.toLowerCase(),
      "canary session belongs to the wrong account",
    );

    const created = await call("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: marker,
        input: {
          width: 30,
          length: 50,
          floors: "G+1",
          quality: "Signature",
          city: "Pune",
          bedrooms: 3,
          bathrooms: 3,
          parking: true,
        },
      }),
    }, [201]);
    projectId = String(created?.project?.id || "");
    assert.match(projectId, /^[0-9a-f-]{36}$/u, "canary project did not return a valid identifier");

    const encodedProjectId = encodeURIComponent(projectId);
    const project = await call(`/api/projects/${encodedProjectId}`);
    assert.equal(project?.project?.id, projectId, "canary project read did not match the created record");

    const generated = await call(`/api/projects/${encodedProjectId}/report`, { method: "POST", body: "{}" }, [200, 201]);
    assert.ok(generated?.report, "canary report generation did not return a report");
    const cached = await call(`/api/projects/${encodedProjectId}/report`);
    assert.ok(cached?.report, "canary report read did not return the generated report");

    const closedOrder = await call(`/api/projects/${encodedProjectId}/orders`, {
      method: "POST",
      headers: { "idempotency-key": `closed-${crypto.randomUUID()}` },
      body: JSON.stringify({ plan: "decision_compare" }),
    }, [503]);
    assert.equal(closedOrder?.code, "payments_disabled", "paid checkout did not fail closed");

    const closedUpload = await call(`/api/projects/${encodedProjectId}/files`, {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        "x-file-name": "release-canary.pdf",
        "x-file-kind": "site_plan",
      },
      body: "%PDF-1.4\n%%EOF\n",
    }, [503]);
    assert.equal(closedUpload?.code, "storage_unavailable", "private upload did not fail closed");
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupIds = new Set(projectId ? [projectId] : []);
    if (jar.has(SESSION_COOKIE)) {
      try {
        for (let offset = 0; offset < 10_000; offset += 100) {
          const listed = await call(`/api/projects?limit=100&offset=${offset}`);
          const projects = Array.isArray(listed?.projects) ? listed.projects : [];
          for (const project of projects) {
            if (project?.name === marker && typeof project.id === "string") cleanupIds.add(project.id);
          }
          if (projects.length < 100) break;
          assert.ok(offset < 9_900, "canary cleanup pagination exceeded its safety bound");
        }
        for (const cleanupId of cleanupIds) {
          const encodedProjectId = encodeURIComponent(cleanupId);
          await call(`/api/projects/${encodedProjectId}`, { method: "DELETE" }, [204]);
          await call(`/api/projects/${encodedProjectId}`, {}, [404]);
        }
      } catch (cleanupError) {
        primaryError = primaryError
          ? new AggregateError([primaryError, cleanupError], "authenticated smoke and exact project cleanup failed")
          : cleanupError;
      }
    }
    if (jar.has(SESSION_COOKIE) && (csrfToken || jar.has(CSRF_COOKIE))) {
      try {
        const revokedSession = jar.get(SESSION_COOKIE);
        await call("/api/auth/logout", { method: "POST", body: "{}" }, [204]);
        assert.equal(jar.has(SESSION_COOKIE), false, "logout did not clear the secure session cookie");
        assert.equal(jar.has(CSRF_COOKIE), false, "logout did not clear the CSRF cookie");
        const replay = await call("/api/auth/me", {
          headers: { cookie: `${SESSION_COOKIE}=${revokedSession}` },
        }, [401]);
        assert.equal(replay?.code, "unauthenticated", "revoked session cookie was not rejected");
        sessionRevocationVerified = true;
      } catch (logoutError) {
        primaryError = primaryError
          ? new AggregateError([primaryError, logoutError], "authenticated smoke and logout proof failed")
          : logoutError;
      }
    }
    if (!sessionRevocationVerified && !primaryError) {
      primaryError = new Error("authenticated smoke could not prove current-session revocation");
    }
  }

  if (primaryError) throw primaryError;
  return {
    origin: origin.origin,
    releaseId,
    checkedAt: new Date().toISOString(),
    projectCreated: true,
    projectDeleted: true,
    sessionLoggedOut: sessionRevocationVerified,
    sessionRevocationVerified,
    checks: completed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] || process.env.GRIHAGRID_CANARY_ORIGIN;
  assert.ok(origin, "usage: node scripts/authenticated-smoke.mjs https://worker.example");
  const result = await runAuthenticatedSmoke(origin, {
    email: process.env.GRIHAGRID_CANARY_EMAIL,
    password: process.env.GRIHAGRID_CANARY_PASSWORD,
  }, { expectedReleaseId: process.env.EXPECT_RELEASE_ID });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
