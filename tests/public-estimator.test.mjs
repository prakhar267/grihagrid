import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTIMATOR_CITIES,
  ESTIMATOR_ENTRY_POINTS,
  ESTIMATOR_FLOORS,
  ESTIMATOR_QUALITIES,
  buildSharedEstimatorPath,
  consumeEstimatorAttribution,
  consumeEstimatorHandoffPayload,
  consumePublicEstimatorAttribution,
  estimatorAttributionEntryPoint,
  estimatorAttributionHeaders,
  estimatorRequestKey,
  isPublicEstimatorAttribution,
  normalizePublicEstimateEnvelope,
  parseSharedEstimatorLocation,
  parseSharedEstimatorSearch,
  parseStoredEstimatorScenario,
  publicEstimatorAttributionHeaders,
  readStoredEstimatorScenario,
  safeSessionStorage,
  selectAuthProjectCreationKey,
  selectEstimatorScenario,
  storeEstimatorHandoff,
  validEstimatorEntryPoint,
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
  assert.deepEqual(ESTIMATOR_ENTRY_POINTS, ["public_estimator", "shared_estimate"]);
  assert.deepEqual(ESTIMATOR_FLOORS, ["G", "G+1", "G+2"]);
  assert.deepEqual(ESTIMATOR_QUALITIES, ["Essential", "Signature", "Premium", "Luxury"]);
  assert.equal(Object.isFrozen(ESTIMATOR_CITIES), true);
  assert.equal(Object.isFrozen(ESTIMATOR_ENTRY_POINTS), true);
  assert.equal(Object.isFrozen(ESTIMATOR_FLOORS), true);
  assert.equal(Object.isFrozen(ESTIMATOR_QUALITIES), true);
  assert.equal(validEstimatorEntryPoint("public_estimator"), "public_estimator");
  assert.equal(validEstimatorEntryPoint("shared_estimate"), "shared_estimate");
  for (const invalid of [null, undefined, "", "shared-estimate", "SHARED_ESTIMATE", new String("shared_estimate"), ["shared_estimate"]]) {
    assert.equal(validEstimatorEntryPoint(invalid), null);
  }
});

test("shared estimator paths are deterministic, versioned, and contain only the five public inputs", () => {
  const path = buildSharedEstimatorPath({
    ...puneRequest,
    address: "must-not-survive",
    projectId: "must-not-survive",
    accountId: "must-not-survive",
    estimate: { lowInr: 1, highInr: 2 },
    token: "must-not-survive",
  });
  assert.equal(
    path,
    "/estimate?v=1&width=30&length=50&city=Pune&floors=G%2B1&quality=Signature",
  );
  const url = new URL(path, "https://grihagrid.example");
  assert.deepEqual(
    [...url.searchParams.keys()],
    ["v", "width", "length", "city", "floors", "quality"],
  );
  assert.equal(url.origin, "https://grihagrid.example");
  assert.equal(url.pathname, "/estimate");
  assert.equal(url.hash, "");
  assert.equal(path.includes("must-not-survive"), false);
  assert.deepEqual(parseSharedEstimatorSearch(url.search), puneRequest);

  const decimal = { ...puneRequest, width: 30.5, length: 50.25, city: "Other", floors: "G+2", quality: "Luxury" };
  assert.deepEqual(
    parseSharedEstimatorSearch(new URL(buildSharedEstimatorPath(decimal), "https://grihagrid.example").search),
    decimal,
  );
  for (const invalid of [
    null,
    [],
    { ...puneRequest, width: "30" },
    { ...puneRequest, width: 9.99 },
    { ...puneRequest, city: "Kolkata" },
  ]) assert.throws(() => buildSharedEstimatorPath(invalid), /invalid estimator scenario/iu);
});

