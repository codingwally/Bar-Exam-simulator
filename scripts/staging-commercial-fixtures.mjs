import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMERCIAL_STAGE } from './staging-commercial-suppression.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REGISTRAR = '/rest/v1/rpc/astra_register_staging_commercial_fixture';
const root = fileURLToPath(new URL('../', import.meta.url));
const clone = value => structuredClone(value);
const equal = (a, b) => assert.deepEqual(a, b);

export function commercialFixtureIdentity(runId, label) {
  assert.match(runId, /^[a-z0-9]{8,12}-[a-f0-9]{8}$/u);
  assert.ok(!/[\r\n]/u.test(runId) && ['free','retry','founding','provisional'].includes(label));
  return { email: `dd-commercial-${label}-${runId}@duediligence.ph`, displayName: `Commercial ${label}`,
    appMetadata: { astra_staging_commercial_fixture: { version: 1, runId, label } } };
}

// Every returned row must still match the scalar snapshot in this same UPDATE /
// DELETE statement. URLSearchParams encodes each complete scalar value. Top-level
// PostgREST eq consumes the literal remainder; it does not unquote it like an
// in-list or logic-tree value. Unknown JSON/array columns fail closed.
export function exactCommercialRowFilter(row) {
  assert.ok(row && !Array.isArray(row) && Object.keys(row).length > 0);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(row)) {
    assert.match(key, /^[a-z][a-z0-9_]*$/u);
    assert.ok(value === null || ['string','number','boolean'].includes(typeof value));
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    params.set(key, value === null ? 'is.null' : `eq.${String(value)}`);
  }
  return params;
}

export function assertCommercialPayment(row, expected, queueStatus = 'pending') {
  assert.ok(row); assert.match(row.id, UUID);
  for (const [column, input] of Object.entries({ user_id:'p_user_id', pricing_plan_version_id:'p_plan_version_id',
    pricing_payment_channel_version_id:'p_payment_channel_version_id', payment_date:'p_payment_date',
    transaction_reference:'p_payment_reference', proof_bucket:'p_proof_bucket', proof_object_path:'p_proof_path',
    proof_mime_type:'p_proof_mime_type', proof_size_bytes:'p_proof_size_bytes', proof_sha256:'p_proof_sha256' })) equal(row[column], expected[input]);
  equal(row.status, 'pending'); equal(row.verification_email_status, queueStatus);
  equal(row.verification_email_attempts, 0);
  for (const key of ['verification_email_last_attempt_at','verification_email_provider_id','verification_email_sent_at',
    'verification_email_error','reviewed_at','reviewed_by','review_reason','subscription_id','paid_at',
    'paid_at_verified_at','paid_at_verified_by','paid_at_verification_source']) {
    // Only columns present in this exact installed schema are inspected beyond
    // the mandatory queue/review fields. Unknown added non-scalar fields refuse
    // the exact-row CAS below; no schema fields are deleted or rewritten.
    if (key in row || key.startsWith('verification_') || ['reviewed_at','reviewed_by','subscription_id'].includes(key)) equal(row[key], null);
  }
  for (const [key,value] of Object.entries(row)) if (key.startsWith('approved_')) equal(value,null);
  if ('subscriber_receipt_status' in row) {
    equal(row.subscriber_receipt_status,'pending'); equal(row.subscriber_receipt_attempts,0);
    for(const key of ['subscriber_receipt_provider_id','subscriber_receipt_error','subscriber_receipt_last_attempt_at','subscriber_receipt_sent_at']) equal(row[key],null);
  }
}

