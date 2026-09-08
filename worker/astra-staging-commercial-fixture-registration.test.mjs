import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { exactCommercialRowFilter } from '../scripts/staging-commercial-fixtures.mjs';

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const migrationPath = 'supabase/migrations/20260908070656_astra_staging_commercial_fixture_registration.sql';
const migration = await readFile(new URL(`../${migrationPath}`, import.meta.url), 'utf8');
const originalRegistry = (await readFile(new URL('../supabase/migrations/20260828095004_internal_test_account_reporting_scope.sql', import.meta.url), 'utf8')).replaceAll('\r\n','\n');
const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const RUN = 'mtrra0ty-abcdef12';
const TABLES = ['auth.users','auth.sessions','auth.refresh_tokens','public.user_roles','public.admin_capabilities',
  'public.subscriptions','public.payment_requests','public.free_beta_access','public.examination_beta_access',
  'public.examination_participants','public.examination_attempts_multi','public.examination_definitions','private.internal_test_accounts'];
const identity = (label='free') => ({label,runId:RUN,
  email:`dd-commercial-${label}-${RUN}@duediligence.ph`,
  displayName:`Commercial ${label}`,source:`astra_commercial_staging_v1:${RUN}:${label}`});
async function setup() {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; grant usage on schema private to service_role;
      create table auth.users(id uuid primary key,aud text default 'authenticated',role text default 'authenticated',
        email text,is_super_admin boolean default false,is_anonymous boolean default false,is_sso_user boolean default false,
        deleted_at timestamptz,email_confirmed_at timestamptz default now(),created_at timestamptz default now(),
        last_sign_in_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id));
      create table auth.refresh_tokens(user_id text);
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text);
      create table public.admin_capabilities(user_id uuid references auth.users(id),revoked_at timestamptz);
      create table public.examination_definitions(created_by uuid references auth.users(id));
    `);
    for(const table of TABLES.slice(5,11)) await db.exec(`create table ${table}(user_id uuid references auth.users(id));`);
    await db.exec(originalRegistry.slice(originalRegistry.indexOf('create table if not exists private.internal_test_accounts ('),
      originalRegistry.indexOf('create or replace function private.require_admin_data_scope(')));
    for(const name of ['require_admin_data_scope','admin_reporting_scope_matches']) {
      const start=originalRegistry.indexOf(`create or replace function private.${name}(`);
      const end=originalRegistry.indexOf('\n$$;',start);
      await db.exec(originalRegistry.slice(start,end+4));
    }
    await db.exec(`create sequence private.registration_write_attempts;
      create function private.count_registration_write() returns trigger language plpgsql as $$
      begin perform nextval('private.registration_write_attempts'); return new; end; $$;
      create trigger local_registration_write before insert or update on private.internal_test_accounts
        for each row execute function private.count_registration_write();`);
    await db.exec(migration); return db;
  } catch(error) { await db.close(); throw error; }
}
async function seed(db,who=identity()) {
  await db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',
    [ID,who.email,{provider:'email',providers:['email'],astra_staging_commercial_fixture:{version:1,runId:who.runId,label:who.label}},
      {display_name:who.displayName}]);
  await db.query("insert into public.user_roles values($1,'student')",[ID]);
}
async function data(db) {
  const result={};
  for(const table of TABLES) result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) v from ${table} t`)).rows[0].v;
  return result;
}
const writes=async db=>(await db.query('select last_value,is_called from private.registration_write_attempts')).rows;
async function call(db,sql,args=[],role='service_role') {
  assert.ok(['service_role','anon','authenticated'].includes(role));
  await db.exec(`savepoint scoped_call;set local role ${role}`);
  try {const r=await db.query(sql,args);await db.exec('reset role;release savepoint scoped_call');return r;}
  catch(error){await db.exec('rollback to savepoint scoped_call;release savepoint scoped_call');throw error;}
}
async function register(db,{id=ID,runId=RUN,label='free',schema='public',role='service_role'}={}) {
  assert.ok(['public','private'].includes(schema));
  return (await call(db,`select ${schema}.astra_register_staging_commercial_fixture($1::uuid,$2::text,$3::text) v`,
    [id,runId,label],role)).rows[0].v;
}
async function fixtureCase(db,callback,who=identity()) {
  await db.exec('begin');try{await seed(db,who);await callback(who);}finally{await db.exec('rollback');}
}

