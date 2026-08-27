'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const professorSource = fs.readFileSync(path.join(__dirname, 'professor.js'), 'utf8');
const professorHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const professorCss = fs.readFileSync(path.join(__dirname, 'professor.css'), 'utf8');
const rootExperience = fs.readFileSync(path.join(__dirname, '..', 'assets', 'phase2-experience.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'examination-room-admin.js'), 'utf8');

function fakeIndexedDb() {
  const records = new Map();
  const request = (work) => {
    const pending = {};
    setImmediate(() => {
      try {
        pending.result = work();
        pending.onsuccess?.();
      } catch (error) {
        pending.error = error;
        pending.onerror?.();
      }
    });
    return pending;
  };
  const objectStore = {
    put(record) { return request(() => { records.set(record.examId, structuredClone(record)); }); },
    get(examId) { return request(() => structuredClone(records.get(examId) || null)); },
    getAll() { return request(() => [...records.values()].map((record) => structuredClone(record))); },
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction() { return { objectStore: () => objectStore }; },
  };
  return {
    open() {
      const pending = {};
      setImmediate(() => {
        pending.result = database;
        pending.onsuccess?.();
      });
      return pending;
    },
  };
}

function loadProfessorStartupHooks({ storageBlocked = false, indexedDbAvailable = false } = {}) {
  class ExaminationRoomApiError extends Error {
    constructor(code, message, status, recovery) {
      super(message);
      this.code = code;
      this.status = status;
      this.recovery = recovery;
    }
  }
  let nextId = 0;
  const values = new Map();
  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error('Browser storage is blocked');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error('Browser storage is blocked');
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
  const window = {
    ExaminationRoomV1Api: { ExaminationRoomApiError, demoEnabled: () => false },
    ExaminationRoomV1ViewModels: null,
    DueDiligencePhase2Config: { features: {} },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}` },
    localStorage,
    indexedDB: indexedDbAvailable ? fakeIndexedDb() : null,
  };
  window.__scheduledTimers = new Map();
  window.__clearedTimers = [];
  window.setTimeout = (callback, delay) => {
    const id = window.__scheduledTimers.size + 1;
    window.__scheduledTimers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => {
    window.__clearedTimers.push(id);
    window.__scheduledTimers.delete(id);
  };
  const exposedSource = professorSource.replace(
    /\n\s*initialize\(\);\s*\n\}\)\(window\);\s*$/,
    '\n  global.__professorStartupTestHooks = { clientOnlyBlankDraft, editorExamFromStored, examContentFingerprint, normalizeAllowedEmails, invalidAllowedEmails, creatorAccessUnlocked, scheduleActivationPoll, stopActivationPolling, saveLocalDraft, readLocalDraft, readActiveLocalDraft, readLocalDraftIndex, localDraftBelongsToCurrentProfessor, prepareDecryptedGradePayload, validateCompleteGradedPackageSets, state };\n})(window);',
  );
  vm.runInNewContext(exposedSource, { window, indexedDB: window.indexedDB }, { filename: 'professor.js' });
  return { ...window.__professorStartupTestHooks, __testWindow: window };
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
  assert.doesNotMatch(professorSource, /global\.confirm\s*\(/);
  assert.match(professorSource, /function requestText\s*\(/);
  assert.match(professorSource, /function requestConfirmation\s*\(/);
  assert.match(professorHtml, /id="text-entry-dialog"/);
  assert.match(professorHtml, /id="text-entry-input"/);
  assert.match(professorHtml, /id="confirmation-dialog"/);
  assert.match(professorHtml, /id="confirmation-confirm"/);
});

test('offline grading copies remain passphrase-encrypted and examination-version bound', () => {
  assert.match(professorSource, /PBKDF2/);
  assert.match(professorSource, /iterations:\s*310_000/);
  assert.match(professorSource, /AES-GCM/);
  assert.match(professorSource, /payload\.exam\?\.versionId !== state\.exam\.versionId/);
  assert.match(professorSource, /at least 12 characters/i);
  assert.match(professorHtml, /href="offline-grading\.html"/);
  assert.match(professorHtml, /Download offline copy/);
  assert.match(professorHtml, /Open offline grading/);
  assert.match(professorHtml, /Import graded copy/);
  assert.match(professorSource, /source === 'offline_grading_workspace'/);
  assert.match(professorSource, /professorCommand\('import_grades'/);
  assert.match(professorSource, /importResult\.atomic !== true/);
  assert.doesNotMatch(professorSource, /for \(const grade of importedGrades\)[\s\S]{0,240}professorCommand\('save_grade'/);
  assert.match(professorSource, /serviceWorker\.register\('\/service-worker\.js\?v=examination-room-renovation-20260828-4'/);
  assert.match(professorSource, /await state\.offlineWorkspaceReady/);
  assert.match(professorSource, /MAX_OFFLINE_PACKAGE_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/);
  assert.match(professorSource, /jsonDownloadSize\(wrapper\)\s*>\s*MAX_OFFLINE_PACKAGE_BYTES/);
  assert.match(professorSource, /offlineGradingCore\.splitOfflineGradingPayload/);
  assert.match(professorSource, /numbered offline grading files downloaded/);
  assert.match(professorHtml, /offline-grading-core\.js\?v=greenfield-v1-20260826-3/);
  assert.match(professorHtml, /id="import-grading-package"[^>]*multiple/);
  assert.match(professorSource, /async function importGradingPackages\(selectedFiles\)/);
  assert.match(professorSource, /Select the complete numbered set again/);
  assert.doesNotMatch(professorSource, /ask the platform owner to export a smaller class section/i);
  assert.match(professorSource, /contains no new offline grade changes/i);
  assert.match(professorSource, /payload\.offlineGrading\?\.exportBatchId/);
  assert.match(professorSource, /offlineExportBatchId/);
  assert.match(professorSource, /offlineGrades\.length !== expectedChangeCount/);
  assert.match(professorSource, /professorCommand\('import_grades',[\s\S]*?\}, prepared\.exportBatchId\)/);
  assert.doesNotMatch(professorSource, /offlineGrades\.length\s*\?\s*offlineGrades\s*:\s*allGrades/);
});

test('recorded proctoring is optional, selectable, and never makes answer submission depend on storage', () => {
  assert.doesNotMatch(professorSource, /RECORDED_PROCTORING_AVAILABLE/);
  assert.doesNotMatch(professorSource, /Recorded proctoring is unavailable/);
  assert.match(professorHtml, /value="recorded_proctoring"/);
  assert.match(professorHtml, /id="camera-required"/);
  assert.match(professorHtml, /id="microphone-required"/);
  assert.match(professorHtml, /automatic storage fallback/i);
});

test('Professor prevalidates every numbered graded file before starting a multi-file import', () => {
  const {
    prepareDecryptedGradePayload,
    validateCompleteGradedPackageSets,
    state,
  } = loadProfessorStartupHooks();
  state.exam = { id: 'exam-1', versionId: 'version-1' };
  state.questions = [{ id: 'q1', points: 30 }];
  state.grading = { sessions: [{ id: 's1' }, { id: 's2' }] };
  const payloadFor = (partNumber, sessionId) => {
    const exportBatchId = `graded-set-0001-p${String(partNumber).padStart(4, '0')}`;
    return {
      exam: { id: 'exam-1', versionId: 'version-1' },
      gradeRevisions: [{
        sessionId,
        questionId: 'q1',
        points: 24,
        feedback: 'Offline feedback',
        source: 'offline_grading_workspace',
        offlineExportBatchId: exportBatchId,
      }],
      offlineGrading: { exportBatchId, addedRevisionCount: 1 },
      offlinePackage: {
        kind: 'graded_import',
        setId: 'graded-set-0001',
        partNumber,
        partCount: 2,
      },
    };
  };
  const first = prepareDecryptedGradePayload(payloadFor(1, 's1'));
  const second = prepareDecryptedGradePayload(payloadFor(2, 's2'));

  assert.throws(
    () => validateCompleteGradedPackageSets([first]),
    (error) => error.code === 'OFFLINE_GRADE_PART_MISSING' && /missing part 2/.test(error.message),
  );
  assert.doesNotThrow(() => validateCompleteGradedPackageSets([first, second]));
  assert.throws(
    () => validateCompleteGradedPackageSets([first, first]),
    (error) => error.code === 'OFFLINE_GRADE_FILE_DUPLICATE',
  );
  const sourceFirst = {
    ...first,
    exportBatchId: 'source-grade-part-0001',
    offlinePackage: {
      kind: 'graded_import',
      setId: 'source-grade-set-0001',
      partNumber: 1,
      partCount: 1,
      sourceSetId: 'original-source-set-0001',
      sourcePartNumber: 1,
      sourcePartCount: 2,
    },
  };
  const sourceSecond = {
    ...second,
    exportBatchId: 'source-grade-part-0002',
    offlinePackage: {
      kind: 'graded_import',
      setId: 'source-grade-set-0002',
      partNumber: 1,
      partCount: 1,
      sourceSetId: 'original-source-set-0001',
      sourcePartNumber: 2,
      sourcePartCount: 2,
    },
  };
  assert.throws(
    () => validateCompleteGradedPackageSets([sourceFirst]),
    (error) => error.code === 'OFFLINE_GRADE_SOURCE_PART_MISSING' && /original package 2 of 2/.test(error.message),
  );
  assert.doesNotThrow(() => validateCompleteGradedPackageSets([sourceFirst, sourceSecond]));
  assert.match(professorSource, /OFFLINE_GRADE_SOURCE_PART_MISSING/);
  assert.match(professorSource, /const preparedFiles = \[\][\s\S]*validateCompleteGradedPackageSets\(preparedFiles\)[\s\S]*for \(const prepared of preparedFiles\)/);
});

test('signed-out professor entry returns through the root Examination Room door and preserves that destination', () => {
  assert.match(professorHtml, /id="access-primary-action"[^>]*href="\.\.\/#examination-room"/);
  assert.doesNotMatch(professorHtml, /\?signin=1/);
  assert.match(rootExperience, /showEntry\(\{ allowDismiss: true, returnHash: '#examination-room' \}\)/);
  assert.match(rootExperience, /const storedReturn = safeSessionRead\(authReturnStorageKey\)/);
  assert.match(rootExperience, /const returnHash = safeReturnHash\(storedReturn\) \|\| '#quorum'/);
});

test('professor gate separates expired sign-in from a temporarily unavailable workspace', () => {
  assert.match(professorSource, /function showProfessorAccessFailure\(error\)/);
  assert.match(professorSource, /status === 401/);
  assert.match(professorSource, /'SIGN_IN_REQUIRED'/);
  assert.match(professorSource, /status === 403/);
  assert.match(professorSource, /'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN'/);
  assert.match(professorSource, /primary\.textContent = 'Sign in through Due Diligence'/);
  assert.match(professorSource, /primary\.textContent = 'Return to Examination Room doors'/);
  assert.match(professorSource, /recovery\.textContent = error\?\.recovery/);
  assert.match(professorHtml, /id="access-recovery"/);
});

test('live professor gate renders server recovery without mislabeling a workspace problem as sign-in', async () => {
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

  const workspaceRecovery = 'Ask Admin to reopen the law-school workspace.';
  const unavailable = await renderAccessFailure({
    code: 'EXAM_ROOM_V1_INSTITUTION_FORBIDDEN',
    status: 403,
    message: 'That law-school workspace is not available.',
    recovery: workspaceRecovery,
  });
  assert.equal(unavailable.get('#access-gate').dataset.accessState, 'workspace-unavailable');
  assert.equal(unavailable.get('#access-primary-action').textContent, 'Return to Examination Room doors');
  assert.equal(unavailable.get('#access-primary-action').href, '../#examination-room');
  assert.equal(unavailable.get('#access-recovery').textContent, workspaceRecovery);
});

test('admin professor test link uses an explicit live mode and never encodes demo false', () => {
  assert.match(adminSource, /function professorHref\(anchor = ''\)/);
  assert.match(adminSource, /query\.set\(api\?\.demoEnabled\?\.\(\) \? 'demo' : 'live', '1'\)/);
  assert.match(adminSource, /query\.set\('institution', state\.institutionId\)/);
  assert.doesNotMatch(adminSource, /\?demo=\$\{api\?\.demoEnabled/);
});

test('Professor startup accepts any signed-in creator and loads the full owner-bound draft after the session summary', () => {
  assert.doesNotMatch(professorSource, /result\.professor\?\.authorized !== true/);
  assert.doesNotMatch(professorSource, /PROFESSOR_ACCESS_REQUIRED/);
  assert.match(professorSource, /const requestedExamId = safeText\(params\.get\('exam'\), 80\)/);
  assert.match(professorSource, /summaries\.find\(\(candidate\) => examSummaryId\(candidate\) === requestedExamId\)/);
  assert.match(professorSource, /await api\.professorQuery\('exam', \{ examId: summaryExamId \}\)/);
  assert.match(professorSource, /editorExamFromStored\(details\?\.exam, summary, result\.professor\.institutionId\)/);
  assert.match(professorHtml, /id="exam-switcher"/);
});

test('Professor can create, duplicate, and switch among multiple creator-owned examinations', () => {
  assert.match(professorHtml, /data-action="new-exam"/);
  assert.match(professorHtml, /data-action="duplicate-exam"/);
  assert.match(professorSource, /function duplicateDraft\(source\)/);
  assert.match(professorSource, /id: global\.crypto\.randomUUID\(\)[\s\S]*versionId: null[\s\S]*status: 'draft'/);
  assert.match(professorSource, /questions: \(source\?\.questions \|\| \[\]\)\.map[\s\S]*id: global\.crypto\.randomUUID\(\)/);
  assert.match(professorSource, /async function createAnotherExam\(\{ duplicate = false, preserveCurrent = true \} = \{\}\)/);
  assert.match(professorSource, /navigateToExam\(savedExamId, 'create'\)/);
  assert.match(professorSource, /\$\('#exam-switcher'\)\.addEventListener\('change'/);
  assert.doesNotMatch(professorSource, /A duplicate will be created after the current draft finishes saving/);
});

test('a new Professor draft remains reachable after its first server save fails', async () => {
  const {
    clientOnlyBlankDraft,
    saveLocalDraft,
    readLocalDraft,
    readActiveLocalDraft,
    state,
  } = loadProfessorStartupHooks();
  state.professor = {
    id: '11111111-1111-4111-8111-111111111111',
    institutionId: '22222222-2222-4222-8222-222222222222',
  };
  const draft = clientOnlyBlankDraft(state.professor.institutionId);
  draft.title = 'Locally recovered Constitutional Law examination';
  await saveLocalDraft(draft);

  assert.equal((await readLocalDraft(draft.id)).exam.title, draft.title);
  assert.equal((await readActiveLocalDraft()).examId, draft.id);
  assert.match(professorSource, /const DRAFT_ACTIVE_KEY = 'duediligence\.examination-room\.v1\.professor-active-draft'/);
  assert.match(professorSource, /if \(result\.localOnly\) \{[\s\S]*replaceCurrentExamUrl\(draft\.id, 'create'\)/);
  assert.match(professorSource, /const activeLocalDraft = params\.get\('reset'\) === '1'[\s\S]*\(await readActiveLocalDraft\(\)\) \|\| localDrafts\[0\] \|\| null/);
  assert.match(professorSource, /const activeLocalServerSummary = summaries\.find\(\(candidate\) => examSummaryId\(candidate\) === activeLocalId\) \|\| null/);
  assert.match(professorSource, /const activeLocalPreferred = Boolean\(!requestedExamId && activeLocalDraft\?\.exam\)/);
  assert.match(professorSource, /activeLocalPreferred \? \(activeLocalServerSummary \|\| activeLocalDraft\.exam\) : defaultSummary/);

  state.professor.id = '33333333-3333-4333-8333-333333333333';
  assert.equal(await readActiveLocalDraft(), null);
});

test('multiple device-only drafts remain independently recoverable and are isolated by owner and institution', async () => {
  const {
    clientOnlyBlankDraft,
    saveLocalDraft,
    readLocalDraft,
    readActiveLocalDraft,
    readLocalDraftIndex,
    state,
  } = loadProfessorStartupHooks();
  const ownerUserId = '11111111-1111-4111-8111-111111111111';
  const institutionId = '22222222-2222-4222-8222-222222222222';
  state.professor = { id: ownerUserId, institutionId };

  const first = clientOnlyBlankDraft(institutionId);
  first.title = 'First device-only examination';
  const second = clientOnlyBlankDraft(institutionId);
  second.title = 'Second device-only examination';
  await saveLocalDraft(first);
  await saveLocalDraft(second);

  const recovered = await readLocalDraftIndex();
  assert.deepEqual(
    new Set(recovered.map((record) => record.examId)),
    new Set([first.id, second.id]),
  );
  assert.equal((await readLocalDraft(first.id)).exam.title, first.title);
  assert.equal((await readLocalDraft(second.id)).exam.title, second.title);
  assert.equal((await readActiveLocalDraft()).examId, second.id);

  state.professor.id = '33333333-3333-4333-8333-333333333333';
  assert.equal(await readLocalDraft(first.id), null);
  assert.equal(await readActiveLocalDraft(), null);
  assert.deepEqual(Array.from(await readLocalDraftIndex()), []);

  state.professor.id = ownerUserId;
  state.professor.institutionId = '44444444-4444-4444-8444-444444444444';
  assert.equal(await readLocalDraft(first.id), null);
  assert.equal(await readActiveLocalDraft(), null);
  assert.deepEqual(Array.from(await readLocalDraftIndex()), []);

  state.professor.institutionId = institutionId;
  assert.equal((await readLocalDraft(first.id)).exam.title, first.title);
  assert.equal((await readLocalDraft(second.id)).exam.title, second.title);
});

test('blocked browser storage reports that no device recovery copy was preserved', async () => {
  const {
    clientOnlyBlankDraft,
    saveLocalDraft,
    readLocalDraftIndex,
    state,
  } = loadProfessorStartupHooks({ storageBlocked: true });
  state.professor = {
    id: '11111111-1111-4111-8111-111111111111',
    institutionId: '22222222-2222-4222-8222-222222222222',
  };
  const draft = clientOnlyBlankDraft(state.professor.institutionId);

  await assert.rejects(
    saveLocalDraft(draft),
    (error) => (
      error.code === 'DEVICE_STORAGE_UNAVAILABLE'
      && error.status === 507
      && /Keep this page open/.test(error.recovery)
    ),
  );
  assert.deepEqual(Array.from(await readLocalDraftIndex()), []);
  assert.match(professorSource, /setSavedStatus\('error', 'Not saved — keep this page open'\)/);
  assert.match(professorSource, /The draft could not be saved on this device or backed up to the server\./);
  assert.match(professorSource, /saveLocalDraft\(exam\)[\s\S]{0,180}\.catch\(\(\) => setSavedStatus\('error', 'Device copy unavailable'\)\)/);
  assert.match(professorSource, /state\.saveTimer = setTimeout\(\(\) => saveDraft\(\{ force: false \}\)\.catch\(\(\) => null\), 1600\)/);
});

test('IndexedDB alone preserves and enumerates multiple drafts when localStorage is blocked', async () => {
  const {
    clientOnlyBlankDraft,
    saveLocalDraft,
    readLocalDraft,
    readLocalDraftIndex,
    state,
  } = loadProfessorStartupHooks({ storageBlocked: true, indexedDbAvailable: true });
  const ownerUserId = '11111111-1111-4111-8111-111111111111';
  const institutionId = '22222222-2222-4222-8222-222222222222';
  state.professor = { id: ownerUserId, institutionId };
  const first = clientOnlyBlankDraft(institutionId);
  const second = clientOnlyBlankDraft(institutionId);
  first.title = 'IndexedDB first examination';
  second.title = 'IndexedDB second examination';

  await saveLocalDraft(first);
  await saveLocalDraft(second);
  const recovered = await readLocalDraftIndex();
  assert.deepEqual(
    new Set(recovered.map((record) => record.examId)),
    new Set([first.id, second.id]),
  );
  assert.equal((await readLocalDraft(first.id)).exam.title, first.title);
  assert.equal((await readLocalDraft(second.id)).exam.title, second.title);

  state.professor.id = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual(Array.from(await readLocalDraftIndex()), []);
});

test('demo reset is consumed so later admin events cannot reset an approved room', () => {
  assert.match(
    professorSource,
    /if \(isDemo && params\.get\('reset'\) === '1'\)[\s\S]*cleanUrl\.searchParams\.delete\('reset'\)[\s\S]*global\.history\.replaceState/,
  );
});

test('server and device draft conflicts use a content baseline instead of comparing device clocks', () => {
  const { clientOnlyBlankDraft, examContentFingerprint } = loadProfessorStartupHooks();
  const original = clientOnlyBlankDraft('22222222-2222-4222-8222-222222222222');
  original.title = 'Constitutional Law';
  const clockOnlyChange = { ...original, updatedAt: '2099-01-01T00:00:00.000Z' };
  const contentChange = { ...original, title: 'Civil Law' };

  assert.equal(examContentFingerprint(original), examContentFingerprint(clockOnlyChange));
  assert.notEqual(examContentFingerprint(original), examContentFingerprint(contentChange));
  assert.match(professorSource, /serverBaselineFingerprint: state\.serverBaselineFingerprint/);
  assert.match(professorSource, /const activeLocalMissingFromServer = Boolean/);
  assert.match(professorSource, /This device and the server contain different changes/);
  assert.match(professorSource, /confirmLabel: 'Restore this device'/);
  assert.doesNotMatch(professorSource, /localTime\s*>\s*serverTime/);
});

test('Professor result release selection respects an intentional unchecked student', () => {
  assert.match(professorSource, /releaseSelectionSeenIds: new Set\(\)/);
  assert.match(professorSource, /if \(state\.releaseSelectionSeenIds\.has\(session\.id\)\) return/);
  assert.match(professorSource, /state\.releaseSelectionSeenIds\.add\(session\.id\)[\s\S]*state\.selectedReleaseIds\.add\(session\.id\)/);
  assert.doesNotMatch(professorSource, /sessions\.forEach\(\(session\) => state\.selectedReleaseIds\.add\(session\.id\)\)/);
});

test('live grading updates never overwrite points or feedback while the creator is editing', () => {
  assert.match(professorSource, /function gradingEditorHasUnsavedChanges\(\)/);
  assert.match(professorSource, /persisted\.points == null \? '' : String\(persisted\.points\)/);
  assert.match(professorSource, /String\(feedbackInput\?\.value \|\| ''\) !== persistedFeedback/);
  assert.match(professorSource, /state\.currentView === 'grade' && !gradingEditorHasUnsavedChanges\(\)/);
  assert.doesNotMatch(professorSource, /state\.currentView === 'grade'\) refreshGrading\(\)/);
});

test('optional anonymous grading starts consistently and never removes Professor control of real identities', () => {
  assert.match(professorSource, /state\.anonymousGrading = exam\.gradingIdentity === 'anonymous_grading' \|\| exam\.anonymousGrading === true/);
  assert.match(professorSource, /\$\('#anonymous-grading-toggle'\)\.checked = state\.anonymousGrading/);
  assert.match(professorSource, /realName: safeText\(session\?\.realFullName \|\| session\?\.fullName/);
  assert.match(professorSource, /realStudentNumber: safeText\(session\?\.realStudentNumber \|\| session\?\.studentNumber/);
  assert.match(professorSource, /alias: safeText\(session\?\.gradingAlias/);
  assert.match(professorSource, /state\.anonymousGrading \? identity\.alias : identity\.realName/);
  assert.match(professorSource, /The professor may reveal the real roster at any time\./);
});

test('a signed-in creator with no prior examination receives a safe unsaved client draft', () => {
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

test('student admission defaults to open key entry and never requires a roster upload', () => {
  const { clientOnlyBlankDraft } = loadProfessorStartupHooks();
  const draft = clientOnlyBlankDraft('11111111-1111-4111-8111-111111111111');
  assert.equal(draft.admissionMode, 'key_only');
  assert.deepEqual(Array.from(draft.allowedEmails), []);
  assert.match(professorHtml, /name="admission-mode" value="key_only" checked/);
  assert.match(professorHtml, /Anyone with the student key/);
  assert.doesNotMatch(professorHtml, /id="roster-upload"/);
  assert.doesNotMatch(professorSource, /Add at least one student/);
  assert.match(professorSource, /admissionMode === 'email_allowlist' \? normalizeAllowedEmails/);
});

test('Professor Create page contains its question cards at a 319px viewport', () => {
  assert.match(
    professorCss,
    /@media \(max-width: 390px\) \{[\s\S]*?\.questions-list[\s\S]*?\.question-layout[\s\S]*?\.choice-row/,
  );
  assert.match(professorHtml, /class="questions-list"/);
  assert.match(professorHtml, /professor\.css\?v=renovation-20260828-4/);
  assert.match(professorHtml, /api\.js\?v=renovation-20260828-4/);
});

test('optional email allowlist accepts newline or numbered entries and normalizes duplicates', () => {
  const { normalizeAllowedEmails, invalidAllowedEmails } = loadProfessorStartupHooks();
  assert.deepEqual(
    Array.from(normalizeAllowedEmails('Student@One.com\n1. second@two.com\nstudent@one.com')),
    ['student@one.com', 'second@two.com'],
  );
  assert.deepEqual(Array.from(normalizeAllowedEmails('1.email@gmail.com\n2.Email2@gmail.com')), [
    '1.email@gmail.com',
    '2.email2@gmail.com',
  ]);
  assert.deepEqual(Array.from(invalidAllowedEmails('valid@example.com\nnot-an-email')), ['not-an-email']);
  assert.match(professorHtml, /id="allowed-emails"/);
  assert.match(professorHtml, /No CSV upload is needed/);
});

test('creator receives monitor and grade access from activation without entering the student key', async () => {
  const hooks = loadProfessorStartupHooks();
  const { creatorAccessUnlocked, scheduleActivationPoll, stopActivationPolling, state, __testWindow } = hooks;
  state.exam = { id: 'exam-awaiting-key', status: 'awaiting_activation' };
  state.activation = null;
  assert.equal(creatorAccessUnlocked(), false);
  scheduleActivationPoll();
  assert.equal(state.activationTimer, 1);
  assert.equal(__testWindow.__scheduledTimers.get(1).delay, 4500);
  assert.equal(hooks.state.activationPollInFlight, false);

  const firstPoll = __testWindow.__scheduledTimers.get(1).callback;
  __testWindow.__scheduledTimers.delete(1);
  await firstPoll();
  assert.equal(state.activationPollInFlight, false);
  assert.equal(state.activationTimer, 1, 'a transient refresh failure schedules the next bounded poll');

  stopActivationPolling();
  assert.equal(state.activationTimer, null);
  assert.deepEqual(__testWindow.__clearedTimers, [1]);
  assert.equal(__testWindow.__scheduledTimers.size, 0);
  state.activation = { status: 'active' };
  assert.equal(creatorAccessUnlocked(), true);
  assert.doesNotMatch(professorHtml, /id="key-dialog"/);
  assert.doesNotMatch(professorSource, /professor-room-key/);
  assert.match(professorSource, /professorCommand\('open_room', \{ examId: state\.exam\.id \}/);
  assert.doesNotMatch(professorSource, /professorCommand\('open_room',[\s\S]{0,120}roomKey/);
  assert.match(professorSource, /global\.setTimeout\(async \(\) => \{[\s\S]*\}, 4500\)/);
  assert.match(professorSource, /finally \{[\s\S]*state\.activationPollInFlight = false;[\s\S]*scheduleActivationPoll\(\)/);
  assert.match(professorSource, /function stopActivationPolling\(\)[\s\S]*global\.clearTimeout\(state\.activationTimer\)[\s\S]*state\.activationTimer = null/);
  assert.match(professorSource, /Monitor and Grade are ready\. You do not need to enter the student key\./);
  assert.match(professorHtml, /data-view="monitor" data-requires-activation="true" disabled aria-label="Monitor examination — available after Admin issues the student key"/);
  assert.match(professorHtml, /data-view="grade" data-requires-activation="true" disabled aria-label="Grade submissions — available after Admin issues the student key"/);
  assert.match(professorSource, /control\.setAttribute\('aria-label', unlocked[\s\S]*viewName/);
  assert.match(professorHtml, /professor\.js\?v=renovation-20260828-4/);
});

test('creator approval survives reload and a published request keeps polling without a manual check', () => {
  const { creatorAccessUnlocked, scheduleActivationPoll, stopActivationPolling, state, __testWindow } = loadProfessorStartupHooks();

  state.exam = { id: 'exam-reloaded-pending', status: 'published', activation: null };
  state.activation = null;
  assert.equal(creatorAccessUnlocked(), false);
  scheduleActivationPoll();
  assert.equal(state.activationTimer, 1);
  assert.equal(__testWindow.__scheduledTimers.get(1).delay, 4500);
  stopActivationPolling();

  state.exam = {
    id: 'exam-reloaded-approved',
    status: 'published',
    activation: { id: 'activation-1', status: 'scheduled' },
  };
  state.activation = null;
  assert.equal(creatorAccessUnlocked(), true);
  scheduleActivationPoll();
  assert.equal(state.activationTimer, null);
  assert.match(professorSource, /state\.exam\?\.activation\?\.status/);
  assert.match(professorSource, /\['published', 'key_requested', 'awaiting_approval', 'awaiting_activation'\]/);
});

test('the Examination Assistant starts minimized and keeps an explicit accessible toggle state', () => {
  assert.match(professorHtml, /<aside class="assistant-panel is-minimized" id="assistant-panel"/);
  assert.match(professorHtml, /id="assistant-toggle"[^>]*aria-label="Open Examination Assistant"[^>]*aria-expanded="false"/);
  assert.match(professorSource, /setAttribute\('aria-label', minimized \? 'Open Examination Assistant' : 'Minimize Examination Assistant'\)/);
  assert.match(professorSource, /setAttribute\('aria-expanded', String\(!minimized\)\)/);
});

test('creator can kick or block a live student through the auditable revoke_session operation', () => {
  assert.match(professorSource, /async function revokeStudentSession\(sessionId, mode, trigger\)/);
  assert.match(professorSource, /professorCommand\('revoke_session', \{[\s\S]*examId: state\.exam\.id,[\s\S]*sessionId,[\s\S]*reason/);
  assert.match(professorSource, /data-revoke-mode="kick"/);
  assert.match(professorSource, /data-revoke-mode="block"/);
});

test('result release explains sent, skipped, and retry-safe email outcomes without hiding released grades', () => {
  assert.match(professorSource, /const delivery = result\.release\?\.delivery/);
  assert.match(professorSource, /Results released; email needs attention/);
  assert.match(professorSource, /Provider-accepted messages will not be resent/);
  assert.match(professorSource, /had no email and can view the result in the Student room/);
  assert.match(professorSource, /result email[\s\S]*accepted by the provider/);
});

test('the root Professor door has no role, license, membership, institution, or connectivity preflight', () => {
  const start = rootExperience.indexOf("async function checkProfessorDoor(institutionId = '')");
  const end = rootExperience.indexOf('function activateProfessorDoor()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const checkDoor = rootExperience.slice(start, end);
  assert.match(checkDoor, /if \(!token \|\| !state\.user\)/);
  assert.match(checkDoor, /button\.dataset\.destination = professorDoorDestination\(institutionId\)/);
  assert.doesNotMatch(checkDoor, /nativeWorkerRequest/);
  assert.doesNotMatch(checkDoor, /navigator\.onLine/);
  assert.doesNotMatch(checkDoor, /PROFESSOR_FORBIDDEN|license|membership/i);
});

test('date and start-time inputs are removed while key access remains explicit', () => {
  assert.doesNotMatch(professorSource, /Set the start date and time/);
  assert.doesNotMatch(professorSource, /The room cannot be scheduled without a start time/);
  assert.match(professorHtml, /No date or start time is required/);
  assert.doesNotMatch(professorHtml, /id="exam-date"/);
  assert.doesNotMatch(professorHtml, /id="start-control"/);
  assert.match(professorHtml, /Publish &amp; request key/);
  assert.match(professorSource, /startsAt:\s*null/);
});

test('creator monitoring shows a technical entry record without privacy-gate wording', () => {
  assert.doesNotMatch(professorSource, /Privacy warning record/);
  assert.match(professorSource, /<dt>Entry record<\/dt>/);
});
