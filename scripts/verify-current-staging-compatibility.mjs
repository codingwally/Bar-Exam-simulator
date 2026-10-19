import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

// No hosted credentials, provider SDKs or network client. psql is bound to loopback.
const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'package');
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, 'native-output');
const sha = s => createHash('sha256').update(s).digest('hex');
const manifestBytes = await fs.readFile(path.join(packageDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.target, 'disposable-local-only');
assert.equal(manifest.database, 'duediligence_compatibility_fixture');
assert.equal(manifest.mutationScope.length, 6);
assert.equal(manifest.protectedFunctions, 42);
const files = new Map();
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.match(name, /^[a-z][a-z0-9-]*\.(?:sql|json|mjs)$/);
  const content = await fs.readFile(path.join(packageDir, name));
  assert.equal(sha(content), expected, `Package file changed: ${name}`);
  files.set(name, content.toString('utf8'));
}
const required = ['current-schema.sql','verify-current-schema.sql','forward.sql','inverse.sql','baseline.json','postimage.json','target-definitions.json','table-names.json','fixture-manifest.json','hardening-manifest.json','hardening-patches.json','professor-manifest.json','professor-seed.sql','professor-pre.sql','professor-post.sql','student-seed.sql','student-pre.sql','student-post.sql','student-race.mjs'];
assert.deepEqual([...files.keys()].sort(), required.sort());
if (process.argv.includes('--validate-only')) {
  console.log(JSON.stringify({status:'PACKAGE_HASHES_VALID_ONLY',sqlExecuted:false,files:files.size,manifestSha256:sha(manifestBytes)}));
  process.exit(0);
}
assert.equal(process.platform, 'linux', 'Native execution requires dedicated Linux job');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.EXAMINATION_COMPATIBILITY_SQL_CI, '1');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGPORT, '5432');
assert.equal(process.env.PGUSER, 'fixture_bootstrap');
assert.equal(process.env.PGDATABASE, manifest.database);
assert.equal(process.env.PGPASSWORD, 'isolated_compatibility_only');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'duediligence-sql-'));
const env = Object.fromEntries(['PATH','LANG','LC_ALL','PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
env.HOME=scratch; env.PGPASSFILE=path.join(scratch,'no-pgpass'); env.PGSERVICEFILE=path.join(scratch,'no-pgservice');
env.PGOPTIONS='-c statement_timeout=20000 -c lock_timeout=5000';
await fs.mkdir(output,{recursive:true});
let commit = null;
try { commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); } catch {}
const report = {kind:'ISOLATED_CURRENT_POSTGRES_COMPATIBILITY',status:'RUNNING',startedAt:new Date().toISOString(),candidate:commit,manifestSha256:sha(manifestBytes),harnessSha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),packageFileHashes:manifest.files,sqlExecuted:false,hostedExecuted:false,providerCalls:0,productionDeployed:false,checks:[],expectedErrors:[],phases:[],limitations:JSON.parse(files.get('fixture-manifest.json')).limitations};
const check=(name,condition)=>{assert.ok(condition,name); report.checks.push({name,passed:true});};
function run(sql,{applicationName='compatibility-native',expectedCode,expectedMessage,bootstrap=false,fixture=true}={}) {
  assert.match(applicationName,/^[a-zA-Z0-9_-]{1,60}$/);
  return new Promise((resolve,reject)=>{
    const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{env:{...env,PGAPPNAME:applicationName},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',killed=false,inputError=null;
    const timer=setTimeout(()=>{killed=true;child.kill('SIGKILL');},45000);
    child.stdout.on('data',x=>{stdout+=x;if(stdout.length>2000000){killed=true;child.kill('SIGKILL');}});
    child.stderr.on('data',x=>{stderr+=x;if(stderr.length>2000000){killed=true;child.kill('SIGKILL');}});
    // psql can reject an early statement while the large fixture is still being
    // written. Preserve its real SQL diagnostic instead of crashing on EPIPE.
    child.stdin.on('error',error=>{inputError=error.code??'STDIN_ERROR';});
    child.on('error',e=>{clearTimeout(timer);reject(new Error('PSQL_START_FAILED',{cause:e}));});
    child.on('close',code=>{
      clearTimeout(timer);
      const sqlState=/ERROR:\s+([A-Z0-9]{5}):/.exec(stderr)?.[1]??null;
      if(killed)return reject(new Error('NATIVE_SQL_LIMIT_EXCEEDED'));
      if(expectedCode){
        if(code===0||sqlState!==expectedCode||(expectedMessage&&!stderr.includes(expectedMessage)))return reject(Object.assign(new Error('EXPECTED_SQL_DENIAL_MISMATCH'),{sqlState,diagnostic:stderr.slice(-2000)}));
        report.expectedErrors.push({applicationName,sqlState,expectedMessage:expectedMessage??null,diagnosticSha256:sha(stderr)}); return resolve(sqlState);
      }
      if(code!==0)return reject(Object.assign(new Error('NATIVE_SQL_FAILED'),{sqlState,applicationName,diagnostic:stderr.slice(-3000)}));
      if(inputError)return reject(Object.assign(new Error('PSQL_INPUT_FAILED'),{applicationName,diagnostic:inputError}));
      resolve(stdout.trim());
    });
    const prefix=(fixture?"SET duediligence.compatibility_fixture='isolated-current-capture-20261018';\n":'')+(bootstrap?'':'SET ROLE postgres;\n');
    child.stdin.end(prefix+sql);
  });
}
const catalogSql=`SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text) ORDER BY n.nspname,p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='examination_room_v1' OR (n.nspname='public' AND p.proname IN ('examination_room_v1_api','examination_room_v1_lifecycle_guard'));`;
const catalog=async()=>JSON.parse(await run(catalogSql));
const normalized = rows=>rows.map(({signature,...rest})=>rest).sort((a,b)=>`${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`,'en'));
const baseline=normalized(JSON.parse(files.get('baseline.json'))),postimage=normalized(JSON.parse(files.get('postimage.json')));
const verifyCatalog=async(expected,label)=>{assert.deepEqual(normalized(await catalog()),expected,label);check(label,true);};
const tableNames=JSON.parse(files.get('table-names.json'));
assert.equal(tableNames.length,28);for(const n of tableNames)assert.match(n,/^[a-z_]+$/);
const dataSql=`SELECT jsonb_object_agg(name,digest) FROM (${tableNames.map(n=>`SELECT '${n}' AS name, encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS digest FROM examination_room_v1.${n} t`).join(' UNION ALL ')}) s;`;
const data=async()=>JSON.parse(await run(dataSql));
async function phase(name,bootstrap=false) {
  const result=await run(files.get(name),{bootstrap,applicationName:name.replaceAll('.','-')});
  report.phases.push({name,passed:true,stdoutSha256:sha(result),markers:result.split('\n').filter(s=>/^(PASS|CURRENT_CAPTURE)/.test(s))});
  console.log(JSON.stringify({phase:name,passed:true}));
}
try {
  const version=JSON.parse(await run("SELECT jsonb_build_object('version',current_setting('server_version_num'),'database',current_database(),'user',current_user,'address',inet_server_addr()::text);",{bootstrap:true}));
  check('PostgreSQL 17.6 and fixed disposable database',version.version==='170006'&&version.database===manifest.database&&version.user==='fixture_bootstrap');
  report.server=version; report.sqlExecuted=true;
  await phase('current-schema.sql',true);await phase('verify-current-schema.sql');await verifyCatalog(baseline,'48 exact captured function definitions and permissions');
  await run(files.get('forward.sql'),{fixture:false,expectedCode:'P0001',expectedMessage:'DISPOSABLE_FIXTURE_REQUIRED'});await verifyCatalog(baseline,'Missing disposable marker denies without changes');
  for(const role of ['anon','authenticated']) await run(`SET ROLE ${role}; SELECT public.examination_room_v1_api('student','preview',NULL,NULL,'{}');`,{expectedCode:'42501'});
  await run("SET ROLE service_role; SELECT examination_room_v1.api_student('session_context','{}');",{expectedCode:'42501'});
  const result=JSON.parse(await run("SET ROLE service_role; SELECT public.examination_room_v1_api('student','not-a-listed-operation',NULL,NULL,'{}');"));check('Service role can dispatch while unregistered operation is rejected',result.ok===false&&result.errorCode==='UNKNOWN_OPERATION');
  await phase('professor-seed.sql');await phase('student-seed.sql');await phase('professor-pre.sql');await phase('student-pre.sql');
  const seeded=await data();
  await run(`BEGIN; ALTER FUNCTION examination_room_v1.api_error(text,text,integer,text) SET work_mem='4MB';\n${files.get('forward.sql')}`,{expectedCode:'P0001',expectedMessage:'PROTECTED_DEPENDENCY_CHANGED'});await verifyCatalog(baseline,'Changed protected dependency aborts atomically');
  const first=JSON.parse(files.get('target-definitions.json'))[0];
  await run(`BEGIN; ${first.after};\n${files.get('forward.sql')}`,{expectedCode:'P0001',expectedMessage:'UNKNOWN_OR_PARTIAL_PACKAGE_PREIMAGE'});await verifyCatalog(baseline,'Mixed package state aborts and transaction restores original');
  const forced=files.get('forward.sql').replace(/COMMIT;\s*$/, "DO $$ BEGIN RAISE EXCEPTION 'TEST_FORCED_ROLLBACK_AFTER_VERIFIED_POSTIMAGE'; END $$;\nCOMMIT;\n");
  await run(forced,{expectedCode:'P0001',expectedMessage:'TEST_FORCED_ROLLBACK_AFTER_VERIFIED_POSTIMAGE'});await verifyCatalog(baseline,'Late failure rolls back all six definitions and new lease objects');assert.deepEqual(await data(),seeded);check('Failure probes preserve all synthetic data hashes',true);
  await phase('forward.sql');await verifyCatalog(postimage,'All six composed definitions installed with preserved dependencies');assert.deepEqual(await data(),seeded);check('Definition update has no standalone row changes',true);
  await phase('forward.sql');await verifyCatalog(postimage,'Complete forward repeat is a verified no-op');
  await phase('professor-post.sql');await phase('student-post.sql');assert.deepEqual(await data(),seeded);check('Behavior phases roll back their synthetic mutations',true);
  // Inverse is tested before the concurrency cases can commit behavior-dependent rows.
  await phase('inverse.sql');await verifyCatalog(baseline,'Exact inverse restores all original definitions and removes only new lease objects');await phase('inverse.sql');await phase('verify-current-schema.sql');await phase('professor-pre.sql');await phase('student-pre.sql');assert.deepEqual(await data(),seeded);check('Inverse repeat and preimage behavior preserve data',true);
  await phase('forward.sql');
  const race=await import(pathToFileURL(path.join(packageDir,'student-race.mjs')).href);assert.equal(typeof race.runConcurrency,'function');
  const raceRun=(sql,options={})=>{
    if(options.applicationName==='student-race-observer'){
      assert.match(sql.trim(),/^SELECT EXISTS\(SELECT 1 FROM pg_(?:locks|stat_activity)\b/);
      assert.ok(!sql.trim().slice(0,-1).includes(';'));
      return run(sql,{...options,bootstrap:true});
    }
    return run(sql,options);
  };
  await race.runConcurrency({run:raceRun,check:(condition,name)=>check(name,condition)});check('Actual separate-connection concurrency cases executed',true);
  await verifyCatalog(postimage,'Concurrency cases preserve installed function definitions and permissions');
  report.status='PASS_SCOPED_NATIVE_DATABASE_CHECKS';
} catch(error) {
  report.status='FAIL';report.error={name:error.name,message:error.message,sqlState:error.sqlState??null,applicationName:error.applicationName??null,diagnostic:error.diagnostic??null};process.exitCode=1;
} finally {
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,expectedErrors:report.expectedErrors.length,phases:report.phases.length,error:report.error??null}));
}
