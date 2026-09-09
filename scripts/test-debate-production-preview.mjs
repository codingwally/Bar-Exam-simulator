import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { TARGET, RELEASE_FLAGS, MIGRATIONS, OWN_SOURCES, parseProductionBase, sanitizeScript,
  validateBaseAgainstRemote, buildProductionConfig, validatePreservation, validateDatabaseProof,
  validateStorageEvidence, validateRun, validateStagingDriver, validateSuite,
  validateSerializedMetadata, summarizeSerializedBindings, validateExternalDatabaseRecord, validateExternalStorageRecord, captureProduction } from './debate-production-preview.mjs';
import { hash, CRITICAL_SOURCES, REQUIRED_SUITE_GROUPS } from './debate-staging-release.mjs';

const base = parseProductionBase(await readFile(new URL('../worker/wrangler.toml',import.meta.url),'utf8'));
const alias = parseProductionBase(await readFile(new URL('../worker/wrangler.public-api.toml',import.meta.url),'utf8'),true);
const sha='a'.repeat(40), digest='b'.repeat(64), version='11111111-1111-4111-8111-111111111111', deployment='22222222-2222-4222-8222-222222222222';
const next='33333333-3333-4333-8333-333333333333';
const logs={ enabled:true, head_sampling_rate:1, redact_query_string:false,
  logs:{enabled:true,head_sampling_rate:1,persist:true,invocation_logs:true}, traces:{enabled:false,head_sampling_rate:1,persist:true} };
const raw = b => ({ deployments:{deployments:[{id:deployment,versions:[{version_id:version,percentage:100}]}]},
  settings:{ bindings:b.alias ? [{name:'DUE_DILIGENCE_APPLICATION',type:'service',service:TARGET.worker,environment:'production'}] : [
    ...Object.entries(b.vars).map(([name,text])=>({name,type:'plain_text',text})),
    ...['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','MAINTENANCE_SIGNING_KEY'].map(name=>({name,type:'secret_text'})),
    {name:'EXISTING_PRIVATE_VAR',type:'plain_text',text:'private-canary-never-persist'},
  ], compatibility_date:b.date,compatibility_flags:b.flags,placement:b.region ? {mode:'targeted',target:[10]} : null,
    logpush:false,observability:logs,annotations:{},tags:[] },
  scriptSettings:{observability:logs,logpush:false,tail_consumers:[]},
  version:{id:version,resources:{script_runtime:{compatibility_date:b.date,compatibility_flags:b.flags,usage_model:'standard'}}},
  schedules:b.crons.map(cron=>({cron})),subdomain:{enabled:true,previews_enabled:false},
  service:{default_environment:{environment:'production',script:{has_assets:false,placement:b.region ? {mode:'targeted',target:[{region:b.region}]} : null}}} });
const state = b => sanitizeScript(raw(b),b.alias ? TARGET.alias : TARGET.worker);
const error = (fn,code) => assert.throws(fn,value=>value.code===code);

