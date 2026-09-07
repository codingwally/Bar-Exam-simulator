import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Actual shipped Home open/activate functions; only DOM, data transport and
// pre-existing Home rendering helpers are replaced at this focused boundary.
const source = await readFile(new URL('../assets/lex-forum.js', import.meta.url), 'utf8');
function extract(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}`, 'mu').exec(source);
  assert.ok(match, `Actual ${name} function is required`);
  return match[0];
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ stage = '', forceHome = true, restoreResult = true, authenticated = true } = {}) {
  let current = true;
  const pending = [], calls = [];
  const state = { active: false, view: 'home', trigger: null, directEntryId: null, legacyPostId: null };
  const transport = (name, result = true) => {
    calls.push(name);
    if (name !== stage) return Promise.resolve(result);
    const gate = deferred(); pending.push({ name, ...gate }); return gate.promise;
  };
  const trigger = { id: 'synthetic-home-trigger' };
  const context = vm.createContext({
    state, URLSearchParams,
    location: { hash: '#quorum', search: '' },
    $: selector => selector === '#spa-community' ? trigger : null,
    global: {
      showPage: () => { calls.push('showPage'); return true; },
      DueDiligenceSubscriptionCta: { shouldShow: () => true },
    },
    hasSession: () => authenticated,
    askForSignIn: () => calls.push('signIn'),
    setAuthView: () => calls.push('authView'),
    loadBootstrap: () => transport('bootstrap'),
    loadSidebar: () => transport('sidebar'),
    telemetry: () => calls.push('telemetry'),
    restoreRoute: () => transport('restore', restoreResult),
    setView: () => transport('setView'),
    renderFeed: () => calls.push('renderFeed'),
    handleError: () => calls.push('error'),
    setStableLocation: () => calls.push('setStableLocation'),
  });
  vm.runInContext(`${extract('activate')}\n${extract('open')}\nglobalThis.actual={open,activate};`, context);
  return {
    calls, pending, state,
    cancel() { current = false; },
    open: () => context.actual.open(trigger, { forceHome, isCurrent: () => current }),
    openDefault: () => context.actual.open(trigger),
    activate: () => context.actual.activate({ forceHome, isCurrent: () => current }),
    actual: context.actual,
  };
}

test('stale Home intent is rejected before UI, authentication or route mutations', async () => {
  for (const authenticated of [true, false]) {
    const h = harness({ authenticated }); h.cancel();
    assert.equal(await h.open(), false);
    assert.deepEqual(h.calls, []);
    assert.equal(h.state.active, false);
    assert.equal(h.state.trigger, null);
  }
});

test('direct activation checks stale intent before changing active/auth state', async () => {
  const h = harness(); h.cancel();
  assert.equal(await h.activate(), false);
  assert.equal(h.state.active, false);
  assert.deepEqual(h.calls, []);
});

for (const scenario of [
  { stage: 'bootstrap', forceHome: true, forbidden: ['sidebar', 'telemetry', 'setView', 'restore'] },
  { stage: 'sidebar', forceHome: true, forbidden: ['telemetry', 'setView', 'restore'] },
  { stage: 'setView', forceHome: true, forbidden: ['restore'] },
  { stage: 'restore', forceHome: false, forbidden: ['setView'] },
  { stage: 'setView', forceHome: false, restoreResult: false, forbidden: [] },
]) {
  for (const outcome of ['success', 'false', 'error']) {
    const label = `${scenario.stage}/${scenario.forceHome ? 'forced-home' : scenario.restoreResult === false ? 'fallback-home' : 'restore'}`;
    test(`cancellation during ${label} ignores late ${outcome} without URL/render/error continuation`, async () => {
      const h = harness(scenario);
      const opening = h.open(); await flush();
      assert.equal(h.pending.length, 1);
      const before = [...h.calls];
      h.cancel();
      if (outcome === 'error') h.pending[0].reject(new Error('Synthetic stale Home response'));
      else h.pending[0].resolve(outcome === 'success');
      assert.equal(await opening, false);
      assert.deepEqual(h.calls, before, 'No work after an obsolete async boundary');
      for (const name of [...scenario.forbidden, 'setStableLocation', 'renderFeed', 'error']) {
        assert.equal(h.calls.includes(name), false, name);
      }
    });
  }
}

test('canceled older Home completion cannot publish a route over a newer intent', async () => {
  const h = harness({ stage: 'bootstrap' });
  let epoch = 0;
  const older = h.actual.open(null, { forceHome: true, isCurrent: () => epoch === 0 });
  await flush(); epoch = 1;
  const newer = h.actual.open(null, { forceHome: true, isCurrent: () => epoch === 1 });
  await flush(); assert.equal(h.pending.length, 2);
  h.pending[0].reject(new Error('Synthetic obsolete account-A response'));
  assert.equal(await older, false);
  assert.equal(h.calls.includes('setStableLocation'), false);
  assert.equal(h.calls.includes('error'), false);
  h.pending[1].resolve(true);
  assert.equal(await newer, true);
  assert.equal(h.calls.filter(name => name === 'setStableLocation').length, 1);
  assert.equal(h.calls.filter(name => name === 'renderFeed').length, 1);
});

test('a live forced Home intent still opens and publishes exactly one stable URL', async () => {
  const h = harness();
  assert.equal(await h.open(), true);
  assert.deepEqual(h.calls, ['authView', 'showPage', 'authView', 'bootstrap', 'sidebar', 'telemetry', 'setView', 'renderFeed', 'setStableLocation']);
});

test('a live restored route retains its no-new-history behavior', async () => {
  const h = harness({ forceHome: false });
  assert.equal(await h.open(), true);
  assert.equal(h.calls.includes('restore'), true);
  assert.equal(h.calls.includes('setStableLocation'), false);
});

test('existing no-options callers retain ordinary Home activation', async () => {
  const h = harness();
  assert.equal(await h.openDefault(), true);
  assert.equal(h.calls.includes('restore'), true);
  assert.equal(h.calls.includes('renderFeed'), true);
  assert.equal(h.calls.includes('error'), false);
});

test('a current transport failure still renders the existing error, but no URL success', async () => {
  const h = harness({ stage: 'bootstrap' });
  const opening = h.open(); await flush();
  h.pending[0].reject(new Error('Synthetic current failure'));
  assert.equal(await opening, false);
  assert.equal(h.calls.filter(name => name === 'error').length, 1);
  assert.equal(h.calls.includes('setStableLocation'), false);
});
