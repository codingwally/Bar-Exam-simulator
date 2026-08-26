import { DD2026ValidationError } from './duediligence-2026-core.mjs';
import { sanitizeLearnerFacingPayload } from './internal-editorial-content.mjs';
import {
  AUXILIARY_WRITING_DIAGNOSTICS_RESPONSE_SCHEMA,
  AUXILIARY_WRITING_DIAGNOSTICS_VERSION,
  auxiliaryAnswerEligible,
  auxiliaryPersistencePayload,
  buildAuxiliaryWritingDiagnosticsPrompt,
  normalizeAuxiliaryEnsureRequest,
  normalizeAuxiliaryRecordsRequest,
  validateAuxiliaryWritingDiagnosticsResult,
} from './auxiliary-writing-diagnostics-core.mjs';

function auxiliaryRequest(input, normalizer) {
  try {
    return normalizer(input);
  } catch (error) {
    throw new DD2026ValidationError(
      'AUXILIARY_DIAGNOSTIC_REQUEST_INVALID',
      error?.message || 'The auxiliary diagnostic request is invalid.',
    );
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function runWithConcurrency(items, limit, task) {
  const queue = [...items];
  const failures = [];
  const results = [];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      try {
        results.push(await task(item));
      } catch (error) {
        failures.push(error);
      }
    }
  });
  await Promise.all(workers);
  return { failures, results };
}

const MAX_QUESTIONS_PER_ENSURE = 4;
const PROCESSING_LEASE_MS = 15 * 60 * 1000;

function recordsForSource(result, input) {
  return (Array.isArray(result?.items) ? result.items : []).filter((item) => (
    item?.sourceType === input.sourceType
      && item?.sourceId === input.sourceId
  ));
}

