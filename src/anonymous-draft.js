import { validProjectCreationKey } from "./public-estimator.js";

export const ANONYMOUS_DRAFT_STORAGE_KEY = "grihagrid.anonymousDraft.v1";
export const ANONYMOUS_DRAFT_LOCK_NAME = "grihagrid.anonymousDraft.v1.lock";
export const ANONYMOUS_DRAFT_SCHEMA_VERSION = 1;
export const ANONYMOUS_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_STORED_DRAFT_CHARACTERS = 12_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const PROJECT_CREATION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ENVELOPE_FIELDS = Object.freeze([
  "schemaVersion",
  "revision",
  "writeId",
  "step",
  "updatedAtMs",
  "expiresAtMs",
  "projectCreationKey",
  "entryPoint",
  "status",
  "draft",
]);
const DRAFT_FIELDS = Object.freeze([
  "name",
  "width",
  "length",
  "city",
  "facing",
  "floors",
  "bedrooms",
  "bathrooms",
  "parking",
  "roadWidthFt",
  "plotShape",
  "accessibility",
  "futureUse",
  "budgetLakh",
  "style",
  "quality",
]);
const CITIES = Object.freeze(["Pune", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Jaipur", "Other"]);
const FACINGS = Object.freeze(["North", "East", "South", "West"]);
const FLOORS = Object.freeze(["G", "G+1", "G+2"]);
const BEDROOMS = Object.freeze([2, 3, 4, "5+"]);
const PARKING = Object.freeze(["None", "1 car", "2 cars"]);
const PLOT_SHAPES = Object.freeze(["regular", "irregular", "corner", "unknown"]);
const ACCESSIBILITY = Object.freeze(["none", "step_free", "wheelchair_ready", "unknown"]);
const FUTURE_USES = Object.freeze(["none", "rental", "home_office", "vertical_expansion", "unknown"]);
export const ANONYMOUS_DRAFT_STYLES = Object.freeze(["Warm modern", "Contemporary", "Traditional Indian", "Tropical modern", "Minimal"]);
const QUALITIES = Object.freeze(["Essential", "Signature", "Premium", "Luxury"]);
const STATUSES = Object.freeze(["editing", "awaiting_auth", "submitting", "retry_required"]);
const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}]/u;

let ephemeralDraft = null;
let ephemeralOnly = false;
let ephemeralBaseline;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactOwnKeys(value, fields) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function enumValue(value, values) {
  return values.includes(value);
}

function boundedNumber(value, minimum, maximum, integer = false) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    && (!integer || Number.isInteger(value));
}

function nullableBoundedNumber(value, minimum, maximum, integer = false) {
  return value === null || boundedNumber(value, minimum, maximum, integer);
}

function canonicalText(value, maximum) {
  if (typeof value !== "string" || UNSAFE_TEXT_PATTERN.test(value)) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= maximum ? normalized : null;
}

export function canonicalAnonymousProjectDraft(value) {
  if (!hasExactOwnKeys(value, DRAFT_FIELDS)) return null;
  const name = canonicalText(value.name, 100);
  if (!name
      || !boundedNumber(value.width, 10, 500)
      || !boundedNumber(value.length, 10, 500)
      || !enumValue(value.city, CITIES)
      || !enumValue(value.facing, FACINGS)
      || !enumValue(value.floors, FLOORS)
      || !enumValue(value.bedrooms, BEDROOMS)
      || !nullableBoundedNumber(value.bathrooms, 1, 12, true)
      || !enumValue(value.parking, PARKING)
      || !nullableBoundedNumber(value.roadWidthFt, 6, 200)
      || !enumValue(value.plotShape, PLOT_SHAPES)
      || !enumValue(value.accessibility, ACCESSIBILITY)
      || !enumValue(value.futureUse, FUTURE_USES)
      || !nullableBoundedNumber(value.budgetLakh, 5, 10_000)
      || !enumValue(value.style, ANONYMOUS_DRAFT_STYLES)
      || !enumValue(value.quality, QUALITIES)) return null;
  return Object.fromEntries(DRAFT_FIELDS.map(field => [field, field === "name" ? name : value[field]]));
}

