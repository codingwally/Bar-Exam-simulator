import {
  BAR_EASY_RESPONSE_SCHEMA,
  DD2026ValidationError,
  DOCTRINE_RESPONSE_SCHEMA,
  barEasyPersistencePayload,
  buildBarEasyPrompt,
  buildDoctrinePrompt,
  doctrinePersistencePayload,
  normalizeBarEasyRequest,
  normalizeContentItemRequest,
  normalizeContentQuery,
  normalizeDoctrineRequest,
  normalizeVerdictPdfRequest,
  publicContentItem,
  validateBarEasyResult,
  validateDoctrineResult,
} from './duediligence-2026-core.mjs';
import {
  examRoomRateKey,
  hashedCredential,
  normalizeExamRoomCommand,
  normalizeExamRoomQuery,
  normalizeQuestionUpload,
  normalizeRosterUpload,
} from './exam-room-2026-core.mjs';
import { buildVerdictPdf, verdictPdfFileName } from './verdict-pdf.mjs';

function barEasyReveal(content) {
  const payload = content?.payload || {};
  return {
    id: content?.id,
    label: content?.title,
    suggestedAnswer: payload.suggested_answer,
    explanation: payload.explanation,
    primarySource: {
      title: payload.source_title,
      citation: payload.source_citation,
      url: payload.source_url,
    },
    aiPreparedBeta: content?.aiPreparedBeta === true,
  };
}

function doctrineReveal(content) {
  const payload = content?.payload || {};
  return {
    id: content?.id,
    title: payload.doctrine_title || content?.title,
    canonicalMeaning: payload.canonical_meaning,
    plainLanguageMeaning: payload.plain_language_meaning,
    limits: payload.exceptions_or_limits,
    authority: payload.primary_authority,
    citation: payload.citation,
    sourceUrl: payload.source_url,
    aiPreparedBeta: content?.aiPreparedBeta === true,
  };
}

