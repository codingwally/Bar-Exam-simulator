import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BAR_FEELS_DESTINATIONS,
  MOCK_BAR_SUBJECTS,
  SUBJECT_MATTER_CSV_URL,
  WEBSITE_UPLOAD_CSV_URL,
  buildBarFeelsManifest,
  buildSubjectMatterPlacements,
  parseSubjectMatterSource,
  parseWebsiteUploadSource,
} from '../worker/release-content-core.mjs';

const fetchCsv = async (url) => {
  const maxAttempts = 5;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/csv' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const csv = await response.text();
        assert.ok(csv.length > 10_000, 'Published source was unexpectedly small.');
        return csv;
      }
      const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        assert.fail(`Published source failed: ${response.status}`);
      }
      lastError = new Error(`Published source failed: ${response.status}`);
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1_000, 10_000)
        : Math.min(attempt * 1_000, 4_000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1_000, 4_000)));
    }
  }
  throw lastError || new Error('Published source could not be loaded.');
};

// Google Sheets can return 409 while generating two CSV exports concurrently.
// Validate the two authoritative tabs serially so the release gate remains strict
// without creating an avoidable export race.
const subjectCsv = await fetchCsv(SUBJECT_MATTER_CSV_URL);
const mockBarCsv = await fetchCsv(WEBSITE_UPLOAD_CSV_URL);

const [
  html,
  examinations,
  forum,
  experience,
  worker,
  migration,
  consolidationMigration,
  transportMigration,
  preflight,
] =
  await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/lex-forum.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../supabase/migrations/20260805120000_complete_beta_release_foundation.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../supabase/migrations/20260811004000_subject_matter_two_bank_consolidation.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../supabase/migrations/20260811004100_subject_matter_chunked_release_transport.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../supabase/review/complete_beta_production_preflight.sql', import.meta.url),
      'utf8',
    ),
  ]);

const subjectMatter = await parseSubjectMatterSource(subjectCsv);
assert.equal(subjectMatter.rows.length, 1622);
assert.equal(subjectMatter.subjectCount, 34);
assert.equal(new Set(subjectMatter.rows.map((row) => row.questionId)).size, 1622);
assert.ok(subjectMatter.rows.every((row) =>
  row.subject && row.prompt && row.suggestedAnswer && row.legalBasis));
const subjectPlacements = buildSubjectMatterPlacements(subjectMatter.rows);
assert.equal(subjectPlacements.courses.length, 42);
assert.equal(subjectPlacements.placements.length, 1890);
assert.equal(new Set(subjectPlacements.placements.map((row) => row.questionId)).size, 1490);
assert.equal(subjectPlacements.placements.filter((row) => row.placementType === 'direct').length, 1490);
assert.equal(subjectPlacements.placements.filter((row) => row.placementType === 'integration').length, 400);

const mockBar = await parseWebsiteUploadSource(mockBarCsv);
assert.equal(mockBar.rows.length, 320);
assert.deepEqual(Object.keys(mockBar.counts), [...MOCK_BAR_SUBJECTS]);
assert.ok(Object.values(mockBar.counts).every((count) => count === 40));

const manifest = buildBarFeelsManifest(mockBar.rows);
assert.equal(manifest.length, 6);
assert.deepEqual(
  manifest.map((group) => group.destination),
  BAR_FEELS_DESTINATIONS.map((group) => group.destination),
);
assert.ok(manifest.every((group) => group.rows.length === 20));
const assignments = manifest.flatMap((group) => group.rows);
assert.equal(assignments.length, 120);
assert.equal(new Set(assignments.map((row) => row.questionId)).size, 120);

for (const phrase of [
  'Home',
  'Practice Exam',
  'Guided Practice',
  'Doctrine Review',
  'Bar Question Practice',
  'Bar Exam Simulation',
  'Subject Matter',
  'Plans &amp; Pricing',
  'Profile',
  'Support',
  'Examination Room',
]) assert.match(html, new RegExp(phrase));

