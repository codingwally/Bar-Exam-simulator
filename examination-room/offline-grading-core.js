(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DueDiligenceOfflineGradingCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'duediligence-examination-room-offline-grading-v1';
  const ALGORITHM = 'AES-GCM';
  const KEY_DERIVATION = 'PBKDF2-SHA256-310000';
  const ITERATIONS = 310000;
  const MAX_FEEDBACK_LENGTH = 5000;
  const MAX_IMPORT_GRADES = 1000;
  const DEFAULT_MAX_PLAINTEXT_BYTES = Math.floor(((20 * 1024 * 1024) - 4096) * 0.74);

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function pairKey(sessionId, questionId) {
    return `${text(sessionId)}:${text(questionId)}`;
  }

  function latestRevisionMap(revisions) {
    const map = new Map();
    (Array.isArray(revisions) ? revisions : []).forEach((revision) => {
      if (!revision || !revision.sessionId || !revision.questionId) return;
      map.set(pairKey(revision.sessionId, revision.questionId), revision);
    });
    return map;
  }

  function submittedSessionIds(payload) {
    const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
    if (!submissions.length) return new Set((payload?.sessions || []).map((session) => session.id));
    return new Set(submissions.map((submission) => submission?.sessionId).filter(Boolean));
  }

  function validatePayload(payload) {
    assert(payload && typeof payload === 'object', 'The decrypted package is empty.');
    assert(payload.format === FORMAT, 'This is not a Due Diligence offline grading package.');
    assert(payload.exam && typeof payload.exam === 'object', 'The examination record is missing.');
    assert(text(payload.exam.id), 'The examination identifier is missing.');
    assert(text(payload.exam.versionId), 'The immutable examination version is missing.');
    assert(Array.isArray(payload.exam.questions), 'The examination questions are missing.');
    assert(Array.isArray(payload.sessions), 'The student roster is missing.');
    assert(Array.isArray(payload.answerRevisions), 'The submitted answers are missing.');

    const questionIds = new Set();
    payload.exam.questions.forEach((question, index) => {
      const id = text(question?.id || question?.questionId || question?.questionKey);
      assert(id, `Question ${index + 1} has no identifier.`);
      assert(!questionIds.has(id), `Question ${index + 1} has a duplicate identifier.`);
      questionIds.add(id);
      const points = Number(question?.points);
      assert(Number.isFinite(points) && points >= 0, `Question ${index + 1} has an invalid point value.`);
    });

    const sessionIds = new Set();
    payload.sessions.forEach((session, index) => {
      const id = text(session?.id || session?.sessionId);
      assert(id, `Student ${index + 1} has no session identifier.`);
      assert(!sessionIds.has(id), `Student ${index + 1} has a duplicate session identifier.`);
      sessionIds.add(id);
    });
    return payload;
  }

  function validateWrapper(wrapper) {
    assert(wrapper && typeof wrapper === 'object', 'The selected file is not valid JSON.');
    assert(wrapper.format === FORMAT, 'Choose a Due Diligence .ddgrade.json package.');
    assert(!wrapper.algorithm || wrapper.algorithm === ALGORITHM, 'The package encryption algorithm is not supported.');
    assert(!wrapper.keyDerivation || wrapper.keyDerivation === KEY_DERIVATION, 'The package key derivation is not supported.');
    assert(text(wrapper.salt) && text(wrapper.iv) && text(wrapper.ciphertext), 'The encrypted package is incomplete.');
    return wrapper;
  }

  function normalizeQuestion(question, index) {
    return {
      ...question,
      id: text(question.id || question.questionId || question.questionKey),
      prompt: text(question.prompt || question.text || `Question ${index + 1}`),
      points: Number(question.points) || 0,
      type: text(question.type || question.questionKind || 'essay'),
    };
  }

  function normalizeSession(session, index) {
    return {
      ...session,
      id: text(session.id || session.sessionId),
      fullName: text(session.fullName || session.name || `Student ${index + 1}`),
      studentNumber: text(session.studentNumber),
      yearLevel: text(session.yearLevel),
    };
  }

  function buildModel(payload) {
    validatePayload(payload);
    const questions = payload.exam.questions.map(normalizeQuestion);
    const submitted = submittedSessionIds(payload);
    const sessions = payload.sessions.map(normalizeSession).filter((session) => submitted.has(session.id));
    return {
      exam: { ...payload.exam, title: text(payload.exam.title || 'Untitled examination'), questions },
      questions,
      sessions,
      answers: latestRevisionMap(payload.answerRevisions),
      grades: latestRevisionMap(payload.gradeRevisions),
    };
  }

  function pseudonymFor(index) {
    return `Student ${String(index + 1).padStart(2, '0')}`;
  }

  function displayIdentity(session, index, usePseudonyms) {
    if (usePseudonyms) return { name: pseudonymFor(index), detail: 'Identity hidden only in this grading view' };
    const detail = [session.studentNumber, session.yearLevel].filter(Boolean).join(' · ');
    return { name: session.fullName || `Student ${index + 1}`, detail };
  }

  function answerText(answer, question) {
    if (answer == null || answer === '') return 'No saved answer was found for this question.';
    if (Array.isArray(answer)) return answer.map((entry) => answerText(entry, question)).join(', ');
    const questionType = text(question?.type || question?.questionKind).toLowerCase().replace(/[\s-]+/g, '_');
    if (questionType === 'multiple_choice') {
      const rawOptions = Array.isArray(question?.options) ? question.options : Array.isArray(question?.choices) ? question.choices : [];
      const options = rawOptions.map((option, index) => typeof option === 'string'
        ? { id: `option-${index + 1}`, label: option }
        : {
            id: text(option?.id ?? option?.key ?? option?.value, `option-${index + 1}`),
            label: text(option?.label ?? option?.text ?? option?.value, `Option ${index + 1}`),
          });
      const answerId = text(answer && typeof answer === 'object' ? answer.id ?? answer.key ?? answer.value ?? answer.selectedOption : answer);
      const exact = options.find((option) => option.id === answerId || option.label === answerId);
      if (exact) return exact.label;
      const numbered = /^(?:option|choice)[-_ ]?(\d+)$/i.exec(answerId);
      if (numbered && options[Number(numbered[1]) - 1]) return options[Number(numbered[1]) - 1].label;
      return answerId;
    }
    if (typeof answer === 'string') return answer;
    if (typeof answer === 'object') {
      if (typeof answer.text === 'string') return answer.text;
      if (Array.isArray(answer.selectedOptions)) return answer.selectedOptions.map(text).join(', ');
      if (answer.selectedOption != null) return text(answer.selectedOption);
      try { return JSON.stringify(answer); } catch (_) { return text(answer); }
    }
    return text(answer);
  }

  function normalizeDraft(draft, payload) {
    const valid = draft && draft.examId === payload.exam.id && draft.versionId === payload.exam.versionId;
    return {
      schemaVersion: 1,
      examId: payload.exam.id,
      versionId: payload.exam.versionId,
      updatedAt: valid ? text(draft.updatedAt) : '',
      usePseudonyms: Boolean(valid && draft.usePseudonyms === true),
      grades: valid && draft.grades && typeof draft.grades === 'object' ? { ...draft.grades } : {},
    };
  }

  function validateGrade(pointsValue, feedbackValue, maximum) {
    const feedback = text(feedbackValue).slice(0, MAX_FEEDBACK_LENGTH);
    if (pointsValue === '' || pointsValue == null) return { complete: false, points: '', feedback, error: '' };
    const points = Number(pointsValue);
    if (!Number.isFinite(points)) return { complete: false, points: pointsValue, feedback, error: 'Enter a number.' };
    if (points < 0) return { complete: false, points, feedback, error: 'Points cannot be below zero.' };
    if (points > Number(maximum)) return { complete: false, points, feedback, error: `Maximum: ${Number(maximum)} points.` };
    return { complete: true, points, feedback, error: '' };
  }

  function gradingProgress(model, draft) {
    const total = model.sessions.length * model.questions.length;
    let complete = 0;
    model.sessions.forEach((session) => model.questions.forEach((question) => {
      const key = pairKey(session.id, question.id);
      const value = Object.prototype.hasOwnProperty.call(draft.grades, key)
        ? draft.grades[key]
        : model.grades.get(key);
      if (value && validateGrade(value.points, value.feedback, question.points).complete) complete += 1;
    }));
    return { complete, total, remaining: Math.max(0, total - complete) };
  }

  function appendOfflineGradeRevisions(payload, draft, timestamp, exportBatchId) {
    const model = buildModel(payload);
    const exportedAt = timestamp || new Date().toISOString();
    const batchId = text(exportBatchId).trim();
    assert(batchId.length >= 8 && batchId.length <= 128, 'A unique offline export batch identifier is required.');
    const next = JSON.parse(JSON.stringify(payload));
    if (!Array.isArray(next.gradeRevisions)) next.gradeRevisions = [];
    let added = 0;

    model.sessions.forEach((session) => model.questions.forEach((question) => {
      const key = pairKey(session.id, question.id);
      if (!Object.prototype.hasOwnProperty.call(draft.grades, key)) return;
      const grade = validateGrade(draft.grades[key]?.points, draft.grades[key]?.feedback, question.points);
      if (!grade.complete) return;
      const previous = model.grades.get(key);
      if (previous && Number(previous.points) === grade.points && text(previous.feedback) === grade.feedback) return;
      next.gradeRevisions.push({
        sessionId: session.id,
        questionId: question.id,
        points: grade.points,
        feedback: grade.feedback,
        createdAt: exportedAt,
        source: 'offline_grading_workspace',
        offlineExportBatchId: batchId,
      });
      added += 1;
    }));

    next.offlineGrading = {
      workspaceVersion: 1,
      exportBatchId: batchId,
      exportedAt,
      addedRevisionCount: added,
      identityView: draft.usePseudonyms ? 'pseudonyms' : 'real_names',
    };
    return { payload: next, added };
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function utf8ByteLength(value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(serialized).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(serialized, 'utf8');
    return unescape(encodeURIComponent(serialized)).length;
  }

  function compactOfflinePayload(payload) {
    validatePayload(payload);
    const submitted = submittedSessionIds(payload);
    const sessions = payload.sessions.filter((session) => submitted.has(text(session?.id || session?.sessionId)));
    const sessionIds = new Set(sessions.map((session) => text(session?.id || session?.sessionId)));
    const questions = payload.exam.questions.map(normalizeQuestion);
    const questionIds = new Set(questions.map((question) => question.id));
    const keepRevision = (revision) => (
      sessionIds.has(text(revision?.sessionId))
      && questionIds.has(text(revision?.questionId || revision?.questionKey))
    );
    const submissions = new Map();
    (Array.isArray(payload.submissions) ? payload.submissions : []).forEach((submission) => {
      const sessionId = text(submission?.sessionId);
      if (sessionIds.has(sessionId)) submissions.set(sessionId, submission);
    });
    return {
      ...cloneJson(payload),
      exam: { ...cloneJson(payload.exam), questions: cloneJson(questions) },
      sessions: cloneJson(sessions),
      submissions: cloneJson([...submissions.values()]),
      answerRevisions: cloneJson([...latestRevisionMap(payload.answerRevisions).values()].filter(keepRevision)),
      gradeRevisions: cloneJson([...latestRevisionMap(payload.gradeRevisions).values()].filter(keepRevision)),
    };
  }

  function offlinePartPayload(base, sessions, questions, packageMetadata) {
    const sessionIds = new Set(sessions.map((session) => text(session?.id || session?.sessionId)));
    const questionIds = new Set(questions.map((question) => text(question?.id || question?.questionId || question?.questionKey)));
    const matchesPart = (entry) => (
      sessionIds.has(text(entry?.sessionId))
      && questionIds.has(text(entry?.questionId || entry?.questionKey))
    );
    return {
      ...cloneJson(base),
      exam: { ...cloneJson(base.exam), questions: cloneJson(questions) },
      sessions: cloneJson(sessions),
      submissions: cloneJson((base.submissions || []).filter((submission) => sessionIds.has(text(submission?.sessionId)))),
      answerRevisions: cloneJson((base.answerRevisions || []).filter(matchesPart)),
      gradeRevisions: cloneJson((base.gradeRevisions || []).filter(matchesPart)),
      offlinePackage: {
        schemaVersion: 1,
        kind: 'grading_source',
        ...packageMetadata,
        studentsInPart: sessions.length,
        questionsInPart: questions.length,
      },
    };
  }

  function splitOfflineGradingPayload(
    payload,
    maximumPlaintextBytes = DEFAULT_MAX_PLAINTEXT_BYTES,
    packageSetId = `offline-set-${Date.now()}`,
  ) {
    const limit = Number(maximumPlaintextBytes);
    const setId = text(packageSetId).trim();
    assert(Number.isSafeInteger(limit) && limit >= 64 * 1024, 'The offline package size limit is invalid.');
    assert(setId.length >= 8 && setId.length <= 128, 'A unique offline package-set identifier is required.');
    const base = compactOfflinePayload(payload);
    const sessions = base.sessions;
    const questions = base.exam.questions;
    assert(sessions.length > 0, 'No submitted answer files are available for offline grading.');
    assert(questions.length > 0, 'The examination has no questions available for offline grading.');
    const estimateMetadata = {
      setId,
      partNumber: 99999,
      partCount: 99999,
      totalStudents: sessions.length,
      totalQuestions: questions.length,
    };
    const fits = (partSessions, partQuestions) => utf8ByteLength(
      offlinePartPayload(base, partSessions, partQuestions, estimateMetadata),
    ) <= limit;
    const rawParts = [];
    const splitQuestions = (session, questionGroup) => {
      if (fits([session], questionGroup)) {
        rawParts.push({ sessions: [session], questions: questionGroup });
        return;
      }
      assert(questionGroup.length > 1, 'One submitted answer is too large for a safe offline package. Grade that student online.');
      const middle = Math.ceil(questionGroup.length / 2);
      splitQuestions(session, questionGroup.slice(0, middle));
      splitQuestions(session, questionGroup.slice(middle));
    };
    const splitSessions = (sessionGroup) => {
      if (fits(sessionGroup, questions)) {
        rawParts.push({ sessions: sessionGroup, questions });
        return;
      }
      if (sessionGroup.length === 1) {
        splitQuestions(sessionGroup[0], questions);
        return;
      }
      const middle = Math.ceil(sessionGroup.length / 2);
      splitSessions(sessionGroup.slice(0, middle));
      splitSessions(sessionGroup.slice(middle));
    };
    splitSessions(sessions);

    const partCount = rawParts.length;
    const parts = rawParts.map((part, index) => offlinePartPayload(base, part.sessions, part.questions, {
      setId,
      partNumber: index + 1,
      partCount,
      totalStudents: sessions.length,
      totalQuestions: questions.length,
    }));
    parts.forEach((part) => assert(
      utf8ByteLength(part) <= limit,
      'A numbered offline grading package still exceeds the safe file limit. Grade that section online.',
    ));
    return parts;
  }

  function gradeImportPartPayload(payload, grades, batchBaseId, partNumber, partCount, totalChanges) {
    const sessionIds = new Set(grades.map((grade) => text(grade.sessionId)));
    const questionIds = new Set(grades.map((grade) => text(grade.questionId)));
    const partBatchId = `${batchBaseId}-p${String(partNumber).padStart(4, '0')}`;
    const sessions = payload.sessions.filter((session) => sessionIds.has(text(session?.id || session?.sessionId)));
    const questions = payload.exam.questions.filter((question) => questionIds.has(text(question?.id || question?.questionId || question?.questionKey)));
    return {
      format: FORMAT,
      exportedAt: payload.offlineGrading?.exportedAt || payload.exportedAt || new Date().toISOString(),
      exam: {
        id: payload.exam.id,
        versionId: payload.exam.versionId,
        title: payload.exam.title,
        questions: cloneJson(questions),
      },
      sessions: cloneJson(sessions),
      submissions: [],
      answerRevisions: [],
      gradeRevisions: cloneJson(grades).map((grade) => ({ ...grade, offlineExportBatchId: partBatchId })),
      privacy: payload.privacy,
      offlineGrading: {
        ...cloneJson(payload.offlineGrading || {}),
        exportBatchId: partBatchId,
        addedRevisionCount: grades.length,
        partNumber,
        partCount,
      },
      offlinePackage: {
        schemaVersion: 1,
        kind: 'graded_import',
        setId: batchBaseId,
        sourceSetId: payload.offlinePackage?.setId || null,
        sourcePartNumber: payload.offlinePackage?.partNumber || 1,
        sourcePartCount: payload.offlinePackage?.partCount || 1,
        partNumber,
        partCount,
        totalGradeChanges: totalChanges,
        gradeChangesInPart: grades.length,
      },
    };
  }

  function splitOfflineGradeImportPayload(
    payload,
    maximumPlaintextBytes = DEFAULT_MAX_PLAINTEXT_BYTES,
    maximumGrades = MAX_IMPORT_GRADES,
  ) {
    validatePayload(payload);
    const limit = Number(maximumPlaintextBytes);
    const gradeLimit = Number(maximumGrades);
    const batchBaseId = text(payload.offlineGrading?.exportBatchId).trim();
    assert(Number.isSafeInteger(limit) && limit >= 64 * 1024, 'The graded package size limit is invalid.');
    assert(Number.isSafeInteger(gradeLimit) && gradeLimit >= 1 && gradeLimit <= MAX_IMPORT_GRADES, 'The graded import batch limit is invalid.');
    assert(batchBaseId.length >= 8 && batchBaseId.length <= 110, 'A unique offline export batch identifier is required.');
    const changes = (payload.gradeRevisions || []).filter((grade) => (
      grade?.source === 'offline_grading_workspace'
      && text(grade?.offlineExportBatchId) === batchBaseId
    ));
    assert(changes.length > 0, 'No new grade changes are available to export.');
    const rawParts = [];
    const splitGradeGroup = (gradeGroup) => {
      const placeholder = gradeImportPartPayload(payload, gradeGroup, batchBaseId, 99999, 99999, changes.length);
      if (gradeGroup.length <= gradeLimit && utf8ByteLength(placeholder) <= limit) {
        rawParts.push(gradeGroup);
        return;
      }
      assert(gradeGroup.length > 1, 'One grade record is too large for a safe import package. Shorten its feedback, then export again.');
      const middle = Math.ceil(gradeGroup.length / 2);
      splitGradeGroup(gradeGroup.slice(0, middle));
      splitGradeGroup(gradeGroup.slice(middle));
    };
    for (let start = 0; start < changes.length; start += gradeLimit) {
      splitGradeGroup(changes.slice(start, start + gradeLimit));
    }
    const partCount = rawParts.length;
    const parts = rawParts.map((grades, index) => gradeImportPartPayload(
      payload,
      grades,
      batchBaseId,
      index + 1,
      partCount,
      changes.length,
    ));
    parts.forEach((part) => {
      assert(part.gradeRevisions.length <= gradeLimit, 'A graded import part contains too many grade changes.');
      assert(utf8ByteLength(part) <= limit, 'A numbered graded import part still exceeds the safe file limit.');
    });
    return parts;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    if (typeof btoa === 'function') return btoa(binary);
    if (typeof Buffer !== 'undefined') return Buffer.from(binary, 'binary').toString('base64');
    throw new Error('Base64 encoding is unavailable.');
  }

  function base64ToBytes(value) {
    const binary = typeof atob === 'function'
      ? atob(value)
      : typeof Buffer !== 'undefined'
        ? Buffer.from(value, 'base64').toString('binary')
        : '';
    assert(binary || value === '', 'Base64 decoding is unavailable.');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function deriveKey(passphrase, salt, cryptoImpl) {
    assert(text(passphrase).length >= 12, 'Enter the passphrase used when the package was created.');
    const cryptoApi = cryptoImpl || (typeof crypto !== 'undefined' ? crypto : null);
    assert(cryptoApi?.subtle, 'Web Crypto is unavailable in this browser.');
    const material = await cryptoApi.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return cryptoApi.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      material,
      { name: ALGORITHM, length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function decryptWrapper(wrapper, passphrase, cryptoImpl) {
    validateWrapper(wrapper);
    const cryptoApi = cryptoImpl || (typeof crypto !== 'undefined' ? crypto : null);
    const salt = base64ToBytes(wrapper.salt);
    const iv = base64ToBytes(wrapper.iv);
    const key = await deriveKey(passphrase, salt, cryptoApi);
    const decrypted = await cryptoApi.subtle.decrypt({ name: ALGORITHM, iv }, key, base64ToBytes(wrapper.ciphertext));
    const payload = JSON.parse(new TextDecoder().decode(decrypted));
    validatePayload(payload);
    return payload;
  }

  async function encryptPayload(payload, passphrase, cryptoImpl) {
    validatePayload(payload);
    const cryptoApi = cryptoImpl || (typeof crypto !== 'undefined' ? crypto : null);
    assert(cryptoApi?.getRandomValues && cryptoApi?.subtle, 'Web Crypto is unavailable in this browser.');
    const salt = cryptoApi.getRandomValues(new Uint8Array(16));
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, cryptoApi);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = new Uint8Array(await cryptoApi.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext));
    return {
      format: FORMAT,
      algorithm: ALGORITHM,
      keyDerivation: KEY_DERIVATION,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(encrypted),
    };
  }

  return Object.freeze({
    FORMAT,
    ALGORITHM,
    KEY_DERIVATION,
    ITERATIONS,
    MAX_FEEDBACK_LENGTH,
    MAX_IMPORT_GRADES,
    DEFAULT_MAX_PLAINTEXT_BYTES,
    pairKey,
    latestRevisionMap,
    validatePayload,
    validateWrapper,
    buildModel,
    pseudonymFor,
    displayIdentity,
    answerText,
    normalizeDraft,
    validateGrade,
    gradingProgress,
    appendOfflineGradeRevisions,
    utf8ByteLength,
    compactOfflinePayload,
    splitOfflineGradingPayload,
    splitOfflineGradeImportPayload,
    decryptWrapper,
    encryptPayload,
  });
});
