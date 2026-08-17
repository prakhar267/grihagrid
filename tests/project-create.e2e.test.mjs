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

const scopedKey = "10000000-0000-4000-8000-000000000001";
const concurrentKey = "20000000-0000-4000-8000-000000000002";
const accountCapKey = "30000000-0000-4000-8000-000000000003";

const completeInput = Object.freeze({
  width: 30,
  length: 50,
  city: "Pune",
  facing: "East",
  floors: "G+1",
  bedrooms: 3,
  bathrooms: 3,
  parking: "1 car",
  style: "Warm modern",
  quality: "Signature",
  roadWidthFt: 24,
  plotShape: "regular",
  accessibility: "none",
  futureUse: "none",
  budgetLakh: 55,
});

const accounts = Object.freeze({
  owner: Object.freeze({
    userId: "40000000-0000-4000-8000-000000000001",
    sessionId: "50000000-0000-4000-8000-000000000001",
    sessionToken: "project-create-owner-session-token",
    csrf: "project-create-owner-csrf-token",
  }),
  other: Object.freeze({
    userId: "40000000-0000-4000-8000-000000000002",
    sessionId: "50000000-0000-4000-8000-000000000002",
    sessionToken: "project-create-other-session-token",
    csrf: "project-create-other-csrf-token",
  }),
  capped: Object.freeze({
    userId: "40000000-0000-4000-8000-000000000003",
    sessionId: "50000000-0000-4000-8000-000000000003",
    sessionToken: "project-create-capped-session-token",
    csrf: "project-create-capped-csrf-token",
  }),
});

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

