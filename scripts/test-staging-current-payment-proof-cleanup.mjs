import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cleanupCurrentPaymentProof } from './staging-current-payment-proof-cleanup.mjs';
import { PAYMENT_FIXTURE_TARGET, paymentFixtureIdentity } from './staging-payment-fixtures.mjs';

const ID='10000000-0000-4000-8000-000000000001',PAY='20000000-0000-4000-8000-000000000001';
const HISTORY='30000000-0000-4000-8000-000000000001',NOTICE='40000000-0000-4000-8000-000000000001';
const PLAN='50000000-0000-4000-8000-000000000001',CHANNEL='60000000-0000-4000-8000-000000000001';
const REV='70000000-0000-4000-8000-000000000001',GRANT='80000000-0000-4000-8000-000000000001';
const LEDGER='90000000-0000-4000-8000-000000000001',OBJECT='a0000000-0000-4000-8000-000000000001';
const OTHER='b0000000-0000-4000-8000-000000000001',DEPLOY='c0000000-0000-4000-8000-000000000001';
const VERSION='d0000000-0000-4000-8000-000000000001',RUN='mtsf2g4m-1234abcd',SHA='a'.repeat(40);
const CLOCK=Date.parse('2026-09-08T10:00:00Z'),SECRET=`sb_secret_${'s'.repeat(30)}`;
const hash=x=>createHash('sha256').update(x).digest('hex'),clone=x=>structuredClone(x);
const proof=Buffer.from('INTERNAL STAGING SYNTHETIC NOT A PAYMENT');
const reply=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
function fixture(){
 const identity=paymentFixtureIdentity(RUN,'student');
 const h=hash(['pricing-v3',ID,PLAN,CHANNEL,hash(proof)].join('|'));
 const m={schemaVersion:1,purpose:'current-v4-proof-only-stage-intake',projectRef:PAYMENT_FIXTURE_TARGET.projectRef,
  source:{sourceSha:SHA},createdAt:'2026-09-08T09:59:00Z',runId:RUN,state:'intake-verified',ownerId:ID,paymentId:PAY,
  submissionState:'confirmed',replayState:'confirmed',globalSignOutState:'confirmed',globalSignOutOwnerId:ID,cleanupComplete:false,
  offer:{revisionId:REV,planVersionId:PLAN,paymentChannelVersionId:CHANNEL,planCode:'early_access_beta',priceCentavos:14900,currency:'PHP',paymentMethod:'bpi_instapay'},
  proof:{proofSha256:hash(proof),proofSizeBytes:proof.length,proofObjectPath:`${ID}/${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}.png`},
  deployment:{deploymentId:DEPLOY,versionId:VERSION,workflowRunId:'34200000000',sourceSha:SHA,commercialEntryLfSha256:'f'.repeat(64)},
  fixtureLifecycle:{purpose:'complete-beta-staging-verification',projectRef:PAYMENT_FIXTURE_TARGET.projectRef,sourceSha:SHA,runId:RUN,
   fixtures:[{id:ID,label:'student',creationState:'recorded',registrationState:'confirmed',signInState:'confirmed',signOutState:'confirmed',
    signOutTransport:'current-v4-runner-global',classificationSource:`astra_complete_beta_staging_v1:${RUN}:student`,cleanupState:'pending'}]}};
 m.payment={id:PAY,user_id:ID,status:'pending',version:1,payment_evidence_mode:'proof_only',plan_code:'early_access_beta',
  pricing_revision_id:REV,pricing_plan_version_id:PLAN,pricing_payment_channel_version_id:CHANNEL,payment_method:'bpi_instapay',
  trusted_amount_centavos:14900,trusted_currency:'PHP',proof_bucket:'payment-proofs',proof_object_path:m.proof.proofObjectPath,
  proof_sha256:m.proof.proofSha256,proof_size_bytes:proof.length,proof_mime_type:'image/png',
  provisional_access_started_at:'2026-09-08T10:00:00Z',provisional_access_expires_at:'2026-09-09T10:00:00Z',
  verification_email_status:'pending',verification_email_attempts:0,subscriber_receipt_status:'pending',subscriber_receipt_attempts:0,
  updated_at:'2026-09-08T10:00:00Z',approved_activation_at:null,approved_duration_days:null};
 for(const k of ['payment_date','transaction_reference','reference_normalized','paid_at','paid_at_verified_by','paid_at_verified_at',
  'paid_at_verification_source','reviewed_at','reviewed_by','review_reason','subscription_id','provisional_access_revoked_at',
  'verification_email_provider_id','verification_email_last_attempt_at','verification_email_sent_at','verification_email_error',
  'subscriber_receipt_provider_id','subscriber_receipt_last_attempt_at','subscriber_receipt_sent_at','subscriber_receipt_error'])m.payment[k]=null;
 m.history={id:HISTORY,payment_request_id:PAY,actor_user_id:ID,action:'submitted',previous_status:null,new_status:'pending',metadata:{synthetic:true}};
 m.notification={id:NOTICE,notification_type:'payment_submitted',related_resource_type:'payment_request',related_resource_id:PAY,
  recipient_mailbox:'premium@duediligence.ph',subject:'Due Diligence plan payment verification request',secure_admin_path:`/admin/payments?request=${PAY}`,
  status:'queued',attempts:0,last_attempt_at:null,sent_at:null,failure_code:null};
 return {m,identity};
}
function assertScalarFilter(params,row){
 assert.deepEqual([...params.keys()].filter(k=>k!=='select').sort(),Object.keys(row).sort());
 for(const [key,value] of Object.entries(row)){
  const actual=params.get(key);if(value===null)assert.equal(actual,'is.null');
  else{assert.ok(actual.startsWith('eq.'));assert.equal(actual.slice(3),String(value));}
 }
}
function harness(options={}){
 const {m,identity}=fixture(),calls=[],saved=[];let exists=true,stored=true,suppressionCalls=0;
 const auth={id:ID,email:identity.email,role:'authenticated',aud:'authenticated',email_confirmed_at:m.createdAt,last_sign_in_at:m.createdAt,
  created_at:m.createdAt,deleted_at:null,is_super_admin:false,is_anonymous:false,is_sso_user:false,
  app_metadata:{provider:'email',providers:['email'],...identity.appMetadata},user_metadata:{display_name:identity.displayName}};
 const tables={user_roles:[{user_id:ID,role:'student',assigned_by:null}],profiles:[{id:ID,commercial_category:'review',law_school_id:'other',law_school_other:'Synthetic Staging Law School'}],
  forum_profile_settings:[{user_id:ID,verified_academic_at:null,verified_academic_by:null}],terms_acceptances:[{id:HISTORY,user_id:ID}],
  introductory_token_grants:[{id:GRANT,user_id:ID,token_limit:5}],introductory_token_ledger:[{id:LEDGER,user_id:ID,grant_id:GRANT,event_type:'grant',token_delta:5,balance_after:5,reservation_id:null}],
  commercial_access_choices:[],user_sign_in_events:[],payment_requests:[clone(m.payment)],payment_request_history:[clone(m.history)],outbound_notifications:[clone(m.notification)]};
 const before=clone(m);options.edit?.({m,auth,tables});
 function filtered(table,params){let result=tables[table]||[];
  for(const [key,value] of params){if(['select','limit'].includes(key))continue;
   if(key==='or'){assert.ok(value.startsWith('(')&&value.endsWith(')'));result=result.filter(row=>value.slice(1,-1).split(',').some(part=>{
    const [column,...rest]=part.split('.eq.');return String(row[column])===rest.join('.eq.');}));}
   else{assert.ok(value.startsWith('eq.'));result=result.filter(row=>String(row[key])===value.slice(3));}
  }return result;}
 const args={manifest:m,persist:async value=>{
   assert.equal(JSON.stringify(value).includes(SECRET),false);assert.equal(JSON.stringify(value).includes('sensitive-error'),false);
   if(options.persistFailure===value.cleanup?.state)throw Error('sensitive-error');saved.push(clone(value));
  },...PAYMENT_FIXTURE_TARGET,serviceRoleKey:SECRET,proofBytes:proof,now:()=>CLOCK,
  verifySuppression:async()=>{suppressionCalls++;calls.push('verify-suppression');if(options.suppressionFail===suppressionCalls)throw Error('sensitive-error');
   return {...m.deployment,paymentNotificationMode:'suppressed',allRelevantMailModes:'suppressed',observedAt:new Date(CLOCK).toISOString(),...options.deploymentDrift};},
  request:async(url,opts)=>{
   const u=new URL(url),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;
   assert.equal(u.origin,PAYMENT_FIXTURE_TARGET.supabaseUrl);assert.equal(opts.redirect,'error');assert.ok(opts.signal instanceof AbortSignal);
   assert.equal(opts.headers.apikey,SECRET);assert.equal(opts.headers.Authorization,`Bearer ${SECRET}`);
   assert.equal(new Headers(opts.headers).get('content-type'),opts.body==null?null:'application/json');
   calls.push(`${method} ${u.pathname}`);
   const checkpoint=m.cleanup?.state;
   if(u.pathname===`/auth/v1/admin/users/${ID}`){
    if(method==='DELETE'){
     assert.equal(checkpoint,'auth-delete-requested');assert.equal(stored,false);assert.equal(tables.outbound_notifications.length,0);
     assert.equal(tables.payment_requests[0].verification_email_status,'suppressed');assert.ok(saved.some(v=>v.cleanup?.state==='auth-delete-requested'));
     if(options.authUnknown)throw Error('sensitive-error');exists=false;
     for(const key of Object.keys(tables))tables[key]=[];return reply(null,204);
    }
    if(!exists&&!options.authAbsenceMissing)return reply({},404);return reply(auth);
   }
   if(u.pathname==='/storage/v1/object/list/payment-proofs'){
    assert.equal(method,'POST');assert.deepEqual(body,{prefix:ID+'/',limit:3,offset:0,sortBy:{column:'name',order:'asc'}});
    if(options.storageListUnknown&&checkpoint==='storage-delete-requested')throw Error('sensitive-error');
    const objects=stored?[{id:OBJECT,name:m.proof.proofObjectPath.split('/')[1],metadata:{size:proof.length,mimetype:'image/png'},last_accessed_at:String(calls.length)}]:[];
    if(options.storageMetadataDrift&&stored&&m.cleanup.storageBefore)objects[0].metadata.mimetype='application/octet-stream';
    if(options.extraStorage&&stored)objects.push({id:OTHER,name:'other.png',metadata:{size:1}});
    return reply(objects);
   }
   if(u.pathname===`/storage/v1/object/payment-proofs/${m.proof.proofObjectPath}`){
    if(method==='DELETE'){
     assert.equal(checkpoint,'storage-delete-requested');assert.equal(tables.outbound_notifications.length,0);
     assert.equal(tables.payment_requests[0].verification_email_status,'suppressed');assert.ok(saved.some(v=>v.cleanup?.state==='storage-delete-requested'));
     if(options.storageUnknown)throw Error('sensitive-error');if(!options.storageStillPresent)stored=false;return reply({},200);
    }
    assert.equal(method,'GET');return new Response(options.proofDrift?Buffer.from('wrong'):proof,{status:200,headers:{'Content-Type':'image/png'}});
   }
   assert.ok(u.pathname.startsWith('/rest/v1/'));const table=u.pathname.slice('/rest/v1/'.length);
   if(method==='PATCH'){
    assert.equal(table,'payment_requests');assert.equal(checkpoint,'payment-fence-requested');
    assert.ok(saved.some(v=>v.cleanup?.storageBefore&&v.cleanup?.historyBefore&&v.cleanup?.notificationBefore&&v.cleanup?.state==='payment-fence-requested'));
    assert.deepEqual(body,{verification_email_status:'suppressed'});assertScalarFilter(u.searchParams,tables.payment_requests[0]);
    if(options.claimWins){tables.payment_requests[0].verification_email_status='sending';tables.payment_requests[0].verification_email_attempts=1;return reply([]);}
    if(options.casUnknown)throw Error('sensitive-error');tables.payment_requests[0].verification_email_status='suppressed';
    if(options.casDrift)tables.payment_requests[0].paid_at='2026-09-08T10:00:00Z';
    return reply(tables.payment_requests);
   }
   if(method==='DELETE'){
    assert.equal(table,'outbound_notifications');assert.equal(checkpoint,'notice-delete-requested');assert.equal(stored,true);
    assert.ok(saved.some(v=>v.cleanup?.state==='notice-delete-requested'));assertScalarFilter(u.searchParams,tables.outbound_notifications[0]);
    if(options.noticeUnknown)throw Error('sensitive-error');if(options.noticeRace)return reply([]);
    const old=tables.outbound_notifications;tables.outbound_notifications=[];return reply(old);
   }
   assert.equal(method,'GET');assert.equal(opts.headers.Prefer,'count=exact');assert.equal(u.searchParams.get('limit'),'101');
   if(options.discoveryFailure===table)throw Error('sensitive-error');
   let rows=filtered(table,u.searchParams);
   if(options.afterStorageDrift&&table==='payment_requests'&&checkpoint==='storage-delete-confirmed'&&u.searchParams.has('user_id')){
    tables.payment_requests[0].status='approved';rows=filtered(table,u.searchParams);
   }
   return reply(rows,200,{'Content-Range':options.incomplete===table?'0-0/1000':`${rows.length?`0-${rows.length-1}`:'*'}/${rows.length}`});
  }};
 return {m,before,tables,auth,calls,saved,args,run:()=>cleanupCurrentPaymentProof(args),get exists(){return exists;},get stored(){return stored;}};
}

