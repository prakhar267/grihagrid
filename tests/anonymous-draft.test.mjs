import assert from "node:assert/strict";
import test from "node:test";
import {
  ANONYMOUS_DRAFT_RETENTION_MS,
  ANONYMOUS_DRAFT_LOCK_NAME,
  ANONYMOUS_DRAFT_STORAGE_KEY,
  acceptedAnonymousProjectCreationResponse,
  canonicalAnonymousProjectDraft,
  clearAnonymousDraft,
  clearAnonymousDraftAfterCreation,
  clearEphemeralAnonymousDraft,
  clearLegacyPendingProjectState,
  holdAnonymousDraftLock,
  parseAnonymousDraftEnvelope,
  prepareAnonymousDraftExit,
  prepareAnonymousDraftSubmission,
  purgeInvalidAnonymousDraftOnBoot,
  readAnonymousDraft,
  readAnonymousDraftContinuation,
  readRecoverableAnonymousDraft,
  safeLocalStorage,
  sameAnonymousDraftPayload,
  sameAnonymousDraftVersion,
  saveAnonymousDraft,
  updateAnonymousDraftStatus,
  validAnonymousProjectName,
} from "../src/anonymous-draft.js";

const NOW = Date.parse("2026-08-17T03:00:00.000Z");
const KEY = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_KEY = "123e4567-e89b-42d3-b456-426614174001";
const OTHER_WRITE_ID = "123e4567-e89b-42d3-8456-426614174002";
const PROJECT_ID = "123e4567-e89b-42d3-9456-426614174003";
const validDraft = Object.freeze({
  name: "My family home",
  width: 30,
  length: 50,
  city: "Pune",
  facing: "East",
  floors: "G+1",
  bedrooms: 3,
  bathrooms: null,
  parking: "1 car",
  roadWidthFt: null,
  plotShape: "unknown",
  accessibility: "unknown",
  futureUse: "unknown",
  budgetLakh: null,
  style: "Warm modern",
  quality: "Signature",
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function save(storage, overrides = {}, expected = null, now = NOW, options = undefined) {
  return saveAnonymousDraft(storage, {
    draft: validDraft,
    step: 1,
    projectCreationKey: KEY,
    entryPoint: "public_estimator",
    status: "editing",
    ...overrides,
  }, expected, now, options);
}

test("anonymous drafts round-trip one exact, versioned seven-day envelope", () => {
  const storage = memoryStorage();
  const saved = save(storage);
  assert.equal(saved.ok, true);
  assert.equal(saved.reason, "saved");
  assert.equal(saved.record.revision, 1);
  assert.match(saved.record.writeId, /^[0-9a-f-]{36}$/u);
  assert.equal(saved.record.updatedAtMs, NOW);
  assert.equal(saved.record.expiresAtMs, NOW + ANONYMOUS_DRAFT_RETENTION_MS);
  assert.deepEqual(readAnonymousDraft(storage, NOW), saved.record);
  assert.equal(storage.values.size, 1);
  assert.equal(storage.values.has(ANONYMOUS_DRAFT_STORAGE_KEY), true);
});

test("the persisted project shape is an exact allowlist with strict scalar values", () => {
  assert.deepEqual(canonicalAnonymousProjectDraft(validDraft), validDraft);
  assert.equal(canonicalAnonymousProjectDraft({ ...validDraft, name: "  My\u00a0 family   home  " }).name, "My family home");
  assert.equal(validAnonymousProjectName("  ＱＡ　Home  "), true);
  assert.equal(validAnonymousProjectName("Unsafe\u202ename"), false);
  assert.equal(validAnonymousProjectName("   "), false);
  for (const value of [null, [], "draft", { ...validDraft, token: "secret" }]) {
    assert.equal(canonicalAnonymousProjectDraft(value), null);
  }
  for (const [field, value] of [
    ["name", { token: "secret" }],
    ["name", "Unsafe\u202esecret"],
    ["width", "30"],
    ["width", Number.NaN],
    ["bedrooms", 5],
    ["bathrooms", 0],
    ["parking", true],
    ["roadWidthFt", Number.POSITIVE_INFINITY],
    ["style", "<script>alert(1)</script>"],
  ]) assert.equal(canonicalAnonymousProjectDraft({ ...validDraft, [field]: value }), null, field);
});

test("invalid or changed visible input cannot resolve to an older saved submission", () => {
  const storage = memoryStorage();
  const saved = save(storage, { draft: { ...validDraft, name: "Original name" } }).record;
  assert.equal(prepareAnonymousDraftSubmission({ ...validDraft, name: "   " }, saved), null);
  assert.equal(prepareAnonymousDraftSubmission({ ...validDraft, name: "Changed visible name" }, saved), null);
  assert.deepEqual(prepareAnonymousDraftSubmission(saved.draft, saved), { draft: saved.draft, record: saved });
  assert.deepEqual(prepareAnonymousDraftSubmission(validDraft), { draft: validDraft, record: null });
});

test("Save & exit requires the exact visible canonical draft and step", () => {
  const storage = memoryStorage();
  const saved = save(storage, { draft: { ...validDraft, name: "Original name" } }).record;
  assert.equal(prepareAnonymousDraftExit({ ...validDraft, name: "   " }, 1, saved), null);
  assert.deepEqual(prepareAnonymousDraftExit({ ...validDraft, name: "Changed visible name" }, 1, saved), {
    draft: { ...validDraft, name: "Changed visible name" },
    exactRecord: null,
  });
  assert.deepEqual(prepareAnonymousDraftExit(saved.draft, 2, saved), { draft: saved.draft, exactRecord: null });
  assert.deepEqual(prepareAnonymousDraftExit(saved.draft, 1, saved), { draft: saved.draft, exactRecord: saved });
});

test("only strict 200/201 project responses may consume an anonymous draft", () => {
  const submitted = save(memoryStorage()).record;
  const { name, ...input } = submitted.draft;
  const response = {
    project: {
      id: PROJECT_ID,
      name,
      status: "feasibility_ready",
      input,
      estimate: {},
      estimateRuleVersion: 1,
      briefCheck: {},
      inputRevision: 1,
      reportAvailable: false,
      createdAt: "2026-08-17 03:00:00",
      updatedAt: "2026-08-17 03:00:00",
    },
  };
  assert.deepEqual(acceptedAnonymousProjectCreationResponse(response, 201, submitted), response.project);
  assert.equal(acceptedAnonymousProjectCreationResponse(response, 202, submitted), null);
  assert.equal(acceptedAnonymousProjectCreationResponse({}, 201, submitted), null);
  assert.equal(acceptedAnonymousProjectCreationResponse({ project: { ...response.project, id: "not-a-uuid" } }, 201, submitted), null);
  assert.equal(acceptedAnonymousProjectCreationResponse({ project: { ...response.project, name: "Different project" } }, 201, submitted), null);
  assert.equal(acceptedAnonymousProjectCreationResponse({ project: { ...response.project, input: { ...input, name } } }, 201, submitted), null);
  const currentReplay = {
    project: {
      ...response.project,
      name: "Renamed after creation",
      input: { ...input, city: "Delhi" },
      inputRevision: 2,
      status: "archived",
    },
  };
  assert.deepEqual(acceptedAnonymousProjectCreationResponse(currentReplay, 200, submitted), currentReplay.project);
});

test("application boot purges only the retired session and history payloads", () => {
  const sessionStorage = memoryStorage({ "grihagrid.pendingProject": "private", unrelated: "preserve" });
  const calls = [];
  const windowObject = {
    sessionStorage,
    history: {
      state: { pendingProject: { name: "Legacy" }, projectCreationKey: KEY, unrelated: "preserve" },
      replaceState(state, title, url) { calls.push({ state, title, url });this.state = state; },
    },
    location: { href: "https://example.test/start" },
  };
  assert.deepEqual(clearLegacyPendingProjectState(windowObject), { sessionRemoved: true, historyRemoved: true });
  assert.equal(sessionStorage.getItem("grihagrid.pendingProject"), null);
  assert.equal(sessionStorage.getItem("unrelated"), "preserve");
  assert.deepEqual(calls, [{
    state: { projectCreationKey: KEY, unrelated: "preserve" },
    title: "",
    url: "https://example.test/start",
  }]);
});

test("general app boot purges expired drafts only under an available exclusive lock", async () => {
  const storage = memoryStorage({ unrelated: "preserve" });
  const record = save(storage).record;
  const availableWindow = {
    localStorage: storage,
    navigator: {
      locks: {
        request(name, options, callback) {
          assert.equal(name, ANONYMOUS_DRAFT_LOCK_NAME);
          assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
          return callback({ name });
        },
      },
    },
  };
  assert.equal(await purgeInvalidAnonymousDraftOnBoot(availableWindow, record.expiresAtMs), "purged");
  assert.equal(storage.getItem(ANONYMOUS_DRAFT_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "preserve");

  const contendedStorage = memoryStorage({ [ANONYMOUS_DRAFT_STORAGE_KEY]: JSON.stringify(record) });
  const contendedWindow = {
    localStorage: contendedStorage,
    navigator: { locks: { request: (_name, _options, callback) => callback(null) } },
  };
  assert.equal(await purgeInvalidAnonymousDraftOnBoot(contendedWindow, record.expiresAtMs), "contended");
  assert.notEqual(contendedStorage.getItem(ANONYMOUS_DRAFT_STORAGE_KEY), null);
  assert.equal(await purgeInvalidAnonymousDraftOnBoot({ navigator: {} }, record.expiresAtMs), "unsupported");
});

test("an exclusive Web Lock is held until release and contention never enters the critical section", async () => {
  const statuses = [];
  let heldRequest;
  const available = {
    request(name, options, callback) {
      assert.equal(name, ANONYMOUS_DRAFT_LOCK_NAME);
      assert.equal(options.mode, "exclusive");
      assert.equal(options.ifAvailable, true);
      assert.deepEqual(Object.keys(options).sort(), ["ifAvailable", "mode"]);
      heldRequest = callback({ name });
      return heldRequest;
    },
  };
  const release = holdAnonymousDraftLock(available, status => statuses.push(status));
  assert.deepEqual(statuses, ["acquired"]);
  let settled = false;
  heldRequest.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await heldRequest;
  assert.equal(settled, true);

  const contended = [];
  holdAnonymousDraftLock({ request: (_name, _options, callback) => callback(null) }, status => contended.push(status));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(contended, ["contended"]);
  const transient = [];
  let transientAttempts = 0;
  const releaseTransient = holdAnonymousDraftLock({ request: (_name, _options, callback) => {
    transientAttempts += 1;
    return callback(transientAttempts === 1 ? null : { name: ANONYMOUS_DRAFT_LOCK_NAME });
  } }, status => transient.push(status));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(transientAttempts, 2);
  assert.deepEqual(transient, ["acquired"]);
  releaseTransient();
  const unsupported = [];
  holdAnonymousDraftLock(null, status => unsupported.push(status));
  await Promise.resolve();
  assert.deepEqual(unsupported, ["unsupported"]);
});

test("unknown envelope fields, oversized input, malformed JSON, timestamps, and weak keys fail closed", () => {
  const storage = memoryStorage();
  const record = save(storage).record;
  assert.equal(parseAnonymousDraftEnvelope({ ...record, serverResponse: {} }, NOW), null);
  assert.equal(parseAnonymousDraftEnvelope("{"), null);
  assert.equal(parseAnonymousDraftEnvelope("x".repeat(12_001), NOW), null);
  assert.equal(parseAnonymousDraftEnvelope({ ...record, projectCreationKey: "short-key" }, NOW), null);
  assert.equal(parseAnonymousDraftEnvelope({ ...record, expiresAtMs: record.expiresAtMs + 1 }, NOW), null);
  assert.equal(parseAnonymousDraftEnvelope({ ...record, updatedAtMs: NOW + 6 * 60 * 1000, expiresAtMs: NOW + 6 * 60 * 1000 + ANONYMOUS_DRAFT_RETENTION_MS }, NOW), null);
  assert.equal(parseAnonymousDraftEnvelope(record, record.expiresAtMs), null);
});

test("reads and submission-state changes never extend expiry", () => {
  const storage = memoryStorage();
  const initial = save(storage).record;
  assert.equal(readAnonymousDraft(storage, NOW + 60_000).expiresAtMs, initial.expiresAtMs);
  const awaiting = updateAnonymousDraftStatus(storage, initial, "awaiting_auth", NOW + 120_000);
  assert.equal(awaiting.ok, true);
  assert.equal(awaiting.record.updatedAtMs, initial.updatedAtMs);
  assert.equal(awaiting.record.expiresAtMs, initial.expiresAtMs);
  assert.equal(awaiting.record.revision, initial.revision + 1);
});

test("an open memory-only tab cannot edit, advance, or submit after exact expiry", () => {
  clearEphemeralAnonymousDraft();
  const initial = save(null).record;
  const expiredAt = initial.expiresAtMs;
  assert.deepEqual(
    save(null, { draft: { ...validDraft, city: "Delhi" } }, initial, expiredAt),
    { ok: false, reason: "expired", record: null },
  );
  assert.deepEqual(
    updateAnonymousDraftStatus(null, initial, "submitting", expiredAt),
    { ok: false, reason: "expired", record: null },
  );
  assert.equal(readRecoverableAnonymousDraft(null, expiredAt), null);
  clearEphemeralAnonymousDraft();
});

test("only an actual edit advances the seven-day window", () => {
  const storage = memoryStorage();
  const initial = save(storage).record;
  const unchanged = save(storage, {}, initial, NOW + 45_000);
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.reason, "unchanged");
  assert.deepEqual(unchanged.record, initial);
  assert.deepEqual(readAnonymousDraft(storage, NOW + 45_000), initial);
  const editedAt = NOW + 90_000;
  const edited = save(storage, { draft: { ...validDraft, budgetLakh: 80 }, step: 2 }, initial, editedAt);
  assert.equal(edited.ok, true);
  assert.equal(edited.record.updatedAtMs, editedAt);
  assert.equal(edited.record.expiresAtMs, editedAt + ANONYMOUS_DRAFT_RETENTION_MS);
  assert.equal(edited.record.revision, 2);
});

test("expired and corrupt payloads are removed without touching unrelated storage", () => {
  const storage = memoryStorage({ unrelated: "preserve" });
  const record = save(storage).record;
  assert.equal(readAnonymousDraft(storage, record.expiresAtMs), null);
  assert.equal(storage.values.has(ANONYMOUS_DRAFT_STORAGE_KEY), false);
  assert.equal(storage.values.get("unrelated"), "preserve");
  storage.values.set(ANONYMOUS_DRAFT_STORAGE_KEY, JSON.stringify({ token: "private" }));
  assert.equal(readAnonymousDraft(storage, NOW), null);
  assert.equal(storage.values.has(ANONYMOUS_DRAFT_STORAGE_KEY), false);
});

test("stale tabs cannot overwrite or clear a newer or discarded draft", () => {
  const storage = memoryStorage();
  const first = save(storage).record;
  const second = save(storage, { draft: { ...validDraft, city: "Jaipur" } }, first, NOW + 1).record;
  const staleWrite = save(storage, { draft: { ...validDraft, city: "Mumbai" } }, first, NOW + 2);
  assert.equal(staleWrite.ok, false);
  assert.equal(staleWrite.reason, "conflict");
  assert.deepEqual(readAnonymousDraft(storage, NOW + 2), second);
  assert.deepEqual(clearAnonymousDraft(storage, first, NOW + 2), { ok: false, removed: false, reason: "conflict" });
  assert.deepEqual(readAnonymousDraft(storage, NOW + 2), second);
  assert.equal(clearAnonymousDraft(storage, second, NOW + 2).ok, true);
  assert.equal(readAnonymousDraft(storage, NOW + 2), null);
  const staleAfterDiscard = save(storage, { draft: { ...validDraft, city: "Delhi" } }, second, NOW + 3);
  assert.equal(staleAfterDiscard.reason, "conflict");
});

test("equal-revision forks have distinct write identities and cannot overwrite or discard", () => {
  const storage = memoryStorage();
  const first = save(storage).record;
  const branchA = save(storage, { draft: { ...validDraft, city: "Jaipur" } }, first, NOW + 1).record;
  const branchB = {
    ...branchA,
    writeId: OTHER_WRITE_ID,
    draft: { ...branchA.draft, city: "Mumbai" },
  };
  storage.values.set(ANONYMOUS_DRAFT_STORAGE_KEY, JSON.stringify(branchB));
  assert.equal(sameAnonymousDraftVersion(branchA, branchB), false);
  assert.equal(save(storage, { draft: { ...validDraft, city: "Delhi" } }, branchA, NOW + 2).reason, "conflict");
  assert.deepEqual(clearAnonymousDraft(storage, branchA, NOW + 2), { ok: false, removed: false, reason: "conflict" });
  assert.deepEqual(readAnonymousDraft(storage, NOW + 2), branchB);
});

test("successful creation clears only the exact submitted version and payload", () => {
  const storage = memoryStorage();
  const submitted = updateAnonymousDraftStatus(storage, save(storage).record, "submitting", NOW + 1).record;
  const newer = save(storage, { draft: { ...validDraft, quality: "Premium" } }, submitted, NOW + 2).record;
  assert.equal(sameAnonymousDraftPayload(submitted, newer), false);
  assert.deepEqual(clearAnonymousDraftAfterCreation(storage, submitted, NOW + 2), { ok: false, removed: false, reason: "conflict" });
  assert.deepEqual(readAnonymousDraft(storage, NOW + 2), newer);
  assert.equal(clearAnonymousDraftAfterCreation(storage, newer, NOW + 2).ok, true);
  assert.equal(readAnonymousDraft(storage, NOW + 2), null);
});

test("blocked or quota-limited storage degrades to exact same-tab continuation", () => {
  clearEphemeralAnonymousDraft();
  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  const result = save(blocked);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unavailable");
  assert.deepEqual(readAnonymousDraftContinuation(blocked, KEY, NOW), result.record);
  assert.equal(readAnonymousDraftContinuation(blocked, OTHER_KEY, NOW), null);
  clearEphemeralAnonymousDraft(KEY);
  assert.equal(readAnonymousDraftContinuation(blocked, KEY, NOW), null);
});

test("quota failure preserves the last confirmed version and continues exact same-tab edits", () => {
  clearEphemeralAnonymousDraft();
  const base = memoryStorage();
  const initial = save(base).record;
  const quota = {
    getItem: base.getItem.bind(base),
    setItem() { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem: base.removeItem.bind(base),
  };
  const first = save(quota, { draft: { ...validDraft, city: "Jaipur" } }, initial, NOW + 1);
  assert.equal(first.reason, "unavailable");
  assert.deepEqual(readAnonymousDraft(base, NOW + 1), initial);
  assert.deepEqual(readRecoverableAnonymousDraft(quota, NOW + 1), first.record);
  const second = save(quota, { draft: { ...validDraft, city: "Delhi" } }, first.record, NOW + 2);
  assert.equal(second.reason, "unavailable");
  assert.equal(second.record.revision, first.record.revision + 1);
  assert.deepEqual(readRecoverableAnonymousDraft(quota, NOW + 2), second.record);
  clearEphemeralAnonymousDraft(KEY);
  assert.deepEqual(readRecoverableAnonymousDraft(quota, NOW + 2), initial);
});

test("an exact quota fallback can be discarded or consumed without leaving its confirmed ancestor", () => {
  clearEphemeralAnonymousDraft();
  const discardStorage = memoryStorage();
  const discardInitial = save(discardStorage).record;
  const discardQuota = {
    getItem: discardStorage.getItem.bind(discardStorage),
    setItem() { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem: discardStorage.removeItem.bind(discardStorage),
  };
  const discardEphemeral = save(discardQuota, { draft: { ...validDraft, city: "Jaipur" } }, discardInitial, NOW + 1).record;
  assert.deepEqual(clearAnonymousDraft(discardQuota, discardEphemeral, NOW + 1), { ok: true, removed: true, reason: "cleared" });
  assert.equal(readRecoverableAnonymousDraft(discardQuota, NOW + 1), null);

  const consumeStorage = memoryStorage();
  const consumeInitial = save(consumeStorage).record;
  const consumeQuota = {
    getItem: consumeStorage.getItem.bind(consumeStorage),
    setItem() { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem: consumeStorage.removeItem.bind(consumeStorage),
  };
  const submitted = save(consumeQuota, { draft: { ...validDraft, city: "Delhi" }, status: "submitting" }, consumeInitial, NOW + 2).record;
  assert.deepEqual(clearAnonymousDraftAfterCreation(consumeQuota, submitted, NOW + 2), { ok: true, removed: true, reason: "cleared" });
  assert.equal(readRecoverableAnonymousDraft(consumeQuota, NOW + 2), null);
});

test("an external deletion or fork cannot resurrect a quota fallback", () => {
  clearEphemeralAnonymousDraft();
  const storage = memoryStorage();
  const initial = save(storage).record;
  const quota = {
    getItem: storage.getItem.bind(storage),
    setItem() { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem: storage.removeItem.bind(storage),
  };
  const ephemeral = save(quota, { draft: { ...validDraft, city: "Jaipur" } }, initial, NOW + 1).record;
  assert.equal(readRecoverableAnonymousDraft(null, NOW + 1), null);
  storage.removeItem(ANONYMOUS_DRAFT_STORAGE_KEY);
  assert.equal(readRecoverableAnonymousDraft(quota, NOW + 1), null);
  storage.setItem(ANONYMOUS_DRAFT_STORAGE_KEY, JSON.stringify({
    ...initial,
    writeId: OTHER_WRITE_ID,
    draft: { ...initial.draft, city: "Mumbai" },
  }));
  assert.equal(clearAnonymousDraft(quota, ephemeral, NOW + 1).reason, "conflict");
  assert.equal(readRecoverableAnonymousDraft(quota, NOW + 1).draft.city, "Mumbai");
  clearEphemeralAnonymousDraft();
});

test("a confirmed draft cannot be reclassified as pure memory when its handle becomes unreadable", () => {
  clearEphemeralAnonymousDraft();
  const storage = memoryStorage();
  const confirmed = save(storage).record;
  const inaccessible = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  const fallback = save(inaccessible, { draft: { ...validDraft, city: "Delhi" } }, confirmed, NOW + 1);
  assert.equal(fallback.reason, "unavailable");
  assert.equal(fallback.record.draft.city, "Delhi");
  storage.removeItem(ANONYMOUS_DRAFT_STORAGE_KEY);
  assert.equal(readRecoverableAnonymousDraft(null, NOW + 1), null);
  assert.equal(readRecoverableAnonymousDraft(inaccessible, NOW + 1), null);
  clearEphemeralAnonymousDraft();
});

test("silent storage writes and removals are never reported as confirmed", () => {
  clearEphemeralAnonymousDraft();
  const silentWrite = memoryStorage();
  silentWrite.setItem = () => {};
  const unconfirmed = save(silentWrite);
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.reason, "unavailable");
  clearEphemeralAnonymousDraft();

  const retained = memoryStorage();
  const record = save(retained).record;
  retained.removeItem = () => {};
  assert.deepEqual(clearAnonymousDraft(retained, record, NOW), { ok: false, removed: false, reason: "unavailable" });
  assert.deepEqual(readAnonymousDraft(retained, NOW), record);
});

test("a released storage handle cannot falsely clear a persisted in-flight submission", () => {
  clearEphemeralAnonymousDraft();
  const storage = memoryStorage();
  const submitted = updateAnonymousDraftStatus(storage, save(storage).record, "submitting", NOW + 1).record;
  assert.deepEqual(clearAnonymousDraft(null, submitted, NOW + 1), { ok: false, removed: false, reason: "unavailable" });
  assert.deepEqual(clearAnonymousDraftAfterCreation(null, submitted, NOW + 1), { ok: false, removed: false, reason: "unavailable" });
  assert.deepEqual(readAnonymousDraft(storage, NOW + 1), submitted);
  clearEphemeralAnonymousDraft();
  const memoryOnly = save(null).record;
  assert.deepEqual(clearAnonymousDraft(null, memoryOnly, NOW), { ok: true, removed: false, reason: "absent" });
  assert.equal(readRecoverableAnonymousDraft(null, NOW), null);
});

test("corrupt recovery records are purged and unverifiable discard never claims success", () => {
  clearEphemeralAnonymousDraft();
  const corrupt = memoryStorage({ [ANONYMOUS_DRAFT_STORAGE_KEY]: JSON.stringify({ password: "nope" }) });
  assert.equal(readRecoverableAnonymousDraft(corrupt, NOW), null);
  assert.equal(corrupt.values.has(ANONYMOUS_DRAFT_STORAGE_KEY), false);
  const inaccessible = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  const result = save(inaccessible);
  assert.equal(clearAnonymousDraft(inaccessible, result.record, NOW).reason, "unavailable");
  assert.deepEqual(readAnonymousDraftContinuation(inaccessible, KEY, NOW), result.record);
  clearEphemeralAnonymousDraft();
});

test("ephemeral fallback cannot resurrect a draft after persisted deletion", () => {
  clearEphemeralAnonymousDraft();
  const storage = memoryStorage();
  const saved = save(storage).record;
  storage.removeItem(ANONYMOUS_DRAFT_STORAGE_KEY);
  assert.equal(readAnonymousDraftContinuation(storage, saved.projectCreationKey, NOW), null);
  assert.equal(readAnonymousDraftContinuation(null, saved.projectCreationKey, NOW), null);
});

test("safe local storage access tolerates browser getter failures", () => {
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  assert.equal(safeLocalStorage(blockedWindow), null);
  const storage = memoryStorage();
  assert.equal(safeLocalStorage({ localStorage: storage }), storage);
});