export function createCommercialFixtureLifecycle({ runId, supabaseUrl, workerUrl, serviceRoleKey,
  publishableKey, sourceSha, verifySuppression, request = fetch, persist = null }) {
  equal(supabaseUrl, COMMERCIAL_STAGE.supabaseUrl); equal(workerUrl, COMMERCIAL_STAGE.workerUrl);
  assert.match(serviceRoleKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/u);
  assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/u);
  assert.match(sourceSha, /^[a-f0-9]{40}$/u); assert.equal(typeof verifySuppression, 'function');
  commercialFixtureIdentity(runId, 'free');
  const records = new Map(), sessions = new Map();
  let initialized = false, ready = false, cleanupComplete = false, suppression = null;
  const manifestPath = path.join(root, 'artifacts','staging-e2e',`commercial-launch-${runId}-cleanup-manifest.json`);
  const snapshot = () => clone({ schemaVersion:1, purpose:'commercial-launch-staging-verification',
    projectRef:COMMERCIAL_STAGE.projectRef, sourceSha, suite:'commercial-launch', runId, cleanupComplete,
    cleanupScope:'supported-api-exact-fixtures', independentDatabaseReadbackRequired:true,
    authSessions:'global-signout-response-not-direct-session-table-proof',
    pulseAudit:'retain-internal-test-events-and-classification', examinationAudit:'retain-exact-fixture-actor-audit',
    suppression, fixtures:[...records.values()] });
  async function save() {
    const value = snapshot(); if (persist) { await persist(value); return; }
    await mkdir(path.dirname(manifestPath), { recursive:true });
    const content = `${JSON.stringify(value,null,2)}\n`;
    if (!initialized) { await writeFile(manifestPath, content, { flag:'wx', mode:0o600 }); initialized = true; }
    else { await writeFile(`${manifestPath}.tmp`, content, { flag:'wx', mode:0o600 }); await rename(`${manifestPath}.tmp`, manifestPath); }
  }
  async function service(route, options = {}, expected = [200]) {
    assert.ok(route.startsWith('/auth/v1/') || route.startsWith('/rest/v1/'));
    const response = await request(`${supabaseUrl}${route}`, { ...options, redirect:'error',
      headers:{ apikey:serviceRoleKey, 'Content-Type':'application/json', ...options.headers },
      signal:AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => null);
    assert.ok(expected.includes(response.status), 'Fixture transport failed; preserve unknown outcome');
    return { body, status:response.status, range:response.headers.get('content-range') };
  }
  const byId = id => { assert.match(id,UUID); const r=[...records.values()].find(row=>row.id===id); assert.ok(r); return r; };
  async function rows(table, filter) {
    const query = new URLSearchParams(filter); query.set('select','*'); query.set('limit','101');
    const result = await service(`/rest/v1/${table}?${query}`,{ headers:{ Prefer:'count=exact' } });
    assert.ok(Array.isArray(result.body) && result.body.length <= 100);
    const total = /^(?:\d+-\d+|\*)\/(\d+)$/u.exec(result.range || '');
    assert.ok(total && Number(total[1]) === result.body.length, 'Incomplete owner-scoped discovery'); return result.body;
  }
  async function exactDelete(table, row) {
    const query = exactCommercialRowFilter(row); query.set('select','*');
    const result = await service(`/rest/v1/${table}?${query}`, { method:'DELETE', headers:{ Prefer:'return=representation' } });
    equal(result.body,[row]);
  }
  async function verifyIdentity(record) {
    assert.equal(record.creationState,'recorded');
    const { body } = await service(`/auth/v1/admin/users/${record.id}`);
    const identity = commercialFixtureIdentity(runId,record.label);
    equal(body?.id,record.id); equal(body?.email,identity.email);
    equal(body?.app_metadata,{ provider:'email', providers:['email'], ...identity.appMetadata });
    equal(body?.user_metadata?.display_name,identity.displayName);
    equal(body?.role,'authenticated'); equal(body?.aud,'authenticated');
    for (const key of ['is_super_admin','is_anonymous','is_sso_user']) assert.ok(body?.[key] === false || body?.[key] === undefined);
    if (record.signInState === 'not_requested') equal(body.last_sign_in_at,null);
    const roles = await rows('user_roles',{ user_id:`eq.${record.id}` });
    assert.equal(roles.length,1); equal(roles[0].role,'student');
    for (const table of ['admin_capabilities','subscriptions','refund_requests','examination_beta_access'])
      equal((await rows(table,{ user_id:`eq.${record.id}` })).length,0);
  }
  async function stopSession(record) {
    if (record.signInState === 'not_requested') return;
    assert.equal(record.signInState,'confirmed'); assert.equal(record.signOutState,'not_requested');
    const token=sessions.get(record.id); assert.ok(token);
    record.signOutState='requested'; await save();
    await service('/auth/v1/logout?scope=global',{ method:'POST', headers:{ Authorization:`Bearer ${token}` } },[200,204]);
    record.signOutState='confirmed'; sessions.delete(record.id); await save();
  }
  async function cleanup(record) {
    assert.equal(record.cleanupState,'pending'); await verifyIdentity(record); await stopSession(record);
    // An unconfirmed registration may have created internal evidence. Do not erase
    // it by deleting Auth; the coordinator reconciles exact IDs from the manifest.
    assert.equal(record.registrationState,'confirmed');
    const payments=await rows('payment_requests',{user_id:`eq.${record.id}`});
    if (record.payment) {
      assert.equal(record.payment.state,'recorded'); equal(payments.length,1);
      const before=payments[0]; equal(before.id,record.payment.id);
      assertCommercialPayment(before,record.payment.payload);
      const history=await rows('payment_request_history',{payment_request_id:`eq.${before.id}`});
      equal(history.length,1); equal(history[0].action,'submitted'); equal(history[0].actor_user_id,record.id);
      equal(history[0].previous_status,null); equal(history[0].new_status,'pending');
      record.payment.historyBefore=clone(history);
      record.payment.before=clone(before); record.payment.fenceState='requested'; await save();
      const query=exactCommercialRowFilter(before); query.set('select','*');
      // Claim and this CAS contend on the SAME payment row. If the claim wins,
      // attempts/status change and zero rows match; if CAS wins, this pending-only
      // queue is now suppressed before Auth cascading deletion. No queue RPC call.
      const fenced=await service(`/rest/v1/payment_requests?${query}`, { method:'PATCH',
        headers:{Prefer:'return=representation'},body:JSON.stringify({verification_email_status:'suppressed'}) });
      assert.equal(fenced.body?.length,1); const after=fenced.body[0];
      assertCommercialPayment(after,record.payment.payload,'suppressed');
      const stable=clone(after); stable.verification_email_status=before.verification_email_status;
      // Existing updated_at touch trigger may change this housekeeping field.
      stable.updated_at=before.updated_at; equal(stable,before);
      record.payment.after=clone(after); record.payment.fenceState='confirmed'; await save();
      const notices=await rows('outbound_notifications',{related_resource_id:`eq.${before.id}`});
      assert.equal(notices.length,1); const notice=notices[0]; assert.match(notice.id,UUID);
      equal(notice.notification_type,'payment_submitted'); equal(notice.related_resource_type,'payment_request');
      equal(notice.recipient_mailbox,'premium@duediligence.ph');
      equal(notice.subject,'Due Diligence plan payment verification request');
      equal(notice.related_resource_id,before.id); equal(notice.status,'queued'); equal(notice.attempts,0);
      for (const key of ['last_attempt_at','sent_at','failure_code']) equal(notice[key],null);
      equal(notice.secure_admin_path,`/admin/payments?request=${before.id}`);
      record.payment.notificationBefore=clone(notice); record.payment.notificationCleanup='requested'; await save();
      await exactDelete('outbound_notifications',notice);
      record.payment.notificationCleanup='confirmed'; await save();
      equal(await rows('payment_requests',{user_id:`eq.${record.id}`}),[after]);
      equal(await rows('payment_request_history',{payment_request_id:`eq.${before.id}`}),history);
    } else equal(payments.length,0);
    const inviteHash=createHash('sha256').update(commercialFixtureIdentity(runId,record.label).email).digest('hex');
    const invites=await rows('founding_beta_invites',{email_hash:`eq.${inviteHash}`});
    if (record.invite) {
      equal(record.invite.state,'recorded'); equal(invites.length,1); const invite=invites[0];
      equal(invite.email_hash,record.invite.hash);
      equal(Date.parse(invite.access_ends_at),Date.parse(record.invite.expiresAt));
      assert.ok(invite.status==='pending' || invite.status==='claimed');
      equal(invite.claimed_user_id,invite.status==='claimed'?record.id:null);
      if(invite.status==='pending') equal(invite.claimed_at,null);
      record.invite.before=clone(invite); record.invite.cleanupState='requested'; await save();
      await exactDelete('founding_beta_invites',invite); record.invite.cleanupState='confirmed'; await save();
    } else equal(invites.length,0);
    const audit=await rows('examination_audit_log',{actor_user_id:`eq.${record.id}`});
    record.auditRowIds=audit.map(row=>{
      assert.ok((typeof row.id==='number' && Number.isSafeInteger(row.id) && row.id>0)
        || (typeof row.id==='string' && /^[1-9][0-9]{0,18}$/u.test(row.id))); return String(row.id);
    });
    equal(new Set(record.auditRowIds).size,record.auditRowIds.length);
    record.auditCaptureState='captured-before-auth-delete';
    record.cleanupState='delete_requested'; await save();
    await service(`/auth/v1/admin/users/${record.id}`,{method:'DELETE'},[200,204]);
    const absence=await service(`/auth/v1/admin/users/${record.id}`,{},[200,404]); equal(absence.status,404);
    for (const table of ['grade_reservations','payment_requests']) equal((await rows(table,{user_id:`eq.${record.id}`})).length,0);
    equal((await rows('founding_beta_invites',{email_hash:`eq.${inviteHash}`})).length,0);
    if(record.payment) equal((await rows('outbound_notifications',{related_resource_id:`eq.${record.payment.id}`})).length,0);
    record.cleanupState='deleted'; await save();
  }
  const api = {
    manifestPath, snapshot,
    async preflight() {
      assert.equal(ready,false); await save(); suppression=await verifySuppression(); await save();
      const result=await service(REGISTRAR,{method:'POST',body:JSON.stringify({p_user_id:null,p_run_id:null,p_label:null})},[400]);
      equal(result.body?.code,'P0001'); equal(result.body?.message,'Staging commercial fixture identity is invalid'); ready=true;
    },
    async createUser(label) {
      equal(ready,true); equal(records.has(label),false); const identity=commercialFixtureIdentity(runId,label);
      const record={label,id:null,classificationSource:`astra_commercial_staging_v1:${runId}:${label}`,
        creationState:'requested',registrationState:'not_requested',signInState:'not_requested',signOutState:'not_requested',
        cleanupState:'pending',auditCaptureState:'not_requested',auditRowIds:[]};
      records.set(label,record); await save();
      const password=`Dd!${randomBytes(24).toString('base64url')}9z`;
      const created=await service('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email:identity.email,password,
        email_confirm:true,app_metadata:identity.appMetadata,user_metadata:{display_name:identity.displayName}})},[200,201]);
      assert.match(created.body?.id,UUID);
      assert.ok(![...records.values()].some(row=>row.id===created.body.id));
      record.id=created.body.id; record.creationState='response_received'; await save();
      equal(created.body?.email,identity.email);
      record.creationState='recorded'; await save();
      record.registrationState='requested'; await save();
      const registration=await service(REGISTRAR,{method:'POST',body:JSON.stringify({p_user_id:record.id,p_run_id:runId,p_label:label})});
      equal(registration.body,{registered:true,fixtureUserId:record.id,dataScope:'internal_test',registrationVersion:'astra-staging-commercial-v1',replayed:false});
      record.registrationState='confirmed'; await save();
      record.signInState='requested'; await save();
      const signed=await service('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publishableKey},body:JSON.stringify({email:identity.email,password})});
      equal(signed.body?.user?.id,record.id); assert.ok(typeof signed.body?.access_token==='string' && signed.body.access_token);
      sessions.set(record.id,signed.body.access_token); record.signInState='confirmed'; await save();
      return {id:record.id,email:identity.email,token:signed.body.access_token};
    },
    async beforePayment(payload) {
      const record=byId(payload.p_user_id); equal(record.label,'provisional'); equal(record.payment,undefined);
      equal(payload.p_payment_reference,`SYNTH-${runId}`); equal(payload.p_proof_bucket,'payment-proofs');
      equal(payload.p_proof_sha256,createHash('sha256').update(`payment-${runId}`).digest('hex'));
      assert.match(payload.p_proof_path,new RegExp(`^${record.id}/[a-f0-9-]{36}\\.png$`));
      suppression=await verifySuppression(); record.payment={state:'requested',payload:clone(payload)}; await save();
    },
    async recordPayment(id,paymentId) {
      const record=byId(id); equal(record.payment?.state,'requested'); assert.match(paymentId,UUID);
      record.payment.id=paymentId; record.payment.state='recorded'; await save();
    },
    async beforeInvite(id,hash,expiresAt) {
      const record=byId(id); equal(record.label,'founding'); equal(record.invite,undefined); assert.match(hash,HASH);
      equal(hash,createHash('sha256').update(commercialFixtureIdentity(runId,record.label).email).digest('hex'));
      assert.ok(Number.isFinite(Date.parse(expiresAt))); equal((await rows('founding_beta_invites',{email_hash:`eq.${hash}`})).length,0);
      record.invite={state:'requested',hash,expiresAt}; await save();
    },
    async recordInvite(id) { const r=byId(id); equal(r.invite?.state,'requested'); r.invite.state='recorded'; await save(); },
    async cleanup() {
      const failures=[];
      for(const record of [...records.values()].reverse()) {
        try { await cleanup(record); } catch {
          record.cleanupStepBeforeHold=record.cleanupState; record.cleanupState='held-for-review';
          failures.push(record.label); await save();
        }
      }
      cleanupComplete=failures.length===0 && [...records.values()].every(r=>r.creationState==='recorded' && r.cleanupState==='deleted');
      await save(); assert.equal(cleanupComplete,true,'Commercial fixture cleanup is incomplete; inspect private manifest');
    },
  };
  // Do not leak a drifted identity, raw provider/SQL error, password, or token in
  // assertion diagnostics. Exact synthetic evidence lives only in the manifest.
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([name,value])=>[name,
    typeof value==='function' && name!=='snapshot' ? async(...args)=>{
      try { return await value(...args); } catch { throw new Error(`Commercial fixture ${name} failed closed; inspect private manifest; no automatic retry`); }
    } : value])));
}
