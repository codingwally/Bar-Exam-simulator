import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

const [
  sourceText,
  contentMigration,
  premiumMigration,
  examinations,
  examinationsCss,
  phase2Css,
  phase2Config,
  phase2Experience,
  admin,
  adminActions,
  worker,
  paymentCore,
  examinationCore,
  publicPage,
] = await Promise.all([
  read('content/examinations/leb-y1-y2-approved-subject-matter-20260730.json'),
  read('supabase/migrations/20260804_013_leb_subject_matter_approved_content.sql'),
  read('supabase/migrations/20260804_014_premium_499_entitlements.sql'),
  read('assets/examinations.js'),
  read('assets/examinations.css'),
  read('assets/phase2.css'),
  read('assets/phase2-config.js'),
  read('assets/phase2-experience.js'),
  read('admin/admin.js'),
  read('admin/subscription-actions-core.js'),
  read('worker/index.mjs'),
  read('worker/payment-core.mjs'),
  read('worker/examinations-core.mjs'),
  read('index.html'),
]);

const source = JSON.parse(sourceText);
assert.equal(source.source.spreadsheetId, '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A');
assert.equal(source.source.sheetName, 'LEB Y1-Y2 Exam Bank');
assert.equal(source.rows.length, 11);
assert.equal(source.withheld.length, 13);

const mapping = [
  ['LEB-Y1T1-JD101-20260730-Q01', 'Philosophy of Law', 1, 1, 55],
  ['LEB-Y1T1-JD102-20260730-Q01', 'Statutory Construction', 1, 1, 105],
  ['LEB-Y1T1-JD201-20260730-Q01', 'Basic Legal and Judicial Ethics', 1, 1, 155],
  ['LEB-Y1T1-JD301-20260730-Q01', 'Constitutional Law I', 1, 1, 205],
  ['LEB-Y1T1-JD401-20260730-Q01', 'Criminal Law I', 1, 1, 255],
  ['LEB-Y1T1-JD601-20260730-Q04', 'Criminal Procedure', 1, 1, 308],
  ['LEB-Y1T2-JD103-20260730-Q01', 'Legal Research and Writing', 1, 2, 355],
  ['LEB-Y1T2-JD302-20260730-Q01', 'Constitutional Law II', 1, 2, 405],
  ['LEB-Y1T2-JD402-20260730-Q22', 'Criminal Law II', 1, 2, 476],
  ['LEB-Y1T2-JD502-20260730-Q01', 'Obligations and Contracts', 1, 2, 505],
  ['LEB-Y1T2-JD602-20260730-Q02', 'Civil Procedure I', 1, 2, 556],
  ['LEB-Y2T1-JD306-20260730-Q01', 'Public International Law', 2, 1, 605],
  ['LEB-Y2T1-JD501-20260730-Q01', 'Persons and Family Law', 2, 1, 606],
  ['LEB-Y2T1-JD603-20260730-Q01', 'Civil Procedure II', 2, 1, 607],
  ['LEB-Y2T1-JD701-20260730-Q01', 'Agency, Trust and Partnership Law', 2, 1, 608],
  ['LEB-Y2T1-JD702-20260730-Q01', 'Corporation and Basic Securities Law', 2, 1, 609],
  ['LEB-Y2T1-JD801-20260730-Q01', 'Labor Law and Social Legislation', 2, 1, 610],
  ['LEB-Y2T1-JD105-20260730-Q01', 'Clinical Legal Education', 2, 1, 611],
  ['LEB-Y2T2-JD303-20260730-Q01', 'Administrative Law and Law on Public Officers', 2, 2, 612],
  ['LEB-Y2T2-JD503-20260730-Q01', 'Property and Land Law', 2, 2, 613],
  ['LEB-Y2T2-JD504-20260730-Q01', 'Basic Succession Law', 2, 2, 614],
  ['LEB-Y2T2-JD604-20260730-Q01', 'Evidence', 2, 2, 615],
  ['LEB-Y2T2-JD703-20260730-Q01', 'Commercial Laws I', 2, 2, 616],
  ['LEB-Y2T2-JD901-20260730-Q01', 'Basic Taxation Law', 2, 2, 617],
];

