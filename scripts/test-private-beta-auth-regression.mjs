import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [html, phase2, privateBetaLanding] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
]);

assert.match(
  privateBetaLanding,
  /if \(!\['retainer', 'quorum'\]\.includes\(feature\)\)[\s\S]{0,260}ensureProtectedAccess/,
  'The signed-in Home/community route must not depend on the commercial examination-access gate.',
);
assert.match(
  privateBetaLanding,
  /if \(feature === 'quorum'\)[\s\S]{0,260}await global\.DueDiligenceQuorum\?\.open\?\./,
  'Opening Home must await community activation instead of leaving an unresolved verification shell.',
);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function fakeNode(id, { tagName = 'DIV', open = false, display = 'block' } = {}) {
  const attributes = new Map();
  const node = {
    id,
    tagName,
    open,
    inert: false,
    hidden: false,
    dataset: {},
    offsetParent: display === 'none' ? null : {},
    _display: display,
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === 'open') this.open = true;
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === 'open') this.open = false;
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return name === 'open' ? this.open : attributes.has(name);
    },
    contains(candidate) {
      return candidate === this;
    },
    matches(selector) {
      if (selector.includes('dialog[open]') && this.tagName === 'DIALOG' && this.open) return true;
      if (selector.includes('.dd2-overlay.is-open') && this.id === 'dd2-onboarding-overlay') return true;
      return false;
    },
    checkVisibility() {
      return this._display !== 'none';
    },
    getClientRects() {
      return this._display === 'none' ? [] : [{}];
    },
  };
  node.setAttribute('aria-hidden', 'false');
  return node;
}

// A native modal dialog is promoted to the browser top layer. A visually hidden
// DD2 overlay must never steal isolation ownership and make that dialog inert.
{
  const landing = fakeNode('private-beta-landing');
  const admissionDialog = fakeNode('private-beta-dialog', {
    tagName: 'DIALOG',
    open: true,
  });
  const appShell = fakeNode('authenticated-app-shell');
  const hiddenOnboarding = fakeNode('dd2-onboarding-overlay', { display: 'none' });
  const bodyChildren = [landing, admissionDialog, appShell, hiddenOnboarding];
  const document = {
    documentElement: { dataset: {} },
    body: { children: bodyChildren },
    getElementById() { return null; },
    querySelector(selector) {
      return selector.includes('dialog[open]') ? admissionDialog : null;
    },
    querySelectorAll() {
      // Deliberately return the hidden overlay last, matching its later body
      // position. The implementation must still prioritize the native dialog.
      return [admissionDialog, hiddenOnboarding];
    },
  };
  const context = {
    document,
    getComputedStyle(node) {
      return {
        display: node._display,
        visibility: node._display === 'none' ? 'hidden' : 'visible',
      };
    },
  };
  const isolationSource = between(
    html,
    'function syncModalIsolation()',
    'window.syncModalIsolation = syncModalIsolation;',
  );
  vm.runInNewContext(`${isolationSource}\nsyncModalIsolation();`, context);

  assert.equal(
    admissionDialog.inert,
    false,
    'An open native private-beta dialog must remain interactive.',
  );
  assert.equal(
    admissionDialog.dataset.ddModalInert,
    undefined,
    'Modal isolation must not mark the native private-beta dialog inert.',
  );
  assert.equal(
    hiddenOnboarding.inert,
    true,
    'A visually suppressed onboarding overlay must not compete with the open native dialog.',
  );
  assert.equal(landing.inert, true, 'Background landing content must remain isolated.');
  assert.equal(appShell.inert, true, 'Background application content must remain isolated.');
}

// Commercial plan and onboarding overlays may initialize behind the private
// maintenance lock. They must never make the password gate inert.
{
  const maintenanceGate = fakeNode('dd-maintenance-gate');
  const entryOverlay = fakeNode('dd2-entry-overlay');
  const appShell = fakeNode('authenticated-app-shell');
  const bodyChildren = [appShell, entryOverlay, maintenanceGate];
  const document = {
    documentElement: { dataset: { ddMaintenance: 'locked' } },
    body: { children: bodyChildren },
    getElementById(id) {
      return id === maintenanceGate.id ? maintenanceGate : null;
    },
    querySelector() { return null; },
    querySelectorAll() { return [entryOverlay]; },
  };
  const context = { document };
  const isolationSource = between(
    html,
    'function syncModalIsolation()',
    'window.syncModalIsolation = syncModalIsolation;',
  );
  vm.runInNewContext(`${isolationSource}\nsyncModalIsolation();`, context);

  assert.equal(maintenanceGate.inert, false, 'The maintenance password gate must remain interactive.');
  assert.equal(
    maintenanceGate.dataset.ddModalInert,
    undefined,
    'The maintenance password gate must never be marked inert.',
  );
  assert.equal(entryOverlay.inert, true, 'A hidden plan-entry overlay must remain isolated behind maintenance.');
  assert.equal(appShell.inert, true, 'Application content must remain isolated behind maintenance.');
}

