import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createExaminationFixtureLifecycle, examinationFixtureIdentity, EXAMINATION_FIXTURE_TARGET } from './staging-examination-fixtures.mjs';

const ID='10000000-0000-4000-8000-000000000001';
const OTHER='10000000-0000-4000-8000-000000000002';
const RUN='mtrra0ty-abcdef12';
const SECRET=`sb_secret_${'s'.repeat(30)}`;
const PUBLISHABLE=`sb_publishable_${'p'.repeat(30)}`;
const TOKEN='synthetic-normal-auth-token-not-a-real-jwt';
const apiSource=await readFile(new URL('./test-examinations-staging.mjs',import.meta.url),'utf8');
const uiSource=await readFile(new URL('./test-examinations-staging-ui.mjs',import.meta.url),'utf8');
function section(source,start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a);return source.slice(a,b);
}
function harness({suite='examinations-api',label='student-a',preflight='valid',registration='valid',
  auditIds=[12,15],auditTotal=auditIds.length,wrongIdentity=false,logoutStatus=204,failAuditPersist=false}={}) {
  const runId=suite==='examinations-ui'?`ui-${RUN}`:RUN;
  const identity=examinationFixtureIdentity(suite,runId,label);
  const calls=[],manifests=[];let auth=null;let role='student';let deleted=false;
  const response=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
  const lifecycle=createExaminationFixtureLifecycle({suite,runId,
    supabaseUrl:EXAMINATION_FIXTURE_TARGET.supabaseUrl,workerUrl:EXAMINATION_FIXTURE_TARGET.workerUrl,
    serviceRoleKey:SECRET,publishableKey:PUBLISHABLE,sourceSha:'a'.repeat(40),
    persist:async value=>{
      assert.equal(JSON.stringify(value).includes(SECRET),false);assert.equal(JSON.stringify(value).includes(TOKEN),false);
      assert.equal(JSON.stringify(value).includes('@'),false);assert.equal(JSON.stringify(value).includes('password'),false);
      if(failAuditPersist&&value.fixtures[0]?.auditCaptureState==='captured-before-auth-delete') throw Error('Local manifest persistence failure');
      manifests.push(structuredClone(value));calls.push('persist');
    },
    request:async(url,options)=>{
      assert.equal(new URL(url).origin,EXAMINATION_FIXTURE_TARGET.supabaseUrl);
      assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      const route=new URL(url).pathname;
      if(route==='/rest/v1/rpc/astra_register_staging_examination_fixture') {
        const body=JSON.parse(options.body);
        if(body.p_user_id===null){
          calls.push('preflight');assert.deepEqual(body,{p_user_id:null,p_suite:null,p_run_id:null,p_label:null});
          if(preflight==='missing') return response({code:'PGRST202'},404);
          if(preflight==='permission') return response({code:'42501'},403);
          if(preflight==='success') return response({registered:true});
          return response({code:'P0001',message:preflight==='valid'?'Staging examination fixture identity is invalid':'Wrong denial'},400);
        }
        calls.push('register');assert.deepEqual(body,{p_user_id:ID,p_suite:suite,p_run_id:runId,p_label:label});
        assert.equal(manifests.at(-1).fixtures[0].id,ID);
        assert.equal(manifests.at(-1).fixtures[0].registrationState,'requested');
        if(registration==='network') throw Error('Local uncertain transport');
        const ack={registered:true,fixtureUserId:ID,dataScope:'internal_test',registrationVersion:'astra-staging-examination-v1',replayed:false};
        const deltas={wrongId:{fixtureUserId:OTHER},wrongScope:{dataScope:'regular'},wrongVersion:{registrationVersion:'forecast'},
          wrongReplay:{replayed:null},wrongRegistered:{registered:false},extra:{unreviewed:true}};
        return response({...ack,...deltas[registration]});
      }
      if(route===`/auth/v1/admin/users/${ID}`&&options.method!=='DELETE') {
        calls.push('read-auth');return auth&&!deleted?response({...auth,...(wrongIdentity?{email:'other@example.invalid'}:{})}):response({code:'user_not_found'},404);
      }
      if(route==='/auth/v1/logout') {
        calls.push('logout');assert.equal(new URL(url).search,'?scope=global');
        assert.equal(options.headers.Authorization,`Bearer ${TOKEN}`);
        return response(null,logoutStatus);
      }
      if(route==='/rest/v1/examination_audit_log') {
        calls.push('read-audit');const parsed=new URL(url);
        assert.equal(parsed.searchParams.get('actor_user_id'),`eq.${ID}`);
        assert.equal(parsed.searchParams.get('select'),'id');assert.equal(parsed.searchParams.get('limit'),'501');
        assert.equal(options.headers.Prefer,'count=exact');
        return response(auditIds.map(id=>({id})),200,auditTotal===null?{}:{'Content-Range':`${auditIds.length?`0-${auditIds.length-1}`:'*'}/${auditTotal}`});
      }
      if(route===`/auth/v1/admin/users/${ID}`&&options.method==='DELETE') {
        calls.push('delete-auth');
        const record=manifests.at(-1).fixtures[0];
        assert.equal(record.auditCaptureState,'captured-before-auth-delete');
        assert.equal(record.cleanupState,'delete_requested');assert.deepEqual(record.auditRowIds,auditIds.map(String).sort());
        assert.equal(record.classificationSource,`astra_examinations_staging_v1:${suite}:${runId}:${label}`);
        deleted=true;return response(null,204);
      }
      throw Error('Unexpected lifecycle operation');
    },
  });
  async function jsonRequest(url,options={}) {
    const route=new URL(url).pathname;let body;
    if(route==='/auth/v1/admin/users') {
      calls.push('admin-create');assert.equal(manifests.at(-1).fixtures[0].creationState,'requested');
      const submitted=JSON.parse(options.body);assert.deepEqual(submitted.app_metadata,identity.appMetadata);
      assert.equal(submitted.email,identity.email);assert.equal(submitted.user_metadata.full_name,identity.fullName);
      auth={id:ID,email:identity.email,app_metadata:{provider:'email',providers:['email'],...identity.appMetadata},
        user_metadata:{full_name:identity.fullName},last_sign_in_at:null};body={id:ID};
    } else if(route==='/auth/v1/token') {
      calls.push('normal-sign-in');const record=manifests.at(-1).fixtures[0];
      assert.equal(record.registrationState,'confirmed');assert.equal(record.signInState,'requested');
      assert.equal(JSON.parse(options.body).email,identity.email);
      auth.last_sign_in_at='2026-09-07T23:00:00Z';body={user:{id:ID},access_token:TOKEN};
    } else if(route==='/rest/v1/user_roles') {
      if(options.method==='PATCH') {
        calls.push('promote');assert.equal(manifests.at(-1).fixtures[0].registrationState,'confirmed');
        assert.equal(manifests.at(-1).fixtures[0].promotionIntent,'super_admin');
        role=JSON.parse(options.body).role;assert.equal(role,'super_admin');body=null;
      } else body=[{role}];
    } else if(route==='/beta/access/accept-terms') {
      calls.push('terms');body={acceptance:{termsVersion:'terms-commercial-v1-2026-08-18',privacyVersion:'privacy-commercial-v1-2026-08-18'}};
    } else throw Error('Unexpected actual creator operation');
    return suite==='examinations-api'?{body,response:{status:200}}:body;
  }
  const scope={assert,fixtureLifecycle:lifecycle,runId,label,email:identity.email,password:'synthetic-local-password',
    userId:null,createdUsers:[],SUPABASE_URL:EXAMINATION_FIXTURE_TARGET.supabaseUrl,
    WORKER_URL:EXAMINATION_FIXTURE_TARGET.workerUrl,SERVICE_ROLE_KEY:SECRET,PUBLISHABLE_KEY:PUBLISHABLE,
    serviceHeaders:{apikey:SECRET},jsonRequest,
    randomBytes:()=>({toString:()=> 'synthetic-local-password-material'}),
    acceptCurrentTerms:async()=>{calls.push('terms');return {current_terms_version:'terms',current_privacy_version:'privacy'};},
    provisionMandatoryCommercialChoice:async()=>calls.push('profile'),completeMandatoryCommercialProfile:async()=>calls.push('profile')};
  const context=createContext(scope);
  const parseInContext=runInContext('JSON.parse',context);
  // Real response.json() creates objects in the caller's realm. Preserve that
  // boundary so the shipped UI's deepStrictEqual role check runs unchanged.
  scope.jsonRequest=async(...args)=>parseInContext(JSON.stringify(await jsonRequest(...args)));
  const create=()=>runInContext(suite==='examinations-api'
    ? `${section(apiSource,'async function createUser(label) {','async function grantFoundingBetaAccess(')}\ncreateUser(label);`
    : `${section(uiSource,'async function createDisposableUser() {','async function prepareDisposableCommercialProfile(')}\ncreateDisposableUser();`,context);
  const uiSignIn=()=>runInContext(`${section(uiSource,'async function prepareDisposableCommercialProfile() {','async function enableCommercialLegalVersions(')}\nprepareDisposableCommercialProfile();`,context);
  const promote=()=>runInContext(`${section(apiSource,'async function grantSyntheticSuperAdmin(userId) {','async function deleteSyntheticExam(')}\ngrantSyntheticSuperAdmin('${ID}');`,context);
  return {lifecycle,create,uiSignIn,promote,calls,manifests,scope,get deleted(){return deleted;}};
}

