import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [
  html,
  forecast,
  phase4,
  styles,
  loader,
  landing,
  shell,
  build,
  serviceWorker,
  preview,
  qaHarness,
] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/bar-forecast.js', root), 'utf8'),
  readFile(new URL('assets/phase4-experience.js', root), 'utf8'),
  readFile(new URL('assets/bar-forecast.css', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.js', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
  readFile(new URL('service-worker.js', root), 'utf8'),
  readFile(new URL('assets/bar-forecast/forecast-workspace-preview.webp', root)),
  readFile(new URL('docs/evidence/bar-forecast-examplify-audit-20260901/local-preview.html', root), 'utf8'),
]);

const rail = html.match(/<nav class="qfs-practice-rail"[\s\S]*?<\/nav>/)?.[0] || '';
const drawer = html.match(/<details class="quorum-practice-menu" id="quorum-practice-menu">[\s\S]*?<\/details>/)?.[0] || '';
assert.ok(rail && drawer, 'both Forecast navigation surfaces must exist');
for (const markup of [rail, drawer]) {
  const forecastPosition = markup.indexOf('>2026 Bar Forecast<');
  const quickDrillsPosition = markup.indexOf('>Quick Drills<');
  assert.ok(forecastPosition >= 0 && forecastPosition < quickDrillsPosition,
    'Forecast must appear immediately before Quick Drills');
  assert.doesNotMatch(markup, /data-public-feature="bar-forecast"[^>]*aria-controls=/);
  assert.doesNotMatch(markup, /data-public-feature="bar-forecast"[^>]*aria-haspopup="dialog"/);
}
assert.match(drawer, /id="spa-bar-forecast"[\s\S]*id="spa-bar-easy"/);

