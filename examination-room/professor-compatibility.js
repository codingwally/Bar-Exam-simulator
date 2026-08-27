(function examinationRoomProfessorCompatibility(global) {
  'use strict';

  const CURRENT_PRIVACY_NOTICE = 'exam-room-v1';
  const PROFESSOR_WRITE_OPERATIONS = new Set(['save_draft', 'publish']);

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizedProfessorPayload(operation, payload) {
    if (!PROFESSOR_WRITE_OPERATIONS.has(String(operation || '')) || !isRecord(payload) || !isRecord(payload.exam)) {
      return payload;
    }

    return {
      ...payload,
      exam: {
        ...payload.exam,
        privacyNoticeVersion: CURRENT_PRIVACY_NOTICE,
      },
    };
  }

  function installApiGuard() {
    const originalApi = global.ExaminationRoomV1Api;
    if (!originalApi || typeof originalApi.professorCommand !== 'function') return false;
    if (originalApi.__privacyNoticeGuard === CURRENT_PRIVACY_NOTICE) return true;

    const guardedProfessorCommand = function guardedProfessorCommand(operation, payload, idempotencyKey) {
      return originalApi.professorCommand.call(
        originalApi,
        operation,
        normalizedProfessorPayload(operation, payload),
        idempotencyKey,
      );
    };

    global.ExaminationRoomV1Api = Object.freeze({
      ...originalApi,
      professorCommand: guardedProfessorCommand,
      __privacyNoticeGuard: CURRENT_PRIVACY_NOTICE,
    });
    return true;
  }

  function bindNewExaminationAction() {
    const document = global.document;
    const shortcut = document?.getElementById?.('new-exam-direct');
    if (!shortcut || shortcut.dataset.compatibilityBound === 'true') return false;

    shortcut.dataset.compatibilityBound = 'true';
    shortcut.addEventListener('click', (event) => {
      event.preventDefault();
      if (shortcut.disabled) return;

      const sourceAction = document.querySelector?.('#more-actions-menu [data-action="new-exam"]');
      if (!sourceAction) return;

      const label = shortcut.querySelector?.('span');
      const originalLabel = label?.textContent || 'New examination';
      shortcut.disabled = true;
      shortcut.setAttribute?.('aria-busy', 'true');
      if (label) label.textContent = 'Creating…';

      sourceAction.click();

      global.setTimeout?.(() => {
        if (!global.document?.contains?.(shortcut)) return;
        shortcut.disabled = false;
        shortcut.removeAttribute?.('aria-busy');
        if (label) label.textContent = originalLabel;
      }, 8000);
    });
    return true;
  }

  installApiGuard();
  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bindNewExaminationAction, { once: true });
  } else {
    bindNewExaminationAction();
  }
})(window);
