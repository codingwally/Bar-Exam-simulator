import {
  PedroValidationError,
  actionTargetForCandidate,
  assignPedroCandidateIds,
  buildPedroClassifierPrompt,
  buildPedroClassifierSchema,
  deterministicPedroResponse,
  extractPedroSearchTerms,
  isLikelyWebsiteStudyRequest,
  normalizePedroCandidate,
  normalizePedroCandidateCollection,
  normalizePedroCompletion,
  normalizePedroHistoryResult,
  normalizePedroMessageRequest,
  normalizePedroQueryRequest,
  normalizePedroReservation,
  normalizeResolvedPedroAction,
  normalizeSyllabusTarget,
  pedroFailureClass,
  publicPedroError,
  validatePedroClassifierResult,
} from './pedro-core.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requireDependency(deps, name) {
  if (typeof deps?.[name] !== 'function') {
    throw new TypeError(`createPedroHandlers requires ${name}`);
  }
  return deps[name];
}

function authenticatedUserId(user) {
  const id = String(user?.id || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) {
    throw new PedroValidationError('AUTHENTICATION_REQUIRED', 'Sign in to use Pedro.', 401);
  }
  return id;
}

function withRetryAfter(response, seconds) {
  if (response?.headers && Number.isInteger(seconds) && seconds > 0) {
    response.headers.set('Retry-After', String(seconds));
  }
  return response;
}

function safeErrorPayload(error) {
  const safe = publicPedroError(error);
  const payload = {
    code: safe.code,
    message: safe.message,
    retryable: safe.retryable,
  };
  if (safe.retryAfterSeconds) payload.retryAfterSeconds = safe.retryAfterSeconds;
  return { safe, payload };
}

function safeFailureFromReservation(reservation) {
  if (reservation.state === 'failed_retryable') {
    return new PedroValidationError(
      'PEDRO_UNAVAILABLE',
      'Pedro is temporarily unavailable. Your message is still here—try again.',
      503,
      { retryable: true, retryAfterSeconds: reservation.retryAfterSeconds || 3 },
    );
  }
  return new PedroValidationError(
    'PEDRO_ATTEMPTS_EXHAUSTED',
    'Pedro could not finish that message after several tries. Send it again as a new message.',
    503,
    { retryable: false },
  );
}

async function hydrateSyllabusCandidates(candidates, selectSyllabusTarget, context) {
  const hydrated = [];
  for (const candidate of candidates) {
    if (candidate.type !== 'syllabus' || (candidate.versionId && candidate.questionId)) {
      hydrated.push(candidate);
      continue;
    }
    if (typeof selectSyllabusTarget !== 'function') {
      throw new PedroValidationError(
        'PEDRO_SEARCH_UNAVAILABLE',
        'Pedro could not safely open the selected Syllabus question.',
        503,
        { retryable: true },
      );
    }
    const selected = await selectSyllabusTarget(Object.freeze({
      referenceId: candidate.referenceId,
      title: candidate.title,
      subject: candidate.subject,
    }), context);
    if (selected == null) continue;
    const target = normalizeSyllabusTarget(selected);
    hydrated.push(normalizePedroCandidate({
      type: 'syllabus',
      title: candidate.title,
      subject: candidate.subject,
      versionId: target.versionId,
      questionId: target.questionId,
      score: candidate.score,
    }));
  }
  return hydrated;
}

