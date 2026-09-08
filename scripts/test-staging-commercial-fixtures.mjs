import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createCommercialFixtureLifecycle, commercialFixtureIdentity,
  exactCommercialRowFilter, assertCommercialPayment } from './staging-commercial-fixtures.mjs';
import { COMMERCIAL_STAGE, createCommercialSuppressionVerifier } from './staging-commercial-suppression.mjs';

const ID='10000000-0000-4000-8000-000000000001',PAY='20000000-0000-4000-8000-000000000001';
const NOTICE='30000000-0000-4000-8000-000000000001',RUN='mtrra0ty-abcdef12',SHA='a'.repeat(40);
const SECRET=`sb_secret_${'s'.repeat(30)}`,PUBLIC=`sb_publishable_${'p'.repeat(30)}`,TOKEN='synthetic-session-private';
const hash=value=>createHash('sha256').update(value).digest('hex');
const response=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const fullRows=rows=>response(rows,200,{'Content-Range':`${rows.length?`0-${rows.length-1}`:'*'}/${rows.length}`});
const payload=()=>({p_user_id:ID,p_plan_version_id:'40000000-0000-4000-8000-000000000001',
  p_payment_channel_version_id:'50000000-0000-4000-8000-000000000001',p_payment_date:'2026-09-08',
  p_payment_reference:`SYNTH-${RUN}`,p_proof_bucket:'payment-proofs',p_proof_path:`${ID}/${PAY}.png`,
  p_proof_mime_type:'image/png',p_proof_size_bytes:1024,p_proof_sha256:hash(`payment-${RUN}`)});
