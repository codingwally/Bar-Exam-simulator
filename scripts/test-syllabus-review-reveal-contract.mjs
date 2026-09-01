import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

const [
  baseMigration,
  sourceFilterMigration,
  poolGuardMigration,
  worker,
  examinationCore,
  subjectReview,
  examinations,
  phase2,
  phase4,
  featureLoader,
  studyWorkspace,
  index,
  serviceWorker,
  runbook,
] = await Promise.all([
  read('supabase/migrations/20260826110207_subject_matter_unlimited_review_release.sql'),
  read('supabase/migrations/20260828131000_subject_matter_official_source_filter.sql'),
  read('supabase/migrations/20260828131500_subject_matter_revealable_pool_guard.sql'),
  read('worker/index.mjs'),
  read('worker/examinations-core.mjs'),
  read('worker/subject-matter-review.mjs'),
  read('assets/examinations.js'),
  read('assets/phase2-experience.js'),
  read('assets/phase4-experience.js'),
  read('assets/feature-loader.js'),
  read('assets/study-workspace.js'),
  read('index.html'),
  read('service-worker.js'),
  read('docs/operations/syllabus-review-reveal-access.md'),
]);

const migration = `${baseMigration}\n${sourceFilterMigration}\n${poolGuardMigration}`;

const APPROVED_BASES = [
  'super_admin',
  'founder_admin',
  'founding_beta',
  'early_access',
  'paid_subscription',
];

const DENIED_BASES = [
  'provisional_payment',
  'introductory_tokens',
  'trial',
  'daily_free',
  'free_beta',
  'lifetime_free',
  'global_beta_all_access',
  'legacy_paid',
  'standard_access',
  'current_owner',
  '',
];

function functionSection(source, name) {
  const startMarker = `create or replace function public.${name}`;
  const start = source.toLowerCase().indexOf(startMarker);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('as $$', start);
  assert.notEqual(bodyStart, -1, `${name} must use a visible SQL body`);
  const end = source.indexOf('$$;', bodyStart + 5);
  assert.notEqual(end, -1, `${name} body must terminate`);
  return source.slice(start, end + 3);
}

function javascriptFunctionSection(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const parametersStart = source.indexOf('(', start);
  assert.notEqual(parametersStart, -1, `${name} must declare parameters`);
  let parametersEnd = -1;
  let parameterDepth = 0;
  let parameterQuote = '';
  let parameterEscaped = false;
  for (let cursor = parametersStart; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (parameterQuote) {
      if (parameterEscaped) parameterEscaped = false;
      else if (character === '\\') parameterEscaped = true;
      else if (character === parameterQuote) parameterQuote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      parameterQuote = character;
      continue;
    }
    if (character === '(') parameterDepth += 1;
    if (character === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersEnd = cursor;
        break;
      }
    }
  }
  assert.notEqual(parametersEnd, -1, `${name} parameters must terminate`);
  const brace = source.indexOf('{', parametersEnd);
  assert.notEqual(brace, -1, `${name} must have a body`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let cursor = brace; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  assert.fail(`${name} body must terminate`);
}

function normalizedSet(values) {
  return [...new Set(values)].sort();
}

for (const [name, sql] of [
  ['base release', baseMigration],
  ['official-source filter', sourceFilterMigration],
  ['revealable-pool guard', poolGuardMigration],
]) {
  assert.equal((sql.match(/^begin;$/gmi) || []).length, 1, `${name} must use one explicit transaction`);
  assert.equal((sql.match(/^commit;$/gmi) || []).length, 1, `${name} must commit once`);
}
assert.doesNotMatch(migration, /^\s*(?:drop\s+table|truncate|delete\s+from)\b/gmi);

