import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { STAGE,REPOSITORY,sha,selectOffer,objectIdentity,assertPayment,assertMailBindings,createHttp,
 fixturePng,runCurrentPaymentProof,assertCheckoutContract,verifySource } from './staging-current-payment-proof.mjs';
import { cleanupCurrentPaymentProof } from './staging-current-payment-proof-cleanup.mjs';
import { exactCommercialRowFilter } from './staging-commercial-fixtures.mjs';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',
 '55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777'];
function pricing(){return {revisionId:ids[1],serverNow:new Date().toISOString(),plans:[{versionId:ids[2],planCode:'early_access_beta',
 priceCentavos:14900,currency:'PHP',checkoutOpen:true,durationDays:30,entitlementMode:'rolling_days'}],
 paymentMethods:[{versionId:ids[3],channelCode:'bpi_instapay',enabled:true,visible:true,qrUrl:'/assets/payments/test.png',
 qrAmountMode:'exact',qrAmountCentavos:14900,planCode:'early_access_beta'}]};}
function manifest(){
 const offer=selectOffer({pricing:pricing()}),proof=objectIdentity(ids[0],offer,fixturePng('mtrpabcd-aabbccdd'));
 const m={schemaVersion:1,state:'intake-verified',globalSignOutState:'confirmed',createdAt:new Date().toISOString(),
 runId:'mtrpabcd-aabbccdd',projectRef:STAGE.projectRef,ownerId:ids[0],paymentId:ids[4],offer,proof};
 m.payment={id:m.paymentId,user_id:m.ownerId,status:'pending',version:1,payment_evidence_mode:'proof_only',payment_method:offer.paymentMethod,plan_code:offer.planCode,
  pricing_revision_id:offer.revisionId,pricing_plan_version_id:offer.planVersionId,pricing_payment_channel_version_id:offer.paymentChannelVersionId,
  proof_bucket:'payment-proofs',proof_sha256:proof.proofSha256,proof_object_path:proof.proofObjectPath,proof_size_bytes:proof.proofSizeBytes,
  proof_mime_type:'image/png',trusted_amount_centavos:14900,trusted_currency:'PHP',trusted_entitlement_mode:'fixed_end',
  provisional_access_started_at:'2026-09-08T08:00:00Z',provisional_access_expires_at:'2026-09-09T08:00:00Z',
  verification_email_status:'pending',verification_email_attempts:0,subscriber_receipt_status:'pending',subscriber_receipt_attempts:0};
 for(const k of ['payment_date','transaction_reference','reference_normalized','paid_at','paid_at_verified_by','paid_at_verified_at',
 'paid_at_verification_source','reviewed_at','reviewed_by','review_reason','subscription_id','approved_activation_at',
 'approved_entitlement_starts_at','approved_entitlement_ends_at','provisional_access_revoked_at',
 'subscriber_receipt_provider_id','subscriber_receipt_error','subscriber_receipt_last_attempt_at','subscriber_receipt_sent_at',
 'verification_email_provider_id','verification_email_sent_at','verification_email_error','verification_email_last_attempt_at'])m.payment[k]=null;
 m.history={id:ids[5],payment_request_id:m.paymentId,actor_user_id:m.ownerId,action:'submitted',new_status:'pending',previous_status:null,metadata:{}};
 m.notification={id:ids[6],related_resource_id:m.paymentId,notification_type:'payment_submitted',related_resource_type:'payment_request',
 recipient_mailbox:'premium@duediligence.ph',subject:'Due Diligence plan payment verification request',secure_admin_path:`/admin/payments?request=${m.paymentId}`,
 status:'queued',attempts:0,last_attempt_at:null,sent_at:null,failure_code:null};
 return m;
}
test('visible deterministic PNG label, valid RGB/deflate bytes, unique run identity',()=>{
 const a=fixturePng('mtrpabcd-aabbccdd'),b=fixturePng('mtrpabcd-aabbccde');
 assert.equal(a.readUInt32BE(16),640);assert.equal(a.readUInt32BE(20),100);
 assert.match(a.toString('latin1'),/INTERNAL STAGING TEST - NOT A PAYMENT/);
 let cursor=8,idat;
 while(cursor<a.length){const n=a.readUInt32BE(cursor),tag=a.subarray(cursor+4,cursor+8).toString();if(tag==='IDAT')idat=a.subarray(cursor+8,cursor+8+n);cursor+=12+n;}
 const pixels=inflateSync(idat);assert.equal(pixels.length,192100);assert.ok(pixels.filter(x=>x===20).length>1000);
 assert.equal(sha(a),sha(fixturePng('mtrpabcd-aabbccdd')));assert.notEqual(sha(a),sha(b));
});
test('strict current149 public DTO and exact/generic channel compatibility',()=>{
 const p=pricing();assert.equal(selectOffer({pricing:p}).planVersionId,ids[2]);
 for(const bad of [x=>x.plans[0].checkoutOpen=false,x=>x.plans[0].priceCentavos=19900,x=>x.paymentMethods[0].enabled=false,
 x=>x.paymentMethods[0].planCode='other',x=>x.paymentMethods[0].qrAmountCentavos=19900,x=>x.paymentMethods[0].qrUrl=null,
 x=>x.plans[0].durationDays=31,x=>x.plans[0].entitlementMode='fixed_end']){
  const v=structuredClone(p);bad(v);assert.throws(()=>selectOffer({pricing:v}));
 }
 const generic=structuredClone(p);generic.paymentMethods[0].qrAmountMode='generic';generic.paymentMethods[0].qrAmountCentavos=null;
 assert.equal(selectOffer({pricing:generic}).paymentMethod,'bpi_instapay');
 const malformed=structuredClone(p);malformed.paymentMethods[0].channelCode='bpi-instaPay';assert.throws(()=>selectOffer({pricing:malformed}));
});
test('actual Worker pricing sanitizer preserves the returned BPI channel, no hardcoded alternate bank',async()=>{
 const {sanitizePublicPricingSnapshot}=await import(pathToFileURL(path.join(REPOSITORY,'worker/pricing-core.mjs')));
 const value=sanitizePublicPricingSnapshot(pricing());
 const selected=selectOffer(value);assert.equal(selected.paymentMethod,'bpi_instapay');
 assert.equal(selected.paymentChannelVersionId,ids[3]);assert.equal(selected.priceCentavos,14900);
});
test('current proof permits immutable fixed snapshot and separate rolling effective DTO, never filled payment evidence',()=>{
 const m=manifest();assertPayment(m.payment,m);
 for(const column of ['paid_at','payment_date','transaction_reference','reference_normalized','subscription_id','approved_activation_at']){
  const row={...m.payment,[column]:'fabricated'};assert.throws(()=>assertPayment(row,m));
 }
 for(const status of ['sending','failed','suppressed','uncertain','sent'])assert.throws(()=>assertPayment({...m.payment,verification_email_status:status},m));
 assert.throws(()=>assertPayment({...m.payment,verification_email_provider_id:'provider'},m));
 assert.throws(()=>assertPayment({...m.payment,verification_email_attempts:1},m));
 assert.throws(()=>assertPayment({...m.payment,verification_email_last_attempt_at:new Date().toISOString()},m));
 assert.throws(()=>assertPayment({...m.payment,provisional_access_expires_at:'2026-09-10T08:00:00Z'},m));
});
test('live binding gate requires every relevant exact plain-text suppressed mode',()=>{
 const names=['OUTBOUND_EMAIL_MODE','SUBSCRIPTION_RECEIPT_EMAIL_MODE','SIGN_IN_NOTIFICATION_EMAIL_MODE','ADMIN_DIRECTORY_EMAIL_MODE',
 'SUPPORT_NOTIFICATION_EMAIL_MODE','FORECAST_RESULTS_EMAIL_MODE','EXAMINATION_ROOM_EMAIL_MODE'];
 const version={id:ids[0],resources:{bindings:[{name:'SUPABASE_URL',type:'plain_text',text:STAGE.supabaseUrl},
 ...names.map(name=>({name,type:'plain_text',text:'suppressed'}))]}};
 assertMailBindings(version,{versionId:ids[0]});
 for(let i=1;i<version.resources.bindings.length;i++){
  for(const kind of ['enabled','secret_text','absent']){const v=structuredClone(version);
   if(kind==='enabled')v.resources.bindings[i].text='enabled';if(kind==='secret_text')v.resources.bindings[i].type=kind;
   if(kind==='absent')v.resources.bindings.splice(i,1);assert.throws(()=>assertMailBindings(v,{versionId:ids[0]}));}
 }
});
test('empty204 handled; redirect disabled; uncertain write never retried',async()=>{
 let calls=0;const http=createHttp(async(_u,options)=>{calls++;assert.equal(options.redirect,'error');return new Response(null,{status:204});});
 assert.equal((await http(STAGE.supabaseUrl+'/auth/v1/logout',{method:'POST'},[204])).body,null);assert.equal(calls,1);
 const failed=createHttp(async()=>{calls++;throw new TypeError('unknown');});
 await assert.rejects(failed(STAGE.workerUrl+'/payments/submit',{method:'POST'}));assert.equal(calls,2);
 await assert.rejects(http('https://production.example/path'));
});