function paymentRow(p=payload()) {
  const row={id:PAY,status:'pending',version:1,updated_at:'2026-09-08T07:00:00Z',
    verification_email_status:'pending',verification_email_attempts:0,verification_email_last_attempt_at:null,
    verification_email_provider_id:null,verification_email_sent_at:null,verification_email_error:null,
    reviewed_at:null,reviewed_by:null,review_reason:null,subscription_id:null,paid_at:null,paid_at_verified_by:null,
    paid_at_verified_at:null,paid_at_verification_source:null,approved_activation_at:null,approved_prior_subscription_state:null,
    subscriber_receipt_status:'pending',subscriber_receipt_attempts:0,subscriber_receipt_provider_id:null,
    subscriber_receipt_error:null,subscriber_receipt_last_attempt_at:null,subscriber_receipt_sent_at:null};
  for(const [column,input] of Object.entries({user_id:'p_user_id',pricing_plan_version_id:'p_plan_version_id',
    pricing_payment_channel_version_id:'p_payment_channel_version_id',payment_date:'p_payment_date',transaction_reference:'p_payment_reference',
    proof_bucket:'p_proof_bucket',proof_object_path:'p_proof_path',proof_mime_type:'p_proof_mime_type',proof_size_bytes:'p_proof_size_bytes',proof_sha256:'p_proof_sha256'})) row[column]=p[input];
  return row;
}
// PostgREST pRequestFilter uses pOpExpr pSingleVal: the decoded top-level eq
// operand is the entire remainder, without quoted-list/logic-tree unescaping.
// Deliberately independent of the production encoder, including every row key.
function assertExactTopLevelFilter(params,row) {
  assert.deepEqual([...params.keys()].filter(key=>key!=='select').sort(),Object.keys(row).sort());
  for(const [key,value] of Object.entries(row)) {
    const filter=params.get(key);
    if(value===null){assert.equal(filter,'is.null');continue;}
    assert.ok(filter?.startsWith('eq.'));
    assert.equal(filter.slice(3),String(value));
  }
}
function harness(options={}) {
  const label=options.label||'provisional',identity=commercialFixtureIdentity(RUN,label),calls=[],manifests=[];
  let auth=null,payment=null,notices=[],invites=[],deleted=false,history=[];
  const current=()=>manifests.at(-1)?.fixtures[0];
  const lifecycle=createCommercialFixtureLifecycle({runId:RUN,...COMMERCIAL_STAGE,serviceRoleKey:SECRET,publishableKey:PUBLIC,
    sourceSha:SHA,verifySuppression:async()=>{calls.push('suppression');if(options.suppressionFail)throw Error('secret-body');return {versionId:PAY};},
    persist:async value=>{
      for(const secret of[SECRET,TOKEN,'password'])assert.equal(JSON.stringify(value).includes(secret),false);
      if(options.persistFailure?.(value))throw Error('private local failure');
      manifests.push(structuredClone(value));calls.push('persist');
    },request:async(url,opts)=>{
      const u=new URL(url),body=opts.body?JSON.parse(opts.body):null,method=opts.method||'GET';
      assert.equal(u.origin,COMMERCIAL_STAGE.supabaseUrl);assert.equal(opts.redirect,'error');assert.ok(opts.signal instanceof AbortSignal);
      calls.push(`${method} ${u.pathname}`);
      if(u.pathname==='/auth/v1/admin/users'&&method==='POST'){
        assert.equal(current().creationState,'requested');assert.equal(current().id,null);
        assert.deepEqual(body.app_metadata,identity.appMetadata);assert.equal(body.email,identity.email);
        auth={id:ID,email:identity.email,role:'authenticated',aud:'authenticated',last_sign_in_at:null,
          app_metadata:{provider:'email',providers:['email'],...identity.appMetadata},user_metadata:{display_name:identity.displayName}};
        if(options.createUnknown)throw Error('private password secret');return response(auth,201);
      }
      if(u.pathname==='/rest/v1/rpc/astra_register_staging_commercial_fixture'){
        if(body.p_user_id===null)return response({code:options.preflightWrong?'42501':'P0001',message:'Staging commercial fixture identity is invalid'},400);
        assert.equal(current().creationState,'recorded');assert.equal(current().registrationState,'requested');
        if(options.registrationUnknown)throw Error('private SQL');
        return response({registered:true,fixtureUserId:ID,dataScope:options.registrationWrong?'regular':'internal_test',registrationVersion:'astra-staging-commercial-v1',replayed:false});
      }
      if(u.pathname==='/auth/v1/token'){
        assert.equal(current().registrationState,'confirmed');assert.equal(current().signInState,'requested');
        assert.equal(opts.headers.apikey,PUBLIC);auth.last_sign_in_at='2026-09-08T07:00:00Z';
        if(options.signInUnknown)throw Error('private token');return response({user:{id:options.signInWrong?PAY:ID},access_token:TOKEN});
      }
      if(u.pathname===`/auth/v1/admin/users/${ID}`&&method==='GET')return deleted&&!options.auth404Missing
        ?response({},404):response({...auth,...(options.identityDrift?{email:'private-customer@example.invalid'}:{})});
      if(u.pathname==='/auth/v1/logout'){
        assert.equal(u.search,'?scope=global');assert.equal(opts.headers.Authorization,`Bearer ${TOKEN}`);
        return response(null,options.logoutFailure?403:204);
      }
      if(u.pathname===`/auth/v1/admin/users/${ID}`&&method==='DELETE'){
        assert.equal(current().signOutState,'confirmed');assert.equal(current().auditCaptureState,'captured-before-auth-delete');
        assert.equal(current().cleanupState,'delete_requested');assert.equal(notices.length,0);assert.equal(invites.length,0);
        if(payment)assert.equal(payment.verification_email_status,'suppressed');
        deleted=true;payment=null;history=[];return response(null,204);
      }
      if(u.pathname==='/rest/v1/payment_requests'&&method==='PATCH'){
        assert.equal(current().payment.fenceState,'requested');assert.ok(current().payment.before);
        assert.deepEqual(body,{verification_email_status:'suppressed'});
        assertExactTopLevelFilter(u.searchParams,payment);
        if(options.claimWins){payment.verification_email_status='sending';payment.verification_email_attempts=1;return response([]);}
        payment.verification_email_status='suppressed';
        if(options.casUnknown)throw Error('unknown CAS outcome');return response([payment]);
      }
      if(u.pathname==='/rest/v1/outbound_notifications'&&method==='DELETE'){
        assert.equal(payment.verification_email_status,'suppressed');
        assertExactTopLevelFilter(u.searchParams,notices[0]);
        if(options.noticeDrift)return response([]);const old=notices;notices=[];return response(old);
      }
      if(u.pathname==='/rest/v1/founding_beta_invites'&&method==='DELETE'){
        assertExactTopLevelFilter(u.searchParams,invites[0]);
        if(options.inviteDrift)return response([]);const old=invites;invites=[];return response(old);
      }
      if(u.pathname.startsWith('/rest/v1/')&&method==='GET'){
        assert.equal(opts.headers.Prefer,'count=exact');assert.equal(u.searchParams.get('limit'),'101');
        const table=u.pathname.slice('/rest/v1/'.length);
        const data={user_roles:[{user_id:ID,role:options.roleDrift?'admin':'student'}],admin_capabilities:[],subscriptions:[],refund_requests:[],
          examination_beta_access:[],payment_requests:payment?[payment]:[],payment_request_history:history,
          outbound_notifications:notices,founding_beta_invites:invites,grade_reservations:[],examination_audit_log:options.auditBad?[{id:1},{id:1}]:[{id:12}]};
        assert.ok(table in data,`Unexpected table ${table}`);
        if(options.discoveryFailure===table)throw Error('unknown discovery');
        if(options.incomplete===table)return response(data[table],200,{'Content-Range':'0-0/1000'});
        return fullRows(data[table]);
      }
      throw Error('Unexpected synthetic transport operation');
    }});
  async function start(){await lifecycle.preflight();return lifecycle.createUser(label);}
  async function addPayment({unknown=false,drift={}}={}) {
    const p=payload();await lifecycle.beforePayment(p);payment={...paymentRow(p),...drift};
    history=[{id:NOTICE,payment_request_id:PAY,actor_user_id:ID,action:'submitted',previous_status:null,new_status:'pending',metadata:{synthetic:true}}];
    notices=[{id:NOTICE,notification_type:'payment_submitted',related_resource_type:'payment_request',related_resource_id:PAY,
      recipient_mailbox:'premium@duediligence.ph',subject:'Due Diligence plan payment verification request',
      secure_admin_path:`/admin/payments?request=${PAY}`,status:'queued',attempts:0,last_attempt_at:null,sent_at:null,failure_code:null}];
    if(!unknown)await lifecycle.recordPayment(ID,PAY);
  }
  async function addInvite({unknown=false}={}) {
    const inviteHash=hash(identity.email),expiresAt='2026-09-09T07:00:00Z';
    await lifecycle.beforeInvite(ID,inviteHash,expiresAt);
    invites=[{email_hash:inviteHash,access_ends_at:expiresAt,status:'claimed',claimed_user_id:ID,claimed_at:'2026-09-08T07:00:00Z'}];
    if(!unknown)await lifecycle.recordInvite(ID);
  }
  return {lifecycle,start,addPayment,addInvite,calls,manifests,get deleted(){return deleted;},get payment(){return payment;}};
}

