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
]);

const rail = html.match(/<nav class="qfs-practice-rail"[\s\S]*?<\/nav>/)?.[0] || '';
const drawer = html.match(/<details class="quorum-practice-menu" id="quorum-practice-menu">[\s\S]*?<\/details>/)?.[0] || '';
assert.ok(rail && drawer, 'both Forecast navigation surfaces must exist');
for (const markup of [rail, drawer]) {
  const forecastPosition = markup.indexOf('>2026 Bar Forecast<');
  const quickDrillsPosition = markup.indexOf('>Quick Drills<');
  assert.ok(forecastPosition >= 0 && forecastPosition < quickDrillsPosition,
    'Forecast must appear immediately before Quick Drills');
  assert.match(markup, /data-public-feature="bar-forecast"[^>]*aria-haspopup="dialog"[^>]*aria-controls="bf26-root"/);
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
assert.match(forecast, /const CONSENT_VERSION = '2026-08-31'/);
assert.match(forecast, /const REQUIRED_QUESTION_COUNT = 20/);
assert.match(forecast, /const MINIMUM_WORDS = 10/);
assert.match(forecast, /textarea\.maxLength = 6000/);
assert.match(forecast, /operation:\s*'status'/);
assert.match(forecast, /operation:\s*'accept', version:\s*CONSENT_VERSION/);
assert.match(forecast, /operation:\s*'start', subject:\s*subjectName/);
assert.match(forecast, /operation:\s*'submit'[\s\S]*answers:\s*submittedAnswers/);
assert.match(forecast, /refs\.submit\.disabled = !allAnswersComplete\(\)/);
assert.match(forecast, /payload\?\.authorized !== true/);
assert.match(forecast, /payload\?\.consentAccepted === true/);
assert.match(forecast, /renderPreview\(\{ checking: true \}\)/);
assert.match(forecast, /state\.root\.hidden = true[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/);
assert.match(forecast, /event\.key === 'Escape'/);
assert.match(forecast, /event\.key !== 'Tab'/);
assert.doesNotMatch(forecast, /localStorage|sessionStorage/);
assert.doesNotMatch(forecast, /\bALAC\b|legal[_ ]basis|controlling[_ ]doctrine|prediction score|transparent rubric/i);
assert.doesNotMatch(forecast, /wallyesteban1993\.workers\.dev|supabase\.co/i);
assert.match(forecast, /designed to train issue spotting/i);
assert.match(forecast, /historical question repetition/i);
assert.match(forecast, /2026 Bar Chair\\'s cases/i);
assert.match(forecast, /other editorial indicators/i);
assert.match(forecast, /not an exact science and is not guaranteed accurate/i);
assert.match(forecast, /not official Supreme Court questions, leaks, or confidential examination content/i);
assert.match(forecast, /do not constitute legal advice/i);
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
assert.match(styles, /\.bf26-exam\s*\{[\s\S]*grid-template-columns:\s*112px minmax\(0, 1fr\)/);
assert.match(styles, /\.bf26-exam\s*\{[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/);
assert.match(styles, /\.bf26-exam-nav\s*\{[\s\S]*background:\s*#e8f0f7/);
assert.match(styles, /\.bf26-question-list\s*\{[\s\S]*grid-template-columns:\s*1fr/);
assert.match(styles, /\.bf26-question-jump\s*\{[\s\S]*border:\s*2px solid #2f6d9f/);
assert.match(styles, /\.bf26-exam-workspace\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(360px, 1fr\)/);
assert.match(styles, /\.bf26-exam-main\s*\{[\s\S]*overflow:\s*hidden[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
assert.match(styles, /\.bf26-exam-workspace\s*\{[\s\S]*overflow:\s*auto/);
assert.match(styles, /\.bf26-exam-footer\s*\{[\s\S]*background:\s*#e7f0f7/);
assert.match(forecast, /Blue circles mark answers that meet the 10-word minimum\. Gold marks the current question\./);
assert.match(styles, /\.bf26-preview-grid\s*\{[\s\S]*min-width:\s*0/);
assert.match(styles, /@media \(max-width: 840px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);

for (const source of [build, serviceWorker]) {
  assert.match(source, /assets\/bar-forecast\.css/);
  assert.match(source, /assets\/bar-forecast\.js/);
  assert.match(source, /assets\/bar-forecast\/forecast-workspace-preview\.webp/);
}
assert.match(serviceWorker, /duediligence-shell-20260831-bar-forecast-admin-1/);
assert.doesNotMatch(build, /content\/duediligence-2026\/bar-forecast\.json/);
assert.equal(
  createHash('sha256').update(preview).digest('hex').toUpperCase(),
  '8D3A68F68AD252EB88AB8DABDFF2A57DC41EF603A7948A79917EF73DE9BBD4B3',
);

console.log('2026 Bar Forecast frontend contract checks passed.');
