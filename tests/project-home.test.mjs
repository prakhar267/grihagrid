import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { __test } from "../worker/index.js";

const {
  digestBase64,
  operationalRoute,
  projectHomeProjection,
  stableStringify,
} = __test;

async function digestHex(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function projectRow(overrides = {}) {
  const input = {
    width: 30,
    length: 50,
    floors: "G+1",
    quality: "Signature",
    city: "Pune",
    bedrooms: 3,
    parking: true,
  };
  const estimate = {
    city: "Pune",
    floors: "G+1",
    quality: "Signature",
    plotSqft: 1500,
    builtUpSqft: 1830,
    lowInr: 4_026_000,
    highInr: 4_730_550,
  };
  return {
    id: "project-owner-a",
    user_id: "owner-a",
    name: "Rao residence",
    status: "feasibility_ready",
    input_json: JSON.stringify(input),
    estimate_json: JSON.stringify(estimate),
    input_revision: 2,
    report_available: 0,
    created_at: "2026-08-14 09:00:00",
    updated_at: "2026-08-14 09:30:00",
    ...overrides,
  };
}

async function currentRows(project = projectRow()) {
  const input = JSON.parse(project.input_json);
  const estimate = JSON.parse(project.estimate_json);
  const reportHash = await digestHex(stableStringify({ version: 1, input, estimate }));
  const comparisonHash = await digestHex(stableStringify({ input, estimate }));
  const scenarios = [
    { id: "comparison-2_a", key: "A", label: "Courtyard calm" },
    { id: "comparison-2_b", key: "B", label: "Upper-floor room" },
  ];
  return {
    projectRow: project,
    reportRow: {
      id: "report-1",
      version: 1,
      input_hash: reportHash,
      generated_at: "2026-08-14 09:10:00",
    },
    aiRow: {
      id: "ai-1",
      source_report_id: "report-1",
      source_input_hash: reportHash,
      prompt_version: "grihagrid-planning-brief-v1",
      schema_version: 1,
      model: "gemini-3.6-flash",
      generated_at: "2026-08-14 09:12:00",
    },
    comparisonRow: {
      id: "comparison-2",
      version: 2,
      project_input_revision: 2,
      content_json: JSON.stringify({ sourceInputHash: comparisonHash, scenarios }),
      created_at: "2026-08-14 09:20:00",
    },
    selectionRow: {
      scenario_id: "comparison-2_a",
      selected_at: "2026-08-14 09:25:00",
      locked_at: null,
    },
    familyRoomRow: {
      id: "family-room-2",
      comparison_id: "comparison-2",
      response_count: 2,
      expires_at: "2026-08-20 09:20:00",
      revoked_at: null,
    },
    familyResponseRows: [
      { preference: "A", confidence: "high", reasons_json: '["budget"]' },
      { preference: "B", confidence: "medium", reasons_json: '["space"]' },
    ],
    purchaseRow: {
      order_id: "order-paid-2",
      comparison_id: "comparison-2",
      status: "paid",
      entitlement_revoked_at: null,
    },
    countsRow: {
      comparisons: 4,
      family_rooms: 3,
      purchased_artifacts: 2,
      orders: 5,
    },
    now: new Date("2026-08-14T10:00:00Z"),
  };
}

test("Project Home lifecycle follows the authoritative core-stage precedence", async () => {
  const project = projectRow();
  const rows = await currentRows(project);
  const matrix = [
    {
      name: "new project",
      input: { projectRow: project },
      stage: "feasibility_pending",
      completed: 0,
      action: "open_feasibility",
      currentStep: "feasibility",
    },
    {
      name: "current feasibility",
      input: { projectRow: project, reportRow: rows.reportRow },
      stage: "comparison_pending",
      completed: 1,
      action: "start_comparison",
      currentStep: "comparison",
    },
    {
      name: "stale comparison",
      input: {
        projectRow: project,
        reportRow: rows.reportRow,
        comparisonRow: { ...rows.comparisonRow, project_input_revision: 1 },
        selectionRow: rows.selectionRow,
        familyRoomRow: rows.familyRoomRow,
        familyResponseRows: rows.familyResponseRows,
        purchaseRow: rows.purchaseRow,
      },
      stage: "comparison_stale",
      completed: 1,
      action: "recalculate_comparison",
      currentStep: null,
    },
    {
      name: "current comparison",
      input: { projectRow: project, reportRow: rows.reportRow, comparisonRow: rows.comparisonRow },
      stage: "direction_pending",
      completed: 2,
      action: "choose_direction",
      currentStep: "direction",
    },
    {
      name: "direction chosen",
      input: {
        projectRow: project,
        reportRow: rows.reportRow,
        comparisonRow: rows.comparisonRow,
        selectionRow: rows.selectionRow,
      },
      stage: "decision_ready",
      completed: 3,
      action: "open_handoff",
      currentStep: null,
    },
  ];

  for (const item of matrix) {
    const result = await projectHomeProjection({ ...item.input, now: rows.now });
    assert.equal(result.lifecycle.state, "active", item.name);
    assert.equal(result.lifecycle.stage, item.stage, item.name);
    assert.equal(result.lifecycle.completedCoreSteps, item.completed, item.name);
    assert.equal(result.lifecycle.totalCoreSteps, 3, item.name);
    assert.equal(result.lifecycle.nextAction.code, item.action, item.name);
    assert.deepEqual(result.lifecycle.steps.map((step) => step.id), ["feasibility", "comparison", "family", "direction"]);
    const currentSteps = result.lifecycle.steps.filter((step) => step.status === "current").map((step) => step.id);
    assert.deepEqual(currentSteps, item.currentStep ? [item.currentStep] : [], `${item.name}: single-current semantics`);
  }
});

test("Project Home returns current aggregate Family and exact paid Decision Compare state", async () => {
  const result = await projectHomeProjection(await currentRows());

  assert.deepEqual(result.current.family, {
    available: true,
    current: true,
    roomId: "family-room-2",
    status: "split",
    responseCount: 2,
    maxResponses: 5,
    active: true,
    expiresAt: "2026-08-20 09:20:00",
    preferences: { A: 1, B: 1, notReady: 0 },
  });
  assert.deepEqual(result.current.purchase, {
    available: true,
    current: true,
    orderId: "order-paid-2",
    status: "paid",
    fulfillmentStatus: "ready",
    entitlementActive: true,
  });
  assert.deepEqual(result.counts, { comparisons: 4, familyRooms: 3, purchasedArtifacts: 2, orders: 5 });
  assert.equal(result.lifecycle.steps.find((step) => step.id === "family").status, "active");
  assert.equal(result.lifecycle.completedCoreSteps, 3, "Family is optional and does not count as a core gate");
});

test("stale, refunded, and revoked historical evidence never badges the current project", async () => {
  const rows = await currentRows();
  const cases = [
    {
      name: "older paid artifact against stale comparison",
      input: {
        ...rows,
        comparisonRow: { ...rows.comparisonRow, project_input_revision: 1 },
      },
    },
    {
      name: "refunded exact artifact",
      input: {
        ...rows,
        purchaseRow: { ...rows.purchaseRow, status: "refunded", entitlement_revoked_at: "2026-08-14 11:00:00" },
      },
    },
    {
      name: "disputed exact artifact",
      input: {
        ...rows,
        purchaseRow: { ...rows.purchaseRow, entitlement_revoked_at: "2026-08-14 11:00:00" },
      },
    },
  ];

  for (const item of cases) {
    const result = await projectHomeProjection(item.input);
    assert.deepEqual(result.current.purchase, {
      available: false,
      current: false,
      orderId: null,
      status: null,
      fulfillmentStatus: null,
      entitlementActive: false,
    }, item.name);
    assert.equal(result.counts.purchasedArtifacts, 2, `${item.name}: history count survives`);
  }
});

test("archived state is read-only while current records remain visible", async () => {
  const rows = await currentRows(projectRow({ status: "archived" }));
  const result = await projectHomeProjection(rows);
  assert.equal(result.lifecycle.state, "archived");
  assert.equal(result.lifecycle.stage, "archived");
  assert.equal(result.lifecycle.nextAction.code, "view_archived");
  assert.equal(result.lifecycle.nextAction.target, "dashboard");
  assert.equal(result.current.comparison.current, true);
  assert.equal(result.current.selection.available, true);
  assert.equal(result.current.family.active, false);
  assert.equal(result.current.purchase.entitlementActive, true);
  assert.equal(result.lifecycle.steps.some((step) => step.status === "current"), false);
});

test("Project Home response omits raw envelopes, bearer material, individual responses, and provider state", async () => {
  const result = await projectHomeProjection(await currentRows());
  const forbidden = new Set([
    "checkoutUrl",
    "contentHash",
    "contentJson",
    "inputHash",
    "promptSha256",
    "providerInteractionId",
    "providerOrderId",
    "providerPaymentId",
    "reasonsJson",
    "receiptHash",
    "responses",
    "sourceInputHash",
    "token",
    "tokenHash",
    "usage",
  ]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `forbidden response key: ${key}`);
      visit(child);
    }
  };
  visit(result);
  assert.equal(JSON.stringify(result).includes("budget"), false, "individual structured reasons do not leave the Worker");
});