test("shared estimator parsing fails closed on missing, duplicate, unknown, malformed, and oversized parameters", () => {
  const valid = new URL(buildSharedEstimatorPath(puneRequest), "https://grihagrid.example").search;
  const fields = ["v", "width", "length", "city", "floors", "quality"];

  for (const field of fields) {
    const missing = new URLSearchParams(valid.slice(1));
    missing.delete(field);
    assert.equal(parseSharedEstimatorSearch(`?${missing}`), null, `missing ${field}`);

    const duplicate = new URLSearchParams(valid.slice(1));
    duplicate.append(field, duplicate.get(field));
    assert.equal(parseSharedEstimatorSearch(`?${duplicate}`), null, `duplicate ${field}`);
  }

  for (const suffix of [
    "&address=12+Private+Road",
    "&projectId=123e4567-e89b-42d3-a456-426614174000",
    "&account=owner%40example.test",
    "&token=secret",
    "&estimate%5BlowInr%5D=1",
    "&%77idth=31",
  ]) assert.equal(parseSharedEstimatorSearch(`${valid}${suffix}`), null, suffix);

  for (const malformed of [
    null,
    undefined,
    "",
    "?",
    valid.slice(1),
    "?v=2&width=30&length=50&city=Pune&floors=G%2B1&quality=Signature",
    "?v=%&width=30&length=50&city=Pune&floors=G%2B1&quality=Signature",
    "?v=1&width=30&length=50&city=%&floors=G%2B1&quality=Signature",
    "?v=1&width=30&length=50&city=Pune&floors=G+1&quality=Signature",
    `?${"x".repeat(512)}`,
  ]) assert.equal(parseSharedEstimatorSearch(malformed), null, String(malformed));
});

test("shared estimator dimensions require canonical decimal text and remain inside public bounds", () => {
  const withDimension = (field, value) => {
    const parameters = new URLSearchParams(new URL(buildSharedEstimatorPath(puneRequest), "https://grihagrid.example").search);
    parameters.set(field, value);
    return `?${parameters}`;
  };
  for (const field of ["width", "length"]) {
    for (const value of [
      "030",
      "30.0",
      "30.",
      ".30",
      "+30",
      "-30",
      "3e1",
      "0x1e",
      "NaN",
      "Infinity",
      " 30",
      "30 ",
      "9.999",
      "500.001",
      "1".repeat(33),
    ]) assert.equal(parseSharedEstimatorSearch(withDimension(field, value)), null, `${field}=${value}`);
    assert.equal(parseSharedEstimatorSearch(withDimension(field, "10"))?.[field], 10);
    assert.equal(parseSharedEstimatorSearch(withDimension(field, "500"))?.[field], 500);
    assert.equal(parseSharedEstimatorSearch(withDimension(field, "30.125"))?.[field], 30.125);
  }
});

