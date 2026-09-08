// Protected staging-only current-v4 intake. Import is inert; the separate CLI is
// wired by the release coordinator. No grade, approval, mail API or SQL executor.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createPaymentFixtureLifecycle } from './staging-payment-fixtures.mjs';
import { createCommercialSuppressionVerifier, COMMERCIAL_STAGE } from './staging-commercial-suppression.mjs';
import { completeMandatoryCommercialProfile } from './staging-commercial-user.mjs';

export const REPOSITORY=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
export const STAGE=COMMERCIAL_STAGE;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const sha=v=>createHash('sha256').update(v).digest('hex');
const clone=v=>structuredClone(v);
const cfBase=`https://api.cloudflare.com/client/v4/accounts/${STAGE.accountId}/workers/scripts/${STAGE.workerName}`;
const sourcePaths=['scripts/staging-payment-fixtures.mjs','scripts/staging-commercial-suppression.mjs',
 'scripts/staging-commercial-fixtures.mjs','scripts/staging-commercial-user.mjs','scripts/staging-current-payment-proof.mjs',
 'scripts/staging-current-payment-proof-cleanup.mjs','scripts/test-current-payment-proof-staging.mjs',
 'worker/index.mjs','worker/commercial-entry.mjs','worker/wrangler.staging.toml'];
const mailModes=['OUTBOUND_EMAIL_MODE','SUBSCRIPTION_RECEIPT_EMAIL_MODE','SIGN_IN_NOTIFICATION_EMAIL_MODE',
 'ADMIN_DIRECTORY_EMAIL_MODE','SUPPORT_NOTIFICATION_EMAIL_MODE','FORECAST_RESULTS_EMAIL_MODE','EXAMINATION_ROOM_EMAIL_MODE'];
