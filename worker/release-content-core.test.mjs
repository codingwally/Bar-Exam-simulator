import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import { parseCsv } from './examiner-core.mjs';
import {
  BAR_FEELS_DESTINATIONS,
  MOCK_BAR_SUBJECTS,
  SUBJECT_MATTER_CSV_URL,
  WEBSITE_UPLOAD_CSV_URL,
  WEBSITE_VISIBILITY_CSV_URL,
  buildBarFeelsManifest,
  buildSubjectMatterPlacements,
  parseSubjectMatterSource,
  parseWebsiteUploadSource,
  sheetValuesToCsv,
  subjectMatterReleaseSnapshotCsv,
} from './release-content-core.mjs';
import {
  SUBJECT_MATTER_COURSES,
  SUBJECT_MATTER_EXPECTED,
  SUBJECT_MATTER_PLACEMENTS,
  SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256,
} from './subject-matter-placement-manifest.mjs';
import { SUBJECT_MATTER_RELEASE_SNAPSHOT } from './subject-matter-release-snapshot.mjs';

const headers = [
  'Question ID',
  'Subject',
  'Topic',
  'Bar Year',
  'Question No.',
  'Essay Question',
  'Suggested Answer',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Source URL',
  'Difficulty',
  'Editorial Status',
  'Version',
  'Assigned Reviewer',
  'Last Reviewed',
  'Publication Ready?',
  'Notes',
  'Feedback Count',
  'Open Feedback',
];

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\r\n');
}

function sourceRow({
  id,
  subject,
  status = 'Approved',
  ready = 'Yes',
  number = '1',
}) {
  return {
    'Question ID': id,
    Subject: subject,
    Topic: 'Year 1 Term 1 LAW101 · Legal foundations',
    'Bar Year': '2026',
    'Question No.': number,
    'Essay Question': `First paragraph for ${id}.\n\nSecond paragraph asks the legal question?`,
    'Suggested Answer': [
      'I. ANSWER: Yes.',
      'II. LEGAL BASIS: The controlling statute and doctrine apply.',
      'III. APPLICATION: The stated facts satisfy the statutory elements.',
      'IV. CONCLUSION: Therefore, the requested relief should be granted.',
    ].join('\n\n'),
    'Legal Basis / Provision':
      'Section 1. https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904',
    'Controlling Doctrine': 'A court awards only the relief supported by law and the record.',
    'Jurisprudence / Case': 'Synthetic Contract Case',
    'Citation / G.R. No.': 'G.R. No. 000001',
    'Source URL': 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904',
    Difficulty: 'Intermediate',
    'Editorial Status': status,
    Version: '1',
    'Assigned Reviewer': 'Editorial Board',
    'Last Reviewed': '2026-07-30',
    'Publication Ready?': ready,
    Notes: status === 'Approved' ? 'Approved.' : 'Owner-directed publication override.',
    'Feedback Count': '0',
    'Open Feedback': '0',
  };
}

function subjectRows() {
  const courseByCode = new Map(SUBJECT_MATTER_COURSES.map((course) => [course.code, course]));
  const directById = new Map(
    SUBJECT_MATTER_PLACEMENTS
      .filter((placement) => placement[5] === 'direct')
      .map((placement) => [placement[2], placement]),
  );
  const rows = [...directById.entries()].map(([id, placement], index) => sourceRow({
    id,
    subject: courseByCode.get(placement[0]).name,
    number: String(index + 1),
  }));
  while (rows.length < SUBJECT_MATTER_EXPECTED.destinationRows) {
    rows.push(sourceRow({
      id: `LEB-PRESERVED-UNMAPPED-${String(rows.length + 1).padStart(4, '0')}`,
      subject: 'Preserved Canonical Content',
      number: String(rows.length + 1),
    }));
  }
  rows.at(-1)['Editorial Status'] = 'For Review';
  rows.at(-1)['Publication Ready?'] = 'No';
  return rows;
}

