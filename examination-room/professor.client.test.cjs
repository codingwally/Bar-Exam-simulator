'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const professorSource = fs.readFileSync(path.join(__dirname, 'professor.js'), 'utf8');
const professorHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const rootExperience = fs.readFileSync(path.join(__dirname, '..', 'assets', 'phase2-experience.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'examination-room-admin.js'), 'utf8');

function loadProfessorStartupHooks() {
  class ExaminationRoomApiError extends Error {
    constructor(code, message, status, recovery) {
      super(message);
      this.code = code;
      this.status = status;
      this.recovery = recovery;
    }
  }
  let nextId = 0;
  const window = {
    ExaminationRoomV1Api: { ExaminationRoomApiError },
    ExaminationRoomV1ViewModels: null,
    DueDiligencePhase2Config: { features: {} },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}` },
  };
  const exposedSource = professorSource.replace(
    /\n\s*initialize\(\);\s*\n\}\)\(window\);\s*$/,
    '\n  global.__professorStartupTestHooks = { clientOnlyBlankDraft, editorExamFromStored };\n})(window);',
  );
  vm.runInNewContext(exposedSource, { window }, { filename: 'professor.js' });
  return window.__professorStartupTestHooks;
}

async function renderAccessFailure(error) {
  const elements = new Map([
    ['#loading-gate', { hidden: false, dataset: {}, textContent: '' }],
    ['#access-gate', { hidden: true, dataset: {}, textContent: '' }],
    ['#access-title', { textContent: '' }],
    ['#access-copy', { textContent: '' }],
    ['#access-primary-action', { href: '', textContent: '' }],
    ['#access-recovery', { textContent: '' }],
  ]);
  const document = {
    querySelector(selector) { return elements.get(selector) || null; },
    querySelectorAll() { return []; },
  };
  const window = {
    ExaminationRoomV1Api: {
      demoEnabled: () => false,
      professorQuery: async () => { throw error; },
    },
    ExaminationRoomV1ViewModels: null,
    DueDiligencePhase2Config: { features: {} },
    location: { search: '', hash: '' },
  };
  vm.runInNewContext(professorSource, { window, document, URLSearchParams }, { filename: 'professor.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return elements;
}

test('professor text and passphrase entry never depend on blocking browser prompts', () => {
  assert.doesNotMatch(professorSource, /global\.prompt\s*\(/);
  assert.match(professorSource, /function requestText\s*\(/);
  assert.match(professorHtml, /id="text-entry-dialog"/);
  assert.match(professorHtml, /id="text-entry-input"/);
});

test('offline grading copies remain passphrase-encrypted and examination-version bound', () => {
  assert.match(professorSource, /PBKDF2/);
  assert.match(professorSource, /iterations:\s*310_000/);
  assert.match(professorSource, /AES-GCM/);
  assert.match(professorSource, /payload\.exam\?\.versionId !== state\.exam\.versionId/);
  assert.match(professorSource, /at least 12 characters/i);
});

test('recorded proctoring remains visible but publication fails closed until its media service exists', () => {
  assert.match(professorSource, /RECORDED_PROCTORING_AVAILABLE/);
  assert.match(professorSource, /Recorded proctoring is not configured/);
  assert.match(professorHtml, /id="recording-availability"/);
});

test('signed-out professor entry returns through the root Examination Room door and preserves that destination', () => {
  assert.match(professorHtml, /id="access-primary-action"[^>]*href="\.\.\/#examination-room"/);
  assert.doesNotMatch(professorHtml, /\?signin=1/);
  assert.match(rootExperience, /showEntry\(\{ allowDismiss: true, returnHash: '#examination-room' \}\)/);
  assert.match(rootExperience, /const storedReturn = safeSessionRead\(authReturnStorageKey\)/);
  assert.match(rootExperience, /const returnHash = safeReturnHash\(storedReturn\) \|\| '#quorum'/);
});

test('professor gate separates expired sign-in from an authenticated account without staff assignment', () => {
  assert.match(professorSource, /function showProfessorAccessFailure\(error\)/);
  assert.match(professorSource, /status === 401/);
  assert.match(professorSource, /'SIGN_IN_REQUIRED'/);
  assert.match(professorSource, /status === 403/);
  assert.match(professorSource, /'EXAM_ROOM_V1_PROFESSOR_FORBIDDEN'/);
  assert.match(professorSource, /primary\.textContent = 'Sign in through Due Diligence'/);
  assert.match(professorSource, /primary\.textContent = 'Return to Examination Room doors'/);
  assert.match(professorSource, /recovery\.textContent = error\?\.recovery/);
  assert.match(professorHtml, /id="access-recovery"/);
});

test('live professor gate renders server recovery without looping an unassigned signed-in account back to sign-in', async () => {
  const signInRecovery = 'Sign in securely, then return to the Examination Room menu.';
  const signedOut = await renderAccessFailure({
    code: 'EXAM_ROOM_V1_PROFESSOR_SIGN_IN_REQUIRED',
    status: 401,
    message: 'Professor sign-in is required.',
    recovery: signInRecovery,
  });
  assert.equal(signedOut.get('#access-gate').dataset.accessState, 'sign-in-required');
  assert.equal(signedOut.get('#access-primary-action').textContent, 'Sign in through Due Diligence');
  assert.equal(signedOut.get('#access-primary-action').href, '../#examination-room');
  assert.equal(signedOut.get('#access-recovery').textContent, signInRecovery);

  const assignmentRecovery = 'Ask an administrator to activate the professor role for this account.';
  const unassigned = await renderAccessFailure({
    code: 'EXAM_ROOM_V1_PROFESSOR_FORBIDDEN',
    status: 403,
    message: 'This account is not authorized as a professor.',
    recovery: assignmentRecovery,
  });
  assert.equal(unassigned.get('#access-gate').dataset.accessState, 'assignment-required');
  assert.equal(unassigned.get('#access-primary-action').textContent, 'Return to Examination Room doors');
  assert.equal(unassigned.get('#access-primary-action').href, '../#examination-room');
  assert.equal(unassigned.get('#access-recovery').textContent, assignmentRecovery);
});

test('admin professor test link uses an explicit live mode and never encodes demo false', () => {
  assert.match(adminSource, /function professorTestHref\(\)/);
  assert.match(adminSource, /params\.set\(api\?\.demoEnabled\?\.\(\) \? 'demo' : 'live', '1'\)/);
  assert.match(adminSource, /params\.set\('institution', state\.institutionId\)/);
  assert.doesNotMatch(adminSource, /\?demo=\$\{api\?\.demoEnabled/);
});

test('Professor startup fails closed and loads the full protected draft after the session summary', () => {
  assert.match(professorSource, /result\.professor\?\.authorized !== true/);
  assert.match(professorSource, /await api\.professorQuery\('exam', \{ examId: summaryExamId \}\)/);
  assert.match(professorSource, /editorExamFromStored\(details\?\.exam, summary, result\.professor\.institutionId\)/);
});

test('a newly approved Professor receives a safe unsaved client draft', () => {
  const { clientOnlyBlankDraft } = loadProfessorStartupHooks();
  const first = clientOnlyBlankDraft('11111111-1111-4111-8111-111111111111');
  const second = clientOnlyBlankDraft('11111111-1111-4111-8111-111111111111');

  assert.notEqual(first.id, second.id);
  assert.equal(first.institutionId, '11111111-1111-4111-8111-111111111111');
  assert.equal(first.versionId, null);
  assert.equal(first.status, 'draft');
  assert.equal(first.privacyNoticeVersion, 'exam-room-v1');
  assert.deepEqual(Array.from(first.questions), []);
  assert.deepEqual(Array.from(first.roster), []);
  assert.match(professorSource, /New draft · not saved yet/);
});

test('a returning Professor receives questions, roster, and controls from the protected full draft', () => {
  const { editorExamFromStored } = loadProfessorStartupHooks();
  const exam = editorExamFromStored({
    examId: '22222222-2222-4222-8222-222222222222',
    title: 'Constitutional Law Final',
    instructions: 'Use ALAC.',
    durationMinutes: 180,
    controls: {
      subject: 'Constitutional Law',
      yearLevel: 'Fourth year',
      jurisdiction: 'Philippines',
      startsAt: '2026-08-27T01:00:00.000Z',
      lateSubmissions: 'professor_review',
      navigation: 'sequential',
      identityMode: 'anonymous_grading',
      integrityTier: 'focus_monitoring',
      privacyNoticeVersion: 'exam-room-v1',
    },
    questions: [{
      questionKey: 'question-1',
      questionKind: 'multiple_choice',
      prompt: 'Which court has expanded judicial power?',
      points: 10,
      choices: ['Supreme Court', 'Court of Appeals'],
      correctOptionIndex: 0,
      wordLimit: 250,
    }],
    roster: [{
      id: '33333333-3333-4333-8333-333333333333',
      fullName: 'Maria Santos',
      studentNumber: '2026-0001',
      email: 'maria@example.edu.ph',
      yearLevel: 'Fourth year',
      extraMinutes: 15,
    }],
  }, {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'draft',
    updatedAt: '2026-08-26T08:00:00.000Z',
  }, '44444444-4444-4444-8444-444444444444');

  assert.equal(exam.id, '22222222-2222-4222-8222-222222222222');
  assert.equal(exam.subject, 'Constitutional Law');
  assert.equal(exam.gradingIdentity, 'anonymous_grading');
  assert.equal(exam.integrityTier, 'focus_monitoring');
  assert.equal(exam.questions.length, 1);
  assert.equal(exam.questions[0].id, 'question-1');
  assert.equal(exam.questions[0].type, 'multiple_choice');
  assert.deepEqual(Array.from(exam.questions[0].options), ['Supreme Court', 'Court of Appeals']);
  assert.equal(exam.questions[0].correctOption, 0);
  assert.equal(exam.questions[0].wordGuideline, 'Up to 250 words');
  assert.equal(exam.roster[0].fullName, 'Maria Santos');
  assert.equal(exam.updatedAt, '2026-08-26T08:00:00.000Z');
});
