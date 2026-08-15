import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError } from "../src/api.js";
import {
  LOGOUT_FAILURE_MESSAGE,
  LOGOUT_CHANNEL_NAME,
  LOGOUT_SYNC_KEY,
  broadcastLogout,
  clearPrivateSessionStorage,
  confirmLogout,
  isLogoutBroadcast,
  isLogoutChannelMessage,
} from "../src/logout.js";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("confirmed logout posts once with the expected request contract", async () => {
  const calls = [];
  const result = await confirmLogout(async (...args) => {
    calls.push(args);
    return { status: 204, payload: null };
  });
  assert.deepEqual(result, { confirmedBy: "logout" });
  assert.deepEqual(calls, [["/api/auth/logout", { method: "POST", body: {} }]]);
});

test("a legacy logout 401 is confirmed only after session reconciliation", async () => {
  const calls = [];
  const result = await confirmLogout(async (path) => {
    calls.push(path);
    throw new ApiError("authentication required", 401, { code: "unauthenticated" });
  });
  assert.deepEqual(result, { confirmedBy: "reconciliation" });
  assert.deepEqual(calls, ["/api/auth/logout", "/api/auth/me"]);
});

test("a lost logout response completes only when session reconciliation proves 401", async () => {
  const calls = [];
  const result = await confirmLogout(async (path) => {
    calls.push(path);
    if (path === "/api/auth/logout") throw new TypeError("network response was lost");
    throw new ApiError("authentication required", 401, { code: "unauthenticated" });
  });
  assert.deepEqual(result, { confirmedBy: "reconciliation" });
  assert.deepEqual(calls, ["/api/auth/logout", "/api/auth/me"]);
});

test("a fulfilled non-204 logout response is not accepted as revocation", async () => {
  await assert.rejects(
    () => confirmLogout(async (path) => path === "/api/auth/logout"
      ? { status: 200, payload: { ok: true } }
      : { status: 200, payload: { user: { id: "still-active" } } }),
    (error) => error instanceof ApiError && error.status === 200,
  );
});

test("an unrelated edge 401 is not proof that the application session is absent", async () => {
  const edgeError = new ApiError("edge authentication required", 401, { code: "edge_denied" });
  await assert.rejects(
    () => confirmLogout(async (path) => {
      if (path === "/api/auth/logout") throw edgeError;
      return { status: 200, payload: { user: { id: "still-active" } } };
    }),
    (error) => error === edgeError,
  );
});

test("logout failure remains a failure when reconciliation finds a live session", async () => {
  for (const status of [403, 408, 500, 503]) {
    const original = new ApiError(`logout failed ${status}`, status, null);
    const calls = [];
    await assert.rejects(
      () => confirmLogout(async (path) => {
        calls.push(path);
        if (path === "/api/auth/logout") throw original;
        return { user: { id: "still-active" } };
      }),
      (error) => error === original,
    );
    assert.deepEqual(calls, ["/api/auth/logout", "/api/auth/me"]);
  }
});

test("unknown session state never becomes a claimed logout success", async () => {
  const original = new TypeError("offline");
  await assert.rejects(
    () => confirmLogout(async (path) => {
      if (path === "/api/auth/logout") throw original;
      throw new ApiError("database unavailable", 503, null);
    }),
    (error) => error === original,
  );
  assert.match(LOGOUT_FAILURE_MESSAGE, /couldn’t confirm/u);
  assert.match(LOGOUT_FAILURE_MESSAGE, /session as active/u);
  assert.match(LOGOUT_FAILURE_MESSAGE, /workspace stays open/u);
});

test("local logout cleanup removes only this tab's GrihaGrid session state", () => {
  const storage = new MemoryStorage([
    ["grihagrid.checkout.project.plan", "private"],
    ["grihagrid.decisionDraft.project", "private"],
    ["grihagrid.estimator", "private"],
    ["unrelated.application", "keep"],
  ]);
  clearPrivateSessionStorage(storage);
  assert.equal(storage.getItem("grihagrid.checkout.project.plan"), null);
  assert.equal(storage.getItem("grihagrid.decisionDraft.project"), null);
  assert.equal(storage.getItem("grihagrid.estimator"), null);
  assert.equal(storage.getItem("unrelated.application"), "keep");
});

test("blocked browser storage never turns confirmed logout cleanup into an exception", () => {
  const blocked = {
    get length() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  assert.doesNotThrow(() => clearPrivateSessionStorage(blocked));
  assert.doesNotThrow(() => broadcastLogout(blocked, "blocked-storage-marker", class {
    constructor() { throw new DOMException("blocked", "SecurityError"); }
  }));
});

test("logout broadcast is non-sensitive and recognized only for the exact key", () => {
  const storage = new MemoryStorage();
  const messages = [];
  class TestChannel {
    constructor(name) { assert.equal(name, LOGOUT_CHANNEL_NAME); }
    postMessage(message) { messages.push(message); }
    close() {}
  }
  assert.equal(broadcastLogout(storage, "test-marker", TestChannel), "test-marker");
  assert.equal(storage.getItem(LOGOUT_SYNC_KEY), "test-marker");
  assert.deepEqual(messages, [{ type: "logout", marker: "test-marker" }]);
  assert.equal(isLogoutBroadcast({ key: LOGOUT_SYNC_KEY, newValue: "test-marker" }), true);
  assert.equal(isLogoutBroadcast({ key: LOGOUT_SYNC_KEY, newValue: null }), false);
  assert.equal(isLogoutBroadcast({ key: "grihagrid.family.receipt", newValue: "test-marker" }), false);
  assert.equal(isLogoutChannelMessage({ data: messages[0] }), true);
  assert.equal(isLogoutChannelMessage({ data: { type: "logout", marker: "" } }), false);
});

test("Dashboard and Orders share one accessible, retry-safe mobile logout control", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(`${root}/src/App.jsx`, "utf8");
  const styles = readFileSync(`${root}/src/styles.css`, "utf8");
  assert.equal((source.match(/<WorkspaceAccount user=/gu) || []).length, 2);
  assert.equal(source.includes("api('/api/auth/logout'"), false);
  assert.match(source, /disabled=\{pending\} aria-busy=\{pending\}/u);
  assert.match(source, /role="alert">\{LOGOUT_FAILURE_MESSAGE\}/u);
  assert.match(source, /inFlight\.current/u);
  assert.match(source, /new window\.BroadcastChannel\(LOGOUT_CHANNEL_NAME\)/u);
  assert.match(source, /window\.addEventListener\('pageshow',revalidate\)/u);
  assert.match(source, /replaceRoute\("\/", \{ logoutConfirmed: true \}\)/u);
  assert.match(source, /user===null&&window\.history\.state\?\.logoutConfirmed===true/u);
  assert.doesNotMatch(source, /logged_out/u);
  assert.doesNotMatch(source, /aria-label=\{failed/u);
  assert.match(styles, /\.workspace-account button\s*\{[^}]*min-height:\s*48px;/su);
  assert.doesNotMatch(styles, /\.workspace-account\s*\{\s*display:\s*none;/su);
});