test('authenticated Sheet values preserve commas, quotation marks, and paragraph breaks', () => {
  const values = [
    ['Question ID', 'Essay Question', 'Suggested Answer'],
    ['LAW-001', 'First paragraph.\n\nSecond paragraph, with a comma.', 'The court said "Yes."'],
  ];
  const encoded = sheetValuesToCsv(values);
  assert.deepEqual(parseCsv(encoded), values);
});

test('versioned Subject Matter release snapshot is complete and parser-valid', async () => {
  const source = await parseSubjectMatterSource(subjectMatterReleaseSnapshotCsv());
  assert.equal(source.rows.length, 1622);
  assert.equal(source.rows[0].sheetRow, 2);
  assert.equal(source.rows.at(-1).sheetRow, 1623);
  assert.equal(new Set(source.rows.map((row) => row.questionId)).size, 1622);
  assert.equal(source.digest.toUpperCase(), SUBJECT_MATTER_RELEASE_SNAPSHOT.csvSha256);
});

function websiteRows() {
  return MOCK_BAR_SUBJECTS.flatMap((subject, subjectIndex) => (
    Array.from({ length: 40 }, (_, index) => sourceRow({
      id: `WEB-${String(subjectIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
      subject,
      number: String(index + 1),
    }))
  ));
}

test('Subject Matter publication source is pinned to the reviewed 1,622-row boundary', () => {
  assert.equal(new URL(SUBJECT_MATTER_CSV_URL).searchParams.get('range'), 'A1:U1623');
});

test('Subject Matter import preserves all 1,622 canonical rows including owner overrides', async () => {
  const parsed = await parseSubjectMatterSource(csv(subjectRows()));
  assert.equal(parsed.rows.length, 1622);
  assert.equal(parsed.subjectCount, 35);
  assert.equal(parsed.rows.at(-1).editorialStatus, 'For Review');
  assert.equal(parsed.rows.at(-1).publicationReady, 'No');
  assert.match(parsed.rows[0].prompt, /\n\nSecond paragraph/);
  assert.equal(parsed.rows[0].alac.answer, 'Yes.');
  assert.equal(parsed.rows[0].sourceUrls[0].url,
    'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904');
});

test('Subject Matter placement manifest is exact, deterministic, and source-complete', async () => {
  const parsed = await parseSubjectMatterSource(csv(subjectRows()));
  const manifest = buildSubjectMatterPlacements(parsed.rows);
  assert.equal(manifest.digest, SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256);
  assert.equal(manifest.courses.length, 42);
  assert.equal(manifest.placements.length, 1890);
  assert.equal(manifest.placements.filter((row) => row.placementType === 'direct').length, 1490);
  assert.equal(manifest.placements.filter((row) => row.placementType === 'integration').length, 400);
  assert.equal(new Set(manifest.placements.map((row) => row.questionId)).size, 1490);
  assert.equal(new Set(manifest.placements.map((row) => `${row.courseCode}:${row.slot}`)).size, 1890);
});

test('Mock Bar import and Bar Feels manifest are exact, unique, and deterministic', async () => {
  const parsed = await parseWebsiteUploadSource(csv(websiteRows()));
  const first = buildBarFeelsManifest(parsed.rows);
  const second = buildBarFeelsManifest(parsed.rows);
  const assignments = first.flatMap((group) => group.rows.map((row) => ({
    destination: group.destination,
    sourceQuestionId: row.questionId,
  })));
  assert.equal(parsed.rows.length, 320);
  assert.equal(first.length, 6);
  assert.equal(assignments.length, 120);
  assert.deepEqual(first, second);
  assert.equal(new Set(assignments.map((row) => row.sourceQuestionId)).size, 120);
  assert.deepEqual(
    first.map((row) => row.destination),
    BAR_FEELS_DESTINATIONS.map((group) => group.destination),
  );
  for (const group of BAR_FEELS_DESTINATIONS) {
    assert.equal(
      assignments.filter((row) => row.destination === group.destination).length,
      20,
    );
  }
});

test('Mock Bar import safely accepts a growing, strategically distributed inventory', async () => {
  const extraBySubject = [6, 6, 6, 5, 5, 6, 5, 3];
  const expandedRows = websiteRows();
  for (const [subjectIndex, extra] of extraBySubject.entries()) {
    for (let index = 0; index < extra; index += 1) {
      expandedRows.push(sourceRow({
        id: `EXP-${String(subjectIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
        subject: MOCK_BAR_SUBJECTS[subjectIndex],
        number: String(41 + index),
      }));
    }
  }

  const parsed = await parseWebsiteUploadSource(csv(expandedRows));
  assert.equal(parsed.rows.length, 362);
  assert.deepEqual(
    MOCK_BAR_SUBJECTS.map((subject) => parsed.counts[subject]),
    extraBySubject.map((extra) => 40 + extra),
  );
});

test('release sync uses the versioned snapshot when the Google source is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const websiteCsv = csv(websiteRows());
  const visibilityCsv = [
    'Question ID,Publication Ready?',
    ...websiteRows().map((row) => `${row['Question ID']},${row['Publication Ready?']}`),
  ].join('\r\n');
  let syncBody;
  const stagedBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'reviewer@example.test',
      });
    }
    if (target === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'ephemeral-test-token' });
    }
    if (target.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
      return Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 });
    }
    if (target === WEBSITE_UPLOAD_CSV_URL) {
      return new Response(websiteCsv, { headers: { 'Content-Type': 'text/csv' } });
    }
    if (target === WEBSITE_VISIBILITY_CSV_URL) {
      return new Response(visibilityCsv, { headers: { 'Content-Type': 'text/csv' } });
    }
    if (target.endsWith('/rest/v1/rpc/release_stage_subject_matter_v2')) {
      stagedBodies.push(JSON.parse(options.body));
      return Response.json({ accepted: JSON.parse(options.body).p_payload.length });
    }
    if (target.endsWith('/rest/v1/rpc/release_finalize_all_content_v2')) {
      syncBody = JSON.parse(options.body);
      return Response.json({
        subjectMatter: { rows: 1622, courses: 42, placements: 1890 },
        barFeels: { rows: 120, destinations: 6 },
      });
    }
    throw new Error(`Unexpected release-sync request: ${target}`);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/admin/content/sync', {
        method: 'POST',
        headers: {
          Origin: 'https://duediligence.ph',
          Authorization: 'Bearer verified-admin-session',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.214',
        },
        body: '{}',
      }),
      {
        ALLOWED_ORIGIN: 'https://duediligence.ph',
        GUEST_USAGE_HMAC_KEY: 'test-only-rate-key',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
        GOOGLE_OAUTH_REFRESH_TOKEN: 'test-refresh-token',
      },
    );
    const raw = await response.text();
    const payload = JSON.parse(raw);
    assert.equal(response.status, 200);
    assert.equal(payload.data.subjectMatter.rows, 1622);
    assert.equal(payload.data.barFeels.rows, 120);
    assert.equal(stagedBodies.length, 27);
    assert.equal(
      stagedBodies.filter((body) => body.p_payload_kind === 'rows')
        .reduce((count, body) => count + body.p_payload.length, 0),
      1622,
    );
    assert.equal(
      stagedBodies.filter((body) => body.p_payload_kind === 'placements')
        .reduce((count, body) => count + body.p_payload.length, 0),
      1890,
    );
    assert.ok(stagedBodies.every((body) => body.p_sync_id === syncBody.p_sync_id));
    assert.ok(stagedBodies.every((body) => (
      body.p_placement_digest === SUBJECT_MATTER_PLACEMENT_MANIFEST_SHA256
    )));
    assert.equal(syncBody.p_bar_groups.length, 6);
    assert.equal(
      syncBody.p_bar_groups.reduce((count, group) => count + group.rows.length, 0),
      120,
    );
    assert.equal(
      stagedBodies.filter((body) => body.p_payload_kind === 'rows').at(-1).p_payload.at(-1)
        .editorialStatus,
      'Source Review',
    );
    assert.doesNotMatch(raw, /First paragraph|Legal Basis|studentAnswer/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