assert.match(
  html,
  /<form class="lex-composer" id="lex-composer"[^>]*aria-label="Share with the community">[\s\S]*What do you want to ask or share about law school\?/,
);
assert.match(html, /<h1 id="pb-pillars-title">Prepare with purpose\.<\/h1>/);
for (const featureId of ['spa-mock', 'spa-subject-matter', 'spa-progress', 'spa-bar-easy', 'spa-community', 'spa-pricing', 'spa-bar-feels', 'spa-chairs-case', 'spa-jurisprudence', 'spa-case-digest']) {
  assert.match(html, new RegExp(`id="${featureId}"`));
}
assert.doesNotMatch(html, /Co-Counsel|Joint Venture/);
assert.doesNotMatch(experience, /Co-Counsel|Joint Venture/);
assert.match(experience, /one lifetime allowance of five practice tokens/i);
assert.match(experience, /Early Access is available at the current promotional price of ₱149/);
assert.doesNotMatch(experience, /planCode: 'free'|name: 'Free'/);
assert.match(experience, /assets\/payments\/bpi-instapay-149\.png/);
assert.doesNotMatch(experience, /assets\/payments\/gotyme-instapay-149\.png/);
assert.doesNotMatch(experience, /Pricing will be announced after beta testing\.|Beta access active\./);

assert.match(examinations, /operation: 'subject_catalog'/);
assert.match(examinations, /operation: 'subject_next'/);
assert.match(examinations, /operation: 'subject_performance'/);
assert.match(examinations, /data-submit-current/);
assert.match(examinations, /Next question/);
assert.match(forum, /command\('create_entry'/);
assert.doesNotMatch(forum, /create_simple_entry/);
assert.match(forum, /set_affirm/);
assert.match(forum, /affirm_roster/);
assert.match(worker, /\/admin\/content\/sync/);
assert.match(worker, /release_stage_subject_matter_v2/);
assert.match(worker, /release_finalize_all_content_v2/);
assert.match(worker, /phase4_plan_catalog/);
assert.match(worker, /planCode \|\| ''\) === 'early_access_beta'/);
assert.match(migration, /alter table public\.forum_posts force row level security;/);
assert.match(
  migration,
  /revoke all on table[\s\S]*public\.forum_posts[\s\S]*from public, anon, authenticated;/,
);
assert.match(consolidationMigration, /create table if not exists public\.subject_matter_placements/);
assert.match(consolidationMigration, /release_sync_subject_matter_v2/);
assert.match(consolidationMigration, /jsonb_array_length\(p_placements\) <> 1890/);
assert.match(consolidationMigration, /v_direct <> 1490/);
assert.match(consolidationMigration, /v_integration <> 400/);
assert.match(consolidationMigration, /alter table public\.subject_matter_placements force row level security/);
assert.match(transportMigration, /create table if not exists public\.release_subject_matter_payload_parts/);
assert.match(transportMigration, /jsonb_array_length\(payload\) between 1 and 200/);
assert.match(transportMigration, /release_finalize_all_content_v2/);
assert.match(transportMigration, /jsonb_array_length\(v_rows\) <> 1622/);
assert.match(transportMigration, /jsonb_array_length\(v_placements\) <> 1890/);
assert.match(preflight, /set transaction read only;/);
assert.match(preflight, /COMPLETE_BETA_PREFLIGHT_PASSED/);
assert.match(preflight, /browser grant exists on public\.%/);
assert.doesNotMatch(
  preflight,
  /^\s*(insert\s+into|update|delete\s+from|alter\s+table|create\s+(table|function|index)|drop|grant|revoke|truncate)\b/im,
  'The complete beta production preflight must remain read-only.',
);

console.log(JSON.stringify({
  subjectMatterRows: subjectMatter.rows.length,
  subjectMatterSubjects: subjectMatter.subjectCount,
  subjectMatterPlacements: subjectPlacements.placements.length,
  mockBarRows: mockBar.rows.length,
  mockBarSubjects: mockBar.counts,
  barFeelsDestinations: manifest.length,
  barFeelsAssignments: assignments.length,
}, null, 2));
