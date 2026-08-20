import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, landingCss, landingJs, shellCss, shellJs, examCss, examJs, sharedControlsCss, loader, serviceWorker,
  subjectQaFixture, subjectMobileFixture] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/quorum-first-shell.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/quorum-first-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/due-diligence-controls.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/qa/option3-subject-matter-fixture.html', import.meta.url), 'utf8'),
  readFile(new URL('../docs/qa/option3-mobile-frame.html', import.meta.url), 'utf8'),
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
const subjectSelector = examJs.slice(
  examJs.indexOf('function subjectSelectorDialogMarkup'),
  examJs.indexOf('function renderPerSubject'),
);
const subjectRoom = examJs.slice(
  examJs.indexOf('function subjectPracticeRoomMarkup'),
  examJs.indexOf('function renderRoom'),
);
const subjectReview = examJs.slice(
  examJs.indexOf('function subjectReviewMaterialKey'),
  examJs.indexOf('function subjectMatterResultMarkup'),
);
const subjectReviewLock = examJs.slice(
  examJs.indexOf('function subjectReviewPanelMarkup'),
  examJs.indexOf('function updateCompleteSubjectReviewPanels'),
);
const subjectResult = examJs.slice(
  examJs.indexOf('function subjectMatterResultMarkup'),
  examJs.indexOf('function assessmentCard'),
);

assert.match(publicLanding, /id="public-platform"[\s\S]*Prepare with purpose\.[\s\S]*Continue with Google/);
assert.doesNotMatch(publicLanding, /pb-feature-ledger|class="pb-platform-composition"|class="pb-welcome-note"|class="pb-chamber-index"|pb-pillar-card|pb-pillar-grid|feature-previews\//,
  'The signed-out entry must remain concise and must not restore the retired chamber landing.');
assert.equal((html.match(/id="site-header"/g) || []).length, 1,
  'Public and authenticated ordinary pages must share one canonical header.');
