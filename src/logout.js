import { apiResponse, ApiError, clearCsrfToken } from "./api.js";

export const LOGOUT_FAILURE_MESSAGE = "We couldn’t confirm logout. Treat this session as active; this workspace stays open. Check your connection and try again.";
export const LOGOUT_SYNC_KEY = "grihagrid.auth.logout";
export const LOGOUT_CHANNEL_NAME = "grihagrid-auth";
let logoutSequence = 0;

export function isApplicationUnauthenticated(error) {
  return error instanceof ApiError && error.status === 401 && error.payload?.code === "unauthenticated";
}

export async function confirmLogout(request = apiResponse) {
  let logoutError;
  try {
    const result = await request("/api/auth/logout", { method: "POST", body: {} });
    if (result?.status !== 204) {
      throw new ApiError("logout returned an unexpected response", result?.status || 0, result?.payload || null);
    }
    clearCsrfToken();
    return { confirmedBy: "logout" };
  } catch (error) {
    logoutError = error;
  }

  try {
    await request("/api/auth/me");
  } catch (error) {
    if (isApplicationUnauthenticated(error)) {
      clearCsrfToken();
      return { confirmedBy: "reconciliation" };
    }
  }

  throw logoutError;
}

export function clearPrivateSessionStorage(storage) {
  try {
    const target = storage === undefined ? globalThis.sessionStorage : storage;
    if (!target) return;
    for (let index = target.length - 1; index >= 0; index -= 1) {
      const key = target.key(index);
      if (key?.startsWith("grihagrid.")) target.removeItem(key);
    }
  } catch {
    // Storage can be disabled; server revocation remains authoritative.
  }
}

export function clearLocalLogoutState(storage) {
  clearCsrfToken();
  clearPrivateSessionStorage(storage);
}

export function broadcastLogout(storage, marker, Channel) {
  let effectiveMarker = marker;
  logoutSequence += 1;
  effectiveMarker ||= `${Date.now()}:${logoutSequence}`;
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem(LOGOUT_SYNC_KEY, effectiveMarker);
  } catch {
    // Continue to the independent BroadcastChannel path.
  }
  try {
    const ChannelConstructor = Channel === undefined ? globalThis.BroadcastChannel : Channel;
    if (ChannelConstructor) {
      const channel = new ChannelConstructor(LOGOUT_CHANNEL_NAME);
      channel.postMessage({ type: "logout", marker: effectiveMarker });
      channel.close();
    }
  } catch {
    // Cross-tab notification is best effort; this tab is already signed out.
  }
  return effectiveMarker || "";
}

export function isLogoutBroadcast(event) {
  return event?.key === LOGOUT_SYNC_KEY && typeof event.newValue === "string" && event.newValue.length > 0;
}

export function isLogoutChannelMessage(event) {
  return event?.data?.type === "logout" && typeof event.data.marker === "string" && event.data.marker.length > 0;
}

export function privateRouteAfterUnauthenticated(wasAuthenticated) {
  return wasAuthenticated === true
    ? { path: "/", state: { logoutConfirmed: true } }
    : { path: "/login", state: {} };
}

export function shouldRevalidateSession(isPrivatePath, historyState) {
  return isPrivatePath === true || historyState?.logoutConfirmed === true;
}

export function isCurrentSessionRevalidationTarget(requestedLocation, currentLocation, expectedConfirmation, historyState) {
  return requestedLocation === currentLocation
    && (expectedConfirmation !== true || historyState?.logoutConfirmed === true);
}
