'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');

const coreSource = fs.readFileSync(path.join(__dirname, 'offline-grading-core.js'), 'utf8');
const coreContext = { TextEncoder, TextDecoder, Uint8Array, Map, Set, Date, JSON, Number, String, Object, Array, Error, Buffer };
vm.createContext(coreContext);
vm.runInContext(coreSource, coreContext, { filename: 'offline-grading-core.js' });
const core = coreContext.DueDiligenceOfflineGradingCore;
const html = fs.readFileSync(path.join(__dirname, 'offline-grading.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, 'offline-grading.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'offline-grading.css'), 'utf8');

function packagePayload() {
  return {
    format: core.FORMAT,
    exportedAt: '2026-08-26T00:00:00.000Z',
    exam: {
      id: 'exam-1',
      versionId: 'version-1',
      title: 'Constitutional Law Final',
      questions: [
        { id: 'q1', type: 'essay', prompt: 'Apply the doctrine.', points: 30 },
        { id: 'q2', type: 'short_answer', prompt: 'State the rule.', points: 20 },
      ],
    },
    sessions: [
      { id: 's1', fullName: 'Maria Dela Cruz', studentNumber: '2026-001', yearLevel: 'Fourth year' },
      { id: 's2', fullName: 'Jose Santos', studentNumber: '2026-002', yearLevel: 'Fourth year' },
    ],
    submissions: [{ sessionId: 's1' }, { sessionId: 's2' }],
    answerRevisions: [
      { sessionId: 's1', questionId: 'q1', answer: 'First answer' },
      { sessionId: 's1', questionId: 'q1', answer: 'Latest answer' },
      { sessionId: 's1', questionId: 'q2', answer: 'Second answer' },
    ],
    gradeRevisions: [{ sessionId: 's1', questionId: 'q1', points: 20, feedback: 'Initial grade' }],
  };
}

test('offline model shows real names by default and offers deterministic pseudonyms', () => {
  const payload = packagePayload();
  const model = core.buildModel(payload);
  const draft = core.normalizeDraft(null, payload);

  assert.equal(draft.usePseudonyms, false);
  assert.equal(core.displayIdentity(model.sessions[0], 0, false).name, 'Maria Dela Cruz');
  assert.equal(core.displayIdentity(model.sessions[0], 0, false).detail, '2026-001 · Fourth year');
  assert.equal(core.displayIdentity(model.sessions[0], 0, true).name, 'Student 01');
  assert.equal(core.displayIdentity(model.sessions[0], 0, true).detail, 'Identity hidden only in this grading view');
  assert.equal(model.answers.get('s1:q1').answer, 'Latest answer');
  assert.equal(core.answerText('option-2', { type: 'multiple_choice', options: ['Congress', 'Supreme Court'] }), 'Supreme Court');
});

test('points validation supports partial autosave and blocks out-of-range grades', () => {
  const partial = core.validateGrade('', 'draft feedback', 30);
  assert.equal(partial.complete, false);
  assert.equal(partial.points, '');
  assert.equal(partial.feedback, 'draft feedback');
  assert.equal(partial.error, '');
  assert.equal(core.validateGrade(30.5, '', 30).error, 'Maximum: 30 points.');
  assert.equal(core.validateGrade(-1, '', 30).error, 'Points cannot be below zero.');
  assert.equal(core.validateGrade(29.5, 'Good analysis', 30).complete, true);
});

test('graded export remains v1-compatible and appends only changed complete grades', () => {
  const payload = packagePayload();
  const draft = core.normalizeDraft(null, payload);
  draft.grades['s1:q1'] = { points: '24', feedback: 'Revised offline' };
  draft.grades['s1:q2'] = { points: '', feedback: 'Still grading' };
  draft.grades['s2:q1'] = { points: '31', feedback: 'Invalid' };
  draft.usePseudonyms = true;

  const result = core.appendOfflineGradeRevisions(payload, draft, '2026-08-26T12:00:00.000Z', 'batch-export-0001');
  assert.equal(result.payload.format, core.FORMAT);
  assert.equal(result.added, 1);
  assert.equal(result.payload.gradeRevisions.length, 2);
  const revision = result.payload.gradeRevisions.at(-1);
  assert.equal(revision.sessionId, 's1');
  assert.equal(revision.questionId, 'q1');
  assert.equal(revision.points, 24);
  assert.equal(revision.feedback, 'Revised offline');
  assert.equal(revision.createdAt, '2026-08-26T12:00:00.000Z');
  assert.equal(revision.source, 'offline_grading_workspace');
  assert.equal(revision.offlineExportBatchId, 'batch-export-0001');
  assert.equal(result.payload.offlineGrading.exportBatchId, 'batch-export-0001');
  assert.equal(result.payload.offlineGrading.addedRevisionCount, 1);
  assert.equal(result.payload.offlineGrading.identityView, 'pseudonyms');
});