const allRows = new Map([...source.rows, ...source.withheld].map((row) => [row.questionId, row]));
assert.equal(allRows.size, 24);
for (const [questionId, subject, year, term, sheetRow] of mapping) {
  const row = allRows.get(questionId);
  assert.ok(row, `${questionId} is mapped`);
  assert.equal(row.subject, subject);
  assert.equal(row.yearLevel, year);
  assert.equal(row.term, term);
  assert.equal(row.sheetRow, sheetRow);
  assert.equal(row.sheetRange, `A${sheetRow}:U${sheetRow}`);
  assert.match(examinations, new RegExp(`display: '${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
}

const approvedIds = new Set(source.rows.map((row) => row.questionId));
const withheldIds = new Set(source.withheld.map((row) => row.questionId));
assert.equal(approvedIds.size, 11);
assert.equal(withheldIds.size, 13);
for (const row of source.rows) {
  assert.equal(row.editorialStatus, 'Approved');
  assert.equal(row.publicationReady, 'Yes');
  assert.match(row.suggestedAnswer, /^Answer:/);
  assert.match(row.suggestedAnswer, /\n\nLegal Basis:/);
  assert.match(row.suggestedAnswer, /\n\nApplication:/);
  assert.match(row.suggestedAnswer, /\n\nConclusion:/);
  assert.ok(row.prompt.trim());
  assert.ok(row.legalBasis.trim());
  assert.ok(row.sourceUrls.every((item) => /^https:\/\//.test(item.url)));
  assert.equal((contentMigration.match(new RegExp(row.questionId, 'g')) || []).length, 1);
}
for (const row of source.withheld) {
  assert.equal(row.editorialStatus, 'For Review');
  assert.equal(row.publicationReady, 'No');
  assert.doesNotMatch(contentMigration, new RegExp(row.questionId));
}

assert.match(contentMigration, /assessment_kind in \('midterm', 'final', 'quiz'/);
assert.match(contentMigration, /'per_subject',\s*'quiz'/);
assert.match(contentMigration, /duration_seconds[\s\S]*420/);
assert.match(contentMigration, /'after_ai'/);
assert.match(contentMigration, /Preserve deterministic identifiers while setting RFC 4122 version 5/);
assert.equal(
  (
    contentMigration.match(
      /substr\(v_uuid_hash, 1, 12\) \|\| '5' \|\| substr\(v_uuid_hash, 14, 3\)[\s\S]*?\|\| '8' \|\| substr\(v_uuid_hash, 18\)/g,
    ) || []
  ).length,
  4,
);
assert.match(contentMigration, /on conflict \(id\) do nothing/);
assert.match(
  contentMigration,
  /1,\s*'draft',\s*v_version_hash,\s*v_actor,\s*null\s*\)\s*on conflict \(id\) do nothing;/,
);
assert.match(
  contentMigration,
  /if not exists \([\s\S]*from public\.examination_version_questions[\s\S]*insert into public\.examination_version_questions/,
);
assert.match(
  contentMigration,
  /update public\.examination_versions\s*set status = 'published',[\s\S]*where id = v_version_id and status = 'draft';/,
);
assert.doesNotMatch(contentMigration, /insert into public\.(?:questions|grading_results)\b/);
assert.doesNotMatch(contentMigration, /\bdrop table\b|\btruncate\b|\bdelete from\b/i);
assert.match(contentMigration, /LEB_CONTENT_IMMUTABLE_CONFLICT/);
assert.match(contentMigration, /LEB_VERSION_IMMUTABLE_CONFLICT/);

assert.match(premiumMigration, /where plan_code = 'premium'/);
assert.match(premiumMigration, /price_php = 499\.00/);
assert.match(premiumMigration, /duration_days = null/);
assert.match(premiumMigration, /checkout_enabled = true/);
assert.match(premiumMigration, /amountCentavos', round\(v_request\.trusted_amount_php \* 100\)::integer/);
assert.match(premiumMigration, /Premium activation requires an explicit future expiration/);
assert.match(premiumMigration, /Premium payment approval requires an explicit future expiration/);
assert.match(premiumMigration, /phase4_admin_manage_subscription/);
assert.match(premiumMigration, /phase4_admin_review_payment/);
assert.match(premiumMigration, /phase4_admin_premium_access/);
assert.match(premiumMigration, /phase4_user_subscription_status/);
assert.match(premiumMigration, /examination_authorize_access/);
assert.match(premiumMigration, /EXAM_PREMIUM_REQUIRED/);
assert.match(premiumMigration, /'examinationBeta'/);
assert.match(
  premiumMigration,
  /v_access := public\.phase4_access_snapshot\(p_user_id, false, null\);[\s\S]*v_basis := case when v_source = 'complimentary'/,
);
assert.match(premiumMigration, /plan_code = 'premium'[\s\S]*status = 'active'[\s\S]*expires_at > now\(\)/);
assert.match(premiumMigration, /from public, anon, authenticated/);
assert.match(premiumMigration, /to service_role/);
assert.doesNotMatch(premiumMigration, /grant\s+execute[\s\S]*to\s+(?:anon|authenticated)/i);
assert.doesNotMatch(premiumMigration, /\bdrop table\b|\btruncate\b|\bdelete from\b/i);

assert.match(phase2Config, /id: 'premium'[\s\S]*pricingHidden: true/);
assert.match(phase2Config, /id: 'premium'[\s\S]*previewStatus: 'beta'/);
assert.match(phase2Config, /Pricing will be announced after beta testing\./);
assert.doesNotMatch(phase2Config, /pricePhp|priceCentavos|amountPhp|₱/);
assert.match(phase2Experience, /Premium-only Bar Feels/);
assert.match(phase2Experience, /Beta access active/);
assert.match(phase2Experience, /Pricing will be announced after beta testing\./);
assert.doesNotMatch(
  phase2Experience,
  /Payment awaiting review|submitPayment\(|dd2-payment-form|pricePhp|amountPhp|₱/i,
);

assert.match(adminActions, /'Suspend'/);
assert.match(adminActions, /'Expire now'/);
assert.match(adminActions, /'Revoke'/);
assert.match(adminActions, /'Restore'/);
assert.match(admin, /Beta All Access/);
assert.match(admin, /Admin & Staff/);
assert.match(admin, /Beta Tester/);
assert.match(admin, /subscription-search/);
assert.match(admin, /Select a future Premium expiration/);

assert.match(worker, /examination_authorize_access/);
assert.match(worker, /phase4_admin_manage_subscription/);
assert.match(worker, /phase4_admin_review_payment/);
assert.match(worker, /phase4_admin_premium_access/);
assert.match(paymentCore, /\['early_access_beta', 'standard', 'premium'\]/);
assert.match(
  publicPage,
  /hasOverrideAccess = access\?\.globalBeta\?\.active === true[\s\S]*examinationBeta\?\.active/,
);
assert.match(examinationCore, /EXAM_PREMIUM_REQUIRED/);
assert.match(examinationCore, /'quiz'/);
assert.match(examinationsCss, /\.dd-subject-group/);
assert.match(examinations, /function subjectHierarchyMarkup\(selected, prefix\)/);
assert.match(examinations, /<span>Year \$\{escapeHtml\(year\)\}<\/span>/);
assert.match(examinations, /<span>Term \$\{escapeHtml\(term\)\}<\/span>/);
assert.match(examinations, /aria-expanded="\$\{yearOpen \? 'true' : 'false'\}"/);
assert.match(examinations, /aria-controls="\$\{escapeAttribute\(yearPanelId\)\}"/);
assert.match(examinations, /data-subject-search-input/);
assert.match(examinations, /id="dd-subject-selector-dialog"/);
assert.match(examinations, /function subjectWritingGuide\(question = \{\}\)/);
assert.match(examinations, /Improved model response/);
assert.match(examinations, /Individual question assessments\./);
assert.match(examinations, /Subject Matter/);
for (const timerLabel of ['12-minute practice', 'Stopwatch', 'Untimed practice']) {
  assert.match(examinations, new RegExp(timerLabel));
}
assert.match(examinations, /preferredTimerMode: 'selfPaced'/,
  'Subject Matter must default to Stopwatch without a mandatory timing interruption.');
assert.match(examinations, /Questions appear in a random, no-repeat cycle/);
assert.match(
  examinations,
  /async function openVerdict\(attemptId\) \{\s*const track = state\.active\?\.examination\?\.track \|\| state\.track;\s*state\.screen = 'verdict';/,
);
assert.match(phase2Css, /\.dd2-native-card \.dd2-view-kicker \{\s*color: #87651f;/);

const publicArtifact = JSON.stringify({
  rows: source.rows,
  withheld: source.withheld,
});
for (const forbidden of [
  'assignedReviewer',
  'reviewerName',
  'feedbackCount',
  'openFeedback',
]) {
  assert.equal(publicArtifact.includes(`"${forbidden}"`), false);
}

const digest = createHash('sha256').update(JSON.stringify({
  rows: source.rows,
  withheld: source.withheld,
})).digest('hex');
assert.match(contentMigration, new RegExp(`Source digest: ${digest}`));

console.log('LEB Subject Matter and Premium ₱499 release contract checks passed.');
