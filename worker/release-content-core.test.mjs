import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  BAR_FEELS_DESTINATIONS,
  MOCK_BAR_SUBJECTS,
  SUBJECT_MATTER_CSV_URL,
  WEBSITE_UPLOAD_CSV_URL,
  buildBarFeelsManifest,
  parseSubjectMatterSource,
  parseWebsiteUploadSource,
} from './release-content-core.mjs';

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
  const rows = [];
  for (let subjectIndex = 0; subjectIndex < 24; subjectIndex += 1) {
    const count = subjectIndex < 16 ? 26 : 25;
    for (let index = 0; index < count; index += 1) {
      const sequence = String(rows.length + 1).padStart(3, '0');
      rows.push(sourceRow({
        id: `LEB-Y1T1-S${String(subjectIndex + 1).padStart(2, '0')}-${sequence}`,
        subject: `Subject ${String(subjectIndex + 1).padStart(2, '0')}`,
        status: rows.length === 615 ? 'For Review' : 'Approved',
        ready: rows.length === 615 ? 'No' : 'Yes',
        number: String(index + 1),
      }));
    }
  }
  return rows;
}

function websiteRows() {
  return MOCK_BAR_SUBJECTS.flatMap((subject, subjectIndex) => (
    Array.from({ length: 40 }, (_, index) => sourceRow({
      id: `WEB-${String(subjectIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
      subject,
      number: String(index + 1),
    }))
  ));
}

test('Subject Matter publication source is pinned to the reviewed 616-row boundary', () => {
  assert.equal(new URL(SUBJECT_MATTER_CSV_URL).searchParams.get('range'), 'A1:U617');
});

test('Subject Matter import preserves all 616 complete rows including owner overrides', async () => {
  const parsed = await parseSubjectMatterSource(csv(subjectRows()));
  assert.equal(parsed.rows.length, 616);
  assert.equal(parsed.subjectCount, 24);
  assert.equal(parsed.rows.at(-1).editorialStatus, 'For Review');
  assert.equal(parsed.rows.at(-1).publicationReady, 'No');
  assert.match(parsed.rows[0].prompt, /\n\nSecond paragraph/);
  assert.equal(parsed.rows[0].alac.answer, 'Yes.');
  assert.equal(parsed.rows[0].sourceUrls[0].url,
    'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904');
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

test('release sync route validates both published sources and sends only bounded reviewed records', async () => {
  const originalFetch = globalThis.fetch;
  const subjectCsv = csv(subjectRows());
  const websiteCsv = csv(websiteRows());
  let syncBody;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'reviewer@example.test',
      });
    }
    if (target === SUBJECT_MATTER_CSV_URL) {
      return new Response(subjectCsv, { headers: { 'Content-Type': 'text/csv' } });
    }
    if (target === WEBSITE_UPLOAD_CSV_URL) {
      return new Response(websiteCsv, { headers: { 'Content-Type': 'text/csv' } });
    }
    if (target.endsWith('/rest/v1/rpc/release_sync_all_content')) {
      syncBody = JSON.parse(options.body);
      return Response.json({
        subjectMatter: { rows: 616, subjects: 24 },
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
      },
    );
    const raw = await response.text();
    const payload = JSON.parse(raw);
    assert.equal(response.status, 200);
    assert.equal(payload.data.subjectMatter.rows, 616);
    assert.equal(payload.data.barFeels.rows, 120);
    assert.equal(syncBody.p_subject_rows.length, 616);
    assert.equal(syncBody.p_bar_groups.length, 6);
    assert.equal(
      syncBody.p_bar_groups.reduce((count, group) => count + group.rows.length, 0),
      120,
    );
    assert.equal(syncBody.p_subject_rows.at(-1).editorialStatus, 'For Review');
    assert.doesNotMatch(raw, /First paragraph|Legal Basis|studentAnswer/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
