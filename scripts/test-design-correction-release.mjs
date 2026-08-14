import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, landingCss, landingJs, examCss, examJs, subjectFixture, loader, serviceWorker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/qa/option3-subject-matter-fixture.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
]);

const publicLanding = html.slice(
  html.indexOf('<div class="pb-landing" id="private-beta-landing">'),
  html.indexOf('<dialog class="pb-dialog" id="private-beta-dialog"'),
);
const sharedHeader = html.slice(
  html.indexOf('<header class="topbar pb-header pb-shared-header" id="site-header">'),
  html.indexOf('<div class="pb-landing" id="private-beta-landing">'),
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
  examJs.indexOf('function subjectReviewMaterialKey'),
  examJs.indexOf('function subjectMatterResultMarkup'),
);
const subjectResult = examJs.slice(
  examJs.indexOf('function subjectMatterResultMarkup'),
  examJs.indexOf('function assessmentCard'),
);

assert.match(publicLanding, /class="pb-platform-composition"/);
assert.match(publicLanding, /class="pb-welcome-note"/);
assert.doesNotMatch(publicLanding, /class="pb-chamber-index"/);
assert.doesNotMatch(publicLanding, /pb-pillar-card|pb-pillar-grid/);
assert.equal((html.match(/id="site-header"/g) || []).length, 1,
  'Public and authenticated ordinary pages must share one canonical header.');
assert.ok(html.indexOf('id="site-header"') < html.indexOf('id="private-beta-landing"'));
assert.ok(html.indexOf('id="site-header"') < html.indexOf('id="authenticated-app-shell"'));
assert.match(sharedHeader, /id="header-account-control"[^>]*data-public-action="docket"/);

