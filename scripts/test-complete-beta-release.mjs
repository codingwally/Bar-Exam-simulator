import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BAR_FEELS_DESTINATIONS,
  MOCK_BAR_SUBJECTS,
  SUBJECT_MATTER_CSV_URL,
  WEBSITE_UPLOAD_CSV_URL,
  buildBarFeelsManifest,
  parseSubjectMatterSource,
  parseWebsiteUploadSource,
} from '../worker/release-content-core.mjs';

const fetchCsv = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'text/csv' } });
  assert.equal(response.ok, true, `Published source failed: ${response.status}`);
  const csv = await response.text();
  assert.ok(csv.length > 10_000, 'Published source was unexpectedly small.');
  return csv;
};

const [
  subjectCsv,
  mockBarCsv,
  html,
  examinations,
  forum,
  experience,
  worker,
  migration,
  preflight,
] =
  await Promise.all([
    fetchCsv(SUBJECT_MATTER_CSV_URL),
    fetchCsv(WEBSITE_UPLOAD_CSV_URL),
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
      new URL('../supabase/review/complete_beta_production_preflight.sql', import.meta.url),
      'utf8',
    ),
  ]);

const subjectMatter = await parseSubjectMatterSource(subjectCsv);
assert.equal(subjectMatter.rows.length, 616);
assert.equal(subjectMatter.subjectCount, 24);
assert.equal(new Set(subjectMatter.rows.map((row) => row.questionId)).size, 616);
assert.ok(subjectMatter.rows.every((row) =>
  row.subject && row.prompt && row.suggestedAnswer && row.legalBasis));

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
  'Mock Bar',
  'Subject Matter',
  'Bar Feels',
  'The Verdict',
  'Retainer',
  'Quorum',
  'Recent Jurisprudence',
  'Support',
  'Partnerships',
  'The Docket',
]) assert.match(html, new RegExp(phrase));

assert.match(
  html,
  /The floor is yours—speak your mind, ask questions, share your law school journey, and learn together\./,
);
assert.match(html, /Prepare by Subject/);
assert.match(html, /Strengthen Legal Analysis/);
assert.match(html, /Learn From Every Submission/);
assert.doesNotMatch(html, /Co-Counsel|Joint Venture/);
assert.doesNotMatch(experience, /Co-Counsel|Joint Venture|amountPhp|pricePhp|₱/);
assert.match(experience, /Pricing will be announced after beta testing\./);
assert.match(experience, /Beta access active\./);

assert.match(examinations, /operation: 'subject_catalog'/);
assert.match(examinations, /operation: 'subject_next'/);
assert.match(examinations, /operation: 'subject_performance'/);
assert.match(examinations, /data-submit-current/);
assert.match(examinations, /Next Random Question/);
assert.match(forum, /create_simple_entry/);
assert.match(forum, /set_affirm/);
assert.match(forum, /affirm_roster/);
assert.match(worker, /\/admin\/content\/sync/);
assert.match(worker, /PUBLIC_PRICING_ENABLED/);
assert.match(migration, /alter table public\.forum_posts force row level security;/);
assert.match(
  migration,
  /revoke all on table[\s\S]*public\.forum_posts[\s\S]*from public, anon, authenticated;/,
);
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
  mockBarRows: mockBar.rows.length,
  mockBarSubjects: mockBar.counts,
  barFeelsDestinations: manifest.length,
  barFeelsAssignments: assignments.length,
}, null, 2));
