import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

// Real migration and real hardened administrator helper, disposable in-memory
// PostgreSQL only. Minimal Auth/role dependency schema, NOT hosted concurrency,
// LiveKit token revocation, paid-entitlement or provider transport proof.
const require = createRequire(new URL('../worker/package.json', import.meta.url));
const { PGlite } = require(process.env.ASTRA_PGLITE_MODULE || '@electric-sql/pglite');
const migrationName = '20260908144814_astra_study_room_persisted_catalog.sql';
const read = async name => (await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const migration = await read(migrationName);
const original = await read('20260730_005_phase4_access_subscriptions.sql');
const start = original.indexOf('create or replace function public.admin_authorization_context(');
assert.ok(start >= 0);
const end = original.indexOf('\n$$;', start);
assert.ok(end > start);
const beforeHelper = original.slice(start, end + 4);
const oldAnchor = "if v_role not in ('admin', 'founder_admin', 'super_admin') then";
assert.equal(beforeHelper.split(oldAnchor).length, 2);
const helper = beforeHelper.replace(oldAnchor, "if v_role is null or v_role not in ('admin', 'founder_admin', 'super_admin') then");
const innerMigration = migration.replace(/^begin;\n/m, '').replace(/^commit;\n?$/m, '');
assert.equal(migration.match(/^begin;$/gm)?.length, 1);
assert.equal(migration.match(/^commit;$/gm)?.length, 1);
const actor = Object.fromEntries(['student', 'admin', 'founder_admin', 'super_admin', 'missing', 'null', 'unknown']
  .map((role, index) => [role, `b0800000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const expectedSeed = [
  ['1', 'Library', 'all'], ['2', 'Room 1', 'all'], ['3', 'Room 2', 'all'],
  ['4', 'Room 3', 'all'], ['5', 'Inner Chamber', 'admin'], ['6', 'Room 4', 'all'],
].map(([roomKey, label, audience]) => ({ roomKey, label, audience, revision: 1, accessRevision: 1 }));
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const snapshot = async db => scalar(db, `select jsonb_build_object(
  'auth',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
  'roles',(select jsonb_agg(to_jsonb(t) order by user_id) from public.user_roles t),
  'capabilities',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.admin_capabilities t),
  'billing',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.catalog_test_billing t),
  'helper',(select jsonb_build_object('definition',pg_get_functiondef(p.oid),'catalog',to_jsonb(p)-'oid')
    from pg_proc p where p.oid='public.admin_authorization_context(uuid)'::regprocedure))`);
const catalogRows = async db => scalar(db, "select jsonb_agg(to_jsonb(t) order by room_key) from private.study_room_catalog t");
const auditRows = async db => scalar(db, "select coalesce(jsonb_agg(to_jsonb(t) order by room_key,revision),'[]') from private.study_room_catalog_audit t");
async function asRole(db, role, sql, args = []) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`savepoint rpc_call; set local role ${role}`);
  try {
    const result = await db.query(sql, args);
    await db.exec('reset role; release savepoint rpc_call');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint rpc_call; release savepoint rpc_call');
    throw error;
  }
}
const get = async (db, role = 'service_role', schema = 'public') =>
  (await asRole(db, role, `select ${schema}.study_room_catalog_v1() as value`)).rows[0].value;
const configure = async (db, args = [], role = 'service_role', schema = 'public') =>
  (await asRole(db, role, `select ${schema}.study_room_configure_v1($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::integer) as value`,
    args.length ? args : [actor.admin, 'add', '7', 'New Study Room', 'all', 0])).rows[0].value;
const rejects = (fn, code, message) => assert.rejects(fn, e => e.code === code && (!message || e.message === message));
async function isolated(db, callback) {
  await db.exec('begin');
  try { await callback(); } finally { await db.exec('rollback'); }
}

test('persisted Study Room catalog uses actual SQL and least-privilege service RPCs', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; grant usage on schema private to service_role;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text);
      create table public.admin_capabilities(user_id uuid references auth.users(id),capability text,revoked_at timestamptz);
      create table public.catalog_test_billing(user_id uuid references auth.users(id),value jsonb);
      ${helper}
      revoke all on function public.admin_authorization_context(uuid) from public,anon,authenticated;
      grant execute on function public.admin_authorization_context(uuid) to service_role;`);
    for (const [role, id] of Object.entries(actor)) {
      await db.query('insert into auth.users(id,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3)',
        [id, {role:'super_admin'}, {role:'super_admin'}]);
      if (role !== 'missing') await db.query('insert into public.user_roles values($1,$2)', [id, role === 'null' ? null : role]);
    }
    await db.query('insert into public.catalog_test_billing values($1,$2)', [actor.student, {untouched:true}]);
    const protectedBefore = await snapshot(db);
    await t.test('source is fresh-only, bounded and does not replace old SQL or widen schema privileges', async () => {
      assert.match(migration, /set local lock_timeout = '5s'/);
      assert.match(migration, /set local statement_timeout = '30s'/);
      assert.doesNotMatch(migration, /create or replace|alter default privileges|grant .* on schema|delete from|update (?:public|auth)\./i);
      assert.equal(await scalar(db, "select encode(sha256(convert_to(replace(pg_get_functiondef('public.admin_authorization_context(uuid)'::regprocedure),E'\\r\\n',E'\\n'),'UTF8')),'hex')"),
        '56834a7e84a3d9345447132ad56579d121761ca748e4075ff5904587c1a2c3a9');
    });
    await t.test('migration refuses a pre-existing overload before creating tables', async () => {
      await db.exec('begin');
      try {
        await db.exec("create function public.study_room_catalog_v1(text) returns text language sql as $$select $1$$; savepoint attempted_install");
        await rejects(() => db.exec(innerMigration), 'P0001', 'STUDY_ROOM_CATALOG_ALREADY_EXISTS');
        await db.exec('rollback to savepoint attempted_install');
        assert.equal(await scalar(db, "select to_regclass('private.study_room_catalog') is null"), true);
      } finally { await db.exec('rollback'); }
    });
    await t.test('migration refuses administrator source drift without modifying anything', async () => {
      await db.exec('begin');
      try {
        await db.exec(helper.replace("'authorized', true", "'authorized', false"));
        await db.exec('savepoint attempted_install');
        await rejects(() => db.exec(innerMigration), 'P0001', 'STUDY_ROOM_ADMIN_PREREQUISITE_DRIFT');
        await db.exec('rollback to savepoint attempted_install');
        assert.equal(await scalar(db, "select to_regclass('private.study_room_catalog') is null"), true);
      } finally { await db.exec('rollback'); }
    });
    await t.test('raw CRLF migration installs six exact seeds without changing accounts/helper/billing', async () => {
      await db.exec(migration.replaceAll('\n', '\r\n'));
      assert.deepEqual(await snapshot(db), protectedBefore);
      await isolated(db, async () => {
        assert.deepEqual(await get(db), {schemaVersion:1,maxRooms:24,rooms:expectedSeed});
        assert.deepEqual(await auditRows(db), []);
      });
    });
    const seedRows = await catalogRows(db);
    await t.test('already-installed migration refuses atomically and preserves seeds', async () => {
      await db.exec('begin; savepoint attempted_install');
      try {
        await rejects(() => db.exec(innerMigration), 'P0001', 'STUDY_ROOM_CATALOG_ALREADY_EXISTS');
        await db.exec('rollback to savepoint attempted_install');
        assert.deepEqual(await catalogRows(db), seedRows);
      } finally { await db.exec('rollback'); }
    });
    await t.test('private tables force RLS with no policies or direct table/column grants', async () => {
      const rows = (await db.query(`select c.relname,c.relrowsecurity,c.relforcerowsecurity,
        (select count(*)::int from pg_policy where polrelid=c.oid) policies,
        exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          where a.grantee<>c.relowner) extra_acl,
        exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and a.attacl is not null) column_acl
        from pg_class c where c.oid in ('private.study_room_catalog'::regclass,'private.study_room_catalog_audit'::regclass)
        order by c.relname`)).rows;
      assert.equal(rows.length,2);
      for (const row of rows) assert.deepEqual(row, {relname:row.relname,relrowsecurity:true,relforcerowsecurity:true,policies:0,extra_acl:false,column_acl:false});
    });
    await t.test('public invoker/private definer routines have empty path and exact service-only ACL', async () => {
      const rows = (await db.query(`select n.nspname,p.proname,p.prosecdef,p.provolatile,p.proconfig,
        pg_get_userbyid(p.proowner) owner,p.proacl::text acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('private','public') and p.proname in ('study_room_catalog_v1','study_room_configure_v1')`)).rows;
      assert.equal(rows.length,4);
      for (const row of rows) {
        assert.equal(row.owner,'postgres');
        assert.equal(row.prosecdef,row.nspname==='private');
        assert.equal(row.provolatile,row.proname==='study_room_catalog_v1'?'s':'v');
        assert.deepEqual(row.proconfig,row.nspname==='private'&&row.proname==='study_room_configure_v1'
          ? ['search_path=""','lock_timeout=3s'] : ['search_path=""']);
        assert.equal(row.acl,'{postgres=X/postgres,service_role=X/postgres}');
      }
    });
    for (const role of ['anon','authenticated']) for (const schema of ['public','private']) {
      await t.test(`${role} cannot execute ${schema} getter or mutator, even with administrator UUID`, async () => isolated(db, async () => {
        await rejects(() => get(db,role,schema),'42501');
        await rejects(() => configure(db,[],role,schema),'42501');
      }));
    }
    for (const role of ['anon','authenticated','service_role']) {
      await t.test(`${role} cannot directly read/change either private table despite bypass role`, async () => isolated(db, async () => {
        for (const table of ['study_room_catalog','study_room_catalog_audit']) {
          for (const statement of [`select * from private.${table}`,`delete from private.${table}`])
            await rejects(() => asRole(db,role,statement),'42501');
        }
        await rejects(() => asRole(db,role,"update private.study_room_catalog set audience='all' where room_key=5"),'42501');
      }));
    }
    for (const role of ['student','missing','null','unknown']) {
      await t.test(`${role} authoritative role cannot configure despite administrator metadata`, async () => isolated(db, async () => {
        await rejects(() => configure(db,[actor[role],'add','7','Room New','all',0]),'42501','STUDY_ROOM_ADMIN_REQUIRED');
        assert.deepEqual(await catalogRows(db),seedRows);
        assert.deepEqual(await auditRows(db),[]);
      }));
    }
    await t.test('NULL actor cannot configure', async () => isolated(db, async () => {
      await rejects(() => configure(db,[null,'add','7','Room New','all',0]),'42501','STUDY_ROOM_ADMIN_REQUIRED');
    }));
    for (const role of ['admin','founder_admin','super_admin']) {
      await t.test(`${role} can add exact vacant key once with atomic private audit`, async () => isolated(db, async () => {
        const result = await configure(db,[actor[role],'add','7','  Members Room  ','all',0]);
        assert.deepEqual(result,{ok:true,room:{roomKey:'7',label:'Members Room',audience:'all',revision:1,accessRevision:1}});
        const audit = await auditRows(db);
        assert.equal(audit.length,1); assert.equal(audit[0].actor_user_id,actor[role]);
        assert.equal(audit[0].before_value,null); assert.equal(audit[0].after_value.room_key,7);
        await rejects(() => configure(db,[actor[role],'add','7','Members Room','all',0]),'PT409','STUDY_ROOM_CONFIG_CONFLICT');
        assert.equal((await get(db)).rooms.length,7);
        assert.equal((await auditRows(db)).length,1);
      }));
    }
    await t.test('rename keeps access generation; audience changes advance only that generation', async () => isolated(db, async () => {
      assert.deepEqual((await configure(db,[actor.admin,'update','2','Renamed Room','all',1])).room,
        {roomKey:'2',label:'Renamed Room',audience:'all',revision:2,accessRevision:1});
      assert.deepEqual((await configure(db,[actor.admin,'update','2','Renamed Room','paid',2])).room,
        {roomKey:'2',label:'Renamed Room',audience:'paid',revision:3,accessRevision:2});
      assert.deepEqual((await configure(db,[actor.admin,'update','2','Renamed Room','admin',3])).room,
        {roomKey:'2',label:'Renamed Room',audience:'admin',revision:4,accessRevision:3});
      assert.equal((await configure(db,[actor.admin,'update','2','Renamed Room','all',4])).room.accessRevision,4);
      assert.equal((await auditRows(db)).length,4);
      assert.equal((await get(db)).rooms[1].roomKey,'2');
    }));
    await t.test('unchanged exact revision is a no-op; stale and missing revisions cannot overwrite', async () => isolated(db, async () => {
      assert.deepEqual((await configure(db,[actor.admin,'update','2','Room 1','all',1])).room,expectedSeed[1]);
      assert.deepEqual(await auditRows(db),[]);
      await configure(db,[actor.admin,'update','2','First administrator','all',1]);
      await rejects(() => configure(db,[actor.super_admin,'update','2','Second administrator','paid',1]),'PT409','STUDY_ROOM_CONFIG_CONFLICT');
      await rejects(() => configure(db,[actor.admin,'update','7','Missing Room','all',1]),'PT409','STUDY_ROOM_CONFIG_CONFLICT');
      assert.equal((await auditRows(db)).length,1);
    }));
    await t.test('Inner Chamber remains admin regardless rename and invalid direct policy fails CHECK', async () => isolated(db, async () => {
      assert.equal((await configure(db,[actor.admin,'update','5','Renamed Chamber','admin',1])).room.accessRevision,1);
      for(const audience of ['all','paid']) await rejects(() => configure(db,[actor.admin,'update','5','Renamed Chamber',audience,2]),'PT400','STUDY_ROOM_CONFIG_INVALID');
      await db.exec('savepoint invalid_direct');
      await rejects(() => db.exec("update private.study_room_catalog set audience='all' where room_key=5"),'23514');
      await db.exec('rollback to savepoint invalid_direct;release savepoint invalid_direct');
    }));
    await t.test('Library identity never changes through label/audience edit', async () => isolated(db, async () => {
      const room=(await configure(db,[actor.admin,'update','1','Quiet Library','paid',1])).room;
      assert.deepEqual(room,{roomKey:'1',label:'Quiet Library',audience:'paid',revision:2,accessRevision:2});
      // Kind/microphone derive from immutable key in Worker, never a stored client field.
      assert.deepEqual(Object.keys(room).sort(),['accessRevision','audience','label','revision','roomKey']);
    }));
    const invalids = [
      ['add','6','Room','all',0],['add','7','Room','all',1],['update','2','Room','all',0],
      ['delete','2','Room','all',1],[null,'7','Room','all',0],['add',null,'Room','all',0],
      ['add','0','Room','all',0],['add','25','Room','all',0],['add','07','Room','all',0],
      ['add',' 7','Room','all',0],['add','7;select','Room','all',0],
      ['add','7',null,'all',0],['add','7','x','all',0],['add','7','x'.repeat(65),'all',0],
      ['add','7','x'.repeat(129),'all',0],['add','7','<b>Room</b>','all',0],
      ['add','7','Room\nOther','all',0],['add','7','Room\tOther','all',0],
      ['add','7','Room\u202eOther','all',0],['add','7','Room/Other','all',0],
      ['add','7','Room',null,0],['add','7','Room','beta',0],['add','7','Room','ALL',0],
      ['add','7','Room','all',null],['add','7','Room','all',-1],
    ];
    for (const [index, args] of invalids.entries()) {
      await t.test(`invalid operation/key/label/audience/revision ${index+1} makes no metadata/audit write`, async () => isolated(db, async () => {
        await rejects(() => configure(db,[actor.admin,...args]),'PT400','STUDY_ROOM_CONFIG_INVALID');
        assert.deepEqual(await catalogRows(db),seedRows); assert.deepEqual(await auditRows(db),[]);
      }));
    }
    await t.test('allowed label punctuation survives as data and maximum remains 24 explicit keys', async () => isolated(db, async () => {
      const label="Readers' Room (A) & Co., Study-2_";
      assert.equal((await configure(db,[actor.admin,'add','7',label,'all',0])).room.label,label);
      for(let key=8;key<=24;key++) await configure(db,[actor.admin,'add',String(key),`Room ${key}`,'all',0]);
      const result=await get(db);
      assert.equal(result.rooms.length,24);
      assert.deepEqual(result.rooms.map(r=>Number(r.roomKey)),Array.from({length:24},(_,i)=>i+1));
      await rejects(() => configure(db,[actor.admin,'add','25','Overflow Room','all',0]),'PT400');
      assert.equal((await auditRows(db)).length,18);
    }));
    await t.test('existing helper is actually called and a false authorization result is rejected', async () => isolated(db, async () => {
      await db.exec(helper.replace("'authorized', true", "'authorized', false"));
      await rejects(() => configure(db),'42501','STUDY_ROOM_ADMIN_REQUIRED');
      assert.deepEqual(await catalogRows(db),seedRows);assert.deepEqual(await auditRows(db),[]);
    }));
    await t.test('audit failure rolls back the proposed room mutation', async () => isolated(db, async () => {
      await db.exec("alter table private.study_room_catalog_audit add constraint local_fail check (operation='update')");
      await rejects(() => configure(db),'23514');
      assert.deepEqual(await catalogRows(db),seedRows);assert.deepEqual(await auditRows(db),[]);
    }));
    await t.test('revision exhaustion fails explicitly without generation wrap or audit', async () => isolated(db, async () => {
      await db.exec('update private.study_room_catalog set revision=2147483646 where room_key=2');
      await rejects(() => configure(db,[actor.admin,'update','2','Changed','paid',2147483646]),'PT409','STUDY_ROOM_CONFIG_CONFLICT');
      assert.deepEqual(await auditRows(db),[]);
    }));
    await t.test('all account/billing rows and pre-existing helper metadata remain exact', async () => {
      assert.deepEqual(await snapshot(db),protectedBefore);
      assert.deepEqual(await catalogRows(db),seedRows);
      assert.deepEqual(await auditRows(db),[]);
    });
  } finally { await db.close(); }
});