test('only four honest commercial labels and exact staging target',()=>{
  for(const label of['free','retry','founding','provisional'])assert.equal(commercialFixtureIdentity(RUN,label).displayName,`Commercial ${label}`);
  for(const label of['student','peer','admin','member'])assert.throws(()=>commercialFixtureIdentity(RUN,label));
  for(const run of[RUN+'\n',RUN.toUpperCase(),'astra-durable-'+RUN])assert.throws(()=>commercialFixtureIdentity(run,'free'));
  assert.throws(()=>createCommercialFixtureLifecycle({runId:RUN,...COMMERCIAL_STAGE,supabaseUrl:'https://hbllomlijfznnuudpdvr.supabase.co'}));
});
for(const label of['free','retry','founding','provisional'])test(`${label}: durable intent then trusted registration then signin; global logout before exact Auth404`,async()=>{
  const h=harness({label});await h.start();if(label==='founding')await h.addInvite();if(label==='provisional')await h.addPayment();await h.lifecycle.cleanup();
  const calls=h.calls.filter(x=>x!=='persist');
  assert.ok(calls.indexOf('POST /auth/v1/admin/users')<calls.lastIndexOf('POST /rest/v1/rpc/astra_register_staging_commercial_fixture'));
  assert.ok(calls.lastIndexOf('POST /rest/v1/rpc/astra_register_staging_commercial_fixture')<calls.indexOf('POST /auth/v1/token'));
  assert.ok(calls.indexOf('POST /auth/v1/logout')<calls.indexOf(`DELETE /auth/v1/admin/users/${ID}`));
  assert.equal(h.manifests.at(-1).cleanupComplete,true);assert.equal(h.manifests.at(-1).independentDatabaseReadbackRequired,true);
  assert.equal(h.manifests.at(-1).fixtures[0].classificationSource,`astra_commercial_staging_v1:${RUN}:${label}`);
  assert.equal(h.calls.some(x=>/DELETE.*(?:audit|pulse)|phase4_claim_payment_notification/.test(x)),false);
});
for(const options of[{suppressionFail:true},{preflightWrong:true},{createUnknown:true},{registrationUnknown:true},
  {registrationWrong:true},{signInUnknown:true},{signInWrong:true}])test(`creation uncertainty never retries or guesses deletion ${JSON.stringify(options)}`,async()=>{
  const h=harness(options);await assert.rejects(()=>h.start());await assert.rejects(()=>h.lifecycle.createUser('provisional'));
  try{await h.lifecycle.cleanup();}catch{}
  assert.equal(h.deleted,false);assert.ok(h.calls.filter(x=>x==='POST /auth/v1/admin/users').length<=1);
});
for(const options of[{identityDrift:true},{roleDrift:true},{logoutFailure:true},{auditBad:true},
  {discoveryFailure:'payment_requests'},{incomplete:'payment_requests'},
  {persistFailure:v=>v.fixtures[0]?.cleanupState==='delete_requested'}])test(`unsafe cleanup holds owner ${JSON.stringify(options)}`,async()=>{
  const h=harness(options);await h.start();await assert.rejects(()=>h.lifecycle.cleanup());assert.equal(h.deleted,false);
  assert.equal(h.manifests.at(-1).cleanupComplete,false);
});
test('successful DELETE without authoritative Auth404 is not cleanup completion',async()=>{
  const h=harness({auth404Missing:true});await h.start();await assert.rejects(()=>h.lifecycle.cleanup());
  assert.equal(h.deleted,true);assert.equal(h.manifests.at(-1).cleanupComplete,false);
});
for(const drift of[{verification_email_status:'sending'},{verification_email_status:'failed'},
  {verification_email_status:'sent'},{verification_email_status:'suppressed'},{verification_email_attempts:1},
  {verification_email_last_attempt_at:'2026-09-08T07:01:00Z'},{verification_email_provider_id:'provider-private'},
  {subscriber_receipt_attempts:1},{paid_at:'2026-09-08T06:00:00Z'},{approved_duration_days:30},{status:'approved'},
  {proof_sha256:'f'.repeat(64)}])test(`non-never-claimed or changed payment retained ${Object.keys(drift)[0]}`,async()=>{
  const h=harness();await h.start();await h.addPayment({drift});await assert.rejects(()=>h.lifecycle.cleanup());
  assert.equal(h.deleted,false);assert.equal(h.calls.some(x=>x.startsWith('DELETE')),false);
});
for(const options of[{claimWins:true},{casUnknown:true},{noticeDrift:true},{discoveryFailure:'outbound_notifications'}])test(`CAS/cleanup uncertainty stops destructive continuation ${JSON.stringify(options)}`,async()=>{
  const h=harness(options);await h.start();await h.addPayment();await assert.rejects(()=>h.lifecycle.cleanup());
  assert.equal(h.deleted,false);assert.equal(h.manifests.at(-1).cleanupComplete,false);
});
test('lost payment response retains exact payload intent without guessing returned ID',async()=>{
  const h=harness();await h.start();await h.addPayment({unknown:true});await assert.rejects(()=>h.lifecycle.cleanup());
  assert.equal(h.deleted,false);assert.equal(h.manifests.at(-1).fixtures[0].payment.state,'requested');
});
for(const options of[{unknown:true},{inviteDrift:true}])test(`invite uncertainty blocks owner cascade ${JSON.stringify(options)}`,async()=>{
  const h=harness({label:'founding',...options});await h.start();await h.addInvite(options);await assert.rejects(()=>h.lifecycle.cleanup());assert.equal(h.deleted,false);
});
test('CAS filter encodes literals rather than widening the PostgREST predicate',()=>{
  const value='quoted "string",or(id.not.is.null)\\x&active=eq.true+%\nUnicode: \u03b1';
  const row={id:ID,note:value,attempts:0,decimal:1.25,negative:-1,active:true,disabled:false,
    timestamp:'2026-09-08T08:00:00.123456+00:00',empty:null,blank:''};
  const encoded=exactCommercialRowFilter(row),decoded=new URLSearchParams(encoded.toString());
  assert.equal(decoded.get('note'),`eq.${value}`);assert.equal(decoded.size,Object.keys(row).length);
  assertExactTopLevelFilter(decoded,row);
  assert.throws(()=>exactCommercialRowFilter({'id.or':ID}));
  for(const value of[{unreviewed:true},[],undefined,NaN,Infinity,-Infinity])assert.throws(()=>exactCommercialRowFilter({unknown:value}));
  assertCommercialPayment(paymentRow(),payload());
});
test('top-level grammar rejects the old artificially quoted UUID, text and numeric operands',()=>{
  for(const value of[ID,'pending',0,true]){
    const params=new URLSearchParams({value:`eq."${value}"`});
    assert.throws(()=>assertExactTopLevelFilter(new URLSearchParams(params.toString()),{value}));
  }
});

