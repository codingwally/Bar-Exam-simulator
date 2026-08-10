import { formulaNeutralizedCell } from './duediligence-2026-core.mjs';

const TEMPLATE_SPREADSHEET_ID = '1alXFADSsgSduVW07nOCGYa5zz26k387DeeEMF_y_fdg';
const BACKUP_TABS = Object.freeze([
  'Exam Registry', 'Questions', 'Submissions', 'Grades', 'Sync Log',
]);
const BACKUP_HEADERS = Object.freeze({
  'Exam Registry': [
    'Event ID', 'Exam ID', 'Sequence', 'Event Type', 'Content Hash', 'Exam Title',
    'School', 'Academic Term', 'Status', 'Opens At', 'Hard Closes At',
    'Duration Minutes', 'Question Count', 'Event Created At',
  ],
  Questions: [
    'Event ID', 'Exam ID', 'Sequence', 'Event Type', 'Content Hash', 'Question Number',
    'Question', 'Maximum Points', 'Source Filename', 'Source Hash', 'Snapshot Hash',
    'Event Created At',
  ],
  Submissions: [
    'Event ID', 'Exam ID', 'Sequence', 'Event Type', 'Content Hash', 'Attempt ID',
    'Candidate Number', 'Question ID', 'Answer', 'Revision', 'Saved At', 'Started At',
    'Server Deadline', 'Submitted At', 'Automatic Submission', 'Integrity Incident Count',
  ],
  Grades: [
    'Event ID', 'Exam ID', 'Sequence', 'Event Type', 'Content Hash', 'Attempt ID',
    'Candidate Number', 'Question ID', 'Score', 'Maximum Points', 'Professor Comment',
    'Revision', 'Release ID', 'Released At', 'Questionnaire Included',
  ],
  'Sync Log': [
    'Event ID', 'Exam ID', 'Sequence', 'Event Type', 'Content Hash',
    'Event Created At', 'Synced At', 'Status',
  ],
});

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function safeCode(value, fallback) {
  const normalized = String(value || fallback || 'DELIVERY_FAILED')
    .toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  return normalized.length >= 2 ? normalized : 'DELIVERY_FAILED';
}

function stringCell(value) {
  if (value == null) return '';
  if (typeof value === 'object') return formulaNeutralizedCell(JSON.stringify(value));
  return formulaNeutralizedCell(String(value));
}

function row(values) {
  return {
    values: values.map((value) => ({ userEnteredValue: { stringValue: stringCell(value) } })),
  };
}

function appendRequest(sheetId, rows) {
  return {
    appendCells: {
      sheetId,
      rows: rows.map(row),
      fields: 'userEnteredValue',
    },
  };
}

function resultLink(examId) {
  return `https://duediligence.ph/#examination-room?exam=${encodeURIComponent(examId)}`;
}

async function jsonFetch(fetchImpl, url, options, safeFailure) {
  const response = await fetchImpl(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(safeFailure);
    error.safeCode = safeCode(`${safeFailure}_${response.status}`);
    throw error;
  }
  return body;
}

async function googleAccessToken(env, fetchImpl) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  if (!clientId || !clientSecret || !refreshToken) {
    const error = new Error('Google backup credentials are not configured.');
    error.safeCode = 'GOOGLE_AUTH_NOT_CONFIGURED';
    throw error;
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const result = await jsonFetch(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 'GOOGLE_TOKEN_FAILED');
  if (!result?.access_token) {
    const error = new Error('Google did not return an access token.');
    error.safeCode = 'GOOGLE_TOKEN_INVALID';
    throw error;
  }
  return String(result.access_token);
}

function googleHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function findExistingSpreadsheet(fetchImpl, token, examPublicId) {
  const query = `trashed = false and appProperties has { key='duediligenceExamId' and value='${examPublicId}' }`;
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', query);
  url.searchParams.set('spaces', 'drive');
  url.searchParams.set('pageSize', '2');
  url.searchParams.set('fields', 'files(id,name)');
  const result = await jsonFetch(fetchImpl, url, { headers: googleHeaders(token) }, 'GOOGLE_DRIVE_SEARCH_FAILED');
  return Array.isArray(result?.files) && result.files[0]?.id ? String(result.files[0].id) : null;
}

