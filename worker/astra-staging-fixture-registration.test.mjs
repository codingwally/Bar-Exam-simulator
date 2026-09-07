import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const migrationPath = 'supabase/migrations/20260907190944_astra_staging_fixture_registration.sql';
const migration = await readFile(new URL(`../${migrationPath}`, import.meta.url), 'utf8');
const runner = (await readFile(new URL('../scripts/verify-astra-forecast-staging.mjs', import.meta.url), 'utf8')).replaceAll('\r\n','\n');
const history = (await readFile(new URL('../supabase/migrations/20260828095004_internal_test_account_reporting_scope.sql', import.meta.url), 'utf8')).replaceAll('\r\n','\n');
const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const PREFIX = 'astra-durable-1788800000000-abcdef12';
const email = kind => `${PREFIX}-${kind}@example.com`;
const SOURCE = kind => `astra_durable_staging_v1:${PREFIX}:${kind}`;

function originalFunction(name) {
  const start = history.indexOf(`create or replace function private.${name}(`);
  const end = history.indexOf('\n$$;',start);
  assert.ok(start >= 0 && end > start);
  return history.slice(start,end+4);
}
async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private;
      grant usage on schema private to service_role;
      create table auth.users(id uuid primary key, aud text default 'authenticated',role text default 'authenticated',
        email text, is_super_admin boolean default false,is_anonymous boolean default false,is_sso_user boolean default false,
        deleted_at timestamptz,email_confirmed_at timestamptz default now(),created_at timestamptz default now(),
        last_sign_in_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id));
      create table auth.refresh_tokens(user_id text);
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text);
      create table public.admin_capabilities(user_id uuid references auth.users(id),revoked_at timestamptz);
      create table public.subscriptions(user_id uuid references auth.users(id));
      create table public.payment_requests(user_id uuid references auth.users(id));
      create table public.free_beta_access(user_id uuid references auth.users(id));
    `);
    await db.exec(history.slice(history.indexOf('create table if not exists private.internal_test_accounts ('),
      history.indexOf('create or replace function private.require_admin_data_scope(')));
    await db.exec(originalFunction('require_admin_data_scope'));
    await db.exec(originalFunction('admin_reporting_scope_matches'));
    await db.exec(`create sequence private.registration_write_attempts;
      create function private.count_registration_write() returns trigger language plpgsql as $$
      begin perform nextval('private.registration_write_attempts'); return new; end; $$;
      create trigger local_registration_write before insert or update on private.internal_test_accounts
        for each row execute function private.count_registration_write();`);
    await db.exec(migration);
    return db;
  } catch(error) { await db.close(); throw error; }
}
async function seed(db,kind='member') {
  await db.query(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)`,
    [ID,email(kind),{provider:'email',providers:['email'],astra_staging_fixture:{version:1,prefix:PREFIX,kind}},
      {internal_test:true,astra_fixture_prefix:PREFIX}]);
  await db.query("insert into public.user_roles values($1,'student')",[ID]);
}
async function data(db) {
  const result = {};
  for(const table of ['auth.users','auth.sessions','auth.refresh_tokens','public.user_roles','public.admin_capabilities',
    'public.subscriptions','public.payment_requests','public.free_beta_access','private.internal_test_accounts']) {
    result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as value from ${table} t`)).rows[0].value;
  }
  return result;
}
async function writes(db) { return (await db.query('select last_value,is_called from private.registration_write_attempts')).rows; }
async function scopedCall(db,sql,args=[],role='service_role') {
  assert.ok(['service_role','anon','authenticated'].includes(role));
  await db.exec(`savepoint scoped_call; set local role ${role};`);
  try {
    const result=await db.query(sql,args);
    await db.exec('reset role; release savepoint scoped_call;');
    return result;
  } catch(error) {
    await db.exec('rollback to savepoint scoped_call; release savepoint scoped_call;');
    throw error;
  }
}
async function register(db,{id=ID,prefix=PREFIX,kind='member',role='service_role',schema='public'}={}) {
  assert.ok(['public','private'].includes(schema));
  return (await scopedCall(db,`select ${schema}.astra_register_staging_forecast_fixture($1::uuid,$2::text,$3::text) as value`,[id,prefix,kind],role)).rows[0].value;
}
async function fixtureCase(db,callback,kind='member') {
  await db.exec('begin');
  try { await seed(db,kind); await callback(); }
  finally { await db.exec('rollback'); }
}

test('service-only registration uses actual local SQL without changing table grants or account state',async t=>{
  const db=await setup();
  try {
    await t.test('wrapper invoker/private definer ACL and registry protection',async()=>{
      const rows=(await db.query(`select n.nspname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
        has_function_privilege('anon',p.oid,'EXECUTE') anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') service
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.proname='astra_register_staging_forecast_fixture' order by n.nspname`)).rows;
      assert.equal(rows.length,2);
      for(const row of rows) {
        assert.equal(row.prosecdef,row.nspname==='private'); assert.equal(row.owner,'postgres');
        assert.deepEqual(row.proconfig,['search_path=""']);
        assert.equal(row.anon,false); assert.equal(row.authenticated,false); assert.equal(row.service,true);
      }
      const protection=(await db.query(`select relrowsecurity,relforcerowsecurity,
        has_table_privilege('service_role',oid,'INSERT') service_insert,
        has_table_privilege('service_role',oid,'SELECT') service_select,
        has_table_privilege('service_role',oid,'UPDATE') service_update,
        has_any_column_privilege('authenticated',oid,'INSERT') authenticated_insert
        from pg_class where oid='private.internal_test_accounts'::regclass`)).rows[0];
      assert.deepEqual(protection,{relrowsecurity:true,relforcerowsecurity:true,service_insert:false,service_select:false,service_update:false,authenticated_insert:false});
    });
    for(const kind of ['member','other','unpaid']) await t.test(`${kind}: exact pre-sign-in registration and replay preserve immutable evidence`,()=>fixtureCase(db,async()=>{
      const before=await data(db);
      const scopeBefore=(await db.query("select private.admin_reporting_scope_matches($1,'regular') value",[ID])).rows[0].value;
      assert.equal(scopeBefore,true,'editable metadata alone is not reporting authority');
      const value=await register(db,{kind});
      assert.deepEqual(value,{registered:true,fixtureUserId:ID,dataScope:'internal_test',registrationVersion:'astra-staging-forecast-v1',replayed:false});
      const after=await data(db);
      assert.equal(after['private.internal_test_accounts'].length,1);
      assert.equal(after['private.internal_test_accounts'][0].classification_source,SOURCE(kind));
      for(const name of Object.keys(before).filter(name=>name!=='private.internal_test_accounts')) assert.deepEqual(after[name],before[name]);
      const count=await writes(db);
      assert.equal((await register(db,{kind})).replayed,true);
      assert.deepEqual(await data(db),after); assert.deepEqual(await writes(db),count);
      const scope=(await db.query("select private.admin_reporting_scope_matches($1,'regular') regular,private.admin_reporting_scope_matches($1,'internal_test') internal",[ID])).rows[0];
      assert.deepEqual(scope,{regular:false,internal:true});
    },kind));

    const negatives=[
      ['NULL identity',null,{id:null}],['missing identity',null,{id:OTHER}],
      ['NULL prefix',null,{prefix:null}],['production prefix',null,{prefix:'astra-forecast-live-production-1788800000000-abcdef12'}],
      ['uppercase or extended prefix',null,{prefix:PREFIX.toUpperCase()}],['prefix suffix newline',null,{prefix:PREFIX+'\n'}],
      ['NULL kind',null,{kind:null}],['unknown kind',null,{kind:'admin'}],['wrong kind/email',null,{kind:'unpaid'}],
      ['missing trusted marker',"update auth.users set raw_app_meta_data=raw_app_meta_data-'astra_staging_fixture'"],
      ['marker only in user metadata',"update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('astra_staging_fixture',raw_app_meta_data->'astra_staging_fixture'),raw_app_meta_data=raw_app_meta_data-'astra_staging_fixture'"],
      ['different trusted prefix',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{astra_staging_fixture,prefix}','\"other\"')"],
      ['different trusted kind',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{astra_staging_fixture,kind}','\"unpaid\"')"],
      ['wrong marker version',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{astra_staging_fixture,version}','2')"],
      ['extra privileged app claim',"update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"admin\":true}'::jsonb"],
      ['different provider',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{provider}','\"google\"')"],
      ['additional provider',"update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{providers}','[\"email\",\"google\"]')"],
      ['cleanup marker mismatch',"update auth.users set raw_user_meta_data='{}'::jsonb"],
      ['customer email',"update auth.users set email='synthetic-customer@example.invalid'"],
      ['unconfirmed email',"update auth.users set email_confirmed_at=null"],
      ['old account',"update auth.users set created_at=now()-interval '16 minutes'"],
      ['future account',"update auth.users set created_at=now()+interval '2 minutes'"],
      ['anonymous account',"update auth.users set is_anonymous=true"],
      ['super-admin Auth flag',"update auth.users set is_super_admin=true"],
      ['SSO account',"update auth.users set is_sso_user=true"],
      ['deleted account',"update auth.users set deleted_at=now()"],
      ['wrong Auth role',"update auth.users set role='service_role'"],
      ['missing role',"delete from public.user_roles"],['NULL role',"update public.user_roles set role=null"],
      ...['admin','founder_admin','super_admin'].map(role=>[`${role} role`,`update public.user_roles set role='${role}'`]),
      ['active capability',`insert into public.admin_capabilities values('${ID}',null)`],
      ['revoked capability history',`insert into public.admin_capabilities values('${ID}',now())`],
      ['payment evidence',`insert into public.payment_requests values('${ID}')`],
      ['subscription',`insert into public.subscriptions values('${ID}')`],
      ['prior free-beta grant',`insert into public.free_beta_access values('${ID}')`],
      ['already signed in',"update auth.users set last_sign_in_at=now()"],
      ['session without last-sign-in',`insert into auth.sessions(user_id) values('${ID}')`],
      ['refresh token without last-sign-in',`insert into auth.refresh_tokens values('${ID}')`],
      ['existing other classification',`insert into private.internal_test_accounts values('${ID}','${email('member')}','owner_allowlist_20260828',now())`],
      ['existing different classified email',`insert into private.internal_test_accounts values('${ID}','different@example.invalid','${SOURCE('member')}',now())`],
      ['same classification email owned elsewhere',`insert into auth.users(id,email) values('${OTHER}','different@example.invalid'); insert into private.internal_test_accounts values('${OTHER}','${email('member')}','other_fixture',now())`],
    ];
    for(const [name,sql,args] of negatives) await t.test(`reject ${name} before classification write`,()=>fixtureCase(db,async()=>{
      if(sql) await db.exec(sql);
      const before=await data(db),count=await writes(db);
      await assert.rejects(()=>register(db,args),error=>error.code==='P0001' && /^Staging fixture /.test(error.message));
      assert.deepEqual(await data(db),before); assert.deepEqual(await writes(db),count);
    }));
    for(const role of ['anon','authenticated']) await t.test(`${role} cannot reach public or private registration`,()=>fixtureCase(db,async()=>{
      const before=await data(db),count=await writes(db);
      for(const schema of ['public','private']) await assert.rejects(()=>register(db,{role,schema}),{code:'42501'});
      assert.deepEqual(await data(db),before); assert.deepEqual(await writes(db),count);
    }));
    await t.test('service role still cannot directly write registry',()=>fixtureCase(db,async()=>{
      await assert.rejects(()=>scopedCall(db,'insert into private.internal_test_accounts(user_id,email_at_classification,classification_source) values($1,$2,$3)',[ID,email('member'),SOURCE('member')]),{code:'42501'});
    }));
    await t.test('replay after sign-in cannot retrospectively reclassify or rewrite evidence',()=>fixtureCase(db,async()=>{
      await register(db); await db.exec('update auth.users set last_sign_in_at=now()');
      const before=await data(db),count=await writes(db);
      await assert.rejects(()=>register(db),/must precede sign-in/);
      assert.deepEqual(await data(db),before); assert.deepEqual(await writes(db),count);
    }));
    await t.test('migration rerun retains existing classification and all account rows',async()=>{
      await db.exec('begin'); await seed(db); await register(db); await db.exec('commit');
      const before=await data(db),count=await writes(db);
      await db.exec(migration);
      assert.deepEqual(await data(db),before); assert.deepEqual(await writes(db),count);
    });
    for(const [name,change] of [
      ['private body',"create or replace function private.astra_register_staging_forecast_fixture(p_user_id uuid,p_fixture_prefix text,p_fixture_kind text) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$"],
      ['public ACL','grant execute on function public.astra_register_staging_forecast_fixture(uuid,text,text) to authenticated'],
      ['registry ACL','grant insert on private.internal_test_accounts to service_role'],
      ['registry UPDATE ACL','grant update on private.internal_test_accounts to service_role'],
      ['registry column SELECT ACL','grant select(email_at_classification) on private.internal_test_accounts to service_role'],
      ['missing existing schema usage','revoke usage on schema private from service_role'],
    ]) await t.test(`migration refuses ${name} drift without overwriting it`,async()=>{
      await db.exec('begin');
      try {
        await db.exec(change);
        const before=(await db.query("select pg_get_functiondef('private.astra_register_staging_forecast_fixture(uuid,text,text)'::regprocedure) body,proacl::text acl from pg_proc where oid='public.astra_register_staging_forecast_fixture(uuid,text,text)'::regprocedure")).rows;
        await db.exec('savepoint migration_attempt');
        await assert.rejects(()=>db.exec(migration),/Staging registration (function collision or drift|registry protection changed|deployment prerequisite missing)/);
        await db.exec('rollback to savepoint migration_attempt');
        assert.deepEqual((await db.query("select pg_get_functiondef('private.astra_register_staging_forecast_fixture(uuid,text,text)'::regprocedure) body,proacl::text acl from pg_proc where oid='public.astra_register_staging_forecast_fixture(uuid,text,text)'::regprocedure")).rows,before);
      } finally {await db.exec('rollback');}
    });
  } finally { await db.close(); }
});

const functionStart=runner.indexOf('  async function createFixture(kind, entitled) {');
const functionEnd=runner.indexOf('\n  async function startBrowser(',functionStart);
assert.ok(functionStart>=0 && functionEnd>functionStart);
const fixtureSource=runner.slice(functionStart,functionEnd);
async function actualCreator({registrationError=false,registrationResponse,entitled=false,kind='member'}={}) {
  const calls=[],fixtures=[];
  const scope={assert,prefix:PREFIX,fixtures,
    randomBytes:()=>({toString:()=> 'synthetic-local-password-material'}),
    assertFixtureRecord:record=>{assert.equal(record.id,ID);assert.equal(record.email,email(kind));},
    persistManifest:async()=>{calls.push('manifest');assert.equal(fixtures.length,1);},
    service:async(route,options={})=>{
      if(route==='/auth/v1/admin/users') {
        calls.push('admin-create'); const body=JSON.parse(options.body);
        assert.deepEqual(body.app_metadata,{astra_staging_fixture:{version:1,prefix:PREFIX,kind}});
        return {id:ID};
      }
      if(route==='/rest/v1/rpc/astra_register_staging_forecast_fixture') {
        calls.push('register');assert.deepEqual(JSON.parse(options.body),{p_user_id:ID,p_fixture_prefix:PREFIX,p_fixture_kind:kind});
        if(registrationError) throw new Error('Local registration transport failure');
        return registrationResponse||{registered:true,fixtureUserId:ID,dataScope:'internal_test',registrationVersion:'astra-staging-forecast-v1',replayed:false};
      }
      if(route.startsWith('/rest/v1/platform_access_settings')) { calls.push('policy');return [{current_terms_version:'test-terms',current_privacy_version:'test-privacy'}]; }
      if(route==='/rest/v1/free_beta_access?on_conflict=user_id') { calls.push('beta');return null; }
      throw new Error('Unexpected fixture service operation');
    },
    safeRequest:async(url)=>{
      assert.ok(url.startsWith('https://hlzqmreeoghbldnhlybr.supabase.co/'));
      if(url.includes('/auth/v1/token?grant_type=password')) { calls.push('sign-in');return {body:{user:{id:ID},access_token:'synthetic-token'}}; }
      assert.ok(url.endsWith('/rpc/accept_terms'));calls.push('terms');return {};
    },
    TARGET:{site:'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',supabase:'https://hlzqmreeoghbldnhlybr.supabase.co'},
    publishable:'synthetic-publishable',
    completeMandatoryCommercialProfile:async()=>{calls.push('profile');},
    api:async()=>{calls.push('consent');},CONSENT:'synthetic-consent',
    kind,entitled,
  };
  let error;
  try { await runInNewContext(`${fixtureSource}\ncreateFixture(kind,entitled);`,scope); }
  catch(caught) { error=caught; }
  return {calls,fixtures,error};
}
test('actual fixture creator persists, registers, then signs in before unchanged onboarding',async()=>{
  for(const kind of ['member','other','unpaid']) {
    const result=await actualCreator({kind,entitled:kind==='member'});
    assert.equal(result.error,undefined);
    assert.deepEqual(result.calls,kind==='member'
      ? ['admin-create','manifest','register','sign-in','policy','terms','profile','beta','consent']
      : ['admin-create','manifest','register','sign-in','policy','terms','profile']);
  }
});
test('registration error or bad acknowledgment preserves cleanup identity and prevents sign-in',async()=>{
  for(const options of [{registrationError:true},...[{registered:false},{fixtureUserId:OTHER},{dataScope:'regular'},
    {registrationVersion:'unknown'},{replayed:undefined}].map(delta=>({registrationResponse:{registered:true,fixtureUserId:ID,
      dataScope:'internal_test',registrationVersion:'astra-staging-forecast-v1',replayed:false,...delta}}))]) {
    const result=await actualCreator(options); assert.ok(result.error);
    assert.deepEqual(result.calls,['admin-create','manifest','register']);assert.equal(result.fixtures.length,1);
  }
});
test('exact accepted registration replay continues without a second account or registration attempt',async()=>{
  const result=await actualCreator({registrationResponse:{registered:true,fixtureUserId:ID,dataScope:'internal_test',registrationVersion:'astra-staging-forecast-v1',replayed:true}});
  assert.equal(result.error,undefined);assert.equal(result.calls.filter(x=>x==='register').length,1);
  assert.equal(result.calls.filter(x=>x==='admin-create').length,1);
});
test('hard staging target and mandatory gate remain intact; no production bundle expansion',async()=>{
  assert.match(runner,/ref: 'hlzqmreeoghbldnhlybr'/);
  const mandatory=await readFile(new URL('../.github/workflows/validate-mandatory-early-access.yml',import.meta.url),'utf8');
  assert.ok(mandatory.includes(`- '${migrationPath}'`));assert.ok(mandatory.includes("- 'worker/astra-*.test.mjs'"));
  assert.ok(mandatory.includes('node --test --test-concurrency=1 worker/*.test.mjs'));
  const contract=await readFile(new URL('../scripts/astra-release-database-contract.mjs',import.meta.url),'utf8');
  assert.equal(contract.includes(migrationPath),false);
  assert.doesNotMatch(migration,/grant\s+(?:all|insert|select|update|usage)\b/i);
  assert.equal((migration.match(/insert into private\.internal_test_accounts/gi)||[]).length,1);
  assert.doesNotMatch(migration,/insert into (?:auth|public)\.|update (?:auth|public|private)\.|delete from/i);
});

test('actual no-identity preflight requires exact RPC denial before any fixture creation',async()=>{
  const start=runner.indexOf('  async function preflightFixtureRegistration() {');
  const end=runner.indexOf('\n  async function createFixture(',start);
  assert.ok(start>=0 && end>start);
  assert.ok(runner.indexOf('    await preflightFixtureRegistration();') < runner.indexOf("    stage = 'fixture-provisioning';"));
  const source=runner.slice(start,end);
  for(const outcome of ['valid','missing','no_execute','wrong_message','unexpected_success']) {
    let calls=0;
    const scope={assert,service:async(route,options,statuses)=>{
      calls++;assert.equal(route,'/rest/v1/rpc/astra_register_staging_forecast_fixture');
      assert.deepEqual(JSON.parse(options.body),{p_user_id:null,p_fixture_prefix:null,p_fixture_kind:null});
      assert.deepEqual(Array.from(statuses),[400]);
      if(outcome==='missing') throw new Error('Local missing RPC');
      if(outcome==='no_execute') return {code:'42501',message:'permission denied'};
      if(outcome==='wrong_message') return {code:'P0001',message:'unexpected failure'};
      if(outcome==='unexpected_success') return {registered:true};
      return {code:'P0001',message:'Staging fixture identity is invalid'};
    }};
    const request=()=>runInNewContext(`${source}\npreflightFixtureRegistration();`,scope);
    if(outcome==='valid') await request(); else await assert.rejects(request);
    assert.equal(calls,1);
  }
});