class ReadOnlyHomeDatabase {
  constructor(batchResults) {
    this.batchResults = batchResults;
    this.runCalls = 0;
    this.batchCalls = 0;
  }

  prepare(sql) {
    const database = this;
    return {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        if (sql.includes("FROM sessions s")) {
          return {
            session_id: "session-a",
            user_id: "owner-a",
            csrf_hash: "unused",
            expires_at: "2099-01-01 00:00:00",
            email: "owner@example.test",
            name: "Owner",
            user_created_at: "2026-08-14 08:00:00",
          };
        }
        throw new Error(`unexpected first(): ${sql}`);
      },
      async run() {
        database.runCalls += 1;
        throw new Error(`Project Home attempted a write: ${sql}`);
      },
    };
  }

  async batch(statements) {
    this.batchCalls += 1;
    assert.equal(statements.length, 9);
    assert.equal(statements.every((statement) => /^\s*SELECT\b/u.test(statement.sql)), true, "Home batch is SELECT-only");
    return this.batchResults;
  }
}

function d1Result(rows = []) {
  return { success: true, results: rows };
}

test("authenticated Home GET is one owner-scoped read batch, no-store, and zero-write", async () => {
  const rows = await currentRows();
  const db = new ReadOnlyHomeDatabase([
    d1Result([{ ...rows.projectRow, report_available: 1 }]),
    d1Result([rows.reportRow]),
    d1Result([rows.aiRow]),
    d1Result([rows.comparisonRow]),
    d1Result([rows.selectionRow]),
    d1Result([rows.familyRoomRow]),
    d1Result(rows.familyResponseRows),
    d1Result([rows.purchaseRow]),
    d1Result([rows.countsRow]),
  ]);
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("asset fallback", { status: 418 }) },
  };
  const request = () => new Request("https://grihagrid.example/api/projects/project-owner-a/home", {
    headers: { cookie: "__Host-grihagrid_session=session-secret" },
  });

  const first = await worker.fetch(request(), env, {});
  const second = await worker.fetch(request(), env, {});
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(db.batchCalls, 2);
  assert.equal(db.runCalls, 0);
  assert.deepEqual(Object.keys(await first.json()), ["project", "lifecycle", "current", "counts"]);
});

