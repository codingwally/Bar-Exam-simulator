import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { provisionMandatoryCommercialChoice } from './staging-commercial-user.mjs';

const SUPABASE_URL = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '');
const PUBLISHABLE_KEY = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const WORKER_URL = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/, '');

assert.equal(SUPABASE_URL, 'https://hlzqmreeoghbldnhlybr.supabase.co');
assert.equal(
  WORKER_URL,
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
);
assert.ok(
  /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(SERVICE_ROLE_KEY),
  'A dedicated staging secret key is required.',
);
assert.match(PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);

const runId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const createdUsers = [];
const createdSubmissionIds = [];
const createdQuestionIds = [];
const syntheticContentIds = [];
const originalFlags = new Map();

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

function requestKey(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

async function responseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json().catch(() => null);
  return response.text().catch(() => '');
}

async function request(url, options = {}, expected = [200]) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(180_000),
  });
  if (!expected.includes(response.status)) {
    const body = await responseBody(response);
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.error?.code || body?.error?.message || body?.message || String(body).slice(0, 240)}`,
    );
  }
  return response;
}

async function serviceGet(path) {
  const response = await request(`${SUPABASE_URL}${path}`, { headers: serviceHeaders });
  return response.json();
}

async function acceptCurrentTerms(user) {
  const settings = await serviceGet(
    '/rest/v1/platform_access_settings?singleton=eq.true&select=current_terms_version,current_privacy_version',
  );
  assert.equal(settings.length, 1);
  await request(`${SUPABASE_URL}/rest/v1/rpc/accept_terms`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_terms_version: settings[0].current_terms_version,
      p_privacy_version: settings[0].current_privacy_version,
      p_acceptance_source: 'protected_staging_e2e',
    }),
  }, [200, 204]);
  return settings[0];
}

async function serviceWrite(path, method, body, { expected = [200, 201, 204], representation = false } = {}) {
  const response = await request(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      ...serviceHeaders,
      Prefer: representation ? 'return=representation' : 'return=minimal',
    },
    body: body == null ? undefined : JSON.stringify(body),
  }, expected);
  if (response.status === 204 || !representation) return null;
  return response.json();
}

async function serviceRpc(name, payload) {
  const response = await request(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(payload),
  }, [200, 204]);
  return response.status === 204 ? null : response.json();
}

async function createUser(label) {
  const email = `dd26-live-${label}-${runId}@duediligence.ph`;
  const password = `Dd!${randomBytes(24).toString('base64url')}9z`;
  const adminResponse = await request(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `DD26 ${label}` },
    }),
  }, [200, 201]);
  const user = await adminResponse.json();
  createdUsers.push(user.id);

  const sessionResponse = await request(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await sessionResponse.json();
  assert.ok(session.access_token);
  const created = { id: user.id, email, token: session.access_token };
  const legalVersions = await acceptCurrentTerms(created);
  await provisionMandatoryCommercialChoice({
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    workerUrl: WORKER_URL,
    token: created.token,
    displayName: `DD26 ${label}`,
    termsVersion: legalVersions.current_terms_version,
    privacyVersion: legalVersions.current_privacy_version,
  });
  return created;
}

async function workerJson(path, payload, token, expected = [200]) {
  const response = await request(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      Origin: WORKER_URL,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  }, expected);
  return { response, body: await response.json() };
}

async function workerPdf(payload, token, expected = [200]) {
  const response = await request(`${WORKER_URL}/dd2026/verdict/pdf`, {
    method: 'POST',
    headers: {
      Origin: WORKER_URL,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }, expected);
  if (response.status !== 200) return { response, body: await response.json() };
  return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}

async function grantBetaAccess(actorUserId, targetUserId) {
  const result = await serviceRpc('examination_admin', {
    p_actor_user_id: actorUserId,
    p_operation: 'set_beta_access',
    p_payload: {
      operation: 'set_beta_access',
      userId: targetUserId,
      enabled: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: `DueDiligence 2026 staging route verification ${runId}`,
      requestKey: requestKey('dd26_beta'),
    },
  });
  assert.equal(result.enabled, true);
}

async function rememberAndSetFlag(flagKey, enabled) {
  if (!originalFlags.has(flagKey)) {
    const rows = await serviceGet(`/rest/v1/dd2026_feature_flags?flag_key=eq.${flagKey}&select=enabled`);
    assert.equal(rows.length, 1);
    originalFlags.set(flagKey, rows[0].enabled);
  }
  await serviceWrite(`/rest/v1/dd2026_feature_flags?flag_key=eq.${flagKey}`, 'PATCH', {
    enabled,
    updated_at: new Date().toISOString(),
  });
}

async function createVerdictFixture(userId) {
  let questions = await serviceGet(
    '/rest/v1/questions?select=id,subject_id,bar_year,question_no,prompt_text,model_answer'
      + '&model_answer=not.is.null&limit=1',
  );
  if (questions.length === 0) {
    const subjects = await serviceGet('/rest/v1/subjects?select=id,name&order=sort_order.asc&limit=1');
    assert.equal(subjects.length, 1, 'Staging needs one existing subject for Verdict verification.');
    questions = await serviceWrite('/rest/v1/questions', 'POST', {
      subject_id: subjects[0].id,
      bar_year: 2026,
      question_no: 999,
      prompt_text: 'Synthetic staging-only Verdict export question.',
      model_answer: 'ANSWER: Yes. LEGAL BASIS: The controlling rule applies. APPLICATION: The facts satisfy the rule. CONCLUSION: Therefore, relief follows.',
      case_law: 'Synthetic staging fixture only.',
      rubric_points: { synthetic: true },
      source: `dd26-staging-${runId}`,
    }, { representation: true });
    assert.equal(questions.length, 1);
    createdQuestionIds.push(questions[0].id);
  }
  const question = questions[0];
  const submissions = await serviceWrite('/rest/v1/submissions', 'POST', {
    user_id: userId,
    question_id: question.id,
    answer_text: 'I. ANSWER: Yes.\n\nII. LEGAL BASIS: The controlling provision applies.\n\nIII. APPLICATION: The facts satisfy the rule.\n\nIV. CONCLUSION: Therefore, relief follows.',
    word_count: 24,
    time_spent_seconds: 180,
  }, { representation: true });
  assert.equal(submissions.length, 1);
  createdSubmissionIds.push(submissions[0].id);

  const grades = await serviceWrite('/rest/v1/grading_results', 'POST', {
    submission_id: submissions[0].id,
    overall_score: 4.2,
    passed: true,
    answer_score: 1,
    legal_basis_score: 1,
    application_score: 1.2,
    conclusion_score: 1,
    feedback_json: {
      rationale: 'Synthetic staging export fixture.',
      coachingTips: ['State the exact authority and connect each material fact.'],
    },
    rubric_version: 'dd26-staging-verdict-v1',
    grader_model: 'synthetic-staging-fixture',
  }, { representation: true });
  assert.equal(grades.length, 1);
  return { question, gradingResultId: grades[0].id };
}

async function deleteSyntheticContent(contentId) {
  await serviceWrite(`/rest/v1/dd2026_content_audit?content_id=eq.${contentId}`, 'DELETE');
  await serviceWrite(`/rest/v1/dd2026_content_items?id=eq.${contentId}`, 'DELETE');
}

async function cleanup() {
  const errors = [];
  for (const [flagKey, enabled] of originalFlags.entries()) {
    await serviceWrite(`/rest/v1/dd2026_feature_flags?flag_key=eq.${flagKey}`, 'PATCH', {
      enabled,
      updated_at: new Date().toISOString(),
    }).catch((error) => errors.push(error));
  }
  for (const contentId of syntheticContentIds.reverse()) {
    await deleteSyntheticContent(contentId).catch((error) => errors.push(error));
  }
  for (const userId of createdUsers) {
    await serviceWrite(`/rest/v1/dd2026_verdict_pdf_exports?user_id=eq.${userId}`, 'DELETE')
      .catch((error) => errors.push(error));
  }
  for (const submissionId of createdSubmissionIds.reverse()) {
    await serviceWrite(`/rest/v1/submissions?id=eq.${submissionId}`, 'DELETE')
      .catch((error) => errors.push(error));
  }
  for (const questionId of createdQuestionIds.reverse()) {
    await serviceWrite(`/rest/v1/questions?id=eq.${questionId}`, 'DELETE')
      .catch((error) => errors.push(error));
  }
  for (const userId of createdUsers.reverse()) {
    await request(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    }, [200, 204]).catch((error) => errors.push(error));
  }
  if (errors.length) throw new AggregateError(errors, 'DueDiligence 2026 staging cleanup failed.');
}

let outcome;
try {
  const administrators = await serviceGet(
    '/rest/v1/user_roles?role=eq.super_admin&select=user_id&order=created_at.asc&limit=1',
  );
  assert.equal(administrators.length, 1, 'Staging needs its existing synthetic super admin.');
  const existingAdminId = administrators[0].user_id;
  const student = await createUser('student');
  const editor = await createUser('editor');
  await grantBetaAccess(existingAdminId, student.id);
  await grantBetaAccess(existingAdminId, editor.id);
  await serviceWrite(`/rest/v1/user_roles?user_id=eq.${editor.id}`, 'PATCH', {
    role: 'super_admin',
    assigned_by: existingAdminId,
    updated_at: new Date().toISOString(),
  });

  console.log('DD2026_STAGING: feature snapshot and exact content catalogs');
  const features = await workerJson('/dd2026/features', {}, student.token);
  assert.equal(features.body.ok, true);
  for (const key of [
    'BAR_EASY_ENABLED', 'DOCTRINES_ENABLED', 'CHAIR_CASES_ENABLED',
    'ANCHOR_CASE_DIGESTS_ENABLED', 'VERDICT_PDF_ENABLED', 'EXAMINATION_ROOM_ENABLED',
  ]) assert.equal(features.body.flags[key], true, `${key} must be enabled on staging.`);

  const expectedCounts = new Map([
    ['bar_easy', 50], ['doctrine', 100], ['chair_case', 30], ['anchor_case', 60],
  ]);
  const catalogs = new Map();
  for (const [contentType, expectedCount] of expectedCounts) {
    const catalog = await workerJson('/dd2026/content/query', {
      contentType, limit: 200, offset: 0,
    }, student.token);
    assert.equal(catalog.body.total, expectedCount);
    assert.equal(catalog.body.items.length, expectedCount);
    assert.equal(catalog.body.items.every((item) => item.aiPreparedBeta === true), true);
    catalogs.set(contentType, catalog.body.items);
  }
  assert.equal('suggested_answer' in catalogs.get('bar_easy')[0].payload, false);
  assert.equal('canonical_meaning' in catalogs.get('doctrine')[0].payload, false);
  for (const type of ['chair_case', 'anchor_case']) {
    const first = catalogs.get(type)[0];
    const deepLink = await workerJson('/dd2026/content/item', {
      contentType: type,
      contentId: first.id,
    }, student.token);
    assert.equal(deepLink.body.item.id, first.id);
    assert.match(JSON.stringify(deepLink.body.item.payload), /https:\/\//);
  }

  console.log('DD2026_STAGING: live Gemini study grading and non-retention');
  const barId = catalogs.get('bar_easy')[0].id;
  const doctrineId = catalogs.get('doctrine')[0].id;
  const sourceRows = await serviceGet(
    `/rest/v1/dd2026_content_items?id=in.(${barId},${doctrineId})`
      + '&select=id,current_published_version_id',
  );
  const versionIds = sourceRows.map((row) => row.current_published_version_id).join(',');
  const versions = await serviceGet(
    `/rest/v1/dd2026_content_versions?id=in.(${versionIds})&select=content_id,payload`,
  );
  const payloadById = new Map(versions.map((row) => [row.content_id, row.payload]));
  const answerCanary = `DD26_CANARY_${randomBytes(12).toString('hex')}`;
  const barAnswer = `${payloadById.get(barId).suggested_answer}\n\n${answerCanary}`;
  const barGrade = await workerJson('/dd2026/bar-easy/grade', {
    contentId: barId,
    answer: barAnswer,
    requestKey: requestKey('bar_easy'),
  }, student.token);
  assert.ok(['Affirmed!', 'Affirmed with modification', 'Denied'].includes(barGrade.body.result.label));
  assert.equal(JSON.stringify(barGrade.body).includes(answerCanary), false);
  assert.match(barGrade.body.notice, /Verify the coaching explanation against current law/i);

  const doctrineAnswer = `${payloadById.get(doctrineId).canonical_meaning}\n\n${answerCanary}`;
  const doctrineGrade = await workerJson('/dd2026/doctrines/grade', {
    contentId: doctrineId,
    answer: doctrineAnswer,
    requestKey: requestKey('doctrine'),
  }, student.token);
  assert.ok(['thumbs_up', 'thumbs_down'].includes(doctrineGrade.body.result.result));
  assert.equal(JSON.stringify(doctrineGrade.body).includes(answerCanary), false);
  assert.match(doctrineGrade.body.privacy, /answer text is not saved/i);

  const oversize = await workerJson('/dd2026/bar-easy/grade', {
    contentId: barId,
    answer: 'A'.repeat(5_001),
    requestKey: requestKey('oversize'),
  }, student.token, [400]);
  assert.equal(oversize.body.error.code, 'FIELD_TOO_LONG');
  const usageRows = await serviceGet(
    `/rest/v1/dd2026_bar_easy_usage?user_id=eq.${student.id}&select=*`,
  );
  const masteryRows = await serviceGet(
    `/rest/v1/dd2026_doctrine_mastery?user_id=eq.${student.id}&select=*`,
  );
  assert.equal(usageRows.length, 1);
  assert.equal(masteryRows.length, 1);
  assert.equal(JSON.stringify({ usageRows, masteryRows }).includes(answerCanary), false);

  console.log('DD2026_STAGING: future human-review publication gate');
  await rememberAndSetFlag('CONTENT_HUMAN_REVIEW_REQUIRED', true);
  const syntheticContentId = `dd26-live-anchor-${runId}`.toLowerCase();
  syntheticContentIds.push(syntheticContentId);
  const syntheticPayload = {
    case_title: 'Synthetic staging authority',
    digest: 'A staging-only record used to prove the human editorial gate.',
    source_url: 'https://elibrary.judiciary.gov.ph/',
  };
  const checksum = createHash('sha256').update(JSON.stringify(syntheticPayload)).digest('hex');
  const imported = await workerJson('/admin/dd2026/import', { rows: [{
    id: syntheticContentId,
    content_type: 'anchor_case',
    subject: 'Labor Law',
    title: 'Synthetic staging human-review gate',
    source_version: '2026.1',
    source_status: 'AI_PREPARED_BETA',
    checksum,
    payload: syntheticPayload,
  }] }, editor.token);
  assert.equal(imported.body.result.reviewRequired, true);
  const hiddenDraft = await workerJson('/dd2026/content/query', {
    contentType: 'anchor_case', search: syntheticContentId, limit: 20, offset: 0,
  }, student.token);
  assert.equal(hiddenDraft.body.total, 0);
  const draftRows = await serviceGet(
    `/rest/v1/dd2026_content_versions?content_id=eq.${syntheticContentId}&select=id,lifecycle_state`,
  );
  assert.equal(draftRows.length, 1);
  assert.equal(draftRows[0].lifecycle_state, 'draft');
  for (const action of ['submit_review', 'approve', 'publish']) {
    const transition = await workerJson('/dd2026/editorial', {
      contentId: syntheticContentId,
      versionId: draftRows[0].id,
      action,
      note: `Synthetic staging ${action} verification.`,
    }, editor.token);
    assert.equal(transition.body.result.contentId, syntheticContentId);
  }
  const published = await workerJson('/dd2026/content/item', {
    contentType: 'anchor_case', contentId: syntheticContentId,
  }, student.token);
  assert.equal(published.body.item.id, syntheticContentId);

  console.log('DD2026_STAGING: Verdict PDF ownership and selection');
  await rememberAndSetFlag('VERDICT_PDF_PREMIUM_REQUIRED', false);
  const verdict = await createVerdictFixture(student.id);
  const fullPdf = await workerPdf({
    gradingResultId: verdict.gradingResultId,
    selectionKind: 'entire_result',
    selectedIds: [],
    requestKey: requestKey('verdict_full'),
  }, student.token);
  assert.equal(Buffer.from(fullPdf.bytes.subarray(0, 5)).toString('ascii'), '%PDF-');
  assert.match(fullPdf.response.headers.get('cache-control') || '', /private/);
  assert.match(fullPdf.response.headers.get('cache-control') || '', /no-store/);
  const selectedPdf = await workerPdf({
    gradingResultId: verdict.gradingResultId,
    selectionKind: 'questions',
    selectedIds: [verdict.question.id],
    requestKey: requestKey('verdict_selected'),
  }, student.token);
  assert.equal(Buffer.from(selectedPdf.bytes.subarray(0, 5)).toString('ascii'), '%PDF-');

  const repeatedPdf = await workerPdf({
    gradingResultId: verdict.gradingResultId,
    selectionKind: 'entire_result',
    selectedIds: [],
    requestKey: requestKey('verdict_repeat'),
  }, student.token);
  assert.equal(Buffer.from(repeatedPdf.bytes.subarray(0, 5)).toString('ascii'), '%PDF-');

  console.log('DD2026_STAGING: Examination Room Worker authorization boundary');
  const portal = await workerJson('/exam-room/query', { operation: 'portal' }, student.token);
  assert.equal(portal.body.result.roles.professor, false);
  const professorDenied = await workerJson('/exam-room/command', {
    operation: 'create_classroom',
    title: 'Unauthorized staging classroom',
    schoolName: 'Due Diligence School of Law',
    academicTerm: '2026',
  }, student.token, [403]);
  assert.equal(professorDenied.body.error.code, 'EXAM_ROOM_ROOM_KEY_REQUIRED');

  outcome = {
    ok: true,
    runId,
    contentCounts: Object.fromEntries(expectedCounts),
    barEasyLabel: barGrade.body.result.label,
    doctrineResult: doctrineGrade.body.result.result,
    verdict: {
      fullBytes: fullPdf.bytes.length,
      selectedBytes: selectedPdf.bytes.length,
      premiumGateVerified: true,
    },
    humanReviewGateVerified: true,
    examRoomAuthorizationVerified: true,
    answerCanaryPersisted: false,
  };
} finally {
  await cleanup();
  console.log(`DD2026_STAGING: synthetic_cleanup=true run_id=${runId}`);
}

console.log(JSON.stringify(outcome, null, 2));
console.log('DD2026_STAGING_PASS synthetic_cleanup=true secrets_not_logged=true');
