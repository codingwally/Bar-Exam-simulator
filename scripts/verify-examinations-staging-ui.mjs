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
  if (results.accessibility[label].length) {
    const first = results.accessibility[label][0];
    assert.fail(`${label} has WCAG A/AA violations: ${first.id}; target=${JSON.stringify(first.targets[0] || [])}; ${first.summaries[0] || ''}`);
  }
}

async function completeOnboardingIfShown(page) {
  await page.waitForTimeout(2_500);
  const onboarding = page.locator('#dd2-onboarding-overlay.is-open');
  if (!await onboarding.isVisible().catch(() => false)) return;
  await page.locator('#dd2-display-name').fill('Synthetic Staging Examinee');
  await page.locator('#dd2-school').fill('Philippine Law School');
  await page.locator('#dd2-year-level').selectOption('review');
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
  const access = await page.evaluate(async () => {
    const result = await window.DueDiligencePhase4.refreshAccess({
      enforce: false,
      force: true,
    });
    return {
      allowed: result?.allowed === true,
      basis: String(result?.basis || ''),
      choiceRequired: result?.choiceRequired === true,
      profileCompleted: result?.profileCompleted === true,
    };
  });
  assert.deepEqual(access, {
    allowed: true,
    basis: 'super_admin',
    choiceRequired: false,
    profileCompleted: true,
  });
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
  const triggerId = track === 'bar_feels' ? 'spa-bar-feels' : 'spa-subject-matter';
  const expectedPageId = track === 'bar_feels' ? 'page-bar-feels' : 'page-midterms';
  const rootSelector = track === 'bar_feels' ? '#dd-bar-feels-app' : '#dd-per-subject-app';
  const expectedRootId = rootSelector.slice(1);
  await page.evaluate((id) => {
    const trigger = document.getElementById(id);
    if (!trigger) throw new Error(`The public navigation control ${id} is unavailable.`);
    trigger.click();
  }, triggerId);
  try {
    await page.waitForFunction(
      ({ selectedTrack, pageId, rootId }) => (
        window.DueDiligenceExaminations?.getState?.().screen === 'catalog'
        && window.DueDiligenceExaminations?.getState?.().track === selectedTrack
        && document.getElementById('authenticated-app-shell')?.hidden === false
        && document.getElementById(pageId)?.classList.contains('active') === true
        && document.getElementById(rootId)?.childElementCount > 0
      ),
      { selectedTrack: track, pageId: expectedPageId, rootId: expectedRootId },
      { timeout: 30_000 },
    );
  } catch (error) {
    const safeNavigationState = await page.evaluate(() => ({
      activePage: document.querySelector('.page.active')?.id || null,
      appShellHidden: document.getElementById('authenticated-app-shell')?.hidden ?? null,
      rootChildren: document.getElementById(
        window.DueDiligenceExaminations?.getState?.().track === 'bar_feels'
          ? 'dd-bar-feels-app'
          : 'dd-per-subject-app',
      )?.childElementCount ?? null,
      hash: location.hash,
      state: window.DueDiligenceExaminations?.getState?.() || null,
      access: (() => {
        const access = window.DueDiligencePhase4?.getAccess?.();
        return access ? {
          allowed: access.allowed === true,
          basis: String(access.basis || ''),
          choiceRequired: access.choiceRequired === true,
          profileCompleted: access.profileCompleted === true,
        } : null;
      })(),
    }));
    throw new Error(
      `Public navigation did not open ${track}: ${JSON.stringify(safeNavigationState)}`,
      { cause: error },
    );
  }
  await page.locator(rootSelector).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator(rootSelector).getByRole('heading', {
    name: track === 'bar_feels' ? 'Bar Exam Simulation' : 'Syllabus-Based Review',
    exact: true,
  }).waitFor({ state: 'visible', timeout: 45_000 });
}