export function createAuxiliaryWritingDiagnosticsHandlers(deps) {
  const {
    dd2026Rpc,
    enforceDD2026RateLimit,
    jsonResponse,
    parseBoundedJson,
    requireAuthenticatedUser,
    resolveVerdictQuestion,
    structuredGemini,
  } = deps;

  async function resolvedSource(env, userId, input) {
    const result = await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_source', {
      p_user_id: userId,
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
    });
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    if (input.sourceType !== 'phase4_exam_attempt') return { ...result, questions };
    const source = await resolveVerdictQuestion(questions[0]?.questionId, env);
    if (!source?.question) {
      throw new DD2026ValidationError(
        'AUXILIARY_DIAGNOSTIC_SOURCE_UNAVAILABLE',
        'The question facts needed for this auxiliary diagnostic are temporarily unavailable.',
        503,
      );
    }
    return {
      ...result,
      questions: questions.map((question, index) => ({
        ...question,
        question: index === 0 ? source.question : question.question,
      })),
    };
  }

  async function evaluateQuestion(env, userId, input, question, expectedQuestions) {
    const answer = String(question?.answer || '').trim();
    const questionText = String(question?.question || '').trim();
    if (!auxiliaryAnswerEligible(answer) || !questionText) return 'not_assessed';
    const questionId = String(question.questionId || '').trim();
    const inputHash = await sha256Hex([
      AUXILIARY_WRITING_DIAGNOSTICS_VERSION,
      input.sourceType,
      input.sourceId,
      questionId,
      questionText,
      answer,
    ].join('\n'));
    const claim = await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_claim', {
      p_user_id: userId,
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
      p_question_id: questionId,
      p_input_hash: inputHash,
      p_diagnostic_version: AUXILIARY_WRITING_DIAGNOSTICS_VERSION,
      p_expected_questions: expectedQuestions,
    });
    if (claim?.claimed !== true || !claim?.jobId) return claim?.status || 'unchanged';
    if (!claim?.claimToken) {
      throw new TypeError('The auxiliary diagnostic claim is missing its lease token.');
    }
    try {
      const evaluated = await structuredGemini(
        env,
        buildAuxiliaryWritingDiagnosticsPrompt({ question: questionText, answer }),
        AUXILIARY_WRITING_DIAGNOSTICS_RESPONSE_SCHEMA,
        validateAuxiliaryWritingDiagnosticsResult,
      );
      await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_finish', auxiliaryPersistencePayload({
        userId,
        jobId: claim.jobId,
        claimToken: claim.claimToken,
        result: evaluated.result,
        model: evaluated.model,
      }));
      return 'completed';
    } catch (error) {
      await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_fail', {
        p_user_id: userId,
        p_job_id: claim.jobId,
        p_claim_token: claim.claimToken,
        p_failure_code: String(error?.code || 'AUXILIARY_EVALUATION_FAILED').slice(0, 80),
      }).catch(() => undefined);
      throw error;
    }
  }

  async function ensure(request, env, origin, allowedOrigin, ctx) {
    await enforceDD2026RateLimit(request, env, true);
    const user = await requireAuthenticatedUser(request, env);
    const input = auxiliaryRequest(
      await parseBoundedJson(request, 5_000),
      normalizeAuxiliaryEnsureRequest,
    );
    const source = await resolvedSource(env, user.id, input);
    const eligibleQuestions = source.questions.filter((question) => (
      auxiliaryAnswerEligible(question?.answer)
        && String(question?.question || '').trim()
        && String(question?.questionId || '').trim()
    ));
    if (!eligibleQuestions.length) {
      return jsonResponse({
        ok: true,
        result: {
          status: 'not_assessed',
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          expectedQuestions: 0,
        },
      }, 200, origin, allowedOrigin);
    }

    const existingResult = await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_records', {
      p_user_id: user.id,
      p_records: [{ sourceType: input.sourceType, sourceId: input.sourceId }],
      p_diagnostic_version: AUXILIARY_WRITING_DIAGNOSTICS_VERSION,
    });
    const existingItems = recordsForSource(existingResult, input);
    const itemByQuestion = new Map(existingItems.map((item) => [
      String(item?.questionId || '').trim(),
      item,
    ]));
    const completedBefore = eligibleQuestions.filter((question) => (
      itemByQuestion.get(String(question.questionId).trim())?.status === 'completed'
    )).length;
    if (completedBefore >= eligibleQuestions.length) {
      return jsonResponse({
        ok: true,
        result: {
          status: 'ready',
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          expectedQuestions: eligibleQuestions.length,
        },
      }, 200, origin, allowedOrigin);
    }

    const missingCandidates = [];
    const failedCandidates = [];
    const expiredLeaseCandidates = [];
    const leaseCutoff = Date.now() - PROCESSING_LEASE_MS;
    for (const question of eligibleQuestions) {
      const item = itemByQuestion.get(String(question.questionId).trim());
      if (!item) {
        missingCandidates.push(question);
        continue;
      }
      if (item.status === 'failed') {
        failedCandidates.push({ item, question });
        continue;
      }
      if (item.status === 'processing') {
        const updatedAt = new Date(item.updatedAt || 0).getTime();
        if (!Number.isFinite(updatedAt) || updatedAt <= leaseCutoff) {
          expiredLeaseCandidates.push({ item, question });
        }
      }
    }
    const oldestFirst = (left, right) => (
      new Date(left.item?.updatedAt || 0).getTime() - new Date(right.item?.updatedAt || 0).getTime()
    );
    const candidates = [
      ...missingCandidates,
      ...expiredLeaseCandidates.sort(oldestFirst).map(({ question }) => question),
      ...failedCandidates.sort(oldestFirst).map(({ question }) => question),
    ].slice(0, MAX_QUESTIONS_PER_ENSURE);
    const work = runWithConcurrency(
      candidates,
      2,
      (question) => evaluateQuestion(env, user.id, input, question, eligibleQuestions.length),
    ).then((outcome) => {
      if (outcome.failures.length) {
        console.warn('Auxiliary writing diagnostic background batch had failures', {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          failed: outcome.failures.length,
        });
      }
      return outcome;
    });
    const scheduled = typeof ctx?.waitUntil === 'function';
    if (scheduled) {
      ctx.waitUntil(work);
      return jsonResponse({
        ok: true,
        result: {
          status: 'processing',
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          expectedQuestions: eligibleQuestions.length,
        },
      }, 202, origin, allowedOrigin);
    }

    const outcome = await work;
    const refreshedResult = await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_records', {
      p_user_id: user.id,
      p_records: [{ sourceType: input.sourceType, sourceId: input.sourceId }],
      p_diagnostic_version: AUXILIARY_WRITING_DIAGNOSTICS_VERSION,
    });
    const refreshedItems = recordsForSource(refreshedResult, input);
    const completedAfter = new Set(refreshedItems.filter((item) => item?.status === 'completed').map((item) => (
      String(item?.questionId || '').trim()
    ))).size;
    const status = outcome.failures.length === candidates.length && candidates.length > 0 && completedAfter === 0
      ? 'unavailable'
      : outcome.failures.length > 0
        ? 'partial'
        : completedAfter >= eligibleQuestions.length
          ? 'ready'
          : 'processing';
    return jsonResponse({
      ok: true,
      result: {
        status,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        expectedQuestions: eligibleQuestions.length,
      },
    }, 200, origin, allowedOrigin);
  }

  async function records(request, env, origin, allowedOrigin) {
    await enforceDD2026RateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    const input = auxiliaryRequest(
      await parseBoundedJson(request, 45_000),
      normalizeAuxiliaryRecordsRequest,
    );
    if (!input.records.length) {
      return jsonResponse({ ok: true, result: { items: [] } }, 200, origin, allowedOrigin);
    }
    const result = await dd2026Rpc(env, 'dd2026_auxiliary_diagnostic_records', {
      p_user_id: user.id,
      p_records: input.records,
      p_diagnostic_version: AUXILIARY_WRITING_DIAGNOSTICS_VERSION,
    });
    return jsonResponse({ ok: true, result: sanitizeLearnerFacingPayload(result) }, 200, origin, allowedOrigin);
  }

  return { ensure, records };
}
