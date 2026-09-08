// Supported-API cleanup for ONE freshly verified current-v4 staging proof.
// Never claims a queue, retries a mutation, deletes SQL Storage metadata, or
// grants access. Root still independently reads DB/session/Pulse/audit residue.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PAYMENT_FIXTURE_TARGET, paymentFixtureIdentity } from './staging-payment-fixtures.mjs';
import { exactCommercialRowFilter } from './staging-commercial-fixtures.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const equal=(a,b)=>assert.deepEqual(a,b);
const canonical=value=>JSON.stringify(value,(_,v)=>v && !Array.isArray(v) && typeof v==='object'
  ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
const sorted=rows=>rows.slice().sort((a,b)=>canonical(a).localeCompare(canonical(b)));
const held=()=>Object.assign(new Error('CURRENT_PAYMENT_PROOF_CLEANUP_HELD: preserve manifest and proof; no automatic retry'),
  {code:'CURRENT_PAYMENT_PROOF_CLEANUP_HELD'});

export function assertCurrentProofPayment(row,m,queue='pending') {
  assert.ok(row);equal(row.id,m.paymentId);equal(row.user_id,m.ownerId);
  equal(row.version,1);equal(row.status,'pending');equal(row.payment_evidence_mode,'proof_only');
  for(const key of ['payment_date','transaction_reference','reference_normalized','paid_at','paid_at_verified_by',
    'paid_at_verified_at','paid_at_verification_source','reviewed_at','reviewed_by','review_reason','subscription_id',
    'provisional_access_revoked_at'])equal(row[key],null);
  for(const [key,value] of Object.entries(row))if(key.startsWith('approved_'))equal(value,null);
  for(const [key,value] of Object.entries({pricing_revision_id:m.offer.revisionId,
    pricing_plan_version_id:m.offer.planVersionId,pricing_payment_channel_version_id:m.offer.paymentChannelVersionId,
    plan_code:m.offer.planCode,payment_method:m.offer.paymentMethod,trusted_amount_centavos:14900,trusted_currency:'PHP',
    proof_bucket:'payment-proofs',proof_object_path:m.proof.proofObjectPath,proof_sha256:m.proof.proofSha256,
    proof_size_bytes:m.proof.proofSizeBytes,proof_mime_type:'image/png'}))equal(row[key],value);
  equal(Date.parse(row.provisional_access_expires_at)-Date.parse(row.provisional_access_started_at),86400000);
  equal(row.verification_email_status,queue);equal(row.verification_email_attempts,0);
  equal(row.subscriber_receipt_status,'pending');equal(row.subscriber_receipt_attempts,0);
  for(const key of ['verification_email_provider_id','verification_email_last_attempt_at','verification_email_sent_at',
    'verification_email_error','subscriber_receipt_provider_id','subscriber_receipt_last_attempt_at',
    'subscriber_receipt_sent_at','subscriber_receipt_error'])equal(row[key],null);
  // Reject unsupported columns before any mutation, preserving full-row CAS.
  exactCommercialRowFilter(row);
}

function validate(m,proofBytes) {
  equal(m.schemaVersion,1);equal(m.purpose,'current-v4-proof-only-stage-intake');
  equal(m.projectRef,PAYMENT_FIXTURE_TARGET.projectRef);equal(m.state,'intake-verified');
  equal(m.submissionState,'confirmed');equal(m.replayState,'confirmed');
  equal(m.globalSignOutState,'confirmed');equal(m.globalSignOutOwnerId,m.ownerId);
  assert.match(m.source?.sourceSha,/^[a-f0-9]{40}$/u);
  assert.ok(Number.isFinite(Date.parse(m.createdAt)));
  const identity=paymentFixtureIdentity(m.runId,'student');
  for(const id of [m.ownerId,m.paymentId,m.history?.id,m.notification?.id])assert.match(id,UUID);
  equal(new Set([m.ownerId,m.paymentId,m.history.id,m.notification.id]).size,4);
  const lifecycle=m.fixtureLifecycle;
  equal(lifecycle?.purpose,'complete-beta-staging-verification');equal(lifecycle.projectRef,m.projectRef);
  equal(lifecycle.sourceSha,m.source.sourceSha);equal(lifecycle.runId,m.runId);equal(lifecycle.fixtures.length,1);
  const record=lifecycle.fixtures[0];equal(record.id,m.ownerId);equal(record.label,'student');
  equal(record.creationState,'recorded');equal(record.registrationState,'confirmed');equal(record.signInState,'confirmed');
  equal(record.signOutState,'confirmed');equal(record.signOutTransport,'current-v4-runner-global');
  equal(record.classificationSource,`astra_complete_beta_staging_v1:${m.runId}:student`);equal(record.cleanupState,'pending');
  for(const id of [m.offer?.revisionId,m.offer?.planVersionId,m.offer?.paymentChannelVersionId])assert.match(id,UUID);
  equal(m.offer.planCode,'early_access_beta');equal(m.offer.priceCentavos,14900);equal(m.offer.currency,'PHP');
  assert.match(m.offer.paymentMethod,/^[a-z][a-z0-9_]{2,63}$/u);
  assert.ok(proofBytes instanceof Uint8Array && proofBytes.length>0 && proofBytes.length<=2*1024*1024);
  assert.match(m.proof?.proofSha256,HASH);equal(m.proof.proofSizeBytes,proofBytes.length);equal(m.proof.proofSha256,sha(proofBytes));
  const h=sha(['pricing-v3',m.ownerId,m.offer.planVersionId,m.offer.paymentChannelVersionId,m.proof.proofSha256].join('|'));
  equal(m.proof.proofObjectPath,`${m.ownerId}/${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}.png`);
  assertCurrentProofPayment(m.payment,m);
  equal(m.history.payment_request_id,m.paymentId);equal(m.history.actor_user_id,m.ownerId);
  equal(m.history.action,'submitted');equal(m.history.previous_status,null);equal(m.history.new_status,'pending');
  assert.ok(!m.history.metadata?.offerReview);
  const n=m.notification;equal(n.notification_type,'payment_submitted');equal(n.related_resource_type,'payment_request');
  equal(n.related_resource_id,m.paymentId);equal(n.recipient_mailbox,'premium@duediligence.ph');
  equal(n.subject,'Due Diligence plan payment verification request');equal(n.secure_admin_path,`/admin/payments?request=${m.paymentId}`);
  equal(n.status,'queued');equal(n.attempts,0);
  for(const k of ['last_attempt_at','sent_at','failure_code'])equal(n[k],null);
  exactCommercialRowFilter(n);
  return identity;
}

export async function cleanupCurrentPaymentProof({manifest:m,persist,request=fetch,serviceRoleKey,
  supabaseUrl,workerUrl,verifySuppression,proofBytes,now=Date.now}) {
  if(!m || m.cleanup!==undefined)throw held(); // Never replay an uncertain/completed cleanup.
  let identity;
  try {
    equal(supabaseUrl,PAYMENT_FIXTURE_TARGET.supabaseUrl);equal(workerUrl,PAYMENT_FIXTURE_TARGET.workerUrl);
    assert.match(serviceRoleKey,/^sb_secret_[A-Za-z0-9_-]{20,}$/u);
    equal(typeof persist,'function');equal(typeof request,'function');equal(typeof verifySuppression,'function');
    identity=validate(m,proofBytes);
  }catch{throw held();}
  const c=m.cleanup={state:'preflight',cleanupComplete:false,independentDatabaseReadbackRequired:true,
    scope:'supported-api-single-current-proof-fixture',authSessions:'global-logout-response-only-not-direct-DB-proof',
    classification:'trusted-pre-signin-registrar-receipt-not-direct-private-registry-read',
    pulseAudit:'retained-not-directly-exposed-independent-scope-and-delivery-readback-required',
    mutationAtomicity:'payment-CAS-only; supported-API-sequence-is-not-a-multitable-transaction'};
  const save=()=>persist(clone(m));
  const checkpoint=async state=>{c.state=state;await save();};
  async function http(route,options={},statuses=[200],binary=false) {
    assert.ok(route.startsWith('/auth/v1/')||route.startsWith('/rest/v1/')||route.startsWith('/storage/v1/'));
    const response=await request(supabaseUrl+route,{...options,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,
        ...(options.body==null?{}:{'Content-Type':'application/json'}),...options.headers}});
    assert.ok(statuses.includes(response.status));
    const max=binary?m.proof.proofSizeBytes:2*1024*1024;
    const declared=response.headers.get('content-length');
    if(declared!==null)assert.ok(/^\d+$/u.test(declared)&&Number(declared)<=max);
    const reader=response.body?.getReader(),chunks=[];let size=0;
    if(reader)try {for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;assert.ok(size<=max);chunks.push(Buffer.from(next.value));}}
    finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks);
    return {status:response.status,body:binary?bytes:(bytes.length?JSON.parse(bytes.toString('utf8')):null),range:response.headers.get('content-range')};
  }
  async function rows(table,filter) {
    const q=new URLSearchParams({...filter,select:'*',limit:'101'});
    const r=await http(`/rest/v1/${table}?${q}`,{headers:{Prefer:'count=exact'}});
    assert.ok(Array.isArray(r.body)&&r.body.length<=100);
    const total=/^(?:\d+-\d+|\*)\/(\d+)$/u.exec(r.range||'');assert.ok(total&&Number(total[1])===r.body.length);
    return sorted(r.body);
  }
  async function deployment() {
    const v=await verifySuppression();
    for(const key of ['deploymentId','versionId','workflowRunId','sourceSha','commercialEntryLfSha256'])equal(v[key],m.deployment?.[key]);
    equal(v.sourceSha,m.source.sourceSha);equal(v.paymentNotificationMode,'suppressed');equal(v.allRelevantMailModes,'suppressed');
    assert.match(v.deploymentId,UUID);assert.match(v.versionId,UUID);assert.match(v.commercialEntryLfSha256,HASH);
    const age=now()-Date.parse(v.observedAt);assert.ok(Number.isFinite(age)&&age>=-60000&&age<=60000);
    c.suppression=clone(v);await save();
  }
  async function graph() {
    const u=(await http(`/auth/v1/admin/users/${m.ownerId}`)).body;
    equal(u?.id,m.ownerId);equal(u.email,identity.email);equal(u.role,'authenticated');equal(u.aud,'authenticated');
    equal(u.app_metadata,{provider:'email',providers:['email'],...identity.appMetadata});equal(u.user_metadata?.display_name,identity.displayName);
    for(const k of ['is_super_admin','is_anonymous','is_sso_user'])assert.ok(u[k]===false||u[k]===undefined);
    assert.ok(!u.deleted_at && Number.isFinite(Date.parse(u.email_confirmed_at)) && Number.isFinite(Date.parse(u.last_sign_in_at)));
    const created=Date.parse(u.created_at);assert.ok(Number.isFinite(created)&&created>=Date.parse(m.createdAt)-60000&&created<=now()+60000);
    const own={user_id:`eq.${m.ownerId}`},captured={};
    for(const table of ['user_roles','profiles','forum_profile_settings','terms_acceptances','introductory_token_grants',
      'introductory_token_ledger','commercial_access_choices','user_sign_in_events']) {
      const key=table==='profiles'?'id':'user_id';captured[table]=await rows(table,{[key]:`eq.${m.ownerId}`});
      assert.ok(captured[table].every(r=>r[key]===m.ownerId));
    }
    equal(captured.user_roles.length,1);equal(captured.user_roles[0].role,'student');equal(captured.user_roles[0].assigned_by,null);
    equal(captured.profiles.length,1);equal(captured.profiles[0].commercial_category,'review');
    equal(captured.profiles[0].law_school_id,'other');equal(captured.profiles[0].law_school_other,'Synthetic Staging Law School');
    equal(captured.forum_profile_settings.length,1);
    equal(captured.forum_profile_settings[0].verified_academic_at,null);equal(captured.forum_profile_settings[0].verified_academic_by,null);
    equal(captured.terms_acceptances.length,1);equal(captured.introductory_token_grants.length,1);
    const grant=captured.introductory_token_grants[0];assert.match(grant.id,UUID);equal(grant.token_limit,5);
    equal(captured.introductory_token_ledger.length,1);const ledger=captured.introductory_token_ledger[0];
    equal(ledger.grant_id,grant.id);equal(ledger.event_type,'grant');equal(ledger.token_delta,5);equal(ledger.balance_after,5);equal(ledger.reservation_id,null);
    equal(await rows('introductory_token_ledger',{grant_id:`eq.${grant.id}`}),captured.introductory_token_ledger);
    assert.ok(captured.commercial_access_choices.length<=1);assert.ok(captured.user_sign_in_events.length<=10);
    // Existing known owner and secondary-actor relationships, never broad deletes.
    for(const table of ['admin_capabilities','subscriptions','subscription_history','refund_requests','free_beta_access','free_beta_access_history',
      'examination_beta_access','examination_participants','examination_attempts_multi','grade_reservations','usage_events',
      'usage_sessions','forum_telemetry_events','dd2026_bar_forecast_consents','professor_license_declarations','marketing_consents'])equal(await rows(table,own),[]);
    for(const table of ['dd2026_forecast_attempts','dd2026_forecast_result_exports','dd2026_forecast_analytics_exports','dd2026_forecast_analytics_requests'])equal(await rows(table,{owner_id:`eq.${m.ownerId}`}),[]);
    for(const [table,column] of [['user_roles','assigned_by'],['forum_profile_settings','verified_academic_by'],
      ['subscriptions','created_by'],['subscriptions','updated_by'],['free_beta_access','created_by'],['free_beta_access','updated_by'],
      ['free_beta_access_history','actor_user_id'],['subscription_history','actor_user_id'],['refund_request_history','actor_user_id'],
      ['refund_requests','reviewed_by'],['examination_definitions','created_by']])equal(await rows(table,{[column]:`eq.${m.ownerId}`}),[]);
    equal(await rows('payment_requests',{or:`(reviewed_by.eq.${m.ownerId},paid_at_verified_by.eq.${m.ownerId})`}),[]);
    equal(await rows('refund_requests',{payment_request_id:`eq.${m.paymentId}`}),[]);
    equal(await rows('payment_request_history',{actor_user_id:`eq.${m.ownerId}`}),[m.history]);
    equal(await rows('admin_audit_log',{or:`(actor_user_id.eq.${m.ownerId},target_user_id.eq.${m.ownerId},target_resource_id.eq.${m.ownerId})`}),[]);
    equal(await rows('founding_beta_invites',{or:`(claimed_user_id.eq.${m.ownerId},email_hash.eq.${sha(identity.email)})`}),[]);
    // Any examination audit is unexpected in this non-examination journey; hold
    // instead of allowing an Auth cascade to null an unreviewed audit actor.
    equal(await rows('examination_audit_log',{actor_user_id:`eq.${m.ownerId}`}),[]);
    captured.examinationAuditIds=[];captured.adminAuditIds=[];
    return captured;
  }
  async function paymentGraph(payment,noticePresent=true) {
    equal(await rows('payment_requests',{user_id:`eq.${m.ownerId}`}),[payment]);
    equal(await rows('payment_request_history',{payment_request_id:`eq.${m.paymentId}`}),[m.history]);
    equal(await rows('outbound_notifications',{related_resource_id:`eq.${m.paymentId}`}),noticePresent?[m.notification]:[]);
  }
  const objectRoute=`/storage/v1/object/payment-proofs/${m.proof.proofObjectPath}`;
  async function listProof() {
    const r=await http('/storage/v1/object/list/payment-proofs',{method:'POST',body:JSON.stringify({
      prefix:m.ownerId+'/',limit:3,offset:0,sortBy:{column:'name',order:'asc'}})});
    assert.ok(Array.isArray(r.body));return r.body;
  }
  async function readProof() {
    const objects=await listProof();equal(objects.length,1);equal(objects[0].name,m.proof.proofObjectPath.split('/')[1]);
    assert.match(objects[0].id,UUID);assert.ok(objects[0].metadata && typeof objects[0].metadata==='object');
    const stored=(await http(objectRoute,{},[200],true)).body;
    equal(stored.length,proofBytes.length);equal(sha(stored),m.proof.proofSha256);equal(stored,Buffer.from(proofBytes));
    // Retain the first full private observation. Our own GET can update only the
    // access timestamp; all other metadata/identity drift still fails equality.
    if(c.storageOriginalObject===undefined)c.storageOriginalObject=clone(objects[0]);
    const object=clone(objects[0]);delete object.last_accessed_at;
    return {object,bucket:'payment-proofs',path:m.proof.proofObjectPath,bytes:stored.length,sha256:sha(stored),
      excludedHousekeeping:['last_accessed_at']};
  }
  try {
    await save();await deployment();
    c.defaultsBefore=await graph();await paymentGraph(m.payment);
    c.paymentBefore=clone(m.payment);c.historyBefore=clone(m.history);c.notificationBefore=clone(m.notification);
    c.storageBefore=await readProof();await checkpoint('snapshots-captured');
    const filter=exactCommercialRowFilter(m.payment);filter.set('select','*');
    await checkpoint('payment-fence-requested');
    const fenced=(await http(`/rest/v1/payment_requests?${filter}`,{method:'PATCH',headers:{Prefer:'return=representation'},
      body:JSON.stringify({verification_email_status:'suppressed'})})).body;
    assert.ok(Array.isArray(fenced)&&fenced.length===1);const after=fenced[0];assertCurrentProofPayment(after,m,'suppressed');
    const normalized=clone(after);normalized.verification_email_status=m.payment.verification_email_status;
    if('updated_at' in m.payment){assert.ok(Number.isFinite(Date.parse(after.updated_at)));normalized.updated_at=m.payment.updated_at;}
    equal(normalized,m.payment);c.paymentAfter=clone(after);await checkpoint('payment-fence-confirmed');
    await paymentGraph(after);equal(await graph(),c.defaultsBefore);equal(await readProof(),c.storageBefore);await deployment();
    await checkpoint('notice-delete-requested');
    const noticeFilter=exactCommercialRowFilter(m.notification);noticeFilter.set('select','*');
    equal((await http(`/rest/v1/outbound_notifications?${noticeFilter}`,{method:'DELETE',headers:{Prefer:'return=representation'}})).body,[m.notification]);
    await paymentGraph(after,false);await checkpoint('notice-delete-confirmed');
    equal(await readProof(),c.storageBefore);await checkpoint('storage-delete-requested');
    await http(objectRoute,{method:'DELETE'},[200,204]);
    equal(await listProof(),[]);await checkpoint('storage-delete-confirmed');
    await paymentGraph(after,false);equal(await graph(),c.defaultsBefore);await deployment();
    c.auditCaptureState='confirmed-empty-before-auth-delete';await checkpoint('auth-delete-requested');
    await http(`/auth/v1/admin/users/${m.ownerId}`,{method:'DELETE'},[200,204]);
    equal((await http(`/auth/v1/admin/users/${m.ownerId}`,{},[200,404])).status,404);
    await checkpoint('auth-delete-confirmed');
    for(const [table,key,id] of [['payment_requests','user_id',m.ownerId],['payment_request_history','payment_request_id',m.paymentId],
      ['outbound_notifications','related_resource_id',m.paymentId],['grade_reservations','user_id',m.ownerId]])equal(await rows(table,{[key]:`eq.${id}`}),[]);
    equal(await listProof(),[]);
    c.cleanupComplete=true;c.state='completed';m.cleanupComplete=true;await save();
    return {cleanupComplete:true,independentDatabaseReadbackRequired:true};
  }catch {
    c.heldAtState=c.state;c.state='held-for-review';c.cleanupComplete=false;m.cleanupComplete=false;
    try{await save();}catch{} // A prior successfully persisted intent remains authoritative.
    throw held();
  }
}
