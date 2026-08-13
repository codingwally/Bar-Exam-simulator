import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, landingCss, landingJs, examCss, examJs, loader, serviceWorker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
]);

const publicLanding = html.slice(
  html.indexOf('<div class="pb-landing" id="private-beta-landing">'),
  html.indexOf('<dialog class="pb-dialog" id="private-beta-dialog"'),
);
const perSubject = examJs.slice(
  examJs.indexOf('function renderPerSubject'),
  examJs.indexOf('function curatedBarCards'),
);
const subjectRoom = examJs.slice(
  examJs.indexOf('function subjectPracticeRoomMarkup'),
  examJs.indexOf('function renderRoom'),
);
const subjectReview = examJs.slice(
  examJs.indexOf('function subjectMatterStudyDisclosures'),
  examJs.indexOf('async function openVerdict'),
);

assert.match(publicLanding, /class="pb-platform-composition"/);
assert.match(publicLanding, /class="pb-chamber-index"/);
assert.doesNotMatch(publicLanding, /pb-pillar-card|pb-pillar-grid/);

for (const [slug, visible, accessible] of [
  ['academy', 'The Academy', 'Academy'],
  ['commons', 'The Commons', 'Commons'],
  ['barbound', 'BarBound', 'BarBound'],
]) {
  assert.match(publicLanding, new RegExp(
    `<a class="pb-chamber-link" href="#chamber/${slug}"[^>]*>${visible}<\\/a>`,
  ));
  assert.match(publicLanding, new RegExp(
    `class="pb-chamber-toggle"[\\s\\S]{0,240}data-pb-menu-trigger="${slug}"[\\s\\S]{0,240}aria-label="Show ${accessible} features"`,
  ));
}
assert.match(publicLanding, /data-public-feature="examination-room"[^>]*>\s*Examination Room/);
assert.match(landingJs, /const chamberLink = event\.target\.closest\?\.\('\[data-pb-chamber-link\]'\)/);
assert.match(landingJs, /global\.addEventListener\('popstate'[\s\S]*closePublicMenus\(\)/);
assert.match(landingJs, /global\.addEventListener\('hashchange'[\s\S]*closePublicMenus\(\)/);
const chamberLinkHandler = landingJs.match(/const chamberLink[\s\S]*?const trigger/)?.[0] || '';
assert.ok(chamberLinkHandler, 'Primary public chamber navigation handler must exist.');
assert.doesNotMatch(chamberLinkHandler, /scrollIntoView/,
  'Primary public chamber navigation must not use scrolling.');

assert.match(landingJs, /class="pb-chamber-feature-index"/);
assert.match(landingJs, /class="pb-chamber-feature-number"/);
assert.match(landingJs, /Begin with \$\{firstFeature\.title\}/);
assert.match(landingCss, /\.pb-chamber-feature\s*\{[\s\S]*?border-top:/);
assert.doesNotMatch(landingCss, /\.pb-pillar-card/);

assert.match(perSubject, /class="dd-subject-study-start"/);
assert.match(perSubject, /Change course\s*<\/button>/);
assert.match(perSubject, /Review my work<\/button>/);
assert.match(perSubject, /<dialog class="dd-subject-drawer" id="dd-subject-selector-dialog"/);
assert.doesNotMatch(perSubject, /<dialog[^>]+\sopen(?:\s|>)/);
assert.doesNotMatch(perSubject, /questionCount|availableCount|remainingQuestions|bankSize|placement totals/i);

assert.match(subjectRoom, /<h1>Subject Matter Practice<\/h1>/);
assert.match(subjectRoom, /How to approach this question/);
assert.match(subjectRoom, /<h2 id="dd-subject-answer-title">Your answer<\/h2>/);
assert.match(subjectRoom, /Write your answer in the structure the question requires\. You may use ALAC or another clear legal format where appropriate\./);
assert.match(subjectRoom, /Technique only\. The suggested legal basis, discussion, answer, and sources remain unavailable until after submission\./);
assert.doesNotMatch(subjectRoom, /modelAnswer|suggestedAnswer|legalBasis|caseLaw|sources\s*\}/,
  'The pre-submission Subject Matter renderer must receive technique-only fields.');
assert.match(examJs, /if \(subjectPractice\) \{[\s\S]*?subjectPracticeRoomMarkup\([\s\S]*?return;/);

for (const control of [
  'Reveal suggested legal basis',
  'Why this legal basis applies',
  'Show suggested discussion',
  'Show suggested answer',
  'View verified sources',
]) assert.ok(subjectReview.includes(control), `missing post-evaluation control: ${control}`);
assert.match(examJs, /Review and retain\./);
assert.match(examJs, /Evaluation overview/);
assert.match(examCss, /\.dd-subject-practice-layout\s*\{[\s\S]*?"question companion"[\s\S]*?"answer companion"/);
assert.match(examCss, /@media \(max-width: 820px\)[\s\S]*?"question"[\s\S]*?"companion"[\s\S]*?"answer"/);
assert.match(examCss, /\.dd-study-disclosures details\s*\{[\s\S]*?border-top:/);

for (const source of [html, loader, serviceWorker]) {
  assert.match(source, /design-correction-20260814-1|duediligence-shell-20260814-design-1/);
}
assert.doesNotMatch(`${publicLanding}\n${landingJs}\n${examJs}`, /\bpractise\b/i);

console.log('Focused design-correction contract checks passed.');