const commercialSource=(await readFile(new URL('../worker/commercial-entry.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function suppressionHarness(change={}) {
  const evidence={schemaVersion:1,kind:'protected-workflow-worker-deployment',sourceSha:SHA,
    provenance:'wrangler-version-cloudflare-deployment-message-v1',wranglerVersion:'4.114.0',wranglerOutputSha256:'a'.repeat(64),
    workflowRunAttempt:'1',deploymentMessage:`astra-commercial-stage:34194950298:1:${SHA}`,
    accountId:COMMERCIAL_STAGE.accountId,workerName:COMMERCIAL_STAGE.workerName,workflowRunId:'34194950298',deploymentId:ID,
    versionId:PAY,commercialEntryLfSha256:hash(commercialSource),...change.evidence};
  const calls=[];let deployments=0;
  const verify=createCommercialSuppressionVerifier({evidence,sourceSha:SHA,sourceText:change.source||commercialSource,
    apiToken:'private-cloudflare-token-that-never-leaks',request:async(url,opts)=>{
      calls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
      assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${COMMERCIAL_STAGE.accountId}/workers/scripts/${COMMERCIAL_STAGE.workerName}/`));
      const deployment={id:change.deploymentId||ID,created_on:'2026-09-08T07:00:00Z',versions:change.versions||[{version_id:PAY,percentage:100}],
        annotations:{'workers/message':`astra-commercial-stage:34194950298:1:${SHA}`}};
      if(url.endsWith('/deployments')){deployments++;if(change.changed&&deployments===2)deployment.id=NOTICE;return response({success:true,result:{deployments:[deployment]}});}
      return response({success:true,result:{id:change.versionId||PAY,resources:{bindings:change.bindings||[
        {name:'SUPABASE_URL',type:'plain_text',text:COMMERCIAL_STAGE.supabaseUrl}]}}},change.status||200);
    }});
  return {verify,calls};
}
test('actual deployment and immutable-version reads prove explicit/default suppression; source alone is insufficient',async()=>{
  for(const bindings of[undefined,[{name:'SUPABASE_URL',type:'plain_text',text:COMMERCIAL_STAGE.supabaseUrl},
    {name:'PAYMENT_NOTIFICATION_EMAIL_MODE',type:'plain_text',text:'suppressed'}]]){
    const h=suppressionHarness({bindings});const result=await h.verify();assert.equal(result.paymentNotificationMode,'suppressed');
    assert.equal(h.calls.length,3);assert.equal(result.deployedBundleBytesIndependentlyCompared,false);
  }
});
for(const change of[{status:403},{deploymentId:NOTICE},{versionId:NOTICE},{changed:true},
  {versions:[{version_id:PAY,percentage:50},{version_id:NOTICE,percentage:50}]},
  ...['enabled','',null,'unknown'].map(text=>({bindings:[{name:'SUPABASE_URL',type:'plain_text',text:COMMERCIAL_STAGE.supabaseUrl},
    {name:'PAYMENT_NOTIFICATION_EMAIL_MODE',type:'plain_text',text}]})),
  {bindings:[{name:'SUPABASE_URL',type:'secret_text'}]},
  {bindings:[{name:'SUPABASE_URL',type:'plain_text',text:COMMERCIAL_STAGE.supabaseUrl},{name:'PAYMENT_NOTIFICATION_EMAIL_MODE',type:'secret_text'}]},
  {bindings:[{name:'SUPABASE_URL',type:'plain_text',text:'https://hbllomlijfznnuudpdvr.supabase.co'}]}])test(`deployed suppression rejects drift/unreadable bindings ${JSON.stringify(change).slice(0,90)}`,async()=>{
  const h=suppressionHarness(change);await assert.rejects(()=>h.verify(),error=>!error.message.includes('private-cloudflare'));
});
test('deployment evidence must pin workflow identity, source SHA/hash and exact default implementation',()=>{
  for(const evidence of[{sourceSha:'b'.repeat(40)},{commercialEntryLfSha256:'f'.repeat(64)},{kind:'manual-safe-checkbox'},
    {workflowRunId:null},{accountId:'wrong'}])assert.throws(()=>suppressionHarness({evidence}));
  assert.throws(()=>suppressionHarness({source:commercialSource.replace("|| 'suppressed'","|| 'enabled'")}));
});
test('actual smoke keeps every business assertion and v2 input; plumbing alone changes',async()=>{
  const source=(await readFile(new URL('./test-commercial-launch-staging.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const old=execFileSync('git',['show','50e69e972fdd2ad958475ca5cc913e6b0770d027:scripts/test-commercial-launch-staging.mjs'],{encoding:'utf8'}).replaceAll('\r\n','\n');
  const capture=s=>s.match(/    const paymentPayload = \{[\s\S]+?\n    \};/u)[0];assert.equal(capture(source),capture(old));
  const policy=s=>s.slice(s.indexOf('async function verifySoftLaunchStaging()'),s.indexOf('\nlet outcome;'));
  assert.equal(policy(source),policy(old));
  for(const line of old.split('\n').map(x=>x.trim()).filter(x=>x.startsWith('assert.')&&!x.includes('session.access_token')))
    assert.ok(source.includes(line),`Original assertion removed: ${line}`);
  assert.ok(source.indexOf('await fixtures.preflight()')<source.indexOf("await createUser('free')"));
  assert.ok(source.indexOf('await fixtures.beforePayment(paymentPayload)')<source.indexOf("await serviceRpc('phase4_create_payment_request_v2', paymentPayload)"));
  assert.doesNotMatch(source,/createdNotificationIds|async function deleteUser|PAYMENT_NOTIFICATION_EMAIL_MODE\s*=/u);
});
