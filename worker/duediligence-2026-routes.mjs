import {
  BAR_EASY_RESPONSE_SCHEMA,
  DD2026_DEFAULT_FLAGS,
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
  normalizeVerdictArchiveRequest,
  normalizeVerdictPdfRequest,
  normalizeVerdictRecordsRequest,
  publicContentItem,
  validateBarEasyResult,
  validateDoctrineResult,
} from './duediligence-2026-core.mjs';
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

function retainedFeatureFlags(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.keys(DD2026_DEFAULT_FLAGS).map((key) => [
    key,
    source[key] === true,
  ]));
}

export function createDD2026Handlers(deps) {
  const {
    corsHeaders,
    dd2026Rpc,
    enforceAdminRateLimit,
    enforceDD2026RateLimit,
    jsonResponse,
    parseBoundedJson,
    requireAdministrator,
    requireAuthenticatedUser,
    requireCommercialAccess,
    reserveCommercialSubmission,
    releaseCommercialSubmission,
    resolveVerdictQuestion,
    structuredGemini,
  } = deps;
  async function features(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const result = await dd2026Rpc(env, 'dd2026_feature_snapshot', { p_user_id: user.id });
    return jsonResponse({
      ok: true,
      ...result,
      flags: retainedFeatureFlags(result?.flags),
    }, 200, origin, allowedOrigin);
  }
  async function contentQuery(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const access = await requireCommercialAccess(request, env, user);
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
      access,
      ...result,
      items: Array.isArray(result?.items) ? result.items.map(publicContentItem) : [],
    }, 200, origin, allowedOrigin);
  }

  async function contentItem(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const access = await requireCommercialAccess(request, env, user);
    const input = normalizeContentItemRequest(await parseBoundedJson(request, 10_000));
    const result = await dd2026Rpc(env, 'dd2026_content_get', {
      p_user_id: user.id,
      p_content_type: input.contentType,
      p_content_id: input.contentId,
    });
    return jsonResponse({ ok: true, access, item: publicContentItem(result) }, 200, origin, allowedOrigin);
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
    const reservation = await reserveCommercialSubmission(
      request, env, user, 'quiz', content.id, input.requestKey,
    );
    try {
      const coached = await structuredGemini(
        env,
        buildBarEasyPrompt(content, input.answer),
        BAR_EASY_RESPONSE_SCHEMA,
        validateBarEasyResult,
      );
      const completion = await dd2026Rpc(
        env,
        'dd2026_record_bar_easy_completion_commercial',
        {
          ...barEasyPersistencePayload(user.id, content.id, input, coached.model),
          p_reservation_id: reservation.reservationId,
        },
      );
      return jsonResponse({
        ok: true,
        result: coached.result,
        study: barEasyReveal(content),
        completion,
        access: completion?.access || reservation.access,
        notice: 'Verify the coaching explanation against current law and the linked primary source.',
      }, 200, origin, allowedOrigin);
    } catch (error) {
      await releaseCommercialSubmission(env, reservation, 'grading_failed');
      throw error;
    }
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
    const reservation = await reserveCommercialSubmission(
      request, env, user, 'doctrine_review', content.id, input.requestKey,
    );
    try {
      const coached = await structuredGemini(
        env,
        buildDoctrinePrompt(content, input.answer),
        DOCTRINE_RESPONSE_SCHEMA,
        validateDoctrineResult,
      );
      const completion = await dd2026Rpc(
        env,
        'dd2026_record_doctrine_mastery_commercial',
        {
          ...doctrinePersistencePayload(user.id, content.id, input, coached.result, coached.model),
          p_reservation_id: reservation.reservationId,
        },
      );
      return jsonResponse({
        ok: true,
        result: coached.result,
        study: doctrineReveal(content),
        completion,
        access: completion?.access || reservation.access,
        privacy: 'Your answer text is not saved. Only your mastery result is recorded.',
        notice: 'Verify the coaching explanation against current law and the linked primary source.',
      }, 200, origin, allowedOrigin);
    } catch (error) {
      await releaseCommercialSubmission(env, reservation, 'grading_failed');
      throw error;
    }
  }

  async function verdictPdf(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeVerdictPdfRequest(await parseBoundedJson(request, 25_000));
    const results = [];
    for (const resultId of input.gradingResultIds) {
      let result = await dd2026Rpc(env, 'dd2026_verdict_result', {
        p_user_id: user.id,
        p_grading_result_id: resultId,
      });
      if (result?.sourceType === 'phase4_exam_attempt') {
        const source = await resolveVerdictQuestion(result.questionBankId, env);
        if (!source?.question || !source?.suggestedAnswer) {
          throw new DD2026ValidationError(
            'VERDICT_SOURCE_UNAVAILABLE',
            'The complete source record for one selected result is temporarily unavailable. Try again later.',
            503,
          );
        }
        result = {
          ...result,
          questionId: result.questionBankId,
          question: source.question,
          suggestedAnswer: source.suggestedAnswer,
          legalBasis: source.legalBasis || '',
          questionNumber: result.questionBankId,
        };
      }
      results.push(result);
    }
    const result = results.length === 1 ? results[0] : {
      subject: 'Selected personal attempts',
      gradedAt: new Date().toISOString(),
      questions: results.flatMap((entry, resultIndex) => {
        const label = [entry.feature, entry.subject, entry.gradedAt
          ? new Date(entry.gradedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })
          : ''].filter(Boolean).join(' · ');
        if (Array.isArray(entry.questions)) {
          return entry.questions.map((question, questionIndex) => ({
            ...question,
            id: `${entry.resultId}:${question.questionId || questionIndex + 1}`,
            label: [label, question.questionNumber].filter(Boolean).join(' · '),
          }));
        }
        return [{
          id: `${entry.resultId}:${entry.questionId || resultIndex + 1}`,
          label,
          question: entry.question,
          suggestedAnswer: entry.suggestedAnswer,
          legalBasis: entry.legalBasis,
          userAnswer: entry.userAnswer,
          feedback: entry.feedback,
          score: entry.score,
        }];
      }),
    };
    const bytes = await buildVerdictPdf({
      result,
      selectionKind: input.selectionKind,
      selectedIds: input.selectedIds,
    });
    for (let index = 0; index < input.gradingResultIds.length; index += 1) {
      await dd2026Rpc(env, 'dd2026_record_verdict_export', {
        p_user_id: user.id,
        p_grading_result_id: input.gradingResultIds[index],
        p_request_key: `${input.requestKey.slice(0, 116)}_${String(index + 1).padStart(3, '0')}`,
        p_selection_kind: input.selectionKind,
        p_selected_ids: input.selectedIds,
        p_output_bytes: bytes.length,
      });
    }
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

  async function verdictRecords(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeVerdictRecordsRequest(await parseBoundedJson(request, 5_000));
    const result = await dd2026Rpc(env, 'dd2026_verdict_records', {
      p_user_id: user.id,
      p_include_deleted: input.includeDeleted,
      p_limit: input.limit,
      p_offset: input.offset,
    });
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
  }

  async function verdictArchive(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = normalizeVerdictArchiveRequest(await parseBoundedJson(request, 40_000));
    const result = await dd2026Rpc(env, 'dd2026_verdict_archive', {
      p_user_id: user.id,
      p_action: input.action,
      p_records: input.records,
    });
    return jsonResponse({ ok: true, result }, 200, origin, allowedOrigin);
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

  return {
    barEasyGrade,
    contentItem,
    contentQuery,
    doctrineGrade,
    editorial,
    features,
    importContent,
    verdictPdf,
    verdictRecords,
    verdictArchive,
  };
}