function must(value,message){assert.ok(value,message);}
function git(...args){return execFileSync('git',['-C',REPOSITORY,...args],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});}
// Only locally branded checkout failures can enter this closed diagnostic.
// Original exceptions may contain paths/stdout/stderr and are never retained.
const checkoutFailures=new WeakMap();
function checkoutFailure(code){const error=new Error('Current proof checkout preflight failed');checkoutFailures.set(error,code);return error;}
export function checkoutPreflightDiagnostic(error){
 const code=error&&checkoutFailures.get(error);if(!code)return null;
 return {schemaVersion:1,kind:'current-v4-checkout-preflight',phase:'checkout',status:'FAIL',code,fixtureCreationRequested:false};
}
export async function retainCheckoutPreflightDiagnostic(error,{makeDirectory=fs.mkdir,writeFile=fs.writeFile}={}){
 const diagnostic=checkoutPreflightDiagnostic(error);if(!diagnostic)return false;
 const directory=path.join(REPOSITORY,'artifacts','staging-e2e');
 await makeDirectory(directory,{recursive:true});
 await writeFile(path.join(directory,'current-v4-checkout-preflight.json'),JSON.stringify(diagnostic,null,2)+'\n',{flag:'wx',mode:0o600});
 return true;
}
export function assertCheckoutContract(expectedSha,head,trackedStatus) {
 if(typeof expectedSha!=='string'||!/^[a-f0-9]{40}$/.test(expectedSha))throw checkoutFailure('EXPECTED_SOURCE_SHA_INVALID');
 if(typeof head!=='string'||head.trim()!==expectedSha)throw checkoutFailure('CHECKOUT_SHA_MISMATCH');
 if(typeof trackedStatus!=='string'||trackedStatus.trim()!=='')throw checkoutFailure('CHECKOUT_TRACKED_DIRTY');
}
export async function verifySource(expectedSha,{runGit=git,readFile=fs.readFile}={}) {
 try{
 assertCheckoutContract(expectedSha,runGit('rev-parse','HEAD'),runGit('status','--porcelain','--untracked-files=no'));
 const pins={};
 for(const name of sourcePaths){
  // An untracked/missing helper is not a valid protected workflow input.
  try{runGit('ls-files','--error-unmatch',name);}catch{throw checkoutFailure('CHECKOUT_DEPENDENCY_UNAVAILABLE');}
  const expected=runGit('show',`${expectedSha}:${name}`).replaceAll('\r\n','\n');
  const actual=(await readFile(path.join(REPOSITORY,name),'utf8')).replaceAll('\r\n','\n');
  if(actual!==expected)throw checkoutFailure('CHECKOUT_DEPENDENCY_MISMATCH');pins[name]=sha(expected);
 }
 return {sourceSha:expectedSha,tree:runGit('rev-parse',`${expectedSha}^{tree}`).trim(),pins};
 }catch(error){if(checkoutFailures.has(error))throw error;throw checkoutFailure('CHECKOUT_READ_FAILED');}
}
export function assertMailBindings(version,evidence) {
 assert.equal(version?.id,evidence.versionId);must(Array.isArray(version.resources?.bindings));
 for(const name of mailModes){
  const found=version.resources.bindings.filter(b=>b.name===name);
  assert.equal(found.length,1,'Missing/ambiguous mail suppression binding');
  assert.equal(found[0].type,'plain_text');assert.equal(found[0].text,'suppressed');
 }
 const url=version.resources.bindings.filter(b=>b.name==='SUPABASE_URL');
 assert.equal(url.length,1);assert.equal(url[0].type,'plain_text');assert.equal(url[0].text,STAGE.supabaseUrl);
 // PAYMENT_NOTIFICATION absence is accepted ONLY by the separately pinned adapter.
}
export function selectOffer(response) {
 const pricing=response?.pricing || response;
 must(pricing && Array.isArray(pricing.plans) && Array.isArray(pricing.paymentMethods));
 assert.match(pricing.revisionId,UUID);
 must(Number.isFinite(Date.parse(pricing.serverNow)));
 const matches=[];
 for(const p of pricing.plans){
  if(p.checkoutOpen!==true || p.priceCentavos!==14900 || p.currency!=='PHP' || p.planCode!=='early_access_beta')continue;
  if(p.durationDays!==30 || p.entitlementMode!=='rolling_days')continue;
  assert.match(p.versionId,UUID);
  for(const c of pricing.paymentMethods){
   if(c.enabled!==true || c.visible!==true || c.checkoutOpen===false)continue;
   if(c.planCode && c.planCode!==p.planCode)continue;
   if(c.qrAmountMode!=='generic' && c.qrAmountCentavos!==p.priceCentavos)continue;
   if(c.planVersionId && c.planVersionId!==p.versionId)continue;
   if(c.amountCentavos!=null && c.amountCentavos!==p.priceCentavos)continue;
   // Same normalized channel contract as actual pricing-core; only actual
   // returned enabled/visible methods are considered, never fabricated aliases.
   if(!/^[a-z][a-z0-9_]{2,63}$/.test(c.channelCode))continue;
   if(!['exact','generic'].includes(c.qrAmountMode) || !c.qrUrl)continue;
   assert.match(c.versionId,UUID);matches.push({p,c});
  }
 }
 must(matches.length>0,'No current compatible149 offer; do not invent or reprice');
 matches.sort((a,b)=>Number(b.c.channelCode==='bpi_instapay')-Number(a.c.channelCode==='bpi_instapay')
  || a.c.versionId.localeCompare(b.c.versionId));
 const {p,c}=matches[0];
 return {revisionId:pricing.revisionId,planVersionId:p.versionId,paymentChannelVersionId:c.versionId,
  planCode:p.planCode,priceCentavos:p.priceCentavos,currency:p.currency,
  paymentMethod:c.channelCode,publicDurationDays:p.durationDays,publicEntitlementMode:p.entitlementMode,
  selectedAt:pricing.serverNow};
}
export function objectIdentity(owner,offer,proof) {
 assert.match(owner,UUID);assert.match(offer.planVersionId,UUID);assert.match(offer.paymentChannelVersionId,UUID);
 const proofSha256=sha(proof);
 const h=sha(['pricing-v3',owner,offer.planVersionId,offer.paymentChannelVersionId,proofSha256].join('|'));
 return {proofSha256,proofSizeBytes:proof.length,proofObjectPath:`${owner}/${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}.png`};
}
const nullFields=['payment_date','transaction_reference','reference_normalized','paid_at','paid_at_verified_by',
 'paid_at_verified_at','paid_at_verification_source','reviewed_at','reviewed_by','review_reason','subscription_id',
 'approved_activation_at','approved_entitlement_starts_at','approved_entitlement_ends_at','provisional_access_revoked_at'];
