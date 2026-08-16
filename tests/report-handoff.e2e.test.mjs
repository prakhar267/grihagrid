import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function reservePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopWorker(server) {
  if (!server?.child) return;
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    const stopped = await Promise.race([server.exited.then(() => true), wait(5_000).then(() => false)]);
    if (!stopped && server.child.exitCode === null) server.child.kill("SIGKILL");
  }
  server.child.stdout?.destroy();
  server.child.stderr?.destroy();
}

async function startWorker(stateDirectory, assetsDirectory, port) {
  const child = spawn(process.execPath, [wranglerCli,
    "dev", "worker/index.js", "--config", "wrangler.toml", "--local",
    "--persist-to", stateDirectory, "--assets", assetsDirectory,
    "--ip", "127.0.0.1", "--port", String(port), "--test-scheduled",
    "--log-level", "log", "--show-interactive-dev-session=false",
    "--var", "APP_ENV:test", "--var", "APP_ORIGIN:https://app.example.test",
    "--var", "PAID_CHECKOUT_ENABLED:false",
    "--var", "DECISION_COMPARE_FULFILLMENT_ENABLED:false",
    "--var", "ENABLED_PAYMENT_PLANS:", "--var", "GEMINI_API_KEY:",
  ], {
    cwd: root,
    env: { ...process.env, CI: "true", WRANGLER_LOG_SANITIZE: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-50_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-50_000); });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const early = await Promise.race([exited, wait(100).then(() => null)]);
    if (early) throw new Error(`wrangler exited early (${JSON.stringify(early)}):\n${logs}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) {
        await response.body?.cancel();
        return { child, exited, origin, logs: () => logs };
      }
      await response.body?.cancel();
    } catch {
      // workerd is still starting.
    }
  }
  await stopWorker({ child, exited });
  throw new Error(`wrangler did not become ready:\n${logs}`);
}

function d1(stateDirectory, action, sql = null) {
  const args = ["d1"];
  if (action === "migrate") {
    args.push("migrations", "apply", "grihagrid-db", "--local", "--persist-to", stateDirectory);
  } else {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--command", sql);
    if (action === "query") args.push("--json");
  }
  return spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function requireD1(result, context) {
  assert.equal(result.status, 0, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function query(stateDirectory, sql) {
  return JSON.parse(requireD1(d1(stateDirectory, "query", sql), "D1 query failed").stdout)
    .flatMap((entry) => entry.results || []);
}

function extractCookies(response, csrf) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(values.join(";"))?.[1];
  assert.ok(session);
  return `__Host-grihagrid_session=${session}; grihagrid_csrf=${csrf}`;
}

async function call(origin, pathname, {
  method = "GET", body, auth, headers = {}, originHeader = origin,
} = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!['GET', 'HEAD'].includes(method)) requestHeaders.set("origin", originHeader);
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  return { response, payload };
}

async function register(origin, suffix) {
  const result = await call(origin, "/api/auth/register", {
    method: "POST",
    body: {
      name: `Handoff ${suffix}`,
      email: `handoff-${suffix}@example.test`,
      password: "correct horse battery staple",
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return {
    user: result.payload.user,
    csrf: result.payload.csrfToken,
    cookie: extractCookies(result.response, result.payload.csrfToken),
  };
}

async function createReport(origin, auth, suffix) {
  const created = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    headers: { "idempotency-key": `handoff-project-${suffix}` },
    body: {
      name: `PRIVATE_PROJECT_${suffix}_owner@example.test`,
      input: {
        width: 30,
        length: 50,
        city: "Pune",
        facing: "East",
        floors: "G+1",
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
        style: "PRIVATE_STYLE_DO_NOT_SHARE",
        quality: "Signature",
        roadWidthFt: 24,
        plotShape: "regular",
        accessibility: "none",
        futureUse: "none",
        budgetLakh: 50,
      },
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const generated = await call(origin, `/api/projects/${created.payload.project.id}/report`, {
    method: "POST", auth, body: {},
  });
  assert.ok([200, 201].includes(generated.response.status), JSON.stringify(generated.payload));
  return {
    project: created.payload.project,
    revision: generated.payload.revision.revision,
    schemaVersion: generated.payload.revision.report.schemaVersion,
    report: generated.payload.report,
  };
}

const allSections = ["overview", "programme", "cost", "timeline", "risks", "next_actions"];

async function createShare(origin, auth, source, key, overrides = {}, originHeader = origin) {
  return call(origin, `/api/projects/${source.project.id}/report-shares`, {
    method: "POST",
    auth,
    originHeader,
    headers: { "idempotency-key": key },
    body: {
      projectRevision: source.revision,
      reportSchemaVersion: source.schemaVersion,
      expiresInDays: 7,
      sections: allSections,
      ...overrides,
    },
  });
}

function tokenFromShare(share) {
  assert.match(share.url, /^https:\/\/app\.example\.test\/share\/report#[A-Za-z0-9_-]{43}$/u);
  return new URL(share.url).hash.slice(1);
}

function openShare(origin, token, { headers = {} } = {}) {
  return call(origin, "/api/shared/report", {
    method: "POST",
    headers,
    body: { token },
  });
}

function assertPublicRedaction(payload) {
  const forbiddenKeys = new Set([
    "id", "projectid", "userid", "email", "input", "inputhash", "token",
    "tokenhash", "contenthash", "city", "facing", "width", "length", "aibrief",
    "files", "feedback", "orders", "source_report_id", "report_content_hash",
  ]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden public key ${key}`);
      visit(child);
    }
  };
  visit(payload);
  const serialized = JSON.stringify(payload);
  for (const value of ["PRIVATE_PROJECT", "owner@example.test", "PRIVATE_STYLE", "Pune", "East"]) {
    assert.equal(serialized.includes(value), false, value);
  }
}