async function verifySubjectChooserGeometry(page) {
  for (const viewport of [
    { width: 1_440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    const callout = page.locator('#dd-per-subject-app .dd-subject-selection-callout');
    await callout.waitFor({ state: 'visible', timeout: 15_000 });
    const geometry = await callout.evaluate((section) => {
      const shell = section.closest('.dd-exam-shell');
      const heading = section.querySelector('#dd-subject-course-selection-heading');
      const summary = section.querySelector('.dd-subject-selection-summary');
      const browse = section.querySelector('[data-subject-selector-open]');
      const note = section.querySelector('.dd-subject-selection-note');
      const rect = (node) => {
        const bounds = node.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
          centerX: bounds.left + (bounds.width / 2),
        };
      };
      const browseStyle = getComputedStyle(browse);
      const originalScrollX = scrollX;
      const maxScrollX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
      scrollTo(maxScrollX, scrollY);
      const horizontalScrollReach = Math.abs(scrollX - originalScrollX);
      scrollTo(originalScrollX, scrollY);
      const sectionBounds = rect(section);
      return {
        shell: rect(shell),
        section: sectionBounds,
        heading: rect(heading),
        summary: rect(summary),
        browse: rect(browse),
        note: rect(note),
        sectionAlignItems: getComputedStyle(section).alignItems,
        browseBackgroundImage: browseStyle.backgroundImage,
        browseClasses: [...browse.classList],
        documentOverflowPixels: maxScrollX,
        horizontalScrollReach,
        overflow: horizontalScrollReach > 1
          || sectionBounds.left < -1
          || sectionBounds.right > innerWidth + 1,
      };
    });
    const label = `subject-chooser-${viewport.width}x${viewport.height}`;
    results.responsive[label] = geometry;
    const withinPixel = (a, b) => Math.abs(a - b) <= 1;
    assert.equal(geometry.overflow, false, `${label} must not overflow horizontally.`);
    assert.equal(geometry.sectionAlignItems, 'center', `${label} must use centered flex alignment.`);
    assert.ok(withinPixel(geometry.section.centerX, geometry.shell.centerX),
      `${label} callout must be centered within the Subject Matter shell.`);
    for (const [name, bounds] of [
      ['heading', geometry.heading],
      ['summary', geometry.summary],
      ['Browse courses', geometry.browse],
      ['supporting note', geometry.note],
    ]) {
      assert.ok(withinPixel(bounds.centerX, geometry.section.centerX),
        `${label} ${name} must share the callout centerline.`);
    }
    assert.ok(geometry.summary.bottom < geometry.browse.top,
      `${label} Browse courses must sit below the study guidance.`);
    assert.ok(geometry.browse.bottom < geometry.note.top,
      `${label} the supporting note must follow the Browse courses action.`);
    assert.ok(geometry.browse.height >= 44, `${label} Browse courses must preserve a 44px target.`);
    assert.ok(geometry.browseClasses.includes('dd-control')
      && geometry.browseClasses.includes('is-primary'),
    `${label} Browse courses must use the shared primary control.`);
    assert.equal(geometry.browseBackgroundImage, 'none',
      `${label} the primary action must use a solid surface, not a gradient.`);
    await runAccessibilityAudit(page, label);
  }
  await page.setViewportSize({ width: 1_440, height: 900 });
}

async function verifySubjectWorkspaceLayout(page, stateLabel, viewports) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const writing = document.querySelector('.dd-subject-editorial-pane.is-writing');
      const review = document.querySelector('.dd-subject-editorial-pane.is-review-panel');
      const grid = document.querySelector('.dd-subject-editorial-grid');
      const controls = [...document.querySelectorAll(
        '.dd-subject-editorial button:not([hidden]), .dd-subject-editorial a:not([hidden]), .dd-subject-editorial summary',
      )].filter((element) => getComputedStyle(element).display !== 'none');
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      const verticalScroll = scrollY;
      root.style.scrollBehavior = 'auto';
      scrollTo(0, verticalScroll);
      const writingRect = writing?.getBoundingClientRect();
      const reviewRect = review?.getBoundingClientRect();
      const gridRect = grid?.getBoundingClientRect();
      const baselineScrollX = scrollX;
      const maxScrollX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
      scrollTo(maxScrollX, verticalScroll);
      const horizontalScrollReach = Math.abs(scrollX - baselineScrollX);
      scrollTo(0, verticalScroll);
      root.style.scrollBehavior = previousScrollBehavior;
      const workspaceOutsideViewport = [gridRect, writingRect, reviewRect]
        .filter(Boolean)
        .some((bounds) => bounds.left < -1 || bounds.right > innerWidth + 1);
      const overflowCandidates = [...document.querySelectorAll('body *')]
        .filter((element) => {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
          const bounds = element.getBoundingClientRect();
          return bounds.width > 1 && (bounds.left < -1 || bounds.right > innerWidth + 1);
        });
      const overflowCandidateSet = new Set(overflowCandidates);
      const overflowOffenders = overflowCandidates
        .filter((element) => ![...element.querySelectorAll('*')]
          .some((descendant) => overflowCandidateSet.has(descendant)))
        .sort((leftElement, rightElement) => {
          const leftBounds = leftElement.getBoundingClientRect();
          const rightBounds = rightElement.getBoundingClientRect();
          return Math.max(rightBounds.right - innerWidth, -rightBounds.left)
            - Math.max(leftBounds.right - innerWidth, -leftBounds.left);
        })
        .slice(0, 6)
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            className: typeof element.className === 'string' ? element.className.slice(0, 64) : null,
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            width: Math.round(bounds.width),
          };
        });
      return {
        documentOverflowPixels: maxScrollX,
        horizontalScrollReach,
        overflow: horizontalScrollReach > 1 || workspaceOutsideViewport,
        overflowOffenders,
        writingLeft: writingRect?.left ?? null,
        writingTop: writingRect?.top ?? null,
        reviewLeft: reviewRect?.left ?? null,
        reviewTop: reviewRect?.top ?? null,
        writingOverflowY: writing ? getComputedStyle(writing).overflowY : null,
        reviewOverflowY: review ? getComputedStyle(review).overflowY : null,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
        shortControls: controls
          .map((element) => ({ text: element.textContent.trim().slice(0, 60), height: element.getBoundingClientRect().height }))
          .filter((entry) => entry.height > 0 && entry.height < 43),
        unsharedActions: [...document.querySelectorAll(
          '.dd-subject-editorial button.dd-exam-button:not(.dd-control)',
        )].map((element) => element.textContent.trim().slice(0, 60)),
      };
    });
    const label = `${stateLabel}-${viewport.width}x${viewport.height}`;
    results.responsive[label] = layout;
    assert.equal(
      layout.overflow,
      false,
      `${label} must not overflow horizontally. Offenders: ${layout.overflowOffenders
        .map((entry) => `${entry.tag}${entry.id ? `#${entry.id}` : ''}${entry.className ? `.${entry.className.replace(/\s+/g, '.')}` : ''}[${entry.left},${entry.right},${entry.width}]`)
        .join('|') || 'none'}; reach=${layout.horizontalScrollReach}; document=${layout.documentOverflowPixels}; panes=${layout.writingLeft}/${layout.reviewLeft}`,
    );
    assert.deepEqual(layout.shortControls, [], `${label} must retain 44px touch targets.`);
    assert.deepEqual(layout.unsharedActions, [], `${label} must use shared Subject Matter action controls.`);
    if (viewport.width > 900) {
      assert.ok(layout.writingLeft < layout.reviewLeft, `${label} must keep the answer workspace on the left.`);
      assert.equal(layout.writingOverflowY, 'visible', `${label} must use the document reading flow.`);
      assert.equal(layout.reviewOverflowY, 'visible', `${label} must avoid competing pane scrollbars.`);
    } else {
      assert.ok(layout.writingTop < layout.reviewTop, `${label} must stack the answer workspace before review.`);
    }
    await runAccessibilityAudit(page, label);
  }
}

