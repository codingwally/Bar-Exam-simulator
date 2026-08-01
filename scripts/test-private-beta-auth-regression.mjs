import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [html, phase2, privateBetaLanding] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
]);

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
    body: { children: bodyChildren },
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
    'function openOnboarding()',
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

async function runAuthenticatedSync({ pending }) {
  const calls = [];
  const statuses = [];
  const api = {
    getAccess() { return null; },
    getPending() { return pending; },
  };
  const context = {
    currentSession() {
      return { access_token: 'authenticated-session' };
    },
    privateBetaApi() {
      return api;
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

console.log('Private-beta new-user authentication regressions passed.');