test("valid noncanonical parameter ordering parses once and rebuilds to the canonical address", () => {
  const reordered = "?quality=Signature&floors=G%2B1&city=Pune&length=50&width=30&v=1";
  const parsed = parseSharedEstimatorSearch(reordered);
  assert.deepEqual(parsed, puneRequest);
  assert.equal(
    buildSharedEstimatorPath(parsed),
    "/estimate?v=1&width=30&length=50&city=Pune&floors=G%2B1&quality=Signature",
  );
  assert.deepEqual(parseSharedEstimatorLocation({ pathname: "/estimate", search: reordered, hash: "" }), puneRequest);
  for (const location of [
    null,
    { pathname: "/", search: reordered, hash: "" },
    { pathname: "/estimate/", search: reordered, hash: "" },
    { pathname: "/estimate", search: reordered, hash: "#private" },
    { pathname: "/estimate", search: "", hash: "" },
  ]) assert.equal(parseSharedEstimatorLocation(location), null);
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

test("scenario selection is bound to the current retry key and ignores stale handoffs", () => {
  const stale = { ...puneRequest, city: "Jaipur", quality: "Essential" };
  const current = { ...puneRequest, city: "Bengaluru", quality: "Premium" };
  const currentKey = "project-create-key-0001";
  const staleKey = "project-create-key-0002";
  const storage = {
    getItem(key) {
      if (key === "grihagrid.estimator") return JSON.stringify(stale);
      if (key === "grihagrid.estimatorCreationKey") return staleKey;
      return null;
    },
  };
  assert.deepEqual(selectEstimatorScenario(storage, {
    estimatorScenario: current,
    projectCreationKey: currentKey,
  }, currentKey), current);
  assert.deepEqual(selectEstimatorScenario(storage, {}, staleKey), stale);
  assert.equal(selectEstimatorScenario(storage, {}, currentKey), null);
  assert.equal(selectEstimatorScenario(storage, {}, null), null);
  assert.deepEqual(selectEstimatorScenario(storage, {
    estimatorScenario: current,
    projectCreationKey: currentKey,
  }, staleKey), stale);
});

test("auth retry-key recovery requires an explicit continuation", () => {
  const key = "project-create-key-0001";
  const storage = {
    getItem(storageKey) {
      if (storageKey === "grihagrid.projectCreationKey") return key;
      return null;
    },
  };
  assert.equal(selectAuthProjectCreationKey(storage, {}), null);
  assert.equal(selectAuthProjectCreationKey(storage, { projectContinuation: true }), key);
  assert.equal(selectAuthProjectCreationKey(storage, {
    projectContinuation: true,
    projectCreationKey: "navigation-project-key-0002",
    estimatorSource: "shared_estimate",
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

test("the first anonymous envelope consumes every estimator payload source", () => {
  const values = new Map([
    ["grihagrid.estimator", JSON.stringify(puneRequest)],
    ["grihagrid.estimatorSource", "public_estimator"],
    ["grihagrid.estimatorCreationKey", "project-create-key-0001"],
  ]);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
  };
  const consumed = consumeEstimatorHandoffPayload(storage, {
    projectCreationKey: "project-create-key-0001",
    estimatorSource: "public_estimator",
    estimatorScenario: puneRequest,
  });
  assert.equal(consumed.attributed, true);
  assert.deepEqual(consumed.navigationState, {
    projectCreationKey: "project-create-key-0001",
    estimatorSource: "public_estimator",
  });
  assert.equal(selectEstimatorScenario(
    storage,
    consumed.navigationState,
    consumed.navigationState.projectCreationKey,
  ), null);
  assert.equal(values.size, 0);
});

test("shared-estimate handoff stores only the tuple, source, and exact retry key", () => {
  const projectCreationKey = "project-create-key-0001";
  const values = new Map([["unrelated", "preserve"]]);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  assert.equal(storeEstimatorHandoff(storage, {
    ...puneRequest,
    address: "must-not-survive",
    accountId: "must-not-survive",
    estimate: { lowInr: 1, highInr: 2 },
    token: "must-not-survive",
  }, projectCreationKey, "shared_estimate"), true);
  assert.deepEqual([...values.keys()].sort(), [
    "grihagrid.estimator",
    "grihagrid.estimatorCreationKey",
    "grihagrid.estimatorSource",
    "unrelated",
  ]);
  assert.deepEqual(JSON.parse(values.get("grihagrid.estimator")), puneRequest);
  assert.equal(values.get("grihagrid.estimatorSource"), "shared_estimate");
  assert.equal(values.get("grihagrid.estimatorCreationKey"), projectCreationKey);
  assert.equal(JSON.stringify([...values]).includes("must-not-survive"), false);
  assert.equal(estimatorAttributionEntryPoint(storage, {}, projectCreationKey), "shared_estimate");
  assert.deepEqual(estimatorAttributionHeaders(storage, {}, projectCreationKey), {
    "x-grihagrid-entry-point": "shared_estimate",
  });
  assert.equal(isPublicEstimatorAttribution(storage, {}, projectCreationKey), false);

  const consumed = consumeEstimatorHandoffPayload(storage, {
    projectContinuation: true,
    projectCreationKey,
    estimatorSource: "shared_estimate",
    estimatorScenario: puneRequest,
    anonymousDraftWriteId: "123e4567-e89b-42d3-a456-426614174001",
    anonymousDraftRevision: 2,
  });
  assert.deepEqual(consumed, {
    attributed: true,
    entryPoint: "shared_estimate",
    navigationState: {
      projectContinuation: true,
      projectCreationKey,
      estimatorSource: "shared_estimate",
      anonymousDraftWriteId: "123e4567-e89b-42d3-a456-426614174001",
      anonymousDraftRevision: 2,
    },
  });
  assert.equal(values.get("grihagrid.estimator"), undefined);
  assert.equal(values.get("grihagrid.estimatorSource"), undefined);
  assert.equal(values.get("grihagrid.estimatorCreationKey"), undefined);
  assert.equal(values.get("unrelated"), "preserve");
  assert.equal(estimatorAttributionEntryPoint(storage, {}, projectCreationKey), null);
  assert.deepEqual(estimatorAttributionHeaders(storage, {}, projectCreationKey), {});
});

test("shared-estimate attribution uses exact key-bound storage and a bounded navigation fallback", () => {
  const key = "project-create-key-0001";
  const otherKey = "project-create-key-0002";
  const values = new Map([
    ["grihagrid.estimator", JSON.stringify(puneRequest)],
    ["grihagrid.estimatorSource", "shared_estimate"],
    ["grihagrid.estimatorCreationKey", key],
  ]);
  const storage = {
    getItem(storageKey) { return values.get(storageKey) ?? null; },
    removeItem(storageKey) { values.delete(storageKey); },
  };
  assert.equal(estimatorAttributionEntryPoint(storage, {
    estimatorSource: "public_estimator",
    projectCreationKey: key,
  }, key), "shared_estimate", "the exact stored handoff wins over conflicting navigation state");
  assert.equal(estimatorAttributionEntryPoint(storage, {}, otherKey), null);
  assert.deepEqual(estimatorAttributionHeaders(storage, {}, otherKey), {});

  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  const navigation = { estimatorSource: "shared_estimate", projectCreationKey: key };
  assert.equal(estimatorAttributionEntryPoint(blocked, navigation, key), "shared_estimate");
  assert.deepEqual(estimatorAttributionHeaders(blocked, navigation, key), {
    "x-grihagrid-entry-point": "shared_estimate",
  });
  assert.equal(estimatorAttributionEntryPoint(blocked, navigation, otherKey), null);
  assert.equal(estimatorAttributionEntryPoint(blocked, { ...navigation, estimatorSource: "forged" }, key), null);
  assert.equal(storeEstimatorHandoff(blocked, puneRequest, key, "shared_estimate"), false);
});

test("unknown estimator sources never persist, attribute, or survive one-time consumption", () => {
  const key = "project-create-key-0001";
  const storage = {
    values: new Map([["unrelated", "preserve"]]),
    getItem(storageKey) { return this.values.get(storageKey) ?? null; },
    setItem(storageKey, value) { this.values.set(storageKey, String(value)); },
    removeItem(storageKey) { this.values.delete(storageKey); },
  };
  for (const source of [null, "", "shared-estimate", "forged", { value: "shared_estimate" }]) {
    assert.equal(storeEstimatorHandoff(storage, puneRequest, key, source), false);
    assert.deepEqual([...storage.values], [["unrelated", "preserve"]]);
    assert.equal(estimatorAttributionEntryPoint(storage, { estimatorSource: source, projectCreationKey: key }, key), null);
  }

  storage.values.set("grihagrid.estimator", JSON.stringify(puneRequest));
  storage.values.set("grihagrid.estimatorSource", "shared_estimate");
  storage.values.set("grihagrid.estimatorCreationKey", key);
  assert.equal(consumeEstimatorAttribution(storage), "shared_estimate");
  assert.equal(consumeEstimatorAttribution(storage), null);
  assert.deepEqual([...storage.values], [["unrelated", "preserve"]]);
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
