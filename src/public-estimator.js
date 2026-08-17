export const ESTIMATOR_CITIES = Object.freeze([
  "Pune",
  "Bengaluru",
  "Mumbai",
  "Delhi",
  "Hyderabad",
  "Chennai",
  "Jaipur",
  "Other",
]);

export const ESTIMATOR_FLOORS = Object.freeze(["G", "G+1", "G+2"]);
export const ESTIMATOR_QUALITIES = Object.freeze(["Essential", "Signature", "Premium", "Luxury"]);
export const ESTIMATOR_ENTRY_POINTS = Object.freeze(["public_estimator", "shared_estimate"]);

const ESTIMATOR_FIELDS = Object.freeze(["width", "length", "city", "floors", "quality"]);
const SHARED_ESTIMATOR_VERSION = "1";
const SHARED_ESTIMATOR_FIELDS = Object.freeze(["v", ...ESTIMATOR_FIELDS]);
const MAX_SHARED_ESTIMATOR_SEARCH_LENGTH = 512;
const ENVELOPE_FIELDS = Object.freeze(["input", "estimate", "basis"]);
const BASIS_FIELDS = Object.freeze([
  "ruleVersion",
  "rulePublishedDate",
  "benchmarkStatus",
  "marketBenchmarkAsOf",
  "marketWarning",
  "currency",
  "confidence",
  "areaMethod",
  "costMethod",
  "floorFactor",
  "finishRateInrPerSqft",
  "cityFactor",
  "lowFactor",
  "highFactor",
  "taxesAndStatutoryFees",
  "exclusions",
]);
const ESTIMATE_NUMERIC_FIELDS = Object.freeze(["plotSqft", "builtUpSqft", "lowInr", "highInr"]);
const ESTIMATE_FIELDS = Object.freeze([
  ...ESTIMATE_NUMERIC_FIELDS,
  "floors",
  "quality",
  "city",
  "disclaimer",
]);
const MAX_BASIS_METHOD_LENGTH = 240;
const MAX_DISCLAIMER_LENGTH = 500;
const MAX_EXCLUSION_LENGTH = 240;
const PROJECT_CREATION_KEY_PATTERN = /^[A-Za-z0-9._:~-]{8,128}$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactOwnKeys(value, fields) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function enumError(value, options, label) {
  if (typeof value !== "string" || !options.includes(value)) {
    return `Choose a supported ${label}.`;
  }
  return null;
}