test('portable checkout gate rejects wrong SHA, tracked drift, missing dependency or byte mismatch',async()=>{
 const expected='a'.repeat(40),source='reviewed source\n';
 assertCheckoutContract(expected,expected,'');
 for(const input of [[expected,'b'.repeat(40),''],[expected,expected,' M worker/index.mjs'],['invalid',expected,'']])
  assert.throws(()=>assertCheckoutContract(...input));
 const fakeGit=(...args)=>{
  if(args.join(' ')==='rev-parse HEAD')return expected;
  if(args[0]==='status')return '';
  if(args[0]==='show')return source;
  if(args[0]==='ls-files')return args.at(-1);
  if(args[0]==='rev-parse')return 'b'.repeat(40);
  throw new Error('Unexpected git command');
 };
 const good=await verifySource(expected,{runGit:fakeGit,readFile:async()=>source.replaceAll('\n','\r\n')});
 assert.equal(Object.keys(good.pins).length,10);
 assert.ok(good.pins['scripts/staging-commercial-fixtures.mjs']);
 await assert.rejects(verifySource(expected,{runGit:fakeGit,readFile:async()=>source+'drift'}));
 await assert.rejects(verifySource(expected,{runGit:(...args)=>{if(args[0]==='ls-files')throw Error('not tracked');return fakeGit(...args);},readFile:async()=>source}));
});
test('CLI is inert-by-import module, no workstation pins, and cleanup marker is after success',async()=>{
 const module=await fs.readFile(new URL('./staging-current-payment-proof.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(module,/C:\/Users|dc724ff6|8ea3bb6f|current-v4-intake|main\(\)\.catch/);
 const cli=await fs.readFile(new URL('./test-current-payment-proof-staging.mjs',import.meta.url),'utf8');
 assert.ok(cli.indexOf('await runCurrentPaymentProof()')<cli.indexOf('synthetic_cleanup=true'));
 assert.match(cli,/process\.argv\.length !== 2/);assert.doesNotMatch(cli,/error\.message|console\.error\(error/);
});

async function mockJourney(failure=null,{actualCleanup=false}={}){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'dd-current-v4-mock-')),evidenceFile=path.join(dir,'evidence.json');
 const sourceSha='a'.repeat(40),calls=[],parts=[],snapshots=[],saveAttempts=[],m=manifest();
 const marker='astra-commercial-stage:123456789:1:'+sourceSha;
 const evidence={schemaVersion:1,kind:'protected-workflow-worker-deployment',sourceSha,accountId:STAGE.accountId,
 workerName:STAGE.workerName,workflowRunId:'123456789',workflowRunAttempt:'1',provenance:'wrangler-version-cloudflare-deployment-message-v1',
 wranglerVersion:'4.114.0',wranglerOutputSha256:'a'.repeat(64),deploymentMessage:marker,deploymentId:ids[5],versionId:ids[6],
 commercialEntryLfSha256:sha((await fs.readFile(path.join(REPOSITORY,'worker/commercial-entry.mjs'),'utf8')).replaceAll('\r\n','\n'))};
 const deployment={id:evidence.deploymentId,versions:[{version_id:evidence.versionId,percentage:100}],annotations:{'workers/message':marker},created_on:new Date().toISOString()};
 const bindings=['OUTBOUND_EMAIL_MODE','SUBSCRIPTION_RECEIPT_EMAIL_MODE','SIGN_IN_NOTIFICATION_EMAIL_MODE','ADMIN_DIRECTORY_EMAIL_MODE',
 'SUPPORT_NOTIFICATION_EMAIL_MODE','FORECAST_RESULTS_EMAIL_MODE','EXAMINATION_ROOM_EMAIL_MODE'].map(name=>({name,type:'plain_text',text:'suppressed'}));
 bindings.push({name:'SUPABASE_URL',type:'plain_text',text:STAGE.supabaseUrl});
 if(failure==='suppression')bindings[0].text='enabled';
 let identity,uploaded=null,cleanupCalls=0,authExists=false,storageExists=false,noticeExists=true;
 const grantId='88888888-8888-4888-8888-888888888888',ledgerId='99999999-9999-4999-8999-999999999999';
 const defaults={
  user_roles:[{user_id:ids[0],role:'student',assigned_by:null}],
  profiles:[{id:ids[0],commercial_category:'review',law_school_id:'other',law_school_other:'Synthetic Staging Law School'}],
  forum_profile_settings:[{user_id:ids[0],verified_academic_at:null,verified_academic_by:null}],
  terms_acceptances:[{user_id:ids[0]}],introductory_token_grants:[{id:grantId,user_id:ids[0],token_limit:5}],
  introductory_token_ledger:[{id:ledgerId,user_id:ids[0],grant_id:grantId,event_type:'grant',token_delta:5,balance_after:5,reservation_id:null}],
  commercial_access_choices:[],user_sign_in_events:[],
 };
 function filtered(rows,params){
  return rows.filter(row=>[...params].every(([key,value])=>{
   if(['select','limit'].includes(key))return true;
   if(key==='or')return value.slice(1,-1).split(',').some(term=>{const [column,...rest]=term.split('.eq.');return String(row[column])===rest.join('.eq.');});
   assert.ok(value.startsWith('eq.'));return String(row[key])===value.slice(3);
  }));
 }
 const response=(body,status=200,headers={})=>status===204?new Response(null,{status}):Response.json(body,{status,headers});
 const listResponse=v=>response(v,200,{'content-range':v.length?'0-'+(v.length-1)+'/'+v.length:'*/0'});
 const fake=async(url,options={})=>{
  const u=new URL(url),route=u.pathname;calls.push({route,method:options.method||'GET'});
  if(u.origin==='https://api.cloudflare.com'){
   if(route.endsWith('/deployments'))return response({success:true,result:{deployments:[deployment]}});
   if(route.endsWith('/versions/'+evidence.versionId))return response({success:true,result:{id:evidence.versionId,resources:{bindings}}});
   throw new Error('Unexpected CF request');
  }
  if(route==='/rest/v1/rpc/phase4_create_payment_request_v4')return response(failure==='missing-v4'?
   {code:'PGRST202',message:'Function unavailable'}:{code:'P0001',message:'Authenticated user required'},400);
  if(route==='/rest/v1/rpc/astra_register_staging_payment_fixture'){
   const v=JSON.parse(options.body);
   if(v.p_user_id===null)return response({code:'P0001',message:'Staging complete-beta fixture identity is invalid'},400);
   if(failure==='registration')return response({registered:false});
   return response({registered:true,fixtureUserId:ids[0],dataScope:'internal_test',registrationVersion:'astra-staging-complete-beta-v1',replayed:false});
  }
  if(route==='/auth/v1/admin/users'){
   assert.equal(snapshots.at(-1).fixtureLifecycle.fixtures[0].creationState,'requested');
   identity=JSON.parse(options.body);if(failure==='create-unknown')throw new TypeError('Unknown creation outcome');
   authExists=true;
   return response({id:ids[0],email:identity.email},201);
  }
  if(route==='/auth/v1/admin/users/'+ids[0]){
   if(options.method==='DELETE'){
    assert.equal(storageExists,false);assert.equal(noticeExists,false);assert.equal(m.payment.verification_email_status,'suppressed');
    assert.ok(calls.some(c=>c.route==='/auth/v1/logout'));authExists=false;return response(null,204);
   }
   if(!authExists)return response({},404);
   const stamp=new Date().toISOString();
   return response({id:ids[0],email:identity.email,role:'authenticated',aud:'authenticated',
    app_metadata:{provider:'email',providers:['email'],...identity.app_metadata},user_metadata:identity.user_metadata,
    created_at:stamp,email_confirmed_at:stamp,last_sign_in_at:stamp});
  }
  if(route==='/auth/v1/token'){
   assert.equal(snapshots.at(-1).fixtureLifecycle.fixtures[0].registrationState,'confirmed');
   if(failure==='signin-unknown')throw new TypeError('Unknown sign-in outcome');
   return response({access_token:'normal-fixture-token-'.repeat(4),user:{id:ids[0]}});
  }
  if(route==='/auth/v1/logout')return failure==='logout'?response({error:'denied'},401):response(null,204);
  if(route==='/rest/v1/platform_access_settings')return response([{current_terms_version:'terms-reviewed-version',current_privacy_version:'privacy-reviewed-version'}]);
  if(route==='/rest/v1/rpc/accept_terms'||route==='/rest/v1/rpc/complete_commercial_profile_onboarding_v2')return response(null,204);
  if(route==='/access')return response({ok:true,access:uploaded?{accessMode:'provisional',basis:'provisional_payment',unlimited:true,entitlementEndsAt:m.payment.provisional_access_expires_at}:
   {accessMode:'introductory',unlimited:false,tokenDisclosureVersion:'disclosure-reviewed-version'}});
  if(route==='/plans'){const value=pricing();if(failure==='public-terms')value.plans[0].entitlementMode='fixed_end';return response({ok:true,pricing:value});}
  if(route==='/storage/v1/object/list/payment-proofs')return response(storageExists?[{id:ledgerId,name:m.proof.proofObjectPath.split('/')[1],metadata:{size:uploaded.length,mimetype:'image/png'}}]:[]);
  if(route.startsWith('/storage/v1/object/payment-proofs/')){
   if(options.method==='DELETE'){assert.equal(route,'/storage/v1/object/payment-proofs/'+m.proof.proofObjectPath);storageExists=false;return response(null,204);}
   return new Response(uploaded,{status:200});
  }
  if(route==='/payments/submit'){
   assert.deepEqual([...options.body.keys()].sort(),['paymentChannelVersionId','paymentReviewContract','planVersionId','proof']);
   assert.equal(snapshots.at(-1)[parts.length?'replayState':'submissionState'],'requested');
   const bytes=Buffer.from(await options.body.get('proof').arrayBuffer());parts.push(bytes);
   m.proof=objectIdentity(ids[0],m.offer,bytes);m.payment.proof_sha256=m.proof.proofSha256;
   m.payment.proof_object_path=m.proof.proofObjectPath;m.payment.proof_size_bytes=bytes.length;uploaded=bytes;storageExists=true;
   if(failure==='submit-unknown')throw new TypeError('Unknown proof intake outcome');
   if(failure==='claimed'){m.payment.verification_email_status='sending';m.payment.verification_email_attempts=1;}
   if(failure==='paid-at')m.payment.paid_at=new Date().toISOString();
   return response({ok:true,paymentSaved:true,verifierNotification:{status:'queued'},payment:{id:m.paymentId,status:'pending',replayed:parts.length>1,planVersionId:m.offer.planVersionId,
    paymentChannelVersionId:m.offer.paymentChannelVersionId,pricingRevisionId:m.offer.revisionId,amountCentavos:14900,
    entitlementMode:'rolling_days',durationDays:30,provisionalAccessExpiresAt:failure==='replay-drift'&&parts.length===2?
     '2026-09-10T08:00:00Z':m.payment.provisional_access_expires_at}},201);
  }
  if(route==='/admin/payment-proof'){assert.equal(options.headers.Authorization,undefined);return response({ok:false},401);}
  if(route.startsWith('/rest/v1/')){
   const table=route.split('/').at(-1);
   if(options.method==='PATCH'){
    assert.equal(table,'payment_requests');assert.equal(m.payment.verification_email_status,'pending');
    const expected=exactCommercialRowFilter(m.payment);expected.set('select','*');assert.equal(u.searchParams.toString(),expected.toString());
    assert.deepEqual(JSON.parse(options.body),{verification_email_status:'suppressed'});m.payment.verification_email_status='suppressed';return response([m.payment]);
   }
   if(options.method==='DELETE'){
    assert.equal(table,'outbound_notifications');
    const expected=exactCommercialRowFilter(m.notification);expected.set('select','*');assert.equal(u.searchParams.toString(),expected.toString());
    assert.equal(noticeExists,true);noticeExists=false;return response([m.notification]);
   }
   const records=!authExists?[]:table==='payment_requests'?(uploaded?[m.payment]:[]):
    table==='payment_request_history'?(uploaded?[m.history]:[]):table==='outbound_notifications'?(uploaded&&noticeExists?[m.notification]:[]):defaults[table]||[];
   return listResponse(filtered(records,u.searchParams));
  }
  throw new Error('Unexpected operation '+route);
 };
 const originalFetch=globalThis.fetch;globalThis.fetch=fake;
 try{
  await fs.writeFile(evidenceFile,JSON.stringify(evidence),{flag:'wx'});
  let result,error;
  try{result=await runCurrentPaymentProof({request:fake,persist:async v=>{
   saveAttempts.push(structuredClone(v));
   if((failure==='persist-before-logout'&&v.globalSignOutState==='requested') ||
      (failure==='persist-after-logout'&&v.globalSignOutState==='confirmed') ||
      (failure==='persist-session'&&v.fixtureLifecycle?.fixtures[0]?.signInState==='confirmed'))throw new Error('Synthetic artifact persistence failure');
   snapshots.push(structuredClone(v));
  },
   verifyCheckout:async expected=>{assert.equal(expected,sourceSha);return {sourceSha,tree:'b'.repeat(40)};},
   cleanup:actualCleanup?async args=>{cleanupCalls++;return cleanupCurrentPaymentProof(args);}:async ({manifest:current,persist,proofBytes,verifySuppression})=>{
    cleanupCalls++;assert.equal(current.state,'intake-verified');assert.equal(current.globalSignOutState,'confirmed');
    assert.equal(current.globalSignOutOwnerId,current.ownerId);assert.equal(current.fixtureLifecycle.fixtures[0].signOutState,'confirmed');
    assert.deepEqual(Buffer.from(proofBytes),uploaded);assert.equal(current.payment.verification_email_attempts,0);
    await verifySuppression();current.cleanup={state:'fence-requested'};await persist(structuredClone(current));
    if(failure==='cleanup-unknown')throw new TypeError('Unknown cleanup outcome');
    current.cleanup={state:'complete'};await persist(structuredClone(current));
    return {cleanupComplete:true,independentDatabaseReadbackRequired:true};
   },
   env:{GITHUB_ACTIONS:'true',GITHUB_SHA:sourceSha,GITHUB_RUN_ID:'123456789',GITHUB_RUN_ATTEMPT:'1',STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE:evidenceFile,
    STAGING_SUPABASE_URL:STAGE.supabaseUrl,STAGING_EXAMINATION_WORKER_URL:STAGE.workerUrl,
    STAGING_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+'x'.repeat(30),STAGING_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),
    CLOUDFLARE_API_TOKEN:'mock-token-'.repeat(4)}});
  }catch(e){error=e;}
  return {result,error,calls,parts,snapshots,saveAttempts,cleanupCalls,identity,authExists,storageExists,noticeExists};
 }finally{
  globalThis.fetch=originalFetch;
  assert.equal(path.dirname(dir),path.resolve(tmpdir()));assert.match(path.basename(dir),/^dd-current-v4-mock-/);
  await fs.rm(evidenceFile,{force:true});await fs.rmdir(dir);
 }
}
test('actual orchestration with all transports mocked: one ordinary owner, two exact forms, confirmed logout before cleanup seam',async()=>{
 const v=await mockJourney();assert.equal(v.error,undefined);assert.equal(v.result.cleanupComplete,true);assert.equal(v.cleanupCalls,1);
 assert.equal(v.parts.length,2);assert.deepEqual(v.parts[0],v.parts[1]);assert.equal(v.identity.app_metadata.astra_staging_complete_beta_fixture.label,'student');
 assert.equal(v.calls.filter(c=>c.route==='/auth/v1/admin/users').length,1);
 assert.equal(v.calls.filter(c=>c.route==='/auth/v1/logout').length,1);
 assert.equal(v.calls.filter(c=>c.method==='DELETE'||c.method==='PATCH').length,0,'Actual API cleanup is tested independently by cleanup module');
 assert.equal(v.snapshots.at(-1).state,'complete');assert.equal(v.snapshots.at(-1).cleanupComplete,true);
 assert.doesNotMatch(JSON.stringify(v.snapshots),/normal-fixture-token|sb_secret_|mock-token-|Dd!/);
});

