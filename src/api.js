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
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
  const signal = options.signal && globalThis.AbortSignal?.any
    ? AbortSignal.any([options.signal, controller.signal])
    : (options.signal || controller.signal);
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
    if (error?.name === "AbortError") throw new ApiError("The request took too long. Please try again.", 408, null);
    throw error;
  } finally {
    window.clearTimeout(timer);
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