test('hard target and honest exact fixture labels are checked without network calls',()=>{
  for(const [suite,label] of [['examinations-api','admin'],['examinations-api','student-a'],['examinations-api','student-b'],['examinations-ui','ui-examinee']]) {
    const id=examinationFixtureIdentity(suite,suite==='examinations-ui'?`ui-${RUN}`:RUN,label);
    assert.ok(id.email.startsWith(suite==='examinations-ui'?'dd-ui-':`dd-exam-${label}-`));
    assert.equal(id.appMetadata.astra_staging_examination_fixture.suite,suite);
  }
  for(const run of [RUN+'\n',RUN.toUpperCase(),'astra-durable-1788800000000-abcdef12']) assert.throws(()=>examinationFixtureIdentity('examinations-api',run,'admin'));
  assert.throws(()=>examinationFixtureIdentity('examinations-ui',`ui-${RUN}`,'admin'));
  assert.throws(()=>createExaminationFixtureLifecycle({suite:'examinations-api',runId:RUN,supabaseUrl:'https://hbllomlijfznnuudpdvr.supabase.co',
    workerUrl:EXAMINATION_FIXTURE_TARGET.workerUrl,serviceRoleKey:SECRET,publishableKey:PUBLISHABLE}));
});
test('actual API creator persists before Auth, classifies as student, normally signs in, then separately promotes',async()=>{
  const h=harness({label:'admin'});await h.lifecycle.preflight();await h.create();await h.promote();
  assert.deepEqual(h.calls.filter(x=>x!=='persist'),['preflight','admin-create','register','normal-sign-in','terms','profile','promote']);
  assert.equal(h.scope.createdUsers[0],ID);
  assert.equal(h.manifests.at(-1).fixtures[0].signInState,'confirmed');
});
test('actual UI creator registers before existing promotion, then uses normal Auth/profile',async()=>{
  const h=harness({suite:'examinations-ui',label:'ui-examinee'});await h.lifecycle.preflight();await h.create();await h.uiSignIn();
  assert.deepEqual(h.calls.filter(x=>x!=='persist'),['preflight','admin-create','register','promote','normal-sign-in','terms','profile']);
  assert.equal(h.scope.userId,ID);
});
for(const preflight of ['missing','permission','success','wrong']) test(`preflight ${preflight} blocks all fixture/global setup`,async()=>{
  const h=harness({preflight});await assert.rejects(()=>h.lifecycle.preflight());await assert.rejects(()=>h.create());
  assert.equal(h.calls.includes('admin-create'),false);assert.equal(h.calls.includes('normal-sign-in'),false);
});
for(const registration of ['network','wrongId','wrongScope','wrongVersion','wrongReplay','wrongRegistered','extra']) test(`registration ${registration} preserves exact UUID and blocks sign-in/promotion`,async()=>{
  for(const suite of ['examinations-api','examinations-ui']) {
    const h=harness({suite,label:suite==='examinations-api'?'student-a':'ui-examinee',registration});
    await h.lifecycle.preflight();await assert.rejects(()=>h.create());
    assert.equal(h.manifests.at(-1).fixtures[0].id,ID);assert.equal(h.calls.includes('normal-sign-in'),false);
    assert.equal(h.calls.includes('promote'),false);await assert.rejects(()=>h.create());
    assert.equal(h.calls.filter(x=>x==='admin-create').length,1);
    await h.lifecycle.deleteUser(ID);await h.lifecycle.finishCleanup(true);
  }
});
test('cleanup logs out globally and durably captures audit IDs/provenance before Auth deletion',async()=>{
  const h=harness();await h.lifecycle.preflight();await h.create();await h.lifecycle.verifyCleanupIdentity(ID);
  await h.lifecycle.deleteUser(ID);await h.lifecycle.finishCleanup(true);
  const calls=h.calls.filter(x=>x!=='persist');
  assert.ok(calls.indexOf('logout')<calls.indexOf('delete-auth'));
  assert.ok(calls.indexOf('read-audit')<calls.indexOf('delete-auth'));
  assert.equal(h.manifests.at(-1).cleanupComplete,true);
  assert.deepEqual(h.manifests.at(-1).fixtures[0].auditRowIds,['12','15']);
  assert.match(h.manifests.at(-1).examinationAudit,/not-frozen-data-scope/);
  assert.equal(h.manifests.at(-1).independentDatabaseReadbackRequired,true);
  assert.equal(h.calls.some(x=>/delete-audit|delete-pulse/u.test(x)),false);
});
for(const options of [{wrongIdentity:true},{logoutStatus:401},{logoutStatus:403},{auditTotal:null},{auditTotal:3},
  {auditIds:Array.from({length:501},(_,n)=>n+1)},{auditIds:[Number.MAX_SAFE_INTEGER+1]},{failAuditPersist:true}]) {
  test(`unsafe/incomplete cleanup is not reported successful: ${JSON.stringify(options).slice(0,90)}`,async()=>{
    const h=harness(options);await h.lifecycle.preflight();await h.create();
    await assert.rejects(()=>h.lifecycle.deleteUser(ID));assert.equal(h.deleted,false);
    await assert.rejects(()=>h.lifecycle.finishCleanup(false));assert.equal(h.manifests.at(-1).cleanupComplete,false);
  });
}
test('uncertain Auth creation retains intent without false cleanup or automatic re-create',async()=>{
  const h=harness();await h.lifecycle.preflight();await h.lifecycle.beforeCreate('student-a');
  await assert.rejects(()=>h.lifecycle.beforeCreate('student-a'));await assert.rejects(()=>h.lifecycle.finishCleanup(true));
  const record=h.manifests.at(-1).fixtures[0];assert.equal(record.id,null);assert.equal(record.creationState,'requested');
});
test('uncertain normal sign-in without returned token blocks Auth deletion',async()=>{
  const h=harness({suite:'examinations-ui',label:'ui-examinee'});await h.lifecycle.preflight();await h.create();
  await h.lifecycle.beforeSignIn(ID);await assert.rejects(()=>h.lifecycle.deleteUser(ID),/independent session recovery/);
  assert.equal(h.deleted,false);assert.equal(h.calls.includes('logout'),false);
});
test('only the two intended creator cleanup audit DELETE targets are removed; no product or verifier rewrite',async()=>{
  for(const source of [apiSource,uiSource]) {
    assert.doesNotMatch(source,/\['examination_audit_log',/u);
    assert.match(source,/fixtureLifecycle\.verifyCleanupIdentity/u);
    assert.match(source,/fixtureLifecycle\.finishCleanup/u);
  }
  assert.ok(uiSource.indexOf('  await fixtureLifecycle.preflight();')<uiSource.indexOf('  await enableCommercialLegalVersions();'));
  assert.ok(apiSource.indexOf('  await fixtureLifecycle.preflight();')<apiSource.indexOf("  const admin = await createUser('admin');"));
  const workflow=await readFile(new URL('../.github/workflows/release-unlimited-feature-access.yml',import.meta.url),'utf8');
  assert.match(workflow,/if: always\(\)[\s\S]*?name: astra-staging-e2e-\$\{\{ github\.run_id \}\}[\s\S]*?path: \|\r?\n\s+artifacts\/staging-e2e\/\*\.json\r?\n\s+artifacts\/staging-e2e\/\*-cleanup-manifest\.json\.tmp/u);
  const h=harness();assert.match(h.lifecycle.manifestPath,/artifacts[\\/]staging-e2e[\\/]examinations-api-[a-z0-9-]+-cleanup-manifest\.json$/u);
  const helper=await readFile(new URL('./staging-examination-fixtures.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/astra_register_staging_forecast_fixture|\/auth\/v1\/signup|grantSyntheticSuperAdmin/u);
});
