// Only an integer position is added to the app's history entries. URLs, fragments,
// capabilities, and draft values are never copied into this marker or storage.
const POSITION = '__grihagridNavigationPosition';
const positionOf = state => Number.isSafeInteger(state?.[POSITION]) && state[POSITION] >= 0 ? state[POSITION] : null;
const indexed = (state, position) => ({ ...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}), [POSITION]: position });
let installed;

export function createNavigationGuard(windowObject) {
  const history = windowObject.history;
  const originalPush = history.pushState, originalReplace = history.replaceState;
  let position = positionOf(history.state) ?? 0, restoring = null, guard = null, replacement = null;
  originalReplace.call(history, indexed(history.state, position), '');
  history.pushState = function (state, title, url) {
    const next = position + 1;
    originalPush.call(history, indexed(state, next), title, url);
    position = next;
  };
  history.replaceState = function (state, title, url) {
    originalReplace.call(history, indexed(state, position), title, url);
    // A forced sign-out can arrive while the browser is returning from a
    // cancelled traversal. Apply that replacement to the eventual entry too;
    // otherwise the pending traversal could resurrect its private URL.
    if (restoring !== null) replacement = { state, title, url };
  };
  const onPop = event => {
    if (event.isTrusted === false) return;
    const destination = positionOf(history.state);
    // App routes are indexed. Full document navigation is covered by beforeunload.
    if (destination === null) return;
    if (restoring !== null) {
      if (replacement) {
        originalReplace.call(history, indexed(replacement.state, destination), replacement.title, replacement.url);
        replacement = null; restoring = null; position = destination;
        return;
      }
      if (destination === restoring) { position = destination; restoring = null; }
      event.stopImmediatePropagation();
      return;
    }
    // Programmatic push/replace dispatches a synthetic popstate at this position;
    // explicit buttons confirm themselves, and forced session expiry must proceed.
    if (destination === position) return;
    if (guard && !guard()) {
      restoring = position;
      event.stopImmediatePropagation();
      history.go(position - destination);
      return;
    }
    position = destination;
  };
  windowObject.addEventListener('popstate', onPop, true);
  return {
    register(next) { guard = next; return () => { if (guard === next) guard = null; }; },
    dispose() { windowObject.removeEventListener('popstate', onPop, true); history.pushState = originalPush; history.replaceState = originalReplace; guard = null; },
  };
}

export function installNavigationGuard(windowObject = window) {
  installed ||= createNavigationGuard(windowObject);
  return installed;
}
export function registerNavigationGuard(guard) { return installNavigationGuard().register(guard); }
