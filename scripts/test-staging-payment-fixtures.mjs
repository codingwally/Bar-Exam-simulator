import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createPaymentFixtureLifecycle, paymentFixtureIdentity, PAYMENT_FIXTURE_TARGET } from './staging-payment-fixtures.mjs';

const ID='10000000-0000-4000-8000-000000000001';
const OTHER='10000000-0000-4000-8000-000000000002';
const RUN='mtrra0ty-abcdef12';
const SECRET=`sb_secret_${'s'.repeat(30)}`,PUBLISHABLE=`sb_publishable_${'p'.repeat(30)}`;
const TOKEN='synthetic-normal-auth-token-not-a-real-jwt';
const source=await readFile(new URL('./test-complete-beta-staging.mjs',import.meta.url),'utf8');
const section=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};

function harness({label='student',preflight='valid',registration='valid',createOutcome='valid',signInOutcome='valid',
  wrongIdentity=false,logoutStatus=204,auditIds=[12,15],auditTotal=auditIds.length,failAuditPersist=false,
  initialAuthMissing=false,deleteConfirmed=true}={}) {
  const identity=paymentFixtureIdentity(RUN,label),calls=[],manifests=[];
  let auth=null,deleted=false;
  const response=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),
    {status,headers:{'Content-Type':'application/json',...headers}});
  const lifecycle=createPaymentFixtureLifecycle({runId:RUN,...PAYMENT_FIXTURE_TARGET,
    serviceRoleKey:SECRET,publishableKey:PUBLISHABLE,sourceSha:'a'.repeat(40),
    persist:async value=>{
      const json=JSON.stringify(value);for(const forbidden of[SECRET,TOKEN,'@','password'])assert.equal(json.includes(forbidden),false);
      if(failAuditPersist&&value.fixtures[0]?.auditCaptureState==='captured-before-auth-delete')throw Error('Local persistence failure');
      manifests.push(structuredClone(value));calls.push('persist');
    },
    request:async(url,options)=>{
      const parsed=new URL(url);assert.equal(parsed.origin,PAYMENT_FIXTURE_TARGET.supabaseUrl);
      assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.apikey,SECRET);
      if(parsed.pathname==='/rest/v1/rpc/astra_register_staging_payment_fixture'){
        const body=JSON.parse(options.body);
        if(body.p_user_id===null){
          calls.push('preflight');assert.deepEqual(body,{p_user_id:null,p_run_id:null,p_label:null});
          if(preflight==='missing')return response({code:'PGRST202'},404);
          if(preflight==='permission')return response({code:'42501'},403);
          if(preflight==='success')return response({registered:true});
          return response({code:'P0001',message:preflight==='valid'?'Staging complete-beta fixture identity is invalid':'Different denial'},400);
        }
        calls.push('register');assert.deepEqual(body,{p_user_id:ID,p_run_id:RUN,p_label:label});
        assert.equal(manifests.at(-1).fixtures[0].id,ID);assert.equal(manifests.at(-1).fixtures[0].registrationState,'requested');
        if(registration==='network')throw Error('Uncertain local registration');
        const ack={registered:true,fixtureUserId:ID,dataScope:'internal_test',registrationVersion:'astra-staging-complete-beta-v1',replayed:false};
        const changed={wrongId:{fixtureUserId:OTHER},wrongScope:{dataScope:'regular'},wrongVersion:{registrationVersion:'examinations'},
          wrongReplay:{replayed:null},wrongRegistered:{registered:false},extra:{unreviewed:true}};
        return response({...ack,...changed[registration]});
      }
      if(parsed.pathname===`/auth/v1/admin/users/${ID}`&&options.method!=='DELETE'){
        calls.push('read-auth');
        if(initialAuthMissing||(deleted&&deleteConfirmed))return response({code:'user_not_found'},404);
        return response({...auth,...(wrongIdentity?{email:'different@example.invalid'}:{})});
      }
      if(parsed.pathname==='/auth/v1/logout'){
        calls.push('logout');assert.equal(parsed.search,'?scope=global');assert.equal(options.headers.Authorization,`Bearer ${TOKEN}`);
        return response(null,logoutStatus);
      }
      if(parsed.pathname==='/rest/v1/examination_audit_log'){
        calls.push('read-audit');assert.equal(options.headers.Prefer,'count=exact');
        assert.equal(parsed.searchParams.get('or'),`(actor_user_id.eq.${ID},and(action.eq.admin_set_beta_access,resource_type.eq.examination_management,resource_id.eq.${ID},reason.eq.Complete beta staging verification ${RUN}))`);
        assert.equal(parsed.searchParams.get('select'),'id');assert.equal(parsed.searchParams.get('limit'),'501');
        return response(auditIds.map(id=>({id})),200,auditTotal===null?{}:{'Content-Range':`${auditIds.length?`0-${auditIds.length-1}`:'*'}/${auditTotal}`});
      }
      if(parsed.pathname===`/auth/v1/admin/users/${ID}`&&options.method==='DELETE'){
        calls.push('delete-auth');const record=manifests.at(-1).fixtures[0];
        assert.equal(record.auditCaptureState,'captured-before-auth-delete');assert.equal(record.cleanupState,'delete_requested');
        assert.equal(record.auditProvenance,'exact-fixture-actor-or-admin-beta-target-and-run-reason');
        assert.deepEqual(record.auditRowIds,auditIds.map(String).sort());
        assert.equal(record.classificationSource,`astra_complete_beta_staging_v1:${RUN}:${label}`);
        deleted=true;return response(null,204);
      }
      throw Error('Unexpected lifecycle operation');
    },
  });
  const jsonRequest=async(url,options)=>{
    const parsed=new URL(url);let body;
    if(parsed.pathname==='/auth/v1/admin/users'){
      calls.push('admin-create');assert.equal(manifests.at(-1).fixtures[0].creationState,'requested');
      const submitted=JSON.parse(options.body);assert.equal(submitted.email,identity.email);
      assert.deepEqual(submitted.app_metadata,identity.appMetadata);assert.equal(submitted.user_metadata.display_name,identity.displayName);
      auth={id:ID,email:identity.email,app_metadata:{provider:'email',providers:['email'],...identity.appMetadata},
        user_metadata:{display_name:identity.displayName},last_sign_in_at:null};
      if(createOutcome==='network')throw Error('Uncertain local Auth create');body={id:ID};
    }else if(parsed.pathname==='/auth/v1/token'){
      calls.push('normal-sign-in');const record=manifests.at(-1).fixtures[0];
      assert.equal(record.registrationState,'confirmed');assert.equal(record.signInState,'requested');
      assert.equal(JSON.parse(options.body).email,identity.email);auth.last_sign_in_at='2026-09-08T04:30:00Z';
      if(signInOutcome==='network')throw Error('Uncertain local sign-in');
      body={user:{id:signInOutcome==='wrongId'?OTHER:ID},access_token:TOKEN};
    }else throw Error('Unexpected creator operation');
    return {body,response:{status:200}};
  };
  const scope={assert,fixtureLifecycle:lifecycle,runId:RUN,label,createdUsers:[],createdEntryIds:[],
    SUPABASE_URL:PAYMENT_FIXTURE_TARGET.supabaseUrl,WORKER_URL:PAYMENT_FIXTURE_TARGET.workerUrl,
    PUBLISHABLE_KEY:PUBLISHABLE,serviceHeaders:{apikey:SECRET},
    randomBytes:()=>({toString:()=> 'synthetic-local-password-material'}),
    acceptCurrentTerms:async()=>{calls.push('terms');return {current_terms_version:'terms',current_privacy_version:'privacy'};},
    provisionMandatoryCommercialChoice:async()=>calls.push('profile'),
    deleteSyntheticEntry:async()=>calls.push('delete-forum'),deleteUser:id=>lifecycle.deleteUser(id),
    console:{log:()=>{}}};
  const context=createContext(scope),parse=runInContext('JSON.parse',context);
  scope.jsonRequest=async(...args)=>parse(JSON.stringify(await jsonRequest(...args)));
  const create=()=>runInContext(`${section('async function createUser(label) {','async function workerPost(')}\ncreateUser(label);`,context);
  const cleanup=()=>runInContext(`(async()=>{${section('} finally {','\nconst residue = await serviceGet(').slice('} finally {'.length).trim().slice(0,-1)}})()`,context);
  return {lifecycle,calls,manifests,scope,create,cleanup,get deleted(){return deleted;}};
}

