import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const reportShareAbuseHmacKey = "ab".repeat(32);

function publicAdmissionHarness() {
  const state = {
    cacheReads: 0,
    cacheWrites: 0,
    cacheKeys: [],
    controlReads: 0,
    readAdmissions: [],
    reportLookups: 0,
  };
  const env = {
    APP_ORIGIN: "https://app.example.test",
    REPORT_SHARE_ABUSE_HMAC_KEY: reportShareAbuseHmacKey,
    GRIHAGRID_CACHE: {
      get: async (key) => {
        state.cacheReads += 1;
        state.cacheKeys.push(key);
        return null;
      },
      put: async () => {
        state.cacheWrites += 1;
      },
    },
    DB: {
      prepare(sql) {
        if (sql.includes("FROM report_handoff_controls")) {
          return {
            first: async () => {
              state.controlReads += 1;
              return { enabled: 1 };
            },
          };
        }
        if (sql.includes("INSERT INTO report_share_read_counters")) {
          return {
            bind(...bindings) {
              return {
                first: async () => {
                  state.readAdmissions.push(bindings);
                  return { request_count: state.readAdmissions.length };
                },
              };
            },
          };
        }
        if (sql.includes("FROM report_shares sh")) {
          return {
            bind() {
              return {
                first: async () => {
                  state.reportLookups += 1;
                  return null;
                },
              };
            },
          };
        }
        throw new Error(`unexpected SQL in public admission harness: ${sql}`);
      },
    },
  };
  return { env, state };
}

function publicReportRequest({
  origin = "https://app.example.test",
  requestUrl = "https://worker.example.test/api/shared/report",
  contentType = "application/json",
  body = JSON.stringify({ token: "s".repeat(43) }),
} = {}) {
  return new Request(requestUrl, {
    method: "POST",
    headers: {
      origin,
      "content-type": contentType,
    },
    body,
  });
}