test('supported-API cleanup pins all snapshots, fences full row, then notice, exact Storage, Auth; no audit delete',async()=>{
 const h=harness();assert.deepEqual(await h.run(),{cleanupComplete:true,independentDatabaseReadbackRequired:true});
 assert.equal(h.exists,false);assert.equal(h.stored,false);assert.equal(h.m.cleanupComplete,true);
 assert.deepEqual(h.calls.filter(x=>x.startsWith('DELETE')),['DELETE /rest/v1/outbound_notifications',
  `DELETE /storage/v1/object/payment-proofs/${h.m.proof.proofObjectPath}`,`DELETE /auth/v1/admin/users/${ID}`]);
 assert.equal(h.calls.some(x=>/\/rpc\/|\/auth\/v1\/(?:logout|token)|admin_pulse/.test(x)),false);
 assert.deepEqual(h.m.payment,h.before.payment);assert.deepEqual(h.m.history,h.before.history);assert.deepEqual(h.m.notification,h.before.notification);
 assert.match(h.m.cleanup.authSessions,/not-direct-DB-proof/);assert.match(h.m.cleanup.mutationAtomicity,/not-a-multitable/);
});

for(const [name,edit] of [
 ['wrong project',x=>{x.m.projectRef='hbllomlijfznnuudpdvr';}],['uncertain intake',x=>{x.m.state='held-for-review';}],
 ['uncertain submission',x=>{x.m.submissionState='requested';}],['uncertain replay',x=>{x.m.replayState='requested';}],
 ['unconfirmed global logout',x=>{x.m.globalSignOutState='unknown';}],['logout belongs to another owner',x=>{x.m.globalSignOutOwnerId=OTHER;}],
 ['registry acknowledgement missing',x=>{x.m.fixtureLifecycle.fixtures[0].registrationState='requested';}],
 ['editable-only identity record',x=>{x.m.fixtureLifecycle.fixtures[0].classificationSource='user_metadata';}],
 ['second fixture',x=>{x.m.fixtureLifecycle.fixtures.push(clone(x.m.fixtureLifecycle.fixtures[0]));}],
 ['wrong source provenance',x=>{x.m.fixtureLifecycle.sourceSha='b'.repeat(40);}],['wrong proof bytes',x=>{x.m.proof.proofSha256='b'.repeat(64);}],
 ['cross-owner proof path',x=>{x.m.proof.proofObjectPath=OTHER+'/proof.png';}],['payment date present',x=>{x.m.payment.payment_date='2026-09-08';}],
 ['payment reference present',x=>{x.m.payment.transaction_reference='synthetic';}],['approved payment',x=>{x.m.payment.status='approved';}],
 ['verification previously failed',x=>{x.m.payment.verification_email_status='failed';}],['verification claimed',x=>{x.m.payment.verification_email_attempts=1;}],
 ['receipt attempted',x=>{x.m.payment.subscriber_receipt_attempts=1;}],['provider ID present',x=>{x.m.payment.verification_email_provider_id='private-provider';}],
 ['unknown nonscalar row',x=>{x.m.payment.future_column={unreviewed:true};}],['history wrong actor',x=>{x.m.history.actor_user_id=OTHER;}],
 ['notice already sending',x=>{x.m.notification.attempts=1;}],['approved fields present',x=>{x.m.payment.approved_activation_at='2026-09-08T10:00:00Z';}]
])test(`initial unsafe state holds without transport: ${name}`,async()=>{
 const h=harness({edit});await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);assert.deepEqual(h.calls,[]);assert.equal(h.exists,true);assert.equal(h.stored,true);
});

