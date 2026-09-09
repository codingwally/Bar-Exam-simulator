import { randomBytes } from 'node:crypto';
import { FIXTURE_TARGET, studyDebateFixtureIdentity } from './debate-staging-fixtures.mjs';
import { createHostedDataSafety, HOSTED_ACTOR_NAMES, HOSTED_BUCKET } from './debate-hosted-cleanup.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const need = (value, code) => { if (!value) { const e = new Error(code); e.code = code; throw e; } };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clone = value => structuredClone(value);

// Genuine Study access checks use the established immutable fixture registrar.
// Event-local Debate roles never promote these students to platform admins.
export function createHostedDebateFixtureLifecycle({ sourceSha, supabaseUrl, workerUrl,
  serviceRoleKey, publishableKey, persist, verifySuppression, request = fetch,
  random = randomBytes, clock = Date.now, pause }) {
  need(SHA.test(sourceSha || ''), 'FIXTURE_SOURCE_INVALID');
  need(supabaseUrl === FIXTURE_TARGET.supabaseUrl && workerUrl === FIXTURE_TARGET.workerUrl, 'FIXTURE_TARGET_INVALID');
  need(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(serviceRoleKey || '') &&
    /^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(publishableKey || ''), 'FIXTURE_CREDENTIAL_MISSING');
  need(typeof persist === 'function' && typeof verifySuppression === 'function', 'FIXTURE_GATES_REQUIRED');
  const sessions = new Map(), receivedSessions = new Map(), cleanupAccess = new Map(), signInDispatched = new Set(), sessionOperations = new Map();
  const manifest = { schemaVersion: 1, purpose: 'Study Room regression and hosted Debate organizer control rehearsal',
    projectRef: FIXTURE_TARGET.projectRef, sourceSha, startedAt: new Date(clock()).toISOString(),
    runTag: `dv3host-${random(8).toString('hex')}`, noMail: true, noMediaProvider: true, noPublicLaunch: true, credentialsStored: false,
    registration: 'existing-astra-staging-study-room-v1-before-first-sign-in',
    classificationRetention: 'Auth deletion cascades registry; sanitized registration receipts retained here',
    cleanupComplete: false, immediateLogoutFencingVerified: null, atomicCleanupHelperVerified: false, fixtures: [], eventIntents: [], dataCleanup: {} };
  const snapshot = () => clone(manifest);
  const save = async () => persist(snapshot());
  async function transport(origin, route, options = {}, expected = [200], key = serviceRoleKey) {
    need(origin === supabaseUrl || origin === workerUrl, 'FIXTURE_TRANSPORT_SCOPE');
    need(route.startsWith('/') && !route.startsWith('//') && !route.includes('#'), 'FIXTURE_TRANSPORT_SCOPE');
    let response;
    try { response = await request(origin + route, { ...options, redirect: 'error', cache: 'no-store',
      headers: { ...(origin === supabaseUrl ? { apikey: key } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: AbortSignal.timeout(30000) }); }
    catch { need(false, 'FIXTURE_REQUEST_OUTCOME_UNKNOWN'); }
    const body = await response.json().catch(() => null);
    need(expected.includes(response.status), 'FIXTURE_REMOTE_CONTRACT');
    return { body, status: response.status, range: response.headers.get('content-range') };
  }
  const service = (route, options, expected) => transport(supabaseUrl, route, options, expected);
  const safety = createHostedDataSafety({ supabaseUrl, service, persist: save, clock, ...(pause ? { pause } : {}) });
  async function rows(table, id, column = 'user_id') {
    need(UUID.test(id), 'FIXTURE_ID_INVALID');
    const query = new URLSearchParams({ [column]: `eq.${id}`, select: '*', limit: '101' });
    const result = await service(`/rest/v1/${table}?${query}`, { headers: { Prefer: 'count=exact' } });
    const total = /^(?:\d+-\d+|\*)\/(\d+)$/u.exec(result.range || '');
    need(Array.isArray(result.body) && result.body.length <= 100 && total &&
      Number(total[1]) === result.body.length, 'FIXTURE_INCOMPLETE_DISCOVERY');
    return result.body;
  }
  async function identity(record) {
    need(record.creationState === 'recorded' && UUID.test(record.id), 'FIXTURE_CREATION_UNRESOLVED');
    const result = await service(`/auth/v1/admin/users/${record.id}`);
    const user = result.body?.user || result.body, expected = studyDebateFixtureIdentity(record.runId);
    need(user?.id === record.id && user?.email === expected.email &&
      user?.user_metadata?.full_name === expected.fullName && user?.role === 'authenticated' && user?.aud === 'authenticated' &&
      !user?.is_super_admin && !user?.is_anonymous && !user?.is_sso_user && !user?.deleted_at &&
      user?.app_metadata?.provider === 'email' && equal(user?.app_metadata?.providers, ['email']) &&
      equal(user?.app_metadata?.astra_staging_study_room_fixture, expected.marker) &&
      equal(Object.keys(user?.app_metadata || {}).sort(), ['astra_staging_study_room_fixture', 'provider', 'providers']) &&
      user.created_at === record.createdAt, 'FIXTURE_IDENTITY_DRIFT');
    return user;
  }
  async function proveSession(record, token) {
    const { body } = await transport(supabaseUrl, '/auth/v1/user', {
      headers: { Authorization: `Bearer ${token}` } }, [200], publishableKey);
    need(body?.id === record.id, 'FIXTURE_SESSION_IDENTITY');
  }
  function rememberReceived(record, session) {
    // A successful token response may already have rotated server credentials.
    // Retain it before metadata validation; never serialize this map to evidence.
    receivedSessions.set(record.id, clone(session));
  }
  function accessClaims(record, session, { allowExpired = false } = {}) {
    const token = session?.access_token;
    need(typeof token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token), 'HOSTED_SESSION_INVALID');
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
    catch { need(false, 'HOSTED_SESSION_INVALID'); }
    need(claims?.sub === record.id && claims.iss === `${supabaseUrl}/auth/v1` &&
      Number.isSafeInteger(claims.exp) && claims.exp > 0 && Number.isSafeInteger(claims.exp * 1000) &&
      (allowExpired || claims.exp * 1000 > clock()), 'HOSTED_SESSION_INVALID');
    return claims;
  }
  async function qualifyCleanupAccess(record, session) {
    const claims = accessClaims(record, session);
    // Parsing is not signature verification. Only the fixed Auth server's live
    // exact-user response qualifies this bearer for active use or logout.
    await proveSession(record, session.access_token);
    const known = cleanupAccess.get(record.id);
    if (!known || claims.exp >= known.expires_at) cleanupAccess.set(record.id, { access_token: session.access_token, expires_at: claims.exp });
    record.cleanupAccessVerified = true;
  }
  async function create(purpose) {
    need(HOSTED_ACTOR_NAMES.includes(purpose) && !manifest.fixtures.some(r => r.purpose === purpose), 'FIXTURE_PURPOSE_INVALID');
    const runId = `dv3study-${random(4).toString('hex')}`;
    need(!manifest.fixtures.some(r => r.runId === runId), 'FIXTURE_RUN_COLLISION');
    const expected = studyDebateFixtureIdentity(runId), password = `Dd!${random(30).toString('base64url')}9z`;
    const record = { purpose, runId, label: 'student', id: null, createdAt: null, creationState: 'requested',
      registrationState: 'not_started', signInState: 'not_started', signOutState: 'not_started', cleanupState: 'pending' };
    manifest.fixtures.push(record); await save();
    const result = await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({
      email: expected.email, password, email_confirm: true, user_metadata: { full_name: expected.fullName },
      app_metadata: { astra_staging_study_room_fixture: expected.marker } }) }, [200, 201]);
    const user = result.body?.user || result.body;
    need(UUID.test(user?.id || ''), 'FIXTURE_CREATE_RESPONSE');
    record.id = user.id; record.createdAt = user.created_at; record.creationState = 'recorded'; await save();
    need(Number.isFinite(Date.parse(record.createdAt)) && Math.abs(clock() - Date.parse(record.createdAt)) < 60000,
      'FIXTURE_CREATE_TIME');
    await identity(record);
    record.registrationState = 'requested'; await save();
    const registration = await service('/rest/v1/rpc/astra_register_staging_study_room_fixture', {
      method: 'POST', body: JSON.stringify({ p_user_id: record.id, p_run_id: record.runId, p_label: 'student' }) });
    need(registration.body?.registered === true && registration.body?.fixtureUserId === record.id &&
      registration.body?.dataScope === 'internal_test' && registration.body?.registrationVersion === 'astra-staging-study-room-v1',
      'FIXTURE_REGISTRATION_UNCONFIRMED');
    record.registrationReceipt = { registered: true, fixtureUserId: record.id, dataScope: 'internal_test',
      registrationVersion: 'astra-staging-study-room-v1' };
    record.registrationState = 'confirmed'; record.signInState = 'requested'; await save();
    signInDispatched.add(record.id);
    const login = await transport(supabaseUrl, '/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: expected.email, password }) }, [200], publishableKey);
    rememberReceived(record, login.body); record.signInState = 'response_received'; await save();
    await qualifyCleanupAccess(record, login.body);
    const session = validateSessionShape(record, login.body);
    sessions.set(record.id, session); record.signInState = 'confirmed'; await save();
    // Study access is part of this run's genuine purpose; no room join or token.
    const study = await transport(workerUrl, '/study-room/access', { method: 'POST', body: '{}', headers: {
      Authorization: `Bearer ${session.access_token}`, Origin: workerUrl } });
    need(study.body?.ok === true && study.body?.allowed === true && study.body?.role === 'member' &&
      study.body?.administrator === false && study.body?.canCreateRooms === false && study.body?.recording === false,
      'FIXTURE_STUDY_ACCESS_REGRESSION');
    record.studyAccess = 'PASS_STUDENT_ACCESS_NO_JOIN'; await save();
    return Object.freeze({ id: record.id });
  }
  function validateSessionShape(record, session, { allowExpired = false } = {}) {
    const claims = accessClaims(record, session, { allowExpired });
    // GoTrue refresh tokens are opaque; its legacy generator emits 12 chars.
    // auth-js 2.69.1 also normalizes REST expires_in-only responses. Use the
    // server-authenticated JWT expiry, never a client-derived expiry extension.
    need(session?.user?.id === record.id && typeof session.refresh_token === 'string' && session.refresh_token.length > 0 &&
      Number.isSafeInteger(session.expires_in) && session.expires_in > 0 && session.token_type === 'bearer' &&
      (session.expires_at === undefined || Number.isSafeInteger(session.expires_at) && session.expires_at > 0), 'HOSTED_SESSION_INVALID');
    return { ...clone(session), expires_at: claims.exp };
  }
  async function sessionOperation(id, callback) {
    const previous = sessionOperations.get(id) || Promise.resolve(), pending = previous.catch(() => {}).then(callback);
    sessionOperations.set(id, pending);
    try { return await pending; } finally { if (sessionOperations.get(id) === pending) sessionOperations.delete(id); }
  }
  async function sessionFor(purpose) {
    const record = manifest.fixtures.find(f => f.purpose === purpose);
    need(record?.signInState === 'confirmed' && record.signOutState === 'not_started', 'HOSTED_SESSION_UNAVAILABLE');
    return sessionOperation(record.id, async () => {
    let session = validateSessionShape(record, sessions.get(record.id), { allowExpired: true });
    if (session.expires_at * 1000 < clock() + 120000) {
      need(record.refreshState !== 'requested', 'HOSTED_REFRESH_OUTCOME_UNKNOWN');
      record.refreshState = 'requested'; await save();
      const refreshed = await transport(supabaseUrl, '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) }, [200], publishableKey);
      rememberReceived(record, refreshed.body); await qualifyCleanupAccess(record, refreshed.body);
      session = validateSessionShape(record, refreshed.body); sessions.set(record.id, session); record.refreshState = 'confirmed';
      record.refreshCount = (record.refreshCount || 0) + 1; await save();
    }
    return clone(session);
    });
  }
  async function acceptBrowserSession(purpose, session, { refreshResponse = false } = {}) {
    const record = manifest.fixtures.find(f => f.purpose === purpose);
    need(record?.signInState === 'confirmed' && record.signOutState === 'not_started', 'HOSTED_SESSION_UNAVAILABLE');
    session = clone(session);
    return sessionOperation(record.id, async () => {
    rememberReceived(record, session);
    const claims = accessClaims(record, session, { allowExpired: true });
    need(session?.user?.id === record.id, 'HOSTED_SESSION_INVALID');
    const current = sessions.get(record.id);
    if (current && claims.exp < current.expires_at) {
      record.olderBrowserSessionIgnored = (record.olderBrowserSessionIgnored || 0) + 1; await save(); return false;
    }
    // A closing context can still expose its pre-refresh storage value. That
    // value cannot resolve a refresh whose HTTP response was lost.
    if (record.refreshState === 'requested' && session.access_token === current?.access_token && !refreshResponse) return false;
    need(!current || claims.exp !== current.expires_at || session.access_token === current.access_token ||
      (refreshResponse && record.refreshState === 'requested' && record.refreshOwner === 'browser'), 'HOSTED_SESSION_ORDER_UNCONFIRMED');
    await qualifyCleanupAccess(record, session); session = validateSessionShape(record, session);
    sessions.set(record.id, session); record.refreshState = 'confirmed'; record.browserSessionAcceptedAt = new Date(clock()).toISOString(); await save(); return true;
    });
  }
  async function recordBrowserRefreshIntent(purpose) {
    const record = manifest.fixtures.find(f => f.purpose === purpose);
    need(record?.signInState === 'confirmed' && record.signOutState === 'not_started', 'HOSTED_SESSION_UNAVAILABLE');
    return sessionOperation(record.id, async () => { need(record.refreshState !== 'requested', 'HOSTED_REFRESH_OUTCOME_UNKNOWN');
      record.refreshState = 'requested'; record.refreshOwner = 'browser'; await save(); });
  }
  async function fenceSession(record, { requireImmediate = true } = {}) {
    const current = await identity(record);
    if (record.signOutState === 'confirmed' && record.authDeniedBeforeCleanup && record.workerDeniedBeforeCleanup) return;
    const priorAccess = cleanupAccess.get(record.id), received = receivedSessions.get(record.id);
    if (received && (!priorAccess || priorAccess.expires_at * 1000 <= clock() + 30000) && received.access_token !== priorAccess?.access_token) {
      // A preceding transport/readback failure may have interrupted qualification.
      // Retry only the authoritative read, never a password or refresh grant.
      await qualifyCleanupAccess(record, receivedSessions.get(record.id));
    }
    let known = cleanupAccess.get(record.id), token = known?.access_token;
    if (record.signInState === 'not_started' || (record.signInState === 'requested' && !signInDispatched.has(record.id))) {
      // The password exists only in this process. No sign-in was attempted; an
      // unexpected sign-in timestamp stops cleanup for exact-ID reconciliation.
      // Registration failure need not leak a freshly created, owned account.
      need(current.last_sign_in_at == null && !token, 'FIXTURE_UNEXPECTED_SIGNIN');
      if (record.signInState === 'requested') {
        record.signInState = 'not_started'; record.signInNotDispatchedConfirmed = true;
      }
      record.signOutState = 'not_needed_no_signin_requested'; await save();
    } else {
      // A lost sign-in response can have created a session whose token we do not
      // have. Do not pretend it was revoked or blindly recreate credentials.
      need(record.registrationState === 'confirmed' && ['confirmed', 'response_received'].includes(record.signInState), 'FIXTURE_UNRESOLVED_STATE');
      need(token, 'FIXTURE_SESSION_UNAVAILABLE');
      if (record.signOutState === 'not_started') {
        // A refresh may have completed remotely after its response was lost.
        // Revoke through the still-valid known access token; never resubmit the
        // uncertain refresh token just to obtain a logout credential.
        if (known.expires_at * 1000 <= clock() + 30000) {
          need(record.signInState === 'confirmed' && record.refreshState !== 'requested', 'HOSTED_CLEANUP_SESSION_EXPIRED');
          token = (await sessionFor(record.purpose)).access_token; known = cleanupAccess.get(record.id);
        }
        need(known?.access_token === token && known.expires_at * 1000 > clock(), 'HOSTED_CLEANUP_SESSION_EXPIRED');
        record.signOutState = 'requested'; record.logoutTransportState = 'requested'; await save();
        await transport(supabaseUrl, '/auth/v1/logout?scope=global', { method: 'POST',
          headers: { Authorization: `Bearer ${token}` } }, [200, 204], publishableKey);
        record.signOutState = 'confirmed'; record.logoutTransportState = 'confirmed'; await save();
      }
      const auth = await transport(supabaseUrl, '/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } }, [200, 401, 403], publishableKey);
      record.immediateFenceAuthStatus = auth.status; record.authDeniedBeforeCleanup = [401, 403].includes(auth.status);
      const worker = await transport(workerUrl, '/debate-room/events', { headers: { Authorization: `Bearer ${token}`, Origin: workerUrl } }, [200, 401, 403]);
      record.immediateFenceWorkerStatus = worker.status;
      record.workerDeniedBeforeCleanup = worker.status === 401 || (worker.status === 403 && ['INVALID_SESSION', 'AUTH_REQUIRED', 'STUDY_ROOM_ACCOUNT_UNAVAILABLE'].includes(worker.body?.error?.code));
      // A known 2xx response confirms logout; an unknown response can be
      // reconciled only by both immediate denials, never by another mutation.
      if (record.logoutTransportState === 'confirmed' || (record.authDeniedBeforeCleanup && record.workerDeniedBeforeCleanup)) record.signOutState = 'confirmed';
      await save();
      if (requireImmediate) need(record.authDeniedBeforeCleanup && record.workerDeniedBeforeCleanup, 'HOSTED_SESSION_FENCE_UNCONFIRMED');
    }
  }
  async function assertFinancialEmpty(record) {
    for (const table of ['payment_requests', 'subscriptions', 'free_beta_access', 'admin_capabilities',
      'examination_beta_access', 'examination_participants', 'examination_attempts_multi', 'grade_reservations',
      'subscription_history', 'refund_requests']) need((await rows(table, record.id)).length === 0, 'FIXTURE_UNEXPECTED_OWNED_DATA');
    for (const table of ['payment_request_history', 'refund_request_history', 'subscription_history'])
      need((await rows(table, record.id, 'actor_user_id')).length === 0, 'FIXTURE_UNEXPECTED_FINANCIAL_HISTORY');
  }
  async function cleanupOne(record, { allowUnfencedAuthDelete = false } = {}) {
    await fenceSession(record, { requireImmediate: !allowUnfencedAuthDelete });
    const token = cleanupAccess.get(record.id)?.access_token;
    await assertFinancialEmpty(record);
    // Exact event/file cleanup must finish first. Any remaining actor data or
    // foreign membership blocks Auth deletion, including partial failures.
    for (const [table, column] of [['debate_v3_events', 'owner_id'], ['debate_v3_receipts', 'actor_id'],
      ['debate_v3_audit', 'actor_id'], ['debate_v3_ballots', 'judge_id'], ['debate_v3_votes', 'actor_id'],
      ['debate_v3_outbox', 'actor_id'], ['debate_v3_uploads', 'actor_id'], ['debate_v3_rate_limits', 'actor_id']])
      need((await rows(table, record.id, column)).length === 0, 'FIXTURE_UNEXPECTED_DEBATE_DATA');
    const membershipQuery = new URLSearchParams({ state: `cs.${JSON.stringify({ members: { [record.id]: {} } })}`,
      select: 'id', limit: '101' });
    const membership = await service(`/rest/v1/debate_v3_events?${membershipQuery}`, { headers: { Prefer: 'count=exact' } });
    need(Array.isArray(membership.body) && membership.body.length === 0 && membership.range === '*/0',
      'FIXTURE_UNEXPECTED_DEBATE_MEMBERSHIP');
    const audits = await rows('examination_audit_log', record.id, 'actor_user_id');
    need(audits.every(r => (typeof r.id === 'number' && Number.isSafeInteger(r.id)) ||
      (typeof r.id === 'string' && /^[0-9a-f-]{1,64}$/u.test(r.id))), 'FIXTURE_AUDIT_ID_INVALID');
    record.retainedAuditIds = audits.map(r => r.id);
    const roles = await rows('user_roles', record.id);
    need(roles.length === 1 && roles[0].role === 'student' && roles[0].assigned_by === null &&
      (await rows('user_roles', record.id, 'assigned_by')).length === 0, 'FIXTURE_ROLE_DRIFT');
    const exact = new URLSearchParams();
    for (const [key, value] of Object.entries(roles[0])) {
      need(/^[a-z][a-z0-9_]*$/u.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)) &&
        (typeof value !== 'number' || Number.isFinite(value)), 'FIXTURE_ROLE_SHAPE');
      exact.set(key, value === null ? 'is.null' : `eq.${String(value)}`);
    }
    record.cleanupState = 'role_delete_requested'; await save();
    const removed = await service(`/rest/v1/user_roles?${exact}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    need(equal(removed.body, roles), 'FIXTURE_ROLE_CAS_FAILED');
    const beforeDelete = await identity(record); // Recheck ownership immediately before Auth deletion.
    if (!token) need(beforeDelete.last_sign_in_at == null, 'FIXTURE_UNEXPECTED_SIGNIN');
    record.cleanupState = 'auth_delete_requested'; await save();
    await service(`/auth/v1/admin/users/${record.id}`, { method: 'DELETE' }, [200, 204]);
    const absent = await service(`/auth/v1/admin/users/${record.id}`, {}, [404]);
    need(absent.status === 404 && (await rows('user_roles', record.id)).length === 0, 'FIXTURE_AUTH_DELETE_UNVERIFIED');
    if (token) {
      const oldSession = await transport(supabaseUrl, '/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } }, [401, 403], publishableKey);
      need([401, 403].includes(oldSession.status), 'FIXTURE_OLD_SESSION_ACCEPTED');
      record.oldSessionDenied = true;
    } else { record.oldSessionDenied = null; record.sessionProof = 'No sign-in requested; Auth absence verified, no bearer to replay'; }
    record.cleanupState = 'auth_deleted_verified'; sessions.delete(record.id); receivedSessions.delete(record.id); cleanupAccess.delete(record.id); await save();
  }
  return Object.freeze({ snapshot, preflightStorage: safety.bucketPreflight,
    ensureStorage: () => safety.ensureBucket(manifest), sessionFor, acceptBrowserSession, recordBrowserRefreshIntent,
    async recordEventIntent({ title, idempotencyKey }) {
      need(['main', 'isolation'].some(suffix => title === `Hosted Debate ${manifest.runTag} ${suffix}`) && uuidKey(idempotencyKey), 'HOSTED_EVENT_INTENT_INVALID');
      const existing = manifest.eventIntents.find(intent => intent.title === title);
      need(!existing || existing.idempotencyKey === idempotencyKey, 'HOSTED_EVENT_INTENT_CONFLICT');
      if (!existing) { need(manifest.eventIntents.length < 2, 'HOSTED_EVENT_LIMIT');
        manifest.eventIntents.push({ title, idempotencyKey, creationState: 'REQUESTED' }); await save(); }
    },
    async recordEvent({ id, title }) {
      const intent = manifest.eventIntents.find(item => item.title === title);
      need(intent && UUID.test(id || '') && (!intent.id || intent.id === id), 'HOSTED_EVENT_UNDECLARED');
      intent.id = id; intent.creationState = 'RESPONSE_ID_RECORDED'; await save();
      const found = await safety.rows('debate_v3_events', { id: `eq.${id}` }, 1);
      need(found.length === 1, 'HOSTED_EVENT_READBACK'); safety.validateEvent(found[0], { fixtures: manifest.fixtures, runTag: manifest.runTag, title });
      intent.creationState = 'EXACT_OWNED_EVENT_CONFIRMED'; await save();
    },
    async readEvent(id) {
      const intent = manifest.eventIntents.find(item => item.id === id); need(intent, 'HOSTED_EVENT_UNDECLARED');
      const found = await safety.rows('debate_v3_events', { id: `eq.${id}` }, 1); need(found.length === 1, 'HOSTED_EVENT_READBACK');
      safety.validateEvent(found[0], { fixtures: manifest.fixtures, runTag: manifest.runTag, title: intent.title }); return clone(found[0].state);
    },
    async readStoredExport({ eventId, jobId, format }) {
      need(manifest.eventIntents.some(item => item.id === eventId) && UUID.test(jobId || '') && ['pdf', 'csv'].includes(format), 'HOSTED_EXPORT_SCOPE');
      const jobs = await safety.rows('debate_v3_outbox', { id: `eq.${jobId}`, event_id: `eq.${eventId}` }, 1);
      const storageKey = `exports/${eventId}/${jobId}.${format}`;
      need(jobs.length === 1 && jobs[0].type === 'export' && jobs[0].job?.payload?.format === format &&
        jobs[0].status === 'completed' && jobs[0].result?.storageKey === storageKey, 'HOSTED_EXPORT_UNCONFIRMED');
      const response = await request(`${supabaseUrl}/storage/v1/object/authenticated/${HOSTED_BUCKET.id}/${storageKey}`, {
        redirect: 'error', cache: 'no-store', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }, signal: AbortSignal.timeout(30000) });
      need(response.status === 200, 'HOSTED_EXPORT_READBACK');
      const reader = response.body?.getReader(); need(reader, 'HOSTED_EXPORT_READBACK'); const chunks = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
        if (size > HOSTED_BUCKET.fileSizeLimit) { await reader.cancel(); need(false, 'HOSTED_EXPORT_SIZE'); } chunks.push(value); }
      return Buffer.concat(chunks);
    },
    async provision() {
      need(manifest.fixtures.length === 0, 'FIXTURE_ALREADY_STARTED'); await save();
      const suppression = await verifySuppression();
      need(suppression?.projectRef === FIXTURE_TARGET.projectRef && suppression?.outboundEmailMode === 'suppressed',
        'FIXTURE_SUPPRESSION_REQUIRED');
      manifest.suppression = { projectRef: FIXTURE_TARGET.projectRef, outboundEmailMode: 'suppressed',
        checkedAt: new Date(clock()).toISOString() }; await save();
      need((await safety.bucketPreflight()).status === 'MATCHING_PRIVATE_BUCKET', 'HOSTED_BUCKET_REQUIRED');
      const accounts = {};
      for (const purpose of HOSTED_ACTOR_NAMES) accounts[purpose] = await create(purpose);
      need(new Set(Object.values(accounts).map(account => account.id)).size === 11, 'FIXTURE_SESSION_COLLISION');
      return Object.freeze({ runTag: manifest.runTag, accounts: Object.freeze(accounts),
        previewIds: HOSTED_ACTOR_NAMES.filter(purpose => purpose !== 'excluded').map(purpose => accounts[purpose].id), excludedId: accounts.excluded.id });
    },
    async cleanup() {
      const failures = [];
      let fenced = true;
      for (const record of manifest.fixtures.filter(record => record.creationState === 'recorded' && record.cleanupState !== 'auth_deleted_verified')) {
        try { await identity(record); await assertFinancialEmpty(record); await fenceSession(record, { requireImmediate: false });
          if (['confirmed', 'response_received'].includes(record.signInState) && (!record.authDeniedBeforeCleanup || !record.workerDeniedBeforeCleanup)) fenced = false; }
        catch (error) { fenced = false; record.failureCode = error?.code || 'HOSTED_SESSION_FENCE_UNCONFIRMED'; await save().catch(() => {}); }
      }
      const activeFixtures = manifest.fixtures.filter(record => record.creationState === 'recorded' && record.cleanupState !== 'auth_deleted_verified' &&
        ['confirmed', 'response_received'].includes(record.signInState) && cleanupAccess.has(record.id));
      manifest.immediateLogoutFencingVerified = manifest.fixtures.length === 11 && manifest.fixtures.every(record =>
        record.signInState === 'confirmed' && record.authDeniedBeforeCleanup && record.workerDeniedBeforeCleanup);
      let noEventRunConfirmed = false;
      if (manifest.eventIntents.length === 0 && activeFixtures.length) {
        try { noEventRunConfirmed = (await safety.collectOwnedEvents({ fixtures: activeFixtures, runTag: manifest.runTag, eventIntents: [] })).length === 0; }
        catch { noEventRunConfirmed = false; }
      }
      if (activeFixtures.length) {
        try { need(fenced, 'HOSTED_SESSIONS_NOT_FENCED');
          await safety.cleanupEvents(manifest.dataCleanup, { fixtures: activeFixtures, runTag: manifest.runTag, eventIntents: manifest.eventIntents,
            sessionsFenced: true, forceAtomicProbe: activeFixtures.length === 11 });
          manifest.atomicCleanupHelperVerified = manifest.dataCleanup.helperVerified === true; }
        catch (error) { manifest.dataCleanup.failureCode = error?.code || 'HOSTED_DATA_CLEANUP_UNCONFIRMED'; await save().catch(() => {}); }
      }
      for (const record of [...manifest.fixtures].reverse()) {
        if (record.cleanupState === 'auth_deleted_verified') continue;
        try { need(manifest.dataCleanup.atomic?.state !== 'DELETE_REQUESTED', 'HOSTED_ATOMIC_OUTCOME_UNRESOLVED');
          await cleanupOne(record, { allowUnfencedAuthDelete: noEventRunConfirmed }); }
        catch (error) { record.cleanupState = 'held'; record.failureCode = error?.code || 'FIXTURE_CLEANUP_UNCONFIRMED';
          failures.push({ purpose: record.purpose, code: record.failureCode }); await save().catch(() => {}); }
      }
      manifest.cleanupComplete = failures.length === 0;
      await save(); return { complete: manifest.cleanupComplete, failures, fixtureFencingVerified: manifest.immediateLogoutFencingVerified };
    },
  });
}

function uuidKey(value) { return /^[a-zA-Z0-9:_-]{8,160}$/u.test(value || ''); }
