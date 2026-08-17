#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const AUTHENTICATED_SMOKE_REQUEST_TIMEOUT_MS = 15_000;
export const AUTHENTICATED_SMOKE_LOGIN_TIMEOUT_MS = 30_000;
const SESSION_COOKIE = "__Host-grihagrid_session";
const CSRF_COOKIE = "grihagrid_csrf";
const ESTIMATOR_CANARY_INPUT = Object.freeze({
  width: 30,
  length: 50,
  floors: "G+1",
  quality: "Signature",
  city: "Pune",
});

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

export function reportShareCapabilityToken(rawUrl, expectedOrigin) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("report handoff did not return a valid fragment capability URL");
  }
  const token = /^#[A-Za-z0-9_-]{43}$/u.test(url.hash) ? url.hash.slice(1) : "";
  if (url.origin !== String(expectedOrigin) || url.username || url.password
      || url.pathname !== "/share/report" || url.search || !token) {
    throw new Error("report handoff did not return a valid fragment capability URL");
  }
  return token;
}

export function authenticatedSmokeRequestTimeoutMs(path, options = {}) {
  const configured = path === "/api/auth/login"
    ? options.loginTimeoutMs ?? AUTHENTICATED_SMOKE_LOGIN_TIMEOUT_MS
    : options.timeoutMs ?? AUTHENTICATED_SMOKE_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number(configured);
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000,
    "authenticated smoke request timeout must be an integer between 1 and 60000 ms",
  );
  return timeoutMs;
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

