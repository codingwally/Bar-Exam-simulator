import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [
  html,
  forecast,
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
assert.match(forecast, /payload\?\.consentAccepted === true/);
assert.match(forecast, /renderPreview\(\{ checking: true \}\)/);
assert.match(forecast, /async function openForecast\(trigger = null\) \{[\s\S]*ensureRoot\(\);[\s\S]*if \(state\.isOpen\) return true;/);
assert.match(forecast, /state\.root\.hidden = true[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/);
assert.match(forecast, /event\.key === 'Escape'/);
assert.match(forecast, /<section class="bf26-page" aria-labelledby="bf26-page-title"/);
assert.match(forecast, /<main class="bf26-view" data-bf26-view aria-labelledby="bf26-page-title"><\/main>/);
assert.doesNotMatch(forecast, /role="dialog"|aria-modal/);
assert.match(forecast, /document\.body\.classList\.add\('bf26-page-open'\)/);
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
assert.match(serviceWorker, /duediligence-shell-20260901-bar-forecast-exam-tools-1/);
assert.match(serviceWorker, /assets\/icons\/navigation\/flag\.svg/);
assert.match(qaHarness, /dataset\.ddBarForecastQa = 'synthetic'/);
assert.match(qaHarness, /__DD_BAR_FORECAST_SYNTHETIC_QA__ = '2026-09-01'/);
assert.match(qaHarness, /Synthetic UI QA harness — not real Forecast questions or grading/);
assert.doesNotMatch(qaHarness, /window\.openBarForecast\?\.\(document\.getElementById\('open-forecast'\)\)/);
assert.doesNotMatch(build, /content\/duediligence-2026\/bar-forecast\.json/);
assert.equal(
  createHash('sha256').update(preview).digest('hex').toUpperCase(),
  '8D3A68F68AD252EB88AB8DABDFF2A57DC41EF603A7948A79917EF73DE9BBD4B3',
);

console.log('2026 Bar Forecast frontend contract checks passed.');