export function assertPayment(row,m) {
 assert.match(row?.id,UUID);assert.equal(row.user_id,m.ownerId);assert.equal(row.status,'pending');
 assert.equal(row.payment_evidence_mode,'proof_only');
 for(const k of nullFields)assert.equal(row[k],null,`Unexpected non-null ${k}`);
 for(const [k,v] of Object.entries({pricing_revision_id:m.offer.revisionId,pricing_plan_version_id:m.offer.planVersionId,
  pricing_payment_channel_version_id:m.offer.paymentChannelVersionId,proof_sha256:m.proof.proofSha256,
  proof_object_path:m.proof.proofObjectPath,proof_size_bytes:m.proof.proofSizeBytes,proof_bucket:'payment-proofs',
  proof_mime_type:'image/png',trusted_amount_centavos:14900,trusted_currency:'PHP',payment_method:m.offer.paymentMethod,
  plan_code:m.offer.planCode}))assert.equal(row[k],v);
 assert.equal(Date.parse(row.provisional_access_expires_at)-Date.parse(row.provisional_access_started_at),86400000);
 assert.equal(row.subscriber_receipt_status,'pending');assert.equal(row.subscriber_receipt_attempts,0);
 for(const k of ['subscriber_receipt_provider_id','subscriber_receipt_error','subscriber_receipt_last_attempt_at',
  'subscriber_receipt_sent_at','verification_email_provider_id','verification_email_sent_at','verification_email_error',
  'verification_email_last_attempt_at'])assert.equal(row[k],null);
 // The reviewed suppression guard runs BEFORE claim or proof fetch. A row that
 // was ever attempted is not eligible for this exact fresh-fixture cleanup.
 assert.equal(row.verification_email_status,'pending');assert.equal(row.verification_email_attempts,0);
}
function assertResponse(payload,m,replayed) {
 assert.equal(payload?.paymentSaved,true);
 assert.deepEqual(payload?.verifierNotification,{status:'queued'});
 assert.equal(payload?.ok,true);const p=payload.payment;assert.match(p?.id,UUID);
 assert.equal(p.status,'pending');assert.equal(p.replayed,replayed);
 assert.equal(p.planVersionId,m.offer.planVersionId);assert.equal(p.paymentChannelVersionId,m.offer.paymentChannelVersionId);
 assert.equal(p.pricingRevisionId,m.offer.revisionId);assert.equal(p.amountCentavos,14900);
 assert.equal(p.durationDays,30);assert.equal(p.entitlementMode,'rolling_days');
 must(!p.offerReviewRequired && !p.lateOfferProof);must(Number.isFinite(Date.parse(p.provisionalAccessExpiresAt)));
 assert.equal('proofObjectPath' in p,false);
 return p;
}
async function bounded(response,max=2*1024*1024) {
 if(response.status===204 && !response.body)return Buffer.alloc(0);
 const reader=response.body?.getReader();must(reader);const chunks=[];let size=0;
 try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;must(size<=max,'Oversized response');chunks.push(Buffer.from(v.value));}}
 finally{await reader.cancel();}
 return Buffer.concat(chunks);
}
export function createHttp(request=fetch) {
 return async (url,options={},expected=[200],binary=false)=>{
  const u=new URL(url);must([STAGE.supabaseUrl,STAGE.workerUrl,'https://api.cloudflare.com'].includes(u.origin));
  const response=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
  const bytes=await bounded(response);
  must(expected.includes(response.status),'Transport failed; outcome must be reconciled');
  return {status:response.status,body:binary?bytes:(bytes.length?JSON.parse(bytes.toString('utf8')):null),
   range:response.headers.get('content-range')};
 };
}
async function writeNew(file,data){await fs.writeFile(file,data,{flag:'wx',mode:0o600});}
export async function runCurrentPaymentProof({env=process.env,request=fetch,persist=null,cleanup=null,verifyCheckout=verifySource}={}) {
 assert.equal(env.GITHUB_ACTIONS,'true','This runner uses the existing protected workflow credential transport');
 const expectedSha=String(env.GITHUB_SHA||'');
 const source=await verifyCheckout(expectedSha);
 const evidencePath=String(env.STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE||'');must(evidencePath);
 const evidence=JSON.parse(await fs.readFile(evidencePath,'utf8'));
 assert.equal(evidence.sourceSha,expectedSha);
 assert.equal(evidence.workflowRunId,String(env.GITHUB_RUN_ID||''));
 assert.equal(evidence.workflowRunAttempt,String(env.GITHUB_RUN_ATTEMPT||''));
 const serviceKey=String(env.STAGING_SUPABASE_SERVICE_ROLE_KEY||''),pubKey=String(env.STAGING_SUPABASE_PUBLISHABLE_KEY||'');
 assert.equal(env.STAGING_SUPABASE_URL,STAGE.supabaseUrl);assert.equal(env.STAGING_EXAMINATION_WORKER_URL,STAGE.workerUrl);
 assert.match(serviceKey,/^sb_secret_[A-Za-z0-9_-]{20,}$/);assert.match(pubKey,/^sb_publishable_[A-Za-z0-9_-]{20,}$/);
 // Missing cleanup code must fail before Auth creation, not after an upload.
 const cleanupFn=cleanup||(await import('./staging-current-payment-proof-cleanup.mjs')).cleanupCurrentPaymentProof;
 assert.equal(typeof cleanupFn,'function');
 const http=createHttp(request),serviceHeaders={apikey:serviceKey,'Content-Type':'application/json'};
 const service=async(route,options={},expected=[200])=>http(STAGE.supabaseUrl+route,{...options,headers:{...serviceHeaders,...options.headers}},expected);
 const worker=async(route,body,token,expected=[200])=>http(STAGE.workerUrl+route,{method:'POST',
  headers:{Origin:STAGE.workerUrl,...(token?{Authorization:`Bearer ${token}`}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},
  body:body instanceof FormData?body:JSON.stringify(body)},expected);
 const baseVerify=createCommercialSuppressionVerifier({evidence,sourceSha:evidence.sourceSha,
  sourceText:await fs.readFile(path.join(REPOSITORY,'worker/commercial-entry.mjs'),'utf8'),apiToken:env.CLOUDFLARE_API_TOKEN,request});
 async function verifyDeployment(){
  const result=await baseVerify();
  const version=(await http(`${cfBase}/versions/${evidence.versionId}`,{headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`}})).body;
  assert.equal(version.success,true);assertMailBindings(version.result,evidence);
  const again=await baseVerify();assert.equal(again.deploymentId,result.deploymentId);
  return {...again,allRelevantMailModes:'suppressed'};
 }
 // Exclusive manifest creation is the run boundary; never reopen or resume.
 const runId=`${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
 const m={schemaVersion:1,purpose:'current-v4-proof-only-stage-intake',projectRef:STAGE.projectRef,source,
  deploymentEvidenceSha256:sha(await fs.readFile(evidencePath)),runId,createdAt:new Date().toISOString(),
  state:'preflight',ownerId:null,submissionState:'not_requested',replayState:'not_requested',
  globalSignOutState:'not_requested',cleanupComplete:false,crossOwnerAuthorization:'NOT_RUN-no-second-account',
  historicalIntake:'NOT_RUN-no-real-historical-binding',modelCalls:0,approvalCalls:0};
 const manifestPath=path.join(REPOSITORY,'artifacts','staging-e2e',`current-v4-${runId}-cleanup-manifest.json`);
 let initialized=false,token=null,proofBytes=null;
 async function save(){
  try{
  if(persist){await persist(clone(m));return;}
  await fs.mkdir(path.dirname(manifestPath),{recursive:true});
  const bytes=JSON.stringify(m,null,2)+'\n';
  if(!initialized){await writeNew(manifestPath,bytes);initialized=true;}
  else{await writeNew(manifestPath+'.tmp',bytes);await fs.rename(manifestPath+'.tmp',manifestPath);}
  }catch(error){m.artifactPersistenceFailed=true;m.state='held-for-review';throw error;}
 }
 const lifecycle=createPaymentFixtureLifecycle({runId,supabaseUrl:STAGE.supabaseUrl,workerUrl:STAGE.workerUrl,
  serviceRoleKey:serviceKey,publishableKey:pubKey,sourceSha:evidence.sourceSha,request,
  persist:async value=>{m.fixtureLifecycle=clone(value);await save();}});
 async function rows(table,filter){
  const q=new URLSearchParams({...filter,select:'*',limit:'11'});
  const r=await service('/rest/v1/'+table+'?'+q,{headers:{Prefer:'count=exact'}});
  must(Array.isArray(r.body)&&r.body.length<=10);const count=/^(?:\d+-\d+|\*)\/(\d+)$/.exec(r.range||'');
  must(count&&Number(count[1])===r.body.length,'Incomplete exact owner read');return r.body;
 }
 async function readPayment(){const list=await rows('payment_requests',{user_id:'eq.'+m.ownerId});assert.equal(list.length,1);return list[0];}
 async function listProof(){
  return (await service('/storage/v1/object/list/payment-proofs',{method:'POST',
   headers:{Authorization:`Bearer ${serviceKey}`},body:JSON.stringify({prefix:m.ownerId+'/',limit:3,offset:0,sortBy:{column:'name',order:'asc'}})})).body;
 }
 async function readProof(){
  const objects=await listProof();must(Array.isArray(objects));assert.equal(objects.length,1);
  assert.equal(objects[0].name,m.proof.proofObjectPath.split('/')[1]);
  const r=await http(STAGE.supabaseUrl+'/storage/v1/object/payment-proofs/'+m.proof.proofObjectPath,
   {headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}},[200],true);
  assert.equal(r.body.length,m.proof.proofSizeBytes);assert.equal(sha(r.body),m.proof.proofSha256);
  return {bytes:r.body.length,sha256:sha(r.body),objectCount:1};
 }
 await save();
 try {
  m.deployment=await verifyDeployment();await save();
  // Authoritative v4 existence and service transport before any Auth creation.
  const denial=await service('/rest/v1/rpc/phase4_create_payment_request_v4',{method:'POST',body:JSON.stringify({
   p_user_id:null,p_plan_version_id:null,p_payment_channel_version_id:null,p_proof_bucket:null,p_proof_path:null,
   p_proof_mime_type:null,p_proof_size_bytes:null,p_proof_sha256:null})},[400]);
  assert.equal(denial.body.code,'P0001');assert.equal(denial.body.message,'Authenticated user required');
  await lifecycle.preflight();
  const identity=await lifecycle.beforeCreate('student');
  const password=`Dd!${randomBytes(24).toString('base64url')}9z`;
  const created=await service('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email:identity.email,password,
   email_confirm:true,app_metadata:identity.appMetadata,user_metadata:{display_name:identity.displayName}})},[200,201]);
  // Retain an exact returned UUID before validating the rest of the Auth reply.
  assert.match(created.body?.id,UUID);m.ownerId=created.body.id;await save();
  await lifecycle.recordCreated('student',m.ownerId);
  assert.equal(created.body.email,identity.email);
  await lifecycle.register(m.ownerId);await lifecycle.beforeSignIn(m.ownerId);
  const signed=await service('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:pubKey},
   body:JSON.stringify({email:identity.email,password})});
  assert.equal(signed.body?.user?.id,m.ownerId);must(typeof signed.body.access_token==='string');
  token=signed.body.access_token;await lifecycle.rememberSession(m.ownerId,signed.body);
  const roles=await rows('user_roles',{user_id:'eq.'+m.ownerId});assert.equal(roles.length,1);assert.equal(roles[0].role,'student');
  for(const table of ['admin_capabilities','subscriptions','payment_requests','free_beta_access','examination_beta_access'])
   assert.equal((await rows(table,{user_id:'eq.'+m.ownerId})).length,0);
  const legal=(await service('/rest/v1/platform_access_settings?singleton=eq.true&select=current_terms_version,current_privacy_version')).body;
  assert.equal(legal.length,1);
  await service('/rest/v1/rpc/accept_terms',{method:'POST',headers:{apikey:pubKey,Authorization:`Bearer ${token}`},
   body:JSON.stringify({p_terms_version:legal[0].current_terms_version,p_privacy_version:legal[0].current_privacy_version,
    p_acceptance_source:'protected_staging_e2e'})},[200,204]);
  await completeMandatoryCommercialProfile({supabaseUrl:STAGE.supabaseUrl,workerUrl:STAGE.workerUrl,publishableKey:pubKey,
   token,displayName:identity.displayName,termsVersion:legal[0].current_terms_version,privacyVersion:legal[0].current_privacy_version});
  const accessBefore=(await worker('/access',{},token)).body;
  assert.equal(accessBefore.access?.accessMode,'introductory');assert.equal(accessBefore.access?.unlimited,false);
  m.offer=selectOffer((await worker('/plans',{},null)).body);
  const proof=fixturePng(runId);proofBytes=proof;m.proof=objectIdentity(m.ownerId,m.offer,proof);
  m.proofFixtureLabel='INTERNAL STAGING TEST / NOT A PAYMENT';
  assert.deepEqual(await listProof(),[]);
  await verifyDeployment();
  m.submissionState='requested';m.state='intake';await save();
  const form=()=>{const f=new FormData();f.set('planVersionId',m.offer.planVersionId);
   f.set('paymentChannelVersionId',m.offer.paymentChannelVersionId);f.set('paymentReviewContract','late-offer-review-v1');
   f.set('proof',new Blob([proof],{type:'image/png'}),'INTERNAL-STAGING-NOT-A-PAYMENT.png');return f;};
  const first=assertResponse((await worker('/payments/submit',form(),token,[201])).body,m,false);
  m.paymentId=first.id;m.firstResponse=clone(first);m.submissionState='confirmed';await save();
  const before=await readPayment();assertPayment(before,m);
  m.firstStorage=await readProof();await save();
  // Exactly one replay of a confirmed first response. Never retry an unknown first write.
  await verifyDeployment();m.replayState='requested';await save();
  const replay=assertResponse((await worker('/payments/submit',form(),token,[201])).body,m,true);
  assert.equal(replay.id,first.id);assert.equal(replay.provisionalAccessExpiresAt,first.provisionalAccessExpiresAt);
  m.replayState='confirmed';await save();
  // Suppression deliberately leaves the row pending and never claimed. There
  // is no queue-settling loop, claim, manual drain, or invented terminal state.
  const final=await readPayment();assertPayment(final,m);
  assert.equal(final.provisional_access_started_at,before.provisional_access_started_at);
  assert.equal(final.provisional_access_expires_at,before.provisional_access_expires_at);
  m.payment=final;m.finalStorage=await readProof();
  const history=await rows('payment_request_history',{payment_request_id:'eq.'+m.paymentId});
  assert.equal(history.length,1);assert.equal(history[0].action,'submitted');assert.equal(history[0].actor_user_id,m.ownerId);
  assert.equal(history[0].new_status,'pending');assert.equal(history[0].previous_status,null);
  must(!history[0].metadata?.offerReview);m.history=history[0];
  const notices=await rows('outbound_notifications',{related_resource_id:'eq.'+m.paymentId});
  assert.equal(notices.length,1);assert.equal(notices[0].notification_type,'payment_submitted');
  assert.equal(notices[0].related_resource_type,'payment_request');assert.equal(notices[0].status,'queued');
  assert.equal(notices[0].attempts,0);for(const k of ['last_attempt_at','sent_at','failure_code'])assert.equal(notices[0][k],null);
  m.notification=notices[0];
  assert.equal((await rows('subscriptions',{user_id:'eq.'+m.ownerId})).length,0);
  const access=(await worker('/access',{},token)).body;
  assert.equal(access.access?.accessMode,'provisional');assert.equal(access.access?.basis,'provisional_payment');
  assert.equal(access.access?.unlimited,true);assert.equal(Date.parse(access.access?.entitlementEndsAt),Date.parse(first.provisionalAccessExpiresAt));
  m.accessVerified={basis:'provisional_payment',unlimited:true,noSubscription:true};
  const denied=await worker('/admin/payment-proof',{paymentRequestId:m.paymentId,reason:'Internal fixture anonymous denial'},null,[401]);
  assert.equal(denied.body?.ok,false);m.anonymousProofEndpointStatus=401;
  await verifyDeployment();m.state='intake-verified';await save();
 } catch {
  m.state='held-for-review';await save();throw new Error('CURRENT_V4_PROBE_HELD: inspect private manifest; no automatic retry or cleanup');
 } finally {
  if(token){
   m.globalSignOutState='requested';m.globalSignOutOwnerId=m.ownerId;
   const lifecycleRow=m.fixtureLifecycle?.fixtures?.find(x=>x.id===m.ownerId);
   if(lifecycleRow){lifecycleRow.signOutState='requested';lifecycleRow.signOutTransport='current-v4-runner-global';}
   // A local artifact error must not prevent the one logout of a known token.
   // Persistence failure still holds all cleanup, even if a later save works.
   try{await save();}catch{}
   try{await service('/auth/v1/logout?scope=global',{method:'POST',headers:{Authorization:`Bearer ${token}`}},[200,204]);
    m.globalSignOutState='confirmed';m.globalSignOutConfirmedAt=new Date().toISOString();
    if(lifecycleRow)lifecycleRow.signOutState='confirmed';}
   catch{m.globalSignOutState='unknown';m.state='held-for-review';if(lifecycleRow)lifecycleRow.signOutState='unknown';}
   token=null;try{await save();}catch{}
  }
 }
 must(m.state==='intake-verified'&&m.globalSignOutState==='confirmed','Cleanup preparation is held');
 try {
  const result=await cleanupFn({manifest:m,persist:save,request,serviceRoleKey:serviceKey,
   supabaseUrl:STAGE.supabaseUrl,workerUrl:STAGE.workerUrl,verifySuppression:verifyDeployment,proofBytes});
  assert.equal(result?.cleanupComplete,true);assert.equal(result?.independentDatabaseReadbackRequired,true);
  m.cleanupComplete=true;m.state='complete';await save();
 }catch{
  m.state='held-for-review';await save();
  throw new Error('CURRENT_V4_CLEANUP_HELD: preserve the exact manifest; never retry an unknown mutation');
 }
 return {ok:true,runId,normalCurrentIntake:true,exactReplay:true,privateStoredBytes:true,globalSignOut:'confirmed',
  historicalIntake:'NOT_RUN',crossOwner:'NOT_RUN',cleanupComplete:true,independentDatabaseReadbackRequired:true};
}


// Tiny dependency-free fixture drawing, not a receipt, QR, screenshot or bank proof.
const font = {
 A:['01110','10001','10001','11111','10001','10001','10001'], E:['11111','10000','10000','11110','10000','10000','11111'],
 G:['01111','10000','10000','10111','10001','10001','01111'], I:['111','010','010','010','010','010','111'],
 L:['10000','10000','10000','10000','10000','10000','11111'], M:['10001','11011','10101','10101','10001','10001','10001'],
 N:['10001','11001','10101','10011','10001','10001','10001'], O:['01110','10001','10001','10001','10001','10001','01110'],
 P:['11110','10001','10001','11110','10000','10000','10000'], R:['11110','10001','10001','11110','10100','10010','10001'],
 S:['01111','10000','10000','01110','00001','00001','11110'], T:['11111','00100','00100','00100','00100','00100','00100'],
 Y:['10001','10001','01010','00100','00100','00100','00100'],
};
function crc32(bytes) { let c=0xffffffff; for(const b of bytes){ c^=b; for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(type,data) { const tag=Buffer.from(type),body=Buffer.concat([tag,data]),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([n,body,crc]); }
export function fixturePng(runId) {
 if(!/^[a-z0-9]{8,12}-[a-f0-9]{8}$/.test(runId))throw new Error('Invalid fixture run');
 const width=640,height=100,stride=width*3+1,pixels=Buffer.alloc(stride*height,255);
 for(let y=0;y<height;y++)pixels[y*stride]=0;
 for(const [line,y0] of [['INTERNAL STAGING TEST',14],['NOT A PAYMENT',54]]) {
  let x0=14;
  for(const char of line){const glyph=font[char];if(glyph)for(let y=0;y<7;y++)for(let x=0;x<glyph[y].length;x++)if(glyph[y][x]==='1')for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){const n=(y0+y*3+dy)*stride+1+(x0+x*3+dx)*3;pixels[n]=20;pixels[n+1]=35;pixels[n+2]=55;}x0+=18;}
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('tEXt',Buffer.from(`Fixture\0INTERNAL STAGING TEST - NOT A PAYMENT - ${runId}`)),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