async function createSpreadsheet(fetchImpl, env, token, context) {
  const schemaTemplateId = String(env.GOOGLE_BACKUP_TEMPLATE_ID || TEMPLATE_SPREADSHEET_ID).trim();
  const folderId = String(env.GOOGLE_BACKUP_FOLDER_ID || '').trim();
  const title = `DueDiligence Exam — ${context.title} — ${context.examPublicId}`;
  const result = await jsonFetch(fetchImpl, 'https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,sheets.properties(sheetId,title)', {
    method: 'POST',
    headers: googleHeaders(token),
    body: JSON.stringify({
      properties: { title, locale: 'en_US', timeZone: 'Asia/Manila' },
      sheets: ['README', ...BACKUP_TABS].map((name) => ({
        properties: { title: name, gridProperties: { rowCount: 1000, columnCount: 26 } },
      })),
    }),
  }, 'GOOGLE_SHEET_CREATE_FAILED');
  if (!result?.spreadsheetId) {
    const error = new Error('Google did not return a spreadsheet identifier.');
    error.safeCode = 'GOOGLE_CREATE_INVALID';
    throw error;
  }
  const spreadsheetId = String(result.spreadsheetId);
  const sheetIds = Object.fromEntries((result?.sheets || []).map((entry) => (
    [entry?.properties?.title, entry?.properties?.sheetId]
  )));
  const initialRequests = [
    appendRequest(sheetIds.README, [
      ['DueDiligence Examination Room Backup'],
      ['Purpose', 'Independent per-exam backup and dispute record.'],
      ['Authority', 'The protected DueDiligence database remains authoritative.'],
      ['Privacy', 'Contains protected student answers and grades. It is service/admin controlled and is not shared with the Professor.'],
      ['Grading', 'The Professor grades only through the protected DueDiligence website.'],
      ['Timezone', 'Asia/Manila'],
    ]),
    ...BACKUP_TABS.map((name) => appendRequest(sheetIds[name], [BACKUP_HEADERS[name]])),
  ];
  if (initialRequests.some((request) => !Number.isInteger(request.appendCells.sheetId))) {
    const error = new Error('Google created an invalid backup workbook schema.');
    error.safeCode = 'GOOGLE_CREATE_SCHEMA_INVALID';
    throw error;
  }
  await jsonFetch(fetchImpl,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST', headers: googleHeaders(token), body: JSON.stringify({ requests: initialRequests }),
    }, 'GOOGLE_SHEET_INITIALIZE_FAILED');

  const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}`);
  metadataUrl.searchParams.set('supportsAllDrives', 'true');
  metadataUrl.searchParams.set('fields', 'id,name,appProperties,parents');
  if (folderId) metadataUrl.searchParams.set('addParents', folderId);
  await jsonFetch(fetchImpl, metadataUrl, {
    method: 'PATCH',
    headers: googleHeaders(token),
    body: JSON.stringify({
      name: title,
      appProperties: {
        duediligenceExamId: context.examPublicId,
        duediligencePurpose: 'examination-room-backup',
        duediligenceSchemaTemplateId: schemaTemplateId,
      },
    }),
  }, 'GOOGLE_DRIVE_METADATA_FAILED');
  return spreadsheetId;
}

async function ensureSpreadsheet(fetchImpl, env, token, context) {
  if (context.googleSheetId) {
    return { spreadsheetId: String(context.googleSheetId), created: false };
  }
  const existing = await findExistingSpreadsheet(fetchImpl, token, context.examPublicId);
  if (existing) {
    return { spreadsheetId: existing, created: false };
  }
  return {
    spreadsheetId: await createSpreadsheet(fetchImpl, env, token, context),
    created: true,
  };
}

async function sheetMetadata(fetchImpl, token, spreadsheetId) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set('fields', 'sheets.properties(sheetId,title)');
  const result = await jsonFetch(fetchImpl, url, { headers: googleHeaders(token) }, 'GOOGLE_SHEET_METADATA_FAILED');
  const ids = Object.fromEntries((result?.sheets || []).map((entry) => (
    [entry?.properties?.title, entry?.properties?.sheetId]
  )));
  for (const name of BACKUP_TABS) {
    if (!Number.isInteger(ids[name])) {
      const error = new Error(`The backup template is missing ${name}.`);
      error.safeCode = 'GOOGLE_TEMPLATE_SCHEMA_INVALID';
      throw error;
    }
  }
  return ids;
}

function backupRows(event, context) {
  const payload = event.payload || {};
  const common = [event.id, context.examPublicId, event.sequence_number, event.event_type, event.content_hash];
  const requests = [];
  const registry = [[
    ...common, context.title, context.schoolName, context.academicTerm,
    context.status, context.opensAt, context.hardClosesAt, context.durationMinutes,
    context.questionCount, event.created_at,
  ]];
  requests.push(['Exam Registry', registry]);

  if (event.event_type === 'exam_confirmed' || event.event_type === 'exam_questions_revised') {
    requests.push(['Questions', (payload.questions || []).map((question) => [
      ...common, question.ordinal, question.prompt, question.maximumPoints ?? 5,
      payload.sourceFileName, payload.sourceHash, payload.snapshotHash, event.created_at,
    ])]);
  }
  if (event.event_type === 'attempt_submitted') {
    requests.push(['Submissions', (payload.answers || []).map((answer) => [
      ...common, payload.attemptId, payload.candidateNumber, answer.questionId,
      answer.answerText ?? '', answer.revision ?? 0, answer.savedAt,
      payload.startedAt, payload.serverDeadline, payload.submittedAt,
      payload.automatic === true, payload.integrityIncidentCount ?? 0,
    ])]);
  }
  if (event.event_type === 'grades_released' || event.event_type === 'admin_correction') {
    requests.push(['Grades', (payload.grades || [payload]).map((grade) => [
      ...common, grade.attemptId, grade.candidateNumber, grade.questionId,
      grade.score, grade.maximumPoints, grade.comment, grade.revision,
      payload.releaseId, payload.releasedAt, payload.includeQuestionnaire,
    ])]);
  }
  requests.push(['Sync Log', [[
    ...common, event.created_at, new Date().toISOString(), 'SYNCED',
  ]]]);
  return requests.filter(([, rows]) => rows.length > 0);
}

async function alreadySynced(fetchImpl, token, spreadsheetId, event) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/%27Sync%20Log%27!A%3AZ`);
  url.searchParams.set('majorDimension', 'ROWS');
  const result = await jsonFetch(fetchImpl, url, { headers: googleHeaders(token) }, 'GOOGLE_SYNC_READ_FAILED');
  return (result?.values || []).some((values) => (
    String(values[0] || '') === String(event.id)
      && values.some((value) => String(value) === String(event.content_hash))
  ));
}