async function completeSubjectMatter(page) {
  await completeOnboardingIfShown(page);
  await completeTermsAcceptanceIfShown(page);
  await openCatalog(page, 'per_subject');
  await verifySubjectChooserGeometry(page);
  const subject = 'Civil Procedure II';
  const courseChooser = page.locator('#dd-per-subject-app [data-subject-selector-open]');
  await courseChooser.scrollIntoViewIfNeeded();
  assert.equal(await courseChooser.isVisible(), true, 'The Subject Matter course chooser must be visible.');
  assert.equal(await courseChooser.isEnabled(), true, 'The Subject Matter course chooser must be enabled.');
  await courseChooser.focus();
  await courseChooser.press('Enter');
  const subjectSelector = page.locator('#dd-subject-selector-dialog[open]');
  await subjectSelector.waitFor({ state: 'visible', timeout: 15_000 });
  await subjectSelector.locator('#dd-subject-search-mobile').fill(subject);
  const courseChoice = subjectSelector.locator(`[data-exam-subject="${subject}"]`);
  await courseChoice.focus();
  await courseChoice.press('Enter');
  const startButton = page.locator(`[data-subject-start="${subject}"]`);
  await startButton.focus();
  await startButton.press('Enter');
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
    await practiceRoom.locator('.dd-subject-editorial-pane.is-reading.is-review-panel').count(),
    1,
  );
  const practiceRoomText = await practiceRoom.innerText();
  assert.match(practiceRoomText, /WRITING TIME/i);
  assert.match(practiceRoomText, /\b\d{2}:\d{2}\b/);
  assert.match(practiceRoomText, /Reveal Answer/i);
  assert.match(practiceRoomText, /Assisted \/ Open-book/i);
  assert.doesNotMatch(practiceRoomText, /Question\s+\d+\s+of\s+\d+|\b\d+\s+questions?\b/i);
  assert.equal(
    await practiceRoom.locator('[data-subject-review-content]').count(),
    0,
    'The complete review content must not exist in the DOM before the reveal operation succeeds.',
  );
  assert.equal(await practiceRoom.locator('.dd-subject-review-disclosures > details').count(), 0,
    'Review disclosures must not exist before the authorized reveal succeeds.');
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

  const revealControls = practiceRoom.locator('[data-subject-review-reveal]');
  assert.equal(await revealControls.count(), 1,
    'The locked review must expose exactly one Reveal Answer control.');
  await revealControls.filter({ hasText: 'Reveal Answer' }).click();
  const completeReview = practiceRoom.locator('[data-subject-review-content]');
  await completeReview.waitFor({ state: 'visible', timeout: 150_000 });
  const revealedDisclosures = completeReview.locator('.dd-subject-review-disclosures > details');
  assert.equal(await revealedDisclosures.count(), 3);
  assert.deepEqual(await revealedDisclosures.evaluateAll((details) => details.map((detail) => detail.open)),
    [true, false, false], 'Only the review section chosen by the user should open after loading.');
  await revealedDisclosures.nth(1).locator('summary').click();
  await revealedDisclosures.nth(2).locator('summary').click();
  const completeReviewText = await completeReview.innerText();
  assert.doesNotMatch(completeReviewText,
    /Rubric\s*\([^)]*points?[^)]*\)\s*:|Grader notes:|internal criterion|fixture canary/i,
    'Internal rubric and grader text must not reach any revealed review section.');
  assert.match(completeReviewText, /Reveal suggested answer/i);
  assert.match(completeReviewText, /Controlling Law & Doctrine/i);
  assert.match(completeReviewText, /Cited Authorities/i);
  assert.match(completeReviewText, /Application and Material Limits/i);
  assert.match(completeReviewText, /Verified official sources/i);
  assert.match(completeReviewText, /Assisted \/ Open-book/i);
  const legalBasisText = await completeReview.locator('.dd-subject-review-section')
    .filter({ hasText: 'Controlling Law & Doctrine' })
    .locator('.dd-subject-review-prose')
    .innerText();
  assert.ok(legalBasisText.length >= 20, 'Subject Matter must reveal a substantive approved legal basis.');
  assert.doesNotMatch(legalBasisText, /Not released|general writing tip|Review the controlling provision/i);
  const teachingText = await completeReview.locator('.dd-subject-review-section')
    .filter({ hasText: 'Application and Material Limits' })
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
  assert.equal(await subjectResult.locator('[data-subject-review-content]').count(), 1,
    'The complete review must persist beside the graded result without another secure request.');
  const resultDisclosures = subjectResult.locator(
    '[data-subject-review-content] .dd-subject-review-disclosures > details',
  );
  assert.equal(await resultDisclosures.count(), 3,
    'The graded review must retain the same three native disclosures.');
  assert.deepEqual(await resultDisclosures.evaluateAll((details) => details.map((detail) => detail.open)),
    [false, false, false], 'The graded review should return to a calm, closed disclosure state.');
  for (let index = 0; index < 3; index += 1) {
    await resultDisclosures.nth(index).locator('summary').click();
  }
  const verdictText = await subjectResult.innerText();
  assert.doesNotMatch(verdictText,
    /Rubric\s*\([^)]*points?[^)]*\)\s*:|Grader notes:|internal criterion|fixture canary/i,
    'Internal rubric and grader text must remain absent after submission.');
  assert.match(verdictText, /Evaluation overview/i);
  assert.match(verdictText, /Reveal suggested answer/i);
  assert.match(verdictText, /Controlling Law & Doctrine/i);
  assert.match(verdictText, /Cited Authorities/i);
  assert.match(verdictText, /Application and Material Limits/i);
  assert.match(verdictText, /Verified official sources/i);
  assert.match(verdictText, /Assisted \/ Open-book/i);
  assert.doesNotMatch(verdictText, /Question\s+\d+\s+of\s+\d+|\b\d+\s+questions?\b/i);
  assert.doesNotMatch(verdictText, /\b\d{1,3}\s*\/\s*100\b/);

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
    ? /BAR EXAM SIMULATION/i
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
    title: `[SYNTHETIC ${runId}] 00 Bar Exam Simulation UI`,
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
    { track: 'per_subject', label: 'subjectMatter', heading: 'Syllabus-Based Review' },
    { track: 'bar_feels', label: 'barFeels', heading: 'Bar Exam Simulation' },
  ];
  for (const viewport of viewportChecks) {
    await page.setViewportSize(viewport);
    for (const catalog of catalogChecks) {
      await openCatalog(page, catalog.track);
      const label = `${catalog.label}-${viewport.width}`;
      const layout = await page.evaluate(() => {
        const originalScrollX = scrollX;
        const maxScrollX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
        scrollTo(maxScrollX, scrollY);
        const horizontalScrollReach = Math.abs(scrollX - originalScrollX);
        scrollTo(originalScrollX, scrollY);
        const offenders = [...document.querySelectorAll('body *')]
          .filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number.parseFloat(style.opacity || '1') > 0
              && !element.closest('[hidden], [inert], [aria-hidden="true"]');
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              id: element.id,
              className: String(element.className || '').slice(0, 120),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          })
          .filter((item) => item.width > 0 && item.height > 0
            && (item.right > innerWidth + 1 || item.left < -1))
          .slice(0, 12);
        return {
          overflow: horizontalScrollReach > 1 || offenders.length > 0,
          innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          horizontalScrollReach,
          offenders,
        };
      });
      const activeRoot = page.locator(
        catalog.track === 'bar_feels' ? '#dd-bar-feels-app' : '#dd-per-subject-app',
      );
      results.responsive[label] = {
        ...layout,
        headingVisible: await activeRoot.getByRole('heading', {
          name: catalog.heading,
          exact: true,
        }).isVisible(),
      };
      assert.equal(
        results.responsive[label].overflow,
        false,
        `${label} overflow: ${JSON.stringify(results.responsive[label])}`,
      );
      assert.equal(
        results.responsive[label].headingVisible,
        true,
        `${label} heading was not visible in the active examination root`,
      );
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