function validCreationUuid(value) {
  return validProjectCreationKey(value) && PROJECT_CREATION_UUID_PATTERN.test(value) ? value : null;
}

function parseEnvelopeValue(value, nowMs) {
  if (!hasExactOwnKeys(value, ENVELOPE_FIELDS)) return null;
  if (value.schemaVersion !== ANONYMOUS_DRAFT_SCHEMA_VERSION
      || !Number.isSafeInteger(value.revision) || value.revision < 1
      || !validCreationUuid(value.writeId)
      || !Number.isInteger(value.step) || value.step < 0 || value.step > 3
      || !Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < 0
      || !Number.isSafeInteger(value.expiresAtMs)
      || value.expiresAtMs - value.updatedAtMs !== ANONYMOUS_DRAFT_RETENTION_MS
      || value.updatedAtMs > nowMs + MAX_CLOCK_SKEW_MS
      || value.expiresAtMs <= nowMs
      || !validCreationUuid(value.projectCreationKey)
      || ![null, "public_estimator"].includes(value.entryPoint)
      || !STATUSES.includes(value.status)) return null;
  const draft = canonicalAnonymousProjectDraft(value.draft);
  return draft ? { ...value, draft } : null;
}

export function parseAnonymousDraftEnvelope(value, nowMs = Date.now()) {
  let parsed = value;
  if (typeof value === "string") {
    if (!value || value.length > MAX_STORED_DRAFT_CHARACTERS) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parseEnvelopeValue(parsed, nowMs);
}

export function safeLocalStorage(windowObject = globalThis.window) {
  try {
    return windowObject?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function clearLegacyPendingProjectState(windowObject = globalThis.window) {
  let sessionRemoved = false;
  let historyRemoved = false;
  try {
    const storage = windowObject?.sessionStorage;
    if (storage) {
      storage.removeItem("grihagrid.pendingProject");
      sessionRemoved = true;
    }
  } catch { /* Best-effort removal of the retired payload source. */ }
  try {
    const current = windowObject?.history?.state;
    if (isRecord(current) && Object.hasOwn(current, "pendingProject")) {
      const next = { ...current };
      delete next.pendingProject;
      windowObject.history.replaceState(next, "", windowObject.location?.href);
      historyRemoved = true;
    }
  } catch { /* Browser history may be unavailable in restricted contexts. */ }
  return { sessionRemoved, historyRemoved };
}

export function holdAnonymousDraftLock(lockManager, onStatus) {
  let released = false;
  let releaseHold = () => {};
  let retryTimer = null;
  const hold = new Promise(resolve => { releaseHold = resolve; });
  const emit = status => { if (!released) onStatus(status); };
  const release = () => {
    released = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    releaseHold();
  };
  if (!lockManager || typeof lockManager.request !== "function") {
    queueMicrotask(() => emit("unsupported"));
    return release;
  }
  const requestLock = finalAttempt => {
    if (released) return;
    try {
      const request = lockManager.request(
        ANONYMOUS_DRAFT_LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async lock => {
          if (!lock) {
            if (finalAttempt) emit("contended");
            else retryTimer = setTimeout(() => requestLock(true), 0);
            return;
          }
          if (released) return;
          emit("acquired");
          await hold;
        },
      );
      Promise.resolve(request).catch(() => emit("unsupported"));
    } catch {
      queueMicrotask(() => emit("unsupported"));
    }
  };
  requestLock(false);
  return release;
}

function rawStoredDraft(storage) {
  try {
    return { available: Boolean(storage), raw: storage?.getItem(ANONYMOUS_DRAFT_STORAGE_KEY) ?? null };
  } catch {
    return { available: false, raw: null };
  }
}

export function readAnonymousDraft(storage, nowMs = Date.now(), purgeInvalid = true) {
  const stored = rawStoredDraft(storage);
  if (!stored.available || stored.raw === null) return null;
  const envelope = parseAnonymousDraftEnvelope(stored.raw, nowMs);
  if (!envelope && purgeInvalid) {
    try { storage.removeItem(ANONYMOUS_DRAFT_STORAGE_KEY); } catch { /* Saving is optional. */ }
  }
  return envelope;
}

export function readRecoverableAnonymousDraft(storage, nowMs = Date.now()) {
  const ephemeral = parseAnonymousDraftEnvelope(ephemeralDraft, nowMs);
  const stored = rawStoredDraft(storage);
  if (stored.available) {
    const persisted = stored.raw === null ? null : parseAnonymousDraftEnvelope(stored.raw, nowMs);
    if (stored.raw !== null && !persisted) {
      try { storage.removeItem(ANONYMOUS_DRAFT_STORAGE_KEY); } catch { /* Saving is optional. */ }
    }
    const baselineMatches = ephemeralBaseline === null
      ? persisted === null
      : Boolean(ephemeralBaseline && sameAnonymousDraftVersion(persisted, ephemeralBaseline));
    if (ephemeralOnly && ephemeral && baselineMatches) return ephemeral;
    return persisted;
  }
  return ephemeralOnly && ephemeralBaseline === undefined ? ephemeral : null;
}

export function sameAnonymousDraftVersion(left, right) {
  return Boolean(left && right
    && left.projectCreationKey === right.projectCreationKey
    && left.revision === right.revision
    && left.writeId === right.writeId
    && left.step === right.step
    && left.updatedAtMs === right.updatedAtMs
    && left.expiresAtMs === right.expiresAtMs
    && left.entryPoint === right.entryPoint
    && left.status === right.status
    && sameAnonymousDraftPayload(left, right));
}

export function sameAnonymousDraftPayload(left, right) {
  return Boolean(left && right
    && left.projectCreationKey === right.projectCreationKey
    && JSON.stringify(left.draft) === JSON.stringify(right.draft));
}

export function prepareAnonymousDraftSubmission(visibleDraft, activeRecord = null) {
  const draft = canonicalAnonymousProjectDraft(visibleDraft);
  if (!draft) return null;
  if (activeRecord && !sameAnonymousDraftPayload(activeRecord, {
    projectCreationKey: activeRecord.projectCreationKey,
    draft,
  })) return null;
  return { draft, record: activeRecord };
}

function nextEnvelope({ draft, step, projectCreationKey, entryPoint = null, status = "editing" }, expected, nowMs, touch) {
  const canonicalDraft = canonicalAnonymousProjectDraft(draft);
  const creationKey = validCreationUuid(projectCreationKey);
  if (!canonicalDraft || !creationKey || !Number.isInteger(step) || step < 0 || step > 3
      || ![null, "public_estimator"].includes(entryPoint) || !STATUSES.includes(status)) return null;
  const updatedAtMs = touch || !expected ? nowMs : expected.updatedAtMs;
  return {
    schemaVersion: ANONYMOUS_DRAFT_SCHEMA_VERSION,
    revision: expected ? expected.revision + 1 : 1,
    writeId: crypto.randomUUID(),
    step,
    updatedAtMs,
    expiresAtMs: touch || !expected ? updatedAtMs + ANONYMOUS_DRAFT_RETENTION_MS : expected.expiresAtMs,
    projectCreationKey: creationKey,
    entryPoint,
    status,
    draft: canonicalDraft,
  };
}

export function saveAnonymousDraft(storage, input, expected = null, nowMs = Date.now(), { touch = true } = {}) {
  const validExpected = expected ? parseAnonymousDraftEnvelope(expected, nowMs) : null;
  if (expected && !validExpected) return { ok: false, reason: "expired", record: null };
  const record = nextEnvelope(input, validExpected, nowMs, touch);
  if (!record) return { ok: false, reason: "invalid", record: null };
  const continuingEphemeral = Boolean(validExpected && ephemeralOnly && sameAnonymousDraftVersion(ephemeralDraft, validExpected));
  const stored = rawStoredDraft(storage);
  if (stored.available) {
    const current = stored.raw === null ? null : parseAnonymousDraftEnvelope(stored.raw, nowMs);
    const safeEphemeralBaseline = continuingEphemeral && (ephemeralBaseline === null
      ? stored.raw === null
      : Boolean(ephemeralBaseline && sameAnonymousDraftVersion(current, ephemeralBaseline)));
    if (validExpected ? !sameAnonymousDraftVersion(current, validExpected) && !safeEphemeralBaseline : stored.raw !== null) {
      return { ok: false, reason: "conflict", record: current };
    }
    try {
      storage.setItem(ANONYMOUS_DRAFT_STORAGE_KEY, JSON.stringify(record));
      const confirmed = readAnonymousDraft(storage, nowMs, false);
      if (!sameAnonymousDraftVersion(confirmed, record)) throw new Error("anonymous draft write was not confirmed");
      ephemeralDraft = record;
      ephemeralOnly = false;
      ephemeralBaseline = undefined;
      return { ok: true, reason: "saved", record };
    } catch {
      // Preserve the last confirmed browser version; the newer value remains same-tab only.
      if (!continuingEphemeral) ephemeralBaseline = current;
    }
  } else if (!continuingEphemeral) {
    if (validExpected) {
      const expectedWasConfirmed = !ephemeralOnly && sameAnonymousDraftVersion(ephemeralDraft, validExpected);
      if (!expectedWasConfirmed) return { ok: false, reason: "unavailable", record: null };
      ephemeralBaseline = validExpected;
    } else {
      ephemeralBaseline = undefined;
    }
  }
  ephemeralDraft = record;
  ephemeralOnly = true;
  return { ok: false, reason: "unavailable", record };
}

export function updateAnonymousDraftStatus(storage, expected, status, nowMs = Date.now()) {
  if (!expected) return { ok: false, reason: "missing", record: null };
  return saveAnonymousDraft(storage, { ...expected, status }, expected, nowMs, { touch: false });
}

export function readAnonymousDraftContinuation(storage, projectCreationKey, nowMs = Date.now()) {
  const key = validCreationUuid(projectCreationKey);
  if (!key) return null;
  const current = readRecoverableAnonymousDraft(storage, nowMs);
  return current?.projectCreationKey === key ? current : null;
}

export function clearAnonymousDraft(storage, expected = null, nowMs = Date.now()) {
  const stored = rawStoredDraft(storage);
  const exactEphemeralExpected = Boolean(expected && ephemeralOnly && sameAnonymousDraftVersion(ephemeralDraft, expected));
  let removed = false;
  let removeFailed = Boolean(storage && !stored.available)
    || Boolean(!stored.available && expected && !(exactEphemeralExpected && ephemeralBaseline === undefined));
  let conflict = false;
  if (stored.available && stored.raw !== null) {
    const current = parseAnonymousDraftEnvelope(stored.raw, nowMs);
    const confirmedBaseline = exactEphemeralExpected && Boolean(
      ephemeralBaseline && sameAnonymousDraftVersion(current, ephemeralBaseline)
    );
    if (expected && !sameAnonymousDraftVersion(current, expected) && !confirmedBaseline) conflict = true;
    else {
      try {
        storage.removeItem(ANONYMOUS_DRAFT_STORAGE_KEY);
        const afterRemoval = rawStoredDraft(storage);
        if (!afterRemoval.available) removeFailed = true;
        else if (afterRemoval.raw === null) removed = true;
        else {
          const afterRecord = parseAnonymousDraftEnvelope(afterRemoval.raw, nowMs);
          if (expected && afterRecord && !sameAnonymousDraftVersion(afterRecord, expected)) conflict = true;
          else removeFailed = true;
        }
      } catch { removeFailed = true; }
    }
  }
  if (!conflict && !removeFailed && (!expected || sameAnonymousDraftVersion(ephemeralDraft, expected))) {
    ephemeralDraft = null;
    ephemeralOnly = false;
    ephemeralBaseline = undefined;
  }
  return {
    ok: !conflict && !removeFailed,
    removed,
    reason: conflict ? "conflict" : removeFailed ? "unavailable" : removed ? "cleared" : "absent",
  };
}

export function clearAnonymousDraftAfterCreation(storage, submitted, nowMs = Date.now()) {
  return clearAnonymousDraft(storage, submitted, nowMs);
}

export function clearEphemeralAnonymousDraft(projectCreationKey = null) {
  if (!projectCreationKey || ephemeralDraft?.projectCreationKey === projectCreationKey) {
    ephemeralDraft = null;
    ephemeralOnly = false;
    ephemeralBaseline = undefined;
  }
}

export function anonymousDraftExpiryLabel(envelope, locale = "en-IN") {
  if (!envelope) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(envelope.expiresAtMs));
}