for(const [name,edit] of [
 ['changed Auth owner',x=>{x.auth.email='unrelated-private@example.invalid';}],
 ['editable-only Auth marker',x=>{delete x.auth.app_metadata.astra_staging_complete_beta_fixture;}],
 ['admin role',x=>{x.tables.user_roles[0].role='admin';}],['capability',x=>{x.tables.admin_capabilities=[{user_id:ID}];}],
 ['subscription',x=>{x.tables.subscriptions=[{user_id:ID}];}],['free Beta',x=>{x.tables.free_beta_access=[{user_id:ID}];}],
 ['cross-owner assigned role',x=>{x.tables.user_roles.push({user_id:OTHER,role:'admin',assigned_by:ID});}],
 ['cross-owner refund on this payment',x=>{x.tables.refund_requests=[{user_id:OTHER,payment_request_id:PAY,reviewed_by:null}];}],
 ['cross-owner refund history actor',x=>{x.tables.refund_request_history=[{refund_request_id:OTHER,actor_user_id:ID}];}],
 ['cross-owner subscription history owner',x=>{x.tables.subscription_history=[{subscription_id:OTHER,user_id:ID,actor_user_id:OTHER}];}],
 ['cross-owner subscription history actor',x=>{x.tables.subscription_history=[{subscription_id:OTHER,user_id:OTHER,actor_user_id:ID}];}],
 ['cross-owner token descendant',x=>{x.tables.introductory_token_ledger.push({...x.tables.introductory_token_ledger[0],id:OTHER,user_id:OTHER});}],
 ['consumed token',x=>{x.tables.introductory_token_ledger[0].event_type='consumed';}],
 ['admin audit',x=>{x.tables.admin_audit_log=[{actor_user_id:ID,id:OTHER}];}],
 ['examination audit',x=>{x.tables.examination_audit_log=[{actor_user_id:ID,id:9}];}],
 ['second payment',x=>{x.tables.payment_requests.push({...x.tables.payment_requests[0],id:OTHER});}],
 ['changed canonical history',x=>{x.tables.payment_request_history[0].metadata={changed:true};}],
 ['changed exact notice',x=>{x.tables.outbound_notifications[0].subject='changed';}],
 ['current payment claim',x=>{x.tables.payment_requests[0].verification_email_attempts=1;}]
])test(`live read drift holds before CAS or deletion: ${name}`,async()=>{
 const h=harness({edit});await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);
 assert.equal(h.calls.some(x=>/^(DELETE|PATCH) /.test(x)),false);assert.equal(h.exists,true);assert.equal(h.stored,true);
 assert.equal(h.saved.at(-1).cleanup.state,'held-for-review');
});

