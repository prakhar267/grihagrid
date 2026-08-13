export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

let csrfToken = null;

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = String(options.method || "GET").toUpperCase();
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs || 15_000);
  const signal = controller.signal;
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken || readCookie("grihagrid_csrf");
    if (token) headers.set("x-csrf-token", token);
  }
  let response;
  try {
    response = await fetch(path, { ...options, body, headers, signal, credentials: "include" });
  } catch (error) {
    if (error?.name === "AbortError" && timedOut) throw new ApiError("The request took too long. Please try again.", 408, null);
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new ApiError(payload?.error || payload?.message || `Request failed (${response.status})`, response.status, payload);
  }
  if (payload && typeof payload === "object" && payload.csrfToken) {
    csrfToken = payload.csrfToken;
  }
  return payload;
}

export function formatInr(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
}

export function formatLakh(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(number / 100000)}L`;
}

export function formatDate(value, options = {}) {
  if (!value) return "—";
  const normalized = typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.valueOf())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  });
}

export function idempotencyKey(storageKey) {
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const value = crypto.randomUUID();
  sessionStorage.setItem(storageKey, value);
  return value;
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy is unavailable in this browser.");
}

export function trackEvent(name, properties = {}) {
  const eventName = String(name || "").trim();
  if (!eventName) return;
  const body = { event: eventName };
  const aggregateProperties = {};
  if (properties.surface) aggregateProperties.surface = String(properties.surface);
  if (properties.outcome) aggregateProperties.outcome = String(properties.outcome);
  if (Object.keys(aggregateProperties).length) body.properties = aggregateProperties;
  api("/api/events", {
    method: "POST",
    body,
    timeoutMs: 5_000,
  }).catch(() => {
    // Analytics never blocks the planning flow.
  });
}