assert.match(loader, /forecast:\s*Object\.freeze\([\s\S]*assets\/bar-forecast\.css[\s\S]*assets\/bar-forecast\.js/);
assert.match(loader, /assets\/bar-forecast\.js\?v=exam-tools-20260901-5/);
assert.doesNotMatch(loader, /assets\/bar-forecast\.js\?v=exam-tools-20260901-4/);
assert.match(loader, /'bar-forecast': 'forecast'/);
assert.match(loader, /global\.openBarForecast = deferredFunction\('bar-forecast', 'openBarForecast'\)/);
assert.match(landing, /'bar-forecast-2026': Object\.freeze\(\{ feature: 'bar-forecast', opener: 'openBarForecast' \}\)/);
assert.match(landing, /if \(feature === 'bar-forecast'\)[\s\S]*openBarForecast/);
assert.ok(
  landing.indexOf("if (feature === 'bar-forecast')") < landing.indexOf('await global.DueDiligencePhase2?.whenAuthReady?.();', landing.indexOf('async function openProtectedFeature')),
  'signed-out and unresolved sessions must reach the fail-closed preview without waiting on auth',
);
assert.match(shell, /'#bar-forecast-2026': 'bar-forecast'/);

assert.match(forecast, /const ENDPOINT = '\/admin\/dd2026\/bar-forecast'/);
assert.match(forecast, /const CONSENT_VERSION = '2026-09-01'/);
assert.match(forecast, /const REQUIRED_QUESTION_COUNT = 20/);
assert.match(forecast, /const MINIMUM_WORDS = 10/);
assert.match(forecast, /const MAX_ANSWER_CHARACTERS = 6000/);
assert.match(forecast, /const SOURCE_VERSION = '2026\.3'/);
assert.match(forecast, /const CONTENT_TYPE = 'bar_forecast_question'/);
assert.match(forecast, /payload\?\.sourceVersion !== SOURCE_VERSION/);
assert.match(forecast, /\|\| syntheticQaContent\) \{/);
assert.doesNotMatch(
  forecast,
  /isExplicitLoopbackQaHarness|__DD_BAR_FORECAST_SYNTHETIC_QA__|ddBarForecastQa|\|\| false\) \{/,
  'the production Forecast runtime must never contain a synthetic-QA bypass',
);
assert.match(forecast, /editor\.contentEditable = 'true'/);
assert.match(forecast, /editor\.setAttribute\('role', 'textbox'\)/);
assert.match(forecast, /editor\.spellcheck = true/);
assert.match(forecast, /operation:\s*'status'/);
assert.match(forecast, /operation:\s*'accept', version:\s*CONSENT_VERSION/);
assert.match(forecast, /operation:\s*'start', subject:\s*subjectName/);
assert.match(
  forecast,
  /async function startSubject\(subjectName, trigger\) \{[\s\S]*const payload = await requestForecast\(\{ operation: 'start', subject: subjectName \}\);[\s\S]*const setId = String\(payload\?\.setId \|\| ''\)\.trim\(\)\.toLowerCase\(\);[\s\S]*state\.setId = setId;/,
  'the validated start-response setId must be bound to the active Forecast attempt',
);
assert.ok(
  forecast.includes("if (!/^sha256:[0-9a-f]{64}$/u.test(setId)) {"),
  'the start-response setId must pass the exact SHA-256 identity format before use',
);
assert.match(
  forecast,
  /async function submitForecast\(\) \{[\s\S]*const submittedSubject = state\.subject;[\s\S]*const payload = await requestForecast\(\{\s*operation: 'submit',\s*subject: submittedSubject,\s*setId: state\.setId,\s*answers: submittedAnswers,/,
  'submission must send the setId issued for the active start response',
);
assert.match(forecast, /refs\.submit\.disabled = !allAnswersComplete\(\)/);
assert.match(forecast, /payload\?\.authorized !== true/);
assert.match(
  forecast,
  /ensureRequiredSetup\(ROUTE\)[\s\S]*setupReady !== true[\s\S]*Complete the required account setup/,
  'Forecast authorization must stop at the setup-only gate before requesting protected status',
);
assert.match(forecast, /global\.addEventListener\('duediligence:access', handleForecastAccessChange\)/);
assert.match(
  phase4,
  /async function ensureRequiredSetup\(routeHash = location\.hash\)[\s\S]*request\('\/access'[\s\S]*payload\?\.access[\s\S]*adoptAccess\(payload\.access[\s\S]*setupRequired\(access\)[\s\S]*openRequiredSetup\(access, routeHash\)/,
);
assert.match(phase4, /ensureProtectedAccess,[\s\S]*ensureRequiredSetup,/);
assert.doesNotMatch(phase4, /acceptCurrentTerms/);
assert.match(forecast, /payload\?\.consentAccepted === true/);
assert.match(forecast, /active paid members, Founding Beta members, and authorized Due Diligence administrators/);
assert.match(forecast, /server confirms paid, Founding Beta, or administrator access/);
assert.match(forecast, /renderPreview\(\{ checking: true \}\)/);
assert.match(
  forecast,
  /renderPreview\(\{ checking: true \}\);[\s\S]*state\.authorizationOwnerId = ownerId;[\s\S]*requestForecast\(\{ operation: 'status' \}\)/,
  'authorization must claim the pending owner before awaiting status',
);
assert.match(
  forecast,
  /nextOwnerId === state\.ownerId[\s\S]*nextOwnerId === state\.authorizationOwnerId/,
  'same-owner session refreshes must preserve both settled and pending authorization',
);
assert.match(forecast, /async function openForecast\(trigger = null\) \{[\s\S]*ensureRoot\(\);[\s\S]*if \(state\.isOpen\) \{/);
assert.match(
  forecast,
  /if \(state\.isOpen\) \{[\s\S]*ownerId !== state\.ownerId[\s\S]*await checkAuthorization\(\)/,
  'an already-open Forecast must recheck a newly restored signed-in owner',
);
assert.match(forecast, /recoverAuthorizationAfterAuthReady\(\)/);
assert.match(forecast, /state\.root\.hidden = true[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/);
assert.match(forecast, /event\.key === 'Escape'/);
assert.match(forecast, /<section class="bf26-page" aria-labelledby="bf26-page-title"/);
assert.match(forecast, /<main class="bf26-view" data-bf26-view aria-labelledby="bf26-page-title"><\/main>/);
assert.doesNotMatch(forecast, /role="dialog"|aria-modal/);
assert.match(forecast, /document\.body\.classList\.add\('bf26-page-open'\)/);
assert.match(forecast, /entry\.node\.dataset\.bf26PageInert = 'true'/);
assert.match(forecast, /global\.syncModalIsolation\?\.\(\)/);
assert.match(html, /child\.dataset\.bf26PageInert === 'true'/);
assert.doesNotMatch(forecast, /localStorage|sessionStorage/);
assert.doesNotMatch(forecast, /\bALAC\b|legal[_ ]basis|controlling[_ ]doctrine|prediction score|transparent rubric/i);
assert.doesNotMatch(forecast, /wallyesteban1993\.workers\.dev|supabase\.co/i);
assert.doesNotMatch(forecast, /AI-assisted|editorial indicators/i);
for (const exactNoticeCopy of [
  'Notice & Disclaimer',
  'This pilot program is designed to train issue-spotting skills using question sets aligned with historical exam patterns, cases associated with the 2026 Bar Chairperson, and independent legal research.',
  'By proceeding, you acknowledge and agree to the following:',
  'Not Official Material',
  'All forecast questions and study content are independently created. They are not official Supreme Court questions, leaks, or confidential materials.',
  'No Warranties or Guarantees',
  'Topic predictions are instructional aids, not an exact science. Predicted topics do not guarantee or promise appearance in the 2026 Bar Examinations.',
  'Educational Use Only',
  'Suggested answers, feedback, and scoring may contain errors and do not constitute legal advice.',
  'Authoritative Sources',
  'Official Supreme Court Bar bulletins, syllabi, statutes, rules, and controlling jurisprudence remain the sole authoritative references.',
]) assert.ok(forecast.includes(exactNoticeCopy), `Forecast notice must include exact copy: ${exactNoticeCopy}`);
assert.match(forecast, /const decline = makeButton\('Decline'\)/);
assert.match(forecast, /decline\.addEventListener\('click', \(\) => closeForecast\(\)\)/);
assert.match(forecast, /const accept = makeButton\('I Understand & Agree'/);
assert.match(
  forecast,
  /accept\.addEventListener\('click', async \(\) => \{[\s\S]*requestForecast\(\{ operation: 'accept', version: CONSENT_VERSION \}\)[\s\S]*state\.consentAccepted = true;[\s\S]*renderSubjectPicker\(\)/,
  'only the explicit agreement action may record consent and open subject selection',
);
assert.match(forecast, /accept\.setAttribute\('aria-busy', 'true'\)/);
assert.match(forecast, /accept\.setAttribute\('aria-busy', 'false'\)/);
assert.match(forecast, /actions\.append\(decline, accept\)/);
assert.doesNotMatch(forecast, /bar-forecast-disclaimer|Accept and choose a subject|Return to preview/);
assert.match(forecast, /appendResultSection\(body, 'Question', state\.questions\[index\]\?\.prompt/);

for (const subject of [
  'Political and Public International Law',
  'Commercial and Taxation Laws',
  'Civil Law and Land Titles and Deeds',
  'Labor Law and Social Legislation',
  'Criminal Law',
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises',
]) assert.match(forecast, new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
for (const date of ['September 6, 2026', 'September 9, 2026', 'September 13, 2026']) {
  assert.match(forecast, new RegExp(date));
}
assert.match(forecast, /8:00 AM–12:00 NN \(Manila time\)/);
assert.match(forecast, /2:00 PM–6:00 PM \(Manila time\)/);
assert.match(forecast, /simulation may be taken anytime/i);

for (const allowedResultField of [
  'Question',
  'Total grade',
  'Feedback',
  'Your answer',
  'Suggested answer',
  'Explanation',
]) assert.match(forecast, new RegExp(allowedResultField, 'i'));

assert.match(styles, /data-public-feature="bar-forecast"/);
assert.match(styles, /@keyframes bf26-radiate/);
assert.match(
  styles,
  /body\.bf26-page-open > :not\(\.bf26-root\):not\(\.dd2-overlay\.is-open\):not\(\.modal-overlay\.open\):not\(#private-beta-dialog\[open\]\):not\(#dd-maintenance-gate\)/,
);
assert.match(
  styles,
  /body\.bf26-page-open > :is\(\.dd2-overlay\.is-open, \.modal-overlay\.open, #dd-maintenance-gate\)[\s\S]*z-index:\s*16000/,
);
assert.match(styles, /margin:\s*3px 3px 7px/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles, /\.bf26-exam-workspace[\s\S]*grid-template-columns/);
assert.match(styles, /\.bf26-question-list/);
assert.match(styles, /\.bf26-exam\s*\{[\s\S]*grid-template-columns:\s*124px minmax\(0, 1fr\)/);
assert.match(styles, /\.bf26-exam\s*\{[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/);
assert.match(styles, /\.bf26-exam-nav\s*\{[\s\S]*background:\s*#e8f0f7/);
assert.match(styles, /\.bf26-question-list\s*\{[\s\S]*grid-template-columns:\s*1fr/);
assert.match(styles, /\.bf26-question-jump\s*\{[\s\S]*border:\s*2px solid #2f6d9f/);
assert.match(styles, /\.bf26-question-jump\[hidden\]\s*\{[\s\S]*display:\s*none !important/);
assert.match(styles, /\.bf26-exam-workspace\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(360px, 1fr\)/);
assert.match(styles, /\.bf26-exam-main\s*\{[\s\S]*overflow:\s*hidden[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
assert.match(styles, /\.bf26-exam-workspace\s*\{[\s\S]*overflow:\s*auto/);
assert.match(styles, /\.bf26-exam-footer\s*\{[\s\S]*background:\s*#e7f0f7/);
assert.match(forecast, /Blue marks a complete answer\. Gold marks the current question\. A flag marks a question for review\./);
assert.match(styles, /\.bf26-preview-grid\s*\{[\s\S]*min-width:\s*0/);
assert.match(styles, /@media \(max-width: 840px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);

assert.match(forecast, /state\.flaggedQuestions = new Set\(\)/);
assert.match(forecast, /\['flagged', 'Flagged'\]/);
assert.match(forecast, /assets\/icons\/navigation\/flag\.svg/);
assert.match(forecast, /state\.questionHighlights/);
assert.match(forecast, /renderPromptHighlights/);
assert.match(forecast, /document\.createTextNode/);
assert.match(forecast, /element\('mark', 'bf26-question-highlight'/);
assert.match(forecast, /answerCommandButton\('B', 'bold'/);
assert.match(forecast, /answerCommandButton\('I', 'italic'/);
assert.match(forecast, /answerCommandButton\('U', 'underline'/);
assert.match(forecast, /answerCommandButton\('Undo', 'undo'/);
assert.match(forecast, /answerCommandButton\('Redo', 'redo'/);
assert.match(forecast, /answerCommandButton\('Bullets', 'insertUnorderedList'/);
assert.match(forecast, /answerCommandButton\('Numbered', 'insertOrderedList'/);
assert.match(forecast, /button\.setAttribute\('aria-pressed', 'false'\)/);
assert.match(forecast, /document\.queryCommandState\(button\.dataset\.answerCommand\)/);
assert.match(styles, /\.bf26-editor-button\[aria-pressed="true"\]/);
assert.match(forecast, /Characters without spaces/);
assert.match(forecast, /refs\.next\.hidden = lastQuestion \|\| nextIndex < 0/);
assert.match(forecast, /refs\.showAll\.hidden = lastQuestion \|\| nextIndex >= 0 \|\| state\.questionFilter === 'all'/);
assert.match(forecast, /refs\.submit\.hidden = !lastQuestion/);
assert.match(forecast, /state\.viewNode\?\.replaceChildren\(\)/);
assert.match(forecast, /if \(!closeForecast\(\{ restoreRoute: false \}\)\) recoverBlockedForecastRoute\(\)/);
assert.doesNotMatch(forecast, /closeForecast\(\{ force: true, restoreRoute: false \}\)/);
assert.match(forecast, /global\.addEventListener\('beforeunload'[\s\S]*state\.view !== 'submitting'[\s\S]*!hasDraftAnswers\(\)/);
assert.match(forecast, /editor\.addEventListener\('drop'[\s\S]*event\.preventDefault\(\)/);
assert.match(forecast, /editor\.addEventListener\('blur', \(\) => sanitizeEditorDom\(editor\)\)/);
assert.match(forecast, /appendResultSection\(body, 'Your answer', result\.userAnswer, state\.answerMarkup\.get\(result\.questionId\)\)/);
assert.match(styles, /\.bf26-editor-toolbar/);
assert.match(styles, /\.bf26-question-highlight\[data-color="yellow"\]/);
assert.match(styles, /resize:\s*vertical/);
assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.bf26-question-list\s*\{[\s\S]*display:\s*flex[\s\S]*flex-wrap:\s*nowrap[\s\S]*overflow-x:\s*auto/);

for (const source of [build, serviceWorker]) {
  assert.match(source, /assets\/bar-forecast\.css/);
  assert.match(source, /assets\/bar-forecast\.js/);
  assert.match(source, /assets\/bar-forecast\/forecast-workspace-preview\.webp/);
}
assert.match(build, /'flag\.svg'/);
assert.match(html, /assets\/feature-loader\.js[^"\n]*forecast=member-access-20260901-1/);
assert.match(serviceWorker, /duediligence-shell-20260901-forecast-member-access-1/);
assert.match(serviceWorker, /assets\/feature-loader\.js[^'\n]*forecast=member-access-20260901-1/);
assert.match(serviceWorker, /assets\/bar-forecast\.js\?v=exam-tools-20260901-5/);
assert.doesNotMatch(serviceWorker, /assets\/bar-forecast\.js\?v=exam-tools-20260901-4/);
assert.match(serviceWorker, /assets\/icons\/navigation\/flag\.svg/);
assert.match(qaHarness, /dataset\.ddBarForecastQa = 'synthetic'/);
assert.match(qaHarness, /__DD_BAR_FORECAST_SYNTHETIC_QA__ = '2026-09-01'/);
assert.match(qaHarness, /Synthetic UI QA harness — not real Forecast questions or grading/);
assert.doesNotMatch(qaHarness, /window\.openBarForecast\?\.\(document\.getElementById\('open-forecast'\)\)/);
assert.doesNotMatch(build, /content\/duediligence-2026\/bar-forecast\.json/);

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, 'u').exec(source);
  assert.ok(match, `Missing function ${name}.`);
  const start = match.index;
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unbalanced function ${name}.`);
}

// Forecast owns the background isolation while it is open. A mandatory global
// gate must temporarily become the only interactive body child, then return
// control without leaving either layer inert or changing pre-existing owners.
{
  const background = { inert: false, dataset: {}, contains: () => false };
  const preexisting = { inert: true, dataset: {}, contains: () => false };
  const overlay = {
    inert: false,
    dataset: {},
    contains(node) { return node === this; },
    getAttribute: () => 'false',
  };
  const rootNode = { inert: false, dataset: {}, contains(node) { return node === this; } };
  const classes = new Set();
  let overlayOpen = false;
  const isolationContext = vm.createContext({
    state: { root: rootNode, isolation: [], previousOverflow: '' },
    document: {
      documentElement: { dataset: {} },
      body: {
        children: [background, preexisting, overlay, rootNode],
        style: { overflow: '' },
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
        },
      },
      querySelector: () => null,
      querySelectorAll: () => (overlayOpen ? [overlay] : []),
    },
    global: {},
  });
  vm.runInContext(extractNamedFunction(html, 'syncModalIsolation'), isolationContext);
  vm.runInContext('global.syncModalIsolation = syncModalIsolation', isolationContext);
  vm.runInContext(extractNamedFunction(forecast, 'isolatePage'), isolationContext);

  vm.runInContext('isolatePage(true)', isolationContext);
  assert.equal(rootNode.inert, false, 'Forecast must be interactive without a global gate');
  assert.equal(background.inert, true);
  assert.equal(overlay.inert, true);
  assert.equal(preexisting.inert, true);
  assert.equal(overlay.dataset.bf26PageInert, 'true');

  overlayOpen = true;
  vm.runInContext('syncModalIsolation()', isolationContext);
  assert.equal(rootNode.inert, true, 'the mandatory gate must isolate Forecast');
  assert.equal(rootNode.dataset.ddModalInert, 'true');
  assert.equal(overlay.inert, false, 'the mandatory gate must remain actionable');
  assert.equal(background.inert, true);
  assert.equal(preexisting.inert, true);

  overlayOpen = false;
  vm.runInContext('syncModalIsolation()', isolationContext);
  assert.equal(rootNode.inert, false, 'Forecast must resume after the mandatory gate closes');
  assert.equal(rootNode.dataset.ddModalInert, undefined);
  assert.equal(overlay.inert, true, 'closed Forecast siblings remain isolated');

  vm.runInContext('isolatePage(false)', isolationContext);
  assert.equal(background.inert, false);
  assert.equal(overlay.inert, false);
  assert.equal(preexisting.inert, true, 'pre-existing inert ownership must be preserved');
  assert.equal(classes.has('bf26-page-open'), false);

  // If Forecast opens while a global gate already owns the background, it
  // adopts only that modal-owned inert state. Once the gate closes, Forecast
  // must keep its hidden siblings isolated until Forecast itself closes.
  overlayOpen = true;
  background.inert = true;
  background.dataset.ddModalInert = 'true';
  overlay.inert = false;
  rootNode.inert = false;
  vm.runInContext('isolatePage(true)', isolationContext);
  overlayOpen = false;
  vm.runInContext('syncModalIsolation()', isolationContext);
  assert.equal(background.inert, true, 'Forecast must retain background isolation after a pre-open gate closes');
  assert.equal(background.dataset.bf26PageInert, 'true');
  assert.equal(preexisting.inert, true);
  vm.runInContext('isolatePage(false)', isolationContext);
  assert.equal(background.inert, false);
  assert.equal(background.dataset.ddModalInert, undefined);
  assert.equal(preexisting.inert, true);
}

// Reproduce the live failure deterministically: a same-user session event lands
// while the first authorization status request is unresolved. It must neither
// abort that request nor start a duplicate that can replace the consent button.
function authorizationHarness(options = {}) {
  let currentOwnerId = 'admin-a';
  const state = {
    isOpen: true,
    ownerId: '',
    authorizationOwnerId: '',
    authorizationRetryRequested: false,
    authorizationRetryInProgress: false,
    consentAccepted: false,
  };
  const observations = {
    aborts: 0,
    requests: 0,
    disclaimers: 0,
    pickers: 0,
    setupChecks: 0,
  };
  const responses = [];
  const context = vm.createContext({
    ROUTE: '#bar-forecast-2026',
    state,
    global: {
      DueDiligencePhase4: {
        ensureRequiredSetup: async () => {
          observations.setupChecks += 1;
          return options.setupReady !== false;
        },
      },
    },
    runtimeOwnerId: () => currentOwnerId,
    runtimeSession: () => (currentOwnerId
      ? { access_token: 'test-token', user: { id: currentOwnerId } }
      : null),
    renderPreview: () => {},
    requestForecast: () => {
      observations.requests += 1;
      let resolve;
      const promise = new Promise((accept) => { resolve = accept; });
      responses.push({ promise, resolve });
      return promise;
    },
    renderSubjectPicker: () => { observations.pickers += 1; },
    renderDisclaimer: () => { observations.disclaimers += 1; },
    abortRequest: () => { observations.aborts += 1; },
    resetProtectedState: () => {
      state.ownerId = '';
      state.authorizationOwnerId = '';
    },
  });
  vm.runInContext(extractNamedFunction(forecast, 'checkAuthorization'), context);
  vm.runInContext(extractNamedFunction(forecast, 'handleForecastSessionChange'), context);
  vm.runInContext(extractNamedFunction(forecast, 'setupReadyFromAccessEvent'), context);
  vm.runInContext(extractNamedFunction(forecast, 'handleForecastAccessChange'), context);
  return {
    context,
    state,
    observations,
    responses,
    setOwner: (ownerId) => { currentOwnerId = ownerId; },
  };
}

const readyAccessEvent = Object.freeze({
  role: 'admin',
  basis: 'introductory_tokens',
  termsRequired: false,
  reauthenticationRequired: false,
  profileCompleted: true,
  tokenAcknowledgementRequired: false,
});

{
  const completeAccess = (overrides = {}) => ({
    role: 'admin',
    basis: 'introductory_tokens',
    termsRequired: false,
    reauthenticationRequired: false,
    profileCompleted: true,
    tokenAcknowledgementRequired: false,
    paidSubscriptionExpired: false,
    commercialLaunchEnabled: true,
    paymentRequired: true,
    needsSetup: false,
    ...overrides,
  });
  let access = completeAccess();
  const setupChecks = { opened: 0, routeHash: '' };
  const setupContext = vm.createContext({
    location: { hash: '#bar-forecast-2026' },
    session: () => ({ access_token: 'test-session' }),
    request: async () => ({ access }),
    adoptAccess: (candidate) => candidate,
    setupRequired: (candidate) => candidate.needsSetup === true,
    openRequiredSetup: (_candidate, routeHash) => {
      setupChecks.opened += 1;
      setupChecks.routeHash = routeHash;
    },
  });
  vm.runInContext(extractNamedFunction(phase4, 'ensureRequiredSetup'), setupContext);
  assert.equal(
    await vm.runInContext("ensureRequiredSetup('#bar-forecast-2026')", setupContext),
    true,
    'payment state alone must not replace the independent member Forecast authorization',
  );
  assert.equal(setupChecks.opened, 0);
  access = { role: 'admin', basis: 'introductory_tokens' };
  assert.equal(
    await vm.runInContext("ensureRequiredSetup('#bar-forecast-2026')", setupContext),
    false,
    'partial access data must fail closed',
  );
  access = null;
  assert.equal(
    await vm.runInContext("ensureRequiredSetup('#bar-forecast-2026')", setupContext),
    false,
    'missing access data must fail closed',
  );
  assert.equal(setupChecks.opened, 0);
  access = completeAccess({ needsSetup: true });
  assert.equal(
    await vm.runInContext("ensureRequiredSetup('#bar-forecast-2026')", setupContext),
    false,
  );
  assert.equal(setupChecks.opened, 1);
  assert.equal(setupChecks.routeHash, '#bar-forecast-2026');
}

const sameOwner = authorizationHarness();
const pendingAuthorization = vm.runInContext('checkAuthorization()', sameOwner.context);
assert.equal(sameOwner.state.authorizationOwnerId, 'admin-a');
vm.runInContext('handleForecastSessionChange()', sameOwner.context);
assert.equal(sameOwner.observations.aborts, 0, 'a same-owner refresh must not abort pending authorization');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sameOwner.observations.requests, 1);
assert.equal(sameOwner.observations.requests, 1, 'a same-owner refresh must not duplicate pending authorization');
sameOwner.responses[0].resolve({ authorized: true, consentAccepted: false });
assert.equal(await pendingAuthorization, true);
assert.equal(sameOwner.state.ownerId, 'admin-a');
assert.equal(sameOwner.state.authorizationOwnerId, '');
assert.equal(sameOwner.observations.disclaimers, 1);

const queuedAccess = authorizationHarness();
const firstQueuedAuthorization = vm.runInContext('checkAuthorization()', queuedAccess.context);
await new Promise((resolve) => setImmediate(resolve));
queuedAccess.context.readyAccessEvent = readyAccessEvent;
assert.equal(
  vm.runInContext('setupReadyFromAccessEvent(readyAccessEvent)', queuedAccess.context),
  true,
  'a ready access event may omit payment-only policy fields',
);
vm.runInContext('handleForecastAccessChange({ detail: readyAccessEvent })', queuedAccess.context);
assert.equal(queuedAccess.state.authorizationRetryRequested, true);
assert.equal(queuedAccess.observations.requests, 1, 'the access event must not overlap the pending request');
queuedAccess.responses[0].resolve({ authorized: false, consentAccepted: false });
assert.equal(await firstQueuedAuthorization, true);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(queuedAccess.observations.requests, 2, 'one setup-ready access event must queue one retry');
queuedAccess.responses[1].resolve({ authorized: true, consentAccepted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(queuedAccess.state.ownerId, 'admin-a');
assert.equal(queuedAccess.observations.requests, 2, 'the queued retry must never loop');

{
  let restoredOwner = '';
  let resolveReady;
  let checks = 0;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const authReadyContext = vm.createContext({
    state: { isOpen: true, ownerId: '', authorizationOwnerId: '' },
    global: { DueDiligencePhase2: { whenAuthReady: () => ready } },
    runtimeOwnerId: () => restoredOwner,
    checkAuthorization: () => { checks += 1; },
  });
  vm.runInContext(extractNamedFunction(forecast, 'recoverAuthorizationAfterAuthReady'), authReadyContext);
  vm.runInContext('recoverAuthorizationAfterAuthReady()', authReadyContext);
  restoredOwner = 'restored-admin';
  resolveReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1, 'a missed session event must be recovered once auth restoration finishes');
}

const setupBlocked = authorizationHarness({ setupReady: false });
assert.equal(await vm.runInContext('checkAuthorization()', setupBlocked.context), true);
assert.equal(setupBlocked.observations.setupChecks, 1);
assert.equal(setupBlocked.observations.requests, 0, 'setup-required accounts must not reach Forecast status');
assert.equal(setupBlocked.observations.disclaimers, 0, 'Forecast consent must stay closed during setup');
assert.equal(setupBlocked.state.ownerId, '');

const signedOut = authorizationHarness();
const staleSignedOutAuthorization = vm.runInContext('checkAuthorization()', signedOut.context);
await new Promise((resolve) => setImmediate(resolve));
signedOut.setOwner('');
vm.runInContext('handleForecastSessionChange()', signedOut.context);
assert.equal(signedOut.observations.aborts, 1, 'sign-out must abort pending authorization');
assert.equal(signedOut.observations.requests, 1, 'sign-out must not begin another status request');
signedOut.responses[0].resolve({ authorized: true, consentAccepted: true });
assert.equal(await staleSignedOutAuthorization, false);
assert.equal(signedOut.state.ownerId, '', 'a stale response must not restore the signed-out owner');
assert.equal(signedOut.observations.pickers, 0, 'a stale response must not expose subject selection');

const changedOwner = authorizationHarness();
const staleChangedOwnerAuthorization = vm.runInContext('checkAuthorization()', changedOwner.context);
await new Promise((resolve) => setImmediate(resolve));
changedOwner.setOwner('admin-b');
vm.runInContext('handleForecastSessionChange()', changedOwner.context);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(changedOwner.observations.aborts, 1, 'an account change must abort pending authorization');
assert.equal(changedOwner.observations.requests, 2, 'an account change must check the new owner exactly once');
changedOwner.responses[0].resolve({ authorized: true, consentAccepted: true });
assert.equal(await staleChangedOwnerAuthorization, false);
assert.notEqual(changedOwner.state.ownerId, 'admin-a', 'a stale response must not authorize the old owner');
changedOwner.responses[1].resolve({ authorized: true, consentAccepted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(changedOwner.state.ownerId, 'admin-b');
assert.equal(changedOwner.observations.disclaimers, 1);

assert.equal(
  createHash('sha256').update(preview).digest('hex').toUpperCase(),
  '8D3A68F68AD252EB88AB8DABDFF2A57DC41EF603A7948A79917EF73DE9BBD4B3',
);

console.log('2026 Bar Forecast frontend contract checks passed.');