assert.ok(html.indexOf('id="site-header"') < html.indexOf('id="private-beta-landing"'));
assert.ok(html.indexOf('id="site-header"') < html.indexOf('id="authenticated-app-shell"'));
assert.match(sharedHeader, /id="header-account-control"[^>]*data-public-action="docket"[^>]*>Profile<\/button>/);
assert.match(sharedHeader, /id="spa-community"[^>]*data-public-feature="quorum"[^>]*>Home<\/button>/);
assert.match(sharedHeader, /<summary>Practice Exam<\/summary>[\s\S]*Guided Practice[\s\S]*Doctrine Review[\s\S]*Bar Question Practice[\s\S]*Bar Exam Simulation/);
assert.match(sharedHeader, /data-public-feature="examination-room"[^>]*>\s*Examination Room/);
assert.doesNotMatch(sharedHeader, />The Academy<|>The Commons<|>BarBound<|>The Docket/);
assert.match(landingJs, /function openQuorumHome\(trigger = null\)[\s\S]*openProtectedFeature\('quorum', trigger\)/);
assert.match(landingJs, /global\.addEventListener\('popstate'[\s\S]*openQuorumHome\(\)/);
assert.match(landingJs, /global\.addEventListener\('hashchange'[\s\S]*openQuorumHome\(\)/);
assert.match(shellJs, /event\.key !== 'Escape'[\s\S]*setDrawer\(refs, false, \{ restoreFocus: true \}\)/);
assert.match(shellJs, /document\.getElementById\('spa-mock'\)\?\.click\(\)/);
assert.match(shellCss, /#site-header\.qfs-shell #spa-nav\.qfs-drawer[\s\S]*position:\s*fixed[\s\S]*height:\s*100dvh/);
assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(perSubject, /class="dd-subject-study-start"/);
assert.match(perSubject, /id="dd-subject-course-selection-heading"/);
assert.match(perSubject, /<section class="dd-subject-selection-callout" aria-labelledby="dd-subject-course-selection-heading">[\s\S]*<h2 id="dd-subject-course-selection-heading" tabindex="-1">/,
  'The neutral course chooser must focus and label its visible heading for assistive technology.');
assert.match(perSubject, />\s*Browse courses\s*<\/button>/);
assert.match(perSubject, /Change course\s*<\/button>/);
assert.match(perSubject, /Review my work<\/button>/);
assert.match(subjectSelector, /<dialog class="dd-subject-drawer" id="dd-subject-selector-dialog"/);
assert.match(subjectSelector, /<label class="dd-subject-search-label" for="dd-subject-search-mobile">Find a course<\/label>/,
  'The course drawer must expose a visible search label instead of relying on placeholder text.');
assert.match(perSubject, /subjectSelectorDialogMarkup\((?:null|selected)\)/);
assert.doesNotMatch(subjectSelector, /<dialog[^>]+\sopen(?:\s|>)/);
assert.doesNotMatch(perSubject, /questionCount|availableCount|remainingQuestions|bankSize|placement totals/i);
assert.doesNotMatch(perSubject, /Question-aware study|How this review works/i);
assert.doesNotMatch(examJs, /selectedSubject:\s*'Criminal Law I'|state\.catalog\[0\]/,
  'Subject Matter must not silently choose Criminal Law I or the first catalog course.');
assert.match(examJs, /subjectSelectionConfirmed:\s*false/);
assert.match(examJs, /selectionConfirmed:\s*state\.subjectSelectionConfirmed/);
assert.match(examJs, /saved\.version === 3[\s\S]*saved\.selectedSubject[\s\S]*LEGACY_DEFAULT_SUBJECT/,
  'Legacy non-default choices must migrate as intentional while the former automatic default is reconfirmed.');
assert.match(examJs, /registerReset\?\.\([\s\S]*resetForIdentityChange\(\);[\s\S]*if \(nextUserId\) readSubjectCatalogState\(\)/,
  'User-scoped Subject Matter preferences must reload after initial sign-in and identity changes.');
assert.match(examCss, /\.dd-subject-selection-callout\s*\{[\s\S]*?width:\s*min\(760px, 100%\);[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*center;[\s\S]*?margin:\s*clamp\([^;]+\) auto 0;[\s\S]*?text-align:\s*center/,
  'The first-time selector must be a genuinely centered one-column onboarding stack.');
assert.match(examCss, /\.dd-subject-selection-callout > \.dd-exam-kicker\s*\{[\s\S]*?color:\s*#e6bd59/,
  'The Subject Matter chooser kicker must retain WCAG AA contrast on its navy surface.');
assert.match(perSubject, /<p class="dd-subject-selection-summary">[\s\S]*?<button class="dd-control dd-exam-button is-primary dd-subject-selection-button"[^>]*data-subject-selector-open[^>]*>[\s\S]*?Browse courses[\s\S]*?<\/button>/,
  'Browse courses must sit below the study prompt and use the shared primary control.');
assert.match(examCss, /\.dd-subject-year > summary,[\s\S]*?\.dd-subject-term > summary\s*\{[\s\S]*?min-height:\s*44px/,
  'Year and Term disclosure controls must preserve a 44px minimum target.');

assert.match(subjectRoom, /class="dd-subject-editorial"/);
assert.match(subjectRoom, /class="dd-subject-editorial-header"/);
assert.match(subjectRoom, /class="dd-subject-editorial-grid"/);
assert.match(subjectRoom, /class="dd-subject-editorial-pane is-reading is-review-panel"/);
assert.match(subjectRoom, /class="dd-subject-editorial-pane is-writing dd-subject-practice-answer"/);
assert.match(subjectRoom, /<h3 id="dd-subject-answer-title">Write your answer<\/h3>/);
assert.match(subjectRoom, /Your practice question/);
assert.doesNotMatch(subjectRoom, /dd-subject-approach|Writing approach|Take a clear position on the legal issue/i,
  'Generic writing instructions must not crowd the question and answer workspace.');
assert.ok(
  subjectRoom.indexOf('class="dd-subject-editorial-pane is-writing dd-subject-practice-answer"')
    < subjectRoom.indexOf('class="dd-subject-editorial-pane is-reading is-review-panel"'),
  'The examination must retain the established answer-left and review-right arrangement.',
);
assert.doesNotMatch(subjectRoom, /one focused question|One-question review session|Autosave active[\s\S]*Autosave active/i,
  'Subject Matter must not repeat the retired one-question or autosave explanations.');
assert.doesNotMatch(examJs, /one focused question|One-question review session/i,
  'The retired one-question explanation must be absent from every Subject Matter state.');
assert.match(subjectRoom, /Submit for coaching/);
assert.match(subjectRoom, /class="dd-control dd-exam-button is-tertiary"[^>]*data-return-catalog/,
  'Return to courses must use the shared tertiary action treatment.');
assert.match(sharedControlsCss, /\.dd-control,[\s\S]*?\.dd26-button,[\s\S]*?#dd-per-subject-app \.dd-exam-button[\s\S]*?min-height:\s*var\(--dd-control-height\);[\s\S]*?border-radius:\s*var\(--dd-control-radius\);[\s\S]*?font:\s*700 13px\/1\.2 Inter/,
  'Subject Matter, Bar Easy, and Doctrines must use the same shared action-control foundation.');
assert.match(sharedControlsCss, /--dd-control-height:\s*46px;[\s\S]*?--dd-control-radius:\s*6px;/,
  'Shared action controls must retain the approved proportions.');
assert.match(sharedControlsCss, /--dd-control-focus:\s*#f3cd78;[\s\S]*?--dd-control-focus-dark:\s*#061a35;/,
  'The shared focus treatment must keep contrasting light and dark rings for mixed surfaces.');
assert.match(sharedControlsCss, /\.dd-control\.is-primary,[\s\S]*?background:\s*var\(--dd-control-gold\);/,
  'Primary actions must use a restrained solid antique-gold surface.');
assert.match(sharedControlsCss, /\.dd-control\.is-primary:focus-visible,[\s\S]*?box-shadow:\s*0 0 0 2px var\(--dd-control-focus-dark\),[\s\S]*?0 0 0 5px var\(--dd-control-focus\)/,
  'Primary keyboard focus must retain a visible shared focus ring.');
assert.match(sharedControlsCss, /\.dd-control\.is-tertiary:focus-visible,[\s\S]*?box-shadow:\s*0 0 0 2px var\(--dd-control-focus-dark\),[\s\S]*?0 0 0 5px var\(--dd-control-focus\)/,
  'Tertiary keyboard focus must be stronger than its one-pixel underline.');
assert.match(examCss, /\.dd-subject-drawer \.dd-subject-drawer-close\s*\{[\s\S]*?border-radius:\s*6px;[\s\S]*?background:\s*rgba\(2, 18, 35, \.42\);/,
  'The course drawer close control must retain the navy/gold control treatment over later dialog styles.');
assert.match(html, /class="dd-control is-tertiary is-on-light fb-btn suggest"/,
  'Correction actions on the light assessment card must use the accessible light-surface variant.');
assert.match(sharedControlsCss, /\.dd-control\.is-tertiary\.is-on-light\s*\{[\s\S]*?color:\s*#6b4f18;/,
  'Light-surface tertiary actions must keep readable dark-gold text.');
assert.doesNotMatch(sharedControlsCss, /linear-gradient\(/,
  'The shared control system must not reintroduce the primitive gold-gradient treatment.');
assert.doesNotMatch(examCss,
  /\.dd-subject-(?:editorial|study-page) \.dd-exam-button\s*\{[^}]*(?:min-height|border-radius|font|background)\s*:/,
  'Subject Matter must not maintain a second copied visual button system in its feature stylesheet.');
assert.doesNotMatch(subjectRoom, /\bALAC\b|A\.L\.A\.C\.|I\.\s*ANSWER|II\.\s*LEGAL BASIS/i,
  'Subject Matter must not force ALAC onto questions that require another form of answer.');
assert.doesNotMatch(subjectRoom, /Question\s+\$\{[^}]*\}\s+of|questionCount|availableCount|totalQuestions|remainingQuestions|bankSize|placement totals/i,
  'Subject Matter must not reveal confidential question-bank totals.');
assert.doesNotMatch(subjectRoom, /modelAnswer|suggestedAnswer|legalBasis|caseLaw|sources\s*\}/,
  'The pre-submission Subject Matter renderer must not receive released answer or authority fields.');
assert.match(examJs, /if \(subjectPractice\) \{[\s\S]*?subjectPracticeRoomMarkup\([\s\S]*?return;/);
assert.match(examJs, /function subjectReviewSubmissionBlocked\(\)[\s\S]*?reviewConfirmationPending === true/,
  'Subject Matter must retain an explicit uncertain-review submission guard.');
assert.match(examJs, /function subjectReviewSubmissionBlocked\(\)[\s\S]*?!state\.active\?\.attempt\?\.submittedAt/,
  'A post-submission reveal must not block retrying an already-preserved assessment.');
assert.match(examJs, /submit\.disabled = !answerText\.trim\(\) \|\| subjectReviewSubmissionBlocked\(\)/,
  'Typing must not re-enable submission while review classification is uncertain.');
assert.match(examJs, /if \(subjectReviewSubmissionBlocked\(\)\) \{[\s\S]*?Submission remains paused[\s\S]*?return;/,
  'The submission handler must independently reject an uncertain review state.');
assert.match(examJs, /const reviewAffectsSubmission = state\.active\?\.attempt\?\.attemptId === attemptId[\s\S]*?&& !state\.active\.attempt\.submittedAt;[\s\S]*?if \(submitButton && reviewAffectsSubmission\) submitButton\.disabled = true;[\s\S]*?reviewConfirmationPending = reviewAffectsSubmission;[\s\S]*?subject_reveal_review[\s\S]*?reviewConfirmationPending = false;/,
  'Reveal must hold submission only while a not-yet-submitted attempt awaits owner-bound classification confirmation.');
assert.match(examJs, /Retry assessment remains available\. Retry the review to open the protected material\./,
  'A failed post-submission reveal must not falsely claim that assessment retry is paused.');

for (const control of ['Reveal suggested answer', 'Reveal controlling law and doctrine',
  'Reveal application, limits, and sources', 'Controlling Law &amp; Doctrine',
  'Cited Authorities', 'Related Jurisprudence', 'Application and Material Limits',
  'Verified official sources']) {
  assert.ok(subjectReview.includes(control), `missing complete-review control: ${control}`);
}
assert.doesNotMatch(subjectReview,
  /<h5>Governing provision<\/h5>|<h5>Doctrine<\/h5>|<h5>Citation<\/h5>/,
  'The review must not repeat the same raw authority under three low-value labels.');
assert.match(subjectReview, /material\?\.legalReview/,
  'The review must prefer the normalized high-value legalReview response.');
assert.match(subjectReview, /function isNearDuplicateSubjectReviewText/,
  'The review must detect a controlling-law field copied from the suggested answer.');
assert.match(subjectReview, /\? distinctSubjectReviewFallback\(material\) : suppliedControllingLaw/,
  'The review must replace duplicated controlling-law text with source-bound material.');
assert.match(examJs, /No distinct controlling-law explanation is available in the approved source material/,
  'If every rule field duplicates the answer, the review must disclose the source gap instead of repeating it.');
assert.match(subjectReview, /function subjectReviewSuggestedAnswerMarkup/,
  'Suggested answers must use the structured, escaping-only renderer.');
assert.match(subjectReview, /subjectReviewSuggestedAnswerMarkup\(material\.suggestedAnswer\)/,
  'The complete review must render the Suggested Answer through the structured renderer.');
assert.match(subjectReview, /<p>\$\{escapeHtml\(paragraph\)\}<\/p>/,
  'Every source paragraph in the structured Suggested Answer must remain HTML escaped.');
assert.equal(
  (subjectRoom.match(/data-subject-review-reveal/g) || []).length,
  0,
  'The writing renderer delegates the secure review controls to the question/review pane.',
);
assert.equal((subjectReviewLock.match(/<details>/g) || []).length, 3,
  'The locked review panel must render exactly three native disclosures.');
assert.equal((subjectReviewLock.match(/<summary[^>]*data-subject-review-reveal/g) || []).length, 3,
  'Each secure review section must be activated by its own native summary control.');
assert.equal((subjectReviewLock.match(/<details\s+open|<details[^>]+\sopen(?:\s|>)/g) || []).length, 0,
  'Suggested answer, law, and application disclosures must all be closed initially.');
for (const label of [
  'Reveal suggested answer',
  'Reveal controlling law and doctrine',
  'Reveal application, limits, and sources',
]) assert.match(subjectReviewLock, new RegExp(label));
assert.match(subjectReviewLock, /excluded from unassisted mastery metrics/,
  'The shortened reveal copy must retain the material classification consequence.');
assert.doesNotMatch(subjectReviewLock, /<button[^>]*data-subject-review-reveal/,
  'The retired single reveal button must not return.');
assert.doesNotMatch(subjectReview, /<details class="dd-subject-approach"/,
  'Writing Approach must not be hidden after the reveal control.');
assert.ok(subjectResult, 'Subject Matter must render a dedicated Option 3 post-submission review.');
assert.match(subjectResult, /subjectReviewPanelMarkup\(\{/);
assert.match(subjectResult, /class="dd-subject-editorial-pane is-writing is-result-summary"/);
assert.match(subjectResult, /class="dd-subject-editorial-pane is-reading is-review-panel"/);
assert.ok(
  subjectResult.indexOf('class="dd-subject-editorial-pane is-writing is-result-summary"')
    < subjectResult.indexOf('class="dd-subject-editorial-pane is-reading is-review-panel"'),
  'The graded view must retain the submitted response on the left and the review on the right.',
);
assert.match(subjectReview, /operation:\s*'subject_reveal_review',\s*attemptId/,
  'Review material must load from the narrow owner-bound operation only after reveal.');
assert.match(subjectReview, /state\.reviewMaterialRequests\.get\(key\)/,
  'Concurrent reveals must coalesce into one request.');
assert.match(subjectReview, /panel\.dataset\.reviewLoading === 'true'/,
  'Repeated disclosure activation must be ignored while the owner-bound reveal is pending.');
assert.match(subjectReview, /This attempt may already be classified Assisted \/ Open-book/,
  'An uncertain reveal response must explain the conservative classification state plainly.');
assert.match(subjectReview, /if \(reviewConfirmed && submitButton/,
  'Submission must remain blocked until the reveal classification is definitively confirmed.');
assert.doesNotMatch(subjectReview, /showCompleteSubjectReviewError\(panel,\s*error\?\.message\)/,
  'Technical request errors must not be rendered directly in the review chamber.');
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
assert.match(examCss, /\.dd-subject-editorial-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  'Subject Matter must use a balanced two-pane examination workspace.');
assert.match(examCss, /\.dd-subject-editorial-grid\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible/,
  'The split workspace must use one document reading flow instead of two competing scrollbars.');
assert.match(examCss, /\.dd-subject-editorial-pane\s*\{\s*overflow:\s*visible;/,
  'Each desktop pane must remain in the document scroll flow.');
assert.match(examCss, /\.dd-subject-editorial-pane\.is-review-panel\s*\{[\s\S]*?border-left:/,
  'The right-hand review pane must retain the restrained central divider on desktop.');
assert.match(examCss, /@media \(max-width: 900px\)[\s\S]*?\.dd-subject-editorial-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr[\s\S]*?\.dd-subject-editorial-pane\.is-review-panel\s*\{[\s\S]*?border-top:[\s\S]*?border-left:\s*0/,
  'The balanced split must stack review below writing on smaller screens.');
assert.match(examCss, /\.dd-study-disclosures details\s*\{[\s\S]*?border-top:/);

assert.match(html, /assets\/phase2\.css\?release=commercial-school-visual-safety-20260818-1/);
assert.match(html, /assets\/private-beta-landing\.css[^"\n]*subject-matter-gil-fixes-20260817-4/);
assert.match(html, /assets\/due-diligence-controls\.css\?v=subject-matter-controls-20260817-4/);
assert.match(loader, /subject-matter-gil-fixes-20260817-4/);
assert.match(serviceWorker, /duediligence-shell-20260821-home-renovation-2/);
assert.match(serviceWorker, /quorum-first-shell\.css\?v=signin-intro-20260821-2/);
assert.match(serviceWorker, /quorum-first-shell\.js\?v=quorum-first-renovation-20260820-1/);
assert.match(serviceWorker, /phase2\.css\?release=commercial-school-visual-safety-20260818-1/);
assert.match(serviceWorker, /due-diligence-controls\.css\?v=subject-matter-controls-20260817-4/);
assert.match(serviceWorker, /private-beta-landing\.css[^'\n]*subject-matter-gil-fixes-20260817-4/);
assert.match(serviceWorker, /study-workspace\.css[^'\n]*subject-matter-gil-fixes-20260817-4/);
assert.match(subjectQaFixture, /data-qa-fixture="subject-matter-production-renderer"/);
assert.match(subjectQaFixture, /assets\/due-diligence-controls\.css["']/);
assert.match(subjectQaFixture, /assets\/examinations\.css["']/);
assert.match(subjectQaFixture, /assets\/examinations\.js["']/);
assert.match(subjectQaFixture, /DueDiligenceExaminations\.openPerSubject\(\)/,
  'Browser proof must execute the production Subject Matter renderer.');
assert.match(subjectQaFixture, /get\('review'\) === 'fail-once'[\s\S]*?reviewRequestCount === 1[\s\S]*?throw new Error/,
  'Browser proof must support a deterministic lost-review-response safety check.');
assert.doesNotMatch(subjectQaFixture, /\.dd-subject-[\w-]+\s*\{/,
  'Browser proof must not replace production Subject Matter components with fixture CSS.');
assert.match(subjectMobileFixture, /iframe\s*\{[^}]*width:\s*390px;[^}]*height:\s*844px;/,
  'The mobile browser proof must retain the audited 390 by 844 viewport.');
assert.match(subjectMobileFixture, /option3-subject-matter-fixture\.html\?state=room/,
  'Mobile proof must exercise the real production examination path.');
assert.doesNotMatch(`${publicLanding}\n${landingJs}\n${examJs}`, /\bpractise\b/i);

console.log('Focused design-correction contract checks passed.');
