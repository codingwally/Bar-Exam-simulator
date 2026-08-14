import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const siteUrl = String(process.env.STAGING_SITE_URL || '').replace(/\/+$/, '');
const email = String(process.env.STAGING_UI_EMAIL || '');
const password = String(process.env.STAGING_UI_PASSWORD || '');

assert.match(siteUrl, /^https:\/\/[a-z0-9.-]+\.workers\.dev$/);
assert.match(email, /^dd-ui-[a-z0-9-]+@example\.com$/);
assert.ok(password.length >= 16, 'A disposable staging-user password is required.');

const requestedRunId = String(process.env.STAGING_UI_RUN_ID || '').trim();
const runId = requestedRunId || `ui-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
assert.match(runId, /^ui-[a-z0-9-]{8,80}$/);
const createdExamIds = [];
const results = {
  runId,
  examinations: [],
  draftPersistence: {},
  responsive: {},
  accessibility: {},
  reducedMotion: {},
  highZoom: {},
  consoleErrors: [],
  networkErrors: [],
  pageErrors: [],
};

const completeAnswers = [
  [
    'I. ANSWER: No. The accused should not be held criminally liable if the stated facts establish the recognized defense.',
    'II. LEGAL BASIS: The Revised Penal Code and the controlling Supreme Court doctrine require each statutory element, criminal intent, and any justifying or exempting circumstance to be evaluated from the facts actually proved.',
    'III. APPLICATION: The exact conduct, timing, danger, relationship, and state of mind described in the problem must be compared with those elements. The facts support the defense only where they establish a reasonable response and negate the criminal intent otherwise required.',
    'IV. CONCLUSION: Therefore, the accused should be acquitted when the complete requisites of the defense are established.',
  ].join('\n\n'),
  [
    'I. ANSWER: Liability depends on whether every element of the offense is established by the facts.',
    'II. LEGAL BASIS: The applicable Revised Penal Code provision and the cited Supreme Court doctrine define the prohibited act, required intent, and any qualifying or mitigating circumstance.',
    'III. APPLICATION: The actor’s specific conduct, intent, relationship to the other party, and the resulting consequence must be matched to each legal element. A bare conclusion cannot substitute for that element-by-element application.',
    'IV. CONCLUSION: Accordingly, liability and the proper offense follow only to the extent supported by the stated facts and governing law.',
  ].join('\n\n'),
  [
    'I. ANSWER: Yes, if the prosecution proves the required statutory elements beyond reasonable doubt.',
    'II. LEGAL BASIS: The governing Code provision and controlling jurisprudence require proof of the act, criminal intent, and all circumstances that qualify or alter the offense.',
    'III. APPLICATION: Here, the concrete acts and resulting injury described in the question must satisfy each element. Any defense or modifying circumstance must likewise be assessed against the precise timing and conduct alleged.',
    'IV. CONCLUSION: Therefore, the legally supported offense and penalty should be imposed only after that complete analysis.',
  ].join('\n\n'),
];

const subjectMatterAnswer = [
  'I. ANSWER: Yes. Annulment may prosper if the record establishes invalid service and the requisites of Rule 47.',
  'II. LEGAL BASIS: Rule 47, Sections 1 and 2 of the Rules of Court allow annulment of an RTC judgment for lack of jurisdiction when ordinary remedies are no longer available through no fault of the petitioner. Under Rule 14, Section 6, substituted service is exceptional and requires the prescribed prior attempts and a qualified recipient at a permitted place.',
  'III. APPLICATION: The process server made only a first attempt and left summons with a company secretary without recording diligent efforts to locate the individual defendant. That does not satisfy valid substituted service. Without valid service or voluntary appearance, the court did not acquire jurisdiction over the defendant, who learned of the default judgment only after ordinary remedies had expired through no fault of his own.',
  'IV. CONCLUSION: Therefore, annulment for lack of jurisdiction may prosper, without prejudice to refiling where allowed.',
].join('\n\n');

async function waitForSaved(page) {
  await page.waitForFunction(() => {
    const node = document.getElementById('dd-save-state');
    return node && /^Saved\b/i.test(node.textContent || '');
  }, null, { timeout: 15_000 });
}

async function runAccessibilityAudit(page, label) {
  if (!await page.evaluate(() => Boolean(window.axe))) {
    await page.addScriptTag({
      url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js',
    });
  }
  const audit = await page.evaluate(async () => window.axe.run(document, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
  }));
  results.accessibility[label] = audit.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    targets: violation.nodes.map((node) => node.target),
    summaries: violation.nodes.map((node) => node.failureSummary),
  }));
  assert.deepEqual(
    results.accessibility[label],
    [],
    `${label} has WCAG A/AA violations.`,
  );
}

async function completeOnboardingIfShown(page) {
  await page.waitForTimeout(2_500);
  const onboarding = page.locator('#dd2-onboarding-overlay.is-open');
  if (!await onboarding.isVisible().catch(() => false)) return;
  await page.locator('#dd2-display-name').fill('Synthetic Staging Examinee');
  await page.locator('#dd2-enrollment-status').selectOption('not_yet_enrolled');
  await page.locator('#dd2-legal-acceptance').check();
  await page.locator('#dd2-onboarding-submit').click();
  await onboarding.waitFor({ state: 'hidden', timeout: 20_000 });
}

function normalizeEditorText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readEditorText(page, selector) {
  return page.locator(selector).evaluate((editor) => (
    editor.isContentEditable ? editor.innerText : editor.value
  ));
}

async function verifyTwentyTabSwitches(page, selector, label, initialAnswer) {
  await page.evaluate(() => {
    window.__ddQaVisibilityChanges = 0;
    window.__ddQaVisibilityState = document.visibilityState;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => window.__ddQaVisibilityState,
    });
    document.addEventListener('visibilitychange', () => {
      window.__ddQaVisibilityChanges += 1;
    });
  });

  const alternatePage = await page.context().newPage();
  await alternatePage.goto('about:blank');
  let expected = initialAnswer;
  try {
    for (let index = 1; index <= 20; index += 1) {
      expected += `\n\nDraft continuity check ${index}.`;
      await page.bringToFront();
      await page.locator(selector).fill(expected);
      await alternatePage.bringToFront();
      await page.evaluate(() => {
        window.__ddQaVisibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(35);
      await page.bringToFront();
      await page.evaluate(() => {
        window.__ddQaVisibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(35);
      assert.equal(
        normalizeEditorText(await readEditorText(page, selector)),
        normalizeEditorText(expected),
        `${label} lost text during tab switch ${index}.`,
      );
    }
    await waitForSaved(page);
    const visibilityChanges = await page.evaluate(() => window.__ddQaVisibilityChanges || 0);
    assert.ok(
      visibilityChanges >= 40,
      `${label} did not observe the required hidden/visible lifecycle transitions (${visibilityChanges}).`,
    );
    results.draftPersistence[label] = {
      switches: 20,
      visibilityChanges,
      automationVisibilityOverride: true,
      liveTextPreserved: true,
    };
  } finally {
    await alternatePage.close();
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(
    () => Boolean(
      window.DueDiligencePhase4?.getSession?.()?.access_token
      && window.DueDiligencePhase2?.getSession?.()?.access_token
    ),
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    (editorSelector) => (
      window.DueDiligenceExaminations?.getState?.().screen === 'room'
      && Boolean(document.querySelector(editorSelector))
    ),
    selector,
    { timeout: 30_000 },
  );
  assert.equal(
    normalizeEditorText(await readEditorText(page, selector)),
    normalizeEditorText(expected),
    `${label} did not restore the newest draft after reload.`,
  );
  results.draftPersistence[label].reloadRestored = true;
  return expected;
}

async function completeTermsAcceptanceIfShown(page) {
  await page.waitForTimeout(500);
  const overlay = page.locator('#dd2-entry-overlay.is-open');
  if (!await overlay.isVisible().catch(() => false)) return;
  const consent = overlay.locator('#dd2-entry-consent');
  assert.equal(
    await consent.isVisible().catch(() => false),
    true,
    `Unexpected authentication overlay: ${await overlay.innerText()}`,
  );
  await consent.locator('#dd2-entry-legal-acceptance').check();
  await consent.locator('#dd2-entry-consent-submit').click();
  await overlay.waitFor({ state: 'hidden', timeout: 20_000 });
}

async function authenticate(page) {
  await page.goto(`${siteUrl}/?qa=examinations&release=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.waitForFunction(
    () => Boolean(window.supabase?.createClient && window.DueDiligencePhase2Config),
    null,
    { timeout: 15_000 },
  );
  const configuredBackend = await page.evaluate(async () => {
    const configuration = window.DueDiligencePhase2Config.supabase;
    const response = await fetch(`${configuration.url}/auth/v1/health`, {
      headers: { apikey: configuration.publishableKey },
    });
    return {
      currentHost: location.host,
      supabaseUrl: configuration.url,
      publishableKeyLength: configuration.publishableKey.length,
      publishablePrefixValid: configuration.publishableKey.startsWith('sb_publishable_'),
      authHealthStatus: response.status,
    };
  });
  assert.deepEqual(configuredBackend, {
    currentHost: new URL(siteUrl).host,
    supabaseUrl: 'https://hlzqmreeoghbldnhlybr.supabase.co',
    publishableKeyLength: 46,
    publishablePrefixValid: true,
    authHealthStatus: 200,
  });
  const authentication = await page.evaluate(async (credentials) => {
    const client = window.supabase.createClient(
      window.DueDiligencePhase2Config.supabase.url,
      window.DueDiligencePhase2Config.supabase.publishableKey,
      {
        auth: {
          persistSession: true,
          storage: window.sessionStorage,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );
    const { data, error } = await client.auth.signInWithPassword(credentials);
    return {
      authenticated: Boolean(data?.session?.access_token),
      error: error?.message || null,
    };
  }, { email, password });
  assert.equal(authentication.error, null);
  assert.equal(authentication.authenticated, true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(
    () => Boolean(
      window.DueDiligencePhase4?.getSession?.()?.access_token
      && window.DueDiligencePhase2?.getSession?.()?.access_token
    ),
    null,
    { timeout: 30_000 },
  );
  await completeOnboardingIfShown(page);
  await completeTermsAcceptanceIfShown(page);
  await page.evaluate(() => localStorage.removeItem('duediligence.examinations.recovery.v1'));
}

async function adminOperation(page, operation, payload = {}) {
  return page.evaluate(async ({ operation: requestedOperation, payload: requestedPayload }) => {
    const session = window.DueDiligencePhase4?.getSession?.();
    if (!session?.access_token) throw new Error('The staging admin session is unavailable.');
    const request = {
      operation: requestedOperation,
      ...requestedPayload,
      ...(!['dashboard', 'audit'].includes(requestedOperation)
        ? {
            reason: requestedPayload.reason || 'Synthetic staging UI verification',
            requestKey: requestedPayload.requestKey
              || `qa_${requestedOperation}_${crypto.randomUUID()}`,
          }
        : {}),
    };
    const response = await fetch(
      `${window.DueDiligencePhase2Config.workerUrl}/admin/examinations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      throw new Error(
        `${body?.error?.code || response.status}: ${body?.error?.message || 'Admin request failed.'}`,
      );
    }
    return body.data;
  }, { operation, payload });
}

async function publishFixture(page, {
  track,
  assessmentKind,
  subject,
  title,
  questionOffset = 0,
}) {
  const dashboard = await adminOperation(page, 'dashboard');
  const questionIds = dashboard.approvedQuestions
    .filter((question) => question.subject === subject)
    .slice(questionOffset, questionOffset + 3)
    .map((question) => question.questionId);
  assert.equal(questionIds.length, 3, `Expected three approved ${subject} questions.`);

  const examination = await adminOperation(page, 'create_exam', {
    track,
    assessmentKind,
    title,
    subject,
    yearLevel: 1,
    testOnly: true,
  });
  createdExamIds.push(examination.examId);
  const version = await adminOperation(page, 'create_version', {
    examId: examination.examId,
    label: `Staging browser ${runId}`,
    durationSeconds: 3_600,
    timerMode: track === 'bar_feels' ? 'strict' : 'selfPaced',
    gradingRoute: 'ai',
    answerReleaseRule: 'after_ai',
    instructions: 'Synthetic staging browser verification. Answer each item using ALAC.',
    syllabus: ['Controlled staging browser verification'],
  });
  await adminOperation(page, 'set_questions', {
    versionId: version.versionId,
    questionIds,
  });
  const published = await adminOperation(page, 'publish_version', {
    versionId: version.versionId,
  });
  assert.equal(published.status, 'published');
  return {
    examId: examination.examId,
    versionId: version.versionId,
    title,
    track,
  };
}

async function openCatalog(page, track) {
  await page.evaluate(async (selectedTrack) => {
    if (selectedTrack === 'bar_feels') {
      await window.DueDiligenceExaminations.openBarFeels();
    } else {
      await window.DueDiligenceExaminations.openPerSubject();
    }
  }, track);
  await page.waitForFunction(
    (selectedTrack) => (
      window.DueDiligenceExaminations?.getState?.().screen === 'catalog'
      && window.DueDiligenceExaminations?.getState?.().track === selectedTrack
    ),
    track,
    { timeout: 15_000 },
  );
}

async function verifySubjectWorkspaceLayout(page, stateLabel, viewports) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const writing = document.querySelector('.dd-subject-editorial-pane.is-writing');
      const review = document.querySelector('.dd-subject-editorial-pane.is-review-panel');
      const grid = document.querySelector('.dd-subject-editorial-grid');
      const buttons = [...document.querySelectorAll(
        '.dd-subject-editorial button:not([hidden]), .dd-subject-editorial a:not([hidden])',
      )].filter((element) => getComputedStyle(element).display !== 'none');
      const writingRect = writing?.getBoundingClientRect();
      const reviewRect = review?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        writingLeft: writingRect?.left ?? null,
        writingTop: writingRect?.top ?? null,
        reviewLeft: reviewRect?.left ?? null,
        reviewTop: reviewRect?.top ?? null,
        writingOverflowY: writing ? getComputedStyle(writing).overflowY : null,
        reviewOverflowY: review ? getComputedStyle(review).overflowY : null,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
        shortControls: buttons
          .map((element) => ({ text: element.textContent.trim().slice(0, 60), height: element.getBoundingClientRect().height }))
          .filter((entry) => entry.height > 0 && entry.height < 43),
      };
    });
    const label = `${stateLabel}-${viewport.width}x${viewport.height}`;
    results.responsive[label] = layout;
    assert.equal(layout.overflow, false, `${label} must not overflow horizontally.`);
    assert.deepEqual(layout.shortControls, [], `${label} must retain 44px touch targets.`);
    if (viewport.width > 900) {
      assert.ok(layout.writingLeft < layout.reviewLeft, `${label} must keep writing on the left.`);
      assert.match(layout.writingOverflowY, /auto|scroll/);
      assert.match(layout.reviewOverflowY, /auto|scroll/);
    } else {
      assert.ok(layout.writingTop < layout.reviewTop, `${label} must stack writing before review.`);
    }
    await runAccessibilityAudit(page, label);
  }
}

async function completeSubjectMatter(page) {
  await completeOnboardingIfShown(page);
  await openCatalog(page, 'per_subject');
  const subject = 'Civil Procedure II';
  await page.locator('[data-subject-selector-open]').click();
  const subjectSelector = page.locator('#dd-subject-selector-dialog[open]');
  await subjectSelector.waitFor({ state: 'visible', timeout: 15_000 });
  await subjectSelector.locator('#dd-subject-search-mobile').fill(subject);
  await subjectSelector.locator(`[data-exam-subject="${subject}"]`).click();
  await page.locator(`[data-subject-start="${subject}"]`).click();
  await page.waitForFunction(
    () => (
      window.DueDiligenceExaminations?.getState?.().screen === 'room'
      && Boolean(document.getElementById('dd-answer-editor'))
    ),
    null,
    { timeout: 15_000 },
  );
  assert.equal(
    await page.locator('#dd-exam-setup-dialog[open]').isVisible().catch(() => false),
    false,
    'Subject Matter must start directly without a mandatory timer dialog.',
  );
  const practiceRoom = page.locator('#dd-per-subject-app .dd-subject-editorial:not(.is-result)');
  await practiceRoom.waitFor({ state: 'visible', timeout: 15_000 });
  await practiceRoom.locator('.dd-subject-editorial-grid').waitFor({ state: 'visible' });
  assert.equal(await practiceRoom.locator('.dd-subject-editorial-pane.is-writing').count(), 1);
  assert.equal(
    await practiceRoom.locator('.dd-subject-editorial-pane.is-coaching.is-review-panel').count(),
    1,
  );
  const practiceRoomText = await practiceRoom.innerText();
  assert.match(practiceRoomText, /WRITING TIME/i);
  assert.match(practiceRoomText, /\b\d{2}:\d{2}\b/);
  assert.match(practiceRoomText, /Reveal Complete Review/i);
  assert.match(practiceRoomText, /Assisted \/ Open-book/i);
  assert.doesNotMatch(practiceRoomText, /Question\s+\d+\s+of\s+\d+|\b\d+\s+questions?\b/i);
  assert.doesNotMatch(practiceRoomText, /Suggested Answer|Complete Legal Basis|Why This Answer Is Correct|Official source \d/i);
  assert.doesNotMatch(practiceRoomText, /\bA\.?L\.?A\.?C\.?\b/i);
  const attemptId = await page.evaluate(
    () => window.DueDiligenceExaminations.getState().activeAttemptId,
  );
  assert.match(attemptId, /^[0-9a-f-]{36}$/i);

  await verifySubjectWorkspaceLayout(page, 'subject-locked', [
    { width: 1_366, height: 768 },
    { width: 1_440, height: 900 },
    { width: 768, height: 1_024 },
    { width: 375, height: 812 },
    { width: 320, height: 568 },
  ]);
  await page.setViewportSize({ width: 1_440, height: 900 });

  const revealButton = practiceRoom.locator('[data-subject-review-reveal]');
  await revealButton.click();
  const completeReview = practiceRoom.locator('[data-subject-review-content]');
  await completeReview.waitFor({ state: 'visible', timeout: 150_000 });
  const completeReviewText = await completeReview.innerText();
  assert.match(completeReviewText, /Suggested Answer/i);
  assert.match(completeReviewText, /Complete Legal Basis/i);
  assert.match(completeReviewText, /Why This Answer Is Correct/i);
  assert.match(completeReviewText, /Verified official sources/i);
  assert.match(completeReviewText, /Assisted \/ Open-book/i);
  const legalBasisText = await completeReview.locator('.dd-subject-review-section')
    .filter({ hasText: 'Complete Legal Basis' })
    .locator('.dd-subject-review-prose')
    .innerText();
  assert.ok(legalBasisText.length >= 20, 'Subject Matter must reveal a substantive approved legal basis.');
  assert.doesNotMatch(legalBasisText, /Not released|general writing tip|Review the controlling provision/i);
  const teachingText = await completeReview.locator('.dd-subject-review-section')
    .filter({ hasText: 'Why This Answer Is Correct' })
    .innerText();
  assert.ok(teachingText.length >= 100, 'Subject Matter must reveal a substantial source-bound teaching explanation.');
  assert.ok(await completeReview.locator('a[href^="https://"]').count() >= 1,
    'Subject Matter must reveal at least one linked official source.');

  await verifySubjectWorkspaceLayout(page, 'subject-revealed', [
    { width: 1_366, height: 768 },
    { width: 375, height: 812 },
  ]);
  await page.setViewportSize({ width: 1_440, height: 900 });

  await page.locator('#dd-answer-editor').fill(subjectMatterAnswer);
  await waitForSaved(page);
  await verifyTwentyTabSwitches(
    page,
    '#dd-answer-editor',
    'subjectMatter',
    subjectMatterAnswer,
  );
  await page.locator('[data-submit-current]').click();
  const subjectResult = page.locator('#dd-per-subject-app .dd-subject-editorial.is-result');
  await subjectResult.waitFor({ state: 'visible', timeout: 150_000 });

  const scores = await subjectResult.locator('.score-medallion strong').allTextContents();
  assert.equal(scores.length, 1);
  scores.forEach((score) => assert.match(score, /^[0-5]\.\d \/ 5$/));
  const verdictText = await subjectResult.innerText();
  assert.match(verdictText, /Evaluation overview/i);
  assert.match(verdictText, /Suggested Answer/i);
  assert.match(verdictText, /Complete Legal Basis/i);
  assert.match(verdictText, /Why This Answer Is Correct/i);
  assert.match(verdictText, /Verified official sources/i);
  assert.match(verdictText, /Assisted \/ Open-book/i);
  assert.doesNotMatch(verdictText, /Question\s+\d+\s+of\s+\d+|\b\d+\s+questions?\b/i);
  assert.doesNotMatch(verdictText, /\b\d{1,3}\s*\/\s*100\b/);
  assert.doesNotMatch(verdictText, /\bA\.?L\.?A\.?C\.?\b/i);
  assert.equal(await subjectResult.locator('[data-subject-review-content]').count(), 1,
    'The complete review must persist beside the graded result without another reveal.');

  await verifySubjectWorkspaceLayout(page, 'subject-graded', [
    { width: 1_366, height: 768 },
    { width: 375, height: 812 },
  ]);
  await page.setViewportSize({ width: 1_440, height: 1_100 });

  return { track: 'per_subject', attemptId, scores };
}

async function completeExamination(page, fixture) {
  await completeOnboardingIfShown(page);
  await openCatalog(page, fixture.track);
  const rootSelector = fixture.track === 'bar_feels'
    ? '#dd-bar-feels-app'
    : '#dd-per-subject-app';
  const catalogText = await page.locator(rootSelector).innerText();
  assert.ok(
    catalogText.includes(fixture.title),
    `Published staging fixture was absent from ${fixture.track} catalog: ${catalogText.slice(0, 1_200)}`,
  );
  const title = page.getByText(fixture.title, { exact: true });
  await title.waitFor({ state: 'visible', timeout: 15_000 });
  const card = title.locator('xpath=ancestor::article[1]');
  const setupButton = card.locator(`[data-exam-setup="${fixture.versionId}"]`);
  await setupButton.click();
  const dialog = page.locator('#dd-exam-setup-dialog[open]');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  const dialogText = await dialog.innerText();
  assert.match(dialogText, /1 hour\b/);
  assert.doesNotMatch(dialogText, /1 hours\b/);
  assert.match(dialogText, fixture.track === 'bar_feels'
    ? /BAR FEELS/i
    : /SUBJECT MATTER EXAMINATION/i);
  await dialog.locator('[data-exam-begin]').click();
  await page.waitForFunction(
    () => window.DueDiligenceExaminations?.getState?.().screen === 'room',
    null,
    { timeout: 15_000 },
  );
  const attemptId = await page.evaluate(
    () => window.DueDiligenceExaminations.getState().activeAttemptId,
  );
  assert.match(attemptId, /^[0-9a-f-]{36}$/i);

  for (let index = 0; index < completeAnswers.length; index += 1) {
    const editorSelector = fixture.track === 'bar_feels'
      ? '#dd-answer-rich-editor'
      : '#dd-answer-editor';
    await page.locator(editorSelector).fill(completeAnswers[index]);
    await waitForSaved(page);
    if (index === 0 && fixture.track === 'bar_feels') {
      await verifyTwentyTabSwitches(
        page,
        editorSelector,
        'barFeels',
        completeAnswers[index],
      );
    }
    if (index < completeAnswers.length - 1) {
      await page.locator('[data-question-next]').click();
      await page.waitForFunction(
        ({ ordinal, selector }) => document.querySelector(selector)
          ?.querySelector('.dd-question-label')
          ?.textContent?.includes(`Question ${ordinal} of 3`),
        { ordinal: index + 2, selector: rootSelector },
        { timeout: 15_000 },
      );
    }
  }

  await page.locator('[data-review-all]').click();
  await page.waitForFunction(
    () => window.DueDiligenceExaminations?.getState?.().screen === 'review',
    null,
    { timeout: 15_000 },
  );
  const reviewText = await page.locator(rootSelector).innerText();
  assert.match(reviewText, /3\s+ANSWERED/i);
  assert.match(reviewText, /0\s+UNANSWERED/i);

  await page.locator('[data-submit-exam]').click();
  await page.waitForFunction(
    () => window.DueDiligenceExaminations?.getState?.().screen === 'receipt',
    null,
    { timeout: 20_000 },
  );
  const receiptText = await page.locator('.dd-receipt-screen').innerText();
  assert.match(receiptText, /Your examination is preserved/i);
  assert.match(receiptText, /3\s+ANSWERED/i);

  const verdictHeading = page.locator(`${rootSelector} .dd-verdict-screen h1`).filter({
    hasText: 'Individual ALAC assessments.',
  });
  const incompleteAssessment = page.getByText(
    'The examiner returned an incomplete ALAC assessment.',
    { exact: true },
  );
  let assessmentComplete = false;
  for (let assessmentAttempt = 1; assessmentAttempt <= 2; assessmentAttempt += 1) {
    await page.locator('[data-request-ai]').click();
    const outcome = await Promise.race([
      verdictHeading.waitFor({ state: 'visible', timeout: 300_000 }).then(() => 'complete'),
      incompleteAssessment.waitFor({ state: 'visible', timeout: 300_000 }).then(() => 'incomplete'),
    ]);
    if (outcome === 'complete') {
      assessmentComplete = true;
      break;
    }
  }
  if (!assessmentComplete) {
    const currentText = await page.locator(rootSelector).innerText().catch(() => 'Unavailable');
    throw new Error(
      `AI assessment remained incomplete after one controlled retry. Current UI: ${currentText.slice(0, 2_000)}; `
      + `network errors: ${JSON.stringify(results.networkErrors)}; console errors: ${JSON.stringify(results.consoleErrors)}`,
    );
  }
  const scores = await page.locator(`${rootSelector} .score-medallion strong`).allTextContents();
  assert.equal(scores.length, 3);
  scores.forEach((score) => assert.match(score, /^[0-5]\.\d \/ 5$/));
  const verdictText = await page.locator(`${rootSelector} .dd-verdict-screen`).innerText();
  assert.match(verdictText, /Approved Model Answer/i);
  assert.match(verdictText, /Individual Question Assessment/i);
  assert.doesNotMatch(verdictText, /\b\d{1,3}\s*\/\s*100\b/);

  return { track: fixture.track, attemptId, scores };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1_100 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      results.consoleErrors.push({
        text: message.text(),
        url: message.location().url || null,
      });
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      results.networkErrors.push({ status: response.status(), url: response.url() });
    }
  });
  page.on('pageerror', (error) => results.pageErrors.push(String(error)));

  await authenticate(page);
  await adminOperation(page, 'set_beta_access', {
    userId: await page.evaluate(() => window.DueDiligencePhase4.getSession().user.id),
    enabled: true,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString(),
  });

  results.examinations.push(await completeSubjectMatter(page));
  const barFeelsFixture = await publishFixture(page, {
    track: 'bar_feels',
    assessmentKind: 'curated',
    subject: 'Persons and Family Law',
    title: `[SYNTHETIC ${runId}] 00 Bar Feels UI`,
    questionOffset: 6,
  });

  results.examinations.push(await completeExamination(page, barFeelsFixture));

  const viewportChecks = [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 768, height: 1_024 },
    { width: 1_024, height: 768 },
    { width: 1_440, height: 1_100 },
  ];
  const catalogChecks = [
    { track: 'per_subject', label: 'subjectMatter', heading: 'Subject Matter' },
    { track: 'bar_feels', label: 'barFeels', heading: 'Bar Feels' },
  ];
  for (const viewport of viewportChecks) {
    await page.setViewportSize(viewport);
    for (const catalog of catalogChecks) {
      await openCatalog(page, catalog.track);
      const label = `${catalog.label}-${viewport.width}`;
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('body *')]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              id: element.id,
              className: String(element.className || '').slice(0, 120),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            };
          })
          .filter((item) => item.right > innerWidth + 1 || item.left < -1)
          .slice(0, 12),
      }));
      results.responsive[label] = {
        ...layout,
        headingVisible: await page.getByRole('heading', {
          name: catalog.heading,
          exact: true,
        }).isVisible(),
      };
      assert.equal(
        results.responsive[label].overflow,
        false,
        `${label} overflow: ${JSON.stringify(results.responsive[label])}`,
      );
      assert.equal(results.responsive[label].headingVisible, true);
      await runAccessibilityAudit(page, label);
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1_024, height: 768 });
  for (const catalog of catalogChecks) {
    await openCatalog(page, catalog.track);
    const motion = await page.evaluate(() => {
      const animated = [...document.querySelectorAll('body *')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const duration = Math.max(...style.animationDuration.split(',').map((value) => (
            value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1_000
          )));
          return style.animationName !== 'none' && Number.isFinite(duration) && duration > 1;
        })
        .map((element) => ({
          tag: element.tagName,
          id: element.id,
          className: String(element.className || '').slice(0, 100),
        }));
      return {
        mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        longAnimations: animated,
      };
    });
    results.reducedMotion[catalog.label] = motion;
    assert.equal(motion.mediaMatches, true);
    assert.deepEqual(motion.longAnimations, []);
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  for (const catalog of catalogChecks) {
    await openCatalog(page, catalog.track);
    const zoom = await page.evaluate(() => ({
      scale: visualViewport?.scale || 1,
      visualWidth: visualViewport?.width || innerWidth,
      layoutWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      activeControls: [...document.querySelectorAll('button:not([hidden]), a[href]:not([hidden])')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }).length,
    }));
    results.highZoom[catalog.label] = zoom;
    assert.equal(zoom.scale, 2);
    assert.equal(zoom.documentWidth <= zoom.layoutWidth + 1, true);
    assert.ok(zoom.activeControls > 0);
    assert.equal(await page.getByRole('heading', { name: catalog.heading, exact: true }).isVisible(), true);
  }
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.deepEqual(results.consoleErrors, []);
  assert.deepEqual(results.networkErrors, []);
  assert.deepEqual(results.pageErrors, []);
  results.ok = true;
  results.createdExamIds = createdExamIds;
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