const revealSql = functionSection(sourceFilterMigration, 'subject_matter_reveal_review');
const literalLists = [...revealSql.matchAll(/(?:not\s+)?in\s*\(([^)]+)\)/gi)]
  .map((match) => [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
const accessAllowlist = literalLists.find((values) => APPROVED_BASES.every((basis) => values.includes(basis)));
assert.ok(accessAllowlist, 'the reveal RPC must contain one auditable literal entitlement allowlist');
assert.deepEqual(
  normalizedSet(accessAllowlist),
  normalizedSet(APPROVED_BASES),
  'the database allowlist must contain exactly the five approved bases',
);
assert.match(revealSql, /for\s+update/i, 'the attempt must be locked before the first-release transition');
assert.match(revealSql, /SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED/);
assert.match(revealSql, /'firstReveal'\s*,/);
assert.match(revealSql, /'access'\s*,/);
assert.match(revealSql, /'subject_review_released'/);
assert.match(revealSql, /'examination_attempt'/);
assert.match(revealSql, /'accessBasis'/);
assert.match(revealSql, /'entitlementEndsAt'/);
assert.match(revealSql, /'assisted'/);
const auditInsertStart = revealSql.indexOf('insert into public.examination_audit_log');
assert.notEqual(auditInsertStart, -1, 'the first release must write an examination audit');
const auditInsert = revealSql.slice(auditInsertStart);
const auditMetadata = auditInsert.match(
  /jsonb_build_object\(([\s\S]*?)\)\s*,\s*v_release_at/,
)?.[1];
assert.ok(auditMetadata, 'release audit metadata must be explicit and reviewable');
assert.deepEqual(
  normalizedSet([...auditMetadata.matchAll(/'([^']+)'\s*,/g)].map((match) => match[1])),
  normalizedSet(['accessBasis', 'entitlementEndsAt', 'assisted']),
  'release audit metadata must contain exactly the three approved keys',
);
assert.doesNotMatch(
  revealSql,
  /introductory_token_(?:ledger|grants)|grade_reservations|phase4_reserve|consumes_quota/i,
  'revealing review material must not enter any introductory-token reservation or ledger path',
);
assert.match(
  revealSql,
  /begin[\s\S]*phase4_access_snapshot[\s\S]*errcode\s*=\s*'ZX001'[\s\S]*exception[\s\S]*when\s+sqlstate\s+'ZX001'/i,
  'the canonical snapshot must run in a dedicated rollback-only subtransaction',
);
assert.doesNotMatch(
  revealSql,
  /exception[\s\S]*when\s+others/i,
  'a genuine access-snapshot failure must propagate instead of being mistaken for the rollback sentinel',
);
assert.match(
  revealSql,
  /v_access\s+is\s+null\s+or\s+pg_catalog\.jsonb_typeof\(v_access\)\s*<>\s*'object'/i,
  'the retained read-only access snapshot must be validated after rollback',
);
assert.equal(
  sourceFilterMigration.includes('lawphil\\\\.net'),
  false,
  'standard-conforming SQL strings must contain one regex escape before a host dot',
);
assert.equal(
  sourceFilterMigration.includes('lawphil\\.net'),
  true,
  'the SQL source-host predicate must escape host dots exactly once',
);
assert.match(
  revealSql,
  /v_sources\s*:=\s*public\.subject_matter_official_review_sources\(v_raw_sources\)/i,
  'the current reveal RPC must filter supplemental study links before returning sources',
);
assert.match(
  revealSql,
  /jsonb_array_length\(v_sources\)\s*<\s*1/i,
  'at least one approved official source must remain after filtering',
);
const sourceFilterSql = functionSection(
  sourceFilterMigration,
  'subject_matter_official_review_sources',
);
assert.match(sourceFilterSql, /jsonb_agg\(normalized\.url\s+order\s+by\s+source\.ordinality\)/i);
assert.match(sourceFilterSql, /where\s+normalized\.url\s+is\s+not\s+null/i);
assert.match(
  sourceFilterMigration,
  /revoke\s+all\s+on\s+function\s+public\.subject_matter_official_review_sources\(jsonb\)[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  'the source-filter helper must remain internal to trusted database functions',
);
assert.match(
  poolGuardMigration,
  /create\s+trigger\s+subject_matter_guard_official_placement_source_trigger[\s\S]*before\s+insert\s+or\s+update\s+of\s+exam_id\s*,\s*question_id[\s\S]*on\s+public\.subject_matter_placements/i,
  'future placement imports must retain at least one approved official source',
);
assert.match(poolGuardMigration, /SUBJECT_MATTER_OFFICIAL_SOURCE_REQUIRED/);
assert.match(poolGuardMigration, /SUBJECT_MATTER_ACTIVE_POOL_NOT_REVEALABLE/);
assert.match(
  poolGuardMigration,
  /question\.content_hash\s*=\s*version_question\.snapshot_hash[\s\S]*subject_matter_official_review_sources/i,
  'the migration must prove the complete active selector pool can be revealed',
);
const officialReviewSourcePattern = new RegExp(
  '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*'
    + '(?:lawphil\\.net|judiciary\\.gov\\.ph|officialgazette\\.gov\\.ph|'
    + 'leb\\.gov\\.ph|dole\\.gov\\.ph|bir\\.gov\\.ph|senate\\.gov\\.ph|'
    + 'legal\\.un\\.org)'
    + '(?::(?:[0-9]{1,4}|[0-5][0-9]{4}|6[0-4][0-9]{3}|'
    + '65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(?:[/?#]|$)',
  'i',
);
for (const source of [
  'https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html',
  'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345',
  'https://officialgazette.gov.ph/',
  'https://leb.gov.ph/memoranda',
  'https://dole.gov.ph/news',
  'https://bir.gov.ph/index.php',
  'https://senate.gov.ph/lis/bill_res.aspx',
  'https://legal.un.org/avl/ha/vclt/vclt.html',
  'https://lawphil.net:443/?q=article#text',
]) {
  assert.equal(officialReviewSourcePattern.test(source), true, source + ' must pass the SQL host contract');
}
for (const source of [
  'http://lawphil.net/statutes',
  'https://lawphil.net.evil.example/statutes',
  'https://evil-lawphil.net/statutes',
  'https://user@lawphil.net/statutes',
  'https://lawphil.net:65536/statutes',
]) {
  assert.equal(officialReviewSourcePattern.test(source), false, source + ' must fail the SQL host contract');
}
assert.match(migration, /subject_review_released[\s\S]*unique|unique[\s\S]*subject_review_released/i,
  'the database must enforce one release audit per attempt');
assert.match(
  migration,
  /revoke\s+all\s+on\s+function\s+public\.subject_matter_reveal_review\(uuid\s*,\s*uuid\)[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i,
);
assert.match(
  migration,
  /grant\s+execute\s+on\s+function\s+public\.subject_matter_reveal_review\(uuid\s*,\s*uuid\)[\s\S]*to\s+service_role/i,
);

assert.match(examinationCore, /SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED/);
assert.match(
  examinationCore,
  /SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED:\s*'[^']+'/,
  'the database code must map to a fixed public message',
);
const publicDenialMessage = examinationCore.match(
  /SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED:\s*'([^']+)'/,
)?.[1];
assert.ok(publicDenialMessage, 'the reveal denial must have a fixed public message');
assert.equal(
  publicDenialMessage,
  'Suggested answers and full legal review require an active Regular Subscription.',
);
assert.doesNotMatch(publicDenialMessage, /admin|founder|founding|beta|trusted|unlimited|provisional/i);
assert.match(
  examinationCore,
  /SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED[\s\S]*?includes\(code\)[\s\S]*?403|SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED[\s\S]*?403/,
  'the canonical reveal denial must map to HTTP 403',
);

const revealWorkerStart = worker.indexOf("if (user && command.operation === 'subject_reveal_review')");
const revealWorkerEnd = worker.indexOf("if (user && command.operation === 'subject_skip_question')", revealWorkerStart);
assert.ok(revealWorkerStart >= 0 && revealWorkerEnd > revealWorkerStart, 'Worker reveal branch must be isolated');
const revealWorker = worker.slice(revealWorkerStart, revealWorkerEnd);
assert.match(revealWorker, /firstReveal/);
assert.match(revealWorker, /if\s*\([^)]*firstReveal[^)]*\)[\s\S]*callGeminiStructured/,
  'only the atomic first release may invoke the teaching provider');
