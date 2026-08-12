import { formulaNeutralizedCell } from './duediligence-2026-core.mjs';
import { decryptStudentExamCode } from './exam-room-student-code-envelope.mjs';
import {
  buildExamClassResultsWorkbook,
  examClassResultsWorkbookFileName,
} from './exam-results-workbook.mjs';

const MAX_PROFESSOR_GRADEBOOK_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function professorCandidateTotals(candidate) {
  const questions = Array.isArray(candidate?.questions) ? candidate.questions : [];
  const score = questions.reduce((sum, question) => sum + finiteNumber(question?.score), 0);
  const maximum = questions.reduce((sum, question) => sum + finiteNumber(question?.maximumPoints), 0);
  return { score, maximum, percentage: maximum > 0 ? (score / maximum) * 100 : 0 };
}

function base64Bytes(bytes) {
  const chunkSize = 24_576;
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    let binary = '';
    for (let index = 0; index < chunk.length; index += 1) binary += String.fromCharCode(chunk[index]);
    encoded += btoa(binary);
  }
  return encoded;
}

function professorReleaseMessage(payload) {
  const report = payload?.classResults && typeof payload.classResults === 'object'
    ? payload.classResults : null;
  const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
  if (!report || candidates.length === 0) {
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

  const rows = candidates.map((candidate) => {
    const totals = professorCandidateTotals(candidate);
    const perQuestion = (candidate.questions || [])
      .map((question) => `Q${finiteNumber(question.ordinal)} ${finiteNumber(question.score).toFixed(2)}/${finiteNumber(question.maximumPoints).toFixed(2)}`)
      .join(' · ');
    return {
      name: candidate.studentName || candidate.candidateNumber || 'Student',
      email: candidate.studentEmail || '',
      studentNumber: candidate.studentNumber || '',
      candidateNumber: candidate.candidateNumber || '',
      totals,
      perQuestion,
      timing: candidate.late ? 'Late' : 'On time',
    };
  });
  const totalPercentages = rows.map((row) => row.totals.percentage);
  const average = totalPercentages.length
    ? totalPercentages.reduce((sum, value) => sum + value, 0) / totalPercentages.length : 0;
  const absent = (Array.isArray(report.classStatuses) ? report.classStatuses : [])
    .filter((entry) => entry?.absent === true).length;
  const late = (Array.isArray(report.classStatuses) ? report.classStatuses : [])
    .filter((entry) => entry?.late === true).length;
  const generatedAt = report.releasedAt || payload.releasedAt || report.generatedAt;
  const dataset = {
    ...report,
    generatedAt,
    exportScope: 'class_results',
  };
  let attachment = null;
  try {
    const bytes = buildExamClassResultsWorkbook({ dataset });
    if (bytes.length <= MAX_PROFESSOR_GRADEBOOK_ATTACHMENT_BYTES) {
      attachment = {
        filename: examClassResultsWorkbookFileName({ dataset }),
        content: base64Bytes(bytes),
      };
    }
  } catch {
    // The readable class summary and secure portal remain available. The
    // delivery queue will not fail solely because a workbook is too large.
  }
  const attachmentLine = attachment
    ? 'The complete class gradebook is attached in Excel/Google Sheets-compatible format.'
    : 'Download the complete class gradebook from the secure Professor results dashboard.';
  const studentLines = rows.map((row, index) => [
    `${index + 1}. ${row.name}`,
    `   Student no.: ${row.studentNumber || '—'} · Candidate: ${row.candidateNumber || '—'} · ${row.timing}`,
    `   Overall: ${row.totals.score.toFixed(2)} / ${row.totals.maximum.toFixed(2)} (${row.totals.percentage.toFixed(1)}%)`,
    `   ${row.perQuestion || 'No question-level grades recorded.'}`,
  ].join('\n')).join('\n\n');
  const tableRows = rows.map((row) => `<tr>
    <td style="padding:10px;border-bottom:1px solid #d6dee8"><strong>${html(row.name)}</strong><br><span style="color:#526174">${html(row.email)}</span></td>
    <td style="padding:10px;border-bottom:1px solid #d6dee8">${html(row.studentNumber || '—')}<br>${html(row.candidateNumber || '—')}</td>
    <td style="padding:10px;border-bottom:1px solid #d6dee8;text-align:right"><strong>${row.totals.score.toFixed(2)} / ${row.totals.maximum.toFixed(2)}</strong><br>${row.totals.percentage.toFixed(1)}%</td>
    <td style="padding:10px;border-bottom:1px solid #d6dee8">${html(row.perQuestion || 'No question-level grades recorded.')}</td>
  </tr>`).join('');
  return {
    subject: `Due Diligence — ${payload.title || 'Examination'} class results and gradebook`,
    text: [
      `Final class results for ${payload.title || 'your examination'}.`,
      '',
      `Submitted and graded: ${rows.length} of ${report.expectedCount ?? payload.expected ?? rows.length}`,
      `Class average: ${average.toFixed(1)}%`,
      `Absent / no-show: ${absent}`,
      `Late: ${late}`,
      attachmentLine,
      '',
      'CLASS GRADE RECORD',
      studentLines,
      '',
      `Professor results dashboard: ${resultLink(payload.examId || report.examId || '')}`,
    ].join('\n'),
    html: `<div style="margin:0;background:#f5f2e9;padding:32px 16px;font-family:Arial,sans-serif;color:#132238">
      <div style="max-width:960px;margin:auto;background:#fff;border:1px solid #d4af37;border-top:5px solid #d4af37">
        <div style="background:#061c35;color:#fff;padding:26px 30px"><div style="color:#e4bd54;font-size:12px;letter-spacing:2px;text-transform:uppercase">Due Diligence Examination Room</div><h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:30px">Class results and gradebook</h1></div>
        <div style="padding:26px 30px"><h2 style="margin:0 0 8px;font-family:Georgia,serif;color:#061c35">${html(payload.title || report.title || 'Examination')}</h2><p style="margin:0 0 20px;color:#526174">${html(attachmentLine)}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr><td style="padding:14px;background:#f7f4ec"><strong>${rows.length}</strong><br>graded submissions</td><td style="padding:14px;background:#f7f4ec"><strong>${average.toFixed(1)}%</strong><br>class average</td><td style="padding:14px;background:#f7f4ec"><strong>${absent}</strong><br>absent / no-show</td><td style="padding:14px;background:#f7f4ec"><strong>${late}</strong><br>late</td></tr></table>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#0b2b4b;color:#fff"><th style="padding:11px;text-align:left">Student</th><th style="padding:11px;text-align:left">Record</th><th style="padding:11px;text-align:right">Overall</th><th style="padding:11px;text-align:left">Per question</th></tr></thead><tbody>${tableRows}</tbody></table></div>
          <p style="margin:24px 0 0"><a href="${html(resultLink(payload.examId || report.examId || ''))}" style="display:inline-block;background:#d4af37;color:#061c35;text-decoration:none;font-weight:bold;padding:12px 18px">Open secure Professor dashboard</a></p>
        </div>
      </div>
    </div>`,
    attachments: attachment ? [attachment] : [],
  };
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

export async function googleAccessToken(env, fetchImpl) {
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

const SCHEDULE_CHANGE_STATUS_MAX_LENGTH = 4096;

function boundedEventText(value, maximumLength) {
  return String(value ?? '').slice(0, maximumLength);
}

function scheduleChangeRecord(payload) {
  const publicationNumber = Number(payload?.publicationNumber);
  return {
    previousPublicationId: boundedEventText(payload?.previousPublicationId, 128),
    publicationId: boundedEventText(payload?.publicationId, 128),
    publicationNumber: Number.isSafeInteger(publicationNumber) && publicationNumber >= 1
      ? publicationNumber
      : boundedEventText(payload?.publicationNumber, 32),
    previousOpensAt: boundedEventText(payload?.previousOpensAt, 64),
    previousHardClosesAt: boundedEventText(payload?.previousHardClosesAt, 64),
    opensAt: boundedEventText(payload?.opensAt, 64),
    hardClosesAt: boundedEventText(payload?.hardClosesAt, 64),
    durationMinutes: boundedEventText(payload?.durationMinutes, 16),
    lateAdmissionMinutes: boundedEventText(payload?.lateAdmissionMinutes, 16),
    submissionGraceMinutes: boundedEventText(payload?.submissionGraceMinutes, 16),
    reason: boundedEventText(payload?.reason, 1000),
  };
}

function scheduleChangeSyncStatus(payload) {
  const status = JSON.stringify({
    status: 'SYNCED',
    event: 'exam_schedule_changed',
    scheduleChange: scheduleChangeRecord(payload),
  });
  // Every field above has a strict bound, keeping this valid structured record
  // well below the existing Sync Log cell limit without changing its schema.
  return status.slice(0, SCHEDULE_CHANGE_STATUS_MAX_LENGTH);
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
  const scheduleChange = event.event_type === 'exam_schedule_changed'
    ? scheduleChangeRecord(payload)
    : null;
  const eventExamPublicId = scheduleChange
    ? boundedEventText(payload.examId || context.examPublicId, 128)
    : context.examPublicId;
  const common = [event.id, eventExamPublicId, event.sequence_number, event.event_type, event.content_hash];
  const requests = [];
  const registry = [[
    ...common, scheduleChange ? boundedEventText(payload.title || context.title, 500) : context.title,
    context.schoolName, context.academicTerm,
    scheduleChange
      ? JSON.stringify({
        status: 'scheduled',
        previousPublicationId: scheduleChange.previousPublicationId,
        publicationId: scheduleChange.publicationId,
        publicationNumber: scheduleChange.publicationNumber,
      })
      : context.status,
    scheduleChange ? scheduleChange.opensAt : context.opensAt,
    scheduleChange ? scheduleChange.hardClosesAt : context.hardClosesAt,
    scheduleChange ? scheduleChange.durationMinutes : context.durationMinutes,
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
    ...common, event.created_at, new Date().toISOString(),
    scheduleChange ? scheduleChangeSyncStatus(payload) : 'SYNCED',
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

async function credentialFromPayload(env, payload) {
  const envelope = payload?.credentialEnvelope;
  if (!envelope) {
    const error = new Error('The encrypted examination credential is unavailable.');
    error.safeCode = 'EMAIL_CREDENTIAL_UNAVAILABLE';
    throw error;
  }
  return decryptStudentExamCode(env, envelope);
}

function submittedAnswersText(answers) {
  if (!Array.isArray(answers) || answers.length === 0) return 'No written answers were recorded.';
  return answers.map((entry, index) => {
    const ordinal = Number(entry?.ordinal ?? entry?.questionNumber ?? index + 1);
    const question = String(entry?.questionText ?? entry?.prompt ?? '').trim();
    const answer = String(entry?.answerText ?? entry?.answer ?? '').trim();
    return [
      `Question ${Number.isFinite(ordinal) ? ordinal : index + 1}`,
      question || '[Question text unavailable]',
      '',
      'Your submitted answer:',
      answer || '[Intentionally left blank]',
    ].join('\n');
  }).join('\n\n');
}

function releasedGradesText(grades, questions = []) {
  if (!Array.isArray(grades) || grades.length === 0) return 'No grade details were recorded.';
  const totalScore = grades.reduce((sum, grade) => sum + (Number(grade?.score) || 0), 0);
  const totalMaximum = grades.reduce((sum, grade) => sum + (Number(grade?.maximumPoints) || 0), 0);
  const overall = totalMaximum > 0 ? `${totalScore.toFixed(2)} / ${totalMaximum.toFixed(2)} (${((totalScore / totalMaximum) * 100).toFixed(1)}%)` : 'Unavailable';
  const details = grades.map((grade, index) => {
    const question = Array.isArray(questions)
      ? questions.find((entry) => String(entry?.questionId || '') === String(grade?.questionId || ''))
      : null;
    const ordinal = Number(grade?.ordinal ?? question?.ordinal) || index + 1;
    return [
    `Question ${ordinal}: ${Number(grade?.score || 0).toFixed(2)} / ${Number(grade?.maximumPoints || 0).toFixed(2)}`,
    String(grade?.comment || '').trim() ? `Professor comment: ${String(grade.comment).trim()}` : 'Professor comment: None',
  ].join('\n');
  }).join('\n\n');
  return `Overall score: ${overall}\n\n${details}`;
}

async function emailMessage(env, job) {
  const payload = job.payload || {};
  if (job.email_type === 'professor_room_key') {
    const key = await credentialFromPayload(env, payload);
    return {
      subject: `Due Diligence - Professor Room key for ${payload.title || 'Examination Room'}`,
      text: [
        'Your one-time Professor Room key is ready.',
        `Room: ${payload.title || 'Examination Room'}`,
        `Key: ${key}`,
        `Expires: ${payload.expiresAt || 'See the secure portal.'}`,
        'Keep this credential private. Due Diligence staff will never ask you to forward it.',
        'https://duediligence.ph/#examination-room',
      ].join('\n'),
    };
  }
  if (job.email_type === 'professor_grading_key') {
    const key = await credentialFromPayload(env, payload);
    return {
      subject: `Due Diligence - Grading key for ${payload.title || 'your examination'}`,
      text: [
        `Your grading key for ${payload.title || 'your examination'} is:`,
        key,
        'Use it only in the secure Professor grading workspace. Keep it private.',
        resultLink(payload.examId || ''),
      ].join('\n'),
    };
  }
  if (job.email_type === 'beadle_key') {
    const key = await credentialFromPayload(env, payload);
    return {
      subject: `Due Diligence - Beadle key for ${payload.title || 'your examination'}`,
      text: [
        `You were appointed Beadle for ${payload.title || 'an examination'}.`,
        `Beadle key: ${key}`,
        `Expires: ${payload.expiresAt || 'See the secure portal.'}`,
        'Sign in with the invited Google account, then redeem this key. Keep it private.',
        resultLink(payload.examId || ''),
      ].join('\n'),
    };
  }
  if (job.email_type === 'student_exam_code') {
    const key = await credentialFromPayload(env, payload);
    return {
      subject: `Due Diligence - Access code for ${payload.title || 'your examination'}`,
      text: [
        `Hello ${payload.studentName || 'Student'},`,
        `Your class access code for ${payload.title || 'your examination'} is:`,
        key,
        `Scheduled opening: ${payload.opensAt || 'See the waiting room.'}`,
        `Hard close: ${payload.hardClosesAt || 'See the waiting room.'}`,
        'Sign in using this same rostered email account. The code reveals no questions before the examination opens.',
        'For access help, contact support@duediligence.ph.',
        'https://duediligence.ph/#examination-room',
      ].join('\n'),
    };
  }
  if (job.email_type === 'professor_submission_notice') {
    return {
      subject: `Due Diligence - Submission received for ${payload.title || 'your examination'}`,
      text: [
        `${payload.studentName || payload.candidateNumber || 'A student'} submitted ${payload.title || 'the examination'}.`,
        `Submitted at: ${payload.submittedAt || 'Recorded by the examination server.'}`,
        'The submitted attempt is available for immediate grading. Student answers are not included in this email.',
        resultLink(payload.examId || ''),
      ].join('\n'),
    };
  }
  if (job.email_type === 'student_submission_receipt') {
    return {
      subject: `Due Diligence - Submission receipt for ${payload.title || 'your examination'}`,
      text: [
        `Your submission for ${payload.title || 'the examination'} was received.`,
        `Receipt: ${payload.receiptId || 'Recorded by the examination server.'}`,
        `Submitted at: ${payload.submittedAt || 'Recorded by the examination server.'}`,
        '',
        'Your submitted answers:',
        submittedAnswersText(payload.answers),
        '',
        'Keep this receipt for your records.',
      ].join('\n'),
    };
  }
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
    return professorReleaseMessage(payload);
  }
  if (job.email_type === 'student_correction') {
    return {
      subject: `Due Diligence — corrected result for ${payload.title || 'your examination'}`,
      text: `A reviewed correction is available in your secure Examination Room.\n${resultLink(payload.examId || '')}`,
    };
  }
  if (job.email_type === 'student_result') {
    return {
      subject: `Due Diligence — results for ${payload.title || 'your examination'}`,
      text: [
        `Your Professor has released your result for ${payload.title || 'the examination'}.`,
        payload.candidateNumber ? `Candidate number: ${payload.candidateNumber}` : '',
        '',
        releasedGradesText(payload.grades, payload.questions),
        '',
        'Sign in to view the protected examination record.',
        resultLink(payload.examId || ''),
      ].filter((line, index, rows) => line || (index > 0 && rows[index - 1] !== '')).join('\n'),
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
  const message = await emailMessage(env, job);
  const requestBody = {
    from,
    to: [job.recipient_email],
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(Array.isArray(message.attachments) && message.attachments.length
      ? { attachments: message.attachments } : {}),
  };
  const result = await jsonFetch(fetchImpl, 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `exam-room-${job.id}`,
    },
    body: JSON.stringify(requestBody),
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
      let deliveryJob = job;
      if (job?.email_type === 'professor_release_summary') {
        const classResults = await rpc(env, 'exam_room_professor_results_dashboard_v1', {
          p_professor_user_id: job.recipient_user_id,
          p_exam_public_id: job?.payload?.examId,
        });
        deliveryJob = {
          ...job,
          payload: { ...(job.payload || {}), classResults },
        };
      }
      const sent = await deliverExamRoomEmail(env, deliveryJob, fetchImpl);
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
