import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SUBJECT_MATTER_COURSES,
  SUBJECT_MATTER_EXPECTED,
  SUBJECT_MATTER_PLACEMENTS,
} from '../worker/subject-matter-placement-manifest.mjs';

const [
  migration, transportMigration, reviewMigration, reviewNormalizationMigration, assistedReviewMigration,
  preflight, worker, reviewCore, releaseCore, examinationsUi, examinationsCss, examinerCore,
  examinationsCore,
] = await Promise.all([
  readFile(new URL(
    '../supabase/migrations/20260811004000_subject_matter_two_bank_consolidation.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../supabase/migrations/20260811004100_subject_matter_chunked_release_transport.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../supabase/migrations/20260814065530_subject_matter_review_material.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../supabase/migrations/20260814083000_subject_matter_review_source_normalization.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../supabase/migrations/20260814131651_subject_matter_assisted_review.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../supabase/review/subject_matter_two_bank_production_preflight.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../worker/subject-matter-review.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../worker/release-content-core.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.css', import.meta.url), 'utf8'),
  readFile(new URL('../worker/examiner-core.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../worker/examinations-core.mjs', import.meta.url), 'utf8'),
]);

assert.equal(SUBJECT_MATTER_COURSES.length, 42);
assert.equal(SUBJECT_MATTER_PLACEMENTS.length, 1890);
assert.equal(SUBJECT_MATTER_EXPECTED.canonicalQuestions, 1490);

for (const contract of [
  /create table if not exists public\.subject_matter_placements/,
  /alter table public\.subject_matter_placements enable row level security/,
  /alter table public\.subject_matter_placements force row level security/,
  /revoke all on public\.subject_matter_placements\s+from public, anon, authenticated/,
  /grant select, insert, update, delete on public\.subject_matter_placements\s+to service_role/,
  /create or replace function public\.release_sync_subject_matter_v2/,
  /jsonb_array_length\(p_rows\) <> 1622/,
  /jsonb_array_length\(p_placements\) <> 1890/,
  /v_direct <> 1490/,
  /v_integration <> 400/,
  /v_canonical <> 1490/,
  /v_major_courses <> 35/,
  /v_minor_courses <> 7/,
  /delete from public\.subject_matter_placements\s+where placement_digest <> p_placement_digest/,
  /create or replace function public\.subject_matter_catalog/,
  /create or replace function public\.subject_matter_next_question/,
]) assert.match(migration, contract);