async function startWorker(stateDirectory, assetsDirectory, port) {
  const child = spawn(process.execPath, [wranglerCli,
    "dev", "worker/index.js", "--config", "wrangler.toml", "--local",
    "--persist-to", stateDirectory, "--assets", assetsDirectory,
    "--ip", "127.0.0.1", "--port", String(port),
    "--log-level", "error", "--show-interactive-dev-session=false",
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
  const append = (chunk) => { logs = `${logs}${String(chunk)}`.slice(-80_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const earlyExit = await Promise.race([exited, wait(100).then(() => null)]);
    if (earlyExit) {
      await stopWorker({ child, exited });
      throw new Error(`wrangler dev exited before readiness (${JSON.stringify(earlyExit)}):\n${logs}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) {
        await response.body?.cancel();
        return { child, exited, origin, logs: () => logs };
      }
      await response.body?.cancel();
    } catch {
      // workerd has not bound its local port yet.
    }
  }
  await stopWorker({ child, exited });
  throw new Error(`wrangler dev did not become ready:\n${logs}`);
}

async function stopWorker(server) {
  if (!server?.child) return;
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    const graceful = await Promise.race([server.exited.then(() => true), wait(5_000).then(() => false)]);
    if (!graceful && server.child.exitCode === null) {
      server.child.kill("SIGKILL");
      await Promise.race([server.exited, wait(2_000)]);
    }
  }
  server.child.stdout?.destroy();
  server.child.stderr?.destroy();
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

function requireD1Success(result, context) {
  assert.equal(result.status, 0, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function queryStatements(stateDirectory, statements) {
  const result = requireD1Success(
    d1(stateDirectory, "query", statements.join(";")),
    "D1 evidence query failed",
  );
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.length, statements.length, "D1 evidence statement count drifted");
  return payload.map((entry) => entry.results || []);
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function authenticated(account) {
  return {
    userId: account.userId,
    csrf: account.csrf,
    cookie: `__Host-grihagrid_session=${account.sessionToken}; grihagrid_csrf=${account.csrf}`,
  };
}

function seedSql() {
  const timestamp = "2026-08-17 00:00:00";
  const usersAndSessions = Object.entries(accounts).map(([name, account]) => `
    INSERT INTO users (id,email,name,created_at)
    VALUES (${sqlLiteral(account.userId)},${sqlLiteral(`project-create-${name}@example.test`)},
            ${sqlLiteral(`Project create ${name}`)},${sqlLiteral(timestamp)});
    INSERT INTO sessions
      (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at)
    VALUES (${sqlLiteral(account.sessionId)},${sqlLiteral(account.userId)},
            ${sqlLiteral(sha256Base64Url(account.sessionToken))},${sqlLiteral(sha256Base64Url(account.csrf))},
            '2099-01-01 00:00:00',${sqlLiteral(timestamp)},${sqlLiteral(timestamp)});`).join("\n");
  const inputJson = JSON.stringify(completeInput);
  return `${usersAndSessions}
    WITH RECURSIVE sequence(value) AS (
      SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<49
    )
    INSERT INTO projects
      (id,user_id,name,status,input_json,estimate_json,created_at,updated_at,input_revision)
    SELECT printf('60000000-0000-4000-8000-%012d',value),${sqlLiteral(accounts.capped.userId)},
           printf('Synthetic cap project %02d',value),'feasibility_ready',
           ${sqlLiteral(inputJson)},'{}',${sqlLiteral(timestamp)},${sqlLiteral(timestamp)},1
      FROM sequence;`;
}

async function call(origin, pathname, { method = "GET", body, auth, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!["GET", "HEAD"].includes(method)) requestHeaders.set("origin", origin);
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

function projectBody(name) {
  return { name, input: { ...completeInput } };
}

function createProject(origin, auth, key, name, attributed = false) {
  return call(origin, "/api/projects", {
    method: "POST",
    auth,
    headers: {
      "idempotency-key": key,
      ...(attributed ? { "x-grihagrid-entry-point": "public_estimator" } : {}),
    },
    body: projectBody(name),
  });
}

test("project creation idempotency is tenant-scoped and race-safe on real D1", { timeout: 120_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-project-create-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  let server = null;
  try {
    requireD1Success(d1(stateDirectory, "migrate"), "fresh migrations failed");
    requireD1Success(d1(stateDirectory, "execute", seedSql()), "synthetic auth and 49-project seed failed");
    server = await startWorker(stateDirectory, assetsDirectory, await reservePort());

    const owner = authenticated(accounts.owner);
    const other = authenticated(accounts.other);
    const capped = authenticated(accounts.capped);

    const created = await createProject(server.origin, owner, scopedKey, "Scoped UUID project");
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    const replayed = await createProject(server.origin, owner, scopedKey, "Scoped UUID project");
    assert.equal(replayed.response.status, 200, JSON.stringify(replayed.payload));
    assert.deepEqual(replayed.payload.project, created.payload.project, "an exact retry must replay the persisted project");

    const conflicting = await createProject(server.origin, owner, scopedKey, "Changed request body");
    assert.equal(conflicting.response.status, 409, JSON.stringify(conflicting.payload));
    assert.equal(conflicting.payload.code, "idempotency_conflict");
    assert.equal(Object.hasOwn(conflicting.payload, "project"), false);

    const independentlyScoped = await createProject(server.origin, other, scopedKey, "Scoped UUID project");
    assert.equal(independentlyScoped.response.status, 201, JSON.stringify(independentlyScoped.payload));
    assert.notEqual(independentlyScoped.payload.project.id, created.payload.project.id);

    const concurrent = await Promise.all([
      createProject(server.origin, owner, concurrentKey, "Concurrent unique reconciliation"),
      createProject(server.origin, owner, concurrentKey, "Concurrent unique reconciliation"),
    ]);
    assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [200, 201]);
    assert.deepEqual(concurrent[0].payload.project, concurrent[1].payload.project);

    const accountCapRace = await Promise.all([
      createProject(server.origin, capped, accountCapKey, "Account cap canonical", true),
      createProject(server.origin, capped, accountCapKey, "Account cap canonical", true),
    ]);
    assert.deepEqual(accountCapRace.map(({ response }) => response.status).sort(), [200, 201]);
    assert.deepEqual(accountCapRace[0].payload.project, accountCapRace[1].payload.project);

    await stopWorker(server);
    server = null;

    const [projectRows, ownerCounts, capEvidence, attribution, indexEvidence] = queryStatements(stateDirectory, [
      `SELECT id,user_id,name,creation_key_hash,creation_request_hash
         FROM projects
        WHERE name IN ('Scoped UUID project','Concurrent unique reconciliation','Account cap canonical')
        ORDER BY name,user_id,id`,
      `SELECT user_id,COUNT(*) AS project_count
         FROM projects
        WHERE user_id IN (${sqlLiteral(accounts.owner.userId)},${sqlLiteral(accounts.other.userId)},${sqlLiteral(accounts.capped.userId)})
        GROUP BY user_id ORDER BY user_id`,
      `SELECT COUNT(*) AS total_count,
              SUM(CASE WHEN user_id=${sqlLiteral(accounts.capped.userId)} THEN 1 ELSE 0 END) AS owned_count,
              SUM(CASE WHEN name LIKE 'Synthetic cap project %' THEN 1 ELSE 0 END) AS seed_count,
              SUM(CASE WHEN name='Account cap canonical' THEN 1 ELSE 0 END) AS canonical_count,
              SUM(CASE WHEN name='Account cap canonical' AND user_id=${sqlLiteral(accounts.capped.userId)} THEN 1 ELSE 0 END) AS canonical_owned_count
         FROM projects WHERE user_id=${sqlLiteral(accounts.capped.userId)}`,
      `SELECT COUNT(*) AS row_count,COALESCE(SUM(event_count),0) AS event_count
         FROM product_event_aggregates
        WHERE event_name='public_estimator_brief_started'
          AND surface='public_estimator' AND outcome='success'`,
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_projects_user_creation_key'",
    ]);

    assert.deepEqual(ownerCounts.map((row) => ({ ...row, project_count: Number(row.project_count) })), [
      { user_id: accounts.owner.userId, project_count: 2 },
      { user_id: accounts.other.userId, project_count: 1 },
      { user_id: accounts.capped.userId, project_count: 50 },
    ]);

    assert.equal(projectRows.length, 4, "only four canonical idempotent projects may exist");
    const scopedRows = projectRows.filter((row) => row.name === "Scoped UUID project");
    assert.equal(scopedRows.length, 2);
    assert.deepEqual(scopedRows.map((row) => row.user_id).sort(), [accounts.owner.userId, accounts.other.userId]);
    assert.equal(scopedRows[0].creation_request_hash, scopedRows[1].creation_request_hash, "the matching bodies should share a request hash");
    assert.notEqual(scopedRows[0].creation_key_hash, scopedRows[1].creation_key_hash, "the same raw key must be tenant scoped");
    for (const row of scopedRows) {
      assert.equal(row.creation_key_hash, sha256Base64Url(`project-create:${row.user_id}:${scopedKey}`));
      assert.match(row.creation_request_hash, /^[a-f0-9]{64}$/u);
    }

    const concurrentRows = projectRows.filter((row) => row.name === "Concurrent unique reconciliation");
    assert.equal(concurrentRows.length, 1, "the unique-index loser must reconcile to one row");
    assert.equal(concurrentRows[0].user_id, accounts.owner.userId);
    assert.equal(
      concurrentRows[0].creation_key_hash,
      sha256Base64Url(`project-create:${accounts.owner.userId}:${concurrentKey}`),
    );

    assert.deepEqual({
      total_count: Number(capEvidence[0].total_count),
      owned_count: Number(capEvidence[0].owned_count),
      seed_count: Number(capEvidence[0].seed_count),
      canonical_count: Number(capEvidence[0].canonical_count),
      canonical_owned_count: Number(capEvidence[0].canonical_owned_count),
    }, {
      total_count: 50,
      owned_count: 50,
      seed_count: 49,
      canonical_count: 1,
      canonical_owned_count: 1,
    });
    const capRows = projectRows.filter((row) => row.name === "Account cap canonical");
    assert.equal(capRows.length, 1);
    assert.equal(capRows[0].user_id, accounts.capped.userId);
    assert.equal(
      capRows[0].creation_key_hash,
      sha256Base64Url(`project-create:${accounts.capped.userId}:${accountCapKey}`),
    );

    assert.deepEqual(attribution.map((row) => ({
      row_count: Number(row.row_count),
      event_count: Number(row.event_count),
    })), [{ row_count: 1, event_count: 1 }], "the account-cap replay must not duplicate attribution");
    assert.equal(indexEvidence.length, 1);
    assert.match(indexEvidence[0].sql, /CREATE UNIQUE INDEX idx_projects_user_creation_key[\s\S]*\(user_id, creation_key_hash\)[\s\S]*WHERE creation_key_hash IS NOT NULL/iu);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
