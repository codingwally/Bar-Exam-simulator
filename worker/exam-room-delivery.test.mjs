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
  assert.equal(calls.some((call) => call.url.includes('/permissions')), false,
    'A new protected backup must never be shared directly with the Professor.');
  assert.equal(result.professorAccessRemoved, true);
  assert.match(JSON.stringify(JSON.parse(writes[0].options.body)), /not shared with the Professor/);
});

test('a revised Professor question version is written to the Questions backup before verification', async () => {
  const revisedEvent = {
    ...event,
    id: '44444444-4444-4444-8444-444444444444',
    sequence_number: 2,
    event_type: 'exam_questions_revised',
    content_hash: 'd'.repeat(64),
    payload: {
      sourceFileName: 'Professor workspace revision',
      sourceHash: 'e'.repeat(64),
      snapshotHash: 'f'.repeat(64),
      questions: [
        { ordinal: 1, prompt: 'Revised question text', maximumPoints: 10 },
        { ordinal: 2, prompt: 'Repeated review is allowed', maximumPoints: 5 },
      ],
    },
  };
  const calls = [];
  let syncReads = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) return response({ access_token: 'ephemeral-token' });
    if (String(url).includes('/values/%27Sync%20Log%27')) {
      syncReads += 1;
      return response({ values: syncReads === 1 ? [] : [[
        revisedEvent.id, context.examPublicId, '2', revisedEvent.event_type,
        revisedEvent.content_hash,
      ]] });
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
  }, revisedEvent, {
    ...context,
    googleSheetId: 'existing-sheet-123',
    professorAccessRemovedAt: '2026-08-10T00:00:00Z',
  }, fetchImpl);
  assert.equal(result.verifiedHash, revisedEvent.content_hash);
  const write = calls.find((call) => call.url.includes(':batchUpdate'));
  assert.ok(write, 'the revised event must append rows before it can be marked verified');
  const body = JSON.parse(write.options.body);
  const questionsWrite = body.requests.find((request) => request.appendCells.sheetId === 2);
  assert.ok(questionsWrite, 'the revised event must target the Questions sheet');
  const serialized = JSON.stringify(questionsWrite);
  assert.match(serialized, /Revised question text/);
  assert.match(serialized, /Repeated review is allowed/);
  assert.match(serialized, /exam_questions_revised/);
});

