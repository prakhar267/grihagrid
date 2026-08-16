import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTIMATOR_CITIES,
  ESTIMATOR_FLOORS,
  ESTIMATOR_QUALITIES,
  consumePublicEstimatorAttribution,
  estimatorAuthContinuationState,
  estimatorRequestKey,
  isPublicEstimatorAttribution,
  normalizePublicEstimateEnvelope,
  parsePendingProjectDraft,
  parseStoredEstimatorScenario,
  publicEstimatorAttributionHeaders,
  readStoredEstimatorScenario,
  safeSessionStorage,
  selectAuthPendingProjectDraft,
  selectAuthProjectCreationKey,
  selectEstimatorScenario,
  selectPendingProjectDraft,
  storeEstimatorHandoff,
  validProjectCreationKey,
  validateEstimatorScenario,
} from "../src/public-estimator.js";

const puneRequest = Object.freeze({
  width: 30,
  length: 50,
  city: "Pune",
  floors: "G+1",
  quality: "Signature",
});

function validEnvelope(input = puneRequest) {
  return {
    input: { ...input },
    estimate: {
      plotSqft: 1500,
      builtUpSqft: 1830,
      lowInr: 3703920,
      highInr: 4428600,
      floors: input.floors,
      quality: input.quality,
      city: input.city,
      disclaimer: "Indicative concept-stage estimate; not a contractor quote.",
    },
    basis: {
      ruleVersion: 1,
      rulePublishedDate: "2026-08-16",
      benchmarkStatus: "internal_directional_rule",
      marketBenchmarkAsOf: null,
      marketWarning: "Internal planning assumptions are not independently calibrated to current local quotes.",
      currency: "INR",
      confidence: "directional",
      areaMethod: "Plot area × floor-programme factor",
      costMethod: "Likely built-up area × internal finish benchmark × city factor",
      floorFactor: 1.22,
      finishRateInrPerSqft: 2200,
      cityFactor: 1,
      lowFactor: 0.92,
      highFactor: 1.1,
      taxesAndStatutoryFees: "excluded",
      exclusions: [
        "Land purchase and finance costs",
        "Taxes, statutory fees, utility connections, and municipal charges",
      ],
    },
  };
}