async function writeEvent(fetchImpl, token, spreadsheetId, event, context) {
  if (await alreadySynced(fetchImpl, token, spreadsheetId, event)) return;
  const ids = await sheetMetadata(fetchImpl, token, spreadsheetId);
  const requests = backupRows(event, context).map(([name, rows]) => appendRequest(ids[name], rows));
  await jsonFetch(fetchImpl,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST', headers: googleHeaders(token), body: JSON.stringify({ requests }),
    }, 'GOOGLE_BATCH_WRITE_FAILED');
  if (!(await alreadySynced(fetchImpl, token, spreadsheetId, event))) {
    const error = new Error('Google backup verification failed.');
    error.safeCode = 'GOOGLE_VERIFY_FAILED';
    throw error;
  }
}

async function removeProfessorAccess(fetchImpl, token, spreadsheetId, professorEmail) {
  const normalizedEmail = String(professorEmail || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const error = new Error('The owning professor identity is unavailable for backup permission verification.');
    error.safeCode = 'GOOGLE_PROFESSOR_IDENTITY_MISSING';
    throw error;
  }
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/permissions`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'permissions(id,emailAddress,role,type)');
  const result = await jsonFetch(fetchImpl, url, { headers: googleHeaders(token) }, 'GOOGLE_PERMISSION_LIST_FAILED');
  const matches = (result?.permissions || []).filter((permission) => (
    String(permission.emailAddress || '').trim().toLowerCase() === normalizedEmail
      && permission.role !== 'owner'
  ));
  for (const permission of matches) {
    await jsonFetch(fetchImpl,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      }, 'GOOGLE_PERMISSION_REVOKE_FAILED');
  }
}

export async function syncGoogleBackupEvent(env, event, context, fetchImpl = fetch) {
  const token = await googleAccessToken(env, fetchImpl);
  const ensured = await ensureSpreadsheet(fetchImpl, env, token, context);
  const spreadsheetId = ensured.spreadsheetId;
  let professorAccessRemoved = Boolean(context.professorAccessRemovedAt);
  if (!professorAccessRemoved) {
    // New workbooks have never been shared. Existing workbooks may have been
    // created by the earlier beta flow, so revoke only the known Professor
    // permission before appending any further protected answers or grades.
    if (!ensured.created) {
      await removeProfessorAccess(fetchImpl, token, spreadsheetId, context.professorEmail);
    }
    professorAccessRemoved = true;
  }
  await writeEvent(fetchImpl, token, spreadsheetId, event, context);
  return {
    spreadsheetId,
    providerReference: `${spreadsheetId}:${event.id}`,
    verifiedHash: String(event.content_hash),
    professorAccessRemoved,
  };
}

function emailMessage(job) {
  const payload = job.payload || {};
  if (job.email_type === 'exam_publication_replaced') {
    return {
      subject: `Due Diligence — updated ${payload.title || 'examination'} publication`,
      text: [
        `Your professor published replacement version ${payload.publicationNumber || ''} of ${payload.title || 'your examination'} before it opened.`.trim(),
        'Sign in and review the current examination notice, instructions, and schedule before starting.',
        'If an access code is required, obtain the current code only through your official class channel. This email never contains examination credentials.',
        resultLink(payload.examId || ''),
      ].join('\n'),
    };
  }
  if (job.email_type === 'submission_reopened') {
    return {
      subject: `Due Diligence — submission reopened for ${payload.title || 'your examination'}`,
      text: [
        `An authorized reopening created submission generation ${payload.generation || ''} for ${payload.title || 'your examination'}.`.trim(),
        `New server deadline: ${payload.serverDeadline || payload.newDeadline || 'Sign in to view the authoritative deadline.'}`,
        'Sign in using the rostered account and open a new examination session. This email contains no examination answers or credentials.',
        resultLink(payload.examId || ''),
      ].join('\n'),
    };
  }
  if (job.email_type === 'professor_release_summary') {
    return {
      subject: `Due Diligence — ${payload.title || 'Examination'} release summary`,
      text: [
        `Results were released for ${payload.title || 'your examination'}.`,
        `Expected: ${payload.expected ?? 0}`,
        `Started: ${payload.started ?? 0}`,
        `Submitted: ${payload.submitted ?? 0}`,
        `Auto-submitted: ${payload.autoSubmitted ?? 0}`,
        `Locked: ${payload.locked ?? 0}`,
        `Secure grading record: ${resultLink(payload.examId || '')}`,
      ].join('\n'),
    };
  }
  if (job.email_type === 'student_correction') {
    return {
      subject: `Due Diligence — corrected result for ${payload.title || 'your examination'}`,
      text: `A reviewed correction is available in your secure Examination Room.\n${resultLink(payload.examId || '')}`,
    };
  }
  return {
    subject: `Due Diligence — results for ${payload.title || 'your examination'}`,
    text: `Your professor has released your examination result and comments. Sign in to view the protected record.\n${resultLink(payload.examId || '')}`,
  };
}

export async function deliverExamRoomEmail(env, job, fetchImpl = fetch) {
  const mode = String(env.EXAMINATION_EMAIL_MODE || '').trim().toLowerCase();
  if (mode === 'suppressed') return { providerId: `suppressed:${job.id}` };
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.EXAMINATION_EMAIL_FROM || '').trim();
  if (mode !== 'enabled' || !apiKey || !from) {
    const error = new Error('Examination email is not configured.');
    error.safeCode = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  const message = emailMessage(job);
  const result = await jsonFetch(fetchImpl, 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `exam-room-${job.id}`,
    },
    body: JSON.stringify({
      from,
      to: [job.recipient_email],
      subject: message.subject,
      text: message.text,
    }),
  }, 'EMAIL_PROVIDER_FAILED');
  if (!result?.id) {
    const error = new Error('The email provider did not return a message identifier.');
    error.safeCode = 'EMAIL_PROVIDER_INVALID';
    throw error;
  }
  return { providerId: String(result.id).slice(0, 500) };
}

export async function processExamRoomDeliveryQueues(env, {
  rpc,
  fetchImpl = fetch,
  backupBatchSize = 10,
  emailBatchSize = 20,
} = {}) {
  if (typeof rpc !== 'function') throw new Error('A Worker-only Examination Room RPC adapter is required.');
  const summary = {
    autoSubmitted: 0,
    autoSubmitFailed: 0,
    backupClaimed: 0,
    backupSynced: 0,
    backupFailed: 0,
    emailClaimed: 0,
    emailSent: 0,
    emailFailed: 0,
  };
  try {
    const due = await rpc(env, 'exam_room_auto_submit_due', { p_exam_id: null });
    summary.autoSubmitted = Math.max(0, Number(due?.autoSubmitted) || 0);
  } catch {
    // Keep independent backup and email queues moving while exposing the
    // auto-submit failure in the scheduled-job summary for monitoring.
    summary.autoSubmitFailed = 1;
  }
  const backupFlag = await rpc(env, 'dd2026_service_flag_enabled', { p_flag_key: 'EXAM_GOOGLE_BACKUP_ENABLED' });
  if (backupFlag === true && enabled(env.EXAM_GOOGLE_BACKUP_ENABLED, false)) {
    const events = await rpc(env, 'exam_room_claim_backup_batch', { p_limit: backupBatchSize });
    summary.backupClaimed = Array.isArray(events) ? events.length : 0;
    for (const event of events || []) {
      try {
        const context = await rpc(env, 'exam_room_backup_context', { p_exam_id: event.exam_id });
        const synced = await syncGoogleBackupEvent(env, event, context, fetchImpl);
        await rpc(env, 'exam_room_complete_backup', {
          p_outbox_id: event.id,
          p_provider_reference: synced.providerReference,
          p_verified_hash: synced.verifiedHash,
          p_google_sheet_id: synced.spreadsheetId,
          p_professor_access_removed: synced.professorAccessRemoved,
        });
        summary.backupSynced += 1;
      } catch (error) {
        await rpc(env, 'exam_room_fail_backup', {
          p_outbox_id: event.id,
          p_safe_error_code: safeCode(error?.safeCode, 'GOOGLE_BACKUP_FAILED'),
        });
        summary.backupFailed += 1;
      }
    }
  }

  const jobs = await rpc(env, 'exam_room_claim_email_batch', { p_limit: emailBatchSize });
  summary.emailClaimed = Array.isArray(jobs) ? jobs.length : 0;
  for (const job of jobs || []) {
    try {
      const sent = await deliverExamRoomEmail(env, job, fetchImpl);
      await rpc(env, 'exam_room_complete_email', { p_job_id: job.id, p_provider_id: sent.providerId });
      summary.emailSent += 1;
    } catch (error) {
      await rpc(env, 'exam_room_fail_email', {
        p_job_id: job.id,
        p_safe_error_code: safeCode(error?.safeCode, 'EMAIL_DELIVERY_FAILED'),
      });
      summary.emailFailed += 1;
    }
  }
  return summary;
}
