import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const APPROVED_REVEAL_BASES = new Set([
  'super_admin',
  'founder_admin',
  'founding_beta',
  'early_access',
  'paid_subscription',
]);

const PROTECTED_REVIEW_FIELDS = [
  'suggestedAnswer',
  'legalBasis',
  'governingProvision',
  'doctrine',
  'jurisprudence',
  'citation',
  'legalReview',
  'whyThisAnswerIsCorrect',
  'sources',
  'reviewMaterialRevealedAt',
];

const EXIT_ACTIONS = new Set([
  'close_x',
  'close_back_button',
  'close_backdrop',
  'close_escape',
  'browser_back',
]);

const MATERIAL = Object.freeze({
  suggestedAnswer: 'Answer: Yes. The approved answer remains sealed until a valid release.',
  legalBasis: 'Article 19 of the Civil Code.',
  governingProvision: 'Article 19 of the Civil Code.',
  doctrine: 'A person must act with justice, give everyone their due, and observe good faith.',
  jurisprudence: [],
  citation: '',
  legalReview: {
    controllingLawAndDoctrine: 'Article 19 states the controlling standard.',
  },
  whyThisAnswerIsCorrect: {
    directAnswer: 'Yes.',
    controllingLawAndElements: 'Article 19 states the controlling standard.',
    applicationToFacts: 'The stated facts satisfy that standard.',
    materialExceptionsOrLimits: 'No material exception is stated.',
    finalConclusion: 'The conduct violates Article 19.',
  },
  sources: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345'],
  reviewMaterialRevealedAt: '2026-08-26T00:00:00.000Z',
});

function deniedResponse() {
  return {
    status: 403,
    error: {
      code: 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED',
      message: 'Suggested answers and full legal review require ₱149 Early Access or a paid subscription.',
    },
  };
}

function assertNoProtectedMaterial(value, label = 'denied response') {
  const serialized = JSON.stringify(value);
  for (const field of PROTECTED_REVIEW_FIELDS) {
    assert.equal(field in (value?.data || {}), false, `${label} must omit ${field}`);
    assert.doesNotMatch(serialized, new RegExp(`"${field}"\\s*:`), `${label} must not serialize ${field}`);
  }
  assert.doesNotMatch(serialized, /Article 19|approved answer|judiciary\.gov\.ph/i);
}

class SyllabusReviewPolicyModel {
  constructor() {
    this.users = new Map();
    this.attempts = new Map();
    this.tabs = new Map();
    this.actions = [];
    this.initialTokenLedger = [];
    this.tokenLedger = [];
  }

  addUser(userId, basis, tokensRemaining = 5) {
    this.users.set(userId, { basis, tokensRemaining });
  }

  addAttempt(attemptId, userId, questionId) {
    this.attempts.set(attemptId, {
      attemptId,
      userId,
      questionId,
      draft: '',
      savedDraft: '',
      submitted: false,
      assisted: false,
      released: false,
      releaseCount: 0,
      auditCount: 0,
      providerCount: 0,
    });
  }

  addTab(tabId, userId, attemptId) {
    this.tabs.set(tabId, {
      tabId,
      userId,
      attemptId,
      route: '#subject-matter',
      modal: null,
      content: null,
      focus: 'answer',
      timerCount: 0,
      lastResponse: null,
    });
  }

  record(tabId, action, details = {}) {
    this.actions.push({ tabId, action, ...details });
  }

  tab(tabId) {
    const tab = this.tabs.get(tabId);
    assert.ok(tab, `tab ${tabId} must exist`);
    return tab;
  }

  attemptFor(tab) {
    const attempt = this.attempts.get(tab.attemptId);
    assert.ok(attempt, `attempt ${tab.attemptId} must exist`);
    return attempt;
  }

  userFor(tab) {
    const user = this.users.get(tab.userId);
    assert.ok(user, `user ${tab.userId} must exist`);
    return user;
  }

  installTimer(tabId) {
    const tab = this.tab(tabId);
    this.record(tabId, 'install_timer');
    tab.timerCount = 1;
  }