test("estimator options expose the complete supported public tuple", () => {
  assert.deepEqual(ESTIMATOR_CITIES, ["Pune", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Jaipur", "Other"]);
  assert.deepEqual(ESTIMATOR_FLOORS, ["G", "G+1", "G+2"]);
  assert.deepEqual(ESTIMATOR_QUALITIES, ["Essential", "Signature", "Premium", "Luxury"]);
  assert.equal(Object.isFrozen(ESTIMATOR_CITIES), true);
  assert.equal(Object.isFrozen(ESTIMATOR_FLOORS), true);
  assert.equal(Object.isFrozen(ESTIMATOR_QUALITIES), true);
});

test("scenario validation accepts inclusive dimension bounds and returns an allowlisted request", () => {
  const lower = validateEstimatorScenario({ ...puneRequest, width: 10, length: 10, ignored: "not returned" });
  const upper = validateEstimatorScenario({ ...puneRequest, width: 500, length: 500 });
  assert.equal(lower.valid, true);
  assert.deepEqual(lower.request, { ...puneRequest, width: 10, length: 10 });
  assert.deepEqual(lower.errors, {});
  assert.equal(upper.valid, true);
});

test("scenario validation rejects missing, non-primitive, non-finite, out-of-range, and invalid enum values", () => {
  for (const invalid of [null, undefined, "", [], 30]) {
    const result = validateEstimatorScenario(invalid);
    assert.equal(result.valid, false);
    assert.equal(result.request, null);
    assert.ok(result.errors.scenario);
  }

  for (const [field, value] of [
    ["width", 9.99],
    ["width", 500.01],
    ["width", "30"],
    ["width", new Number(30)],
    ["width", Number.NaN],
    ["length", Number.POSITIVE_INFINITY],
    ["length", null],
    ["city", "Kolkata"],
    ["city", ["Pune"]],
    ["floors", "2"],
    ["floors", { value: "G+1" }],
    ["quality", "Standard"],
    ["quality", ""],
  ]) {
    const result = validateEstimatorScenario({ ...puneRequest, [field]: value });
    assert.equal(result.valid, false, `${field}=${String(value)} should be invalid`);
    assert.equal(result.request, null);
    assert.ok(result.errors[field]);
  }
});

test("request keys are stable for the normalized tuple and change with any request field", () => {
  const reordered = { quality: "Signature", ignored: true, floors: "G+1", city: "Pune", length: 50, width: 30 };
  assert.equal(estimatorRequestKey(puneRequest), estimatorRequestKey(reordered));
  for (const changed of [
    { ...puneRequest, width: 31 },
    { ...puneRequest, length: 51 },
    { ...puneRequest, city: "Jaipur" },
    { ...puneRequest, floors: "G+2" },
    { ...puneRequest, quality: "Premium" },
  ]) assert.notEqual(estimatorRequestKey(puneRequest), estimatorRequestKey(changed));
  assert.throws(() => estimatorRequestKey({ ...puneRequest, width: "30" }), /Invalid estimator scenario/u);
});

test("stored estimator parsing returns only allowlisted valid fields", () => {
  const stored = JSON.stringify({
    accountId: "must-not-survive",
    projectId: "must-not-survive",
    address: "must-not-survive",
    ...puneRequest,
    nested: { token: "must-not-survive" },
  });
  const parsed = parseStoredEstimatorScenario(stored);
  assert.deepEqual(parsed, puneRequest);
  assert.deepEqual(Object.keys(parsed), ["width", "length", "city", "floors", "quality"]);
  assert.equal(JSON.stringify(parsed).includes("must-not-survive"), false);

  assert.deepEqual(parseStoredEstimatorScenario({ ...puneRequest, secret: "discard" }), puneRequest);
  for (const invalid of ["", "not-json", "[]", "null", JSON.stringify({ ...puneRequest, width: "30" }), JSON.stringify({ width: 30 })]) {
    assert.equal(parseStoredEstimatorScenario(invalid), null);
  }
});

test("current navigation state wins over stale readable storage", () => {
  const stale = { ...puneRequest, city: "Jaipur", quality: "Essential" };
  const current = { ...puneRequest, city: "Bengaluru", quality: "Premium" };
  const stalePending = { name: "Stale brief", ...stale };
  const currentPending = { name: "Current brief", ...current };
  const storage = {
    getItem(key) {
      if (key === "grihagrid.estimator") return JSON.stringify(stale);
      if (key === "grihagrid.pendingProject") return JSON.stringify(stalePending);
      return null;
    },
  };
  assert.deepEqual(selectEstimatorScenario(storage, { estimatorScenario: current }), current);
  assert.deepEqual(selectPendingProjectDraft(storage, { pendingProject: currentPending }), currentPending);
  assert.deepEqual(selectEstimatorScenario(storage, {}), stale);
  assert.deepEqual(selectPendingProjectDraft(storage, {}), stalePending);
});

test("auth recovery requires an explicit continuation and ignores abandoned storage", () => {
  const key = "project-create-key-0001";
  const pending = { name: "Pending brief", ...puneRequest };
  const storage = {
    getItem(storageKey) {
      if (storageKey === "grihagrid.pendingProject") return JSON.stringify(pending);
      if (storageKey === "grihagrid.projectCreationKey") return key;
      return null;
    },
  };
  assert.equal(selectAuthPendingProjectDraft(storage, {}), null);
  assert.equal(selectAuthProjectCreationKey(storage, {}), null);
  assert.deepEqual(selectAuthPendingProjectDraft(storage, { projectContinuation: true }), pending);
  assert.equal(selectAuthProjectCreationKey(storage, { projectContinuation: true }), key);
  assert.equal(selectAuthProjectCreationKey(storage, {
    projectContinuation: true,
    projectCreationKey: "navigation-project-key-0002",
  }), "navigation-project-key-0002");
});

test("estimator attribution is consumed once and storage failures cannot break project success", () => {
  const values = new Map([
    ["grihagrid.estimator", JSON.stringify(puneRequest)],
    ["grihagrid.estimatorSource", "public_estimator"],
    ["grihagrid.estimatorCreationKey", "project-create-key-0001"],
    ["unrelated", "preserved"],
  ]);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
  };
  assert.equal(consumePublicEstimatorAttribution(storage), true);
  assert.equal(values.has("grihagrid.estimator"), false);
  assert.equal(values.has("grihagrid.estimatorSource"), false);
  assert.equal(values.has("grihagrid.estimatorCreationKey"), false);
  assert.equal(values.get("unrelated"), "preserved");
  assert.equal(consumePublicEstimatorAttribution(storage), false);

  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  assert.equal(consumePublicEstimatorAttribution(blocked), false);
});

test("estimator handoff survives blocked storage through bounded navigation state", () => {
  const projectCreationKey = "project-create-key-0001";
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  assert.equal(storeEstimatorHandoff(storage, puneRequest, projectCreationKey), true);
  assert.deepEqual(readStoredEstimatorScenario(storage), puneRequest);
  assert.equal(isPublicEstimatorAttribution(storage, {}, projectCreationKey), true);
  assert.deepEqual(publicEstimatorAttributionHeaders(storage, {}, projectCreationKey), {
    "x-grihagrid-entry-point": "public_estimator",
  });

  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  assert.equal(storeEstimatorHandoff(blocked, puneRequest, projectCreationKey), false);
  assert.equal(readStoredEstimatorScenario(blocked), null);
  const navigationState = { estimatorScenario: puneRequest, estimatorSource: "public_estimator", projectCreationKey };
  assert.equal(isPublicEstimatorAttribution(blocked, navigationState, projectCreationKey), true);
  assert.deepEqual(publicEstimatorAttributionHeaders(blocked, navigationState, projectCreationKey), {
    "x-grihagrid-entry-point": "public_estimator",
  });
  assert.equal(isPublicEstimatorAttribution(blocked, { estimatorSource: "forged-other", projectCreationKey }, projectCreationKey), false);
  assert.equal(isPublicEstimatorAttribution(storage, {}, "different-project-key"), false);
  assert.deepEqual(publicEstimatorAttributionHeaders(blocked, {}, projectCreationKey), {});
  assert.equal(storeEstimatorHandoff(storage, { ...puneRequest, width: 2 }, projectCreationKey), false);
  assert.equal(storeEstimatorHandoff(storage, puneRequest, "bad key!"), false);
});

test("account-mode switches preserve only the pending project and estimator attribution fallback", () => {
  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  const pendingProject = { name: "Pending brief", ...puneRequest, privateServerField: "must-not-survive" };
  const sanitizedProject = { name: "Pending brief", ...puneRequest };
  const projectCreationKey = "project-create-key-0001";
  const continuation = estimatorAuthContinuationState(
    blocked,
    {
      pendingProject,
      estimatorSource: "public_estimator",
      estimatorScenario: puneRequest,
      projectCreationKey,
      token: "must-not-survive",
    },
    pendingProject,
    projectCreationKey,
  );
  assert.deepEqual(continuation, {
    projectContinuation: true,
    pendingProject: sanitizedProject,
    estimatorSource: "public_estimator",
    projectCreationKey,
  });
  assert.deepEqual(estimatorAuthContinuationState(blocked, { estimatorSource: "forged" }, pendingProject, "bad key!"), {
    projectContinuation: true,
    pendingProject: sanitizedProject,
  });
  assert.deepEqual(estimatorAuthContinuationState(blocked, { estimatorSource: "public_estimator" }, null), {});
  assert.deepEqual(parsePendingProjectDraft(JSON.stringify(pendingProject)), sanitizedProject);
  assert.equal(JSON.stringify(continuation).includes("must-not-survive"), false);
  assert.equal(validProjectCreationKey(projectCreationKey), projectCreationKey);
  assert.equal(validProjectCreationKey("bad key!"), null);
});

test("pending project recovery rejects nested private values and drops unknown fields", () => {
  assert.equal(parsePendingProjectDraft({ ...puneRequest, name: { token: "secret" } }), null);
  assert.equal(parsePendingProjectDraft({ ...puneRequest, style: { token: "secret" } }), null);
  assert.deepEqual(
    parsePendingProjectDraft({ ...puneRequest, name: "Safe project", nested: { token: "secret" } }),
    { name: "Safe project", ...puneRequest },
  );
});

test("a throwing browser storage getter degrades to the bounded navigation fallback", () => {
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "sessionStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  assert.equal(safeSessionStorage(blockedWindow), null);
  assert.equal(isPublicEstimatorAttribution(
    safeSessionStorage(blockedWindow),
    { estimatorSource: "public_estimator", projectCreationKey: "project-create-key-0001" },
    "project-create-key-0001",
  ), true);
});

test("response normalization rejects a stale A response after request B", () => {
  const requestB = { ...puneRequest, quality: "Premium" };
  assert.throws(
    () => normalizePublicEstimateEnvelope(validEnvelope(puneRequest), requestB),
    /does not match the latest request/u,
  );
});

test("response normalization rejects malformed or unsafe numeric output", () => {
  const extraField = validEnvelope();
  extraField.estimate.internalRateSource = "must-not-survive";
  assert.throws(() => normalizePublicEstimateEnvelope(extraField, puneRequest), /unexpected shape/u);

  for (const [field, value] of [
    ["plotSqft", Number.NaN],
    ["builtUpSqft", Number.POSITIVE_INFINITY],
    ["lowInr", -1],
    ["highInr", "4428600"],
  ]) {
    const envelope = validEnvelope();
    envelope.estimate[field] = value;
    assert.throws(
      () => normalizePublicEstimateEnvelope(envelope, puneRequest),
      new RegExp(`estimate\\.${field}`, "u"),
    );
  }

  const inverted = validEnvelope();
  inverted.estimate.lowInr = inverted.estimate.highInr + 1;
  assert.throws(() => normalizePublicEstimateEnvelope(inverted, puneRequest), /must not exceed/u);

  const missingDisclaimer = validEnvelope();
  delete missingDisclaimer.estimate.disclaimer;
  assert.throws(() => normalizePublicEstimateEnvelope(missingDisclaimer, puneRequest), /unexpected shape/u);

  for (const disclaimer of ["", "   ", ["Indicative"]]) {
    const envelope = validEnvelope();
    envelope.estimate.disclaimer = disclaimer;
    assert.throws(() => normalizePublicEstimateEnvelope(envelope, puneRequest), /estimate\.disclaimer/u);
  }

  const duplicateMismatch = validEnvelope();
  duplicateMismatch.estimate.quality = "Premium";
  assert.throws(() => normalizePublicEstimateEnvelope(duplicateMismatch, puneRequest), /does not match input/u);
});

test("response normalization rejects malformed basis metadata", () => {
  const cases = [
    (basis) => { delete basis.ruleVersion; },
    (basis) => { basis.unknown = true; },
    (basis) => { basis.ruleVersion = 0; },
    (basis) => { basis.rulePublishedDate = "2026-8-16"; },
    (basis) => { basis.rulePublishedDate = "2026-02-30"; },
    (basis) => { basis.benchmarkStatus = "current_market_data"; },
    (basis) => { basis.marketBenchmarkAsOf = "2026-08-16"; },
    (basis) => { basis.marketWarning = ""; },
    (basis) => { basis.currency = "USD"; },
    (basis) => { basis.confidence = "guaranteed"; },
    (basis) => { basis.areaMethod = ""; },
    (basis) => { basis.costMethod = ["method"]; },
    (basis) => { basis.floorFactor = 0; },
    (basis) => { basis.finishRateInrPerSqft = Number.NaN; },
    (basis) => { basis.cityFactor = -1; },
    (basis) => { basis.lowFactor = 1.1; basis.highFactor = 1.1; },
    (basis) => { basis.taxesAndStatutoryFees = "included"; },
    (basis) => { basis.exclusions = []; },
    (basis) => { basis.exclusions = Array.from({ length: 9 }, (_, index) => `Exclusion ${index}`); },
    (basis) => { basis.exclusions = [""]; },
    (basis) => { basis.exclusions = ["x".repeat(241)]; },
  ];
  for (const mutate of cases) {
    const envelope = validEnvelope();
    mutate(envelope.basis);
    assert.throws(() => normalizePublicEstimateEnvelope(envelope, puneRequest), /Invalid public estimate response/u);
  }
});

test("response normalization reconciles every displayed number with the tuple and returned basis", () => {
  for (const [field, delta] of [
    ["plotSqft", 1],
    ["builtUpSqft", 1],
    ["lowInr", 1],
    ["highInr", 1],
  ]) {
    const envelope = validEnvelope();
    envelope.estimate[field] += delta;
    assert.throws(
      () => normalizePublicEstimateEnvelope(envelope, puneRequest),
      new RegExp(`estimate\\.${field} does not reconcile`, "u"),
    );
  }

  const mismatchedFactor = validEnvelope();
  mismatchedFactor.basis.floorFactor = 1.23;
  assert.throws(
    () => normalizePublicEstimateEnvelope(mismatchedFactor, puneRequest),
    /estimate\.builtUpSqft does not reconcile/u,
  );
});

test("a valid Pune envelope is normalized to the strict public contract", () => {
  const envelope = validEnvelope();
  const normalized = normalizePublicEstimateEnvelope(envelope, puneRequest);
  assert.deepEqual(normalized, envelope);
  assert.notEqual(normalized, envelope);
  assert.notEqual(normalized.input, envelope.input);
  assert.notEqual(normalized.estimate, envelope.estimate);
  assert.notEqual(normalized.basis, envelope.basis);
  assert.notEqual(normalized.basis.exclusions, envelope.basis.exclusions);
});