test('public access includes paid and unpaid signed-in users while unverified providers stay closed',()=>{
  assert.deepEqual(RELEASE_FLAGS,{DEBATE_ROOM_ENABLED:'true',DEBATE_MEDIA_ENABLED:'false',DEBATE_SWEEPER_ENABLED:'false',
    DEBATE_APPROVED_MAX_PARTICIPANTS:'0',DEBATE_RESULTS_EMAIL_MODE:'suppressed',DEBATE_INVITATION_EMAIL_MODE:'suppressed',DEBATE_PREVIEW_ACTOR_IDS:''});
  const built=buildProductionConfig(base,state(base),'/fixture');
  assert.match(built.source,/main = "\/fixture\/worker\/maintenance-entry.mjs"/);
  assert.match(built.source,/^keep_vars = true$/m);
  for(const [name,value] of Object.entries(base.vars)) assert.ok(built.source.includes(`${name} = ${JSON.stringify(value)}`));
  for(const [name,value] of Object.entries(RELEASE_FLAGS)) assert.ok(built.source.includes(`${name} = ${JSON.stringify(value)}`));
  assert.match(built.source,/\[observability.traces\][\s\S]*persist = true/);
  assert.ok(built.source.includes('crons = '+JSON.stringify(state(base).crons)));
  assert.doesNotMatch(built.source,/private-canary|\[limits\]|cpu_ms/);
});
test('production release preserves the captured original schedule without activating the pending minute sweeper',()=>{
  const prior=state(base);prior.crons=['*/2 * * * *'];
  const built=buildProductionConfig(base,prior,'/fixture');
  assert.ok(built.source.includes('crons = ["*/2 * * * *"]'));
  assert.equal((built.source.match(/^crons\s*=/gm)||[]).length,1);
  assert.ok(built.source.includes('DEBATE_SWEEPER_ENABLED = "false"'));
  for(const crons of [[],['* * * * *'],['*/2 * * * *','*/3 * * * *']]) {
    error(()=>buildProductionConfig(base,{...prior,crons}),'BASELINE_CONFIG_DRIFT');
  }
});
test('fixed production entry, origin, resources, shared flags and duplicate vars cannot be redirected',()=>{
  for(const source of [base.source.replace(TARGET.worker,'attacker-worker'),base.source.replace('maintenance-entry.mjs','index.mjs'),
    base.source.replace(TARGET.origin,'https://other.example'),base.source+'\n[[kv_namespaces]]\nbinding = "NEW"\n',
    base.source.replace('[vars]','[vars]\nDEBATE_ROOM_ENABLED = "true"'),base.source.replace('[vars]','[vars]\nGEMINI_MODEL = "other"'),
    base.source+'\n[limits]\ncpu_ms = 30000\n']) assert.throws(()=>parseProductionBase(source));
  error(()=>parseProductionBase(alias.source.replace(TARGET.worker,'other'),true),'ALIAS_BINDING_CHANGED');
});
test('sanitized baseline retains exact private-variable hashes and never raw values',()=>{
  const saved=state(base), serialized=JSON.stringify(saved);
  assert.ok(saved.bindings.some(b=>b.name==='EXISTING_PRIVATE_VAR'&&b.valueSha256===hash('private-canary-never-persist')));
  assert.doesNotMatch(serialized,/private-canary-never-persist/);
  assert.equal(saved.bindings.filter(b=>b.type==='secret_text').length,6);
  assert.equal(validateBaseAgainstRemote(base,saved),true);
  assert.equal(validateBaseAgainstRemote(alias,state(alias)),true);
});
test('split traffic, unknown bindings, missing secrets, runtime and sensitive logging changes fail closed',()=>{
  for(const change of [r=>r.deployments.deployments[0].versions.push({version_id:next,percentage:1}),
    r=>r.deployments.deployments[0].versions[0].percentage=99,r=>r.version.id=next,
    r=>r.settings.bindings.push({name:'NEW',type:'r2_bucket',bucket_name:'private'}),
    r=>r.settings.bindings.push(r.settings.bindings[0]),r=>r.settings.cache_options={enabled:false},
    r=>r.version.resources.script_runtime.exports={},r=>r.scriptSettings.observability={enabled:true,unknown:'secret-canary'},
    r=>r.scriptSettings.logpush=true,r=>r.scriptSettings.tail_consumers=[{service:'other'}],
    r=>r.version.resources.script_runtime.limits={cpu_ms:30000},r=>r.service.default_environment.script.placement={mode:'targeted',target:[{region:'other'}]},
    r=>r.version.resources.script_runtime.assets={binding:'ASSETS'}]) {
    const fixture=raw(base); change(fixture); assert.throws(()=>sanitizeScript(fixture,TARGET.worker));
  }
  const missing=state(base); missing.bindings=missing.bindings.filter(b=>b.name!=='LIVEKIT_API_SECRET');
  error(()=>buildProductionConfig(base,missing),'EXISTING_SECRET_REQUIRED');
});
test('preservation permits only declared Debate additions and newly assigned version/deployment IDs',()=>{
  const before=state(base), after=structuredClone(before); after.versionId=next; after.deploymentId=next;
  for(const [name,value] of Object.entries(RELEASE_FLAGS)) after.bindings.push({name,type:'plain_text',valueSha256:hash(value)});
  after.bindings.sort((a,b)=>a.name.localeCompare(b.name)); assert.equal(validatePreservation(before,after,RELEASE_FLAGS),true);
  for(const change of [s=>s.bindings.find(b=>b.name==='EXISTING_PRIVATE_VAR').valueSha256=digest,
    s=>s.bindings=s.bindings.filter(b=>b.name!=='LIVEKIT_API_KEY'),s=>s.crons=['* * * * *'],s=>s.region=null,
    s=>s.observability.logs.persist=false,s=>s.tagsSha256=digest,s=>s.previewUrls=true,
    s=>s.bindings.find(b=>b.name==='DEBATE_ROOM_ENABLED').valueSha256=hash('false')]) {
    const changed=structuredClone(after); change(changed); error(()=>validatePreservation(before,changed,RELEASE_FLAGS),'PRODUCTION_PRESERVATION_FAILED');
  }
  const priorPreview=structuredClone(before); priorPreview.bindings.push({name:'DEBATE_PREVIEW_ACTOR_IDS',type:'plain_text',valueSha256:hash(version)});
  priorPreview.bindings.sort((a,b)=>a.name.localeCompare(b.name)); assert.equal(validatePreservation(priorPreview,after,RELEASE_FLAGS),true);
});
test('actual serialized metadata must preserve complete observations and only the seven public-entry overrides',()=>{
  for(const b of [base,alias]) {
    const s=state(b), additions=b.alias ? {} : RELEASE_FLAGS;
    const metadata={compatibility_date:b.date,compatibility_flags:b.flags,observability:structuredClone(logs),keep_bindings:['secret_text','plain_text','secret_key','json'],
      ...(b.region ? {placement:{mode:'targeted',region:b.region}} : {}),
      bindings:b.alias ? [{name:'DUE_DILIGENCE_APPLICATION',type:'service',service:TARGET.worker}] :
        [...['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'].map(name=>({name,type:'inherit'})),
          ...Object.entries({...b.vars,...additions}).map(([name,text])=>({name,type:'plain_text',text}))]};
    assert.equal(validateSerializedMetadata(metadata,b,s,additions),true);
    for(const mutate of [m=>m.observability.logs.persist=false,m=>m.keep_bindings=[],m=>m.cache_options={enabled:false},
      m=>m.bindings.push({name:'UNREVIEWED',type:'plain_text',text:'new'})]) {
      const changed=structuredClone(metadata);mutate(changed);assert.throws(()=>validateSerializedMetadata(changed,b,s,additions));
    }
  }
});
test('only the three currently declared and preexisting secret_text bindings may be inherited',()=>{
  const s=state(base), metadata={compatibility_date:base.date,compatibility_flags:base.flags,observability:structuredClone(logs),
    keep_bindings:['secret_text','plain_text','secret_key','json'],placement:{mode:'targeted',region:base.region},
    bindings:[...['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'].map(name=>({name,type:'inherit'})),
      ...Object.entries({...base.vars,...RELEASE_FLAGS}).map(([name,text])=>({name,type:'plain_text',text}))]};
  assert.equal(validateSerializedMetadata(metadata,base,s,RELEASE_FLAGS),true);
  for(const mutate of [m=>m.bindings.shift(),m=>m.bindings.push({...m.bindings[0]}),
    m=>m.bindings[0].name='UNREVIEWED_SECRET',m=>m.bindings[0].text='secret-canary',
    m=>m.bindings[0].value='secret-canary',m=>m.bindings[0].unexpected=true,
    m=>m.bindings[0].type='secret_text']) {
    const changed=structuredClone(metadata);mutate(changed);assert.throws(()=>validateSerializedMetadata(changed,base,s,RELEASE_FLAGS));
  }
  for(const mutate of [r=>r.bindings=r.bindings.filter(b=>b.name!=='LIVEKIT_URL'),
    r=>r.bindings.find(b=>b.name==='LIVEKIT_URL').type='plain_text',
    r=>r.bindings.push({name:'LIVEKIT_URL',type:'secret_text'})]) {
    const changed=structuredClone(s);mutate(changed);error(()=>validateSerializedMetadata(metadata,base,changed,RELEASE_FLAGS),'SERIALIZED_INHERITED_SECRET_CHANGED');
  }
  const aliasMetadata={...metadata,compatibility_flags:alias.flags,placement:undefined,bindings:[
    {name:'DUE_DILIGENCE_APPLICATION',type:'service',service:TARGET.worker},{name:'LIVEKIT_URL',type:'inherit'}]};
  error(()=>validateSerializedMetadata(aliasMetadata,alias,state(alias),{}),'SERIALIZED_INHERITED_SECRET_CHANGED');
});
test('secret declaration drift is rejected before configuration generation',()=>{
  for(const source of [base.source.replace('"LIVEKIT_URL", ',''),base.source.replace('"LIVEKIT_URL"','"NEW_SECRET"'),
    base.source.replace('"LIVEKIT_URL"','"LIVEKIT_URL", "LIVEKIT_URL"'),base.source.replace('[secrets]','[other]'),
    base.source.replace('[secrets]','[secrets]\nextra = "unreviewed"')]) {
    error(()=>parseProductionBase(source),'REQUIRED_SECRET_DECLARATION_CHANGED');
  }
  error(()=>parseProductionBase(alias.source+'\n[secrets]\nrequired = ["LIVEKIT_URL"]\n',true),'REQUIRED_SECRET_DECLARATION_CHANGED');
});
test('pre-validation binding diagnostics retain identifiers and field names, never values',()=>{
  const diagnostic=summarizeSerializedBindings({bindings:[{name:'LIVEKIT_URL',type:'inherit',value:'private-canary-secret'},
    {name:'SOME_VAR',type:'plain_text',text:'private-canary-text'},
    {name:'https://private.example/token',type:'invalid\ntoken',secret:'private-canary-value'}]});
  assert.deepEqual(diagnostic.bindings[0],{name:'LIVEKIT_URL',type:'inherit',fields:['name','type','value']});
  assert.deepEqual(diagnostic.bindings[2],{name:'[invalid]',type:'[invalid]',fields:['name','secret','type']});
  assert.equal(diagnostic.valuesStored,false);assert.doesNotMatch(JSON.stringify(diagnostic),/private-canary|private\.example/);
  assert.equal(summarizeSerializedBindings({bindings:Array.from({length:201},()=>({name:'BOUND',type:'inherit'}))}).bindings.length,200);
});
test('production DB proof separates actual application, transaction rollback and preserved Study evidence',()=>{
  const hashes=Object.fromEntries(MIGRATIONS.map(file=>[file,digest]));
  const proof={schemaVersion:1,projectRef:TARGET.project,reviewedBy:'Codex /root',evidenceSha256:digest,evidenceReference:'reviewed-production-record',
    verifiedAt:'2026-09-10T01:00:00Z',migrationHashes:hashes,exactApplicationVerified:true,dmlRollbackVerified:true,
    privilegesVerified:true,studyPreserved:true,fullAcceptance:false};
  validateDatabaseProof(proof,hashes);
  for(const mutate of [p=>p.projectRef='hlzqmreeoghbldnhlybr',p=>p.dmlRollbackVerified=false,p=>p.exactApplicationVerified=false,
    p=>p.privilegesVerified=false,p=>p.studyPreserved=false,p=>p.fullAcceptance=true,p=>p.migrationHashes={}]) {
    const changed=structuredClone(proof); mutate(changed); error(()=>validateDatabaseProof(changed,hashes),'PRODUCTION_DATABASE_PROOF_REQUIRED');
  }
});
test('only independently verified private Storage configuration passes the release gate',()=>{
  const proof={projectRef:TARGET.project,bucket:'debate-private-v3',evidenceSha256:digest,evidenceReference:'readback',verifiedPrivate:false,status:'UNVERIFIED'};
  error(()=>validateStorageEvidence(proof,false),'STORAGE_EVIDENCE_REQUIRED');
  error(()=>validateStorageEvidence(proof,true),'STORAGE_EVIDENCE_REQUIRED');
  assert.equal(validateStorageEvidence({...proof,verifiedPrivate:true,status:'VERIFIED'},false).status,'VERIFIED');
  error(()=>validateStorageEvidence({...proof,bucket:'public'},true),'STORAGE_EVIDENCE_REQUIRED');
});
test('the external production record must substantiate exact migration hashes and independently read-back private bucket',()=>{
  const migrationHashes=Object.fromEntries(MIGRATIONS.map(file=>[file,digest]));
  const proof={migrationHashes,exactApplicationVerified:true,dmlRollbackVerified:true,privilegesVerified:true,studyPreserved:true};
  const record={...proof,projectRef:TARGET.project,fullAcceptance:false,exactStoredMigrationSqlMatchesReviewedSources:true,
    applicationRecords:MIGRATIONS.map(path=>({path,sha256:digest})),storage:{configurationVerified:true,independentReadback:[{
      id:'debate-private-v3',public:false,file_size_limit:10485760,allowed_mime_types:['text/csv','image/png','application/pdf','image/jpeg']}]}};
  validateExternalDatabaseRecord(record,proof);validateExternalStorageRecord(record);
  for(const mutate of [r=>r.applicationRecords[0].sha256=hash('different'),r=>r.dmlRollbackVerified=false,r=>r.projectRef='other']) {
    const changed=structuredClone(record);mutate(changed);assert.throws(()=>validateExternalDatabaseRecord(changed,proof));
  }
  for(const mutate of [r=>r.storage.independentReadback[0].public=true,r=>r.storage.independentReadback[0].allowed_mime_types=['application/pdf'],r=>r.storage.configurationVerified=false]) {
    const changed=structuredClone(record);mutate(changed);assert.throws(()=>validateExternalStorageRecord(changed));
  }
});
test('staging provenance requires exact owner-dispatched main and successful original workflow',()=>{
  const run={repository:{full_name:TARGET.repository},head_repository:{full_name:TARGET.repository},status:'completed',conclusion:'success',
    path:'.github/workflows/debate-v3-staging.yml',event:'workflow_dispatch',head_sha:sha,head_branch:'main',actor:{login:TARGET.owner},triggering_actor:{login:TARGET.owner}};
  assert.equal(validateRun(run,'staging',sha),true);
  for(const mutate of [r=>r.conclusion='failure',r=>r.head_sha='c'.repeat(40),r=>r.path='.github/workflows/deploy.yml',r=>r.actor.login='other',r=>r.head_repository.full_name='fork/repo']) {
    const changed=structuredClone(run);mutate(changed);assert.throws(()=>validateRun(changed,'staging',sha));
  }
});
test('staging assets/Auth evidence cannot be replaced by fixture preparation or failed cleanup',()=>{
  const driver={sourceSha:sha,mode:'deploy',status:'PASS_STAGING_ASSETS_AND_AUTH_ONLY',target:{worker:'duediligence-examinations-staging',project:'hlzqmreeoghbldnhlybr'},
    deploymentState:'VERSION_AND_PRESERVATION_VERIFIED',deployedVersionId:version,deployedFingerprint:digest,authenticatedAccounts:2,
    cleanup:'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED',credentialsStored:false,
    steps:['prepare','deploy','postflight','smoke'].map(label=>({label,status:'PASS',exitCode:0}))};
  validateStagingDriver(driver,sha);
  for(const mutate of [d=>d.mode='prepare-auth',d=>d.cleanup='HELD',d=>d.authenticatedAccounts=0,d=>d.steps.pop(),d=>d.steps[3].status='FAIL',d=>d.sourceSha='d'.repeat(40)]) {
    const changed=structuredClone(driver);mutate(changed);assert.throws(()=>validateStagingDriver(changed,sha));
  }
});
test('complete CI manifests bind every source byte and require the new workflow',()=>{
  const suite={status:'PASS_LOCAL_SUITE',gitStatus:'',changedDuringRun:[],groups:REQUIRED_SUITE_GROUPS.map(name=>({name,status:'PASS',exitCode:0})),
    sourceHashes:Object.fromEntries([...CRITICAL_SOURCES,...OWN_SOURCES].map(file=>[file,digest]))};
  validateSuite(suite,()=>digest);
  const missing=structuredClone(suite); delete missing.sourceHashes[OWN_SOURCES[0]];error(()=>validateSuite(missing,()=>digest),'CI_SOURCE_MANIFEST_INCOMPLETE');
  error(()=>validateSuite(suite,()=>hash('changed')),'CI_SOURCE_DRIFT');
  const traversal=structuredClone(suite);traversal.sourceHashes['../private']=digest;error(()=>validateSuite(traversal,()=>digest),'INVALID_CI_SOURCE_PATH');
});
test('capture makes only fixed-target GETs and detects version changes before returning evidence',async()=>{
  const requests=[],fixtures={[TARGET.worker]:raw(base),[TARGET.alias]:raw(alias)};
  const fetcher=async(url,options)=>{
    requests.push({url,options}); assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/workers\//);
    const worker=url.includes('/'+TARGET.worker) ? TARGET.worker : TARGET.alias, fixture=fixtures[worker];
    const suffix=url.split(worker)[1]; const value=url.includes('/services/') ? fixture.service :
      suffix==='/deployments'?fixture.deployments:suffix==='/settings'?fixture.settings:suffix==='/script-settings'?fixture.scriptSettings:
      suffix.startsWith('/versions/')?fixture.version:suffix==='/schedules'?fixture.schedules:fixture.subdomain;
    return new Response(JSON.stringify({success:true,result:value}),{status:200});
  };
  const captured=await captureProduction({token:'fake-sensitive-token',accountId:'a'.repeat(32),fetcher});
  assert.equal(requests.length,16);assert.equal(captured.secretValuesStored,false);
  assert.doesNotMatch(JSON.stringify(captured),/fake-sensitive-token|private-canary-never-persist/);
  let reads=0;
  await assert.rejects(()=>captureProduction({token:'fake',accountId:'a'.repeat(32),fetcher:async(url,options)=>{
    if(url.endsWith(TARGET.worker+'/deployments')&&++reads===2) return new Response(JSON.stringify({success:true,result:{deployments:[{...fixtures[TARGET.worker].deployments.deployments[0],id:next}]}}));
    return fetcher(url,options);
  }}),e=>e.code==='CAPTURE_VERSION_CHANGED');
});
test('workflow keeps Worker, alias, Pages order and exposes no database, service secret or raw configuration artifact',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/debate-v3-production-preview.yml',import.meta.url),'utf8');
  assert.match(workflow,/options: \[capture, prepare, deploy\]/);
  assert.match(workflow,/group: examination-room-production-cutover\n  cancel-in-progress: false/);
  assert.match(workflow,/pages:\n    needs: worker/);assert.match(workflow,/verify:\n    needs: pages/);
  assert.doesNotMatch(workflow,/SUPABASE_SERVICE_ROLE_KEY|psql|supabase db|secret put|secrets-file|pull_request_target/);
  assert.doesNotMatch(workflow,/path:.*(?:\.toml|multipart|RUNNER_TEMP)/);
  assert.match(workflow,/name: debate-v3-local-evidence/);assert.match(workflow,/name: debate-v3-staging-release-\$\{\{ github.sha \}\}/);
});
