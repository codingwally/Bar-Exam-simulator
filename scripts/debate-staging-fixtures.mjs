import { randomBytes } from 'node:crypto';

export const FIXTURE_TARGET = Object.freeze({ projectRef: 'hlzqmreeoghbldnhlybr',
  supabaseUrl: 'https://hlzqmreeoghbldnhlybr.supabase.co',
  workerUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev' });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const need = (value, code) => { if (!value) { const e = new Error(code); e.code = code; throw e; } };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clone = value => structuredClone(value);

// These are real Study regression accounts, also used for sibling Debate entry
// checks. This does not invent a Debate marker or a general-purpose registrar.
export function studyDebateFixtureIdentity(runId) {
  need(/^dv3study-[a-f0-9]{8}$/u.test(runId), 'FIXTURE_RUN_ID_INVALID');
  return { email: `dd-study-room-student-${runId}@example.com`, fullName: 'Synthetic Study Room student',
    marker: { version: 1, runId, label: 'student' } };
}

export function createStudyDebateFixtureLifecycle({ sourceSha, supabaseUrl, workerUrl,
  serviceRoleKey, publishableKey, persist, verifySuppression, request = fetch,
  random = randomBytes, clock = Date.now }) {
  need(SHA.test(sourceSha || ''), 'FIXTURE_SOURCE_INVALID');
  need(supabaseUrl === FIXTURE_TARGET.supabaseUrl && workerUrl === FIXTURE_TARGET.workerUrl, 'FIXTURE_TARGET_INVALID');
  need(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(serviceRoleKey || '') &&
    /^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(publishableKey || ''), 'FIXTURE_CREDENTIAL_MISSING');
  need(typeof persist === 'function' && typeof verifySuppression === 'function', 'FIXTURE_GATES_REQUIRED');
  const sessions = new Map(), signInDispatched = new Set();
  const manifest = { schemaVersion: 1, purpose: 'Study Room regression and Debate restricted-auth smoke',
    projectRef: FIXTURE_TARGET.projectRef, sourceSha, startedAt: new Date(clock()).toISOString(),
    noMail: true, noProvider: true, noDebateWrites: true, credentialsStored: false,
    registration: 'existing-astra-staging-study-room-v1-before-first-sign-in',
    classificationRetention: 'Auth deletion cascades registry; sanitized registration receipts retained here',
    cleanupComplete: false, fixtures: [] };
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
  async function create(purpose) {
    need(['allowed', 'excluded'].includes(purpose) && !manifest.fixtures.some(r => r.purpose === purpose), 'FIXTURE_PURPOSE_INVALID');
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
    need(login.body?.user?.id === record.id && typeof login.body?.access_token === 'string' &&
      login.body.access_token.length > 80, 'FIXTURE_SIGNIN_UNCONFIRMED');
    sessions.set(record.id, login.body.access_token); record.signInState = 'confirmed'; await save();
    await proveSession(record, login.body.access_token);
    // Study access is part of this run's genuine purpose; no room join or token.
    const study = await transport(workerUrl, '/study-room/access', { headers: {
      Authorization: `Bearer ${login.body.access_token}`, Origin: workerUrl } });
    need(study.body?.ok === true && study.body?.allowed === true && study.body?.role === 'student' &&
      study.body?.administrator === false && study.body?.canCreateRooms === false && study.body?.recording === false,
      'FIXTURE_STUDY_ACCESS_REGRESSION');
    record.studyAccess = 'PASS_STUDENT_ACCESS_NO_JOIN'; await save();
    return Object.freeze({ id: record.id, token: login.body.access_token });
  }
  async function cleanupOne(record) {
    const current = await identity(record);
    const token = sessions.get(record.id);
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
      need(record.registrationState === 'confirmed' && record.signInState === 'confirmed', 'FIXTURE_UNRESOLVED_STATE');
      need(token, 'FIXTURE_SESSION_UNAVAILABLE');
      record.signOutState = 'requested'; await save();
      await transport(supabaseUrl, '/auth/v1/logout?scope=global', { method: 'POST',
        headers: { Authorization: `Bearer ${token}` } }, [200, 204], publishableKey);
      record.signOutState = 'confirmed'; await save();
    }
    for (const table of ['payment_requests', 'subscriptions', 'free_beta_access', 'admin_capabilities',
      'examination_beta_access', 'examination_participants', 'examination_attempts_multi', 'grade_reservations',
      'subscription_history', 'refund_requests']) need((await rows(table, record.id)).length === 0, 'FIXTURE_UNEXPECTED_OWNED_DATA');
    for (const table of ['payment_request_history', 'refund_request_history', 'subscription_history'])
      need((await rows(table, record.id, 'actor_user_id')).length === 0, 'FIXTURE_UNEXPECTED_FINANCIAL_HISTORY');
    // The reviewed callback is GET-only. Any competition writes or membership
    // make Auth-only cleanup unsafe and require exact-event reconciliation.
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
    record.cleanupState = 'auth_deleted_verified'; sessions.delete(record.id); await save();
  }
  return Object.freeze({ snapshot,
    async provision() {
      need(manifest.fixtures.length === 0, 'FIXTURE_ALREADY_STARTED'); await save();
      const suppression = await verifySuppression();
      need(suppression?.projectRef === FIXTURE_TARGET.projectRef && suppression?.outboundEmailMode === 'suppressed',
        'FIXTURE_SUPPRESSION_REQUIRED');
      manifest.suppression = { projectRef: FIXTURE_TARGET.projectRef, outboundEmailMode: 'suppressed',
        checkedAt: new Date(clock()).toISOString() }; await save();
      const allowed = await create('allowed'), excluded = await create('excluded');
      need(allowed.id !== excluded.id && allowed.token !== excluded.token, 'FIXTURE_SESSION_COLLISION');
      return Object.freeze({ allowed, excluded });
    },
    async cleanup() {
      const failures = [];
      for (const record of [...manifest.fixtures].reverse()) {
        if (record.cleanupState === 'auth_deleted_verified') continue;
        try { await cleanupOne(record); }
        catch (error) { record.cleanupState = 'held'; record.failureCode = error?.code || 'FIXTURE_CLEANUP_UNCONFIRMED';
          failures.push({ purpose: record.purpose, code: record.failureCode }); await save().catch(() => {}); }
      }
      manifest.cleanupComplete = failures.length === 0;
      await save(); return { complete: manifest.cleanupComplete, failures };
    },
  });
}