test('strict existing complete-beta identities; no Examination, Forecast or commercial-launch reuse',()=>{
  for(const label of['student','peer']){
    const identity=paymentFixtureIdentity(RUN,label);assert.equal(identity.email,`dd-complete-beta-${label}-${RUN}@duediligence.ph`);
    assert.equal(identity.displayName,`Release ${label}`);assert.deepEqual(identity.appMetadata,{astra_staging_complete_beta_fixture:{version:1,runId:RUN,label}});
  }
  for(const label of['admin','student-a','ui-examinee','free','retry','founding','provisional'])assert.throws(()=>paymentFixtureIdentity(RUN,label));
  for(const run of[RUN+'\n',RUN.toUpperCase(),'ui-'+RUN,'astra-durable-1788800000000-abcdef12'])assert.throws(()=>paymentFixtureIdentity(run,'student'));
  assert.throws(()=>createPaymentFixtureLifecycle({runId:RUN,...PAYMENT_FIXTURE_TARGET,supabaseUrl:'https://hbllomlijfznnuudpdvr.supabase.co',serviceRoleKey:SECRET,publishableKey:PUBLISHABLE}));
});
for(const label of['student','peer'])test(`actual ${label} creator persists intent, registers, then normally signs in before terms/profile`,async()=>{
  const h=harness({label});await h.lifecycle.preflight();await h.create();
  assert.deepEqual(h.calls.filter(x=>x!=='persist'),['preflight','admin-create','register','normal-sign-in','terms','profile']);
  assert.deepEqual(h.scope.createdUsers,[ID]);assert.equal(h.manifests.at(-1).fixtures[0].signInState,'confirmed');
});
for(const preflight of['missing','permission','success','wrong'])test(`preflight ${preflight} fails before Auth or existing Beta setup`,async()=>{
  const h=harness({preflight});await assert.rejects(()=>h.lifecycle.preflight());await assert.rejects(()=>h.create());
  assert.equal(h.calls.includes('admin-create'),false);assert.equal(h.calls.includes('normal-sign-in'),false);
});
for(const registration of['network','wrongId','wrongScope','wrongVersion','wrongReplay','wrongRegistered','extra'])test(`registration ${registration} retains exact UUID and blocks normal Auth`,async()=>{
  const h=harness({registration});await h.lifecycle.preflight();await assert.rejects(()=>h.create());
  assert.equal(h.manifests.at(-1).fixtures[0].id,ID);assert.equal(h.calls.includes('normal-sign-in'),false);
  await assert.rejects(()=>h.create());assert.equal(h.calls.filter(x=>x==='admin-create').length,1);
  await h.cleanup();assert.equal(h.manifests.at(-1).cleanupComplete,true);
});
test('actual cleanup logs out, retains exact fixture and existing-admin audit IDs, deletes only recorded Auth',async()=>{
  const h=harness();await h.lifecycle.preflight();await h.create();h.scope.createdEntryIds.push('synthetic-entry');await h.cleanup();
  const calls=h.calls.filter(x=>x!=='persist');assert.ok(calls.indexOf('read-auth')<calls.indexOf('delete-forum'));
  assert.ok(calls.indexOf('logout')<calls.indexOf('read-audit'));assert.ok(calls.indexOf('read-audit')<calls.indexOf('delete-auth'));
  const manifest=h.manifests.at(-1);assert.equal(manifest.cleanupComplete,true);assert.deepEqual(manifest.fixtures[0].auditRowIds,['12','15']);
  assert.equal(manifest.independentDatabaseReadbackRequired,true);assert.match(manifest.examinationAudit,/not-frozen-data-scope/);
  assert.equal(calls.some(x=>/delete-audit|delete-pulse|admin-promote/u.test(x)),false);
});
for(const options of[{wrongIdentity:true},{initialAuthMissing:true},{logoutStatus:401},{logoutStatus:403},
  {auditTotal:null},{auditTotal:3},{auditIds:Array.from({length:501},(_,n)=>n+1)},
  {auditIds:[Number.MAX_SAFE_INTEGER+1]},{auditIds:[12,12]},{failAuditPersist:true}])test(`unsafe cleanup remains incomplete: ${JSON.stringify(options).slice(0,80)}`,async()=>{
  const h=harness(options);await h.lifecycle.preflight();await h.create();await assert.rejects(()=>h.cleanup());
  assert.equal(h.deleted,false);assert.equal(h.manifests.at(-1).cleanupComplete,false);
});
test('Auth deletion needs authoritative absence, not merely a successful DELETE response',async()=>{
  const h=harness({deleteConfirmed:false});await h.lifecycle.preflight();await h.create();await assert.rejects(()=>h.cleanup());
  assert.equal(h.deleted,true);assert.equal(h.manifests.at(-1).cleanupComplete,false);
  assert.equal(h.manifests.at(-1).fixtures[0].cleanupState,'delete_requested');
});
test('uncertain Auth creation retains an unresolved intent without repeat creation or guessed deletion',async()=>{
  const h=harness({createOutcome:'network'});await h.lifecycle.preflight();await assert.rejects(()=>h.create());await assert.rejects(()=>h.create());
  await assert.rejects(()=>h.cleanup());assert.equal(h.calls.filter(x=>x==='admin-create').length,1);assert.equal(h.deleted,false);
  assert.equal(h.manifests.at(-1).fixtures[0].id,null);assert.equal(h.manifests.at(-1).cleanupComplete,false);
});
for(const signInOutcome of['network','wrongId'])test(`uncertain normal Auth ${signInOutcome} does not pretend sessions were revoked`,async()=>{
  const h=harness({signInOutcome});await h.lifecycle.preflight();await assert.rejects(()=>h.create());await assert.rejects(()=>h.cleanup());
  assert.equal(h.deleted,false);assert.equal(h.calls.includes('logout'),false);assert.equal(h.manifests.at(-1).cleanupComplete,false);
});
test('source scope: preflight before users/Beta grants; existing administrator and product paths unchanged',async()=>{
  assert.ok(source.indexOf('  await fixtureLifecycle.preflight();')<source.indexOf("  const student = await createUser('student');"));
  assert.ok(source.indexOf("  const peer = await createUser('peer');")<source.indexOf('  await grantBetaAccess(actorUserId, student.id);'));
  assert.ok(source.includes("'/rest/v1/user_roles?role=eq.super_admin&select=user_id&order=created_at.asc&limit=1'"));
  assert.ok(source.includes('p_actor_user_id: actorUserId'));assert.ok(source.includes('reason: `Complete beta staging verification ${runId}`'));
  const helper=await readFile(new URL('./staging-payment-fixtures.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/astra_register_staging_(?:forecast|examination)_fixture|\/auth\/v1\/signup|promotionIntent|from.*staging-examination-fixtures/u);
  assert.doesNotMatch(source,/examination_audit_log.*DELETE|admin_pulse_events.*DELETE/u);
  assert.match(harness().lifecycle.manifestPath,/artifacts[\\/]staging-e2e[\\/]complete-beta-[a-z0-9-]+-cleanup-manifest\.json$/u);
});
