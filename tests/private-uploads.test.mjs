import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { __test } from "../worker/index.js";
import worker from "../worker/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const ORIGIN = "https://app.example.test";
const PASSWORD = "correct horse battery staple";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

class MemoryKv {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value) { this.values.set(key, String(value)); }
}

class MemoryR2 {
  constructor() { this.values = new Map(); }
  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(await new Response(value).arrayBuffer());
    this.values.set(key, { bytes, options, uploaded: new Date() });
  }
  async get(key) {
    const item = this.values.get(key);
    if (!item) return null;
    return { body: item.bytes.slice(), httpEtag: `\"${item.bytes.byteLength}\"` };
  }
  async delete(key) { for (const item of Array.isArray(key) ? key : [key]) this.values.delete(item); }
  async list({ prefix, cursor, limit }) {
    const keys = [...this.values.keys()].filter(key => key.startsWith(prefix) && (!cursor || key > cursor)).sort();
    const selected = keys.slice(0, limit);
    return { objects: selected.map(key => ({ key, uploaded: this.values.get(key).uploaded })), truncated: keys.length > limit, cursor: selected.at(-1) };
  }
}

function migrationStatements(source) {
  const statements = [];
  let lines = [];
  let trigger = false;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--") || /^PRAGMA\s+/iu.test(line)) continue;
    if (!lines.length) trigger = /^CREATE\s+TRIGGER\b/iu.test(line);
    lines.push(rawLine);
    const complete = trigger ? /\bEND;\s*$/iu.test(line) : /;\s*$/u.test(line);
    if (!complete) continue;
    statements.push(lines.join("\n").trim());
    lines = [];
    trigger = false;
  }
  assert.equal(lines.length, 0);
  return statements;
}

async function database(context) {
  const miniflare = new Miniflare({
    workers: [{ config: {
      name: "private-upload-worker", type: "worker", compatibilityDate: "2026-08-01",
      manifest: { mainModule: "index.mjs", modulesRoot: process.cwd(), modules: { "index.mjs": { type: "esm", contents: "export default {}" } } },
      env: { DB: { type: "d1", name: "private-upload-db" } },
    } }],
  });
  context.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database("DB");
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const source = await readFile(path.join(migrationsDirectory, name), "utf8");
    for (const statement of migrationStatements(source)) await db.prepare(statement).run();
  }
  return db;
}

function authFrom(result) {
  const cookies = typeof result.response.headers.getSetCookie === "function"
    ? result.response.headers.getSetCookie() : [result.response.headers.get("set-cookie") || ""];
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(cookies.join(";"))?.[1];
  assert.ok(session);
  return { csrf: result.payload.csrfToken, cookie: `__Host-grihagrid_session=${session}; grihagrid_csrf=${result.payload.csrfToken}` };
}