function dimensionError(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${label} must be a number.`;
  }
  if (value < 10 || value > 500) {
    return `${label} must be between 10 and 500 feet.`;
  }
  return null;
}

export function validateEstimatorScenario(value) {
  if (!isRecord(value)) {
    return {
      valid: false,
      request: null,
      errors: { scenario: "Enter a valid estimator scenario." },
    };
  }

  const errors = {};
  const widthError = dimensionError(value.width, "Plot width");
  const lengthError = dimensionError(value.length, "Plot length");
  const cityError = enumError(value.city, ESTIMATOR_CITIES, "city");
  const floorsError = enumError(value.floors, ESTIMATOR_FLOORS, "floor programme");
  const qualityError = enumError(value.quality, ESTIMATOR_QUALITIES, "finish");
  if (widthError) errors.width = widthError;
  if (lengthError) errors.length = lengthError;
  if (cityError) errors.city = cityError;
  if (floorsError) errors.floors = floorsError;
  if (qualityError) errors.quality = qualityError;

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    request: valid ? {
      width: value.width,
      length: value.length,
      city: value.city,
      floors: value.floors,
      quality: value.quality,
    } : null,
    errors,
  };
}

export function validEstimatorEntryPoint(value) {
  return typeof value === "string" && ESTIMATOR_ENTRY_POINTS.includes(value) ? value : null;
}

function canonicalSharedDimension(value) {
  if (typeof value !== "string" || value.length > 32
      || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(numeric) === value ? numeric : null;
}

export function buildSharedEstimatorPath(value) {
  const result = validateEstimatorScenario(value);
  if (!result.valid) throw new TypeError("Cannot share an invalid estimator scenario.");
  const parameters = new URLSearchParams();
  parameters.set("v", SHARED_ESTIMATOR_VERSION);
  for (const field of ESTIMATOR_FIELDS) parameters.set(field, String(result.request[field]));
  return `/estimate?${parameters.toString()}`;
}

export function parseSharedEstimatorSearch(value) {
  if (typeof value !== "string" || !value.startsWith("?")
      || value.length < 2 || value.length > MAX_SHARED_ESTIMATOR_SEARCH_LENGTH) return null;
  const parameters = new URLSearchParams(value.slice(1));
  const entries = [...parameters.entries()];
  if (entries.length !== SHARED_ESTIMATOR_FIELDS.length
      || SHARED_ESTIMATOR_FIELDS.some((field) => parameters.getAll(field).length !== 1)
      || entries.some(([field]) => !SHARED_ESTIMATOR_FIELDS.includes(field))
      || parameters.get("v") !== SHARED_ESTIMATOR_VERSION) return null;
  const width = canonicalSharedDimension(parameters.get("width"));
  const length = canonicalSharedDimension(parameters.get("length"));
  if (width == null || length == null) return null;
  const result = validateEstimatorScenario({
    width,
    length,
    city: parameters.get("city"),
    floors: parameters.get("floors"),
    quality: parameters.get("quality"),
  });
  return result.valid ? result.request : null;
}

export function parseSharedEstimatorLocation(location) {
  if (!location || location.pathname !== "/estimate" || location.hash) return null;
  return parseSharedEstimatorSearch(location.search);
}

export function estimatorRequestKey(value) {
  const result = validateEstimatorScenario(value);
  if (!result.valid) {
    throw new TypeError(`Invalid estimator scenario: ${Object.keys(result.errors).join(", ")}`);
  }
  const { width, length, city, floors, quality } = result.request;
  return JSON.stringify([width, length, city, floors, quality]);
}

export function parseStoredEstimatorScenario(value) {
  let parsed = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  const allowlisted = Object.fromEntries(
    ESTIMATOR_FIELDS.filter((field) => Object.hasOwn(parsed, field)).map((field) => [field, parsed[field]]),
  );
  const result = validateEstimatorScenario(allowlisted);
  return result.valid ? result.request : null;
}

export function readStoredEstimatorScenario(storage) {
  try {
    return parseStoredEstimatorScenario(storage?.getItem("grihagrid.estimator"));
  } catch {
    return null;
  }
}

export function selectEstimatorScenario(storage, navigationState, projectCreationKey) {
  const creationKey = validProjectCreationKey(projectCreationKey);
  if (!creationKey) return null;
  const navigationScenario = navigationState?.projectCreationKey === creationKey
    ? parseStoredEstimatorScenario(navigationState?.estimatorScenario)
    : null;
  if (navigationScenario) return navigationScenario;
  try {
    if (storage?.getItem("grihagrid.estimatorCreationKey") !== creationKey) return null;
  } catch {
    return null;
  }
  return readStoredEstimatorScenario(storage);
}

export function validProjectCreationKey(value) {
  return typeof value === "string" && PROJECT_CREATION_KEY_PATTERN.test(value) ? value : null;
}

export function selectAuthProjectCreationKey(storage, navigationState) {
  if (navigationState?.projectContinuation !== true) return null;
  const navigated = validProjectCreationKey(navigationState?.projectCreationKey);
  if (navigated) return navigated;
  try {
    return validProjectCreationKey(storage?.getItem("grihagrid.projectCreationKey"));
  } catch {
    return null;
  }
}

export function storeEstimatorHandoff(storage, scenario, projectCreationKey, entryPoint = "public_estimator") {
  const result = validateEstimatorScenario(scenario);
  const creationKey = validProjectCreationKey(projectCreationKey);
  const source = validEstimatorEntryPoint(entryPoint);
  if (!result.valid || !creationKey || !source) return false;
  try {
    storage?.setItem("grihagrid.estimator", JSON.stringify(result.request));
    storage?.setItem("grihagrid.estimatorSource", source);
    storage?.setItem("grihagrid.estimatorCreationKey", creationKey);
    return true;
  } catch {
    return false;
  }
}

export function estimatorAttributionEntryPoint(storage, navigationState, projectCreationKey) {
  const creationKey = validProjectCreationKey(projectCreationKey);
  if (!creationKey) return null;
  try {
    const storedSource = validEstimatorEntryPoint(storage?.getItem("grihagrid.estimatorSource"));
    if (storedSource && storage?.getItem("grihagrid.estimatorCreationKey") === creationKey) return storedSource;
  } catch {
    // Blocked browser storage falls back to same-tab navigation state.
  }
  const navigationSource = validEstimatorEntryPoint(navigationState?.estimatorSource);
  return navigationSource && navigationState?.projectCreationKey === creationKey ? navigationSource : null;
}

export function isPublicEstimatorAttribution(storage, navigationState, projectCreationKey) {
  return estimatorAttributionEntryPoint(storage, navigationState, projectCreationKey) === "public_estimator";
}

export function safeSessionStorage(windowObject = globalThis.window) {
  try {
    return windowObject?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function estimatorAttributionHeaders(storage, navigationState, projectCreationKey) {
  const entryPoint = estimatorAttributionEntryPoint(storage, navigationState, projectCreationKey);
  return entryPoint ? { "x-grihagrid-entry-point": entryPoint } : {};
}

export function publicEstimatorAttributionHeaders(storage, navigationState, projectCreationKey) {
  return isPublicEstimatorAttribution(storage, navigationState, projectCreationKey)
    ? { "x-grihagrid-entry-point": "public_estimator" }
    : {};
}

export function consumeEstimatorAttribution(storage) {
  try {
    const entryPoint = validEstimatorEntryPoint(storage?.getItem("grihagrid.estimatorSource"));
    storage?.removeItem("grihagrid.estimator");
    storage?.removeItem("grihagrid.estimatorSource");
    storage?.removeItem("grihagrid.estimatorCreationKey");
    return entryPoint;
  } catch {
    return null;
  }
}

export function consumePublicEstimatorAttribution(storage) {
  return consumeEstimatorAttribution(storage) === "public_estimator";
}

export function consumeEstimatorHandoffPayload(storage, navigationState) {
  const entryPoint = consumeEstimatorAttribution(storage);
  const next = isRecord(navigationState) ? { ...navigationState } : {};
  delete next.estimatorScenario;
  return { attributed: Boolean(entryPoint), entryPoint, navigationState: next };
}

function contractError(message) {
  return new TypeError(`Invalid public estimate response: ${message}`);
}

function normalizedNonEmptyString(value, field, maximumLength) {
  if (typeof value !== "string") throw contractError(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw contractError(`${field} must contain 1 to ${maximumLength} characters`);
  }
  return normalized;
}

function positiveFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw contractError(`${field} must be a positive finite number`);
  }
  return value;
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeBasis(value) {
  if (!hasExactOwnKeys(value, BASIS_FIELDS)) throw contractError("basis has an unexpected shape");
  if (!Number.isInteger(value.ruleVersion) || value.ruleVersion < 1) {
    throw contractError("basis.ruleVersion must be a positive integer");
  }
  if (!validIsoDate(value.rulePublishedDate)) {
    throw contractError("basis.rulePublishedDate must be a valid YYYY-MM-DD date");
  }
  if (value.benchmarkStatus !== "internal_directional_rule") {
    throw contractError("basis.benchmarkStatus must be internal_directional_rule");
  }
  if (value.marketBenchmarkAsOf !== null) {
    throw contractError("basis.marketBenchmarkAsOf must be null until independently calibrated");
  }
  const marketWarning = normalizedNonEmptyString(value.marketWarning, "basis.marketWarning", MAX_DISCLAIMER_LENGTH);
  if (value.currency !== "INR") throw contractError("basis.currency must be INR");
  if (value.confidence !== "directional") throw contractError("basis.confidence must be directional");
  if (value.taxesAndStatutoryFees !== "excluded") {
    throw contractError("basis.taxesAndStatutoryFees must be excluded");
  }

  const areaMethod = normalizedNonEmptyString(value.areaMethod, "basis.areaMethod", MAX_BASIS_METHOD_LENGTH);
  const costMethod = normalizedNonEmptyString(value.costMethod, "basis.costMethod", MAX_BASIS_METHOD_LENGTH);
  const floorFactor = positiveFiniteNumber(value.floorFactor, "basis.floorFactor");
  const finishRateInrPerSqft = positiveFiniteNumber(value.finishRateInrPerSqft, "basis.finishRateInrPerSqft");
  const cityFactor = positiveFiniteNumber(value.cityFactor, "basis.cityFactor");
  const lowFactor = positiveFiniteNumber(value.lowFactor, "basis.lowFactor");
  const highFactor = positiveFiniteNumber(value.highFactor, "basis.highFactor");
  if (lowFactor >= highFactor) throw contractError("basis.lowFactor must be less than basis.highFactor");

  if (!Array.isArray(value.exclusions) || value.exclusions.length < 1 || value.exclusions.length > 8) {
    throw contractError("basis.exclusions must contain 1 to 8 items");
  }
  const exclusions = value.exclusions.map((item, index) => (
    normalizedNonEmptyString(item, `basis.exclusions[${index}]`, MAX_EXCLUSION_LENGTH)
  ));

  return {
    ruleVersion: value.ruleVersion,
    rulePublishedDate: value.rulePublishedDate,
    benchmarkStatus: "internal_directional_rule",
    marketBenchmarkAsOf: null,
    marketWarning,
    currency: "INR",
    confidence: "directional",
    areaMethod,
    costMethod,
    floorFactor,
    finishRateInrPerSqft,
    cityFactor,
    lowFactor,
    highFactor,
    taxesAndStatutoryFees: "excluded",
    exclusions,
  };
}

function normalizeEstimate(value, responseInput) {
  if (!hasExactOwnKeys(value, ESTIMATE_FIELDS)) throw contractError("estimate has an unexpected shape");
  const numeric = {};
  for (const field of ESTIMATE_NUMERIC_FIELDS) {
    const output = value[field];
    if (typeof output !== "number" || !Number.isFinite(output) || output < 0) {
      throw contractError(`estimate.${field} must be a non-negative finite number`);
    }
    numeric[field] = output;
  }
  if (numeric.lowInr > numeric.highInr) {
    throw contractError("estimate.lowInr must not exceed estimate.highInr");
  }
  for (const field of ["city", "floors", "quality"]) {
    if (value[field] !== responseInput[field]) {
      throw contractError(`estimate.${field} does not match input.${field}`);
    }
  }
  const disclaimer = normalizedNonEmptyString(value.disclaimer, "estimate.disclaimer", MAX_DISCLAIMER_LENGTH);
  return {
    ...numeric,
    floors: responseInput.floors,
    quality: responseInput.quality,
    city: responseInput.city,
    disclaimer,
  };
}

function reconcileEstimate(input, estimate, basis) {
  const plotSqft = input.width * input.length;
  const builtUpSqft = Math.round(plotSqft * basis.floorFactor);
  const midpointInr = builtUpSqft * basis.finishRateInrPerSqft * basis.cityFactor;
  const expected = {
    plotSqft,
    builtUpSqft,
    lowInr: Math.round(midpointInr * basis.lowFactor),
    highInr: Math.round(midpointInr * basis.highFactor),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (estimate[field] !== value) {
      throw contractError(`estimate.${field} does not reconcile with input and basis`);
    }
  }
}

export function normalizePublicEstimateEnvelope(value, expectedScenario) {
  const expected = validateEstimatorScenario(expectedScenario);
  if (!expected.valid) throw new TypeError("Expected estimator scenario is invalid.");
  if (!hasExactOwnKeys(value, ENVELOPE_FIELDS)) throw contractError("envelope has an unexpected shape");
  if (!hasExactOwnKeys(value.input, ESTIMATOR_FIELDS)) throw contractError("input has an unexpected shape");

  const responseInput = validateEstimatorScenario(value.input);
  if (!responseInput.valid) throw contractError("input is invalid");
  if (estimatorRequestKey(responseInput.request) !== estimatorRequestKey(expected.request)) {
    throw contractError("input does not match the latest request");
  }

  const input = responseInput.request;
  const estimate = normalizeEstimate(value.estimate, input);
  const basis = normalizeBasis(value.basis);
  reconcileEstimate(input, estimate, basis);
  return { input, estimate, basis };
}