test('reopening an exported graded package without edits produces no importable batch', () => {
  const payload = packagePayload();
  const firstDraft = core.normalizeDraft(null, payload);
  firstDraft.grades['s1:q1'] = { points: '24', feedback: 'Revised offline' };
  const first = core.appendOfflineGradeRevisions(
    payload,
    firstDraft,
    '2026-08-26T12:00:00.000Z',
    'batch-export-0001',
  );
  assert.equal(first.added, 1);

  const reopenedDraft = core.normalizeDraft(null, first.payload);
  const reopened = core.appendOfflineGradeRevisions(
    first.payload,
    reopenedDraft,
    '2026-08-26T13:00:00.000Z',
    'batch-export-0002',
  );
  assert.equal(reopened.added, 0);
  assert.equal(reopened.payload.offlineGrading.exportBatchId, 'batch-export-0002');
  assert.equal(reopened.payload.offlineGrading.addedRevisionCount, 0);
  assert.equal(
    reopened.payload.gradeRevisions.filter((grade) => grade.offlineExportBatchId === 'batch-export-0002').length,
    0,
  );
});

test('encrypted graded package round-trips with the existing PBKDF2 and AES-GCM format', async () => {
  const payload = packagePayload();
  const wrapper = await core.encryptPayload(payload, 'correct horse battery', webcrypto);
  assert.equal(wrapper.format, core.FORMAT);
  assert.equal(wrapper.algorithm, 'AES-GCM');
  assert.equal(wrapper.keyDerivation, 'PBKDF2-SHA256-310000');

  const decrypted = await core.decryptWrapper(wrapper, 'correct horse battery', webcrypto);
  assert.equal(decrypted.exam.id, 'exam-1');
  assert.equal(decrypted.exam.versionId, 'version-1');
  assert.equal(decrypted.sessions[0].fullName, 'Maria Dela Cruz');
});

test('large offline grading exports compact history and split into complete numbered sections', () => {
  const payload = packagePayload();
  payload.exam.questions = Array.from({ length: 4 }, (_, index) => ({
    id: `q${index + 1}`,
    type: 'essay',
    prompt: `Question ${index + 1}`,
    points: 25,
  }));
  payload.sessions = Array.from({ length: 3 }, (_, index) => ({
    id: `s${index + 1}`,
    fullName: `Student ${index + 1}`,
    studentNumber: `2026-${index + 1}`,
  }));
  payload.submissions = payload.sessions.map((session) => ({ sessionId: session.id }));
  payload.answerRevisions = [];
  payload.sessions.forEach((session) => payload.exam.questions.forEach((question) => {
    payload.answerRevisions.push({
      sessionId: session.id,
      questionId: question.id,
      answer: `old-${session.id}-${question.id}`,
    });
    payload.answerRevisions.push({
      sessionId: session.id,
      questionId: question.id,
      answer: `latest-${session.id}-${question.id}-${'x'.repeat(24_000)}`,
    });
  }));
  payload.gradeRevisions = [];

  const maximumBytes = 70 * 1024;
  const parts = core.splitOfflineGradingPayload(payload, maximumBytes, 'offline-set-0001');
  assert.equal(parts.length > 1, true);
  const coveredPairs = new Set();
  parts.forEach((part, index) => {
    assert.equal(part.offlinePackage.partNumber, index + 1);
    assert.equal(part.offlinePackage.partCount, parts.length);
    assert.equal(part.offlinePackage.setId, 'offline-set-0001');
    assert.equal(core.utf8ByteLength(part) <= maximumBytes, true);
    assert.equal(
      part.answerRevisions.length,
      part.sessions.length * part.exam.questions.length,
    );
    part.answerRevisions.forEach((answer) => {
      const key = `${answer.sessionId}:${answer.questionId}`;
      assert.equal(coveredPairs.has(key), false);
      coveredPairs.add(key);
      assert.match(answer.answer, /^latest-/);
    });
  });
  assert.equal(coveredPairs.size, payload.sessions.length * payload.exam.questions.length);
});