  type(tabId, text) {
    const tab = this.tab(tabId);
    const attempt = this.attemptFor(tab);
    this.record(tabId, 'typing', { text });
    if (!attempt.submitted) attempt.draft += text;
  }

  autosave(tabId) {
    const tab = this.tab(tabId);
    const attempt = this.attemptFor(tab);
    this.record(tabId, 'autosave');
    attempt.savedDraft = attempt.draft;
  }

  heartbeat(tabId) {
    this.record(tabId, 'heartbeat');
  }

  background(tabId, action) {
    assert.ok(['pageshow', 'visibility', 'focus', 'access_refresh'].includes(action));
    this.record(tabId, action);
    // Background lifecycle events may refresh entitlement state, but they may
    // neither open the contextual gate nor reveal protected material.
  }

  reveal(tabId) {
    const tab = this.tab(tabId);
    const attempt = this.attemptFor(tab);
    const user = this.userFor(tab);
    this.record(tabId, 'reveal_click');

    if (attempt.userId !== tab.userId) {
      tab.content = null;
      tab.lastResponse = { status: 404, error: { code: 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE' } };
      return tab.lastResponse;
    }

    if (attempt.released) {
      tab.modal = null;
      tab.content = MATERIAL;
      tab.lastResponse = { status: 200, data: MATERIAL, replayed: true };
      return tab.lastResponse;
    }

    if (!APPROVED_REVEAL_BASES.has(user.basis)) {
      tab.content = null;
      tab.modal = {
        kind: 'syllabus_review_access',
        key: `${attempt.attemptId}:${attempt.questionId}`,
        pricePhp: 149,
      };
      tab.focus = 'paywall';
      tab.lastResponse = deniedResponse();
      return tab.lastResponse;
    }

    // This represents the database row-lock/idempotency boundary. Only the
    // transition from unreleased to released may mutate release side effects.
    attempt.released = true;
    attempt.releaseCount += 1;
    attempt.auditCount += 1;
    attempt.providerCount += 1;
    if (!attempt.submitted) attempt.assisted = true;
    tab.modal = null;
    tab.content = MATERIAL;
    tab.focus = 'review';
    tab.lastResponse = { status: 200, data: MATERIAL, replayed: false };
    return tab.lastResponse;
  }

  dismiss(tabId, action) {
    assert.ok(EXIT_ACTIONS.has(action), `${action} must be an allowed gate exit`);
    const tab = this.tab(tabId);
    this.record(tabId, action);
    tab.modal = null;
    tab.focus = 'answer';
    // The editor route is deliberately unchanged for every close path.
  }

  submit(tabId) {
    const tab = this.tab(tabId);
    const attempt = this.attemptFor(tab);
    this.record(tabId, 'submit');
    attempt.savedDraft = attempt.draft;
    attempt.submitted = true;
  }

  paymentCancel(tabId) {
    const tab = this.tab(tabId);
    this.record(tabId, 'payment_cancel');
    tab.modal = null;
    tab.focus = 'answer';
  }

  paymentSuccess(userId, basis = 'early_access') {
    const user = this.users.get(userId);
    assert.ok(user, `user ${userId} must exist`);
    this.record(null, 'payment_success', { userId, basis });
    user.basis = basis;
    for (const tab of this.tabs.values()) {
      if (tab.userId !== userId) continue;
      tab.modal = null;
      tab.focus = 'answer';
      // Approval refreshes eligibility only. It must not reveal material.
    }
  }

  invalidateAccess(userId, basis) {
    const user = this.users.get(userId);
    assert.ok(user, `user ${userId} must exist`);
    this.record(null, 'cross_tab_access_invalidation', { userId, basis });
    user.basis = basis;
  }

  changeAccount(tabId, userId) {
    const tab = this.tab(tabId);
    this.record(tabId, 'account_change', { userId });
    tab.userId = userId;
    tab.modal = null;
    tab.content = null;
    tab.lastResponse = null;
    tab.focus = 'answer';
  }

  changeAttempt(tabId, attemptId) {
    const tab = this.tab(tabId);
    assert.ok(this.attempts.has(attemptId), `attempt ${attemptId} must exist`);
    this.record(tabId, 'attempt_change', { attemptId });
    tab.attemptId = attemptId;
    tab.modal = null;
    tab.content = null;
    tab.lastResponse = null;
    tab.focus = 'answer';
  }

  reload(tabId) {
    const tab = this.tab(tabId);
    const attempt = this.attemptFor(tab);
    this.record(tabId, 'reload');
    tab.modal = null;
    tab.content = attempt.userId === tab.userId && attempt.released ? MATERIAL : null;
    tab.focus = 'answer';
    // A valid historical release recovers without another release side effect.
  }

  assertGlobalInvariants() {
    assert.deepEqual(this.tokenLedger, this.initialTokenLedger, 'reveal flow must not mutate the token ledger');
    for (const tab of this.tabs.values()) {
      assert.equal(tab.route, '#subject-matter', `${tab.tabId} must retain the editor route`);
      assert.ok(tab.timerCount <= 1, `${tab.tabId} must have at most one timer`);
      if (tab.modal) {
        assert.equal(tab.content, null, `${tab.tabId} must not display content behind a paywall`);
      }
    }
    for (const attempt of this.attempts.values()) {
      assert.ok(attempt.releaseCount <= 1, `${attempt.attemptId} must release at most once`);
      assert.ok(attempt.auditCount <= 1, `${attempt.attemptId} must audit at most once`);
      assert.ok(attempt.providerCount <= 1, `${attempt.attemptId} must call the provider at most once`);
      assert.ok(attempt.savedDraft.length <= attempt.draft.length, `${attempt.attemptId} draft must be monotonic`);
    }
  }
}

function workerRequest(body, counter) {
  return new Request('https://worker.example/examinations/command', {
    method: 'POST',
    headers: {
      Origin: 'https://duediligence.ph',
      'Content-Type': 'application/json',
      Authorization: 'Bearer synthetic-user-access-token',
      'CF-Connecting-IP': `198.51.100.${counter}`,
    },
    body: JSON.stringify(body),
  });
}

async function withFetchMock(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

function subjectReviewRecord({ firstReveal }) {
  return {
    status: 'available',
    attemptId: '33333333-3333-4333-8333-333333333333',
    questionId: '22222222-2222-4222-8222-222222222222',
    prompt: 'Did the defendant violate the duty to act with justice and good faith under the stated facts?',
    suggestedAnswer: 'Answer: Yes.\n\nLegal Basis: Article 19 of the Civil Code requires every person to act with justice and good faith.\n\nApplication: The stated conduct violated that duty.\n\nConclusion: The defendant is liable.',
    legalBasis: 'Article 19 of the Civil Code requires every person to act with justice, give everyone his due, and observe honesty and good faith.',
    governingProvision: 'Article 19 of the Civil Code.',
    doctrine: 'The facts directly raise the duty to act with justice and good faith.',
    jurisprudence: [],
    citation: '',
    sources: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345'],
    assisted: true,
    assistanceKnown: true,
    reviewMaterialRevealedAt: '2026-08-26T00:00:00.000Z',
    firstReveal,
    releaseAuthorized: true,
    releasePolicyVersion: 'subject-review-unlimited-v1-2026-08-26',
    access: {
      allowed: true,
      basis: 'early_access',
      unlimited: true,
      tokensRemaining: 5,
    },
  };
}

function validTeachingExplanation() {
  return {
    directAnswer: 'Yes. The stated conduct violates the governing duty.',
    controllingLawAndElements: 'Article 19 requires justice, honesty, and good faith.',
    applicationToFacts: 'The stated conduct directly violates that standard.',
    materialExceptionsOrLimits: 'No material exception appears in the approved review material.',
    finalConclusion: 'The defendant is liable under the stated governing rule.',
  };
}

const workerEnv = {
  ALLOWED_ORIGIN: 'https://duediligence.ph',
  SUPABASE_URL: 'https://staging-test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
  GEMINI_API_KEY: 'test-only-gemini-key',
  GEMINI_MODEL: 'gemini-test',
  GEMINI_GROUNDING_ENABLED: 'false',
};

test('only the five approved paid or trusted-unlimited bases may make a first release', () => {
  const allowed = [...APPROVED_REVEAL_BASES];
  const denied = [
    'provisional_payment',
    'introductory_tokens',
    'trial',
    'daily_free',
    'free_beta',
    'lifetime_free',
    'global_beta_all_access',
    'standard_access',
    'current_owner',
    'legacy_paid',
    '',
  ];

  for (const basis of allowed) {
    const model = new SyllabusReviewPolicyModel();
    model.addUser('user', basis);
    model.addAttempt('attempt', 'user', 'question');
    model.addTab('tab', 'user', 'attempt');
    const response = model.reveal('tab');
    assert.equal(response.status, 200, `${basis} must be authorized`);
    const attempt = model.attempts.get('attempt');
    assert.deepEqual(
      [attempt.releaseCount, attempt.auditCount, attempt.providerCount],
      [1, 1, 1],
      `${basis} must create exactly one first-release side effect set`,
    );
    assert.equal(model.users.get('user').tokensRemaining, 5);
    model.assertGlobalInvariants();
  }

  for (const basis of denied) {
    const model = new SyllabusReviewPolicyModel();
    model.addUser('user', basis);
    model.addAttempt('attempt', 'user', 'question');
    model.addTab('tab', 'user', 'attempt');
    const before = structuredClone(model.attempts.get('attempt'));
    const response = model.reveal('tab');
    assert.equal(response.status, 403, `${basis || '(empty)'} must be denied`);
    assert.equal(response.error.code, 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED');
    assertNoProtectedMaterial(response, `${basis || '(empty)'} denial`);
    assert.deepEqual(model.attempts.get('attempt'), before, `${basis || '(empty)'} denial must not mutate attempt state`);
    assert.equal(model.users.get('user').tokensRemaining, 5);
    model.assertGlobalInvariants();
  }
});

test('140 mixed interactions cannot reopen the gate, lose route or draft, duplicate timers, consume tokens, or reveal automatically', () => {
  const model = new SyllabusReviewPolicyModel();
  model.addUser('ordinary', 'introductory_tokens');
  model.addUser('peer', 'paid_subscription');
  model.addAttempt('attempt-a', 'ordinary', 'question-a');
  model.addAttempt('attempt-b', 'ordinary', 'question-b');
  model.addAttempt('peer-attempt', 'peer', 'question-c');
  model.addTab('tab-a', 'ordinary', 'attempt-a');
  model.addTab('tab-b', 'ordinary', 'attempt-a');

  model.installTimer('tab-a');
  model.installTimer('tab-a');
  model.installTimer('tab-b');
  const exitPaths = ['close_x', 'close_back_button', 'close_backdrop', 'close_escape', 'browser_back'];

  for (let index = 0; index < 12; index += 1) {
    const fragment = `paragraph-${index};`;
    model.type('tab-a', fragment);
    model.autosave('tab-a');
    model.heartbeat('tab-a');
    model.background('tab-a', 'pageshow');
    model.background('tab-a', 'visibility');
    const beforeDenied = structuredClone(model.attempts.get('attempt-a'));
    const denial = model.reveal('tab-a');
    assert.equal(denial.status, 403);
    assertNoProtectedMaterial(denial);
    assert.deepEqual(model.attempts.get('attempt-a'), beforeDenied, 'denial must not set assisted or release state');
    model.dismiss('tab-a', exitPaths[index % exitPaths.length]);
    assert.equal(model.tab('tab-a').modal, null, 'dismissal must remain closed without a new click');
    model.background('tab-a', index % 2 ? 'focus' : 'access_refresh');
    assert.equal(model.tab('tab-a').modal, null, 'background refresh must not reopen a dismissed gate');
    assert.equal(model.tab('tab-a').content, null, 'background refresh must not reveal');
    model.assertGlobalInvariants();
  }

  const expectedDraft = Array.from({ length: 12 }, (_, index) => `paragraph-${index};`).join('');
  assert.equal(model.attempts.get('attempt-a').draft, expectedDraft);
  assert.equal(model.attempts.get('attempt-a').savedDraft, expectedDraft);

  model.reveal('tab-a');
  model.paymentCancel('tab-a');
  assert.equal(model.tab('tab-a').route, '#subject-matter');
  assert.equal(model.attempts.get('attempt-a').draft, expectedDraft);

  model.reveal('tab-a');
  const actionCountBeforePayment = model.actions.length;
  model.paymentSuccess('ordinary');
  assert.equal(model.actions.length, actionCountBeforePayment + 1);
  assert.equal(model.tab('tab-a').content, null, 'payment approval must not auto-reveal in the initiating tab');
  assert.equal(model.tab('tab-b').content, null, 'payment approval must not auto-reveal in another tab');
  assert.equal(model.attempts.get('attempt-a').released, false, 'payment approval must not create a release');

  model.background('tab-a', 'visibility');
  model.background('tab-b', 'pageshow');
  assert.equal(model.attempts.get('attempt-a').released, false, 'lifecycle refresh must not reveal after payment');

  model.submit('tab-a');
  assert.equal(model.attempts.get('attempt-a').submitted, true);
  assert.equal(model.attempts.get('attempt-a').assisted, false);

  // Thirty-two rapid clicks across two tabs model first-writer-wins at the
  // database transition. Replays may recover content but cannot repeat side effects.
  for (let index = 0; index < 32; index += 1) {
    model.reveal(index % 2 ? 'tab-a' : 'tab-b');
  }
  const released = model.attempts.get('attempt-a');
  assert.equal(released.released, true);
  assert.equal(released.assisted, false, 'post-submission release must remain unassisted');
  assert.deepEqual([released.releaseCount, released.auditCount, released.providerCount], [1, 1, 1]);

  model.reload('tab-a');
  assert.equal(model.tab('tab-a').content, MATERIAL, 'valid owner-bound release must recover after reload');
  assert.deepEqual([released.releaseCount, released.auditCount, released.providerCount], [1, 1, 1]);

  model.invalidateAccess('ordinary', 'introductory_tokens');
  model.reload('tab-b');
  assert.equal(model.tab('tab-b').content, MATERIAL, 'valid release must recover after entitlement later changes');
  assert.deepEqual([released.releaseCount, released.auditCount, released.providerCount], [1, 1, 1]);

  model.changeAccount('tab-a', 'peer');
  assert.equal(model.tab('tab-a').content, null, 'account change must clear user-scoped review material');
  const peerDenial = model.reveal('tab-a');
  assert.equal(peerDenial.status, 404, 'a different user must not recover another owner\'s release');
  assertNoProtectedMaterial(peerDenial, 'cross-account attempt response');

  model.changeAttempt('tab-a', 'peer-attempt');
  model.type('tab-a', 'peer draft');
  model.autosave('tab-a');
  const peerRelease = model.reveal('tab-a');
  assert.equal(peerRelease.status, 200);
  assert.deepEqual(
    [
      model.attempts.get('peer-attempt').releaseCount,
      model.attempts.get('peer-attempt').auditCount,
      model.attempts.get('peer-attempt').providerCount,
    ],
    [1, 1, 1],
  );

  model.changeAccount('tab-a', 'ordinary');
  model.changeAttempt('tab-a', 'attempt-b');
  model.type('tab-a', 'second attempt draft');
  model.autosave('tab-a');
  model.reveal('tab-a');
  assert.equal(model.tab('tab-a').modal?.pricePhp, 149);
  model.dismiss('tab-a', 'close_escape');
  model.reload('tab-a');
  assert.equal(model.attempts.get('attempt-b').draft, 'second attempt draft');
  assert.equal(model.attempts.get('attempt-b').savedDraft, 'second attempt draft');
  assert.equal(model.tab('tab-a').content, null);
  assert.equal(model.tab('tab-a').modal, null);

  assert.ok(model.actions.length >= 140, `expected at least 140 interactions, received ${model.actions.length}`);
  assert.equal(model.tokenLedger.length, 0, 'no reveal interaction may create a token ledger event');
  assert.equal(model.users.get('ordinary').tokensRemaining, 5);
  assert.equal(model.users.get('peer').tokensRemaining, 5);
  model.assertGlobalInvariants();
});

test('Worker returns the canonical 403 denial without protected content or a provider request', async () => {
  let providerCalls = 0;
  await withFetchMock(async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'synthetic@example.com',
      });
    }
    if (target.endsWith('/rest/v1/rpc/subject_matter_reveal_review')) {
      return Response.json({
        code: 'P0001',
        message: 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED: internal entitlement diagnostics',
        details: `private ${MATERIAL.suggestedAnswer}`,
      }, { status: 400 });
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      providerCalls += 1;
      return Response.json({ candidates: [] });
    }
    throw new Error(`Unexpected request: ${target}`);
  }, async () => {
    const response = await worker.fetch(workerRequest({
      operation: 'subject_reveal_review',
      attemptId: '33333333-3333-4333-8333-333333333333',
    }, 1), workerEnv);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED');
    assert.equal(
      body.error.message,
      'Suggested answers and full legal review require ₱149 Early Access or a paid subscription.',
    );
    assert.doesNotMatch(body.error.message, /internal|diagnostic|Article 19/i);
    assert.doesNotMatch(body.error.message, /admin|founder|founding|beta|trusted|unlimited/i);
    assertNoProtectedMaterial(body, 'Worker denial');
    assert.equal(providerCalls, 0);
  });
});

