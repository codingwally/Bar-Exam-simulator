import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name}() to exist.`);
  const parameterStart = source.indexOf('(', match.index);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const openingBrace = source.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  assert.fail(`Could not extract ${name}().`);
}

const root = new URL('../', import.meta.url);
const [html, landing, loader, home, examinations, study, shellCss, homeCss, examinationsCss, studyCss] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('assets/lex-forum.js', root), 'utf8'),
  readFile(new URL('assets/examinations.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
  readFile(new URL('assets/lex-forum.css', root), 'utf8'),
  readFile(new URL('assets/examinations.css', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
]);

assert.doesNotMatch(
  html,
  /escapeAttribute\(/,
  'The public startup path must not call an undefined HTML-attribute escaping helper.',
);
assert.match(
  html,
  /function showPage\(page, el, options = \{\}\)[\s\S]*?page !== 'mock' && examStage === 'subjectLoading'[\s\S]*?invalidateSubjectSelectionRequest\(\{ resetSelectionState: true \}\)/,
  'Leaving Bar Question Practice must invalidate any pending subject request.',
);

// Deep-linked Home controls must open the true Home feed and remove stale view parameters.
const resetContext = vm.createContext({
  URL,
  location: {
    href: 'https://duediligence.ph/?quorumView=unanswered#quorum',
    pathname: '/',
    search: '?quorumView=unanswered',
    hash: '#quorum',
  },
  history: {
    state: {},
    pushed: null,
    pushState(state, _title, url) { this.state = state; this.pushed = url; },
  },
  state: { publicNavigationVersion: 0, publicNavigationBusy: false, navigationStatusTimer: null },
  setPublicNavigationBusy() {},
  clearNavigationStatus() {},
  showNavigationStatus() {},
  global: { setTimeout: () => null },
  openQuorumHome: async () => true,
  openProtectedFeature: async () => true,
  reportNavigationError() {},
  featureLabels: { quorum: 'Home' },
});
vm.runInContext(
  `${extractNamedFunction(landing, 'resetQuorumHomeLocation')}\n`
  + `${extractNamedFunction(landing, 'runPublicNavigation')}`,
  resetContext,
);
await vm.runInContext("runPublicNavigation('quorum')", resetContext);
assert.equal(resetContext.history.pushed, '/#quorum');
assert.match(landing, /DueDiligenceQuorum\?\.open\?\.\([\s\S]*?\{ forceHome: true \}/);
assert.match(home, /const forceHome = options\.forceHome === true \|\|/);
assert.match(home, /options\.forceHome === true[\s\S]*?setView\('home', \{ route: false \}\)/);
assert.match(landing, /if \(opened !== true\) \{[\s\S]*?return false;[\s\S]*?feature === 'quorum'[\s\S]*?resetQuorumHomeLocation\(\)/);
let quorumOpenOptions = null;
const quorumHomeContext = vm.createContext({
  currentSession: () => ({ access_token: 'test-token' }),
  loadFeature: async () => true,
  showApplication() {},
  document: { getElementById: () => ({ id: 'spa-community' }) },
  global: {
    DueDiligencePhase2: { whenAuthReady: async () => {} },
    DueDiligencePhase4: {},
    DueDiligenceQuorum: {
      open: async (_trigger, options) => { quorumOpenOptions = options; return true; },
    },
  },
});
vm.runInContext(extractNamedFunction(landing, 'openProtectedFeature'), quorumHomeContext);
assert.equal(await vm.runInContext("openProtectedFeature('quorum')", quorumHomeContext), true);
assert.equal(quorumOpenOptions?.forceHome, true, 'Home must explicitly reset the community view to the feed.');

// Busy navigation is inert even when the trigger is an anchor, and stale BarFeels is not success.
assert.match(landing, /event\.preventDefault\(\);\s*if \(feature\.disabled \|\| feature\.getAttribute\('aria-busy'\) === 'true'\) return;/);
assert.match(landing, /control\.setAttribute\('aria-disabled', 'true'\)/);
assert.match(landing, /document\.querySelectorAll\('\[data-public-feature\], \[data-public-home\]'\)/);
assert.match(landing, /state\.publicNavigationBusy \|\| home\.getAttribute\('aria-disabled'\) === 'true'/);
assert.match(landing, /if \(state\.publicNavigationBusy\) return false/);
assert.match(landing, /showNavigationStatus\(`Opening \$\{label\}…`\)/);
assert.match(landing, /showNavigationStatus\(`\$\{label\} opened\.`,'?\s*'success'\)|showNavigationStatus\(`\$\{label\} opened\.`\s*,\s*'success'\)/);
assert.match(landing, /if \(outcome\?\.status === 'stale'\) return false;/);
assert.match(landing, /outcome == null/);
assert.match(html, /const opened = await request;[\s\S]*?return \{ status: 'stale' \};[\s\S]*?if \(opened !== true\)/);
let preventedBusyAnchor = 0;
let navigatedBusyAnchor = 0;
const busyFeatureAnchor = {
  disabled: false,
  dataset: { publicFeature: 'bar-easy' },
  getAttribute(name) { return name === 'aria-busy' ? 'true' : null; },
};
const busyAnchorContext = vm.createContext({
  global: {},
  closePublicMenus() {},
  runPublicNavigation() { navigatedBusyAnchor += 1; },
});
vm.runInContext(extractNamedFunction(landing, 'handlePublicNavigation'), busyAnchorContext);
const handlePublicNavigation = vm.runInContext('handlePublicNavigation', busyAnchorContext);
await handlePublicNavigation({
  defaultPrevented: false,
  preventDefault() { preventedBusyAnchor += 1; },
  target: {
    closest(selector) { return selector === '[data-public-feature]' ? busyFeatureAnchor : null; },
  },
});
assert.equal(preventedBusyAnchor, 1, 'A busy anchor must have its native navigation cancelled.');
assert.equal(navigatedBusyAnchor, 0, 'A busy anchor must not start a second feature navigation.');

// A rejected retry must leave a live, enabled retry control with the new error.
const status = {
  hidden: true,
  role: '',
  classList: { add() {}, remove() {} },
  setAttribute(name, value) { if (name === 'role') this.role = value; },
};
const statusCopy = { textContent: '' };
const retryButton = {
  hidden: true,
  disabled: false,
  onclick: null,
  setAttribute() {},
  removeAttribute() {},
};
const retryContext = vm.createContext({
  navigationStatus: status,
  navigationStatusCopy: statusCopy,
  navigationRetry: retryButton,
  global: { toast() {} },
});
vm.runInContext(extractNamedFunction(landing, 'reportNavigationError'), retryContext);
const reportNavigationError = vm.runInContext('reportNavigationError', retryContext);
reportNavigationError('First failure', async () => { throw new Error('Second failure'); });
await retryButton.onclick();
assert.equal(retryButton.disabled, false);
assert.equal(retryButton.hidden, false);
assert.equal(typeof retryButton.onclick, 'function');
assert.equal(statusCopy.textContent, 'Second failure');
assert.equal(status.role, 'alert');

// Failed lazy assets must be evicted so the next click performs a real network retry.
assert.match(loader, /loadedStyles\.get\(href\) === pending[\s\S]*?loadedStyles\.delete\(href\)/);
assert.match(loader, /loadedScripts\.get\(src\) === pending[\s\S]*?loadedScripts\.delete\(src\)/);
assert.match(loader, /featurePromises\.delete\(group\)/);

// Home and Study Circles: pending/error truth, stable routing, validation, and create-once recovery.
assert.match(home, /Loading unanswered questions…/);
assert.match(home, /This is not an empty result\./);
assert.match(home, /requestSequence !== state\.sidebarRequestSequence/);
assert.match(home, /const form = document\.createElement\('form'\)/);
assert.match(home, /name\.minLength = 3/);
assert.match(home, /description\.minLength = 10/);
assert.match(home, /rules\.minLength = 10/);
assert.match(home, /Nothing will be created again; use Open created circle to retry\./);
assert.match(home, /const circle = await query\('circle', \{ circleId \}, \{ signal: controller\.signal \}\);[\s\S]*?state\.view = 'circle'/);

// Syllabus search is explicitly resettable and performance failures remain actionable.
assert.match(examinations, /data-subject-search-clear/);
assert.match(examinations, /function clearSubjectFilter\(trigger = null\)/);
assert.match(examinations, /document\.addEventListener\('search', handleInput, true\)/);
assert.match(examinations, /subjectPerformanceFailureMessage\(error\)/);
assert.match(examinations, /function isCurrentSubjectPerformanceRequest\(request\)/);
assert.match(examinations, /if \(!isCurrentSubjectPerformanceRequest\(performanceRequest\)\) return false;/);
assert.match(examinations, /Your saved answers and scores are unchanged/);
assert.match(examinations, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);

// Quick Drill and Doctrine inputs preserve work through failures and expose inline states.
for (const kind of ['easy', 'doctrine']) {
  assert.match(study, new RegExp(`id="dd26-${kind}-status"`));
  assert.match(study, new RegExp(`setAnswerStatus\\('${kind}'.*Nothing was cleared`, 's'));
}
assert.match(study, /answer\.dataset\.requestKey/);
assert.match(study, /function canCommitAnswerRequest\(request\)/);
assert.match(study, /if \(!canCommitAnswerRequest\(gradingRequest\)\) return;/);
assert.match(study, /setAnswerFlowBusy\('easy', true\)/);
assert.match(study, /setAnswerFlowBusy\('doctrine', true\)/);
assert.match(study, /if \(state\.busy \|\| !state\.filtered\.length\) return;/);

// Truthful exits, typography tokens, and minimum control sizing.
assert.match(html, /subject-selection-back[\s\S]*?>Back to Home<\/button>/);
assert.match(html, /modal-back[^>]*>Back to Home<\/button>/);
assert.match(html, /--serif-brand:'Cinzel'/);
assert.match(html, /--serif-display:'Fraunces'/);
assert.match(shellCss, /qfs-practice-rail button \{[\s\S]*?min-height:\s*44px/);
assert.match(shellCss, /quorum-nav-link,[\s\S]*?min-height:\s*48px/);
assert.match(shellCss, /\.quorum-entry-action \{[\s\S]*?font:\s*700 14px/);
assert.match(shellCss, /\.quorum-entry-legal \{[\s\S]*?font:\s*400 13px/);
assert.match(shellCss, /@media \(max-width: 560px\)[\s\S]*?\.quorum-entry-visual \{[\s\S]*?min-height:\s*max\(420px, 52svh\)/);
assert.match(shellCss, /@media \(max-width: 560px\)[\s\S]*?\.quorum-signin-intro-still img \{[\s\S]*?top:\s*28%/);
assert.match(homeCss, /lex-action\.quorum-icon-button \{[\s\S]*?min-height:\s*44px/);
assert.match(examinationsCss, /\.dd-subject-search-clear \{[\s\S]*?min-height:\s*48px/);
assert.match(studyCss, /\.dd26-answer-status\.is-error/);

console.log('Public Release 1 reliability checks passed.');