test('graded changes split into retry-safe import parts capped at one thousand grades', () => {
  const payload = packagePayload();
  payload.exam.questions = Array.from({ length: 145 }, (_, index) => ({
    id: `q${index + 1}`,
    type: 'essay',
    prompt: `Question ${index + 1}`,
    points: 10,
  }));
  payload.sessions = Array.from({ length: 7 }, (_, index) => ({
    id: `s${index + 1}`,
    fullName: `Student ${index + 1}`,
    studentNumber: `2026-${index + 1}`,
  }));
  payload.submissions = payload.sessions.map((session) => ({ sessionId: session.id }));
  payload.answerRevisions = [];
  payload.gradeRevisions = [];
  const draft = core.normalizeDraft(null, payload);
  payload.sessions.forEach((session) => payload.exam.questions.forEach((question) => {
    draft.grades[core.pairKey(session.id, question.id)] = {
      points: 8,
      feedback: `Feedback for ${session.id} ${question.id}`,
    };
  }));
  const merged = core.appendOfflineGradeRevisions(
    payload,
    draft,
    '2026-08-26T15:00:00.000Z',
    'batch-large-export-0001',
  );
  assert.equal(merged.added, 1015);

  const parts = core.splitOfflineGradeImportPayload(merged.payload);
  assert.equal(parts.length, 2);
  assert.deepEqual(Array.from(parts, (part) => part.gradeRevisions.length), [1000, 15]);
  assert.equal(new Set(parts.map((part) => part.offlineGrading.exportBatchId)).size, 2);
  assert.equal(parts.every((part) => part.answerRevisions.length === 0), true);
  assert.equal(parts.every((part) => part.offlineGrading.addedRevisionCount === part.gradeRevisions.length), true);
  assert.equal(parts.reduce((total, part) => total + part.gradeRevisions.length, 0), merged.added);
  parts.forEach((part, index) => {
    assert.equal(part.offlinePackage.kind, 'graded_import');
    assert.equal(part.offlinePackage.partNumber, index + 1);
    assert.equal(part.offlinePackage.partCount, parts.length);
    assert.equal(part.gradeRevisions.every((grade) => (
      grade.offlineExportBatchId === part.offlineGrading.exportBatchId
    )), true);
    assert.equal(core.utf8ByteLength(part) <= core.DEFAULT_MAX_PLAINTEXT_BYTES, true);
  });
});

test('offline workspace has no network dependency and exposes autosave/export controls', () => {
  assert.match(html, /id="package-file"/);
  assert.match(html, /id="pseudonym-toggle"/);
  assert.match(html, /Real student names are shown by default/);
  assert.match(html, /id="export-package"/);
  assert.match(html, /Large classes use numbered files/);
  assert.match(html, /select all numbered graded files together/i);
  assert.match(html, /offline-grading-core\.js\?v=greenfield-v1-20260826-3/);
  assert.match(client, /indexedDB\.open/);
  assert.match(client, /scheduleAutosave/);
  assert.doesNotMatch(client, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(client, /serviceWorker\.register\('\/service-worker\.js\?v=commercial-readiness-profile-analytics-offline-paid-expiry-20260827-1'/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.button\s*\{\s*transition:\s*none;/);
  assert.match(client, /MAX_PACKAGE_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/);
  assert.match(client, /splitOfflineGradeImportPayload/);
  assert.match(client, /numbered files/);
  assert.doesNotMatch(client, /ask the platform owner to divide the class/i);
  assert.match(client, /No new grade changes were found/);
  assert.match(client, /global\.crypto\.randomUUID\(\)/);
});