assert.doesNotMatch(
  revealWorker,
  /reserveCommercialSubmission|phase4_reserve|introductory_token|grade_reservation/i,
  'the Worker reveal branch must not reserve or consume product tokens',
);
assert.match(revealWorker, /publicSubjectMatterReviewPayload/);
assert.match(revealWorker, /publicSubjectMatterReviewPayload\([\s\S]*access,?\s*\}\)/,
  'the Worker must pass the fresh normalized access snapshot to the public serializer');
assert.match(subjectReview, /access:\s*metadata\.access/,
  'the successful public payload must include the fresh normalized access snapshot');
const publicPayload = javascriptFunctionSection(subjectReview, 'publicSubjectMatterReviewPayload');
assert.doesNotMatch(publicPayload, /firstReveal\s*:/, 'internal first-release state must not be public');
assert.doesNotMatch(publicPayload, /releaseAuthorized\s*:/, 'internal authorization proof must not be public');
assert.doesNotMatch(publicPayload, /releasePolicyVersion\s*:/, 'internal policy proof must not be public');

const listeners = new Map();
const legacy = {
  getSession: () => null,
  openView: () => {},
};
const windowMock = {
  DueDiligencePhase2: legacy,
  DueDiligencePhase2Config: { features: {} },
  addEventListener: (name, handler) => listeners.set(name, handler),
  removeEventListener: () => {},
};
const context = vm.createContext({
  window: windowMock,
  document: {
    body: null,
    documentElement: { classList: { remove: () => {}, toggle: () => {} } },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  location: { hash: '#subject-matter', pathname: '/', search: '' },
  history: { state: null },
  crypto: { getRandomValues: (bytes) => bytes.fill(7) },
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  console,
  Date,
  Map,
  Object,
  Promise,
  Set,
  String,
  Number,
  Boolean,
  Array,
  Uint8Array,
  URL,
  URLSearchParams,
  FormData,
  fetch: async () => assert.fail('policy helper evaluation must not fetch'),
  setTimeout: () => 0,
  clearTimeout: () => {},
});
vm.runInContext(phase4, context, { filename: 'assets/phase4-experience.js' });
const phase4Api = windowMock.DueDiligencePhase4;
assert.equal(typeof phase4Api?.canRevealSubjectReview, 'function');
assert.equal(typeof phase4Api?.isSubjectReviewAccessError, 'function');

legacy.getSession = () => ({ access_token: 'test-session' });
windowMock.DueDiligencePhase2Config.workerUrl = 'https://example.invalid';
let forwardedSignal = null;
context.fetch = async (_url, options) => {
  forwardedSignal = options.signal;
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: { status: 'available' } }),
  };
};
const requestController = new AbortController();
await phase4Api.request('/examinations/command', {
  body: { operation: 'subject_reveal_review' },
  signal: requestController.signal,
});
assert.equal(forwardedSignal, requestController.signal,
  'the authenticated request helper must preserve the exact caller abort signal');