test("missing and foreign Home reads share 404, malformed and nested API paths stay JSON", async () => {
  const missingDb = new ReadOnlyHomeDatabase([
    d1Result(), d1Result(), d1Result(), d1Result(), d1Result(), d1Result(), d1Result(), d1Result(), d1Result(),
  ]);
  const env = {
    DB: missingDb,
    ASSETS: { fetch: async () => new Response("asset fallback", { status: 418 }) },
  };
  const authenticated = (path, method = "GET") => new Request(`https://grihagrid.example${path}`, {
    method,
    headers: { cookie: "__Host-grihagrid_session=session-secret" },
  });

  for (const path of ["/api/projects/missing/home", "/api/projects/foreign/home", "/api/projects/%ZZ/home"]) {
    const response = await worker.fetch(authenticated(path), env, {});
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("content-type") || "", /application\/json/u, path);
    assert.equal((await response.json()).code, "project_not_found", path);
  }

  const nested = await worker.fetch(authenticated("/api/projects/missing/home/extra"), env, {});
  assert.equal(nested.status, 404);
  assert.match(nested.headers.get("content-type") || "", /application\/json/u);
  assert.equal((await nested.json()).code, "not_found");

  const method = await worker.fetch(authenticated("/api/projects/missing/home", "POST"), env, {});
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
});

test("Project Home route is privacy-templated and aggregate events are allowlisted", async () => {
  assert.equal(operationalRoute("/api/projects/private-project-id/home"), "/api/projects/:projectId/home");
  const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(source, /"project_home_opened"/u);
  assert.match(source, /"project_home_next_action_clicked"/u);
  assert.match(source, /"project_home", "owner_compare"/u);
});

test("Project Home measurements accept only aggregate name, surface, and outcome", async () => {
  const csrf = "project-home-csrf-token";
  const stored = [];
  const db = {
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (!sql.includes("FROM sessions s")) throw new Error(`unexpected first(): ${sql}`);
          return {
            session_id: "session-a",
            user_id: "owner-a",
            csrf_hash: await digestBase64(csrf),
            expires_at: "2099-01-01 00:00:00",
            email: "owner@example.test",
            name: "Owner",
            user_created_at: "2026-08-14 08:00:00",
          };
        },
        async run() {
          assert.match(sql, /INSERT INTO product_event_aggregates/u);
          stored.push(this.values);
          return { success: true };
        },
      };
    },
  };
  const env = {
    DB: db,
    GRIHAGRID_CACHE: {
      async get() { return null; },
      async put() {},
    },
    APP_ORIGIN: "https://grihagrid.example",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const request = (event, properties = { surface: "project_home", outcome: "success" }) => new Request(
    "https://grihagrid.example/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://grihagrid.example",
        cookie: `__Host-grihagrid_session=session-secret; grihagrid_csrf=${csrf}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ event, properties }),
    },
  );

  for (const event of ["project_home_opened", "project_home_next_action_clicked"]) {
    const response = await worker.fetch(request(event), env, {});
    assert.equal(response.status, 204, event);
  }
  assert.deepEqual(stored.map((values) => values.slice(1, 4)), [
    ["project_home_opened", "project_home", "success"],
    ["project_home_next_action_clicked", "project_home", "success"],
  ]);

  const rejected = await worker.fetch(request("project_home_next_action_clicked", {
    surface: "project_home",
    outcome: "success",
    projectId: "must-not-be-collected",
  }), env, {});
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "invalid_event");
  assert.equal(stored.length, 2);
});
