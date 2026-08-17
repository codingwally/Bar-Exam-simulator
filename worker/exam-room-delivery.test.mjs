import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deliverExamRoomEmail,
  processExamRoomDeliveryQueues,
  syncGoogleBackupEvent,
  verifyResendWebhookRequest,
} from './exam-room-delivery.mjs';
import { encryptStudentExamCode } from './exam-room-student-code-envelope.mjs';

function response(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function examinationEmailEnv(mode = 'enabled') {
  return {
    OUTBOUND_EMAIL_MODE: 'suppressed',
    EXAMINATION_ROOM_EMAIL_MODE: mode,
    RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  };
}

function assertProfessionalExamRoomEmail(body, emailType) {
  assert.equal(typeof body.text, 'string', `${emailType} must include plain text`);
  assert.ok(body.text.trim(), `${emailType} plain text must not be empty`);
  assert.equal(typeof body.html, 'string', `${emailType} must include HTML`);
  assert.match(body.html, /<!doctype html>/i, `${emailType} must use the shared document shell`);
  assert.match(body.html, /<meta name="viewport"/i, `${emailType} must declare a mobile viewport`);
  assert.match(body.html, /@media only screen and \(max-width: 640px\)/i, `${emailType} must include the mobile layout`);
  assert.match(body.html, /Due Diligence Examination Room/, `${emailType} must be branded`);
  assert.equal((body.html.match(/<a\b/gi) || []).length, 1, `${emailType} must have one CTA`);
  assert.equal(
    (body.text.match(/https:\/\/duediligence\.ph\/#examination-room/g) || []).length,
    1,
    `${emailType} plain text must have one portal action`,
  );
  const rendered = `${body.subject}\n${body.text}\n${body.html}`;
  assert.doesNotMatch(rendered, /\b(?:undefined|null)\b|\[object Object\]|\?exam=(?:["'\s]|$)/i);
  assert.doesNotMatch(rendered, /raw-attempt-id|raw-receipt-id|raw-snapshot-hash|raw-token-hash/);
}

async function signedWebhookRequest(event, {
  eventId = 'msg_webhook_test_001',
  timestamp = 1_786_477_200,
  secretBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1),
} = {}) {
  const secretBody = Buffer.from(secretBytes).toString('base64');
  const secret = `whsec_${secretBody}`;
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${eventId}.${timestamp}.${body}`),
  )).toString('base64');
  return {
    secret,
    request: new Request('https://worker.example/webhooks/resend/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': eventId,
        'svix-timestamp': String(timestamp),
        'svix-signature': `v1,${signature}`,
      },
      body,
    }),
    timestamp,
  };
}

test('Resend delivery webhook accepts only a fresh valid signature and returns bounded fields', async () => {
  const signed = await signedWebhookRequest({
    type: 'email.delivered',
    created_at: '2026-08-12T04:20:00.000Z',
    data: {
      email_id: 'resend_student_result_123',
      to: ['student-private@example.test'],
      subject: 'must-not-be-returned',
    },
  });
  const result = await verifyResendWebhookRequest(
    signed.request,
    { RESEND_WEBHOOK_SECRET: signed.secret },
    signed.timestamp,
  );
  assert.deepEqual(result, {
    providerId: 'resend_student_result_123',
    providerEventId: 'msg_webhook_test_001',
    providerEventType: 'email.delivered',
    providerEventAt: '2026-08-12T04:20:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(result), /student-private|must-not-be-returned/);
});

test('Resend delivery webhook rejects tampered and stale requests', async () => {
  const event = {
    type: 'email.delivered',
    created_at: '2026-08-12T04:20:00.000Z',
    data: { email_id: 'resend_student_result_456' },
  };
  const signed = await signedWebhookRequest(event);
  const tampered = new Request(signed.request.url, {
    method: 'POST',
    headers: signed.request.headers,
    body: JSON.stringify({ ...event, type: 'email.bounced' }),
  });
  await assert.rejects(
    verifyResendWebhookRequest(tampered, { RESEND_WEBHOOK_SECRET: signed.secret }, signed.timestamp),
    /signature is invalid/,
  );
  const stale = await signedWebhookRequest(event, { eventId: 'msg_webhook_test_002' });
  await assert.rejects(
    verifyResendWebhookRequest(stale.request, { RESEND_WEBHOOK_SECRET: stale.secret }, stale.timestamp + 301),
    /could not be verified/,
  );
});

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
    if (name === 'exam_room_claim_backup_batch_v2') return [{ ...event, claim_token: 'backup-claim-token' }];
    if (name === 'exam_room_backup_context') return context;
    if (name === 'exam_room_fail_backup_v2') return { ok: true };
    if (name === 'exam_room_claim_email_batch_v2') return [];
    throw new Error(`Unexpected RPC ${name}`);
  };
  const result = await processExamRoomDeliveryQueues({
    EXAM_GOOGLE_BACKUP_ENABLED: 'true',
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
  }, {
    rpc,
    fetchImpl: async () => response({ error: 'unavailable' }, 503),
  });
  assert.equal(result.backupFailed, 1);
  assert.equal(result.autoSubmitted, 2);
  assert.equal(result.autoSubmitFailed, 0);
  assert.equal(result.emailClaimed, 0);
  assert.ok(calls.includes('exam_room_fail_backup_v2'));
});

test('auto-submit failure is visible without blocking independent delivery queues', async () => {
  const calls = [];
  const rpc = async (_env, name) => {
    calls.push(name);
    if (name === 'exam_room_auto_submit_due') throw new Error('temporary database outage');
    if (name === 'dd2026_service_flag_enabled') return false;
    if (name === 'exam_room_claim_email_batch_v2') return [];
    throw new Error(`Unexpected RPC ${name}`);
  };
  const result = await processExamRoomDeliveryQueues({
    OUTBOUND_EMAIL_MODE: 'enabled',
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    EXAM_GOOGLE_BACKUP_ENABLED: 'true',
  }, { rpc });
  assert.equal(result.autoSubmitted, 0);
  assert.equal(result.autoSubmitFailed, 1);
  assert.equal(result.emailClaimed, 0);
  assert.ok(calls.includes('exam_room_claim_email_batch_v2'));
});

test('explicitly suppressed Examination Room mode remains zero-provider-traffic', async () => {
  let fetchCount = 0;
  const result = await deliverExamRoomEmail(examinationEmailEnv('suppressed'), {
    id: 'job-legacy-suppressed',
    email_type: 'student_result',
    recipient_email: 'student@example.test',
    payload: {},
  }, async () => {
    fetchCount += 1;
    return response({ id: 'must-not-send' });
  });
  assert.equal(result.providerId, 'suppressed:job-legacy-suppressed');
  assert.equal(fetchCount, 0);
});

test('explicit room suppressed mode blocks provider traffic independently of other email modes', async () => {
  let fetchCount = 0;
  const result = await deliverExamRoomEmail({
    ...examinationEmailEnv('enabled'),
    EXAMINATION_ROOM_EMAIL_MODE: 'suppressed',
  }, {
    id: 'job-room-suppressed',
    email_type: 'student_result',
    recipient_email: 'student@example.test',
    payload: {},
  }, async () => {
    fetchCount += 1;
    return response({ id: 'must-not-send' });
  });
  assert.equal(result.providerId, 'suppressed:job-room-suppressed');
  assert.equal(fetchCount, 0);
});

test('global non-Room pause does not override an explicitly enabled Examination Room sender', async () => {
  let fetchCount = 0;
  const result = await deliverExamRoomEmail({
    ...examinationEmailEnv('enabled'),
    OUTBOUND_EMAIL_MODE: 'suppressed',
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
  }, {
    id: 'job-global-suppressed',
    email_type: 'student_result',
    recipient_email: 'student@example.test',
    payload: {},
  }, async () => {
    fetchCount += 1;
    return response({ id: 'resend-room-independent' });
  });
  assert.equal(result.providerId, 'resend-room-independent');
  assert.equal(fetchCount, 1);
});

test('global non-Room pause does not hold an enabled Examination Room delivery queue', async () => {
  const calls = [];
  let fetchCount = 0;
  const rpc = async (_env, name) => {
    calls.push(name);
    if (name === 'exam_room_auto_submit_due') return { autoSubmitted: 0 };
    if (name === 'dd2026_service_flag_enabled') return false;
    if (name === 'exam_room_claim_email_batch_v2') return [{
      id: 'room-queue-independent',
      email_type: 'student_result',
      recipient_email: 'student@example.test',
      payload: {},
      claim_token: 'claim-room-independent',
    }];
    if (name === 'exam_room_complete_email_v2') return { ok: true };
    throw new Error(`Unexpected RPC ${name}`);
  };
  const result = await processExamRoomDeliveryQueues({
    ...examinationEmailEnv('enabled'),
    OUTBOUND_EMAIL_MODE: 'suppressed',
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
  }, {
    rpc,
    fetchImpl: async () => {
      fetchCount += 1;
      return response({ id: 'resend-room-queue-independent' });
    },
  });
  assert.equal(result.emailPaused, false);
  assert.equal(result.emailClaimed, 1);
  assert.equal(result.emailSent, 1);
  assert.equal(result.emailFailed, 0);
  assert.equal(fetchCount, 1);
  assert.equal(calls.includes('exam_room_claim_email_batch_v2'), true);
  assert.equal(calls.includes('exam_room_complete_email_v2'), true);
  assert.equal(calls.includes('exam_room_fail_email_v2'), false);
});

test('unknown Examination Room email types fail closed before provider traffic', async () => {
  let fetchCount = 0;
  await assert.rejects(
    deliverExamRoomEmail({
      ...examinationEmailEnv('suppressed'),
      EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    }, {
      id: 'job-unknown',
      email_type: 'future_unreviewed_email',
      recipient_email: 'student@example.test',
      payload: {},
    }, async () => {
      fetchCount += 1;
      return response({ id: 'must-not-send' });
    }),
    (error) => error?.safeCode === 'EMAIL_TYPE_UNSUPPORTED',
  );
  assert.equal(fetchCount, 0);
});

test('an explicitly blank room mode fails closed', async () => {
  let fetchCount = 0;
  await assert.rejects(
    deliverExamRoomEmail({
      ...examinationEmailEnv('enabled'),
      EXAMINATION_ROOM_EMAIL_MODE: '',
    }, {
      id: 'job-room-blank',
      email_type: 'student_result',
      recipient_email: 'student@example.test',
      payload: {},
    }, async () => {
      fetchCount += 1;
      return response({ id: 'must-not-send' });
    }),
    (error) => error?.safeCode === 'EMAIL_NOT_CONFIGURED',
  );
  assert.equal(fetchCount, 0);
});

test('room enabled override delivers every Examination Room email type while unrelated modes are suppressed', async () => {
  const studentCode = 'ExamRoomCode-2026';
  const tokenHash = Buffer.from(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(studentCode),
  )).toString('hex');
  const encryptionKey = Buffer.from(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  ).toString('base64url');
  const env = {
    ...examinationEmailEnv('suppressed'),
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    ADMIN_DIRECTORY_EMAIL_MODE: 'suppressed',
    SUPPORT_NOTIFICATION_EMAIL_MODE: 'suppressed',
    SIGN_IN_NOTIFICATION_EMAIL_MODE: 'suppressed',
    EXAM_ROOM_STUDENT_CODE_ACTIVE_KEY_ID: 'v1',
    EXAM_ROOM_STUDENT_CODE_KEY_V1: encryptionKey,
  };
  const credentialEnvelope = {
    examId: context.examPublicId,
    tokenHash,
    ...await encryptStudentExamCode(env, {
      examId: context.examPublicId,
      tokenHash,
      studentKey: studentCode,
    }),
  };
  const credentialPayload = {
    examId: context.examPublicId,
    title: context.title,
    credentialEnvelope,
  };
  const schedule = {
    opensAt: '2026-08-12T01:00:00Z',
    hardClosesAt: '2026-08-12T05:00:00Z',
    durationMinutes: 120,
  };
  const sensitivePayload = {
    attemptId: 'raw-attempt-id',
    receiptId: 'raw-receipt-id',
    snapshotHash: 'raw-snapshot-hash',
    rawToken: 'raw-token-hash',
  };
  const gradePayload = {
    examId: context.examPublicId,
    title: context.title,
    candidateNumber: 'CAND-001',
    durationMinutes: 120,
    extraMinutes: 30,
    grades: [{ questionId: 'question-1', ordinal: 1, score: 4.2, maximumPoints: 5, comment: 'Strong application.' }],
    questions: [{ questionId: 'question-1', ordinal: 1 }],
    ...sensitivePayload,
  };
  const cases = [
    ['professor_room_key', {
      ...credentialPayload, ...sensitivePayload,
      issuedAt: '2026-08-11T01:00:00Z', expiresAt: '2026-08-11T03:00:00Z',
    }],
    ['professor_grading_key', { ...credentialPayload, ...schedule, ...sensitivePayload }],
    ['beadle_key', {
      ...credentialPayload, ...sensitivePayload,
      issuedAt: '2026-08-11T01:00:00Z', expiresAt: '2026-08-12T01:00:00Z',
    }],
    ['student_exam_code', {
      ...credentialPayload, ...schedule, ...sensitivePayload,
      studentName: 'Student', extraMinutes: 30,
    }],
    ['professor_submission_notice', {
      examId: context.examPublicId, title: context.title, studentName: 'Student',
      startedAt: '2026-08-12T01:00:00Z', submittedAt: '2026-08-12T02:45:00Z',
      ...sensitivePayload,
    }],
    ['student_submission_receipt', {
      examId: context.examPublicId, title: context.title, answers: [],
      startedAt: '2026-08-12T01:00:00Z', submittedAt: '2026-08-12T02:45:00Z',
      ...sensitivePayload,
    }],
    ['exam_publication_replaced', {
      examId: context.examPublicId, title: context.title, publicationNumber: 2,
      ...schedule, extraMinutes: 30, ...sensitivePayload,
    }],
    ['submission_reopened', {
      examId: context.examPublicId, title: context.title,
      authorizedAt: '2026-08-12T03:00:00Z', newDeadline: '2026-08-12T03:45:00Z',
      ...sensitivePayload,
    }],
    ['professor_release_summary', {
      examId: context.examPublicId, title: context.title, durationMinutes: 120,
      ...sensitivePayload,
    }],
    ['student_correction', gradePayload],
    ['student_result', gradePayload],
  ];
  let fetchCount = 0;
  for (const [emailType, payload] of cases) {
    const id = `job-${emailType.replaceAll('_', '-')}`;
    const result = await deliverExamRoomEmail(env, {
      id,
      email_type: emailType,
      recipient_email: 'recipient@example.test',
      payload,
    }, async (url, options) => {
      fetchCount += 1;
      assert.equal(String(url), 'https://api.resend.com/emails');
      assert.equal(options.headers['Idempotency-Key'], `exam-room-${id}`);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, ['recipient@example.test']);
      assertProfessionalExamRoomEmail(body, emailType);
      assert.doesNotMatch(`${body.text}\n${body.html}`, new RegExp(tokenHash, 'i'));
      if (emailType === 'professor_room_key') {
        assert.match(body.text, /Professor key validity: 2 hours/);
      }
      if (emailType === 'professor_grading_key') {
        assert.match(body.subject, /published: Professor key and next steps/);
        assert.match(body.text, /Published student time: 2 hours/);
        assert.match(body.text, /PRIVATE PROFESSOR GRADING KEY/);
        assert.match(body.text, /1\. OPEN THE PROFESSOR WORKSPACE/);
        assert.match(body.text, /4\. DOWNLOAD THE CLASS GRADEBOOK/);
        assert.match(body.text, /5\. SEND FINAL RESULTS/);
        assert.match(body.html, /Private Professor grading key/);
        assert.match(body.html, /font-weight:700[^>]*>[^<]+<\/div>/);
        assert.match(body.html, /Professor workflow/);
        assert.match(body.html, /Open secure Examination Room/);
      }
      if (emailType === 'beadle_key') {
        assert.match(body.text, /Beadle key validity: 1 day/);
      }
      if (emailType === 'student_exam_code') {
        assert.match(body.text, /Your time allowed: 2 hours 30 minutes/);
        assert.match(body.text, /Scheduled room window: 4 hours/);
      }
      if (emailType === 'professor_submission_notice') {
        assert.match(body.text, /Recorded work time: 1 hour 45 minutes/);
      }
      if (emailType === 'student_submission_receipt') {
        assert.match(body.text, /Your recorded work time: 1 hour 45 minutes/);
      }
      if (emailType === 'exam_publication_replaced') {
        assert.match(body.text, /Your time allowed: 2 hours 30 minutes/);
      }
      if (emailType === 'submission_reopened') {
        assert.match(body.text, /Reopened session window: 45 minutes/);
      }
      if (emailType === 'professor_release_summary') {
        assert.match(body.text, /Published student time: 2 hours/);
      }
      if (emailType === 'student_correction') {
        assert.match(body.subject, /^Corrected score available:/);
        assert.match(body.text, /Overall score: 4\.20 \/ 5\.00 \(84\.0%\)/);
        assert.match(body.html, /Your corrected score is available/);
        assert.match(body.text, /Your time allowed: 2 hours 30 minutes/);
      }
      if (emailType === 'student_result') {
        assert.match(body.subject, /^Score released:/);
        assert.match(body.text, /Your time allowed: 2 hours 30 minutes/);
        assert.match(body.text, /Overall score: 4\.20 \/ 5\.00 \(84\.0%\)/);
        assert.match(body.html, /Your score has been released/);
        assert.match(body.html, /4\.20 \/ 5\.00/);
        assert.match(body.html, /Strong application\./);
        assert.match(body.html, /View protected result/);
      }
      return response({ id: `resend-${fetchCount}` });
    });
    assert.deepEqual(result, { providerId: `resend-${fetchCount}` });
  }
  assert.equal(fetchCount, cases.length);
});

test('explicit room enablement preserves delivery and idempotency behavior', async () => {
  let captured;
  const result = await deliverExamRoomEmail({
    OUTBOUND_EMAIL_MODE: 'suppressed', EXAMINATION_ROOM_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  }, {
    id: 'job-2', email_type: 'professor_release_summary', recipient_email: 'professor@example.test',
    payload: { examId: context.examPublicId, title: context.title, expected: 1, started: 1, submitted: 1 },
  }, async (url, options) => { captured = { url: String(url), options }; return response({ id: 'resend-123' }); });
  assert.deepEqual(result, { providerId: 'resend-123' });
  assert.equal(captured.options.headers['Idempotency-Key'], 'exam-room-job-2');
  assert.equal(JSON.parse(captured.options.body).to[0], 'professor@example.test');
});

test('professor release email contains a 30-student grade record and attached class workbook', async () => {
  let captured;
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    attemptId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    studentName: `Student ${String(index + 1).padStart(2, '0')}`,
    studentEmail: `student${index + 1}@example.test`,
    studentNumber: `2026-${String(index + 1).padStart(3, '0')}`,
    candidateNumber: `C-${String(index + 1).padStart(2, '0')}`,
    status: 'sealed',
    startedAt: '2026-08-12T01:00:00Z',
    serverDeadline: '2026-08-12T03:00:00Z',
    submittedAt: '2026-08-12T02:45:00Z',
    late: index === 29,
    allGradesFinal: true,
    unansweredCount: 0,
    incidentCount: 0,
    questions: [
      { questionId: `q-${index + 1}-1`, ordinal: 1, prompt: 'Was the dismissal valid?', answer: 'No, due process was not observed.', maximumPoints: 5, score: 4.2, gradeState: 'final', comment: 'Sound application.' },
      { questionId: `q-${index + 1}-2`, ordinal: 2, prompt: 'State the proper relief.', answer: 'Reinstatement with backwages.', maximumPoints: 5, score: 3.8, gradeState: 'final', comment: 'Complete the basis.' },
    ],
  }));
  await deliverExamRoomEmail({
    OUTBOUND_EMAIL_MODE: 'suppressed', EXAMINATION_ROOM_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  }, {
    id: 'professor-class-gradebook-job',
    email_type: 'professor_release_summary',
    recipient_email: 'professor@example.test',
    payload: {
      examId: context.examPublicId,
      title: 'Labor Law Final Examination',
      expected: 30,
      classResults: {
        examId: context.examPublicId,
        title: 'Labor Law Final Examination',
        releasedAt: '2026-08-12T04:00:00Z',
        generatedAt: '2026-08-12T04:00:00Z',
        expectedCount: 30,
        classStatuses: candidates.map((candidate) => ({ ...candidate, displayStatus: 'Submitted' })),
        candidates,
      },
    },
  }, async (_url, options) => {
    captured = JSON.parse(options.body);
    return response({ id: 'resend-professor-gradebook' });
  });
  assert.deepEqual(captured.to, ['professor@example.test']);
  assertProfessionalExamRoomEmail(captured, 'professor_release_summary');
  assert.match(captured.subject, /class results and gradebook/);
  assert.match(captured.text, /Submitted and graded: 30 of 30/);
  assert.match(captured.text, /Class average: 80\.0%/);
  assert.match(captured.text, /Student 30/);
  assert.match(captured.text, /Q1 4\.20\/5\.00 · Q2 3\.80\/5\.00/);
  assert.match(captured.html, /Class results and gradebook/);
  assert.equal(captured.attachments.length, 1);
  assert.match(captured.attachments[0].filename, /class-results.*\.xlsx$/);
  assert.ok(captured.attachments[0].content.length > 10_000);
  assert.equal(Buffer.from(captured.attachments[0].content, 'base64').subarray(0, 4).toString('hex'), '504b0304');
});

test('delivery queue enriches only the professor release job with its owner-scoped dashboard', async () => {
  const calls = [];
  let captured;
  const professorJob = {
    id: 'professor-release-job',
    claim_token: 'email-claim-token',
    email_type: 'professor_release_summary',
    recipient_user_id: '11111111-1111-4111-8111-111111111111',
    recipient_email: 'professor@example.test',
    payload: { examId: context.examPublicId, title: 'Labor Law Midterm' },
  };
  const rpc = async (_env, name, body) => {
    calls.push({ name, body });
    if (name === 'exam_room_auto_submit_due') return { autoSubmitted: 0 };
    if (name === 'dd2026_service_flag_enabled') return false;
    if (name === 'exam_room_claim_email_batch_v2') return [professorJob];
    if (name === 'exam_room_professor_results_dashboard_v1') return {
      examId: context.examPublicId,
      title: 'Labor Law Midterm',
      releasedAt: '2026-08-12T04:00:00Z',
      expectedCount: 1,
      classStatuses: [{ studentName: 'Ana Reyes', studentEmail: 'ana@example.test', candidateNumber: 'C-01', displayStatus: 'Submitted' }],
      candidates: [{
        attemptId: '22222222-2222-4222-8222-222222222222', studentName: 'Ana Reyes',
        studentEmail: 'ana@example.test', studentNumber: '2026-001', candidateNumber: 'C-01',
        status: 'sealed', allGradesFinal: true, questions: [{ ordinal: 1, prompt: 'Question', answer: 'Answer', maximumPoints: 5, score: 4.2, gradeState: 'final' }],
      }],
    };
    if (name === 'exam_room_complete_email_v2') return { ok: true };
    throw new Error(`Unexpected RPC ${name}`);
  };
  const result = await processExamRoomDeliveryQueues({
    OUTBOUND_EMAIL_MODE: 'suppressed', EXAMINATION_ROOM_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  }, {
    rpc,
    fetchImpl: async (_url, options) => { captured = JSON.parse(options.body); return response({ id: 'resend-enriched' }); },
  });
  assert.equal(result.emailSent, 1);
  const dashboardCall = calls.find((entry) => entry.name === 'exam_room_professor_results_dashboard_v1');
  assert.deepEqual(dashboardCall.body, {
    p_professor_user_id: professorJob.recipient_user_id,
    p_exam_public_id: context.examPublicId,
  });
  assert.match(captured.text, /Ana Reyes/);
  assert.equal(captured.attachments.length, 1);
});

test('student submission receipt contains the final questions and only that student submitted answers', async () => {
  let captured;
  await deliverExamRoomEmail({
    OUTBOUND_EMAIL_MODE: 'suppressed',
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  }, {
    id: 'student-receipt-job',
    email_type: 'student_submission_receipt',
    recipient_email: 'student@example.test',
    payload: {
      title: 'Labor Law Midterm',
      receiptId: 'receipt-safe-123',
      submittedAt: '2026-08-12T03:00:00Z',
      answers: [
        { ordinal: 1, questionText: 'Is the dismissal valid? Explain.', answerText: 'No. The employer failed to observe due process.' },
        { ordinal: 2, questionText: 'Discuss reinstatement.', answerText: '' },
      ],
      modelAnswer: 'must-not-send',
      gradingKey: 'must-not-send',
      anotherStudentAnswer: 'must-not-send',
    },
  }, async (_url, options) => {
    captured = JSON.parse(options.body);
    return response({ id: 'resend-student-receipt' });
  });
  assert.equal(captured.to[0], 'student@example.test');
  assertProfessionalExamRoomEmail(captured, 'student_submission_receipt');
  assert.match(captured.text, /Is the dismissal valid\? Explain\./);
  assert.match(captured.text, /The employer failed to observe due process\./);
  assert.match(captured.text, /Discuss reinstatement\./);
  assert.match(captured.text, /\[Intentionally left blank\]/);
  assert.match(captured.html, /The employer failed to observe due process\./);
  assert.doesNotMatch(`${captured.text}\n${captured.html}`, /receipt-safe-123/);
  assert.doesNotMatch(captured.text, /must-not-send/);
});

test('student result email includes overall and per-question grades for only its recipient', async () => {
  let captured;
  await deliverExamRoomEmail({
    OUTBOUND_EMAIL_MODE: 'suppressed',
    EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
    RESEND_API_KEY: 'server-secret',
    EXAMINATION_EMAIL_FROM: 'Due Diligence Examinations <examinations@duediligence.ph>',
  }, {
    id: 'student-result-job',
    email_type: 'student_result',
    recipient_email: 'ana@example.test',
    payload: {
      examId: context.examPublicId,
      title: 'Labor Law Midterm',
      candidateNumber: 'C-01',
      grades: [
        { questionId: 'question-1', score: 4.2, maximumPoints: 5, comment: 'Correct rule and application.' },
        { questionId: 'question-2', score: 3.8, maximumPoints: 5, comment: 'State the conclusion more directly.' },
      ],
      questions: [{ questionId: 'question-1', ordinal: 1 }, { questionId: 'question-2', ordinal: 2 }],
      anotherStudentEmail: 'must-not-send@example.test',
      anotherStudentAnswer: 'must-not-send',
    },
  }, async (_url, options) => {
    captured = JSON.parse(options.body);
    return response({ id: 'resend-student-result' });
  });
  assert.deepEqual(captured.to, ['ana@example.test']);
  assertProfessionalExamRoomEmail(captured, 'student_result');
  assert.match(captured.text, /Overall score: 8\.00 \/ 10\.00 \(80\.0%\)/);
  assert.match(captured.text, /Question 1: 4\.20 \/ 5\.00/);
  assert.match(captured.text, /Question 2: 3\.80 \/ 5\.00/);
  assert.match(captured.text, /Correct rule and application\./);
  assert.doesNotMatch(captured.text, /must-not-send/);
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
      OUTBOUND_EMAIL_MODE: 'suppressed',
      EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
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
    assertProfessionalExamRoomEmail(captured, entry.email_type);
    assert.match(captured.text, entry.expected);
    assert.doesNotMatch(captured.text, entry.forbidden);
    assert.equal(captured.to[0], 'student@example.test');
  }
});