for (const [slug, visible, accessible] of [
  ['academy', 'The Academy', 'Academy'],
  ['commons', 'The Commons', 'Commons'],
  ['barbound', 'BarBound', 'BarBound'],
]) {
  assert.match(sharedHeader, new RegExp(
    `<a class="pb-chamber-link" href="#chamber/${slug}"[^>]*>${visible}<\\/a>`,
  ));
  assert.match(sharedHeader, new RegExp(
    `class="pb-chamber-toggle"[\\s\\S]{0,240}data-pb-menu-trigger="${slug}"[\\s\\S]{0,240}aria-label="Show ${accessible} features"`,
  ));
}
assert.match(sharedHeader, /data-public-feature="examination-room"[^>]*>\s*Examination Room/);
assert.match(landingJs, /const chamberLink = event\.target\.closest\?\.\('\[data-pb-chamber-link\]'\)/);
assert.match(landingJs, /global\.addEventListener\('popstate'[\s\S]*closePublicMenus\(\)/);
assert.match(landingJs, /global\.addEventListener\('hashchange'[\s\S]*closePublicMenus\(\)/);
const chamberLinkHandler = landingJs.match(/const chamberLink[\s\S]*?const trigger/)?.[0] || '';
assert.ok(chamberLinkHandler, 'Primary public chamber navigation handler must exist.');
assert.doesNotMatch(chamberLinkHandler, /scrollIntoView/,
  'Primary public chamber navigation must not use scrolling.');

assert.match(landingJs, /class="pb-chamber-feature-index"/);
assert.doesNotMatch(`${publicLanding}\n${sharedHeader}`, /pb-chamber-entry-number|>0[1-4]</,
  'The public chamber chooser must not use generic numbered decoration.');
assert.doesNotMatch(landingJs, /pb-chamber-feature-number|0\$\{index \+ 1\}/,
  'Public chamber introductions must not number their features.');
assert.match(landingJs, /\$\{firstFeature\.action\}/);
assert.match(landingJs, /class="pb-chamber-feature-eyebrow"/);
assert.match(landingCss, /\.pb-chamber-feature\s*\{[\s\S]*?border-top:/);
assert.doesNotMatch(landingCss, /\.pb-pillar-card/);

assert.match(perSubject, /class="dd-subject-study-start"/);
assert.match(perSubject, /Change course\s*<\/button>/);
assert.match(perSubject, /Review my work<\/button>/);
assert.match(perSubject, /<dialog class="dd-subject-drawer" id="dd-subject-selector-dialog"/);
assert.doesNotMatch(perSubject, /<dialog[^>]+\sopen(?:\s|>)/);
assert.doesNotMatch(perSubject, /questionCount|availableCount|remainingQuestions|bankSize|placement totals/i);

assert.match(subjectRoom, /class="dd-subject-editorial"/);
assert.match(subjectRoom, /class="dd-subject-editorial-header"/);
assert.match(subjectRoom, /class="dd-subject-editorial-grid"/);
assert.match(subjectRoom, /class="dd-subject-editorial-pane is-writing dd-subject-practice-answer"/);
assert.match(subjectRoom, /class="dd-subject-editorial-pane is-coaching is-review-panel"/);
assert.match(subjectRoom, /<h3 id="dd-subject-answer-title">Write your answer<\/h3>/);
assert.match(subjectRoom, /Your practice question/);
assert.match(subjectRoom, /Submit for coaching/);
assert.doesNotMatch(subjectRoom, /\bALAC\b|A\.L\.A\.C\.|I\.\s*ANSWER|II\.\s*LEGAL BASIS/i,
  'Subject Matter must not force ALAC onto questions that require another form of answer.');
assert.doesNotMatch(subjectRoom, /Question\s+\$\{[^}]*\}\s+of|questionCount|availableCount|totalQuestions|remainingQuestions|bankSize|placement totals/i,
  'Subject Matter must not reveal confidential question-bank totals.');
assert.doesNotMatch(subjectRoom, /modelAnswer|suggestedAnswer|legalBasis|caseLaw|sources\s*\}/,
  'The pre-submission Subject Matter renderer must not receive released answer or authority fields.');
assert.match(examJs, /if \(subjectPractice\) \{[\s\S]*?subjectPracticeRoomMarkup\([\s\S]*?return;/);

for (const control of ['Reveal Complete Review', 'Suggested Answer', 'Complete Legal Basis',
  'Why This Answer Is Correct', 'Verified official sources']) {
  assert.ok(subjectReview.includes(control), `missing complete-review control: ${control}`);
}
assert.match(subjectFixture, /Reveal Complete Review/);
assert.equal(
  (subjectRoom.match(/data-subject-review-reveal/g) || []).length,
  0,
  'The writing renderer delegates one complete-review control to the right review panel.',
);
assert.equal((subjectReview.match(/<button[^>]*data-subject-review-reveal/g) || []).length, 1,
  'The review panel must render exactly one complete-review reveal button.');
assert.ok(subjectResult, 'Subject Matter must render a dedicated Option 3 post-submission review.');
assert.match(subjectResult, /subjectReviewPanelMarkup\(\{/);
assert.match(subjectResult, /class="dd-subject-editorial-pane is-writing is-result-summary"/);
assert.match(subjectResult, /class="dd-subject-editorial-pane is-coaching is-review-panel"/);
assert.match(subjectReview, /operation:\s*'subject_reveal_review',\s*attemptId/,
  'Review material must load from the narrow owner-bound operation only after reveal.');
assert.match(subjectReview, /state\.reviewMaterialRequests\.get\(key\)/,
  'Concurrent reveals must coalesce into one request.');
assert.match(subjectReview, /state\.reviewMaterialCache\.set\(key, material\)/,
  'Verified material must cache only for the current user and attempt key.');
assert.match(subjectReview, /material\?\.attemptId !== attemptId \|\| material\?\.questionId !== questionId/,
  'Returned material must match the exact attempt and question.');
assert.doesNotMatch(subjectReview, /legal_basis_snapshot|model_answer_snapshot|result\?\.legalBasis/,
  'The reveal panel must not consume database snapshots or broad verdict fields directly.');
assert.doesNotMatch(subjectReview,
  /No separate legal-basis field|released assessment does not include|Review the controlling provision|The law applies\.?/i,
  'Generic coaching copy must never masquerade as a question-specific legal basis.');
assert.match(examJs, /Review and retention/);
assert.match(examJs, /Evaluation overview/);
assert.match(examCss, /\.dd-subject-editorial\s*\{[\s\S]*?background:/,
  'Subject Matter must use the approved navy editorial surface.');
assert.match(examCss, /\.dd-subject-editorial-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.12fr\)\s+minmax\(380px,\s*\.88fr\)/,
  'Subject Matter must keep the question and editor on the wider left pane and review on the right.');
assert.match(examCss, /\.dd-subject-editorial-pane\.is-coaching\s*\{[\s\S]*?border-left:/,
  'Option 3 must retain its centered coaching divider on desktop.');
assert.match(examCss, /@media \(max-width: 900px\)[\s\S]*?\.dd-subject-editorial-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr[\s\S]*?\.dd-subject-editorial-pane\.is-coaching\s*\{[\s\S]*?border-left:\s*0[\s\S]*?border-top:/,
  'The centered split must become a readable vertical flow on smaller screens.');
assert.match(examCss, /\.dd-study-disclosures details\s*\{[\s\S]*?border-top:/);

for (const source of [html, loader, serviceWorker]) {
  assert.match(source, /header-subject-review-20260814-1|duediligence-shell-20260814-header-review-1/);
}
assert.doesNotMatch(`${publicLanding}\n${landingJs}\n${examJs}`, /\bpractise\b/i);

console.log('Focused design-correction contract checks passed.');