test('optional commercial registrar uses actual SQL, preserves account state, and fails closed',async t=>{
  const db=await setup();
  try {
    await t.test('service-only invoker wrapper/private definer and postgres-only registry',async()=>{
      const rows=(await db.query(`select n.nspname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
        has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.proname='astra_register_staging_commercial_fixture' order by n.nspname`)).rows;
      assert.equal(rows.length,2);
      for(const row of rows) assert.deepEqual(row,{nspname:row.nspname,prosecdef:row.nspname==='private',
        proconfig:['search_path=""'],owner:'postgres',anon:false,authenticated:false,service:true});
      const protection=(await db.query(`select relrowsecurity,relforcerowsecurity,
        has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') direct_table,
        has_any_column_privilege('service_role',oid,'SELECT,INSERT,UPDATE,REFERENCES') direct_column
        from pg_class where oid='private.internal_test_accounts'::regclass`)).rows[0];
      assert.deepEqual(protection,{relrowsecurity:true,relforcerowsecurity:true,direct_table:false,direct_column:false});
    });
    for(const who of [identity('free'),identity('retry'),identity('founding'),identity('provisional')]) {
      await t.test(`${who.label}: register as student before later Beta, preserve exact replay`,()=>fixtureCase(db,async()=>{
        const before=await data(db);
        assert.equal((await db.query("select private.admin_reporting_scope_matches($1,'regular') v",[ID])).rows[0].v,true);
        const result=await register(db,who);
        assert.deepEqual(result,{registered:true,fixtureUserId:ID,dataScope:'internal_test',registrationVersion:'astra-staging-commercial-v1',replayed:false});
        const after=await data(db),count=await writes(db);
        assert.equal(after['private.internal_test_accounts'][0].classification_source,who.source);
        for(const name of TABLES.filter(x=>x!=='private.internal_test_accounts')) assert.deepEqual(after[name],before[name]);
        assert.equal((await register(db,who)).replayed,true);
        assert.deepEqual(await data(db),after);assert.deepEqual(await writes(db),count);
        assert.deepEqual((await db.query("select private.admin_reporting_scope_matches($1,'regular') regular,private.admin_reporting_scope_matches($1,'internal_test') internal",[ID])).rows[0],{regular:false,internal:true});
        await db.exec("insert into public.free_beta_access(user_id) values('10000000-0000-4000-8000-000000000001')");
        await assert.rejects(()=>register(db,who),/no privileged or billing state/);
        assert.equal((await db.query("select private.admin_reporting_scope_matches($1,'internal_test') v",[ID])).rows[0].v,true);
      },who));
    }
    const negatives=[
      ['NULL identity',null,{id:null}],['missing Auth identity',null,{id:OTHER}],
      ['NULL run',null,{runId:null}],['Forecast run',null,{runId:'astra-durable-1788800000000-abcdef12'}],
      ['newline run',null,{runId:RUN+'\n'}],['uppercase run',null,{runId:RUN.toUpperCase()}],
      ['Examination prefix',null,{runId:'ui-'+RUN}],
      ['NULL label',null,{label:null}],['unknown label',null,{label:'owner'}],['wrong allowed label',null,{label:'retry'}],
      ['Examination label',null,{label:'student-a'}],['admin label',null,{label:'admin'}],
      ['no trusted marker',"update auth.users set raw_app_meta_data=raw_app_meta_data-'astra_staging_commercial_fixture'"],
      ['editable marker only',"update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('astra_staging_commercial_fixture',raw_app_meta_data->'astra_staging_commercial_fixture'),raw_app_meta_data=raw_app_meta_data-'astra_staging_commercial_fixture'"],
      ...[['version','2'],['runId','"different"'],['label','"admin"']].map(([key,value])=>[`different marker ${key}`,`update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{astra_staging_commercial_fixture,${key}}','${value}')`]),
      ['extra marker property',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{astra_staging_commercial_fixture,extra}','true')"],
      ['extra privileged claim',"update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"admin\":true}'::jsonb"],
      ['wrong provider',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{provider}','\"google\"')"],
      ['multiple providers',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{providers}','[\"email\",\"google\"]')"],
      ['false fixture label',"update auth.users set raw_user_meta_data='{}'::jsonb"],
      ['wrong email',"update auth.users set email='synthetic-other@example.invalid'"],
      ['unconfirmed',"update auth.users set email_confirmed_at=null"],
      ['old account',"update auth.users set created_at=now()-interval '16 minutes'"],
      ['future account',"update auth.users set created_at=now()+interval '2 minutes'"],
      ['NULL creation time',"update auth.users set created_at=null"],
      ['wrong audience',"update auth.users set aud='service_role'"],
      ['wrong Auth role',"update auth.users set role='service_role'"],
      ...['is_super_admin','is_anonymous','is_sso_user'].map(column=>[column,`update auth.users set ${column}=true`]),
      ['deleted Auth',"update auth.users set deleted_at=now()"],
      ['missing role','delete from public.user_roles'],['NULL role','update public.user_roles set role=null'],
      ...['admin','founder_admin','super_admin'].map(role=>[`${role} role`,`update public.user_roles set role='${role}'`]),
      ['active capability',`insert into public.admin_capabilities values('${ID}',null)`],
      ['revoked capability',`insert into public.admin_capabilities values('${ID}',now())`],
      ...TABLES.slice(5,11).map(table=>[table,`insert into ${table} values('${ID}')`]),
      ['prior created exam',`insert into public.examination_definitions values('${ID}')`],
      ['prior sign-in','update auth.users set last_sign_in_at=now()'],
      ['session without sign-in',`insert into auth.sessions(user_id) values('${ID}')`],
      ['refresh without sign-in',`insert into auth.refresh_tokens values('${ID}')`],
      ['other classification',`insert into private.internal_test_accounts values('${ID}','${identity().email}','different-classification',now())`],
      ['other classified email',`insert into private.internal_test_accounts values('${ID}','other@example.invalid','${identity().source}',now())`],
      ['email classified to another ID',`insert into auth.users(id,email) values('${OTHER}','other@example.invalid');insert into private.internal_test_accounts values('${OTHER}','${identity().email}','different-classification',now())`],
    ];
    for(const [name,sql,args] of negatives) await t.test(`deny ${name} before any registry write`,()=>fixtureCase(db,async()=>{
      if(sql) await db.exec(sql);const before=await data(db),count=await writes(db);
      await assert.rejects(()=>register(db,args),error=>error.code==='P0001'&&/^Staging commercial fixture /.test(error.message));
      assert.deepEqual(await data(db),before);assert.deepEqual(await writes(db),count);
    }));
    for(const role of ['anon','authenticated']) await t.test(`${role} actual SET ROLE cannot call either entry point`,()=>fixtureCase(db,async()=>{
      const before=await data(db),count=await writes(db);
      for(const schema of ['public','private']) await assert.rejects(()=>register(db,{role,schema}),{code:'42501'});
      assert.deepEqual(await data(db),before);assert.deepEqual(await writes(db),count);
    }));
    await t.test('service role cannot bypass helper with direct registry write',()=>fixtureCase(db,async()=>{
      await assert.rejects(()=>call(db,'insert into private.internal_test_accounts(user_id,email_at_classification,classification_source) values($1,$2,$3)',[ID,identity().email,identity().source]),{code:'42501'});
    }));
    await t.test('registered then signed-in replay is denied without rewriting evidence',()=>fixtureCase(db,async()=>{
      await register(db);await db.exec('update auth.users set last_sign_in_at=now()');
      const before=await data(db),count=await writes(db);
      await assert.rejects(()=>register(db),/must precede sign-in/);
      assert.deepEqual(await data(db),before);assert.deepEqual(await writes(db),count);
    }));
    await t.test('exact migration replay preserves registered users and classifier',async()=>{
      await db.exec('begin');await seed(db);await register(db);await db.exec('commit');
      const before=await data(db),count=await writes(db);await db.exec(migration);
      assert.deepEqual(await data(db),before);assert.deepEqual(await writes(db),count);
    });
    for(const [name,change] of [
      ['private body',"create or replace function private.astra_register_staging_commercial_fixture(p_user_id uuid,p_run_id text,p_label text) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$"],
      ['public ACL','grant execute on function public.astra_register_staging_commercial_fixture(uuid,text,text) to authenticated'],
      ['wrapper volatility','alter function public.astra_register_staging_commercial_fixture(uuid,text,text) stable'],
      ['wrapper strict NULL bypass','alter function public.astra_register_staging_commercial_fixture(uuid,text,text) strict'],
      ['private leakproof','alter function private.astra_register_staging_commercial_fixture(uuid,text,text) leakproof'],
      ['wrapper parallel safety','alter function public.astra_register_staging_commercial_fixture(uuid,text,text) parallel safe'],
      ['service direct UPDATE','grant update on private.internal_test_accounts to service_role'],
      ['service column SELECT','grant select(email_at_classification) on private.internal_test_accounts to service_role'],
      ['anon DELETE','grant delete on private.internal_test_accounts to anon'],
      ['authenticated column REFERENCES','grant references(email_at_classification) on private.internal_test_accounts to authenticated'],
      ['private schema usage','revoke usage on schema private from service_role'],
    ]) await t.test(`migration refuses ${name} drift atomically`,async()=>{
      await db.exec('begin');try{
        await db.exec(change);
        const sql="select n.nspname,pg_get_functiondef(p.oid) body,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='astra_register_staging_commercial_fixture' order by n.nspname";
        const before=(await db.query(sql)).rows;await db.exec('savepoint migration_attempt');
        await assert.rejects(()=>db.exec(migration),/Staging commercial (registration (function collision or drift|prerequisite missing)|registry protection changed)/);
        await db.exec('rollback to savepoint migration_attempt');assert.deepEqual((await db.query(sql)).rows,before);
      }finally{await db.exec('rollback');}
    });
  } finally {await db.close();}
});

test('optional migration does not modify Forecast or Examination registration, product access or registry table grants',async()=>{
  const contract=await readFile(new URL('../scripts/astra-release-database-contract.mjs',import.meta.url),'utf8');
  assert.equal(contract.includes(migrationPath),false);
  assert.doesNotMatch(migration,/astra_register_staging_(?:forecast|examination)_fixture|grant\s+(?:all|insert|select|update|usage)\b/i);
  assert.equal((migration.match(/insert into private\.internal_test_accounts/gi)||[]).length,1);
  assert.doesNotMatch(migration,/insert into (?:auth|public)\.|update (?:auth|public|private)\.|delete from/i);
});

test('actual existing notification claim SQL and exact-row CAS have safe serial outcomes (not a multibackend race)',async t=>{
  const original=(await readFile(new URL('../supabase/migrations/20260821120000_soft_launch_five_token_trial.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const start=original.indexOf('create or replace function public.phase4_claim_payment_notification(');
  const end=original.indexOf('\n$$;',start); assert.ok(start>=0 && end>start);
  const db=new PGlite();
  try {
    // Minimal queue columns; production Auth/Storage/provider are deliberately not
    // simulated. Only the notification-context DTO sink is an explicit test stub.
    await db.exec(`create table public.payment_requests(id uuid primary key,user_id uuid not null,
      proof_sha256 text not null,status text not null,version integer not null,
      submitted_at timestamptz not null,verification_email_status text not null,
      verification_email_attempts integer not null,verification_email_last_attempt_at timestamptz,
      verification_email_error text,verification_email_provider_id text,verification_email_sent_at timestamptz);
      create function public.phase4_payment_notification_context(p_id uuid) returns jsonb language sql as $$
        select jsonb_build_object('id',p_id) $$;`);
    await db.exec(original.slice(start,end+4));
    const current=async()=>(await db.query('select to_jsonb(p) row from public.payment_requests p')).rows[0].row;
    async function cas(snapshot){
      const params=exactCommercialRowFilter(snapshot),args=[],clauses=[];
      // Translate the production helper's quoted scalar PostgREST filter to bound
      // SQL values. This tests PostgreSQL comparison/claim semantics, not hosted
      // REST parsing, permissions or a separate-session timing witness.
      for(const [column,filter] of params){
        if(filter==='is.null'){clauses.push(`"${column}" is null`);continue;}
        assert.ok(filter.startsWith('eq."')&&filter.endsWith('"'));
        args.push(filter.slice(4,-1).replace(/\\([\\"])/gu,'$1'));
        clauses.push(`"${column}"=$${args.length}`);
      }
      return (await db.query(`update public.payment_requests set verification_email_status='suppressed' where ${clauses.join(' and ')} returning id`,args)).rows;
    }
    async function scenario(callback){
      await db.exec('begin');try{
        await db.query(`insert into public.payment_requests values($1,$2,$3,'pending',1,clock_timestamp(),'pending',0,null,null,null,null)`,[ID,OTHER,'a'.repeat(64)]);
        await callback(await current());
      }finally{await db.exec('rollback');}
    }
    await t.test('CAS first prevents the extracted claim from taking a send intent',()=>scenario(async before=>{
      assert.equal((await cas(before)).length,1);
      assert.equal((await db.query('select public.phase4_claim_payment_notification($1) value',[ID])).rows[0].value,null);
      const after=await current();assert.equal(after.verification_email_status,'suppressed');assert.equal(after.verification_email_attempts,0);
    }));
    await t.test('claim first makes the stale CAS affect zero rows and preserves sending evidence',()=>scenario(async before=>{
      assert.deepEqual((await db.query('select public.phase4_claim_payment_notification($1) value',[ID])).rows[0].value,{id:ID});
      const claimed=await current();assert.equal(claimed.verification_email_attempts,1);
      assert.equal((await cas(before)).length,0);assert.deepEqual(await current(),claimed);
    }));
    for(const sql of["update public.payment_requests set verification_email_last_attempt_at=clock_timestamp()",
      "update public.payment_requests set verification_email_provider_id='synthetic-provider'",
      "update public.payment_requests set status='approved',version=2",
      "update public.payment_requests set proof_sha256=repeat('b',64)"])
      await t.test(`exact CAS rejects drift: ${sql.split(' set ')[1].split('=')[0]}`,()=>scenario(async before=>{
        await db.exec(sql);const drift=await current();assert.equal((await cas(before)).length,0);assert.deepEqual(await current(),drift);
      }));
  }finally{await db.close();}
});