test('rapid A to B to A schedule changes retain immutable event schedules and reasons', async () => {
  const scheduleEvents = [
    {
      ...event,
      id: '55555555-5555-4555-8555-555555555555',
      sequence_number: 3,
      event_type: 'exam_schedule_changed',
      content_hash: '1'.repeat(64),
      payload: {
        examId: context.examPublicId,
        title: 'Immutable Schedule Examination',
        previousPublicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        publicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        publicationNumber: 2,
        previousOpensAt: '2026-08-10T01:00:00Z',
        previousHardClosesAt: '2026-08-10T03:00:00Z',
        opensAt: '2026-08-11T02:00:00Z',
        hardClosesAt: '2026-08-11T05:00:00Z',
        durationMinutes: 180,
        lateAdmissionMinutes: 15,
        submissionGraceMinutes: 5,
        reason: '=Move to the approved make-up schedule',
      },
    },
    {
      ...event,
      id: '66666666-6666-4666-8666-666666666666',
      sequence_number: 4,
      event_type: 'exam_schedule_changed',
      content_hash: '2'.repeat(64),
      payload: {
        examId: context.examPublicId,
        title: 'Immutable Schedule Examination',
        previousPublicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        publicationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        publicationNumber: 3,
        previousOpensAt: '2026-08-11T02:00:00Z',
        previousHardClosesAt: '2026-08-11T05:00:00Z',
        opensAt: '2026-08-10T01:00:00Z',
        hardClosesAt: '2026-08-10T03:00:00Z',
        durationMinutes: 120,
        lateAdmissionMinutes: 10,
        submissionGraceMinutes: 3,
        reason: 'Return to the original approved schedule',
      },
    },
  ];
  const mutableFinalContext = {
    ...context,
    googleSheetId: 'existing-sheet-123',
    professorAccessRemovedAt: '2026-08-10T00:00:00Z',
    title: 'MUTABLE CURRENT TITLE MUST NOT REPLACE EVENT TITLE',
    status: 'closed',
    opensAt: '2099-01-01T00:00:00Z',
    hardClosesAt: '2099-01-01T23:59:00Z',
    durationMinutes: 999,
  };
  const writes = [];
  let syncReads = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('oauth2.googleapis.com')) return response({ access_token: 'ephemeral-token' });
    if (String(url).includes('/values/%27Sync%20Log%27')) {
      const scheduleEvent = scheduleEvents[Math.floor(syncReads / 2)];
      const isVerification = syncReads % 2 === 1;
      syncReads += 1;
      return response({
        values: isVerification
          ? [[scheduleEvent.id, context.examPublicId, String(scheduleEvent.sequence_number),
            scheduleEvent.event_type, scheduleEvent.content_hash]]
          : [],
      });
    }
    if (String(url).includes('?fields=sheets.properties')) return response({
      sheets: ['Exam Registry', 'Questions', 'Submissions', 'Grades', 'Sync Log']
        .map((title, index) => ({ properties: { title, sheetId: index + 1 } })),
    });
    if (String(url).includes(':batchUpdate')) {
      writes.push(JSON.parse(options.body));
      return response({ replies: [] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  for (const scheduleEvent of scheduleEvents) {
    await syncGoogleBackupEvent({
      GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
      GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
    }, scheduleEvent, mutableFinalContext, fetchImpl);
  }

  assert.equal(writes.length, 2);
  const stringValues = (appendCells) => appendCells.rows[0].values
    .map((cell) => cell.userEnteredValue.stringValue);
  const registryRows = writes.map((write) => stringValues(
    write.requests.find((request) => request.appendCells.sheetId === 1).appendCells,
  ));
  assert.deepEqual(registryRows.map((values) => values.slice(9, 12)), [
    ['2026-08-11T02:00:00Z', '2026-08-11T05:00:00Z', '180'],
    ['2026-08-10T01:00:00Z', '2026-08-10T03:00:00Z', '120'],
  ]);
  assert.equal(registryRows.every((values) => values[5] === 'Immutable Schedule Examination'), true);
  assert.equal(JSON.stringify(registryRows).includes('2099-01-01'), false,
    'Registry schedule fields must not be copied from mutable current context.');

  const syncStatuses = writes.map((write) => {
    const values = stringValues(
      write.requests.find((request) => request.appendCells.sheetId === 5).appendCells,
    );
    return JSON.parse(values[7]);
  });
  assert.deepEqual(syncStatuses.map((status) => status.scheduleChange), scheduleEvents.map((entry) => ({
    previousPublicationId: entry.payload.previousPublicationId,
    publicationId: entry.payload.publicationId,
    publicationNumber: entry.payload.publicationNumber,
    previousOpensAt: entry.payload.previousOpensAt,
    previousHardClosesAt: entry.payload.previousHardClosesAt,
    opensAt: entry.payload.opensAt,
    hardClosesAt: entry.payload.hardClosesAt,
    durationMinutes: String(entry.payload.durationMinutes),
    lateAdmissionMinutes: String(entry.payload.lateAdmissionMinutes),
    submissionGraceMinutes: String(entry.payload.submissionGraceMinutes),
    reason: entry.payload.reason,
  })));
  assert.equal(syncStatuses.every((status) => status.status === 'SYNCED'), true);
  assert.equal(syncStatuses.every((status) => status.event === 'exam_schedule_changed'), true);
});

test('Google backup recovery revokes legacy Professor access before syncing protected data', async () => {
  const calls = [];
  let syncReads = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) return response({ access_token: 'ephemeral-token' });
    if (String(url).includes('/drive/v3/files?')) return response({
      files: [{ id: 'orphan-sheet-123', name: 'Recovered staging backup' }],
    });
    if (String(url).includes('/permissions?') && !options.method) {
      return response({ permissions: [
        { id: 'owner-1', emailAddress: 'backup-admin@example.test', role: 'owner', type: 'user' },
        { id: 'professor-writer-1', emailAddress: context.professorEmail, role: 'writer', type: 'user' },
        { id: 'review-admin-1', emailAddress: 'review@example.test', role: 'reader', type: 'user' },
      ] });
    }
    if (String(url).includes('/permissions/professor-writer-1') && options.method === 'DELETE') {
      return response(null, 204);
    }
    if (String(url).includes('/values/%27Sync%20Log%27')) {
      syncReads += 1;
      return response({
        values: syncReads === 1
          ? []
          : [[event.id, context.examPublicId, '1', event.event_type, event.content_hash]],
      });
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
  assert.equal(result.spreadsheetId, 'orphan-sheet-123');
  assert.equal(result.professorAccessRemoved, true);
  assert.equal(calls.some((call) => call.url.includes('/permissions') && call.options.method === 'POST'), false);
  assert.equal(calls.some((call) => call.url.includes('/permissions/professor-writer-1')
    && call.options.method === 'DELETE'), true);
  assert.equal(calls.some((call) => call.url.includes('/permissions/review-admin-1')), false,
    'The cleanup must preserve unrelated sealed-dispute/admin access.');
  assert.equal(calls.some((call) => call.url.includes('/v4/spreadsheets?fields=spreadsheetId')), false,
    'Recovery must not create a duplicate workbook.');
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

test('replacement and reopening notices are bounded, idempotent, and contain no questions, answers, or credentials', async () => {
  const cases = [
    {
      id: 'replacement-job',
      email_type: 'exam_publication_replaced',
      payload: {
        examId: context.examPublicId,
        title: context.title,
        publicationNumber: 2,
        studentKey: 'must-not-send',
        questions: ['must-not-send'],
      },
      expected: /official class channel/i,
      forbidden: /current questions|must-not-send/i,
    },
    {
      id: 'reopen-job',
      email_type: 'submission_reopened',
      payload: {
        examId: context.examPublicId,
        title: context.title,
        generation: 2,
        newDeadline: '2026-08-10T05:00:00Z',
        answerSnapshot: 'must-not-send',
        gradingKey: 'must-not-send',
      },
      expected: /new server deadline/i,
      forbidden: /must-not-send/i,
    },
  ];
  for (const entry of cases) {
    let captured;
    await deliverExamRoomEmail({
      EXAMINATION_EMAIL_MODE: 'enabled',
      RESEND_API_KEY: 'server-secret',
      EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
    }, {
      id: entry.id,
      email_type: entry.email_type,
      recipient_email: 'student@example.test',
      payload: entry.payload,
    }, async (_url, options) => {
      captured = JSON.parse(options.body);
      assert.equal(options.headers['Idempotency-Key'], `exam-room-${entry.id}`);
      return response({ id: `resend-${entry.id}` });
    });
    assert.match(captured.text, entry.expected);
    assert.doesNotMatch(captured.text, entry.forbidden);
    assert.equal(captured.to[0], 'student@example.test');
  }
});
