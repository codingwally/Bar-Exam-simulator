(function examinationRoomProfessorRuntimeFix(global) {
  'use strict';

  const originalApi = global.ExaminationRoomV1Api;
  if (!originalApi || originalApi.__professorDraftPolicyFixApplied === true) return;

  const APPROVED_PRIVACY_NOTICE_VERSION = 'exam-room-v1';
  const UNTITLED_EXAMINATION = 'Untitled examination';

  function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }

  function normalizedExam(exam, { ensureTitle = false } = {}) {
    if (!isRecord(exam)) return exam;
    const normalized = {
      ...exam,
      privacyNoticeVersion: APPROVED_PRIVACY_NOTICE_VERSION,
    };
    if (isRecord(exam.controls)) {
      normalized.controls = {
        ...exam.controls,
        privacyNoticeVersion: APPROVED_PRIVACY_NOTICE_VERSION,
      };
    }
    if (ensureTitle && !String(normalized.title || '').trim()) {
      normalized.title = UNTITLED_EXAMINATION;
    }
    return normalized;
  }

  function normalizedProfessorPayload(operation, payload) {
    if (!['save_draft', 'publish'].includes(operation) || !isRecord(payload)) return payload;
    const normalized = cloneValue(payload);
    const ensureTitle = operation === 'save_draft';
    if (isRecord(normalized.exam)) normalized.exam = normalizedExam(normalized.exam, { ensureTitle });
    if (isRecord(normalized.draft)) normalized.draft = normalizedExam(normalized.draft, { ensureTitle });
    return normalized;
  }

  function normalizedProfessorResult(result, fallbackExam = null) {
    if (!isRecord(result)) return result;
    const normalized = { ...result };
    const exam = isRecord(result.exam) ? result.exam : fallbackExam;
    if (isRecord(exam)) normalized.exam = normalizedExam(exam);
    if (isRecord(result.draft)) normalized.draft = normalizedExam(result.draft);
    if (Array.isArray(result.exams)) normalized.exams = result.exams.map((entry) => normalizedExam(entry));
    return normalized;
  }

  async function professorQuery(operation, payload) {
    const result = await originalApi.professorQuery.call(originalApi, operation, payload);
    return normalizedProfessorResult(result);
  }

  async function professorCommand(operation, payload, idempotencyKey) {
    const normalizedPayload = normalizedProfessorPayload(operation, payload);
    const result = await originalApi.professorCommand.call(
      originalApi,
      operation,
      normalizedPayload,
      idempotencyKey,
    );
    const fallbackExam = ['save_draft', 'publish'].includes(operation)
      ? normalizedPayload?.exam || null
      : null;
    return normalizedProfessorResult(result, fallbackExam);
  }

  const fixedApi = {
    ...originalApi,
    professorQuery,
    professorCommand,
  };
  Object.defineProperty(fixedApi, '__professorDraftPolicyFixApplied', {
    value: true,
    enumerable: false,
  });
  global.ExaminationRoomV1Api = Object.freeze(fixedApi);
})(window);
