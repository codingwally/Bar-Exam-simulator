(function examinationRoomV1Api(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config || {};
  const viewModels = global.ExaminationRoomV1ViewModels;
  const DEMO_KEY = 'DD26-LAW1-826K';
  const DEMO_STATE_KEY = 'duediligence.examination-room.v1.demo-state';
  const DEMO_EVENT_KEY = 'duediligence.examination-room.v1.demo-event';
  const listeners = new Set();
  const studentCompatibility = {
    lastEntry: null,
    lastPreview: null,
  };
  const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('duediligence-examination-room-v1-demo')
    : null;

  class ExaminationRoomApiError extends Error {
    constructor(code, message, status = 400, recovery = '', details = null) {
      super(message);
      this.name = 'ExaminationRoomApiError';
      this.code = code;
      this.status = status;
      this.recovery = recovery;
      this.details = details;
    }
  }

  function demoEnabled() {
    const query = new URLSearchParams(global.location?.search || '');
    if (query.get('demo') === '1') return true;
    return ['localhost', '127.0.0.1'].includes(global.location?.hostname)
      && query.get('live') !== '1';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function iso(offsetMilliseconds = 0) {
    return new Date(Date.now() + offsetMilliseconds).toISOString();
  }

  function requestId() {
    return global.crypto?.randomUUID?.()
      || `req_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }

  function staffPayload(payload = {}) {
    const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload }
      : {};
    if (safePayload.institutionId) return safePayload;
    const institutionId = new URLSearchParams(global.location?.search || '').get('institution') || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
      safePayload.institutionId = institutionId;
    }
    return safePayload;
  }

  function initialState() {
    const examId = '8f275845-a250-4a13-b0db-d40d57a2b826';
    const versionId = '47aa9b2a-9aa7-43e8-a71a-30e91ef8f101';
    const institutionId = '64f82d39-274e-4ce4-b92a-8430ae3f7b10';
    const administratorUserId = 'd7b0f7fd-08ec-40dd-aac7-c3ccfafc1311';
    return {
      schemaVersion: 4,
      institution: {
        id: institutionId,
        code: 'counsels-canvas-law',
        name: 'Counsel’s Canvas College of Law',
      },
      professor: {
        userId: '20be2ffd-b9af-455d-9f4d-a696c9030a11',
        institutionId,
        displayName: 'Prof. Elena M. Villanueva',
        email: 'elena.villanueva@law.example.edu.ph',
        authorized: true,
      },
      staff: [
        {
          membershipId: '0c36a4a5-e2c7-4d0e-a346-967673080986',
          userId: administratorUserId,
          staffRole: 'admin',
          displayName: 'Founder Administrator',
          email: 'founder@duediligence.ph',
          status: 'active',
          isCurrentAdministrator: true,
          grantedAt: iso(-24 * 60 * 60 * 1000),
        },
        {
          membershipId: '1f43825c-0f0c-4538-9527-67ef44e313a3',
          userId: '20be2ffd-b9af-455d-9f4d-a696c9030a11',
          staffRole: 'professor',
          displayName: 'Prof. Elena M. Villanueva',
          email: 'elena.villanueva@law.example.edu.ph',
          status: 'active',
          isCurrentAdministrator: false,
          grantedAt: iso(-23 * 60 * 60 * 1000),
        },
      ],
      professorRequests: [{
        requestId: '81f1a867-8e0e-481a-9204-2716354fbb38',
        userId: 'f5cbdaf4-95ab-4f0c-b82d-23e7d24e1f83',
        email: 'rafael.mendoza@law.example.edu.ph',
        displayName: 'Atty. Rafael Mendoza',
        schoolId: 'counsels-canvas-college-of-law',
        schoolName: 'Counsel’s Canvas College of Law',
        status: 'pending',
        requestedAt: iso(-2 * 60 * 60 * 1000),
      }],
      exam: {
        id: examId,
        institutionId,
        versionId,
        ownerUserId: '20be2ffd-b9af-455d-9f4d-a696c9030a11',
        status: 'draft',
        title: 'Constitutional Law — Midterm Examination',
        subject: 'Constitutional Law',
        jurisdiction: 'Philippines',
        yearLevel: 'Second year',
        instructions: 'Answer each question completely. Identify the controlling doctrine, apply it to the facts, and state a clear conclusion.',
        durationMinutes: 120,
        startsAt: '2026-08-26T01:00:00.000Z',
        lateSubmissions: 'not_allowed',
        navigation: 'free',
        gradingIdentity: 'real_names',
        integrityTier: 'standard',
        cameraRequired: false,
        microphoneRequired: false,
        sourceFileName: 'Constitutional_Law_Midterm.docx',
        sourceFileSize: 191488,
        privacyNoticeVersion: 'exam-room-privacy-v1-2026-08-26',
        privacyController: 'The participating law school, with Due Diligence acting as its examination service provider',
        retentionSummary: 'Exam records follow the school’s published academic-record policy. Optional recordings follow the shorter review and appeal period shown before the exam.',
        questions: [
          {
            id: 'q-1', number: 1, type: 'essay', points: 30,
            prompt: 'Discuss the doctrine of separation of powers under the 1987 Philippine Constitution. In your answer, explain its foundations, identify at least three (3) mechanisms that maintain the balance among the branches of government, and analyze a relevant Supreme Court decision that illustrates the doctrine in practice.',
            wordGuideline: '600–800 words', required: true,
          },
          {
            id: 'q-2', number: 2, type: 'essay', points: 25,
            prompt: 'Critically analyze the extent of judicial review in the Philippines. Discuss the standards used by the Supreme Court in reviewing acts of Congress and the Executive, and evaluate the tension between judicial review and democratic accountability.',
            wordGuideline: '500–700 words', required: true,
          },
          {
            id: 'q-3', number: 3, type: 'short_answer', points: 20,
            prompt: 'State the requisites of judicial inquiry and briefly explain each.',
            wordGuideline: '250–350 words', required: true,
          },
          {
            id: 'q-4', number: 4, type: 'multiple_choice', points: 25,
            prompt: 'Which constitutional body has the exclusive authority to promulgate rules concerning pleading, practice, and procedure in all courts?',
            options: ['Congress', 'Supreme Court', 'Judicial and Bar Council', 'Department of Justice'],
            correctOption: 1, required: true,
          },
        ],
        roster: [
          { id: 's-1', fullName: 'Maria Theresa Dela Cruz', studentNumber: '2024-10001', email: 'maria.delacruz@law.example.edu.ph', yearLevel: 'Second year', extraMinutes: 0 },
          { id: 's-2', fullName: 'Jose Antonio Santos', studentNumber: '2024-10002', email: 'jose.santos@law.example.edu.ph', yearLevel: 'Second year', extraMinutes: 0 },
          { id: 's-3', fullName: 'Juan Miguel Reyes', studentNumber: '2024-10003', email: 'juan.reyes@law.example.edu.ph', yearLevel: 'Second year', extraMinutes: 15 },
          { id: 's-4', fullName: 'Ana Patricia Garcia', studentNumber: '2024-10004', email: 'ana.garcia@law.example.edu.ph', yearLevel: 'Second year', extraMinutes: 0 },
          { id: 's-5', fullName: 'Gabriel Andre Lim', studentNumber: '2024-10005', email: 'gabriel.lim@law.example.edu.ph', yearLevel: 'Second year', extraMinutes: 0 },
        ],
        updatedAt: iso(),
        publishedAt: null,
      },
      examLibrary: [],
      activation: null,
      sessions: [],
      answerRevisions: [],
      submissions: [],
      incidents: [],
      gradeRevisions: [],
      releases: [],
      snapshots: [],
      audit: [],
    };
  }

  function readDemoState() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(DEMO_STATE_KEY) || 'null');
      if (parsed?.schemaVersion === 4 && parsed?.exam?.id && Array.isArray(parsed.examLibrary)) return parsed;
    } catch {
      // A corrupt demo copy is recoverable by rebuilding the deterministic fixture.
    }
    const state = initialState();
    writeDemoState(state, 'fixture_initialized');
    return state;
  }

  function writeDemoState(state, eventType = 'state_changed') {
    state.schemaVersion = 4;
    global.localStorage?.setItem(DEMO_STATE_KEY, JSON.stringify(state));
    const event = { type: eventType, at: iso(), nonce: requestId() };
    global.localStorage?.setItem(DEMO_EVENT_KEY, JSON.stringify(event));
    channel?.postMessage(event);
    listeners.forEach((listener) => listener(event));
  }

  function resetDemo() {
    const state = initialState();
    writeDemoState(state, 'fixture_reset');
    return clone(state);
  }

  const DEMO_EXAM_BUNDLE_FIELDS = Object.freeze([
    'exam',
    'activation',
    'sessions',
    'answerRevisions',
    'submissions',
    'incidents',
    'gradeRevisions',
    'releases',
    'snapshots',
  ]);

  function currentDemoExamBundle(state) {
    return Object.fromEntries(DEMO_EXAM_BUNDLE_FIELDS.map((field) => [field, clone(state[field])]));
  }

  function applyDemoExamBundle(state, bundle) {
    DEMO_EXAM_BUNDLE_FIELDS.forEach((field) => { state[field] = clone(bundle[field]); });
  }

  function activateDemoExam(state, examId) {
    const requestedId = String(examId || '').trim();
    if (!requestedId || requestedId === state.exam.id) return true;
    const index = state.examLibrary.findIndex((bundle) => bundle?.exam?.id === requestedId);
    if (index < 0) return false;
    const current = currentDemoExamBundle(state);
    const selected = state.examLibrary[index];
    state.examLibrary[index] = current;
    applyDemoExamBundle(state, selected);
    return true;
  }

  function allDemoExamBundles(state) {
    return [currentDemoExamBundle(state), ...state.examLibrary.map((bundle) => clone(bundle))];
  }

  function demoExamSummaries(state) {
    return allDemoExamBundles(state).map((bundle) => clone(bundle.exam));
  }

  function requireDemoExam(state, examId) {
    if (activateDemoExam(state, examId)) return;
    throw new ExaminationRoomApiError(
      'EXAM_NOT_FOUND',
      'That examination is not available in this Professor workspace.',
      404,
      'Return to the examination switcher and choose one of your saved examinations.',
    );
  }

  function normalizeKey(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^DD26/, '');
  }

  function validDemoKey(value) {
    return normalizeKey(value) === normalizeKey(DEMO_KEY);
  }

  function required(value, field, maximum = 200) {
    const result = String(value || '').replace(/\s+/g, ' ').trim();
    if (!result) {
      throw new ExaminationRoomApiError(
        'FIELD_REQUIRED',
        `${field} is required. Enter it, then try again.`,
        400,
        `Return to ${field.toLowerCase()} and complete the field.`,
      );
    }
    if (result.length > maximum) {
      throw new ExaminationRoomApiError(
        'FIELD_TOO_LONG',
        `${field} is too long. Shorten it to ${maximum} characters or fewer.`,
        400,
        `Shorten ${field.toLowerCase()}, then retry.`,
      );
    }
    return result;
  }

  function examPublicMetadata(exam, activation) {
    return {
      examId: exam.id,
      title: exam.title,
      subject: exam.subject,
      yearLevel: exam.yearLevel,
      durationMinutes: exam.durationMinutes,
      startsAt: exam.startsAt,
      integrityTier: exam.integrityTier,
      cameraRequired: exam.cameraRequired,
      microphoneRequired: exam.microphoneRequired,
      privacyNoticeVersion: exam.privacyNoticeVersion,
      privacyController: exam.privacyController,
      retentionSummary: exam.retentionSummary,
      activationStatus: activation?.status || 'unavailable',
    };
  }

  function studentSafeQuestions(questions = []) {
    return questions.map((question, index) => {
      if (viewModels?.normalizeStudentQuestion) return viewModels.normalizeStudentQuestion(question, index);
      const { correctOption: _correctOption, correctOptionIndex: _correctOptionIndex, gradingGuidance: _gradingGuidance, acceptedAnswers: _acceptedAnswers, ...safeQuestion } = clone(question);
      return safeQuestion;
    });
  }

  function studentSafeExam(exam) {
    return {
      id: exam.id || exam.examinationId,
      examinationId: exam.examinationId || exam.id,
      version: exam.version,
      versionId: exam.versionId,
      title: exam.title,
      subject: exam.subject,
      yearLevel: exam.yearLevel,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      questions: studentSafeQuestions(exam.questions || []),
    };
  }

  function studentForIdentity(state, identity) {
    const studentNumber = required(identity.studentNumber, 'Student number', 48).toUpperCase();
    const fullName = required(identity.fullName, 'Full name', 160);
    const rosterStudent = state.exam.roster.find((student) => (
      student.studentNumber.toUpperCase() === studentNumber
    ));
    if (!rosterStudent) {
      throw new ExaminationRoomApiError(
        'ROSTER_NOT_FOUND',
        'That student number is not on this examination roster.',
        403,
        'Check the number on your school ID. If it is correct, ask the professor to update the roster before trying again.',
      );
    }
    const canonicalName = fullName.toLocaleLowerCase('en-PH').replace(/[^a-z0-9]/g, '');
    const rosterName = rosterStudent.fullName.toLocaleLowerCase('en-PH').replace(/[^a-z0-9]/g, '');
    if (canonicalName !== rosterName) {
      throw new ExaminationRoomApiError(
        'ROSTER_NAME_MISMATCH',
        'The name and student number do not match the examination roster.',
        403,
        'Enter your complete registered name. If the roster is wrong, ask the professor to correct it.',
      );
    }
    return rosterStudent;
  }

  function demoProfessorQuery(operation, payload = {}) {
    const state = readDemoState();
    if (operation === 'session') return { ok: true, professor: clone(state.professor), exam: clone(state.exam), exams: demoExamSummaries(state) };
    if (operation === 'exam') {
      requireDemoExam(state, payload.examId);
      writeDemoState(state, 'professor_exam_selected');
      return { ok: true, exam: clone(state.exam), activation: clone(state.activation) };
    }
    if (operation === 'monitor') {
      requireDemoExam(state, payload.examId);
      writeDemoState(state, 'professor_exam_selected');
      return {
        ok: true,
        exam: clone(state.exam),
        activation: clone(state.activation),
        sessions: clone(state.sessions),
        submissions: clone(state.submissions),
        incidents: clone(state.incidents),
        generatedAt: iso(),
      };
    }
    if (operation === 'grading') {
      requireDemoExam(state, payload.examId);
      writeDemoState(state, 'professor_exam_selected');
      return {
        ok: true,
        exam: clone(state.exam),
        sessions: clone(state.sessions),
        submissions: clone(state.submissions),
        answerRevisions: clone(state.answerRevisions),
        gradeRevisions: clone(state.gradeRevisions),
        releases: clone(state.releases),
      };
    }
    throw new ExaminationRoomApiError('UNSUPPORTED_OPERATION', 'That professor view is not available. Return to the examination list and try again.', 400);
  }

  function demoProfessorCommand(operation, payload = {}, idempotencyKey = requestId()) {
    const state = readDemoState();
    if (operation !== 'save_draft') {
      const requestedExamId = payload.examId || payload.exam?.id;
      if (requestedExamId) requireDemoExam(state, requestedExamId);
    }
    if (operation === 'save_draft') {
      const incoming = clone(payload.exam || {});
      const incomingId = String(incoming.id || incoming.examId || state.exam.id);
      if (incomingId !== state.exam.id && state.examLibrary.some((bundle) => bundle?.exam?.id === incomingId)) {
        activateDemoExam(state, incomingId);
      }
      const previousBundle = currentDemoExamBundle(state);
      const createsAnotherExam = incomingId !== state.exam.id;
      state.exam = {
        ...(createsAnotherExam ? initialState().exam : state.exam),
        ...incoming,
        id: incomingId,
        versionId: createsAnotherExam ? null : (incoming.versionId || state.exam.versionId),
        status: createsAnotherExam ? 'draft' : (incoming.status || state.exam.status),
        updatedAt: iso(),
      };
      if (createsAnotherExam) {
        state.examLibrary.push(previousBundle);
        state.activation = null;
        state.sessions = [];
        state.answerRevisions = [];
        state.submissions = [];
        state.incidents = [];
        state.gradeRevisions = [];
        state.releases = [];
        state.snapshots = [];
      }
      state.audit.push({ type: 'draft_saved', actor: 'professor', at: iso(), requestId: idempotencyKey });
      writeDemoState(state, 'draft_saved');
      return { ok: true, exam: clone(state.exam), savedAt: state.exam.updatedAt };
    }
    if (operation === 'publish') {
      if (!state.exam.title || !state.exam.subject || !state.exam.questions?.length || !state.exam.roster?.length) {
        throw new ExaminationRoomApiError('EXAM_NOT_READY', 'This examination still has missing required information.', 409, 'Open Review items, complete each required field, then publish again.');
      }
      state.exam = {
        ...state.exam,
        ...clone(payload.exam || {}),
        status: 'awaiting_activation',
        publishedAt: iso(),
        updatedAt: iso(),
      };
      state.snapshots.push({ type: 'published_version', at: iso(), versionId: state.exam.versionId, exam: clone(state.exam) });
      state.audit.push({ type: 'exam_published', actor: 'professor', at: iso(), requestId: idempotencyKey });
      writeDemoState(state, 'exam_published');
      return { ok: true, exam: clone(state.exam), nextAction: 'wait_for_admin_key' };
    }
    if (operation === 'open_room') {
      if (!state.activation || !validDemoKey(payload.roomKey)) {
        throw new ExaminationRoomApiError('ROOM_KEY_INVALID', 'The room key is not valid for this examination.', 403, 'Copy the current key from the administrator email or ask the administrator to issue a replacement.');
      }
      state.activation.status = 'open';
      state.exam.status = 'open';
      state.activation.openedAt = iso();
      writeDemoState(state, 'room_opened');
      return { ok: true, exam: clone(state.exam), activation: clone(state.activation) };
    }
    if (operation === 'close_room') {
      state.exam.status = 'grading';
      if (state.activation) state.activation.status = 'closed';
      writeDemoState(state, 'room_closed');
      return { ok: true, status: 'grading' };
    }
    if (operation === 'save_grade') {
      const sessionId = required(payload.sessionId, 'Student session', 80);
      const questionId = required(payload.questionId, 'Question', 80);
      const points = Number(payload.points);
      const question = state.exam.questions.find((entry) => entry.id === questionId);
      if (!question || !Number.isFinite(points) || points < 0 || points > question.points) {
        throw new ExaminationRoomApiError('GRADE_INVALID', 'The score must be between zero and the question’s point value.', 400, 'Correct the score, then save again.');
      }
      const revision = {
        id: requestId(), sessionId, questionId, points,
        feedback: String(payload.feedback || '').trim().slice(0, 5000),
        at: iso(), requestId: idempotencyKey,
      };
      state.gradeRevisions.push(revision);
      state.audit.push({ type: 'grade_saved', actor: 'professor', at: revision.at, sessionId, questionId });
      writeDemoState(state, 'grade_saved');
      return { ok: true, revision: clone(revision), savedAt: revision.at };
    }
    if (operation === 'import_grades') {
      if (payload.examId !== state.exam.id) {
        throw new ExaminationRoomApiError(
          'OFFLINE_GRADE_EXAM_MISMATCH',
          'This graded file belongs to another examination.',
          409,
          'Choose the graded file exported from this exact examination.',
        );
      }
      if (!Array.isArray(payload.grades) || payload.grades.length < 1 || payload.grades.length > 1000) {
        throw new ExaminationRoomApiError(
          'OFFLINE_GRADE_BATCH_INVALID',
          'Choose a graded file containing 1 to 1,000 changed grades.',
          400,
          'Return to the offline grading copy, save at least one changed grade, export it, then import that file.',
        );
      }
      const existing = state.gradeRevisions.filter((grade) => (
        grade.source === 'offline_grading_workspace' && grade.requestId === idempotencyKey
      ));
      if (existing.length) {
        const sessionIds = [...new Set(existing.map((grade) => grade.sessionId))];
        return {
          ok: true,
          duplicate: true,
          atomic: true,
          importedCount: existing.length,
          importedRevisionCount: sessionIds.length,
          receipts: sessionIds.map((sessionId) => ({
            sessionId,
            questionCount: existing.filter((grade) => grade.sessionId === sessionId).length,
          })),
        };
      }

      const seen = new Set();
      const importedAt = iso();
      const revisions = payload.grades.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || Object.keys(entry).some((key) => !['sessionId', 'questionId', 'points', 'feedback'].includes(key))) {
          throw new ExaminationRoomApiError(
            'OFFLINE_GRADE_INVALID',
            `Changed grade ${index + 1} is not in the expected format.`,
            400,
            'Export a fresh graded file from the Due Diligence offline workspace, then import it again.',
          );
        }
        const sessionId = required(entry.sessionId, `Changed grade ${index + 1} student session`, 80);
        const questionId = required(entry.questionId, `Changed grade ${index + 1} question`, 80);
        const session = state.sessions.find((candidate) => candidate.id === sessionId);
        const submission = state.submissions.find((candidate) => candidate.sessionId === sessionId);
        const question = state.exam.questions.find((candidate) => candidate.id === questionId);
        const points = Number(entry.points);
        const feedback = entry.feedback == null ? '' : entry.feedback;
        const identity = `${sessionId}:${questionId}`;
        if (!session || !submission) {
          throw new ExaminationRoomApiError(
            'OFFLINE_GRADE_SESSION_NOT_FOUND',
            `Changed grade ${index + 1} does not match a submitted student session.`,
            409,
            'Refresh online grading, export a new offline copy, and import that matching file.',
          );
        }
        if (!question) {
          throw new ExaminationRoomApiError(
            'OFFLINE_GRADE_QUESTION_NOT_FOUND',
            `Changed grade ${index + 1} does not match a question in this examination.`,
            409,
            'Export a new offline copy of this examination, grade it, and import the fresh file.',
          );
        }
        if (seen.has(identity)) {
          throw new ExaminationRoomApiError(
            'OFFLINE_GRADE_DUPLICATE',
            `The graded file contains the same student and question more than once.`,
            409,
            'Keep the latest changed grade for that question, export again, then retry the import.',
          );
        }
        if (!Number.isFinite(points) || points < 0 || points > question.points
            || typeof feedback !== 'string' || feedback.length > 5000) {
          throw new ExaminationRoomApiError(
            'OFFLINE_GRADE_INVALID',
            `Changed grade ${index + 1} has an invalid score or feedback value.`,
            400,
            `Enter a score from zero to ${question.points}, shorten feedback if needed, export again, then retry.`,
          );
        }
        seen.add(identity);
        return {
          id: requestId(),
          sessionId,
          questionId,
          points,
          feedback: feedback.trim(),
          at: importedAt,
          requestId: idempotencyKey,
          source: 'offline_grading_workspace',
        };
      });
      const sessionIds = [...new Set(revisions.map((grade) => grade.sessionId))];
      state.gradeRevisions.push(...revisions);
      state.audit.push({
        type: 'offline_grades_imported',
        actor: 'professor',
        at: importedAt,
        requestId: idempotencyKey,
        gradeCount: revisions.length,
        sessionCount: sessionIds.length,
      });
      writeDemoState(state, 'offline_grades_imported');
      return {
        ok: true,
        duplicate: false,
        atomic: true,
        importedCount: revisions.length,
        importedRevisionCount: sessionIds.length,
        receipts: sessionIds.map((sessionId) => ({
          sessionId,
          questionCount: revisions.filter((grade) => grade.sessionId === sessionId).length,
        })),
      };
    }
    if (operation === 'release_results') {
      const sessionIds = [...new Set((payload.sessionIds || []).map(String))];
      if (!sessionIds.length) throw new ExaminationRoomApiError('RESULT_RECIPIENT_REQUIRED', 'Select at least one student before releasing results.', 400, 'Select the intended students, review the recipient list, then release again.');
      const incomplete = sessionIds.find((sessionId) => state.exam.questions.some((question) => (
        !state.gradeRevisions.some((grade) => grade.sessionId === sessionId && grade.questionId === question.id)
      )));
      if (incomplete) {
        throw new ExaminationRoomApiError(
          'RESULT_GRADE_INCOMPLETE',
          'Every question needs a saved grade before this result can be released.',
          409,
          'Open the selected student, enter points and feedback for every question, save each grade, then release again.',
        );
      }
      const release = { id: requestId(), sessionIds, at: iso(), requestId: idempotencyKey };
      state.releases.push(release);
      state.exam.status = 'results_released';
      writeDemoState(state, 'results_released');
      return { ok: true, release: clone(release), emailStatus: 'demo_delivered' };
    }
    throw new ExaminationRoomApiError('UNSUPPORTED_OPERATION', 'That professor action is not available. Refresh the page and try again.', 400);
  }

  function demoStudentPreview(payload = {}) {
    const state = readDemoState();
    if (!state.activation || !validDemoKey(payload.roomKey)) {
      throw new ExaminationRoomApiError('ROOM_KEY_INVALID', 'We could not find an active examination for that room key.', 404, 'Check every character. If the key is correct, ask the professor whether the room has been opened.');
    }
    if (!['active', 'open'].includes(state.activation.status)) {
      throw new ExaminationRoomApiError('ROOM_NOT_OPEN', 'The examination room is not open yet.', 409, 'Keep this page open and try again when the professor announces that the room is open.');
    }
    const student = studentForIdentity(state, payload.identity || payload);
    if (required(payload.subject, 'Subject', 120).toLowerCase() !== state.exam.subject.toLowerCase()) {
      throw new ExaminationRoomApiError('SUBJECT_MISMATCH', 'The subject does not match this examination.', 400, 'Choose the subject shown by your professor, then try again.');
    }
    required(payload.yearLevel, 'Year level', 80);
    return {
      ok: true,
      metadata: {
        ...examPublicMetadata(state.exam, state.activation),
        examVersion: state.exam.versionId,
        professor: state.professor.displayName,
        questionCount: state.exam.questions.length,
        noticeVersion: state.exam.privacyNoticeVersion,
        opensAt: state.activation.openedAt || state.activation.issuedAt,
        closesAt: state.activation.expiresAt,
        safeguards: [
          'Answers are saved locally first and synchronized when connected.',
          'Focus, visibility, connection, and fullscreen changes are recorded for professor review.',
          state.exam.cameraRequired || state.exam.microphoneRequired
            ? 'Camera or microphone recording is used only when the professor enabled it and the notice explains it.'
            : 'This examination does not require camera or microphone recording.',
        ],
      },
      notice: {
        version: state.exam.privacyNoticeVersion,
        title: 'Privacy and examination integrity notice',
        intro: 'Review what this examination records before any question is revealed.',
        items: [
          'Your real name, student number, subject, and year level are used to match you to the professor’s roster.',
          'Your answers, submission receipt, and grading record are retained under your school’s academic-record policy.',
          'Focus, page visibility, connection, and fullscreen changes are logged with timestamps for contextual review.',
          state.exam.cameraRequired
            ? 'Camera recording is enabled for this examination and starts only after you agree and begin.'
            : 'Camera recording is not enabled for this examination.',
          state.exam.microphoneRequired
            ? 'Microphone recording is enabled for this examination and starts only after you agree and begin.'
            : 'Microphone recording is not enabled for this examination.',
          'An integrity event is not by itself a finding of misconduct; the professor must review it in context.',
        ],
        retention: state.exam.retentionSummary,
        contact: 'Contact your professor or examination administrator before beginning if you need an accommodation or clarification.',
      },
      identity: clone(student),
    };
  }

  function demoStudentConsent(payload = {}, idempotencyKey = requestId()) {
    const state = readDemoState();
    if (!state.activation || !validDemoKey(payload.roomKey)) {
      throw new ExaminationRoomApiError('ROOM_KEY_INVALID', 'The room key is no longer valid.', 403, 'Return to the join page and enter the current key.');
    }
    const student = studentForIdentity(state, payload.identity || payload);
    if (payload.noticeVersion !== state.exam.privacyNoticeVersion || payload.agreed !== true) {
      throw new ExaminationRoomApiError('PRIVACY_AGREEMENT_REQUIRED', 'Review and agree to the current examination privacy notice before beginning.', 412, 'Read the notice, choose Agree and begin, then continue.');
    }
    const recordingRequired = state.exam.integrityTier === 'recorded_proctoring' || state.exam.cameraRequired || state.exam.microphoneRequired;
    if (recordingRequired && payload.recordingAccepted !== true) {
      throw new ExaminationRoomApiError('RECORDING_CONSENT_REQUIRED', 'This examination requires explicit recording agreement.', 412, 'Agree to recording or ask the professor for another permitted arrangement.');
    }
    let session = state.sessions.find((entry) => entry.studentNumber === student.studentNumber);
    if (!session) {
      session = {
        id: requestId(), examId: state.exam.id, studentId: student.id,
        fullName: student.fullName, studentNumber: student.studentNumber,
        subject: state.exam.subject, yearLevel: student.yearLevel,
        status: 'in_progress', connected: true, currentQuestion: 1,
        consentVersion: payload.noticeVersion, consentedAt: iso(), recordingAccepted: recordingRequired,
        startedAt: iso(), lastSeenAt: iso(), extraMinutes: student.extraMinutes || 0,
      };
      state.sessions.push(session);
      state.audit.push({ type: 'privacy_agreed', actor: 'student', at: session.consentedAt, sessionId: session.id, requestId: idempotencyKey, noticeVersion: payload.noticeVersion });
    }
    writeDemoState(state, 'student_started');
    return {
      ok: true,
      session: clone(session),
      exam: studentSafeExam(state.exam),
      serverTime: iso(),
    };
  }

  function demoStudentQuery(operation, payload = {}) {
    const state = readDemoState();
    const session = state.sessions.find((entry) => entry.id === payload.sessionId);
    if (!session) throw new ExaminationRoomApiError('SESSION_NOT_FOUND', 'This examination session could not be restored.', 404, 'Return to the join page and use the same room key and student details. Your server-backed answers remain preserved.');
    if (operation === 'resume') {
      return {
        ok: true, session: clone(session),
        exam: studentSafeExam(state.exam),
        revisions: clone(state.answerRevisions.filter((entry) => entry.sessionId === session.id)),
        submission: clone(state.submissions.find((entry) => entry.sessionId === session.id) || null),
        serverTime: iso(),
      };
    }
    if (operation === 'result') {
      const release = [...state.releases].reverse().find((entry) => entry.sessionIds.includes(session.id)) || null;
      const latestGrades = new Map();
      state.gradeRevisions
        .filter((entry) => entry.sessionId === session.id)
        .forEach((entry) => latestGrades.set(entry.questionId, entry));
      return {
        ok: true,
        released: Boolean(release),
        release: release ? { id: release.id, at: release.at } : null,
        grades: release ? clone([...latestGrades.values()]) : [],
        exam: {
          title: state.exam.title,
          questions: state.exam.questions.map((question) => ({ id: question.id, number: question.number, points: question.points })),
        },
        serverTime: iso(),
      };
    }
    throw new ExaminationRoomApiError('UNSUPPORTED_OPERATION', 'That student view is not available. Return to your examination and try again.', 400);
  }

  function demoStudentCommand(operation, payload = {}, idempotencyKey = requestId()) {
    const state = readDemoState();
    const session = state.sessions.find((entry) => entry.id === payload.sessionId);
    if (!session) throw new ExaminationRoomApiError('SESSION_NOT_FOUND', 'This examination session could not be found.', 404, 'Reconnect using the same room key and student details.');
    if (operation === 'save_answer') {
      const question = state.exam.questions.find((entry) => entry.id === payload.questionId);
      if (!question) throw new ExaminationRoomApiError('QUESTION_NOT_FOUND', 'That question is no longer available in this examination version.', 409, 'Refresh the examination. Your other saved answers will remain available.');
      const existing = state.answerRevisions.find((entry) => entry.requestId === idempotencyKey);
      if (existing) return { ok: true, revision: clone(existing), duplicate: true };
      const revision = {
        id: requestId(), sessionId: session.id, questionId: question.id,
        revision: 1 + state.answerRevisions.filter((entry) => entry.sessionId === session.id && entry.questionId === question.id).length,
        answer: clone(payload.answer), flagged: Boolean(payload.flagged),
        contentHash: String(payload.contentHash || '').slice(0, 128) || null,
        savedAt: iso(), requestId: idempotencyKey,
      };
      state.answerRevisions.push(revision);
      session.currentQuestion = question.number;
      session.lastSeenAt = revision.savedAt;
      session.connected = true;
      writeDemoState(state, 'answer_saved');
      return { ok: true, revision: clone(revision), serverBackedUpAt: revision.savedAt };
    }
    if (operation === 'record_event') {
      const incident = {
        id: requestId(), sessionId: session.id,
        type: required(payload.type, 'Event type', 80),
        severity: ['info', 'warning', 'review'].includes(payload.severity) ? payload.severity : 'info',
        occurredAt: payload.occurredAt || iso(),
      };
      state.incidents.push(incident);
      session.lastSeenAt = iso();
      writeDemoState(state, 'integrity_event');
      return { ok: true, incident: clone(incident) };
    }
    if (operation === 'heartbeat') {
      session.connected = payload.connected !== false;
      session.lastSeenAt = iso();
      session.currentQuestion = Number(payload.currentQuestion) || session.currentQuestion;
      writeDemoState(state, 'heartbeat');
      return { ok: true, serverTime: iso() };
    }
    if (operation === 'submit') {
      const existing = state.submissions.find((entry) => entry.requestId === idempotencyKey || entry.sessionId === session.id);
      if (existing) return { ok: true, submission: clone(existing), duplicate: true };
      const answeredIds = [...new Set(state.answerRevisions.filter((entry) => entry.sessionId === session.id).map((entry) => entry.questionId))];
      const submission = {
        id: requestId(), sessionId: session.id, examVersionId: state.exam.versionId,
        submittedAt: iso(), answeredQuestionIds: answeredIds,
        receiptCode: `DD-RCPT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        manifestHash: String(payload.manifestHash || '').slice(0, 128) || requestId().replace(/-/g, ''),
        requestId: idempotencyKey,
      };
      state.submissions.push(submission);
      session.status = 'submitted';
      session.submittedAt = submission.submittedAt;
      state.snapshots.push({ type: 'submission', at: submission.submittedAt, submission: clone(submission) });
      writeDemoState(state, 'student_submitted');
      return { ok: true, submission: clone(submission) };
    }
    throw new ExaminationRoomApiError('UNSUPPORTED_OPERATION', 'That student action is not available. Refresh the page and try again.', 400);
  }

  function demoAdminQuery(operation, payload = {}) {
    const state = readDemoState();
    if (operation === 'access') {
      return {
        ok: true,
        canManageRoles: true,
        institutions: [{
          institutionId: state.institution.id,
          institutionCode: state.institution.code,
          institutionName: state.institution.name,
          institutionStatus: 'active',
          membershipId: state.staff.find((member) => member.isCurrentAdministrator)?.membershipId,
          staffRole: 'admin',
          active: true,
          professorCount: state.staff.filter((member) => member.staffRole === 'professor' && member.status === 'active').length,
          adminCount: state.staff.filter((member) => member.staffRole === 'admin' && member.status === 'active').length,
        }],
      };
    }
    if (operation === 'staff_directory') {
      return { ok: true, institution: clone(state.institution), staff: clone(state.staff), professorRequests: clone((state.professorRequests || []).filter((request) => request.status === 'pending')) };
    }
    if (operation === 'preflight') {
      return {
        ok: true,
        ready: true,
        checkedAt: iso(),
        checks: [
          { id: 'owner_data_key', ok: true, status: 'ready', message: 'Demo room-key protection is ready.' },
          { id: 'owner_email_recipients', ok: true, status: 'ready', message: 'The demo owner email copy is ready.' },
          { id: 'key_email_delivery', ok: true, status: 'ready', message: 'Demo key-email delivery is ready.' },
          { id: 'encrypted_recovery', ok: true, status: 'ready', message: 'Demo encrypted recovery storage is ready.' },
        ],
      };
    }
    if (operation === 'audit_log') {
      const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 500);
      const offset = Math.max(Number(payload.offset) || 0, 0);
      const records = [...state.audit].reverse();
      const items = records.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      const hasMore = nextOffset < records.length;
      return {
        ok: true,
        items: clone(items),
        limit,
        offset,
        total: records.length,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
      };
    }
    if (operation === 'recovery_detail') {
      const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 500);
      const offset = Math.max(Number(payload.offset) || 0, 0);
      const records = allDemoExamBundles(state)
        .flatMap((bundle) => bundle.snapshots || [])
        .filter((snapshot) => !payload.snapshotId || snapshot.id === payload.snapshotId)
        .sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')));
      const snapshots = records.slice(offset, offset + limit);
      const nextOffset = offset + snapshots.length;
      const hasMore = nextOffset < records.length;
      return {
        ok: true,
        snapshots: clone(snapshots),
        limit,
        offset,
        total: records.length,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
      };
    }
    if (!['command_center', 'overview'].includes(operation)) throw new ExaminationRoomApiError('UNSUPPORTED_OPERATION', 'That administrator view is not available.', 400);
    const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 500);
    const offset = Math.max(Number(payload.offset) || 0, 0);
    const bundles = allDemoExamBundles(state);
    const examRecords = bundles.map((bundle) => ({
      ...clone(bundle.exam),
      questions: undefined,
      roster: undefined,
      rosterCount: bundle.exam.roster.length,
      questionCount: bundle.exam.questions.length,
      activation: clone(bundle.activation),
    }));
    const allSnapshots = bundles
      .flatMap((bundle) => bundle.snapshots || [])
      .sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')));
    const exams = examRecords.slice(offset, offset + limit);
    const nextOffset = offset + exams.length;
    const examHasMore = nextOffset < examRecords.length;
    return {
      ok: true,
      counts: {
        exams: examRecords.length,
        awaitingActivation: examRecords.filter((exam) => exam.status === 'awaiting_activation').length,
        open: examRecords.filter((exam) => exam.status === 'open').length,
        grading: examRecords.filter((exam) => exam.status === 'grading').length,
        submissions: bundles.reduce((total, bundle) => total + bundle.submissions.length, 0),
      },
      exams,
      examTotal: examRecords.length,
      examLimit: limit,
      examOffset: offset,
      examHasMore,
      examNextOffset: examHasMore ? nextOffset : null,
      professors: [clone(state.professor)],
      snapshots: clone(allSnapshots.slice(0, 10)),
      generatedAt: iso(),
    };
  }

  function demoAdminCommand(operation, payload = {}, idempotencyKey = requestId()) {
    const state = readDemoState();
    if (operation === 'bootstrap_institution') {
      return { ok: true, duplicate: true, institution: clone(state.institution), membershipId: state.staff.find((member) => member.isCurrentAdministrator)?.membershipId };
    }
    if (operation === 'assign_staff') {
      const email = required(payload.email, 'Verified sign-in email', 320).toLowerCase();
      const staffRole = ['professor', 'admin'].includes(payload.staffRole) ? payload.staffRole : 'professor';
      const existing = state.staff.find((member) => member.email === email && member.staffRole === staffRole && member.status === 'active');
      if (existing) return { ok: true, duplicate: true, membership: clone(existing) };
      const membership = {
        membershipId: requestId(),
        userId: requestId(),
        staffRole,
        displayName: required(payload.displayName || email.split('@')[0], 'Display name', 240),
        email,
        status: 'active',
        isCurrentAdministrator: false,
        grantedAt: iso(),
      };
      state.staff.push(membership);
      const request = (state.professorRequests || []).find((entry) => entry.email === email && entry.status === 'pending');
      if (request && staffRole === 'professor') {
        request.status = 'approved';
        request.reviewedAt = iso();
        request.membershipId = membership.membershipId;
      }
      writeDemoState(state, 'staff_access_assigned');
      return { ok: true, duplicate: false, membership: clone(membership) };
    }
    if (operation === 'revoke_staff') {
      const membership = state.staff.find((member) => member.membershipId === payload.membershipId);
      if (!membership || membership.status !== 'active') throw new ExaminationRoomApiError('STAFF_MEMBERSHIP_NOT_ACTIVE', 'That staff assignment is no longer active.', 409, 'Refresh the staff directory.');
      if (membership.isCurrentAdministrator) throw new ExaminationRoomApiError('SELF_REVOCATION_BLOCKED', 'You cannot revoke your own administrator assignment here.', 409, 'Ask another active administrator to transfer responsibility first.');
      membership.status = 'revoked';
      writeDemoState(state, 'staff_access_revoked');
      return { ok: true, membershipId: membership.membershipId, status: 'revoked' };
    }
    if (operation === 'reject_professor_request') {
      const request = (state.professorRequests || []).find((entry) => entry.requestId === payload.requestId);
      if (!request || request.status !== 'pending') throw new ExaminationRoomApiError('PROFESSOR_REQUEST_NOT_PENDING', 'That Professor request is no longer pending.', 409, 'Refresh the Professor request queue.');
      request.status = 'rejected';
      request.reviewedAt = iso();
      writeDemoState(state, 'professor_request_rejected');
      return { ok: true, requestId: request.requestId, status: 'rejected' };
    }
    if (payload.examId) requireDemoExam(state, payload.examId);
    const ownerReplay = state.audit.find((entry) => (
      entry.type === `owner_${operation}` && entry.requestId === idempotencyKey && entry.result
    ));
    if (ownerReplay) return { ...clone(ownerReplay.result), duplicate: true };
    if (operation === 'correct_student_identity') {
      const student = state.exam.roster.find((entry) => entry.id === payload.studentIdentityId);
      if (!student) {
        throw new ExaminationRoomApiError('STUDENT_NOT_FOUND', 'That student record is no longer in this examination.', 404, 'Refresh Students & Answers and choose the current record.');
      }
      const previousStudentNumber = student.studentNumber;
      student.fullName = required(payload.fullName, 'Full legal name', 240);
      student.studentNumber = required(payload.studentNumber, 'Student number', 120);
      if (String(payload.email || '').trim()) student.email = required(payload.email, 'Email', 320).toLowerCase();
      state.sessions
        .filter((session) => session.studentId === student.id || session.studentNumber === previousStudentNumber)
        .forEach((session) => {
          session.fullName = student.fullName;
          session.studentNumber = student.studentNumber;
        });
      const result = { ok: true, studentIdentityId: student.id, corrected: true };
      state.audit.push({ type: 'owner_correct_student_identity', actor: 'admin', at: iso(), requestId: idempotencyKey, reason: payload.reason, result: clone(result) });
      writeDemoState(state, 'student_identity_corrected');
      return result;
    }
    if (operation === 'set_submission_status') {
      const submission = state.submissions.find((entry) => entry.id === payload.submissionId);
      if (!submission) {
        throw new ExaminationRoomApiError('SUBMISSION_NOT_FOUND', 'That submission is no longer available.', 404, 'Refresh Students & Answers and choose the current submission.');
      }
      const status = String(payload.status || '').trim();
      if (!['accepted', 'under_review', 'voided'].includes(status)) {
        throw new ExaminationRoomApiError('SUBMISSION_STATUS_INVALID', 'Choose Accepted, Under review, or Voided.', 400, 'Choose one listed submission status.');
      }
      submission.status = status;
      submission.statusReason = status === 'accepted' ? null : required(payload.reason || 'Platform owner review.', 'Owner receipt note', 1_000);
      submission.statusChangedAt = iso();
      const result = { ok: true, submissionId: submission.id, status };
      state.audit.push({ type: 'owner_set_submission_status', actor: 'admin', at: submission.statusChangedAt, requestId: idempotencyKey, reason: payload.reason, result: clone(result) });
      writeDemoState(state, 'submission_status_changed');
      return result;
    }
    if (operation === 'room_control') {
      if (!state.activation) {
        throw new ExaminationRoomApiError('ROOM_ACTIVATION_NOT_FOUND', 'This examination does not have a room activation yet.', 409, 'Approve and email the room key before using room control.');
      }
      const action = String(payload.action || '').trim();
      if (!['open', 'close'].includes(action)) {
        throw new ExaminationRoomApiError('ROOM_ACTION_INVALID', 'Choose Open room now or Close room.', 400, 'Refresh Examinations and choose one listed room action.');
      }
      if (action === 'open') {
        if (!['scheduled', 'active'].includes(state.activation.status)) {
          throw new ExaminationRoomApiError('ROOM_STATE_CHANGED', 'This room can no longer be opened from its current state.', 409, 'Refresh Examinations to see the current room controls.');
        }
        state.activation.status = 'open';
        state.activation.openedAt = iso();
        state.exam.status = 'open';
      } else {
        if (!['scheduled', 'active', 'open'].includes(state.activation.status)) {
          throw new ExaminationRoomApiError('ROOM_STATE_CHANGED', 'This room is no longer open or scheduled.', 409, 'Refresh Examinations to see the current room controls.');
        }
        state.activation.status = 'closed';
        state.activation.closedAt = iso();
        state.activation.closeReason = required(payload.reason || 'Platform owner closed the room.', 'Owner receipt note', 1_000);
        state.exam.status = 'closed';
        state.sessions
          .filter((session) => !['submitted', 'expired'].includes(session.status))
          .forEach((session) => { session.status = 'expired'; session.connected = false; session.endedAt = state.activation.closedAt; });
      }
      const result = { ok: true, examId: state.exam.id, status: state.activation.status };
      state.audit.push({ type: 'owner_room_control', actor: 'admin', at: iso(), requestId: idempotencyKey, action, reason: payload.reason, result: clone(result) });
      writeDemoState(state, action === 'open' ? 'room_opened_by_owner' : 'room_closed_by_owner');
      return result;
    }
    if (operation === 'activate_exam') {
      if (state.exam.status !== 'awaiting_activation' && state.exam.status !== 'active') {
        throw new ExaminationRoomApiError('EXAM_NOT_PUBLISHED', 'The professor must publish this examination before a room key can be issued.', 409, 'Ask the professor to finish the review and choose Publish.');
      }
      state.activation = {
        id: requestId(), examId: state.exam.id, status: 'active',
        keyHint: '••••-••••-826K', issuedAt: iso(), expiresAt: iso(24 * 60 * 60 * 1000),
        issuedBy: 'Founder Admin',
      };
      state.exam.status = 'active';
      state.snapshots.push({ type: 'admin_activation', at: state.activation.issuedAt, examVersionId: state.exam.versionId });
      state.audit.push({ type: 'room_key_issued', actor: 'admin', at: state.activation.issuedAt, requestId: idempotencyKey });
      writeDemoState(state, 'exam_activated');
      return { ok: true, activation: clone(state.activation), roomKey: DEMO_KEY, deliveryStatus: 'ready_to_copy' };
    }
    if (operation === 'email_key') {
      if (!state.activation) throw new ExaminationRoomApiError('ROOM_NOT_ACTIVATED', 'Activate the examination before sending its key.', 409, 'Choose Issue room key first.');
      state.audit.push({ type: 'room_key_email_requested', actor: 'admin', at: iso(), requestId: idempotencyKey });
      writeDemoState(state, 'key_email_requested');
      return { ok: true, roomKey: DEMO_KEY, deliveryStatus: 'demo_delivered', recipient: state.professor.email };
    }
    if (operation === 'revoke_key') {
      if (state.activation) state.activation.status = 'revoked';
      state.exam.status = 'awaiting_activation';
      writeDemoState(state, 'key_revoked');
      return { ok: true, status: 'revoked' };
    }
    if (operation === 'create_snapshot') {
      const snapshot = { id: requestId(), type: 'admin_recovery', at: iso(), examVersionId: state.exam.versionId, answerRevisionCount: state.answerRevisions.length, submissionCount: state.submissions.length };
      state.snapshots.push(snapshot);
      writeDemoState(state, 'recovery_snapshot_created');
      return { ok: true, snapshot: clone(snapshot) };
    }
    if (operation === 'reset_demo') return { ok: true, state: resetDemo() };
    throw new ExaminationRoomApiError('UNSUPPORTED_OPERATION', 'That administrator action is not available. Refresh and try again.', 400);
  }

  async function authSession() {
    if (demoEnabled()) return { access_token: 'demo-token', user: { id: readDemoState().professor.userId } };
    if (!global.supabase || !config.supabase?.url || !config.supabase?.publishableKey) return null;
    if (!authSession.client) {
      const storage = global.DueDiligenceAuthSessionStorage?.prepare?.(config.supabase.url)
        || global.localStorage;
      authSession.client = global.supabase.createClient(config.supabase.url, config.supabase.publishableKey, {
        auth: { flowType: 'pkce', persistSession: true, storage, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    const { data, error } = await authSession.client.auth.getSession();
    if (error) throw new ExaminationRoomApiError('SESSION_UNAVAILABLE', 'Your sign-in could not be checked.', 401, 'Return to Due Diligence, sign in again, then reopen Examination Room.');
    return data?.session || null;
  }

  async function post(path, body = {}, options = {}) {
    const session = options.auth === false ? null : await authSession();
    if (options.auth === true && !session?.access_token) {
      throw new ExaminationRoomApiError('SIGN_IN_REQUIRED', 'Professor or administrator sign-in is required.', 401, 'Sign in through Due Diligence, then return to Examination Room.');
    }
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': options.idempotencyKey || requestId(),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      const error = result?.error || {};
      throw new ExaminationRoomApiError(
        error.code || 'EXAMINATION_ROOM_UNAVAILABLE',
        error.message || 'Examination Room could not complete that action.',
        response.status,
        error.recovery || 'Your work on this device is preserved. Check your connection, then try again.',
        error.details || null,
      );
    }
    return result;
  }

  async function professorQuery(operation, payload = {}) {
    return demoEnabled()
      ? demoProfessorQuery(operation, payload)
      : post('/examination-room/v1/professor/query', { operation, payload: staffPayload(payload) }, { auth: true });
  }

  async function professorCommand(operation, payload = {}, idempotencyKey = requestId()) {
    return demoEnabled()
      ? demoProfessorCommand(operation, payload, idempotencyKey)
      : post('/examination-room/v1/professor/command', { operation, payload: staffPayload(payload), idempotencyKey }, { auth: true, idempotencyKey });
  }

  async function studentPreview(payload) {
    return demoEnabled()
      ? demoStudentPreview(payload)
      : post('/examination-room/v1/student/preview', payload, { auth: false });
  }

  async function studentConsent(payload, idempotencyKey = requestId()) {
    return demoEnabled()
      ? demoStudentConsent(payload, idempotencyKey)
      : post('/examination-room/v1/student/consent', { ...payload, idempotencyKey }, { auth: false, idempotencyKey });
  }

  async function studentQuery(operation, payload = {}) {
    return demoEnabled()
      ? demoStudentQuery(operation, payload)
      : post('/examination-room/v1/student/query', { operation, payload }, { auth: false });
  }

  async function studentCommand(operation, payload = {}, idempotencyKey = requestId()) {
    return demoEnabled()
      ? demoStudentCommand(operation, payload, idempotencyKey)
      : post('/examination-room/v1/student/command', { operation, payload, idempotencyKey }, { auth: false, idempotencyKey });
  }

  async function adminQuery(operation, payload = {}) {
    return demoEnabled()
      ? demoAdminQuery(operation, payload)
      : post('/examination-room/v1/admin/query', { operation, payload: staffPayload(payload) }, { auth: true });
  }

  async function adminCommand(operation, payload = {}, idempotencyKey = requestId()) {
    return demoEnabled()
      ? demoAdminCommand(operation, payload, idempotencyKey)
      : post('/examination-room/v1/admin/command', { operation, payload: staffPayload(payload), idempotencyKey }, { auth: true, idempotencyKey });
  }

  // Compatibility surface used by the resilient student client. It keeps the
  // transport contract small while preserving metadata-only preview, explicit
  // consent, append-only answer saves, and idempotent final submission.
  async function previewRoom(entry) {
    const identity = {
      fullName: entry?.fullName,
      studentNumber: entry?.studentNumber,
      subject: entry?.subject,
      yearLevel: entry?.yearLevel,
    };
    const result = await studentPreview({ ...entry, identity });
    studentCompatibility.lastEntry = clone({ ...entry, identity });
    studentCompatibility.lastPreview = clone(result);
    return clone(result.metadata || result);
  }

  async function getPrivacyNotice({ examId, roomKey, noticeVersion }) {
    let result = studentCompatibility.lastPreview;
    const metadata = result?.metadata || {};
    if (!result || metadata.examId !== examId || metadata.noticeVersion !== noticeVersion) {
      const entry = studentCompatibility.lastEntry;
      if (!entry || normalizeKey(entry.roomKey) !== normalizeKey(roomKey)) {
        throw new ExaminationRoomApiError(
          'PREVIEW_REQUIRED',
          'Check your room and identity details before reviewing the privacy notice.',
          412,
          'Return to the entry form and choose Check examination details.',
        );
      }
      result = await studentPreview(entry);
      studentCompatibility.lastPreview = clone(result);
    }
    if (!result.notice) {
      throw new ExaminationRoomApiError(
        'NOTICE_UNAVAILABLE',
        'The current privacy notice could not be loaded.',
        503,
        'Your examination has not started. Check your connection and try again.',
      );
    }
    return clone(result.notice);
  }

  async function beginAttempt(request) {
    const result = await studentConsent({
      examId: request.examId,
      examVersion: request.examVersion,
      roomKey: request.roomKey,
      identity: request.student,
      noticeVersion: request.acceptance?.noticeVersion,
      acceptedAt: request.acceptance?.acceptedAt,
      acceptanceId: request.acceptance?.acceptanceId,
      agreed: true,
      recordingAccepted: request.acceptance?.recordingAccepted === true,
      client: request.client,
    }, request.acceptance?.acceptanceId || requestId());
    const session = result.session || {};
    const exam = result.exam || {};
    const startedAt = session.startedAt || result.serverTime || iso();
    const duration = Number(exam.durationMinutes || studentCompatibility.lastPreview?.metadata?.durationMinutes || 120);
    return {
      attemptId: session.id,
      sessionToken: result.sessionToken || session.sessionToken || session.id,
      serverNow: result.serverTime || iso(),
      startedAt,
      expiresAt: session.expiresAt || iso((duration + Number(session.extraMinutes || 0)) * 60 * 1000),
    };
  }

  async function loadExam({ attemptId, sessionToken }) {
    const result = await studentQuery('resume', { sessionId: attemptId, sessionToken });
    return { questions: studentSafeQuestions(result.exam?.questions || result.questions || []) };
  }

  async function syncOperations({ attemptId, sessionToken, operations = [] }) {
    const acknowledgedOperationIds = [];
    let serverRevision = 0;
    for (const operation of operations) {
      const payload = operation.payload || {};
      if (operation.kind === 'integrity.event') {
        await studentCommand('record_event', {
          sessionId: attemptId,
          sessionToken,
          type: payload.eventType || 'client_event',
          severity: 'info',
          occurredAt: operation.occurredAt,
          details: payload.details || {},
          visibilityState: payload.visibilityState,
          fullscreen: payload.fullscreen,
          clientSequence: operation.sequence,
        }, operation.id);
      } else if (operation.kind === 'answer.changed' || operation.kind === 'question.flag_changed') {
        await studentCommand('save_answer', {
          sessionId: attemptId,
          sessionToken,
          questionId: payload.questionId,
          answer: payload.answer === undefined ? null : payload.answer,
          flagged: Boolean(payload.flagged),
          clientSequence: operation.sequence,
          occurredAt: operation.occurredAt,
        }, operation.id);
      } else {
        throw new ExaminationRoomApiError(
          'OPERATION_UNSUPPORTED',
          'A saved browser action could not be synchronized.',
          400,
          'Refresh this page. Your answers remain saved on this device.',
        );
      }
      acknowledgedOperationIds.push(operation.id);
      serverRevision = Math.max(serverRevision, Number(operation.sequence || 0));
    }
    return { acknowledgedOperationIds, serverRevision };
  }

  async function submitAttempt(payload) {
    const result = await studentCommand('submit', {
      ...payload,
      sessionId: payload.attemptId,
      manifestHash: payload.manifestHash,
    }, payload.idempotencyKey);
    const submission = result.submission || result.receipt || result;
    return {
      receiptId: submission.receiptCode || submission.receiptId || submission.id,
      submittedAt: submission.submittedAt,
      signature: submission.signature || submission.manifestHash || submission.id,
      answerCount: submission.answerCount ?? (payload.answers || []).filter((entry) => entry.answer !== null && entry.answer !== '').length,
      examVersion: submission.examVersion || submission.examVersionId || payload.examVersion,
      isDemo: demoEnabled(),
    };
  }

  async function getResult({ attemptId, sessionToken }) {
    const result = await studentQuery('result', { sessionId: attemptId, sessionToken });
    if (viewModels?.buildStudentResultView) return viewModels.buildStudentResultView(result);
    return {
      released: result.released === true,
      status: result.released === true ? 'released' : 'awaiting_grade',
      releasedAt: result.release?.at || result.releasedAt || null,
      checkedAt: result.serverTime || iso(),
      totalScore: null,
      totalPossible: null,
      questions: [],
    };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  channel?.addEventListener('message', (event) => listeners.forEach((listener) => listener(event.data)));
  global.addEventListener?.('storage', (event) => {
    if (event.key === DEMO_EVENT_KEY) listeners.forEach((listener) => listener(JSON.parse(event.newValue || 'null')));
  });

  global.ExaminationRoomV1Api = Object.freeze({
    ExaminationRoomApiError,
    demoEnabled,
    resetDemo,
    requestId,
    authSession,
    professorQuery,
    professorCommand,
    studentPreview,
    studentConsent,
    studentQuery,
    studentCommand,
    previewRoom,
    getPrivacyNotice,
    beginAttempt,
    loadExam,
    syncOperations,
    submitAttempt,
    getResult,
    adminQuery,
    adminCommand,
    subscribe,
    demoRoomKey: DEMO_KEY,
  });
})(window);