test('real runner and real supported-API cleanup module share a complete manifest and exact one-shot transport contract',async()=>{
 const v=await mockJourney(null,{actualCleanup:true});assert.equal(v.error,undefined);assert.equal(v.result.cleanupComplete,true);
 assert.equal(v.parts.length,2);assert.equal(v.cleanupCalls,1);assert.equal(v.authExists,false);assert.equal(v.storageExists,false);assert.equal(v.noticeExists,false);
 assert.equal(v.calls.filter(c=>c.route==='/auth/v1/logout').length,1);
 assert.equal(v.calls.filter(c=>c.method==='PATCH').length,1);
 assert.equal(v.calls.filter(c=>c.method==='DELETE').length,3);
 assert.equal(v.snapshots.at(-1).cleanup.state,'completed');assert.equal(v.snapshots.at(-1).state,'complete');
 assert.equal(v.snapshots.at(-1).cleanup.independentDatabaseReadbackRequired,true);
});
test('uncertain or invalid transitions retain exact intents; never repeat a write or cleanup',async(t)=>{
 for(const failure of ['suppression','missing-v4','create-unknown','registration','signin-unknown','public-terms','submit-unknown','claimed','paid-at','replay-drift','logout','cleanup-unknown']){
  await t.test(failure,async()=>{
   const v=await mockJourney(failure);assert.ok(v.error);assert.equal(v.result,undefined);
   assert.equal(v.cleanupCalls,failure==='cleanup-unknown'?1:0);
   assert.equal(v.snapshots.at(-1).cleanupComplete,false);assert.equal(v.snapshots.at(-1).state,'held-for-review');
   assert.ok(v.calls.filter(c=>c.route==='/auth/v1/admin/users').length<=1);
   assert.ok(v.calls.filter(c=>c.route==='/auth/v1/token').length<=1);
   assert.ok(v.calls.filter(c=>c.route==='/auth/v1/logout').length<=1);
   if(failure==='submit-unknown'){assert.equal(v.parts.length,1);assert.equal(v.snapshots.at(-1).submissionState,'requested');assert.equal(v.snapshots.at(-1).replayState,'not_requested');}
   if(failure==='create-unknown'){assert.equal(v.snapshots.at(-1).ownerId,null);assert.equal(v.snapshots.at(-1).fixtureLifecycle.fixtures[0].creationState,'requested');}
   if(failure==='registration')assert.equal(v.calls.some(c=>c.route==='/auth/v1/token'),false);
   if(failure==='public-terms')assert.equal(v.parts.length,0,'Reject changed public terms before upload');
   if(failure==='logout')assert.equal(v.snapshots.at(-1).globalSignOutState,'unknown');
   assert.doesNotMatch(JSON.stringify(v.snapshots),/normal-fixture-token|sb_secret_|mock-token-|Dd!/);
  });
 }
});

test('artifact failures cannot skip the single known-token logout or allow cleanup',async(t)=>{
 for(const failure of ['persist-session','persist-before-logout','persist-after-logout'])await t.test(failure,async()=>{
  const v=await mockJourney(failure);assert.ok(v.error);assert.equal(v.result,undefined);assert.equal(v.cleanupCalls,0);
  assert.equal(v.calls.filter(c=>c.route==='/auth/v1/logout').length,1);
  assert.equal(v.saveAttempts.at(-1).globalSignOutState,'confirmed');
  assert.equal(v.saveAttempts.at(-1).cleanupComplete,false);
  if(failure!=='persist-after-logout')assert.equal(v.saveAttempts.at(-1).artifactPersistenceFailed,true);
  assert.ok(v.saveAttempts.every(x=>x.cleanupComplete===false));
 });
});