async function reportSha256(report) {
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
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
  let immutableReportSha256 = "";
  let sessionRevocationVerified = false;
  let projectCreateAttempted = false;
  let publicEstimateVerified = false;
  let projectCreateReplayVerified = false;
  let reportHandoffVerified = false;
  const cleanupIds = new Set();
  const deletedIds = new Set();
  let primaryError = null;
  const legacyWorker = options.legacyWorker === true;
  const marker = `Release canary ${crypto.randomUUID()}`;

  function safeRoute(path) {
    return path
      .replace(/\/([0-9a-f]{8}-[0-9a-f-]{27})(?=\/|$)/giu, "/:projectId")
      .replace(/\/report-shares\/[^/]+$/u, "/report-shares/:shareId");
  }

  async function call(path, init = {}, expected = [200]) {
    const startedAt = performance.now();
    const {
      anonymous = false,
      timeoutMs = authenticatedSmokeRequestTimeoutMs(path, options),
      ...requestInit
    } = init;
    const method = requestInit.method || "GET";
    const headers = new Headers(requestInit.headers || {});
    if (!anonymous && jar.size && !headers.has("cookie")) headers.set("cookie", cookieHeader(jar));
    if (requestInit.body !== undefined && !(requestInit.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers.set("origin", origin.origin);
      const effectiveCsrf = csrfToken || decodeURIComponent(jar.get(CSRF_COOKIE) || "");
      if (!anonymous && effectiveCsrf && !path.startsWith("/api/auth/login")) headers.set("x-csrf-token", effectiveCsrf);
    }
    const response = await fetch(new URL(path, origin), {
      ...requestInit,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
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
    if (!legacyWorker) {
      assert.equal(readiness?.capabilities?.reportFeedback, true, "authenticated canary requires report feedback to be ready");
      assert.equal(readiness?.checks?.authSchema, "current", "authenticated canary requires account-security schema to be current");
      assert.equal(readiness?.capabilities?.accountSecurity, true, "authenticated canary requires account security to be ready");
      assert.equal(readiness?.checks?.reportShareSchema, "current", "authenticated canary requires report-share schema to be current");
      assert.equal(readiness?.checks?.reportHandoffControl, "enabled", "authenticated canary requires the report-handoff control to be enabled");
      assert.equal(readiness?.checks?.reportShareAbuseHashing, "configured", "authenticated canary requires report-share abuse hashing");
      assert.equal(readiness?.capabilities?.reportHandoff, true, "authenticated canary requires professional report handoff to be ready");
    }

    const me = await call("/api/auth/me");
    assert.ok(
      String(me?.user?.email || "").toLowerCase() === email.toLowerCase(),
      "canary session belongs to the wrong account",
    );

    const publicEstimate = legacyWorker ? null : await call("/api/estimate", {
      method: "POST",
      body: JSON.stringify(ESTIMATOR_CANARY_INPUT),
    });
    if (!legacyWorker) {
      assert.deepEqual(publicEstimate?.input, ESTIMATOR_CANARY_INPUT, "public estimator changed the canary tuple");
      assert.ok(Number.isInteger(publicEstimate?.basis?.ruleVersion), "public estimator did not expose a rule version");
    }

    projectCreateAttempted = true;
    const projectCreationKey = `release-canary-${crypto.randomUUID()}`;
    const createBody = JSON.stringify({
      name: marker,
      input: {
        ...ESTIMATOR_CANARY_INPUT,
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
      },
    });
    const created = await call("/api/projects", {
      method: "POST",
      headers: legacyWorker ? {} : {
        "idempotency-key": projectCreationKey,
        "x-grihagrid-entry-point": "shared_estimate",
      },
      body: createBody,
    }, [201]);
    projectId = String(created?.project?.id || "");
    assert.match(projectId, /^[0-9a-f-]{36}$/u, "canary project did not return a valid identifier");
    cleanupIds.add(projectId);
    if (!legacyWorker) {
      for (const field of Object.keys(ESTIMATOR_CANARY_INPUT)) {
        assert.equal(created?.project?.input?.[field], ESTIMATOR_CANARY_INPUT[field], `created project changed estimator field ${field}`);
      }
      for (const field of ["plotSqft", "builtUpSqft", "lowInr", "highInr", "floors", "quality", "city"]) {
        assert.equal(created?.project?.estimate?.[field], publicEstimate?.estimate?.[field], `created project estimate changed ${field}`);
      }
      assert.equal(created?.project?.estimateRuleVersion, publicEstimate?.basis?.ruleVersion, "created project used a different estimate rule version");
      publicEstimateVerified = true;
      const replayed = await call("/api/projects", {
        method: "POST",
        headers: {
          "idempotency-key": projectCreationKey,
          "x-grihagrid-entry-point": "shared_estimate",
        },
        body: createBody,
      }, [200]);
      assert.equal(replayed?.project?.id, projectId, "project create replay returned a different project");
      projectCreateReplayVerified = true;
    }

    const encodedProjectId = encodeURIComponent(projectId);
    const project = await call(`/api/projects/${encodedProjectId}`);
    assert.equal(project?.project?.id, projectId, "canary project read did not match the created record");

    const generated = await call(`/api/projects/${encodedProjectId}/report`, { method: "POST", body: "{}" }, [200, 201]);
    assert.ok(generated?.report, "canary report generation did not return a report");
    const cached = await call(`/api/projects/${encodedProjectId}/report`);
    assert.ok(cached?.report, "canary report read did not return the generated report");
    const projectRevision = legacyWorker
      ? Number(created?.project?.inputRevision || 0)
      : Number(generated?.revision?.revision || 0);
    const reportSchemaVersion = legacyWorker
      ? Number(generated?.report?.version || 0)
      : Number(generated?.revision?.report?.schemaVersion || 0);
    assert.ok(Number.isInteger(projectRevision) && projectRevision > 0, "canary project revision is invalid");
    assert.ok(Number.isInteger(reportSchemaVersion) && reportSchemaVersion > 0, "canary report schema version is invalid");
    if (!legacyWorker) {
      assert.equal(generated?.project?.id, projectId, "canary report envelope belongs to the wrong project");
      assert.equal(generated?.project?.inputRevision, projectRevision, "canary report project snapshot is revision-mismatched");
      assert.equal(generated?.report?.version, reportSchemaVersion, "canary report schema metadata is mismatched");
      assert.equal(cached?.revision?.revision, projectRevision, "cached report revision changed");
      assert.equal(cached?.revision?.report?.schemaVersion, reportSchemaVersion, "cached report schema changed");
    } else {
      assert.equal(generated?.report?.projectId, projectId, "legacy canary report belongs to the wrong project");
      assert.equal(cached?.report?.projectId, projectId, "legacy cached report belongs to the wrong project");
    }
    const immutableReportJson = JSON.stringify(generated.report);
    immutableReportSha256 = await reportSha256(generated.report);
    assert.equal(JSON.stringify(cached.report), immutableReportJson, "cached report bytes changed after generation");
    assert.equal(await reportSha256(cached.report), immutableReportSha256, "cached report checksum changed after generation");
    if (!legacyWorker) {
      const feedbackPath = `/api/projects/${encodedProjectId}/revisions/${projectRevision}/reports/${reportSchemaVersion}/feedback`;
      const emptyFeedback = await call(feedbackPath);
      assert.equal(emptyFeedback?.feedback, null, "new canary report unexpectedly has feedback");
      const savedFeedback = await call(feedbackPath, {
        method: "PUT",
        body: JSON.stringify({ outcome: "helpful", sections: ["brief_check", "next_actions"] }),
      });
      assert.equal(savedFeedback?.feedback?.outcome, "helpful", "canary feedback outcome was not saved");
      assert.deepEqual(savedFeedback?.feedback?.sections, ["brief_check", "next_actions"], "canary feedback sections changed");
      const readFeedback = await call(feedbackPath);
      assert.deepEqual(readFeedback?.feedback, savedFeedback?.feedback, "canary feedback did not survive an exact-version read");
      const reportAfterFeedback = await call(`/api/projects/${encodedProjectId}/report`);
      assert.equal(JSON.stringify(reportAfterFeedback?.report), immutableReportJson, "canary feedback mutated the immutable report bytes");
      assert.equal(await reportSha256(reportAfterFeedback?.report), immutableReportSha256, "canary feedback changed the immutable report checksum");

      const handoffSections = ["overview", "risks", "next_actions"];
      const createdShare = await call(`/api/projects/${encodedProjectId}/report-shares`, {
        method: "POST",
        headers: { "idempotency-key": `release-report-share-${crypto.randomUUID()}` },
        body: JSON.stringify({
          projectRevision,
          reportSchemaVersion,
          expiresInDays: 1,
          sections: handoffSections,
        }),
      }, [201]);
      const reportShare = createdShare?.share;
      const reportShareId = String(reportShare?.id || "");
      assert.match(reportShareId, /^[0-9a-f-]{36}$/u, "report handoff did not return a valid share identifier");
      assert.equal(reportShare?.projectRevision, projectRevision, "report handoff changed the project revision");
      assert.equal(reportShare?.reportSchemaVersion, reportSchemaVersion, "report handoff changed the report schema version");
      assert.deepEqual(reportShare?.sections, handoffSections, "report handoff changed the selected sections");
      assert.equal(reportShare?.active, true, "new report handoff was not active");
      const reportShareToken = reportShareCapabilityToken(reportShare?.url, origin.origin);

      const publicShare = await call("/api/shared/report", {
        method: "POST",
        anonymous: true,
        body: JSON.stringify({ token: reportShareToken }),
      });
      assert.deepEqual(Object.keys(publicShare?.share || {}).sort(), ["expiresAt", "sections"], "public handoff exposed owner metadata or report internals");
      assert.equal(publicShare?.share?.expiresAt, reportShare?.expiresAt, "public handoff changed the share expiry");
      assert.deepEqual(
        Object.keys(publicShare?.share?.sections || {}).sort(),
        ["nextActions", "overview", "risks"],
        "public handoff did not enforce the selected-section allowlist",
      );
      assert.equal(JSON.stringify(publicShare).includes(projectId), false, "public handoff exposed the private project identifier");
      assert.equal(JSON.stringify(publicShare).includes(reportShareId), false, "public handoff exposed the private share identifier");

      await call(`/api/projects/${encodedProjectId}/report-shares/${encodeURIComponent(reportShareId)}`, { method: "DELETE" }, [204]);
      await call("/api/shared/report", {
        method: "POST",
        anonymous: true,
        body: JSON.stringify({ token: reportShareToken }),
      }, [410]);
      reportHandoffVerified = true;
    }

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
          deletedIds.add(cleanupId);
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

  const result = {
    origin: origin.origin,
    releaseId,
    checkedAt: new Date().toISOString(),
    legacyWorker,
    projectCreateAttempted,
    publicEstimateVerified,
    projectCreateReplayVerified,
    reportHandoffVerified,
    projectCreated: cleanupIds.size > 0,
    projectDeleted: cleanupIds.size > 0 && deletedIds.size === cleanupIds.size,
    canaryProjectIds: [...cleanupIds].sort(),
    sessionLoggedOut: sessionRevocationVerified,
    sessionRevocationVerified,
    reportSha256: immutableReportSha256,
    checks: completed,
  };
  if (primaryError) {
    primaryError.releaseEvidence = result;
    throw primaryError;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] || process.env.GRIHAGRID_CANARY_ORIGIN;
  assert.ok(origin, "usage: node scripts/authenticated-smoke.mjs https://worker.example");
  try {
    const result = await runAuthenticatedSmoke(origin, {
      email: process.env.GRIHAGRID_CANARY_EMAIL,
      password: process.env.GRIHAGRID_CANARY_PASSWORD,
    }, {
      expectedReleaseId: process.env.EXPECT_RELEASE_ID,
      legacyWorker: process.env.LEGACY_WORKER_COMPAT === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error?.releaseEvidence) process.stdout.write(`${JSON.stringify(error.releaseEvidence, null, 2)}\n`);
    throw error;
  }
}
