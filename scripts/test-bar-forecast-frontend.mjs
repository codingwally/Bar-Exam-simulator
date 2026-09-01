import assert from 'node:assert/strict';
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
assert.match(loader, /assets\/bar-forecast\.js\?v=access-flow-20260902-1/);
assert.match(loader, /assets\/bar-forecast\.css\?v=access-flow-20260902-1/);
assert.doesNotMatch(loader, /assets\/bar-forecast\.(?:js|css)\?v=exam-tools-20260901-[45]/);
assert.match(loader, /'bar-forecast': 'forecast'/);
assert.match(loader, /global\.openBarForecast = deferredFunction\('bar-forecast', 'openBarForecast'\)/);
assert.match(landing, /'bar-forecast-2026': Object\.freeze\(\{ feature: 'bar-forecast', opener: 'openBarForecast' \}\)/);
assert.match(landing, /if \(feature === 'bar-forecast'\)[\s\S]*openBarForecast/);
assert.ok(
  landing.indexOf('await global.DueDiligencePhase2?.whenAuthReady?.();', landing.indexOf('async function openProtectedFeature'))
    < landing.indexOf("if (feature === 'bar-forecast')"),
  'Forecast must finish ordinary session restoration before it opens its server-authorized workspace',
);
assert.doesNotMatch(landing, /Check admin access|Coming soon/i);
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
assert.doesNotMatch(forecast, /Coming soon|Check admin access|Checking admin access/i);
assert.doesNotMatch(forecast, /function renderPreview\b|forecast-workspace-preview\.webp/);
assert.match(forecast, /function renderAccessProgress\b/);
assert.match(forecast, /BAR_FORECAST_ACCESS_REQUIRED/);
assert.match(forecast, /function routeToPlansAndPricing\b/);
assert.match(
  forecast,
  /renderAccessProgress\([\s\S]*state\.authorizationOwnerId = ownerId;[\s\S]*requestForecast\(\{ operation: 'status' \}\)/,
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
  /async function openForecast\(trigger = null\) \{[\s\S]*if \(!runtimeOwnerId\(\) \|\| !runtimeSession\(\)\?\.access_token\) \{[\s\S]*openForecastSignIn\(\);[\s\S]*return true;/,
  'a direct signed-out Forecast open must use the ordinary sign-in flow before mounting protected UI',
);
assert.match(
  forecast,
  /if \(state\.isOpen\) \{[\s\S]*ownerId !== state\.ownerId[\s\S]*await checkAuthorization\(\)/,
  'an already-open Forecast must recheck a newly restored signed-in owner',
);
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
  'Mock Bar practice score',
  'Mock Bar coaching',
  'Performance analytics',
  'Issue spotting',
  'Grammar and clarity',
  'Your answer',
  'Suggested answer',
  'Score rationale',
]) assert.match(forecast, new RegExp(allowedResultField, 'i'));

assert.match(forecast, /educational practice diagnostic, not an official Bar grade/i);
assert.match(forecast, /Issue spotting and grammar help diagnose writing habits; they do not change the 100-point practice score/i);
assert.match(forecast, /detailed coaching report may take several minutes/i);
assert.match(forecast, /submissionTimer/);
assert.match(forecast, /state\.closeButton\.disabled = grading/);
assert.match(forecast, /Exit unavailable while grading is in progress/);
assert.match(forecast, /submissionElapsedNode\.setAttribute\('aria-hidden', 'true'\)/);
assert.match(forecast, /computedTotal !== totalScore/);
assert.match(forecast, /userAnswer\.includes\(original\)/);
assert.match(styles, /\.bf26-report-overview/);
assert.match(styles, /\.bf26-diagnostic-columns/);
assert.match(styles, /\.bf26-result summary::marker/);
assert.match(styles, /\.bf26-result-summary-row[\s\S]*display:\s*flex/);
assert.match(styles, /\.bf26-result-section p[\s\S]*overflow-wrap:\s*anywhere/);
assert.match(styles, /@media \(max-width: 360px\)[\s\S]*\.bf26-metric-grid/);

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

{
  const pricingCalls = { closes: 0, opens: 0, toasts: 0, fallback: 0 };
  const pricingContext = vm.createContext({
    state: { pricingRedirectInProgress: false },
    global: {
      DueDiligencePhase4: {
        openView: (view, options) => {
          pricingCalls.opens += 1;
          pricingCalls.view = view;
          pricingCalls.options = options;
        },
      },
      toast: () => { pricingCalls.toasts += 1; },
      dispatchEvent: () => { pricingCalls.fallback += 1; },
    },
    closeForecast: (options) => {
      pricingCalls.closes += 1;
      pricingCalls.closeOptions = options;
      return true;
    },
    history: { replaceState: () => { pricingCalls.fallback += 1; } },
    location: { pathname: '/', search: '' },
    Event,
  });
  vm.runInContext(extractNamedFunction(forecast, 'routeToPlansAndPricing'), pricingContext);
  assert.equal(vm.runInContext('routeToPlansAndPricing()', pricingContext), true);
  assert.equal(vm.runInContext('routeToPlansAndPricing()', pricingContext), true);
  assert.equal(pricingCalls.closeOptions.force, true);
  assert.equal(pricingCalls.closeOptions.restoreRoute, false);
  assert.equal(pricingCalls.closes, 1, 'repeated access denials must close Forecast only once');
  assert.equal(pricingCalls.opens, 1, 'repeated access denials must open Plans & Pricing only once');
  assert.equal(pricingCalls.view, 'pricing');
  assert.equal(pricingCalls.options.returnToQuorum, true);
  assert.equal(pricingCalls.toasts, 1);
  assert.equal(pricingCalls.fallback, 0);
}

{
  const denialContext = vm.createContext({ Number, String });
  vm.runInContext(extractNamedFunction(forecast, 'isForecastAccessRequired'), denialContext);
  denialContext.exact = { status: 403, code: 'BAR_FORECAST_ACCESS_REQUIRED' };
  denialContext.setup = { status: 403, code: 'BAR_FORECAST_SETUP_REQUIRED' };
  denialContext.generic = { status: 403, code: 'REQUEST_FAILED' };
  assert.equal(vm.runInContext('isForecastAccessRequired(exact)', denialContext), true);
  assert.equal(vm.runInContext('isForecastAccessRequired(setup)', denialContext), false);
  assert.equal(vm.runInContext('isForecastAccessRequired(generic)', denialContext), false);
}
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
assert.doesNotMatch(
  extractNamedFunction(forecast, 'submitForecast'),
  /closeForecast\(\{ force: true, restoreRoute: false \}\)/,
  'a failed submission must never force-close a member draft',
);
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
}
assert.match(build, /'flag\.svg'/);
assert.match(html, /assets\/feature-loader\.js[^"\n]*forecast=access-flow-20260902-1/);
assert.match(html, /assets\/feature-loader\.js[^"\n]*coaching=report-20260901-1/);
assert.match(serviceWorker, /duediligence-shell-access-flow-20260902-1/);
assert.match(serviceWorker, /assets\/feature-loader\.js[^'\n]*forecast=access-flow-20260902-1/);
assert.match(serviceWorker, /assets\/feature-loader\.js[^'\n]*coaching=report-20260901-1/);
assert.match(serviceWorker, /assets\/bar-forecast\.js\?v=access-flow-20260902-1/);
assert.match(serviceWorker, /assets\/bar-forecast\.css\?v=access-flow-20260902-1/);
assert.doesNotMatch(serviceWorker, /assets\/bar-forecast\.(?:js|css)\?v=exam-tools-20260901-[45]/);
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

{
  const accessClassifier = vm.createContext({});
  vm.runInContext(extractNamedFunction(forecast, 'isForecastAccessRequired'), accessClassifier);
  accessClassifier.exactDenial = { status: 403, code: 'BAR_FORECAST_ACCESS_REQUIRED' };
  accessClassifier.otherForbidden = { status: 403, code: 'PROFILE_COMPLETION_REQUIRED' };
  accessClassifier.outage = { status: 503, code: 'BAR_FORECAST_UNAVAILABLE' };
  assert.equal(vm.runInContext('isForecastAccessRequired(exactDenial)', accessClassifier), true);
  assert.equal(vm.runInContext('isForecastAccessRequired(otherForbidden)', accessClassifier), false);
  assert.equal(vm.runInContext('isForecastAccessRequired(outage)', accessClassifier), false);

  const pricingRouteSource = extractNamedFunction(forecast, 'routeToPlansAndPricing');
  assert.match(pricingRouteSource, /if \(state\.pricingRedirectInProgress\) return true;[\s\S]*state\.pricingRedirectInProgress = true;/,
    'repeated authorization events must not open duplicate pricing views');
  assert.match(pricingRouteSource, /closeForecast\([\s\S]*restoreRoute:\s*false/,
    'pricing navigation must close the protected Forecast surface without restoring its route');
  assert.match(pricingRouteSource, /openView\(\s*['"]pricing['"]/,
    'the exact unpaid denial must open the existing Plans & Pricing view');
}

async function runLandingForecastFlow(authenticated) {
  const observations = {
    authReady: 0,
    authPrompts: 0,
    loads: 0,
    openers: 0,
    genericProtectedChecks: 0,
  };
  const state = { lastActivatedHash: '' };
  const context = vm.createContext({
    state,
    global: {
      DueDiligencePhase2: {
        whenAuthReady: async () => { observations.authReady += 1; },
        openSignIn: () => { observations.authPrompts += 1; },
      },
      DueDiligencePhase4: {
        requireAuthentication: () => {
          if (authenticated) return true;
          observations.authPrompts += 1;
          return false;
        },
        ensureProtectedAccess: async () => {
          observations.genericProtectedChecks += 1;
          return true;
        },
      },
    },
    currentSession: () => (authenticated ? { access_token: 'test-session' } : null),
    loadFeature: async () => { observations.loads += 1; return true; },
    invokePublicOpener: async () => { observations.openers += 1; return true; },
    showApplication: () => {},
  });
  vm.runInContext(extractNamedFunction(landing, 'openProtectedFeature'), context);
  const result = await vm.runInContext("openProtectedFeature('bar-forecast')", context);
  return { observations, result, state };
}

{
  const signedOutForecast = await runLandingForecastFlow(false);
  assert.equal(signedOutForecast.observations.authReady, 1);
  assert.equal(signedOutForecast.observations.authPrompts, 1,
    'signed-out Forecast navigation must invoke the ordinary sign-in flow exactly once');
  assert.equal(signedOutForecast.observations.loads, 0,
    'signed-out navigation must not load the protected Forecast runtime');
  assert.equal(signedOutForecast.observations.openers, 0,
    'signed-out navigation must not open any Forecast surface');
  assert.equal(signedOutForecast.result, false);

  const signedInForecast = await runLandingForecastFlow(true);
  assert.equal(signedInForecast.observations.authReady, 1);
  assert.equal(signedInForecast.observations.authPrompts, 0);
  assert.equal(signedInForecast.observations.loads, 1);
  assert.equal(signedInForecast.observations.openers, 1);
  assert.equal(signedInForecast.observations.genericProtectedChecks, 0,
    'Forecast eligibility must remain owned by its dedicated fail-closed server gate');
  assert.equal(signedInForecast.state.lastActivatedHash, 'bar-forecast-2026');
  assert.equal(signedInForecast.result, true);
}

const GRAMMAR_GUIDANCE_FOR_TEST = Object.freeze({
  punctuation: Object.freeze({ label: 'Punctuation', guidance: 'Review punctuation in this exact excerpt.' }),
  capitalization: Object.freeze({ label: 'Capitalization', guidance: 'Review capitalization in this exact excerpt.' }),
  agreement: Object.freeze({ label: 'Agreement', guidance: 'Check subject–verb or pronoun agreement in this exact excerpt.' }),
  spelling: Object.freeze({ label: 'Spelling', guidance: 'Review spelling in this exact excerpt.' }),
  sentence_structure: Object.freeze({ label: 'Sentence structure', guidance: 'Review sentence boundaries and structure without changing the legal meaning.' }),
  wordiness: Object.freeze({ label: 'Wordiness', guidance: 'Shorten this excerpt while preserving every legal proposition.' }),
  professional_tone: Object.freeze({ label: 'Professional tone', guidance: 'Use formal legal phrasing without changing the substance.' }),
});

{
  const questions = Array.from({ length: 20 }, (_, index) => ({
    id: `coaching-result-${index + 1}`,
    number: index + 1,
    prompt: `Question ${index + 1}`,
  }));
  const answers = new Map(questions.map((question) => [
    question.id,
    `Yes. Submitted answer ${question.number} states the rule and applies every material fact carefully.`,
  ]));
  const payload = {
    totalScore: 80,
    maxScore: 100,
    analytics: {
      questionCount: 20,
      averageScore: 4,
      issueSpottingAverage: 3.5,
      grammarAverage: 4.5,
      diagnosticMaxScore: 5,
      performanceBands: { strong: 20, developing: 0, needsFocus: 0 },
    },
    results: questions.map((question) => ({
      questionId: question.id,
      number: question.number,
      score: 4,
      maxScore: 5,
      feedback: 'The answer is responsive and legally focused.',
      userAnswer: answers.get(question.id),
      suggestedAnswer: 'Yes. The curated answer states and applies the controlling doctrine.',
      explanation: 'The answer is substantially correct with only a minor omission.',
      mockBarCoaching: {
        strength: 'The conclusion is direct.',
        priorityImprovement: 'Make the factual application more explicit.',
        nextStep: 'Connect each decisive fact to one element of the rule.',
      },
      grammar: {
        score: 4.5,
        maxScore: 5,
        corrections: [{
          original: `Yes. Submitted answer ${question.number}`,
          category: 'punctuation',
          guidance: 'Review punctuation in this exact excerpt.',
        }],
      },
      issueSpotting: {
        score: 3.5,
        maxScore: 5,
      identified: ['The curated answer states and applies the controlling doctrine.'],
      missed: ['controlling doctrine'],
        coaching: 'Frame the issue before stating the rule.',
      },
    })),
  };
  const resultContext = vm.createContext({
    state: { questions, answers },
    REQUIRED_QUESTION_COUNT: 20,
    GRAMMAR_CORRECTION_GUIDANCE: GRAMMAR_GUIDANCE_FOR_TEST,
    Object,
    Number,
    Set,
    Map,
    Error,
  });
  vm.runInContext(extractNamedFunction(forecast, 'normalizeResults'), resultContext);
  resultContext.payload = payload;
  const normalized = vm.runInContext('normalizeResults(payload)', resultContext);
  assert.equal(normalized.totalScore, 80);
  assert.equal(normalized.analytics.grammarAverage, 4.5);
  assert.equal(normalized.results[0].mockBarCoaching.nextStep.includes('decisive fact'), true);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.totalScore = 79;
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /analytics failed its integrity check/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.results[0].grammar.corrections[0].original = 'invented source wording';
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /did not match the submitted answer/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.totalScore = '80';
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /grade response failed its integrity check/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.results[0].grammar.corrections[0].category = 'change_legal_result';
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /did not match the submitted answer/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.results[0].grammar.corrections[0].guidance = 'Rewrite the legal conclusion.';
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /did not match the submitted answer/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.results[0].issueSpotting.missed = ['An invented issue absent from the curated answer.'];
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /curated-source integrity check/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.results[0].issueSpotting.missed = [
    `${questions[0].prompt.slice(-8)}\n${payload.results[0].suggestedAnswer.slice(0, 8)}`,
  ];
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /curated-source integrity check/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.results[0].issueSpotting.missed = [
    resultContext.payload.results[0].issueSpotting.identified[0],
  ];
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /both identified and missed/i);

  resultContext.payload = structuredClone(payload);
  resultContext.payload.analytics.grammarAverage = '4.5';
  assert.throws(() => vm.runInContext('normalizeResults(payload)', resultContext), /analytics failed its integrity check/i);
}

{
  const questions = Array.from({ length: 20 }, (_, index) => ({
    id: `SYNTHETIC-UI-${String(index + 1).padStart(2, '0')}`,
    number: index + 1,
    prompt: `Synthetic interface-test question ${index + 1} includes notice and hearing for Mock Permit ${index + 1}.`,
  }));
  const answers = new Map(questions.map((question) => [
    question.id,
    'Yes. This synthetic answer states the fictional rule, applies every decisive notice and hearing fact, and reaches a clear reasoned conclusion.',
  ]));
  const qaContext = vm.createContext({
    questions,
    consentAccepted: true,
    delay: async () => {},
    Map,
    Number,
    Object,
  });
  vm.runInContext(extractNamedFunction(qaHarness, 'request'), qaContext);
  qaContext.submitOptions = {
    body: {
      operation: 'submit',
      subject: 'Political and Public International Law',
      answers: [...answers].map(([questionId, answer]) => ({ questionId, answer })),
    },
  };
  const qaPayload = await vm.runInContext("request('', submitOptions)", qaContext);
  const normalizeContext = vm.createContext({
    state: { questions, answers },
    REQUIRED_QUESTION_COUNT: 20,
    GRAMMAR_CORRECTION_GUIDANCE: GRAMMAR_GUIDANCE_FOR_TEST,
    Object,
    Number,
    Set,
    Map,
    Error,
  });
  vm.runInContext(extractNamedFunction(forecast, 'normalizeResults'), normalizeContext);
  normalizeContext.payload = qaPayload;
  const normalizedQa = vm.runInContext('normalizeResults(payload)', normalizeContext);
  assert.equal(normalizedQa.results.length, 20);
  assert.equal(normalizedQa.results[0].grammar.corrections[0].category, 'punctuation');
  assert.equal(normalizedQa.results[0].issueSpotting.identified[0], 'notice and hearing');
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
    progressViews: 0,
    pricingRoutes: 0,
    closes: 0,
    toasts: 0,
    signIns: 0,
    accessErrors: 0,
  };
  const responses = [];
  const setupResponses = [];
  const context = vm.createContext({
    ROUTE: '#bar-forecast-2026',
    state,
    global: {
      DueDiligencePhase4: {
        ensureRequiredSetup: async () => {
          observations.setupChecks += 1;
          if (options.deferSetup === true) {
            let resolve;
            let reject;
            const promise = new Promise((accept, deny) => {
              resolve = accept;
              reject = deny;
            });
            setupResponses.push({ promise, resolve, reject });
            return promise;
          }
          return options.setupReady !== false;
        },
      },
      toast: () => { observations.toasts += 1; },
    },
    runtimeOwnerId: () => currentOwnerId,
    runtimeSession: () => (currentOwnerId
      ? { access_token: 'test-token', user: { id: currentOwnerId } }
      : null),
    renderAccessProgress: () => { observations.progressViews += 1; },
    renderAccessError: () => { observations.accessErrors += 1; },
    routeToPlansAndPricing: () => {
      observations.pricingRoutes += 1;
      state.isOpen = false;
      state.ownerId = '';
      state.authorizationOwnerId = '';
      return true;
    },
    isForecastAccessRequired: (error) => (
      Number(error?.status) === 403
      && String(error?.code || '') === 'BAR_FORECAST_ACCESS_REQUIRED'
    ),
    openForecastSignIn: () => { observations.signIns += 1; return true; },
    handleForecastAccessInterruption: (error) => {
      if (Number(error?.status) === 401
          || ['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(String(error?.code || ''))) {
        observations.closes += 1;
        observations.signIns += 1;
        state.isOpen = false;
        state.ownerId = '';
        state.authorizationOwnerId = '';
        return true;
      }
      if (Number(error?.status) === 403
          && String(error?.code || '') === 'BAR_FORECAST_ACCESS_REQUIRED') {
        observations.pricingRoutes += 1;
        state.isOpen = false;
        state.ownerId = '';
        state.authorizationOwnerId = '';
        return true;
      }
      return false;
    },
    closeForecast: () => {
      observations.closes += 1;
      state.isOpen = false;
      return true;
    },
    setStatus: () => {},
    requestForecast: () => {
      observations.requests += 1;
      let resolve;
      let reject;
      const promise = new Promise((accept, deny) => {
        resolve = accept;
        reject = deny;
      });
      responses.push({ promise, resolve, reject });
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
    setupResponses,
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

for (const entitlement of [
  { label: 'administrator', consentAccepted: false, expectedView: 'disclaimer' },
  { label: 'active paid member', consentAccepted: true, expectedView: 'picker' },
  { label: 'active founding_beta_2026 member', consentAccepted: false, expectedView: 'disclaimer' },
]) {
  const eligible = authorizationHarness();
  const authorization = vm.runInContext('checkAuthorization()', eligible.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(eligible.observations.requests, 1,
    `${entitlement.label} must pass through the dedicated server status gate`);
  eligible.responses[0].resolve({
    authorized: true,
    consentAccepted: entitlement.consentAccepted,
  });
  assert.equal(await authorization, true);
  assert.equal(eligible.observations.pricingRoutes, 0);
  assert.equal(eligible.observations.disclaimers, entitlement.expectedView === 'disclaimer' ? 1 : 0,
    `${entitlement.label} must receive the one-time Forecast notice when consent is missing`);
  assert.equal(eligible.observations.pickers, entitlement.expectedView === 'picker' ? 1 : 0,
    `${entitlement.label} must reach the subject picker when consent already exists`);
}

{
  const unpaid = authorizationHarness();
  const authorization = vm.runInContext('checkAuthorization()', unpaid.context);
  await new Promise((resolve) => setImmediate(resolve));
  const denial = Object.assign(new Error('Forecast membership required.'), {
    status: 403,
    code: 'BAR_FORECAST_ACCESS_REQUIRED',
  });
  unpaid.responses[0].reject(denial);
  await authorization;
  assert.equal(unpaid.observations.pricingRoutes, 1,
    'the exact unpaid Forecast denial must route to Plans & Pricing exactly once');
  assert.equal(unpaid.observations.disclaimers, 0);
  assert.equal(unpaid.observations.pickers, 0,
    'an unpaid account must never receive protected subject content');
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
queuedAccess.responses[0].reject(Object.assign(new Error('Transient status failure.'), {
  status: 503,
  code: 'BAR_FORECAST_UNAVAILABLE',
}));
assert.equal(await firstQueuedAuthorization, true);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(queuedAccess.observations.requests, 2,
  'one setup-ready access event must queue one retry after a transient status failure');
assert.equal(queuedAccess.observations.pricingRoutes, 0,
  'a transient failure during an access refresh must never become a pricing redirect');
queuedAccess.responses[1].resolve({ authorized: true, consentAccepted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(queuedAccess.state.ownerId, 'admin-a');
assert.equal(queuedAccess.observations.requests, 2, 'the queued retry must never loop');

const setupBlocked = authorizationHarness({ setupReady: false });
assert.equal(await vm.runInContext('checkAuthorization()', setupBlocked.context), true);
assert.equal(setupBlocked.observations.setupChecks, 1);
assert.equal(setupBlocked.observations.requests, 0, 'setup-required accounts must not reach Forecast status');
assert.equal(setupBlocked.observations.disclaimers, 0, 'Forecast consent must stay closed during setup');
assert.equal(setupBlocked.observations.pickers, 0, 'Forecast subject content must stay closed during setup');
assert.equal(setupBlocked.observations.pricingRoutes, 0,
  'required account setup must not be mistaken for an unpaid subscription');
assert.equal(setupBlocked.observations.closes, 1,
  'the Forecast surface must close while the required setup flow owns the screen');
assert.equal(setupBlocked.observations.toasts, 1);
assert.equal(setupBlocked.state.ownerId, '');

{
  const unavailable = authorizationHarness();
  const authorization = vm.runInContext('checkAuthorization()', unavailable.context);
  await new Promise((resolve) => setImmediate(resolve));
  const outage = Object.assign(new Error('Forecast temporarily unavailable.'), {
    status: 503,
    code: 'BAR_FORECAST_UNAVAILABLE',
  });
  unavailable.responses[0].reject(outage);
  await authorization;
  assert.equal(unavailable.observations.pricingRoutes, 0,
    'a Forecast service failure must not misroute an eligible member to pricing');
  assert.equal(unavailable.observations.disclaimers, 0);
  assert.equal(unavailable.observations.pickers, 0,
    'a failed authorization request must never expose protected Forecast content');
  assert.equal(unavailable.observations.accessErrors, 1,
    'a service failure must remain a retryable Forecast error instead of an upsell');
}

const signedOut = authorizationHarness();
const staleSignedOutAuthorization = vm.runInContext('checkAuthorization()', signedOut.context);
await new Promise((resolve) => setImmediate(resolve));
signedOut.setOwner('');
vm.runInContext('handleForecastSessionChange()', signedOut.context);
assert.equal(signedOut.observations.aborts, 1, 'sign-out must abort pending authorization');
assert.equal(signedOut.observations.requests, 1, 'sign-out must not begin another status request');
assert.equal(signedOut.observations.closes, 1, 'sign-out must close the protected Forecast surface');
assert.equal(signedOut.observations.signIns, 1, 'sign-out must return to the ordinary sign-in flow');
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

const changedOwnerDuringSetup = authorizationHarness({ deferSetup: true });
const staleSetupAuthorization = vm.runInContext('checkAuthorization()', changedOwnerDuringSetup.context);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(changedOwnerDuringSetup.setupResponses.length, 1,
  'the first owner must be waiting on its independent setup preflight');
assert.equal(changedOwnerDuringSetup.observations.requests, 0,
  'Forecast status must remain closed until setup preflight completes');
changedOwnerDuringSetup.setOwner('admin-b');
vm.runInContext('handleForecastSessionChange()', changedOwnerDuringSetup.context);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(changedOwnerDuringSetup.setupResponses.length, 2,
  'an account switch during setup must start one setup check for the new owner');
changedOwnerDuringSetup.context.readyAccessEvent = readyAccessEvent;
vm.runInContext(
  'handleForecastAccessChange({ detail: readyAccessEvent })',
  changedOwnerDuringSetup.context,
);
assert.equal(changedOwnerDuringSetup.state.authorizationRetryRequested, true,
  'the new owner may independently queue its setup-ready authorization retry');
changedOwnerDuringSetup.setupResponses[0].reject(Object.assign(new Error('Old session expired.'), {
  status: 401,
  code: 'INVALID_SESSION',
}));
assert.equal(await staleSetupAuthorization, false);
assert.equal(changedOwnerDuringSetup.state.isOpen, true,
  'a stale setup failure must not close the new owner’s Forecast surface');
assert.equal(changedOwnerDuringSetup.observations.closes, 0,
  'a stale setup failure must not invoke interruption recovery for the new owner');
assert.equal(changedOwnerDuringSetup.observations.signIns, 0,
  'a stale setup failure must not reopen sign-in over the new owner');
assert.equal(changedOwnerDuringSetup.state.authorizationOwnerId, 'admin-b',
  'the stale owner’s finally block must preserve the new authorization owner');
assert.equal(changedOwnerDuringSetup.state.authorizationRetryRequested, true,
  'the stale owner’s finally block must preserve the new owner’s retry flag');
changedOwnerDuringSetup.setupResponses[1].resolve(true);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(changedOwnerDuringSetup.observations.requests, 1,
  'only the new owner may advance from setup into Forecast status');
changedOwnerDuringSetup.responses[0].resolve({ authorized: true, consentAccepted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(changedOwnerDuringSetup.state.ownerId, 'admin-b');
assert.equal(changedOwnerDuringSetup.observations.disclaimers, 1);
assert.equal(changedOwnerDuringSetup.observations.requests, 1,
  'a successful new-owner authorization must consume, not loop, its queued retry');

console.log('2026 Bar Forecast frontend contract checks passed.');