async function callJson(env, pathname, { method = "GET", body, auth, idempotencyKey } = {}) {
  const headers = new Headers({ "cf-connecting-ip": "203.0.113.80" });
  if (!["GET", "HEAD"].includes(method)) headers.set("origin", ORIGIN);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (auth) { headers.set("cookie", auth.cookie); headers.set("x-csrf-token", auth.csrf); }
  const response = await worker.fetch(new Request(`${ORIGIN}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

async function register(env, email) {
  const result = await callJson(env, "/api/auth/register", { method: "POST", body: { email, password: PASSWORD } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return authFrom(result);
}

const projectInput = {
  width: 30, length: 50, city: "Pune", facing: "East", floors: "G+1", bedrooms: 3,
  bathrooms: 3, parking: true, style: "Warm modern", quality: "Signature", roadWidthFt: 24,
  plotShape: "regular", accessibility: "none", futureUse: "none", budgetLakh: 50,
};

function be32(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function join(...parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function pngChunk(type, data = new Uint8Array()) {
  return join(be32(data.byteLength), ascii(type), data, new Uint8Array(4));
}

function png({ width = 1, height = 1, extra = [] } = {}) {
  const ihdr = join(be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0]));
  return join(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IDAT", new Uint8Array([0x78, 0x01, 0x00])),
    pngChunk("IEND"),
  );
}

function jpegWithExif() {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x01, 0x02, 0xff, 0xd9,
  ]);
}

function webpLosslessWithExif() {
  const vp8l = join(ascii("VP8L"), new Uint8Array([5, 0, 0, 0]), new Uint8Array([0x2f, 0, 0, 0, 0]), new Uint8Array([0]));
  const exif = join(ascii("EXIF"), new Uint8Array([4, 0, 0, 0]), ascii("GPS!"));
  const body = join(vp8l, exif);
  const result = join(ascii("RIFF"), new Uint8Array(4), ascii("WEBP"), body);
  new DataView(result.buffer).setUint32(4, result.byteLength - 8, true);
  return result;
}

test("the private-image boundary strips PNG text metadata and preserves a bounded static image", () => {
  const source = png({ extra: [pngChunk("tEXt", ascii("location\0private-site"))] });
  const sanitized = __test.sanitizeStaticImage(source, "image/png");
  assert.ok(sanitized.byteLength < source.byteLength);
  assert.equal(new TextDecoder().decode(sanitized).includes("private-site"), false);
  assert.equal(new TextDecoder().decode(sanitized).includes("IDAT"), true);
});

test("the private-image boundary strips JPEG EXIF and WebP EXIF chunks", () => {
  const jpeg = __test.sanitizeStaticImage(jpegWithExif(), "image/jpeg");
  assert.equal(new TextDecoder().decode(jpeg).includes("Exif"), false);
  assert.deepEqual([...jpeg.slice(-2)], [0xff, 0xd9]);

  const webp = __test.sanitizeStaticImage(webpLosslessWithExif(), "image/webp");
  assert.equal(new TextDecoder().decode(webp).includes("EXIF"), false);
  assert.equal(new DataView(webp.buffer).getUint32(4, true) + 8, webp.byteLength);
});

test("the private-image boundary rejects pixel bombs, unknown critical PNG chunks, and trailing polyglot bytes", () => {
  for (const source of [
    png({ width: 10_000, height: 10_000 }),
    png({ extra: [pngChunk("ABCD", new Uint8Array([1]))] }),
    join(png(), ascii("<script>polyglot</script>")),
  ]) {
    assert.throws(
      () => __test.sanitizeStaticImage(source, "image/png"),
      (error) => error?.code === "invalid_file_content" && error?.status === 400,
    );
  }
});

test("private R2 images round-trip only through owner-scoped normalized metadata", { timeout: 60_000 }, async (context) => {
  const DB = await database(context);
  const FILES = new MemoryR2();
  const env = {
    APP_ENV: "test", APP_ORIGIN: ORIGIN, ASSETS: assets, DB, FILES,
    GRIHAGRID_CACHE: new MemoryKv(), PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false", ENABLED_PAYMENT_PLANS: "",
  };
  const owner = await register(env, "private-image-owner@example.test");
  const other = await register(env, "private-image-other@example.test");
  const project = await callJson(env, "/api/projects", {
    method: "POST", auth: owner, idempotencyKey: "private-image-project-0001",
    body: { name: "Private image project", input: projectInput },
  });
  assert.equal(project.response.status, 201, JSON.stringify(project.payload));
  const projectId = project.payload.project.id;
  const source = png({ extra: [pngChunk("tEXt", ascii("gps\0private-location"))] });
  const headers = new Headers({
    origin: ORIGIN,
    cookie: owner.cookie,
    "x-csrf-token": owner.csrf,
    "content-type": "image/png",
    "x-file-name": encodeURIComponent("plot location.png"),
    "x-file-kind": "reference",
    "cf-connecting-ip": "203.0.113.81",
  });
  const uploadedResponse = await worker.fetch(new Request(`${ORIGIN}/api/projects/${projectId}/files`, {
    method: "POST", headers, body: source,
  }), env);
  const uploaded = await uploadedResponse.json();
  assert.equal(uploadedResponse.status, 201, JSON.stringify(uploaded));
  assert.equal(uploaded.file.sanitizationProfile, "static-image-v1");
  assert.ok(uploaded.file.sizeBytes < source.byteLength);
  assert.equal(FILES.values.size, 1);
  const stored = [...FILES.values.values()][0].bytes;
  assert.equal(new TextDecoder().decode(stored).includes("private-location"), false);

  const listed = await callJson(env, `/api/projects/${projectId}/files`, { auth: owner });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.payload.files.map((item) => item.id), [uploaded.file.id]);
  assert.equal(JSON.stringify(listed.payload).includes("object_key"), false);
  assert.equal((await callJson(env, `/api/projects/${projectId}/files`, { auth: other })).response.status, 404);

  const downloadHeaders = new Headers({ cookie: owner.cookie, "cf-connecting-ip": "203.0.113.82" });
  const downloaded = await worker.fetch(new Request(
    `${ORIGIN}/api/projects/${projectId}/files/${uploaded.file.id}`,
    { headers: downloadHeaders },
  ), env);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get("content-disposition"), /^attachment;/u);
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), stored);

  const deleted = await worker.fetch(new Request(`${ORIGIN}/api/projects/${projectId}/files/${uploaded.file.id}`, {
    method: "DELETE",
    headers: { origin: ORIGIN, cookie: owner.cookie, "x-csrf-token": owner.csrf, "cf-connecting-ip": "203.0.113.83" },
  }), env);
  assert.equal(deleted.status, 204);
  assert.equal(FILES.values.size, 0);
  assert.equal((await callJson(env, `/api/projects/${projectId}/files`, { auth: owner })).payload.files.length, 0);
});

async function cleanupFixture(context) {
  const DB = await database(context);
  const FILES = new MemoryR2();
  const env = { APP_ENV: "test", APP_ORIGIN: ORIGIN, ASSETS: assets, DB, FILES, GRIHAGRID_CACHE: new MemoryKv() };
  const owner = await register(env, "cleanup-owner@example.test");
  const created = await callJson(env, "/api/projects", {
    method: "POST", auth: owner, body: { name: "Cleanup study", input: projectInput },
  });
  const projectId = created.payload.project.id;
  const userId = (await DB.prepare("SELECT id FROM users").first()).id;
  const upload = () => worker.fetch(new Request(`${ORIGIN}/api/projects/${projectId}/files`, {
    method: "POST", body: png(), headers: { origin: ORIGIN, cookie: owner.cookie, "x-csrf-token": owner.csrf,
      "content-type": "image/png", "x-file-name": "plan.png", "x-file-kind": "reference", "cf-connecting-ip": "203.0.113.81" },
  }), env);
  return { DB, FILES, env, owner, projectId, userId, upload };
}

test("file deletion hides bytes immediately and retries a failed R2 removal", { timeout: 60_000 }, async context => {
  const { DB, FILES, env, owner, projectId, upload } = await cleanupFixture(context);
  const created = await upload();
  assert.equal(created.status, 201);
  const { file } = await created.json();
  const originalDelete = FILES.delete.bind(FILES);
  FILES.delete = async () => { throw new Error("synthetic R2 outage"); };
  const removed = await callJson(env, `/api/projects/${projectId}/files/${file.id}`, { method: "DELETE", auth: owner });
  assert.equal(removed.response.status, 202);
  assert.equal(removed.payload.privateFileCleanup, "pending");
  assert.equal(FILES.values.size, 1);
  assert.equal((await callJson(env, `/api/projects/${projectId}/files`, { auth: owner })).payload.files.length, 0);
  assert.equal((await callJson(env, `/api/projects/${projectId}/files/${file.id}`, { auth: owner })).response.status, 404);
  FILES.delete = originalDelete;
  await DB.prepare("UPDATE private_file_cleanup SET next_attempt_at=datetime('now','-1 second')").run();
  assert.deepEqual(await __test.processPrivateFileCleanup(env), { processed: 1, failed: 0 });
  assert.equal(FILES.values.size, 0);
});

test("a rejected upload keeps a durable cleanup pointer during storage failure", { timeout: 60_000 }, async context => {
  const { DB, FILES, env, upload } = await cleanupFixture(context);
  await DB.prepare(`CREATE TRIGGER synthetic_publication_abort BEFORE INSERT ON project_files
    BEGIN SELECT RAISE(ABORT, 'synthetic metadata failure'); END`).run();
  const originalDelete = FILES.delete.bind(FILES);
  FILES.delete = async () => { throw new Error("synthetic R2 outage"); };
  assert.equal((await upload()).status, 500);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM project_files").first()).n, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM private_file_cleanup WHERE state='delete'").first()).n, 1);
  assert.equal(FILES.values.size, 1);
  FILES.delete = originalDelete;
  await DB.prepare("UPDATE private_file_cleanup SET next_attempt_at=datetime('now','-1 second')").run();
  await __test.processPrivateFileCleanup(env);
  assert.equal(FILES.values.size, 0);
});

test("file transaction rollback preserves bytes and inventory failure does not block queued cleanup", { timeout: 60_000 }, async context => {
  const { DB, FILES, env, owner, projectId, upload } = await cleanupFixture(context);
  const created = await upload();
  assert.equal(created.status, 201);
  const { file } = await created.json();
  await DB.prepare(`CREATE TRIGGER synthetic_file_remove_abort BEFORE DELETE ON project_files
    BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END`).run();
  const removed = await callJson(env, `/api/projects/${projectId}/files/${file.id}`, { method: "DELETE", auth: owner });
  assert.equal(removed.response.status, 500);
  assert.equal(FILES.values.size, 1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM project_files").first()).n, 1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM private_file_cleanup").first()).n, 0);
  await DB.prepare("DROP TRIGGER synthetic_file_remove_abort").run();
  await DB.prepare("DELETE FROM project_files WHERE id=?").bind(file.id).run();
  await DB.prepare("INSERT INTO private_file_maintenance(id,inventory_cursor,updated_at) VALUES(1,'expired-provider-cursor',datetime('now'))").run();
  FILES.list = async () => { throw new Error("synthetic inventory outage"); };
  const jobs = [];
  await worker.scheduled({}, env, { waitUntil: job => jobs.push(job) });
  const results = await Promise.allSettled(jobs);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal(FILES.values.size, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM private_file_cleanup").first()).n, 0);
  assert.equal((await DB.prepare("SELECT inventory_cursor FROM private_file_maintenance WHERE id=1").first()).inventory_cursor, null);
});

for (const winner of ["logout", "account-deletion", "expired-upload"]) {
  test(`an upload cannot publish after ${winner} wins during its R2 write`, { timeout: 60_000 }, async context => {
    const { DB, FILES, env, owner, upload } = await cleanupFixture(context);
    const originalPut = FILES.put.bind(FILES);
    FILES.put = async (...args) => {
      await originalPut(...args);
      if (winner === "logout") await DB.prepare("DELETE FROM sessions").run();
      if (winner === "expired-upload") await DB.prepare("UPDATE private_file_cleanup SET created_at=datetime('now','-2 hours')").run();
      if (winner === "account-deletion") {
        const removed = await callJson(env, "/api/account", { method: "DELETE", auth: owner, body: { currentPassword: PASSWORD, confirmation: "DELETE" } });
        assert.equal(removed.response.status, 202);
        assert.equal((await DB.prepare("SELECT private_files_count FROM account_deletion_receipts").first()).private_files_count, 1);
      }
    };
    const result = await upload();
    assert.equal(result.status, 409, await result.text());
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM project_files").first()).n, 0);
    assert.equal(FILES.values.size, 0);
    if (winner === "account-deletion") assert.ok((await DB.prepare("SELECT private_files_completed_at FROM account_deletion_receipts").first()).private_files_completed_at);
  });
}

test("inventory cleanup preserves referenced and recent files and resumes bounded pages", { timeout: 60_000 }, async context => {
  const { DB, FILES, env, userId, projectId, upload } = await cleanupFixture(context);
  assert.equal((await upload()).status, 201);
  const referenced = [...FILES.values.keys()][0];
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  FILES.values.get(referenced).uploaded = old;
  const recent = `users/${userId}/projects/${projectId}/${crypto.randomUUID()}`;
  await FILES.put(recent, png());
  await FILES.put("users/noncanonical/keep-this", png());
  FILES.values.get("users/noncanonical/keep-this").uploaded = old;
  for (let index = 0; index < 105; index += 1) {
    const key = `users/${userId}/projects/${projectId}/${crypto.randomUUID()}`;
    await FILES.put(key, png());
    FILES.values.get(key).uploaded = old;
  }
  let statements = 0;
  env.DB = { prepare(sql) { statements += 1; return DB.prepare(sql); }, batch: items => DB.batch(items) };
  await __test.reconcilePrivateFileInventory(env);
  assert.ok((await DB.prepare("SELECT inventory_cursor FROM private_file_maintenance").first()).inventory_cursor);
  assert.ok((await DB.prepare("SELECT COUNT(*) AS n FROM private_file_cleanup").first()).n <= 100);
  await __test.processPrivateFileCleanup(env);
  assert.ok(statements <= 7, `A full inventory/cleanup page must stay below the free D1 limit: ${statements}`);
  await __test.reconcilePrivateFileInventory(env);
  assert.equal((await DB.prepare("SELECT inventory_cursor FROM private_file_maintenance").first()).inventory_cursor, null);
  await __test.processPrivateFileCleanup(env);
  assert.deepEqual([...FILES.values.keys()].sort(), [referenced, recent, "users/noncanonical/keep-this"].sort());
  // Restore safety: a metadata reference protects an object even if its old
  // cleanup pointer was restored alongside it.
  await DB.prepare(`INSERT INTO private_file_cleanup(object_key,state,created_at,next_attempt_at)
    VALUES(?,'delete',datetime('now'),datetime('now'))`).bind(referenced).run();
  await __test.processPrivateFileCleanup(env);
  assert.equal(FILES.values.has(referenced), true);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM private_file_cleanup").first()).n, 0);
});