async function assertGenericPublicMiss(response) {
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.deepEqual(payload, { error: "shared report not found", code: "report_share_not_found" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

function sourceReport() {
  const input = {
    width: 30,
    length: 50,
    city: "Pune",
    facing: "East",
    floors: "G+1",
    bedrooms: "3",
    bathrooms: 3,
    parking: true,
    style: "Quiet courtyard home",
    quality: "Signature",
    roadWidthFt: 24,
    plotShape: "regular",
    accessibility: "none",
    futureUse: "none",
    budgetLakh: 50,
  };
  const estimate = __test.computeEstimate(input);
  const project = {
    id: "project-private-canary",
    name: "Owner Name owner@example.test",
    input_json: JSON.stringify(input),
    estimate_json: JSON.stringify(estimate),
    brief_check_json: JSON.stringify(__test.briefCheck(input, estimate)),
  };
  return __test.buildReport(
    project,
    "a".repeat(64),
    "internal-report-id",
    "2026-08-16 10:00:00",
  );
}

test("report share requests require exact primitive fields and canonicalize sections", () => {
  assert.deepEqual(__test.normalizeReportShareRequest({
    projectRevision: 3,
    reportSchemaVersion: 2,
    expiresInDays: 7,
    sections: ["risks", "overview", "cost"],
  }), {
    projectRevision: 3,
    reportSchemaVersion: 2,
    expiresInDays: 7,
    sections: ["overview", "cost", "risks"],
  });

  for (const body of [
    { projectRevision: "3", reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"] },
    { projectRevision: Number.MAX_SAFE_INTEGER + 1, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 1, expiresInDays: 7, sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: "7", sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 2, sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: [] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview", "overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: ["raw_input"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"], note: "free text" },
  ]) {
    assert.throws(() => __test.normalizeReportShareRequest(body), /report|sections|expiry|projectRevision/u);
  }
});

test("public report projection is selected, bounded, and recursively redacted", () => {
  const report = sourceReport();
  report.ownerEmail = "leak-owner@example.test";
  report.rawInput = { facing: "secret-facing" };
  report.briefCheck.internal = "secret-check";
  report.summary.city = "secret-city";
  report.areaProgram.projectId = "secret-project";
  report.costPlan.providerOrderId = "secret-provider";
  report.deliveryPlan.phases[0].internalId = "secret-phase";

  const sections = __test.publicReportShareProjection(report, [
    "overview", "programme", "cost", "timeline", "risks", "next_actions",
  ]);
  assert.deepEqual(Object.keys(sections), ["overview", "programme", "cost", "timeline", "risks", "nextActions"]);
  assert.deepEqual(Object.keys(sections.overview), ["status", "label", "headline", "summary", "disclaimer"]);
  assert.deepEqual(Object.keys(sections.programme), [
    "plotSqft", "targetBuiltUpSqft", "floorCount", "bedrooms", "bathrooms",
    "estimatedFloorPlateSqft", "estimatedOpenAreaSqft", "suggestedSpaces",
    "architecture",
  ]);
  assert.equal(sections.programme.architecture.version, 1);
  assert.equal(sections.programme.architecture.siteBrief.city, "Pune");
  assert.equal(sections.programme.architecture.siteBrief.facing, "East");
  assert.ok(sections.programme.architecture.rooms.length >= 1);
  assert.ok(sections.programme.architecture.verificationRegister.length >= 10);
  assert.equal(Object.hasOwn(sections.programme.architecture.siteBrief, "styleDirection"), false);
  assert.deepEqual(Object.keys(sections.cost.categories[0]), ["name", "percent", "amountInr"]);
  assert.deepEqual(Object.keys(sections.timeline.phases[0]), ["name", "weeks"]);
  const serialized = JSON.stringify(sections);
  for (const secret of [
    "Owner Name", "owner@example.test", "leak-owner@example.test", "project-private-canary",
    "internal-report-id", "secret-facing", "secret-check", "secret-city", "secret-project",
    "secret-provider", "secret-phase", "Quiet courtyard home", "a".repeat(64),
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  const overviewOnly = __test.publicReportShareProjection(report, ["overview"]);
  assert.deepEqual(Object.keys(overviewOnly), ["overview"]);
  assert.equal(JSON.stringify(overviewOnly).includes("lowInr"), false);

  const malformed = structuredClone(report);
  malformed.costPlan.lowInr = Number.POSITIVE_INFINITY;
  assert.throws(
    () => __test.publicReportShareProjection(malformed, ["cost"]),
    /shared report is unavailable/u,
  );
  const oversized = structuredClone(report);
  oversized.risks = ["x".repeat(1_001)];
  assert.throws(
    () => __test.publicReportShareProjection(oversized, ["risks"]),
    /shared report is unavailable/u,
  );
});

test("owner metadata never returns stored hashes and emits the URL only with the fresh token", () => {
  const row = {
    id: "share-id",
    project_id: "private-project",
    user_id: "private-user",
    project_revision: 4,
    report_schema_version: 2,
    sections_json: JSON.stringify(["overview", "next_actions"]),
    report_content_hash: "a".repeat(64),
    token_hash: "b".repeat(64),
    idempotency_key_hash: "c".repeat(43),
    request_hash: "d".repeat(64),
    expires_at: "2099-08-23 10:00:00",
    revoked_at: null,
    access_count: 2,
    created_at: "2099-08-16 10:00:00",
  };
  const metadata = __test.reportShareMetadata(row);
  assert.deepEqual(metadata, {
    id: "share-id",
    projectRevision: 4,
    reportSchemaVersion: 2,
    sections: ["overview", "next_actions"],
    expiresAt: "2099-08-23 10:00:00",
    revokedAt: null,
    active: true,
    accessCount: 2,
    lastAccessedAt: null,
    createdAt: "2099-08-16 10:00:00",
  });
  assert.equal(JSON.stringify(metadata).includes("private-project"), false);
  assert.equal(Object.hasOwn(metadata, "url"), false);
  assert.equal(
    __test.reportShareMetadata(row, "https://app.example.test", "t".repeat(43)).url,
    `https://app.example.test/share/report#${"t".repeat(43)}`,
  );
});

test("report bearer redemption rejects untrusted origins and non-JSON media before admission", async () => {
  const token = "s".repeat(43);
  assert.equal(token.length, 43);
  assert.equal(__test.operationalRoute("/api/shared/report"), "/api/shared/report");
  assert.equal(__test.operationalRoute("/share/report"), "/share/report");

  for (const request of [
    publicReportRequest({ origin: "https://evil.example.test" }),
    publicReportRequest({ origin: "https://app.example.test/" }),
    publicReportRequest({ origin: "https://evil.example.test", contentType: "text/plain" }),
    publicReportRequest({ contentType: "text/plain; application/json" }),
    publicReportRequest({ contentType: "application/problem+json" }),
  ]) {
    const { env, state } = publicAdmissionHarness();
    const response = await worker.fetch(request, env, {});
    assert.ok([403, 404].includes(response.status));
    assert.equal(request.bodyUsed, true);
    assert.equal(state.controlReads, 0);
    assert.equal(state.cacheReads, 0);
    assert.equal(state.cacheWrites, 0);
    assert.equal(state.readAdmissions.length, 0);
    assert.equal(state.reportLookups, 0);
  }

  const { env, state } = publicAdmissionHarness();
  const accepted = await worker.fetch(publicReportRequest({
    contentType: "Application/JSON; charset=utf-8",
  }), env, {});
  await assertGenericPublicMiss(accepted);
  assert.equal(state.controlReads, 1);
  assert.equal(state.cacheReads, 1);
  assert.equal(state.cacheWrites, 1);
  const [prefix, scope, window, identity] = state.cacheKeys[0].split(":");
  assert.deepEqual([prefix, scope], ["rate", "public-report-share"]);
  assert.equal(
    identity,
    createHmac("sha256", reportShareAbuseHmacKey)
      .update(`public-report-share:${window}:unknown`)
      .digest("hex"),
  );
  assert.equal(state.readAdmissions.length, 1);
  assert.equal(state.reportLookups, 1);

  const sameWorkerOrigin = publicAdmissionHarness();
  const sameWorkerOriginResponse = await worker.fetch(publicReportRequest({
    origin: "https://worker.example.test",
  }), sameWorkerOrigin.env, {});
  await assertGenericPublicMiss(sameWorkerOriginResponse);
  assert.equal(sameWorkerOrigin.state.readAdmissions.length, 1);

  const wrongMethod = await worker.fetch(new Request("https://app.example.test/api/shared/report"), {}, {});
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
});

test("report bearer redemption requires one exact token field before any admission", async () => {
  const token = "s".repeat(43);
  for (const body of [
    "",
    "{}",
    JSON.stringify({ token, extra: true }),
    JSON.stringify({ token: "short" }),
    JSON.stringify({ token: "s".repeat(42) }),
    JSON.stringify({ token: "s".repeat(44) }),
    JSON.stringify({ token: `${"s".repeat(42)}!` }),
    JSON.stringify({ token: 123 }),
    JSON.stringify([token]),
    "{",
  ]) {
    const { env, state } = publicAdmissionHarness();
    const response = await worker.fetch(publicReportRequest({ body }), env, {});
    await assertGenericPublicMiss(response);
    assert.equal(state.controlReads, 0);
    assert.equal(state.cacheWrites, 0);
    assert.equal(state.readAdmissions.length, 0);
  }
});

test("chunked report bearer bodies over 512 bytes fail generically before admission", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const chunks = [
    encoder.encode(`{"token":"${"s".repeat(43)}","padding":"`),
    encoder.encode("x".repeat(480)),
    encoder.encode("x".repeat(80)),
    encoder.encode('"}'),
  ];
  const stream = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const { env, state } = publicAdmissionHarness();
  const response = await worker.fetch(new Request("https://worker.example.test/api/shared/report", {
    method: "POST",
    headers: {
      origin: "https://app.example.test",
      "content-type": "application/json",
    },
    body: stream,
    duplex: "half",
  }), env, {});
  await assertGenericPublicMiss(response);
  assert.equal(cancelled, true);
  assert.equal(state.controlReads, 0);
  assert.equal(state.cacheWrites, 0);
  assert.equal(state.readAdmissions.length, 0);
});

test("report share Worker secret fails closed and read counters use keyed hourly subjects", async () => {
  const assertUnavailable = (error) => error?.status === 503 && error?.code === "abuse_control_unavailable";
  await assert.rejects(
    __test.reportShareAbuseHmacKey({
      GRIHAGRID_CACHE: { get: async () => reportShareAbuseHmacKey },
    }),
    assertUnavailable,
  );
  await assert.rejects(
    __test.reportShareAbuseHmacKey({
      REPORT_SHARE_ABUSE_HMAC_KEY: "not-a-hex-key",
      GRIHAGRID_CACHE: { get: async () => reportShareAbuseHmacKey },
    }),
    assertUnavailable,
  );
  assert.equal(
    await __test.reportShareAbuseHmacKey({ REPORT_SHARE_ABUSE_HMAC_KEY: reportShareAbuseHmacKey }),
    reportShareAbuseHmacKey,
  );

  const bindings = [];
  const db = {
    prepare(sql) {
      assert.match(sql, /INSERT INTO report_share_read_counters/u);
      return {
        bind(...values) {
          bindings.push(values);
          return { first: async () => ({ request_count: 1 }) };
        },
      };
    },
  };
  const request = new Request("https://app.example.test/api/shared/report", {
    headers: { "cf-connecting-ip": "198.51.100.77" },
  });
  await __test.acquireReportShareReadAdmission(
    db, request, reportShareAbuseHmacKey, new Date("2026-08-16T10:23:45.000Z"),
  );
  await __test.acquireReportShareReadAdmission(
    db, request, reportShareAbuseHmacKey, new Date("2026-08-16T11:00:00.000Z"),
  );
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0][1], "2026-08-16 10:00:00");
  assert.equal(bindings[1][1], "2026-08-16 11:00:00");
  const expected = createHmac("sha256", reportShareAbuseHmacKey)
    .update("report-share-read:2026-08-16 10:00:00:198.51.100.77")
    .digest("hex");
  assert.equal(bindings[0][0], expected);
  assert.notEqual(bindings[0][0], bindings[1][0]);
  assert.notEqual(
    bindings[0][0],
    createHash("sha256").update("report-share-read:198.51.100.77").digest("hex"),
  );

  await assert.rejects(
    __test.acquireReportShareReadAdmission(db, request, "00", new Date("2026-08-16T10:23:45.000Z")),
    assertUnavailable,
  );

  const missingKey = publicAdmissionHarness();
  delete missingKey.env.REPORT_SHARE_ABUSE_HMAC_KEY;
  const failClosed = await worker.fetch(publicReportRequest(), missingKey.env, {});
  assert.equal(failClosed.status, 503);
  assert.equal((await failClosed.json()).code, "abuse_control_unavailable");
  assert.equal(missingKey.state.cacheWrites, 0);
  assert.equal(missingKey.state.readAdmissions.length, 0);
});

test("owner share creation rejects a missing or malformed handoff key before mutable admission", async () => {
  for (const configuredKey of [undefined, "not-a-hex-key"]) {
    const state = {
      cacheReads: 0,
      cacheWrites: 0,
      databasePrepares: 0,
    };
    const env = {
      APP_ORIGIN: "https://app.example.test",
      GRIHAGRID_CACHE: {
        get: async () => {
          state.cacheReads += 1;
          return null;
        },
        put: async () => {
          state.cacheWrites += 1;
        },
      },
      DB: {
        prepare() {
          state.databasePrepares += 1;
          throw new Error("owner create reached D1 before validating its handoff key");
        },
      },
      ...(configuredKey === undefined ? {} : { REPORT_SHARE_ABUSE_HMAC_KEY: configuredKey }),
    };
    const response = await worker.fetch(new Request(
      "https://worker.example.test/api/projects/project-secret-failure/report-shares",
      {
        method: "POST",
        headers: {
          origin: "https://app.example.test",
          "content-type": "application/json",
          "idempotency-key": "secret-failure-must-not-admit",
        },
        body: JSON.stringify({
          projectRevision: 1,
          reportSchemaVersion: 2,
          expiresInDays: 7,
          sections: ["overview"],
        }),
      },
    ), env, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "abuse_control_unavailable");
    assert.deepEqual(state, {
      cacheReads: 0,
      cacheWrites: 0,
      databasePrepares: 0,
    });
  }
});

test("release canary project classification accepts only the exact generated marker", () => {
  const marker = "Release canary 123e4567-e89b-42d3-a456-426614174000";
  assert.equal(__test.isReleaseCanaryProjectName(marker), true);
  for (const value of [
    ` ${marker}`,
    `${marker} `,
    `${marker} customer`,
    "release canary 123e4567-e89b-42d3-a456-426614174000",
    "Release canary 123E4567-E89B-42D3-A456-426614174000",
    "Release canary 123e4567-e89b-12d3-a456-426614174000",
    "Release canary 123e4567-e89b-42d3-c456-426614174000",
    "Release canary not-a-uuid",
    null,
  ]) {
    assert.equal(__test.isReleaseCanaryProjectName(value), false, String(value));
  }
});

test("exact report handoff documents are non-cacheable and non-indexable for GET and HEAD", async () => {
  const assets = {
    fetch: async (request) => new URL(request.url).pathname === "/index.html"
      ? new Response("<!doctype html><title>GrihaGrid</title>", { headers: { "content-type": "text/html" } })
      : new Response("missing", { status: 404 }),
  };
  for (const method of ["GET", "HEAD"]) {
    const response = await worker.fetch(new Request("https://app.example.test/share/report", {
      method,
      headers: { accept: "text/html" },
    }), { ASSETS: assets }, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex,nofollow,noarchive");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
});