assert.match(transportMigration, /create table if not exists public\.release_subject_matter_payload_parts/);
assert.match(transportMigration, /release_stage_subject_matter_v2/);
assert.match(transportMigration, /release_finalize_all_content_v2/);
assert.match(transportMigration, /expires_at <= now\(\)/);
for (const contract of [
  /create or replace function public\.subject_matter_review_material/,
  /security definer/,
  /attempt\.user_id = p_user_id/,
  /v_track <> 'per_subject'/,
  /v_assessment_kind <> 'quiz'/,
  /question\.content_hash = version_question\.snapshot_hash/,
  /version_question\.legal_basis_snapshot/,
  /version_question\.source_urls_snapshot/,
  /question\.doctrine/,
  /question\.publication_ready is true/,
  /lower\(question\.review_status\) in \('approved', 'owner_override'\)/,
  /revoke all on function public\.subject_matter_review_material\(uuid, uuid\)\s+from public, anon, authenticated/,
  /grant execute on function public\.subject_matter_review_material\(uuid, uuid\)\s+to service_role/,
]) assert.match(reviewMigration, contract);
for (const contract of [
  /create or replace function public\.subject_matter_review_material/,
  /when 'string' then btrim\(source\.entry #>> '\{\}'\)/,
  /when 'object' then btrim\(source\.entry->>'url'\)/,
  /jsonb_agg\(normalized\.url order by source\.ordinality\)/,
  /normalized\.url !~ '\^https:\/\/'/,
  /revoke all on function public\.subject_matter_review_material\(uuid, uuid\)\s+from public, anon, authenticated/,
  /grant execute on function public\.subject_matter_review_material\(uuid, uuid\)\s+to service_role/,
]) assert.match(reviewNormalizationMigration, contract);
for (const contract of [
  /add column if not exists review_material_revealed_at timestamptz/,
  /add column if not exists review_material_revealed_before_submission boolean/,
  /create or replace function public\.subject_matter_reveal_review/,
  /attempt\.user_id = p_user_id/,
  /question\.content_hash = version_question\.snapshot_hash/,
  /question\.publication_ready is true/,
  /lower\(question\.review_status\) in \('approved', 'owner_override'\)/,
  /v_attempt\.status in \('in_progress', 'review'\)/,
  /review_material_revealed_at is null/,
  /revoke all on function public\.subject_matter_reveal_review\(uuid, uuid\)\s+from public, anon, authenticated/,
  /grant execute on function public\.subject_matter_reveal_review\(uuid, uuid\)\s+to service_role/,
  /unassistedAverageScore/,
  /a\.review_material_revealed_before_submission is false/,
]) assert.match(assistedReviewMigration, contract);
assert.match(worker, /release_stage_subject_matter_v2/);
assert.match(worker, /release_finalize_all_content_v2/);
assert.match(worker, /await stageParts\('rows', subjectSource\.rows, 100\)/);
assert.match(worker, /await stageParts\('placements', subjectPlacementManifest\.placements, 200\)/);
assert.match(releaseCore, /range=A1%3AU1623/);
assert.match(releaseCore, /buildSubjectMatterPlacements/);
assert.match(examinationsUi, /function assessmentCard\(result, options = \{\}\)/);
assert.match(examinationsUi, /function subjectHierarchyMarkup\(/);
assert.match(examinationsUi, /<details class="dd-subject-year"/);
assert.match(examinationsUi, /<details class="dd-subject-term"/);
assert.match(examinationsUi, /aria-expanded=/);
assert.match(examinationsUi, /aria-controls=/);
assert.match(examinationsUi, /data-subject-search-input/);
assert.match(examinationsUi, /SUBJECT_CATALOG_STATE_KEY/);
assert.match(examinationsUi, /id="dd-subject-selector-dialog"/);
assert.match(examinationsUi, /data-subject-selector-close aria-label="Close course chooser"/);
assert.doesNotMatch(examinationsUi, /function subjectWritingGuide\(|Writing approach|Take a clear position on the legal issue/i,
  'Subject Matter must not restore the removed generic writing guide.');
assert.match(examinationsUi, /Improved model response/);
assert.match(examinationsUi, /Improved Answer — ALAC Method/);
assert.match(examinationsUi, /data-assessment-rating="up"/);
assert.match(examinationsUi, /data-suggest-exam-correction/);
assert.match(examinationsUi, /assessmentCard\(result, \{ track \}\)/);
assert.match(examinationsUi, /assessmentCard\(item, \{ answerText: item\.answerText, track: 'per_subject' \}\)/);
assert.match(examinationsCss, /\.dd-subject-editorial-pane\.dd-subject-practice-answer\s*\{[\s\S]*?grid-area:\s*auto/,
  'The editorial coaching pane must neutralize the legacy named grid area.');
assert.match(examinationsCss, /@media \(max-width: 900px\)[\s\S]*?\.dd-subject-editorial-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  'Subject Matter must collapse to one full-width column on narrow screens.');
const subjectPracticeRoom = examinationsUi.slice(
  examinationsUi.indexOf('function subjectPracticeRoomMarkup'),
  examinationsUi.indexOf('function renderRoom'),
);
assert.ok(
  subjectPracticeRoom.indexOf('class="dd-subject-editorial-pane is-writing dd-subject-practice-answer"')
    < subjectPracticeRoom.indexOf('class="dd-subject-editorial-pane is-reading is-review-panel"'),
  'Subject Matter must keep the question and answer on the left and review disclosures on the right.',
);
assert.doesNotMatch(subjectPracticeRoom, /one focused question|One-question review session/i,
  'Subject Matter must not retain the redundant one-question wording.');
assert.match(examinationsUi, /Review and retain\./);
assert.match(examinationsUi, /Individual ALAC assessments\./);
assert.match(examinerCore, /modelAnswerSectionsForQuestion/);
assert.match(examinerCore, /'procedure'[\s\S]*'doctrine'[\s\S]*'mixed'/);
assert.match(worker, /sanitizeSubjectMatterCatalog\(result\)/);
assert.match(worker, /sanitizeSubjectMatterSelection\(result\)/);
assert.match(worker, /examinationRpc\(env, 'subject_matter_reveal_review'/);
assert.match(worker, /command\.operation === 'subject_reveal_review'/);
assert.doesNotMatch(worker, /examinationRpc\(env, 'subject_matter_review_material'/,
  'The retired read-only review operation must not bypass assisted classification.');
assert.match(reviewCore, /Use only the CURATED CORPUS/);
assert.match(reviewCore, /fallbackSubjectMatterTeachingExplanation/);
assert.match(reviewCore, /buildSubjectMatterLegalReview/);
assert.match(reviewCore, /entry\.caseName \|\| entry\.title \|\| entry\.case/,
  'Stored case values must be canonicalized instead of discarded.');
assert.match(reviewCore, /isBareSubjectMatterDoctrine/,
  'Bare yes/no content must not be presented as doctrine.');
assert.match(examinationsUi, /Reveal suggested answer/);
assert.match(examinationsUi, /Reveal controlling law and doctrine/);
assert.match(examinationsUi, /Reveal application, limits, and sources/);
assert.match(examinationsUi, /Controlling Law &amp; Doctrine/);
assert.match(examinationsUi, /Application and Material Limits/);
assert.match(examinationsUi, /operation:\s*'subject_reveal_review'/);
const subjectReviewLock = examinationsUi.slice(
  examinationsUi.indexOf('function subjectReviewPanelMarkup'),
  examinationsUi.indexOf('function updateCompleteSubjectReviewPanels'),
);
assert.equal((subjectReviewLock.match(/<button[^>]*data-subject-review-reveal/g) || []).length, 1,
  'The locked Subject Matter review must expose one Reveal Answer button.');
assert.match(subjectReviewLock, /<span>Reveal Answer<\/span>/);
assert.equal((subjectReviewLock.match(/<details/g) || []).length, 0,
  'Expandable review sections must remain absent until the authorized reveal succeeds.');
assert.match(examinationsCore, /SUBJECT_MATTER_INVENTORY_KEYS/);
const subjectSurface = examinationsUi.slice(
  examinationsUi.indexOf('function renderPerSubject'),
  examinationsUi.indexOf('function curatedBarCards'),
);
assert.doesNotMatch(subjectSurface, /questionCount|availableCount|totalQuestions|remainingQuestions|bankSize/);
assert.doesNotMatch(subjectSurface, /<select/);
assert.doesNotMatch(subjectSurface, /items\.sort\(/,
  'Subject Matter must preserve the server-approved course-code ordering.');
assert.doesNotMatch(examinationsUi, /0\.5 increments only|Use intermediate half-points/);

assert.match(preflight, /begin transaction read only/);
assert.match(preflight, /SUBJECT_MATTER_TWO_BANK_PREFLIGHT_PASSED/);
assert.match(preflight, /version in \('20260811004000', '20260811004100'\)/);
assert.match(preflight, /count\(\*\) from public\.examination_questions\) <> 736/);
assert.match(preflight, /count\(\*\) from public\.examination_definitions where track = 'per_subject'\) <> 616/);
assert.match(preflight, /grantee in \('PUBLIC', 'anon', 'authenticated'\)/);
assert.match(preflight, /rollback;/);
assert.doesNotMatch(preflight, /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b\s+(?:table|into|from|on)/i);

assert.doesNotMatch(
  migration,
  /I\.\s*ANSWER|II\.\s*LEGAL BASIS|G\.R\. No\.|studentAnswer|modelAnswer/i,
  'The schema migration must not embed question, answer, or student content.',
);
assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete).*\b(anon|authenticated)\b/i);
assert.doesNotMatch(transportMigration, /grant\s+(select|insert|update|delete).*\b(anon|authenticated)\b/i);
assert.doesNotMatch(reviewMigration, /grant\s+execute.*\b(anon|authenticated)\b/i);
assert.doesNotMatch(reviewNormalizationMigration, /grant\s+execute.*\b(anon|authenticated)\b/i);

console.log(JSON.stringify({
  courses: SUBJECT_MATTER_COURSES.length,
  placements: SUBJECT_MATTER_PLACEMENTS.length,
  canonicalQuestions: SUBJECT_MATTER_EXPECTED.canonicalQuestions,
  databaseBrowserAccess: false,
}, null, 2));