// A first-time account has incomplete profile data immediately after Google
// authentication. Profile onboarding must wait until private-beta admission is
// allowed, then resume exactly from the access event.
{
  const deferOnboardingSource = between(
    phase2,
    'function deferOnboardingForPrivateBeta()',
    'async function loadUserState()',
  );
  const openOnboardingSource = between(
    phase2,
    'function openOnboarding(options = {})',
    'function updateEnrollmentFields()',
  );
  assert.match(
    deferOnboardingSource,
    /privateBetaGate\s*!==\s*true\s*\|\|\s*state\.privateBetaAllowed[\s\S]*setOverlay\(false,\s*['"]dd2-onboarding-overlay['"]\)[\s\S]*return true/,
    'The private-beta guard must close profile onboarding until admission is allowed.',
  );
  assert.match(
    openOnboardingSource,
    /if\s*\(deferOnboardingForPrivateBeta\(\)\)\s*return;/,
    'Opening profile onboarding must use the private-beta admission guard.',
  );
  assert.match(
    phase2,
    /addEventListener\(\s*['"]duediligence:private-beta-access['"][\s\S]{0,1200}state\.privateBetaAllowed\s*=[\s\S]{0,600}detail\?\.allowed\s*===\s*true[\s\S]{0,1200}loadUserState\(\)/,
    'An allowed private-beta access event must resume the guarded user-state load.',
  );
}

async function runAuthenticatedSync({
  pending,
  globalBetaEnabled = false,
  allowed = false,
  gateEnabled = true,
  routeRequested = false,
}) {
  const calls = [];
  const statuses = [];
  const api = {
    getAccess() { return null; },
    getPending() { return pending; },
    async status() { return { allowed }; },
  };
  const context = {
    gateEnabled,
    currentSession() {
      return { access_token: 'authenticated-session' };
    },
    privateBetaApi() {
      return api;
    },
    state: { globalBetaEnabled },
    applicationRouteRequested() {
      return routeRequested;
    },
    requestedApplicationRoute() {
      return routeRequested ? 'examination-room' : '';
    },
    async openProtectedFeature(feature) {
      calls.push(['openProtectedFeature', feature]);
    },
    async openQuorumHome() {
      calls.push(['openQuorumHome']);
    },
    showLanding() {
      calls.push(['showLanding']);
    },
    showApplication() {
      calls.push(['showApplication']);
    },
    openAdmission(stage) {
      calls.push(['openAdmission', stage]);
    },
    setStatus(id, message, kind) {
      statuses.push({ id, message, kind });
    },
  };
  const syncSource = between(
    privateBetaLanding,
    'async function syncAuthenticatedState(detail = {})',
    'function openLegalView(view)',
  );
  vm.runInNewContext(syncSource, context);
  await context.syncAuthenticatedState({ authenticated: true });
  return { calls, statuses };
}

async function runUnauthenticatedSync({ gateEnabled = true, route = '' } = {}) {
  const calls = [];
  const context = {
    gateEnabled,
    currentSession() { return null; },
    privateBetaApi() { return { getPending() { return null; } }; },
    state: { globalBetaEnabled: false },
    applicationRouteRequested() { return Boolean(route); },
    requestedApplicationRoute() { return route; },
    showLanding(options) { calls.push(['showLanding', options]); },
    showApplication() { calls.push(['showApplication']); },
    async openProtectedFeature(feature) { calls.push(['openProtectedFeature', feature]); },
    async openQuorumHome() { calls.push(['openQuorumHome']); },
    openAdmission(stage) { calls.push(['openAdmission', stage]); },
    setStatus() {},
    URLSearchParams,
    location: { search: '' },
  };
  const syncSource = between(
    privateBetaLanding,
    'async function syncAuthenticatedState(detail = {})',
    'function openLegalView(view)',
  );
  vm.runInNewContext(syncSource, context);
  await context.syncAuthenticatedState({ authenticated: false });
  return calls;
}

// An authenticated visitor at the canonical root must enter Quorum even when
// the retired admission gate is disabled.
{
  const result = await runAuthenticatedSync({ pending: null, gateEnabled: false });
  assert.ok(
    result.calls.some(([name]) => name === 'openQuorumHome'),
    'A signed-in user at root must enter the protected Quorum home.',
  );
  assert.equal(
    result.calls.some(([name]) => name === 'openAdmission'),
    false,
    'The disabled private-beta gate must not reopen any admission stage.',
  );
}

// Explicit application deep links remain usable for authenticated visitors.
{
  const result = await runAuthenticatedSync({
    pending: null,
    gateEnabled: false,
    routeRequested: true,
  });
  assert.ok(
    result.calls.some(([name]) => name === 'showApplication'),
    'A signed-in user must enter the application for an explicit feature route.',
  );
}

// A direct Examination Room link must open the route-bound sign-in path even
// when the feature bundle has not yet been loaded in this browser session.
{
  const calls = await runUnauthenticatedSync({ gateEnabled: false, route: 'examination-room' });
  assert.ok(
    calls.some(([name, feature]) => name === 'openProtectedFeature' && feature === 'examination-room'),
    'A signed-out Examination Room deep link must enter the protected sign-in flow.',
  );
}

{
  const calls = await runUnauthenticatedSync({ gateEnabled: true, route: 'examination-room' });
  assert.ok(
    calls.some(([name, feature]) => name === 'openProtectedFeature' && feature === 'examination-room'),
    'The private-beta gate must preserve the Examination Room sign-in return path.',
  );
}

// With the protected global policy enabled, an authenticated account no longer
// depends on a browser-stored admission token. At root it remains on the new
// Quorum home after the server confirms eligibility.
{
  const result = await runAuthenticatedSync({
    pending: null,
    globalBetaEnabled: true,
    allowed: true,
  });
  assert.ok(
    result.calls.some(([name]) => name === 'openQuorumHome'),
    'An eligible signed-in account at root must enter Quorum.',
  );
  assert.equal(
    result.calls.some(([name]) => name === 'openAdmission'),
    false,
    'A confirmed global-beta account must not be returned to the code or disclosure loop.',
  );
}


{
  const result = await runAuthenticatedSync({
    pending: null,
    globalBetaEnabled: true,
    allowed: true,
    routeRequested: true,
  });
  assert.ok(
    result.calls.some(([name]) => name === 'showApplication'),
    'An eligible signed-in account must enter an explicitly requested feature.',
  );
}

// Normal OAuth return with an intact pending token still advances to final
// authenticated acceptance.
{
  const result = await runAuthenticatedSync({ pending: { token: 'pending-token' } });
  assert.ok(
    result.calls.some(([name, stage]) => name === 'openAdmission' && stage === 'final'),
    'An authenticated callback with a pending token must open final acceptance.',
  );
}

// Some mobile/tablet OAuth returns do not preserve sessionStorage. The user is
// already authenticated in this scenario, so the safe recovery is to restart
// disclosure/code verification without sending the user through Google again.
{
  const result = await runAuthenticatedSync({ pending: null });
  assert.ok(
    result.calls.some(([name, stage]) => name === 'openAdmission' && stage === 'disclosure'),
    'An authenticated callback missing its pending token must reopen disclosure instead of looping to Google.',
  );
  assert.ok(
    result.statuses.some(({ message }) => (
      /Google sign-in (?:succeeded|was completed|is complete)/i.test(message)
      && /access code/i.test(message)
      && /not need to sign in to Google a second time/i.test(message)
    )),
    'Missing-pending recovery must explain that sign-in succeeded and only access-code verification must repeat.',
  );
}

async function runDirectApplicationRoute(route) {
  const calls = [];
  const openers = {
    openBarEasy: 'bar-easy',
    openChairCases: 'chairs-cases',
    openDoctrines: 'doctrines',
    openAnchorCases: 'anchor-case-digests',
  };
  const global = {};
  for (const [opener, routeName] of Object.entries(openers)) {
    global[opener] = async () => {
      calls.push(['open', routeName]);
      return true;
    };
  }
  const context = {
    global,
    state: { lastActivatedHash: '', routeActivationVersion: 0 },
    requestedApplicationRoute() { return route; },
    currentSession() { return { user: { id: 'route-owner' } }; },
    async loadFeature(feature) {
      calls.push(['load', feature]);
      return true;
    },
    document: { getElementById() { return null; } },
    requestAnimationFrame(callback) { callback(); },
  };
  const activationSource = between(
    privateBetaLanding,
    'async function activateApplicationRoute(hash)',
    'function showApplication(options = {})',
  );
  vm.runInNewContext(activationSource, context);
  await context.activateApplicationRoute(`#${route}`);
  return { calls, state: context.state };
}

// Every lazy-loaded study route must restore its own feature after a refresh
// or direct navigation. Previously these hashes left only the shared shell (or
// the default Mock Bar page) because the startup router ignored them.
for (const [route, feature] of [
  ['bar-easy', 'bar-easy'],
  ['chairs-cases', 'chair-cases'],
  ['doctrines', 'doctrines'],
  ['anchor-case-digests', 'anchor-cases'],
]) {
  const result = await runDirectApplicationRoute(route);
  assert.deepEqual(
    result.calls,
    [['load', feature], ['open', route]],
    `${route} must load and open its matching study feature.`,
  );
  assert.equal(
    result.state.lastActivatedHash,
    route,
    `${route} must be recorded only after its page opens successfully.`,
  );
}

console.log('Private-beta new-user authentication regressions passed.');
