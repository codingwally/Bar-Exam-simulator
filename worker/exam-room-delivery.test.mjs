import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deliverExamRoomEmail,
  processExamRoomDeliveryQueues,
  syncGoogleBackupEvent,
} from './exam-room-delivery.mjs';

function response(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const event = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  exam_id: '22222222-2222-4222-8222-222222222222',
  sequence_number: 1,
  event_type: 'exam_confirmed',
  content_hash: 'a'.repeat(64),
  created_at: '2026-08-04T00:00:00Z',
  payload: {
    sourceFileName: '=unsafe.docx',
    sourceHash: 'b'.repeat(64),
    snapshotHash: 'c'.repeat(64),
    questions: [{ ordinal: 1, prompt: '=2+2', maximumPoints: 5 }],
  },
});

const context = Object.freeze({
  examPublicId: '33333333-3333-4333-8333-333333333333',
  title: 'Staging Examination',
  status: 'confirmed',
  schoolName: 'Test School',
  academicTerm: '2026',
  professorEmail: 'professor@example.test',
  questionCount: 1,
});

test('Google backup creates one least-privilege isolated workbook, writes RAW-safe cells, and verifies the event', async () => {
  const calls = [];
  let syncReads = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) return response({ access_token: 'ephemeral-token' });
    if (String(url).includes('/drive/v3/files?')) return response({ files: [] });
    if (String(url).includes('/v4/spreadsheets?fields=spreadsheetId')) return response({
      spreadsheetId: 'sheet-123',
      sheets: ['README', 'Exam Registry', 'Questions', 'Submissions', 'Grades', 'Sync Log']
        .map((title, index) => ({ properties: { title, sheetId: index } })),
    });
    if (String(url).includes('/drive/v3/files/sheet-123') && options.method === 'PATCH') {
      return response({ id: 'sheet-123', name: 'DueDiligence Exam' });
    }
    if (String(url).includes('/permissions') && options.method === 'POST') return response({ id: 'permission-1' });
    if (String(url).includes('/values/%27Sync%20Log%27')) {
      syncReads += 1;
      return response({ values: syncReads === 1 ? [] : [[event.id, context.examPublicId, '1', event.event_type, event.content_hash]] });
    }
    if (String(url).includes('?fields=sheets.properties')) return response({
      sheets: ['Exam Registry', 'Questions', 'Submissions', 'Grades', 'Sync Log']
        .map((title, index) => ({ properties: { title, sheetId: index + 1 } })),
    });
    if (String(url).includes(':batchUpdate')) return response({ replies: [] });
    throw new Error(`Unexpected URL ${url}`);
  };
  const result = await syncGoogleBackupEvent({
    GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
  }, event, context, fetchImpl);
  assert.equal(result.spreadsheetId, 'sheet-123');
  assert.equal(result.verifiedHash, event.content_hash);
  const writes = calls.filter((call) => call.url.includes(':batchUpdate'));
  assert.equal(writes.length, 2, 'Workbook initialization and event append must be separate verified writes.');
  const write = writes[1];
  const body = JSON.parse(write.options.body);
  const serialized = JSON.stringify(body);
  assert.match(serialized, /'=2\+2/);
  assert.match(serialized, /'=unsafe\.docx/);
  assert.doesNotMatch(serialized, /formulaValue/);
  const createCall = calls.find((call) => call.url.includes('/v4/spreadsheets?fields=spreadsheetId'));
  const createBody = JSON.parse(createCall.options.body);
  assert.deepEqual(createBody.sheets.map((sheet) => sheet.properties.title), [
    'README', 'Exam Registry', 'Questions', 'Submissions', 'Grades', 'Sync Log',
  ]);
  assert.equal(calls.some((call) => call.url.includes('/copy')), false,
    'Backup must not request broad access to copy an unrelated Drive file.');
});

test('Google outage never throws past the queue and records a bounded retry failure', async () => {
  const calls = [];
  const rpc = async (_env, name) => {
    calls.push(name);
    if (name === 'exam_room_auto_submit_due') return { autoSubmitted: 2 };
    if (name === 'dd2026_service_flag_enabled') return true;
    if (name === 'exam_room_claim_backup_batch') return [event];
    if (name === 'exam_room_backup_context') return context;
    if (name === 'exam_room_fail_backup') return { ok: true };
    if (name === 'exam_room_claim_email_batch') return [];
    throw new Error(`Unexpected RPC ${name}`);
  };
  const result = await processExamRoomDeliveryQueues({ EXAM_GOOGLE_BACKUP_ENABLED: 'true' }, {
    rpc,
    fetchImpl: async () => response({ error: 'unavailable' }, 503),
  });
  assert.equal(result.backupFailed, 1);
  assert.equal(result.autoSubmitted, 2);
  assert.equal(result.autoSubmitFailed, 0);
  assert.equal(result.emailClaimed, 0);
  assert.ok(calls.includes('exam_room_fail_backup'));
});

test('auto-submit failure is visible without blocking independent delivery queues', async () => {
  const calls = [];
  const rpc = async (_env, name) => {
    calls.push(name);
    if (name === 'exam_room_auto_submit_due') throw new Error('temporary database outage');
    if (name === 'dd2026_service_flag_enabled') return false;
    if (name === 'exam_room_claim_email_batch') return [];
    throw new Error(`Unexpected RPC ${name}`);
  };
  const result = await processExamRoomDeliveryQueues({ EXAM_GOOGLE_BACKUP_ENABLED: 'true' }, { rpc });
  assert.equal(result.autoSubmitted, 0);
  assert.equal(result.autoSubmitFailed, 1);
  assert.equal(result.emailClaimed, 0);
  assert.ok(calls.includes('exam_room_claim_email_batch'));
});

test('suppressed staging email completes without provider traffic', async () => {
  let fetchCount = 0;
  const result = await deliverExamRoomEmail({ EXAMINATION_EMAIL_MODE: 'suppressed' }, {
    id: 'job-1', email_type: 'student_result', recipient_email: 'student@example.test', payload: {},
  }, async () => { fetchCount += 1; return response({}); });
  assert.equal(result.providerId, 'suppressed:job-1');
  assert.equal(fetchCount, 0);
});

test('enabled email uses one idempotent Resend request and returns only provider id', async () => {
  let captured;
  const result = await deliverExamRoomEmail({
    EXAMINATION_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  }, {
    id: 'job-2', email_type: 'professor_release_summary', recipient_email: 'professor@example.test',
    payload: { examId: context.examPublicId, title: context.title, expected: 1, started: 1, submitted: 1 },
  }, async (url, options) => { captured = { url: String(url), options }; return response({ id: 'resend-123' }); });
  assert.deepEqual(result, { providerId: 'resend-123' });
  assert.equal(captured.options.headers['Idempotency-Key'], 'exam-room-job-2');
  assert.equal(JSON.parse(captured.options.body).to[0], 'professor@example.test');
});