export function createDD2026Handlers(deps) {
  const {
    corsHeaders,
    dd2026Rpc,
    deleteExamRoomSource,
    enforceAdminRateLimit,
    enforceDD2026RateLimit,
    examRoomRpc,
    jsonResponse,
    parseBoundedJson,
    processExamRoomQueues,
    requireAdministrator,
    requireAuthenticatedUser,
    resolveVerdictQuestion,
    structuredGemini,
    uploadExamRoomSource,
  } = deps;

  async function features(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const result = await dd2026Rpc(env, 'dd2026_feature_snapshot', { p_user_id: user.id });
    return jsonResponse({ ok: true, ...result }, 200, origin, allowedOrigin);
  }

  async function contentQuery(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeContentQuery(await parseBoundedJson(request, 25_000));
    const result = await dd2026Rpc(env, 'dd2026_content_list', {
      p_user_id: user.id,
      p_content_type: input.contentType,
      p_subject: input.subject,
      p_search: input.search,
      p_limit: input.limit,
      p_offset: input.offset,
    });
    return jsonResponse({
      ok: true,
      ...result,
      items: Array.isArray(result?.items) ? result.items.map(publicContentItem) : [],
    }, 200, origin, allowedOrigin);
  }

  async function contentItem(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeContentItemRequest(await parseBoundedJson(request, 10_000));
    const result = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: input.contentType,
      p_content_id: input.contentId,
    });
    return jsonResponse({ ok: true, item: publicContentItem(result) }, 200, origin, allowedOrigin);
  }

  async function barEasyGrade(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeBarEasyRequest(await parseBoundedJson(request, 20_000));
    const content = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: 'bar_easy',
      p_content_id: input.contentId,
    });
    const coached = await structuredGemini(
      env,
      buildBarEasyPrompt(content, input.answer),
      BAR_EASY_RESPONSE_SCHEMA,
      validateBarEasyResult,
    );
    const completion = await dd2026Rpc(
      env,
      'dd2026_record_bar_easy_completion',
      barEasyPersistencePayload(user.id, content.id, input, coached.model),
    );
    return jsonResponse({
      ok: true,
      result: coached.result,
      study: barEasyReveal(content),
      completion,
      notice: 'AI-prepared beta. Verify independently against current law and the linked primary source.',
    }, 200, origin, allowedOrigin);
  }

  async function doctrineGrade(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeDoctrineRequest(await parseBoundedJson(request, 15_000));
    const content = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: 'doctrine',
      p_content_id: input.contentId,
    });
    const coached = await structuredGemini(
      env,
      buildDoctrinePrompt(content, input.answer),
      DOCTRINE_RESPONSE_SCHEMA,
      validateDoctrineResult,
    );
    const completion = await dd2026Rpc(
      env,
      'dd2026_record_doctrine_mastery',
      doctrinePersistencePayload(user.id, content.id, input, coached.result, coached.model),
    );
    return jsonResponse({
      ok: true,
      result: coached.result,
      study: doctrineReveal(content),
      completion,
      privacy: 'Your answer text is not saved. Only your mastery result is recorded.',
      notice: 'AI-prepared beta. Verify independently against current law and the linked primary source.',
    }, 200, origin, allowedOrigin);
  }

  async function verdictPdf(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeVerdictPdfRequest(await parseBoundedJson(request, 25_000));
    let result = await dd2026Rpc(env, 'dd2026_verdict_result', {
      p_user_id: user.id,
      p_grading_result_id: input.gradingResultId,
    });
    if (result?.sourceType === 'phase4_exam_attempt') {
      const source = await resolveVerdictQuestion(result.questionBankId, env);
      if (!source?.question || !source?.suggestedAnswer) {
        throw new DD2026ValidationError(
          'VERDICT_SOURCE_UNAVAILABLE',
          'The complete source record for this result is temporarily unavailable. Try again later.',
          503,
        );
      }
      result = {
        ...result,
        questionId: result.questionBankId,
        question: source.question,
        suggestedAnswer: source.suggestedAnswer,
        questionNumber: result.questionBankId,
      };
    }
    const bytes = await buildVerdictPdf({
      result,
      selectionKind: input.selectionKind,
      selectedIds: input.selectedIds,
    });
    await dd2026Rpc(env, 'dd2026_record_verdict_export', {
      p_user_id: user.id,
      p_grading_result_id: input.gradingResultId,
      p_request_key: input.requestKey,
      p_selection_kind: input.selectionKind,
      p_selected_ids: input.selectedIds,
      p_output_bytes: bytes.length,
    });
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders(origin, allowedOrigin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${verdictPdfFileName(result)}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  async function importContent(request, env, origin, allowedOrigin) {
    await enforceAdminRateLimit(request, env);
    const admin = await requireAdministrator(request, env);
    const payload = await parseBoundedJson(request, 2_500_000);
    if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 500) {
      throw new DD2026ValidationError('IMPORT_INVALID', 'Provide between 1 and 500 validated content rows.');
    }
    const result = await dd2026Rpc(env, 'dd2026_import_content_batch', {
      p_actor_user_id: admin.id,
      p_rows: payload.rows,
    });
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function editorial(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const payload = await parseBoundedJson(request, 25_000);
    const result = await dd2026Rpc(env, 'dd2026_editorial_transition', {
      p_actor_user_id: user.id,
      p_content_id: String(payload.contentId || ''),
      p_version_id: String(payload.versionId || ''),
      p_action: String(payload.action || ''),
      p_note: payload.note == null ? null : String(payload.note),
    });
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function examQuery(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeExamRoomQuery(await parseBoundedJson(request, 30_000));
    let functionName;
    let body;
    if (input.operation === 'portal') {
      functionName = 'exam_room_portal_snapshot';
      body = { p_user_id: user.id };
    } else if (input.operation === 'attempt') {
      functionName = 'exam_room_attempt_view';
      body = { p_student_user_id: user.id, p_attempt_public_id: input.attemptId };
    } else if (input.operation === 'live_status' || input.operation === 'grading_workspace') {
      functionName = input.operation === 'live_status'
        ? 'exam_room_live_status'
        : 'exam_room_grading_workspace';
      body = { p_professor_user_id: user.id, p_exam_public_id: input.examId,
        p_grading_key_hash: await hashedCredential(input.gradingKey),
        p_rate_key_hash: await examRoomRateKey(request, user.id, input.examId) };
    } else if (input.operation === 'student_result') {
      functionName = 'exam_room_student_result';
      body = { p_student_user_id: user.id, p_exam_public_id: input.examId };
    } else {
      functionName = 'exam_room_dispute_view';
      body = { p_admin_user_id: user.id, p_dispute_id: input.disputeId,
        p_token_hash: await hashedCredential(input.disputeKey),
        p_rate_key_hash: await examRoomRateKey(request, user.id, input.disputeId) };
    }
    const result = await examRoomRpc(env, functionName, body);
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function rosterUpload(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = await normalizeRosterUpload(await parseBoundedJson(request, 3_000_000));
    const validation = await examRoomRpc(env, 'exam_room_validate_roster', {
      p_professor_user_id: user.id,
      p_classroom_public_id: input.classroomId,
      p_rows: input.rows,
    });
    return jsonResponse({
      ok: validation?.ok === true,
      rows: input.rows,
      sourceHash: input.sourceHash,
      validation,
    }, validation?.ok === true ? 200 : 422, origin, allowedOrigin);
  }

  async function questionUpload(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = await normalizeQuestionUpload(await parseBoundedJson(request, 14_500_000));
    const portal = await examRoomRpc(env, 'exam_room_portal_snapshot', { p_user_id: user.id });
    const ownsExam = Array.isArray(portal?.classes) && portal.classes.some((classroom) => (
      Array.isArray(classroom.exams) && classroom.exams.some((exam) => exam.examId === input.examId)
    ));
    if (!portal?.roles?.professor || !ownsExam) {
      throw new DD2026ValidationError('EXAM_ROOM_PROFESSOR_REQUIRED', 'An owning professor account is required.', 403);
    }
    const objectPath = `${user.id}/${input.examId}/${input.contentHash}-${input.fileName}`;
    await uploadExamRoomSource(env, objectPath, input.bytes, input.mimeType);
    return jsonResponse({
      ok: true,
      preview: {
        examId: input.examId,
        questionCount: input.questionCount,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        pageCount: input.pageCount,
        contentHash: input.contentHash,
        objectPath,
        questions: input.questions,
        warnings: input.warnings,
      },
    }, 200, origin, allowedOrigin);
  }

  async function examCommand(request, env, origin, allowedOrigin, ctx) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeExamRoomCommand(await parseBoundedJson(request, 2_500_000));
    const rateHash = await examRoomRateKey(
      request,
      user.id,
      input.examId || input.attemptId || input.disputeId || input.operation,
    );
    const spec = await commandSpec(input, user.id, rateHash);
    if (input.operation === 'confirm_questions') {
      const prefix = `${user.id}/${input.examId}/`;
      if (!input.objectPath.startsWith(prefix) || input.objectPath.includes('..')) {
        throw new DD2026ValidationError('INVALID_SOURCE_PATH', 'The private source reference is invalid.');
      }
    }
    let result;
    try {
      result = await examRoomRpc(env, spec.functionName, spec.body);
    } catch (error) {
      if (input.operation === 'confirm_questions') await deleteExamRoomSource(env, input.objectPath);
      throw error;
    }
    if (['submit_attempt', 'release_results'].includes(input.operation) && ctx?.waitUntil) {
      ctx.waitUntil(processExamRoomQueues(env));
    }
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function commandSpec(input, userId, rateHash) {
    const h = hashedCredential;
    const specs = {
      issue_activation: async () => ({ functionName: 'exam_room_issue_professor_activation', body: {
        p_actor_user_id: userId, p_target_email: input.targetEmail,
        p_token_hash: await h(input.activationKey), p_expires_at: input.expiresAt, p_reason: input.reason,
      } }),
      redeem_activation: async () => ({ functionName: 'exam_room_redeem_professor_activation', body: {
        p_user_id: userId, p_token_hash: await h(input.activationKey), p_rate_key_hash: rateHash,
      } }),
      create_classroom: async () => ({ functionName: 'exam_room_create_classroom', body: {
        p_professor_user_id: userId, p_title: input.title,
        p_school_name: input.schoolName, p_academic_term: input.academicTerm,
      } }),
      validate_roster: async () => ({ functionName: 'exam_room_validate_roster', body: {
        p_professor_user_id: userId, p_classroom_public_id: input.classroomId, p_rows: input.rows,
      } }),
      import_roster: async () => ({ functionName: 'exam_room_import_roster', body: {
        p_professor_user_id: userId, p_classroom_public_id: input.classroomId, p_rows: input.rows,
        p_request_key: input.requestKey, p_source_hash: input.sourceHash,
      } }),
      create_exam: async () => ({ functionName: 'exam_room_create_exam', body: {
        p_professor_user_id: userId, p_classroom_public_id: input.classroomId,
        p_title: input.title, p_instructions: input.instructions,
        p_requested_question_count: input.questionCount, p_integrity_preset: input.integrityPreset,
        p_include_questionnaire: input.includeQuestionnaire,
      } }),
      confirm_questions: async () => ({ functionName: 'exam_room_confirm_questions', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_object_path: input.objectPath, p_safe_file_name: input.fileName,
        p_mime_type: input.mimeType, p_size_bytes: input.sizeBytes, p_page_count: input.pageCount,
        p_content_hash: input.contentHash, p_questions: input.questions, p_warnings: input.warnings,
      } }),
      schedule_exam: async () => ({ functionName: 'exam_room_schedule_exam', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_opens_at: input.opensAt, p_hard_closes_at: input.hardClosesAt,
        p_duration_minutes: input.durationMinutes,
        p_student_key_hash: await h(input.studentKey), p_grading_key_hash: await h(input.gradingKey),
      } }),
      start_attempt: async () => ({ functionName: 'exam_room_start_attempt', body: {
        p_student_user_id: userId, p_exam_public_id: input.examId,
        p_student_key_hash: await h(input.studentKey), p_rate_key_hash: rateHash,
      } }),
      save_answer: async () => ({ functionName: 'exam_room_save_answer', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_question_id: input.questionId, p_answer_text: input.answerText,
        p_expected_revision: input.expectedRevision,
      } }),
      heartbeat: async () => ({ functionName: 'exam_room_heartbeat', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
      } }),
      integrity_event: async () => ({ functionName: 'exam_room_record_integrity_event', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId,
        p_event_type: input.eventType, p_details: input.details,
      } }),
      submit_attempt: async () => ({ functionName: 'exam_room_submit_attempt', body: {
        p_student_user_id: userId, p_attempt_public_id: input.attemptId, p_request_key: input.requestKey,
      } }),
      save_grade: async () => ({ functionName: 'exam_room_save_grade', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_attempt_public_id: input.attemptId, p_question_id: input.questionId,
        p_score: input.score, p_comment: input.comment, p_grade_state: input.gradeState,
        p_expected_revision: input.expectedRevision, p_change_reason: input.changeReason,
        p_grading_key_hash: await h(input.gradingKey), p_rate_key_hash: rateHash,
      } }),
      unlock_attempt: async () => ({ functionName: 'exam_room_unlock_attempt', body: {
        p_actor_user_id: userId, p_attempt_public_id: input.attemptId, p_reason: input.reason,
        p_grading_key_hash: input.gradingKey ? await h(input.gradingKey) : null,
        p_rate_key_hash: input.gradingKey ? rateHash : null,
      } }),
      release_results: async () => ({ functionName: 'exam_room_release_results', body: {
        p_professor_user_id: userId, p_exam_public_id: input.examId,
        p_request_key: input.requestKey, p_include_questionnaire: input.includeQuestionnaire,
        p_grading_key_hash: await h(input.gradingKey), p_rate_key_hash: rateHash,
      } }),
      open_dispute: async () => ({ functionName: 'exam_room_open_dispute', body: {
        p_admin_user_id: userId, p_exam_public_id: input.examId,
        p_case_reference: input.caseReference, p_reason: input.reason,
        p_access_mode: input.accessMode, p_token_hash: await h(input.disputeKey),
        p_expires_at: input.expiresAt,
      } }),
      close_dispute: async () => ({ functionName: 'exam_room_close_dispute', body: {
        p_admin_user_id: userId, p_dispute_id: input.disputeId, p_reason: input.reason,
      } }),
      admin_correct_grade: async () => ({ functionName: 'exam_room_admin_correct_grade', body: {
        p_admin_user_id: userId, p_dispute_id: input.disputeId,
        p_attempt_public_id: input.attemptId, p_question_id: input.questionId,
        p_score: input.score, p_comment: input.comment, p_reason: input.reason,
        p_token_hash: await h(input.disputeKey), p_rate_key_hash: rateHash,
      } }),
    };
    if (!specs[input.operation]) {
      throw new DD2026ValidationError('UNSUPPORTED_OPERATION', 'This Examination Room operation is not supported.');
    }
    return specs[input.operation]();
  }

  return {
    barEasyGrade,
    contentItem,
    contentQuery,
    doctrineGrade,
    editorial,
    examCommand,
    examQuery,
    features,
    importContent,
    questionUpload,
    rosterUpload,
    verdictPdf,
  };
}
