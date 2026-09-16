import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationGuard } from '../src/navigation-guard.js';
import { clearLegacyPendingProjectState } from '../src/anonymous-draft.js';
import { consumeEstimatorHandoffPayload } from '../src/public-estimator.js';

function fixture(state = {}) {
  let index = 0;
  const entries = [{ state, url: '/plans' }], listeners = [];
  const windowObject = {
    location: { href: '/plans' }, sessionStorage: { removeItem() {}, getItem() { return null; } },
    addEventListener(type, listener) { if (type === 'popstate') listeners.push(listener); },
    removeEventListener(type, listener) { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); },
    history: {
      get state() { return entries[index].state; }, get length() { return entries.length; },
      pushState(state, title, url) { entries.splice(++index); entries.push({ state, url }); windowObject.location.href = url; },
      replaceState(state, title, url) { entries[index] = { state, url: url ?? entries[index].url }; windowObject.location.href = entries[index].url; },
      go(delta) { index += delta; assert.ok(index >= 0 && index < entries.length); windowObject.location.href = entries[index].url; windowObject.pop(); },
    },
    pop(isTrusted = true) { const event = { isTrusted, stopped: false, stopImmediatePropagation() { this.stopped = true; } }; for (const listener of listeners) { listener(event); if (event.stopped) break; } },
  };
  return { windowObject, entries };
}

test('cancelled Back and Forward restore the same entry without duplicating history or prompts', () => {
  const { windowObject: w, entries } = fixture(); const guard = createNavigationGuard(w);
  w.history.pushState({}, '', '/explore'); w.history.pushState({}, '', '/plans'); w.history.go(-1);
  let prompts = 0, transitions = 0;
  guard.register(() => { prompts++; return false; });
  w.addEventListener('popstate', () => transitions++);
  for (const direction of [-1, 1]) { w.history.go(direction); assert.equal(w.location.href, '/explore'); }
  assert.equal(prompts, 2); assert.equal(transitions, 0); assert.equal(entries.length, 3);
  guard.register(() => true); w.history.go(-1); assert.equal(w.location.href, '/plans'); assert.equal(transitions, 1);
  guard.dispose();
});

test('programmatic forced replacement bypasses the dirty guard and retains only caller state plus integer', () => {
  const { windowObject: w } = fixture(); const guard = createNavigationGuard(w); let prompts = 0;
  guard.register(() => { prompts++; return false; });
  w.history.replaceState({ logoutConfirmed: true }, '', '/'); w.pop();
  assert.equal(prompts, 0); assert.deepEqual(w.history.state, { logoutConfirmed: true, __grihagridNavigationPosition: 0 });
  guard.dispose();
});

test('marker survives existing payload scrubbing without copying URLs, fragment capabilities or retired draft values', () => {
  const { windowObject: w } = fixture({ pendingProject: { name: 'PRIVATE_DRAFT' }, estimatorScenario: { private: 'PRIVATE_SCENARIO' } });
  const guard = createNavigationGuard(w);
  clearLegacyPendingProjectState(w);
  const consumed = consumeEstimatorHandoffPayload(w.sessionStorage, w.history.state);
  w.history.replaceState(consumed.navigationState, '', '/share/report#PRIVATE_CAPABILITY');
  assert.deepEqual(w.history.state, { __grihagridNavigationPosition: 0 });
  // A strict anonymous continuation allowlist can replace all existing fields;
  // only the integer is reattached, without recovering anything it discarded.
  const allowed = { projectCreationKey: '10000000-0000-4000-8000-000000000001', projectContinuation: true, anonymousDraftWriteId: '10000000-0000-4000-8000-000000000002', anonymousDraftRevision: 1 };
  w.history.pushState(allowed, '', '/login#ANOTHER_CAPABILITY');
  assert.deepEqual(w.history.state, { ...allowed, __grihagridNavigationPosition: 1 });
  w.history.replaceState({}, '', '/estimate'); assert.deepEqual(w.history.state, { __grihagridNavigationPosition: 1 });
  guard.dispose();
});


test('forced logout during asynchronous cancellation cannot suppress logout or restore a private URL', () => {
  const { windowObject: w } = fixture(); const guard = createNavigationGuard(w);
  w.history.pushState({}, '', '/projects/private/spatial');
  const traverse = w.history.go.bind(w.history), queued = [];
  w.history.go = delta => queued.push(delta);
  let prompts = 0; guard.register(() => { prompts++; return false; });
  const observed = []; w.addEventListener('popstate', () => observed.push(w.location.href));
  traverse(-1); assert.deepEqual(queued, [1]);
  w.history.replaceState({ logoutConfirmed: true }, '', '/'); w.pop(false);
  assert.deepEqual(observed, ['/'], 'forced synthetic logout reaches the router immediately');
  traverse(queued.shift());
  assert.equal(w.location.href, '/'); assert.deepEqual(observed, ['/', '/']);
  assert.equal(prompts, 1); assert.equal(w.history.state.logoutConfirmed, true);
  guard.dispose();
});