for (const basis of APPROVED_BASES) {
  assert.equal(
    phase4Api.canRevealSubjectReview({ allowed: true, unlimited: true, basis }),
    true,
    `${basis} must be eligible in the presentation policy`,
  );
}
for (const basis of DENIED_BASES) {
  assert.equal(
    phase4Api.canRevealSubjectReview({ allowed: true, unlimited: true, basis }),
    false,
    `${basis || '(empty)'} must not be eligible in the presentation policy`,
  );
}
assert.equal(
  phase4Api.canRevealSubjectReview({ allowed: true, unlimited: false, basis: 'paid_subscription' }),
  false,
);
assert.equal(
  phase4Api.canRevealSubjectReview({ allowed: true, unlimited: true, basis: 'early_access', termsRequired: true }),
  false,
);
assert.equal(
  phase4Api.isSubjectReviewAccessError({ status: 403, code: 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED' }),
  true,
);
for (const error of [
  { status: 403, code: 'EXAM_ATTEMPT_NOT_FOUND' },
  { status: 403, code: 'EXAM_ACCESS_REQUIRED' },
  { status: 404, code: 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED' },
]) {
  assert.equal(phase4Api.isSubjectReviewAccessError(error), false);
}

assert.match(phase4, /subject-review:\$\{attemptId[^}]*\}:\$\{questionId[^}]*\}/);
assert.match(phase4, /mode:\s*'action'/);
assert.match(phase4, /context:\s*\{[\s\S]*reason:\s*'subject_reveal_review'[\s\S]*returnHash:\s*'#subject-matter'/);
assert.match(phase4, /adoptAccess\([^,]+,\s*\{\s*enforce:\s*false\s*\}\)/);
for (const lifecycle of ['pageshow', 'visibilitychange', 'focus']) {
  const marker = phase4.indexOf(`'${lifecycle}'`);
  assert.notEqual(marker, -1, `${lifecycle} access refresh guard must exist`);
  const lifecycleWindow = phase4.slice(marker, marker + 500);
  assert.match(lifecycleWindow, /refreshAccess\(\{\s*enforce:\s*false/,
    `${lifecycle} must refresh access without opening a gate`);
  assert.doesNotMatch(lifecycleWindow, /subject_reveal_review|loadCompleteSubjectReview/,
    `${lifecycle} must not reveal review material`);
}

for (const closeReason of ['close-button', 'back-button', 'backdrop', 'escape', 'browser-back']) {
  assert.match(phase2, new RegExp(`['"]${closeReason}['"]`), `${closeReason} must dismiss the action overlay`);
}
assert.match(phase2, /nativeViewMode\s*===\s*'action'/);
assert.match(phase2, /dueDiligenceActionOverlayHandled/);
assert.match(phase2, /Back to my answer/);
assert.match(phase2, /An active paid plan includes protected Syllabus-Based Review material/);
assert.match(
  phase2,
  /Provisional access lets you continue practicing while payment is reviewed; Reveal Answer unlocks only after payment is verified\./,
);
const commercialPlans = javascriptFunctionSection(phase2, 'renderCommercialPlanCards');
assert.match(
  commercialPlans,
  /subjectReviewAction[\s\S]*canRevealSubjectReview\?\.\(access\) === true/,
  'provisional or legacy unlimited access must not disable the subject-review pricing CTA',
);
const paymentSubmission = javascriptFunctionSection(phase2, 'submitCommercialPayment');
assert.match(paymentSubmission, /refreshAccess\?\.\(\{\s*force:\s*true,\s*enforce:\s*false\s*\}\)/);
assert.doesNotMatch(
  paymentSubmission,
  /operation:\s*['"]subject_reveal_review['"]|loadCompleteSubjectReview|\/examinations\/command/,
  'payment submission or refresh must never reveal automatically');

const commercialPricingLoader = javascriptFunctionSection(phase2, 'loadCommercialPricing');
assert.match(commercialPricingLoader, /adoptAccess\?\.\(access,\s*\{\s*enforce:\s*false\s*\}\)/,
  'the pricing access check must refresh the authoritative Phase 4 access snapshot');
assert.match(commercialPricingLoader, /canRevealSubjectReview\?\.\(access\) === true[\s\S]*closeNativeView\('access-active'\)/,
  'a stale-denied gate must close after the pricing check observes eligible review access');
assert.doesNotMatch(commercialPricingLoader, /subject_reveal_review['"]\s*\}|loadCompleteSubjectReview|\/examinations\/command/,
  'a fresh paid pricing snapshot must close the gate without revealing automatically');

{
  const freshPaidAccess = {
    allowed: true,
    unlimited: true,
    basis: 'paid_subscription',
  };
  let cachedAccess = { allowed: true, unlimited: false, basis: 'introductory_tokens' };
  let paywallCount = 0;
  let revealRequestCount = 0;
  let pricingRenderCount = 0;
  const closeReasons = [];
  const pricingState = {
    nativeViewSequence: 7,
    nativeView: 'pricing',
    nativeViewMode: 'action',
    nativeViewContext: { reason: 'subject_reveal_review' },
    session: { access_token: 'test-session' },
  };
  const pricingGlobal = {
    DueDiligencePhase4: {
      adoptAccess: (access) => { cachedAccess = access; },
      canRevealSubjectReview: (access) => access?.allowed === true
        && access?.unlimited === true
        && access?.basis === 'paid_subscription',
    },
    toast: () => {},
  };
  const pricingContext = vm.createContext({
    state: pricingState,
    document: {
      getElementById: () => ({
        innerHTML: '',
        addEventListener: () => {},
      }),
    },
    publicWorkerRequest: async () => ({ plans: [] }),
    nativeWorkerRequest: async (path) => {
      assert.equal(path, '/access');
      return { access: freshPaidAccess };
    },
    randomId: () => 'pricing-access-request',
    unlimitedFeatureActionContext: () => null,
    unlimitedFeatureAccessActive: () => false,
    returnToUnlimitedFeature: () => false,
    renderCommercialPlanCards: () => { pricingRenderCount += 1; },
    closeNativeView: (reason) => { closeReasons.push(reason); },
    escapeHtml: String,
    global: pricingGlobal,
    Promise,
  });
  vm.runInContext(
    `async ${commercialPricingLoader}\nglobalThis.__loadCommercialPricing = loadCommercialPricing;`,
    pricingContext,
    { filename: 'load-commercial-pricing-contract.js' },
  );

  const explicitRevealClick = async () => {
    if (!pricingGlobal.DueDiligencePhase4.canRevealSubjectReview(cachedAccess)) {
      paywallCount += 1;
      await pricingContext.__loadCommercialPricing(pricingState.nativeViewSequence);
      return;
    }
    revealRequestCount += 1;
  };

  await explicitRevealClick();
  assert.deepEqual(cachedAccess, freshPaidAccess, 'the fresh paid access must replace the stale denied snapshot');
  assert.deepEqual(closeReasons, ['access-active'], 'the stale contextual paywall must close exactly once');
  assert.equal(pricingRenderCount, 0, 'an already-eligible account must not remain trapped in the payment screen');
  assert.equal(revealRequestCount, 0, 'fresh access must never reveal without a second explicit click');
  await explicitRevealClick();
  assert.equal(paywallCount, 1, 'the second explicit click must not reopen the stale paywall');
  assert.equal(revealRequestCount, 1, 'only the explicit second click may request the protected review');
}

assert.match(examinations, /data-subject-review-access="\$\{accessAllowed \? 'eligible' : 'locked'\}"/);
assert.match(examinations, /<button class="dd-subject-review-reveal"[^>]*data-subject-review-reveal/);
assert.match(examinations, /<span>Reveal Answer<\/span>/);
assert.doesNotMatch(examinations, /data-subject-review-upgrade|View Early Access — ₱149/,
  'A separate payment CTA must not replace or compete with the original reveal control');
assert.match(examinations, /requires? an active Regular Subscription/);
assert.match(examinations, /INTERNAL_SUBJECT_REVIEW_MARKER/);
assert.match(examinations, /stripInternalSubjectReviewBlocks\(value\)/);
assert.match(examinations, /SUBJECT_REVIEW_USER_TEXT_KEYS[\s\S]*?'answertext'[\s\S]*?'studentanswer'[\s\S]*?'prompt'/,
  'the defensive scrubber must preserve learner-authored answers and question text');
assert.match(examinations, /SUBJECT_REVIEW_USER_TEXT_KEYS\.has\(normalizedSubjectReviewFieldName\(key\)\)/,
  'the defensive scrubber must preserve camelCase and snake_case learner fields consistently');
assert.match(examinations, /const material = sanitizeSubjectReviewValue\(rawMaterial\)/,
  'network review material must be scrubbed before it enters the in-memory cache');
assert.match(examinations, /function assessmentCard\(result, options = \{\}\) \{[\s\S]*?sanitizeSubjectReviewValue\(result\)/,
  'history and verdict rendering must defensively scrub nested learner-facing material');
assert.doesNotMatch(examinations, /trusted unlimited access|approved entitlement/i);
assert.match(examinations, /reviewConfirmationPending\s*=\s*false/);
const genericReviewFailure = javascriptFunctionSection(examinations, 'showCompleteSubjectReviewError');
assert.match(
  genericReviewFailure,
  /\{\s*releaseSubjectReviewPending\(panel\);/,
  'a generic reveal failure must roll back pending UI state before presenting retry controls',
);
assert.match(genericReviewFailure, /continue or submit now, or retry the review/,
  'generic failure copy must preserve the answering and submission path');
const loadCompleteReview = javascriptFunctionSection(examinations, 'loadCompleteSubjectReview');
assert.match(
  loadCompleteReview,
  /catch\s*\(error\)\s*\{[\s\S]*?releaseSubjectReviewPending\(panel\);[\s\S]*?if\s*\(!subjectReviewPanelIsCurrent\(panel\)\)\s*return;/,
  'a failed in-flight reveal must clear attempt-level pending state even when its original panel was replaced',
);
assert.doesNotMatch(
  loadCompleteReview,
  /if\s*\(\s*!subjectReviewAccessAllowed\(\)/,
  'a stale browser access snapshot must not redirect before the owner-bound server check',
);
assert.match(
  loadCompleteReview,
  /api\([\s\S]*?'\/examinations\/command',[\s\S]*?operation:\s*'subject_reveal_review',[\s\S]*?attemptId[\s\S]*?signal:\s*controller\?\.signal[\s\S]*?\)/,
  'Reveal Answer must always ask the server for the current entitlement',
);
assert.match(loadCompleteReview, /SUBJECT_REVIEW_REQUEST_TIMEOUT_MS/,
  'Reveal Answer must have a bounded client deadline before presenting its Retry state');
assert.match(phase4, /fetch\(`\$\{config\.workerUrl\}\$\{path\}`,[\s\S]*?signal:\s*options\.signal/,
  'the authenticated request helper must pass through an opt-in abort signal');
assert.match(
  examinations,
  /material\?\.questionId\s*===\s*questionId[\s\S]*return completeSubjectReviewContent\(material\)/,
  'identity-scoped cached valid material must survive a later entitlement change',
);
assert.match(examinations, /dueDiligenceActionOverlayHandled\s*===\s*true/);
assert.match(examinations, /adoptAccess\?\.\(material\.access,\s*\{\s*enforce:\s*false\s*\}\)/);

assert.ok(
  index.includes('assets/phase2-experience.js?v=profile-photo-release2-20260827-1'),
  'assets/phase2-experience.js must use the profile-photo release cache key',
);
assert.ok(
  index.includes('assets/phase4-experience.js?v=syllabus-reveal-p0-20260826-2&amp;access=paid-expiry-20260827-1&amp;recovery=subject-review-timeout-20260828-1&amp;forecast-setup=20260901-2'),
  'assets/phase4-experience.js must use the reviewed cache-busting release',
);
assert.ok(
  index.includes('assets/feature-loader.js?v=profile-photo-release2-20260827-1&amp;baseline=public-reliability-20260827-1&amp;feedback=offline-save-20260827-1&amp;hotfix=ian-provisional-reveal-20260828-1&amp;recovery=subject-review-timeout-20260828-1&amp;cta=home-subscription-20260828-2&amp;collapse=home-read-more-20260828-1&amp;results=history-20260828-1&amp;forecast=access-flow-20260902-1'),
  'assets/feature-loader.js must publish the provisional-to-paid reveal hotfix',
);
for (const asset of [
  'assets/study-workspace.js',
]) {
  assert.ok(
    featureLoader.includes(`${asset}?v=syllabus-reveal-p0-20260826-2`),
    `${asset} must use the reviewed lazy-load cache-busting release`,
  );
}
for (const asset of [
  'assets/examinations.css',
]) {
  assert.ok(
    featureLoader.includes(`${asset}?v=public-reliability-20260827-1`),
    `${asset} must use the public reliability lazy-load cache-busting release`,
  );
}
assert.match(serviceWorker, /duediligence-shell-unlimited-access-20260902-1/);
assert.match(studyWorkspace, /service-worker\.js\?v=commercial-readiness-profile-analytics-offline-paid-expiry-20260827-1/);
assert.ok(
  featureLoader.includes('assets/examinations.js?v=pedro-release2-20260827-1&baseline=public-reliability-20260827-1&hotfix=ian-provisional-reveal-20260828-1&recovery=subject-review-timeout-20260828-1'),
  'assets/examinations.js must publish the provisional-to-paid reveal hotfix',
);

const userInstructionsStart = runbook.indexOf('## Copy-ready user and Support instructions');
const technicalContractStart = runbook.indexOf('## Technical contract');
assert.notEqual(userInstructionsStart, -1, 'the runbook must include copy-ready user and Support instructions');
assert.ok(technicalContractStart > userInstructionsStart, 'the user instructions must be bounded before the technical contract');
const userInstructions = runbook.slice(userInstructionsStart, technicalContractStart);
assert.match(userInstructions, /active subscription/i);
assert.match(userInstructions, /subscription access screen/i);
assert.match(userInstructions, /does \*\*not\*\* use one of your introductory practice tokens/);
assert.doesNotMatch(
  userInstructions,
  /super_admin|founder_admin|founding_beta|provisional_payment|founding beta|early access|₱149|trusted|unlimited|other approved/i,
  'copy-ready user and Support wording must not disclose internal entitlement bases or policy terminology',
);

const rolloutStart = runbook.indexOf('## Rollout order');
const liveAuditStart = runbook.indexOf('## Live read-only audit');
assert.notEqual(rolloutStart, -1, 'the runbook must include an ordered rollout');
assert.ok(liveAuditStart > rolloutStart, 'the rollout must be bounded before the live audit');
const rollout = runbook.slice(rolloutStart, liveAuditStart);
const productionWorker = rollout.indexOf('Deploy the reviewed Worker to production');
const productionMigration = rollout.indexOf('Apply the migration to production');
const productionPages = rollout.indexOf('Deploy the static frontend');
assert.ok(productionWorker >= 0 && productionWorker < productionMigration && productionMigration < productionPages,
  'production rollout must deploy Worker compatibility first, then the database migration, then Pages');
assert.match(rollout, /old Worker[\s\S]*every authorized replay/,
  'the runbook must explain why database-first production rollout can repeat provider work');

console.log('Syllabus-Based Review reveal entitlement, no-token, paywall, recovery, and idempotency contracts passed.');