for(const options of [{extraStorage:true},{proofDrift:true},{incomplete:'payment_requests'},{discoveryFailure:'admin_capabilities'},
 {suppressionFail:1},{deploymentDrift:{allRelevantMailModes:'enabled'}},{deploymentDrift:{versionId:OTHER}}])test(`pre-delete evidence failure ${JSON.stringify(options)}`,async()=>{
 const h=harness(options);await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);assert.equal(h.calls.some(x=>/^(DELETE|PATCH) /.test(x)),false);
});

for(const options of [{claimWins:true},{casUnknown:true},{casDrift:true},{suppressionFail:2},{storageMetadataDrift:true},{noticeUnknown:true},{noticeRace:true},
 {storageUnknown:true},{storageListUnknown:true},{storageStillPresent:true},{afterStorageDrift:true},{authUnknown:true},{authAbsenceMissing:true}])test(`uncertain mutation holds without retry ${JSON.stringify(options)}`,async()=>{
 const h=harness(options);await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);
 assert.equal(h.m.cleanupComplete,false);assert.equal(h.m.cleanup.state,'held-for-review');
 const called=h.calls.length;await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);assert.equal(h.calls.length,called);
 assert.ok(h.calls.filter(x=>x==='PATCH /rest/v1/payment_requests').length<=1);
 assert.ok(h.calls.filter(x=>x.startsWith('DELETE /storage/')).length<=1);assert.ok(h.calls.filter(x=>x===`DELETE /auth/v1/admin/users/${ID}`).length<=1);
 if(options.claimWins||options.casUnknown||options.casDrift||options.suppressionFail||options.noticeUnknown||options.noticeRace)assert.equal(h.stored,true);
 if(options.storageUnknown||options.storageListUnknown||options.storageStillPresent||options.afterStorageDrift)assert.equal(h.exists,true);
});
for(const stage of ['snapshots-captured','payment-fence-requested','notice-delete-requested','storage-delete-requested','auth-delete-requested'])test(`persistence failure before ${stage} prevents that mutation`,async()=>{
 const h=harness({persistFailure:stage});await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);
 const disallowed=stage.startsWith('auth-')?'DELETE /auth/':stage.startsWith('storage-')?'DELETE /storage/':stage.startsWith('notice-')?'DELETE /rest/':'PATCH /rest/';
 assert.equal(h.calls.some(x=>x.startsWith(disallowed)),false);
});
test('successful cleanup cannot be invoked a second time',async()=>{
 const h=harness();await h.run();const count=h.calls.length;await assert.rejects(h.run,/CURRENT_PAYMENT_PROOF_CLEANUP_HELD/);assert.equal(h.calls.length,count);assert.equal(h.m.cleanupComplete,true);
});
test('real loopback HTTP preserves JSON POST/PATCH and omits JSON headers on bodyless DELETE', {timeout:10000}, async()=>{
 const h=harness(),backing=h.args.request,observed=[],serverErrors=[];
 // Source-grounded narrow Fastify-style parser, not an assertion of the hosted
 // Storage version. Fastify v5.11.2 handle-request.js selects parsing when a
 // body-capable request declares Content-Type; content-type-parser.js rejects
 // an empty JSON body with FST_ERR_CTP_EMPTY_JSON_BODY before route execution.
 // https://github.com/fastify/fastify/blob/v5.11.2/lib/handle-request.js
 // https://github.com/fastify/fastify/blob/v5.11.2/lib/content-type-parser.js
 // Supabase Storage deleteObject.ts registers DELETE /:bucketName/* without a body.
 const server=createServer(async(req,res)=>{
  try {
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=Buffer.concat(chunks),contentType=req.headers['content-type'];
   observed.push({method:req.method,path:new URL(req.url,'http://127.0.0.1').pathname,contentType,bytes:body.length});
   if(['DELETE','POST','PATCH'].includes(req.method)&&contentType==='application/json'&&body.length===0){
    res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'FST_ERR_CTP_EMPTY_JSON_BODY'}));return;
   }
   if(body.length){assert.equal(contentType,'application/json');assert.doesNotThrow(()=>JSON.parse(body.toString('utf8')));}
   const headers={apikey:req.headers.apikey,Authorization:req.headers.authorization};
   if(req.headers.prefer!==undefined)headers.Prefer=req.headers.prefer;
   if(contentType!==undefined)headers['Content-Type']=contentType;
   const response=await backing(PAYMENT_FIXTURE_TARGET.supabaseUrl+req.url,{method:req.method,headers,
    redirect:'error',signal:AbortSignal.timeout(5000),...(body.length?{body:body.toString('utf8')}:{})});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){serverErrors.push(error);res.writeHead(500);res.end();}
 });
 try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  // The old request shape is rejected on the actual HTTP wire without entering
  // any fake Storage handler or altering its proof. No remote endpoint is used.
  const rejected=await fetch(origin+'/storage/v1/object/payment-proofs/inert-control.png',{
   method:'DELETE',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000)});
  assert.equal(rejected.status,400);assert.deepEqual(await rejected.json(),{code:'FST_ERR_CTP_EMPTY_JSON_BODY'});
  assert.deepEqual(h.calls,[]);assert.equal(h.stored,true);assert.equal(h.exists,true);observed.length=0;
  h.args.request=async(url,options)=>{
   const target=new URL(url);assert.equal(target.origin,PAYMENT_FIXTURE_TARGET.supabaseUrl);
   return fetch(origin+target.pathname+target.search,options);
  };
  assert.deepEqual(await h.run(),{cleanupComplete:true,independentDatabaseReadbackRequired:true});
  assert.deepEqual(serverErrors,[]);
  const deletes=observed.filter(r=>r.method==='DELETE');assert.equal(deletes.length,3);
  assert.ok(deletes.every(r=>r.contentType===undefined&&r.bytes===0));
  const jsonWrites=observed.filter(r=>r.method==='POST'||r.method==='PATCH');
  assert.ok(jsonWrites.some(r=>r.method==='POST'&&r.path==='/storage/v1/object/list/payment-proofs'));
  assert.equal(jsonWrites.filter(r=>r.method==='PATCH'&&r.path==='/rest/v1/payment_requests').length,1);
  assert.ok(jsonWrites.every(r=>r.contentType==='application/json'&&r.bytes>0));
  assert.ok(observed.filter(r=>r.method==='GET').every(r=>r.contentType===undefined&&r.bytes===0));
  assert.equal(h.stored,false);assert.equal(h.exists,false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('module stays inert and reuses exact corrected scalar CAS with no SQL Storage mutation or new registrar',async()=>{
 const source=await readFile(new URL('./staging-current-payment-proof-cleanup.mjs',import.meta.url),'utf8');
 assert.match(source,/import \{ exactCommercialRowFilter \} from '\.\/staging-commercial-fixtures\.mjs'/u);
 for(const forbidden of ['execute_sql','apply_migration','phase4_claim_payment_notification','astra_register_staging_commercial_fixture','process.env','writeFile','console.'])assert.equal(source.includes(forbidden),false);
 assert.equal(source.match(/method:'DELETE'/gu)?.length,3);
});