export function createPedroHandlers(deps) {
  const requireAuthenticatedUser = requireDependency(deps, 'requireAuthenticatedUser');
  const parseBoundedJson = requireDependency(deps, 'parseBoundedJson');
  const jsonResponse = requireDependency(deps, 'jsonResponse');
  const pedroRpc = requireDependency(deps, 'pedroRpc');
  const structuredClassifier = requireDependency(deps, 'structuredClassifier');
  const searchMockBar = requireDependency(deps, 'searchMockBar');
  const enforcePedroRateLimit = requireDependency(deps, 'enforcePedroRateLimit');
  const selectSyllabusTarget = deps.selectSyllabusTarget;
  if (selectSyllabusTarget != null && typeof selectSyllabusTarget !== 'function') {
    throw new TypeError('createPedroHandlers selectSyllabusTarget must be a function when provided');
  }

  function respond(body, status, origin, allowedOrigin, retryAfterSeconds = null) {
    return withRetryAfter(
      jsonResponse(body, status, origin, allowedOrigin),
      retryAfterSeconds,
    );
  }

  async function parsePedroJson(request) {
    try {
      return await parseBoundedJson(request, 8_000);
    } catch (error) {
      if (Number(error?.status) === 413
          || ['PAYLOAD_TOO_LARGE', 'REQUEST_TOO_LARGE'].includes(String(error?.code || '').toUpperCase())) {
        throw error;
      }
      throw new PedroValidationError(
        'PEDRO_INVALID_REQUEST',
        'Pedro received an invalid request.',
        400,
      );
    }
  }

  function respondError(error, origin, allowedOrigin) {
    const { safe, payload } = safeErrorPayload(error);
    return respond(
      { ok: false, error: payload },
      safe.status,
      origin,
      allowedOrigin,
      safe.retryAfterSeconds,
    );
  }

  async function failReservedTurn(env, claim, error) {
    if (!claim) return;
    try {
      await pedroRpc(env, 'pedro_fail_turn', {
        p_user_id: claim.userId,
        p_turn_id: claim.turnId,
        p_claim_version: claim.claimVersion,
        p_failure_class: pedroFailureClass(error),
        p_retryable: publicPedroError(error).retryable,
      });
    } catch {
      // A stale claim or a completion whose response was interrupted must not
      // overwrite the database's newer durable state.
    }
  }

  async function completeReservedTurn(env, claim, responseKind, actions) {
    const result = await pedroRpc(env, 'pedro_complete_turn', {
      p_user_id: claim.userId,
      p_turn_id: claim.turnId,
      p_claim_version: claim.claimVersion,
      p_response_kind: responseKind,
      p_actions: actions,
    });
    return normalizePedroCompletion(result, responseKind);
  }

  function sendSuccess(completion, reservation, origin, allowedOrigin, replayed = false) {
    return respond({
      ok: true,
      data: {
        threadId: completion.threadId,
        accessKind: reservation.accessKind,
        testMode: reservation.testMode,
        replayed,
        message: completion.message,
      },
    }, 200, origin, allowedOrigin);
  }

  async function message(request, env, origin, allowedOrigin) {
    let claim = null;
    try {
      await enforcePedroRateLimit(request, env, 'message');
      const userId = authenticatedUserId(await requireAuthenticatedUser(request, env));
      const input = normalizePedroMessageRequest(await parsePedroJson(request));
      const reservation = normalizePedroReservation(await pedroRpc(env, 'pedro_reserve_turn', {
        p_user_id: userId,
        p_thread_id: input.threadId,
        p_request_key: input.requestKey,
        p_input_text: input.message,
      }));

      if (reservation.state === 'completed') {
        return sendSuccess({
          threadId: reservation.threadId,
          message: reservation.message,
        }, reservation, origin, allowedOrigin, true);
      }
      if (reservation.state === 'in_progress') {
        return respond({
          ok: true,
          data: {
            threadId: reservation.threadId,
            accessKind: reservation.accessKind,
            testMode: reservation.testMode,
            message: null,
            inProgress: true,
            retryAfterSeconds: reservation.retryAfterSeconds,
          },
        }, 202, origin, allowedOrigin, reservation.retryAfterSeconds);
      }
      if (reservation.state === 'failed_retryable' || reservation.state === 'failed_terminal') {
        throw safeFailureFromReservation(reservation);
      }

      claim = Object.freeze({
        userId,
        turnId: reservation.turnId,
        claimVersion: reservation.claimVersion,
      });

      const deterministic = deterministicPedroResponse(input.message);
      if (deterministic) {
        const completion = await completeReservedTurn(env, claim, deterministic.responseKind, []);
        return sendSuccess(completion, reservation, origin, allowedOrigin);
      }

      const terms = extractPedroSearchTerms(input.message);
      if (!terms.length) {
        const completion = await completeReservedTurn(env, claim, 'outside_scope', []);
        return sendSuccess(completion, reservation, origin, allowedOrigin);
      }

      let published;
      let mock;
      try {
        [published, mock] = await Promise.all([
          pedroRpc(env, 'pedro_search_published_content', {
            p_user_id: userId,
            p_turn_id: reservation.turnId,
            p_claim_version: reservation.claimVersion,
            p_terms: terms,
            p_limit: 4,
          }),
          searchMockBar(Object.freeze({ terms, limit: 4 }), env),
        ]);
      } catch {
        throw new PedroValidationError(
          'PEDRO_SEARCH_UNAVAILABLE',
          'Pedro could not search the published study material just now. Your message is still here—try again.',
          503,
          { retryable: true },
        );
      }

      const normalizedPublished = normalizePedroCandidateCollection(published);
      let publishedCandidates = normalizedPublished
        .filter((candidate) => candidate.type !== 'mock_bar');
      if (publishedCandidates.length !== normalizedPublished.length) {
        throw new PedroValidationError(
          'PEDRO_SEARCH_UNAVAILABLE',
          'Pedro could not safely read the published study catalog.',
          503,
          { retryable: true },
        );
      }
      publishedCandidates = await hydrateSyllabusCandidates(
        publishedCandidates.slice(0, 8),
        selectSyllabusTarget,
        Object.freeze({ env, userId, turnId: reservation.turnId, claimVersion: reservation.claimVersion }),
      );
      const mockCandidates = normalizePedroCandidateCollection(mock, 'mock_bar');
      const candidates = assignPedroCandidateIds([
        ...publishedCandidates,
        ...mockCandidates.slice(0, 4),
      ]);

      if (!candidates.length) {
        const responseKind = isLikelyWebsiteStudyRequest(input.message) ? 'no_match' : 'outside_scope';
        const completion = await completeReservedTurn(env, claim, responseKind, []);
        return sendSuccess(completion, reservation, origin, allowedOrigin);
      }

      const responseSchema = buildPedroClassifierSchema(candidates);
      const validateClassifier = (value) => validatePedroClassifierResult(value, candidates);
      let classified;
      try {
        const result = await structuredClassifier(
          env,
          buildPedroClassifierPrompt(input.message, candidates),
          responseSchema,
          validateClassifier,
        );
        classified = validateClassifier(result?.result);
      } catch (error) {
        const safe = publicPedroError(error);
        if (safe.code === 'PEDRO_CAPACITY' || safe.code === 'PEDRO_TIMEOUT') throw error;
        throw new PedroValidationError(
          'PEDRO_UNAVAILABLE',
          'Pedro is temporarily unavailable. Your message is still here—try again.',
          503,
          { retryable: true, retryAfterSeconds: 3 },
        );
      }

      if (classified.scope === 'outside_scope') {
        const completion = await completeReservedTurn(env, claim, 'outside_scope', []);
        return sendSuccess(completion, reservation, origin, allowedOrigin);
      }

      const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
      const actions = classified.candidateIds.map((id) => actionTargetForCandidate(byId.get(id)));
      const responseKind = actions.length > 1 ? 'choose_location' : 'match';
      const completion = await completeReservedTurn(env, claim, responseKind, actions);
      return sendSuccess(completion, reservation, origin, allowedOrigin);
    } catch (error) {
      await failReservedTurn(env, claim, error);
      return respondError(error, origin, allowedOrigin);
    }
  }

  async function query(request, env, origin, allowedOrigin) {
    try {
      await enforcePedroRateLimit(request, env, 'query');
      const userId = authenticatedUserId(await requireAuthenticatedUser(request, env));
      const input = normalizePedroQueryRequest(await parsePedroJson(request));
      if (input.operation === 'resolve_action') {
        const result = normalizeResolvedPedroAction(await pedroRpc(env, 'pedro_resolve_action', {
          p_user_id: userId,
          p_action_id: input.actionId,
        }));
        return respond({ ok: true, data: result }, 200, origin, allowedOrigin);
      }
      const result = normalizePedroHistoryResult(await pedroRpc(env, 'pedro_history', {
        p_user_id: userId,
        p_thread_id: input.threadId,
        p_limit: input.limit,
        p_before_created_at: input.before?.createdAt || null,
        p_before_turn_id: input.before?.turnId || null,
      }));
      return respond({ ok: true, data: result }, 200, origin, allowedOrigin);
    } catch (error) {
      return respondError(error, origin, allowedOrigin);
    }
  }

  return Object.freeze({ message, query });
}