test('Worker concurrent first-release and replay responses call Gemini at most once and hide internal release metadata', async () => {
  let rpcCalls = 0;
  let providerCalls = 0;
  await withFetchMock(async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'synthetic@example.com',
      });
    }
    if (target.endsWith('/rest/v1/rpc/subject_matter_reveal_review')) {
      rpcCalls += 1;
      return Response.json(subjectReviewRecord({ firstReveal: rpcCalls === 1 }));
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      providerCalls += 1;
      return Response.json({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(validTeachingExplanation()) }] },
        }],
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  }, async () => {
    const responses = await Promise.all([
      worker.fetch(workerRequest({
        operation: 'subject_reveal_review',
        attemptId: '33333333-3333-4333-8333-333333333333',
      }, 2), workerEnv),
      worker.fetch(workerRequest({
        operation: 'subject_reveal_review',
        attemptId: '33333333-3333-4333-8333-333333333333',
      }, 3), workerEnv),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(rpcCalls, 2, 'each request may revalidate through the owner-bound RPC');
    assert.equal(providerCalls, 1, 'only the atomic first-release response may invoke Gemini');
    for (const body of bodies) {
      assert.equal(body.ok, true);
      assert.equal(body.data.attemptId, '33333333-3333-4333-8333-333333333333');
      assert.equal('firstReveal' in body.data, false, 'internal idempotency metadata must not be public');
      assert.equal('releaseAuthorized' in body.data, false, 'internal authorization proof must not be public');
      assert.equal('releasePolicyVersion' in body.data, false, 'internal policy proof must not be public');
      assert.equal(body.data.access?.tokensRemaining, 5, 'fresh access must show an unchanged token balance');
    }
    assert.equal(
      bodies.filter((body) => body.data.explanationSource === 'gemini_curated').length,
      1,
      'only one concurrent response may report a provider-generated explanation',
    );
    assert.equal(
      bodies.filter((body) => body.data.explanationSource === 'curated_fallback').length,
      1,
      'the replay must return the deterministic curated fallback without a provider call',
    );
  });
});