test("Professional Handoff links preserve one redacted immutable report across owner, race, archive, and cleanup boundaries", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-report-handoff-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  const port = await reservePort();
  let server = null;
  try {
    requireD1(d1(stateDirectory, "migrate"), "fresh migrations failed");
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assert.equal(readiness.payload.checks.reportShareSchema, "current");
    assert.equal(readiness.payload.capabilities.reportHandoff, true);

    const wrongPublicMethod=await call(server.origin,"/api/shared/report");
    assert.equal(wrongPublicMethod.response.status,405);
    assert.equal(wrongPublicMethod.response.headers.get("allow"),"POST");
    const malformedBearer="z".repeat(43);
    for(const body of [{},{token:malformedBearer,extra:true},{token:"short"}]){
      const invalidPublic=await call(server.origin,"/api/shared/report",{method:"POST",body});
      assert.equal(invalidPublic.response.status,404);
      assert.deepEqual(invalidPublic.payload,{error:"shared report not found",code:"report_share_not_found"});
      assert.equal(JSON.stringify(invalidPublic.payload).includes(malformedBearer),false);
    }

    const owner = await register(server.origin, "owner");
    const other = await register(server.origin, "other");
    const source = await createReport(server.origin, owner, "MAIN");

    const foreignList = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: other });
    assert.equal(foreignList.response.status, 404);
    const foreignCreate = await createShare(server.origin, other, source, "foreign-report-share");
    assert.equal(foreignCreate.response.status, 404);

    const missingCsrf = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "idempotency-key": "missing-csrf-share",
      },
      body: { projectRevision: source.revision, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"] },
    });
    assert.equal(missingCsrf.response.status, 403);
    const badOrigin = await createShare(server.origin, owner, source, "bad-origin-share", {}, "https://evil.example");
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.payload.code, "origin_rejected");

    const sameKeyCreates = await Promise.all([
      createShare(server.origin, owner, source, "main-report-share"),
      createShare(server.origin, owner, source, "main-report-share"),
    ]);
    assert.deepEqual(sameKeyCreates.map(result=>result.response.status).sort(), [200, 201]);
    const created = sameKeyCreates.find(result=>result.response.status===201);
    const replayedCreate = sameKeyCreates.find(result=>result.response.status===200);
    assert.ok(created&&replayedCreate);
    assert.equal(Object.hasOwn(created.payload.share,"url"),true);
    assert.equal(Object.hasOwn(replayedCreate.payload.share,"url"),false);
    assert.equal(created.payload.share.id,replayedCreate.payload.share.id);
    const mainShare = created.payload.share;
    const mainToken = tokenFromShare(mainShare);
    assert.deepEqual(mainShare.sections, allSections);
    assert.equal(Object.hasOwn(mainShare, "token"), false);
    const storedShare = query(stateDirectory, `SELECT token_hash,idempotency_key_hash,request_hash,report_content_hash FROM report_shares WHERE id='${mainShare.id}';`)[0];
    for (const value of [storedShare.token_hash, storedShare.request_hash, storedShare.report_content_hash]) {
      assert.match(value, /^[a-f0-9]{64}$/u);
    }
    assert.match(storedShare.idempotency_key_hash, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(JSON.stringify(storedShare).includes(mainToken), false);
    assert.equal(JSON.stringify(storedShare).includes("main-report-share"), false);

    const replay = await createShare(server.origin, owner, source, "main-report-share");
    assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
    assert.equal(replay.payload.share.id, mainShare.id);
    assert.equal(Object.hasOwn(replay.payload.share, "url"), false);
    const conflict = await createShare(server.origin, owner, source, "main-report-share", { sections: ["overview"] });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.payload.code, "idempotency_conflict");

    const listed = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: owner });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.shares.length, 1);
    assert.equal(Object.hasOwn(listed.payload.shares[0], "url"), false);
    assert.equal(JSON.stringify(listed.payload).includes(mainToken), false);

    const opened = await openShare(server.origin, mainToken);
    assert.equal(opened.response.status, 200, JSON.stringify(opened.payload));
    assert.equal(opened.response.headers.get("cache-control"), "no-store");
    assert.equal(opened.response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(opened.payload.share.report.schemaVersion, 2);
    assert.equal(opened.payload.share.report.generatedAt, source.report.generatedAt);
    assert.deepEqual(Object.keys(opened.payload.share.report.sections), [
      "overview", "programme", "cost", "timeline", "risks", "nextActions",
    ]);
    assertPublicRedaction(opened.payload);
    const afterOpen = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: owner });
    assert.equal(afterOpen.payload.shares[0].accessCount, 1);
    assert.ok(afterOpen.payload.shares[0].lastAccessedAt);

    const admissionIp="198.51.100.77";
    const accessCountBeforeAdmissionRace=Number(query(stateDirectory, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`)[0].access_count);
    const admissionRace=await Promise.all(Array.from({length:121},()=>openShare(server.origin,mainToken,{
      headers:{"cf-connecting-ip":admissionIp},
    })));
    const admissionStatuses=admissionRace.map(result=>result.response.status);
    assert.equal(admissionStatuses.filter(status=>status===200).length,120);
    assert.equal(admissionStatuses.filter(status=>status===429).length,1);
    const counterRows=query(stateDirectory,"SELECT subject_hash,request_count,limit_count FROM report_share_read_counters;");
    const admissionSubjectHash=createHash("sha256").update(`report-share-read:${admissionIp}`).digest("hex");
    const admissionCounter=counterRows.find(row=>row.subject_hash===admissionSubjectHash);
    assert.deepEqual(admissionCounter,{subject_hash:admissionSubjectHash,request_count:120,limit_count:120});
    assert.equal(JSON.stringify(counterRows).includes(admissionIp),false);
    assert.equal(JSON.stringify(counterRows).includes(mainToken),false);
    const accessCountAfterAdmissionRace=Number(query(stateDirectory, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`)[0].access_count);
    assert.equal(accessCountAfterAdmissionRace-accessCountBeforeAdmissionRace,120);

    const revised = await call(server.origin, `/api/projects/${source.project.id}/revisions`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "handoff-revision-two" },
      body: { expectedInputRevision: source.revision, input: { budgetLakh: 55 }, acceptedImpact: true },
    });
    assert.equal(revised.response.status, 201, JSON.stringify(revised.payload));
    const oldStillOpen = await openShare(server.origin, mainToken);
    assert.equal(oldStillOpen.response.status, 200, JSON.stringify(oldStillOpen.payload));
    assert.deepEqual(oldStillOpen.payload.share.report.sections, opened.payload.share.report.sections);

    const historical = await createShare(server.origin, owner, source, "historical-report-share", { sections: ["overview", "risks"] });
    assert.equal(historical.response.status, 201, JSON.stringify(historical.payload));
    const historicalToken = tokenFromShare(historical.payload.share);

    const archived = await call(server.origin, `/api/projects/${source.project.id}`, {
      method: "PATCH", auth: owner, body: { status: "archived" },
    });
    assert.equal(archived.response.status, 200, JSON.stringify(archived.payload));
    assert.equal((await openShare(server.origin, mainToken)).response.status, 200);
    const blockedArchived = await createShare(server.origin, owner, source, "archived-report-share", { sections: ["overview"] });
    assert.equal(blockedArchived.response.status, 409);
    assert.equal(blockedArchived.payload.code, "project_archived");
    const restored = await call(server.origin, `/api/projects/${source.project.id}`, {
      method: "PATCH", auth: owner, body: { status: "feasibility_ready" },
    });
    assert.equal(restored.response.status, 200);

    for (let index = 3; index <= 4; index += 1) {
      const extra = await createShare(server.origin, owner, source, `report-share-${index}`, { sections: ["overview"] });
      assert.equal(extra.response.status, 201, JSON.stringify(extra.payload));
    }
    assert.equal(Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM report_shares WHERE project_id='${source.project.id}' AND revoked_at IS NULL AND expires_at>datetime('now');`)[0].count), 4);
    const capRace = await Promise.all([
      createShare(server.origin, owner, source, "report-share-five-a", { sections: ["overview"] }),
      createShare(server.origin, owner, source, "report-share-five-b", { sections: ["overview"] }),
    ]);
    assert.deepEqual(capRace.map(result=>result.response.status).sort(), [201, 409]);
    assert.equal(capRace.find(result=>result.response.status===409)?.payload.code, "report_share_limit");
    assert.equal(Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM report_shares WHERE project_id='${source.project.id}' AND revoked_at IS NULL AND expires_at>datetime('now');`)[0].count), 5);

    requireD1(d1(stateDirectory, "execute", `
      WITH RECURSIVE history(index_value) AS (
        SELECT 1
        UNION ALL
        SELECT index_value+1 FROM history WHERE index_value<50
      )
      INSERT INTO report_shares (
        id,project_id,user_id,project_revision,report_schema_version,sections_json,
        report_content_hash,token_hash,idempotency_key_hash,request_hash,expires_at,
        revoked_at,access_count,last_accessed_at,created_at
      )
      SELECT
        'closed-history-' || printf('%03d',index_value),
        '${source.project.id}','${owner.user.id}',${source.revision},2,'["overview"]',
        '${storedShare.report_content_hash}',printf('%064x',1000+index_value),
        printf('%043d',1000+index_value),printf('%064x',2000+index_value),
        datetime(datetime('now','+' || index_value || ' minutes'),'+1 day'),
        datetime('now','+' || index_value || ' minutes'),0,NULL,
        datetime('now','+' || index_value || ' minutes')
      FROM history;
    `), "closed history fixture insert failed");
    const activeIds=query(stateDirectory, `SELECT id FROM report_shares WHERE project_id='${source.project.id}' AND revoked_at IS NULL AND expires_at>datetime('now') ORDER BY id;`).map(row=>row.id);
    assert.equal(activeIds.length,5);
    const boundedHistory=await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: owner });
    assert.equal(boundedHistory.response.status,200);
    assert.equal(boundedHistory.payload.shares.length,50);
    assert.deepEqual(boundedHistory.payload.shares.slice(0,5).map(share=>share.id).sort(),activeIds);
    assert.ok(boundedHistory.payload.shares.slice(0,5).every(share=>share.active===true));
    assert.ok(boundedHistory.payload.shares.slice(5).every(share=>share.active===false));

    const foreignRevoke = await call(server.origin, `/api/projects/${source.project.id}/report-shares/${mainShare.id}`, {
      method: "DELETE", auth: other,
    });
    assert.equal(foreignRevoke.response.status, 404);
    const [racedOpen,revoked] = await Promise.all([
      openShare(server.origin, mainToken),
      call(server.origin, `/api/projects/${source.project.id}/report-shares/${mainShare.id}`, {
        method: "DELETE", auth: owner,
      }),
    ]);
    assert.ok([200,410].includes(racedOpen.response.status));
    assert.equal(revoked.response.status, 204);
    assert.equal((await call(server.origin, `/api/projects/${source.project.id}/report-shares/${mainShare.id}`, {
      method: "DELETE", auth: owner,
    })).response.status, 204);
    const closed = await openShare(server.origin, mainToken);
    assert.equal(closed.response.status, 410);
    assert.equal(closed.payload.code, "report_share_unavailable");
    const closedAccessCount=Number(query(stateDirectory, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`)[0].access_count);
    const afterClosure=await Promise.all(Array.from({length:8},()=>openShare(server.origin,mainToken)));
    assert.ok(afterClosure.every(result=>result.response.status===410));
    assert.equal(Number(query(stateDirectory, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`)[0].access_count),closedAccessCount);

    const expiredToken = "e".repeat(43);
    const expiredTokenHash = createHash("sha256").update(expiredToken).digest("hex");
    requireD1(d1(stateDirectory, "execute", `
      INSERT INTO report_shares (
        id,project_id,user_id,project_revision,report_schema_version,sections_json,
        report_content_hash,token_hash,idempotency_key_hash,request_hash,expires_at,created_at
      ) VALUES (
        'expiry-recent','${source.project.id}','${owner.user.id}',${source.revision},2,'["overview"]',
        '${"1".repeat(64)}','${expiredTokenHash}','${"2".repeat(43)}','${"3".repeat(64)}',
        datetime('now','-1 day'),datetime('now','-8 days')
      );
    `), "expiry fixture insert failed");
    const expired = await openShare(server.origin, expiredToken);
    assert.equal(expired.response.status, 410);
    assert.equal(expired.payload.code, "report_share_expired");

    const retentionToken = "r".repeat(43);
    const retentionTokenHash = createHash("sha256").update(retentionToken).digest("hex");
    requireD1(d1(stateDirectory, "execute", `
      INSERT INTO report_shares (
        id,project_id,user_id,project_revision,report_schema_version,sections_json,
        report_content_hash,token_hash,idempotency_key_hash,request_hash,expires_at,created_at
      ) VALUES (
        'retention-old','${source.project.id}','${owner.user.id}',${source.revision},2,'["overview"]',
        '${"a".repeat(64)}','${retentionTokenHash}','${"c".repeat(43)}','${"d".repeat(64)}',
        datetime('now','-91 days'),datetime('now','-121 days')
      );
      INSERT INTO report_share_read_counters
        (subject_hash,window_start,request_count,limit_count,updated_at)
      VALUES (
        '${"9".repeat(64)}',datetime('now','-73 hours'),1,120,datetime('now','-73 hours')
      );
    `), "retention fixture insert failed");
    const scheduled = await fetch(`${server.origin}/__scheduled?cron=17+2+*+*+*`);
    assert.equal(scheduled.status, 200);
    const deadline = Date.now() + 10_000;
    let retentionStatus = 410;
    while (Date.now() < deadline && retentionStatus !== 404) {
      retentionStatus = (await openShare(server.origin, retentionToken)).response.status;
      if (retentionStatus === 404) break;
      assert.equal(retentionStatus, 410);
      await wait(100);
    }
    assert.equal(retentionStatus, 404, "scheduled cleanup did not remove the over-90-day report share");
    assert.equal(Number(query(stateDirectory, "SELECT COUNT(*) AS count FROM report_shares WHERE id='retention-old';")[0].count), 0);
    assert.equal(Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM report_share_read_counters WHERE subject_hash='${"9".repeat(64)}';`)[0].count), 0);
    assert.ok(Number(query(stateDirectory, "SELECT COUNT(*) AS count FROM report_share_read_counters;")[0].count)>0);
    let historicalAfterCleanup;
    try {
      historicalAfterCleanup = await openShare(server.origin, historicalToken);
    } catch (error) {
      assert.fail(`Worker connection failed after scheduled cleanup: ${error?.message || error}\n${server.logs()}`);
    }
    assert.equal(historicalAfterCleanup.response.status, 200);

    const directRetarget = d1(stateDirectory, "execute", `UPDATE report_shares SET project_revision=project_revision+1 WHERE id='${historical.payload.share.id}';`);
    assert.notEqual(directRetarget.status, 0);
    assert.match(`${directRetarget.stdout}\n${directRetarget.stderr}`, /immutable/iu);

    const deleted = await call(server.origin, `/api/projects/${source.project.id}`, { method: "DELETE", auth: owner });
    assert.equal(deleted.response.status, 204, JSON.stringify(deleted.payload));
    assert.equal(Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM report_shares WHERE project_id='${source.project.id}';`)[0].count), 0);
    assert.equal((await openShare(server.origin, historicalToken)).response.status, 404);

    const applicationLogs = server.logs()
      .split(/\r?\n/u)
      .filter((line) => line.includes('"type":"request_complete"'))
      .join("\n");
    assert.match(applicationLogs, /"route":"\/api\/shared\/report"/u);
    assert.equal(applicationLogs.includes(mainToken), false);
    assert.equal(applicationLogs.includes(historicalToken), false);
    assert.equal(applicationLogs.includes(malformedBearer), false);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
