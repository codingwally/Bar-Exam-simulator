import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const forecast = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
const phase4 = await readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');

// Execute production lifecycle functions, replacing only DOM and transport edges.
function extract(source, name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}`, 'mu').exec(source);
  assert.ok(match, `Expected the actual ${name} function`);
  return match[0];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const success = { authorized: true, consentAccepted: true };
const staleFailure = () => Object.assign(new Error('Stale session failure'), {
  status: 401, code: 'INVALID_SESSION',
});

function harness({ deferredSetup = false } = {}) {
  let owner = 'owner-a';
  let nextTimer = 0;
  const timers = new Map();
  const setups = [];
  const statuses = [];
  const observations = { pickers: 0, disclaimers: 0, errors: 0, interruptions: 0, signIns: 0 };
  const state = {
    isOpen: false, view: 'access', ownerId: '', authorizationOwnerId: '',
    authorizationErrorOwnerId: '', authorizationController: null,
    root: { hidden: true }, answers: new Map(),
  };
  let context;
  const reset = () => vm.runInContext('resetProtectedState()', context);
  context = vm.createContext({
    AbortController,
    Event,
    Element: class Element {},
    document: { activeElement: null },
    FORECAST_ACCESS_TIMEOUT_MS: 12_000,
    ROUTE: '#bar-forecast-2026',
    ENDPOINT: '/admin/dd2026/bar-forecast',
    state,
    global: {
      dispatchEvent: () => true,
      DueDiligencePhase4: {
        ensureRequiredSetup: (_route, options) => {
          const pending = deferred();
          setups.push({ ...pending, owner, signal: options.signal });
          if (!deferredSetup) pending.resolve(true);
          // Deliberately ignore AbortSignal: a stale transport may already have
          // completed, or a client adapter may not implement cancellation.
          return pending.promise;
        },
        request: (_endpoint, options) => {
          assert.equal(options.body.operation, 'status');
          assert.equal(options.recoverAccess, false);
          const pending = deferred();
          statuses.push({ ...pending, owner, signal: options.signal });
          return pending.promise;
        },
      },
      setTimeout: (callback, delay) => {
        assert.equal(delay, 12_000);
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      confirm: () => true,
      toast: () => {},
    },
    runtimeOwnerId: () => owner,
    runtimeSession: () => owner ? { access_token: 'fixture-token', user: { id: owner } } : null,
    ensureRoot: () => {},
    setForecastRoute: () => {},
    restoreForecastRoute: () => {},
    isolatePage: () => {},
    stopSubmittingProgress: () => {},
    renderAccessProgress: () => { reset(); state.view = 'access'; },
    renderAccessError: () => { reset(); state.view = 'access-error'; observations.errors += 1; },
    renderSubjectPicker: () => { state.view = 'subject'; observations.pickers += 1; },
    renderDisclaimer: () => { state.view = 'consent'; observations.disclaimers += 1; },
    openForecastSignIn: () => { observations.signIns += 1; },
    routeToPlansAndPricing: () => { state.view = 'pricing'; },
    handleForecastAccessInterruption: () => { observations.interruptions += 1; return false; },
  });
  for (const name of [
    'stopForecastPolling', 'resetProtectedState', 'abortRequest', 'abortAuthorization', 'beginAuthorizationDeadline',
    'beginRequest', 'requestForecast', 'checkAuthorization', 'hasDraftAnswers', 'closeForecast',
    'openForecast', 'handleForecastSessionChange', 'handleForecastAccessChange',
  ]) vm.runInContext(extract(forecast, name), context);
  return {
    state, observations, setups, statuses, timers,
    open: () => vm.runInContext('openForecast()', context),
    close: () => vm.runInContext('closeForecast({ force: true })', context),
    retry: () => vm.runInContext('checkAuthorization()', context),
    refresh: () => vm.runInContext('handleForecastSessionChange(); handleForecastAccessChange()', context),
    switchOwner: (next) => {
      owner = next;
      vm.runInContext('handleForecastSessionChange()', context);
    },
    expire: () => {
      const id = Math.max(...timers.keys());
      assert.ok(timers.has(id));
      timers.get(id)();
    },
  };
}

for (const stage of ['setup', 'status']) {
  for (const outcome of ['success', 'error']) {
    test(`same-owner close/reopen ignores late ${stage} ${outcome} without clearing the new owner`, async () => {
      const h = harness({ deferredSetup: stage === 'setup' });
      const oldOpen = h.open();
      await flush();
      const old = (stage === 'setup' ? h.setups : h.statuses)[0];
      const oldController = h.state.authorizationController;
      h.close();
      assert.equal(old.signal.aborted, true);
      const newOpen = h.open();
      await flush();
      const newController = h.state.authorizationController;
      assert.notEqual(newController, oldController);
      if (outcome === 'success') old.resolve(stage === 'setup' ? true : success);
      else old.reject(staleFailure());
      await oldOpen;
      await flush();
      assert.equal(h.state.authorizationController, newController);
      assert.equal(h.state.authorizationOwnerId, 'owner-a');
      assert.equal(h.state.ownerId, '');
      assert.equal(h.observations.pickers, 0);
      assert.equal(h.observations.errors, 0);
      assert.equal(h.observations.interruptions, 0);
      if (stage === 'setup') {
        assert.equal(h.statuses.length, 0, 'old setup cannot start a status request');
        h.setups[1].resolve(true);
        await flush();
      }
      h.statuses.at(-1).resolve(success);
      await newOpen;
      assert.equal(h.state.ownerId, 'owner-a');
      assert.equal(h.observations.pickers, 1);
      assert.equal(h.timers.size, 0);
    });
  }
}

for (const outcome of ['success', 'error']) {
  test(`A to B to A ignores old account-A ${outcome} and account-B completion`, async () => {
    const h = harness();
    const oldOpen = h.open();
    await flush();
    h.switchOwner('owner-b');
    await flush();
    h.switchOwner('owner-a');
    await flush();
    assert.equal(h.statuses.length, 3);
    const current = h.state.authorizationController;
    assert.equal(h.statuses[0].signal.aborted, true);
    assert.equal(h.statuses[1].signal.aborted, true);
    if (outcome === 'success') h.statuses[0].resolve(success);
    else h.statuses[0].reject(staleFailure());
    h.statuses[1].resolve(success);
    await oldOpen;
    await flush();
    assert.equal(h.state.authorizationController, current);
    assert.equal(h.state.authorizationOwnerId, 'owner-a');
    assert.equal(h.observations.pickers, 0);
    assert.equal(h.observations.errors, 0);
    assert.equal(h.observations.interruptions, 0);
    h.statuses[2].resolve(success);
    await flush();
    assert.equal(h.state.ownerId, 'owner-a');
    assert.equal(h.observations.pickers, 1);
    assert.equal(h.timers.size, 0);
  });
}

for (const stage of ['setup', 'status']) {
  test(`${stage} timeout stays terminal; one explicit Retry survives the old late response`, async () => {
    const h = harness({ deferredSetup: stage === 'setup' });
    const oldOpen = h.open();
    await flush();
    const old = (stage === 'setup' ? h.setups : h.statuses)[0];
    h.expire();
    await oldOpen;
    assert.equal(h.state.view, 'access-error');
    assert.equal(old.signal.aborted, true);
    assert.equal(h.observations.errors, 1);
    for (let index = 0; index < 5; index += 1) h.refresh();
    await flush();
    assert.equal(h.setups.length, 1);
    const retry = h.retry();
    await flush();
    assert.equal(h.setups.length, 2);
    const current = h.state.authorizationController;
    old.resolve(stage === 'setup' ? true : success);
    await flush();
    assert.equal(h.state.authorizationController, current);
    assert.equal(h.observations.pickers, 0);
    if (stage === 'setup') {
      h.setups[1].resolve(true);
      await flush();
    }
    h.statuses.at(-1).resolve(success);
    await retry;
    assert.equal(h.observations.pickers, 1);
    assert.equal(h.observations.errors, 1);
    assert.equal(h.timers.size, 0);
  });
}

test('Phase4 never adopts a late access snapshot or opens setup after its caller aborts', async () => {
  const pending = deferred();
  const controller = new AbortController();
  const counts = { adopts: 0, dialogs: 0 };
  const access = {
    role: 'student', basis: 'profile_required', termsRequired: false,
    reauthenticationRequired: false, profileCompleted: false,
    tokenAcknowledgementRequired: false, paidSubscriptionExpired: false,
    commercialLaunchEnabled: true,
  };
  const context = vm.createContext({
    controller,
    session: () => ({ access_token: 'fixture-token' }),
    request: (_path, options) => {
      assert.equal(options.signal, controller.signal);
      return pending.promise;
    },
    adoptAccess: (value) => { counts.adopts += 1; return value; },
    setupRequired: () => true,
    openRequiredSetup: () => { counts.dialogs += 1; },
  });
  vm.runInContext(extract(phase4, 'ensureRequiredSetup'), context);
  const setup = vm.runInContext("ensureRequiredSetup('#bar-forecast-2026', { signal: controller.signal })", context);
  controller.abort();
  pending.resolve({ access });
  assert.equal(await setup, false);
  assert.equal(counts.adopts, 0);
  assert.equal(counts.dialogs, 0);
});
