import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// No remote transport or customer fixture. Fail, rather than skip, without SQL.
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20260907181748_astra_admin_role_fail_closed.sql', import.meta.url), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const signatures = [
  'admin_authorization_context(uuid)', 'phase4_require_founder(uuid)',
  'phase4_admin_set_global_beta_all_access(uuid,boolean,text,text)',
  'phase4_global_beta_policy_snapshot(uuid)',
];
const knownHashes = {
  lf: [
    'c7992d0b3a5d1ae15ef04de5b1655afc7d37c104edcf9acad332a41299ad0350',
    'd7ebadf6de5b4f1ba5fa557ec9e32d343f9a50083f2d97eaa90ecbe0ae59a451',
  ],
  crlf: [
    '7d22815f84eb36a8592e20562afa2b71ed29c0aeaf77a3311acaeb9843b7f273',
    'c9e0e17e48849ea9328a3ccd7d02851214e5f58b325d05616474c742535af6da',
  ],
};
const callerHashes = [
  'd5adb8d0ba9929703e7b78133f81c9d7981ddcc0cd052945ad5d67c4f2623efa',
  '83b12e2a00f63b8a78053d33781da2eea58069ccaf954801b271077b8c40aaf4',
];
const roles = ['missing', 'null', 'student', 'admin', 'founder_admin', 'super_admin'];
const actor = Object.fromEntries(roles.map((role, index) => [role,
  `a0800000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const founderError = /Founder administrator authorization required/;
const adminError = /Administrator authorization required/;
const fullCapabilities = [
  'analytics_viewer', 'learner_analytics_viewer', 'support_admin', 'correction_admin',
  'subscription_admin', 'account_recovery_admin', 'advertiser_report_viewer', 'role_admin',
];

// Read the actual historical definitions, not a rewritten authorization mock.
async function original(file, name, crlf = false) {
  const source = (await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} original definition`);
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} original delimiter`);
  const definition = source.slice(start, end + 4);
  return crlf ? definition.replace(/\n/g, '\r\n') : definition;
}

async function catalog(db) {
  return (await db.query(`select p.oid, p.oid::regprocedure::text as signature,
    pg_get_functiondef(p.oid) as definition, pg_get_userbyid(p.proowner) as owner,
    p.proacl::text as acl, p.prosecdef, p.provolatile, p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' order by p.oid`)).rows;
}
async function data(db) {
  return (await db.query(`select jsonb_build_object(
    'users',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
    'roles',(select jsonb_agg(to_jsonb(t) order by user_id) from user_roles t),
    'capabilities',(select jsonb_agg(to_jsonb(t) order by user_id,capability) from admin_capabilities t),
    'settings',(select jsonb_agg(to_jsonb(t)) from platform_access_settings t),
    'history',(select jsonb_agg(to_jsonb(t) order by request_key) from global_beta_all_access_history t),
    'audit',(select jsonb_agg(to_jsonb(t) order by id) from admin_audit_log t)) as value`)).rows[0].value;
}
async function writes(db) {
  return (await db.query('select last_value, is_called from public.local_write_attempts')).rows;
}
async function service(db, callback, role = 'service_role') {
  assert.ok(['service_role', 'anon', 'authenticated'].includes(role));
  await db.exec(`set role ${role}`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}
async function context(db, id) {
  return (await service(db, () => db.query('select public.admin_authorization_context($1::uuid) as value', [id]))).rows[0].value;
}
async function founder(db, id) {
  return (await service(db, () => db.query('select public.phase4_require_founder($1::uuid) as value', [id]))).rows[0].value;
}
async function changePolicy(db, id, key, enabled = false) {
  return (await service(db, () => db.query(`select public.phase4_admin_set_global_beta_all_access(
    $1::uuid,$2::boolean,'Explicit local security regression',$3::text) as value`, [id, enabled, key]))).rows[0].value;
}

async function setup(encoding) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, is_anonymous boolean default false, last_sign_in_at timestamptz);
      -- Nullable local role column deliberately exercises the defensive NULL path.
      create table public.user_roles(user_id uuid primary key references auth.users(id), role text);
      create table public.admin_capabilities(user_id uuid references auth.users(id), capability text, revoked_at timestamptz);
      create table public.platform_access_settings(singleton boolean primary key,
        global_beta_all_access_enabled boolean not null default true,
        global_beta_all_access_updated_at timestamptz not null default now(),
        global_beta_all_access_updated_by uuid references auth.users(id),
        global_beta_all_access_version bigint not null default 1,
        updated_at timestamptz not null default now(), updated_by uuid references auth.users(id));
      create table public.global_beta_all_access_history(id uuid primary key default gen_random_uuid(),
        actor_user_id uuid not null references auth.users(id), previous_enabled boolean not null,
        enabled boolean not null, version bigint not null, reason text not null,
        request_key text not null unique, occurred_at timestamptz default now());
      create table public.admin_audit_log(id uuid primary key default gen_random_uuid(),
        actor_user_id uuid references auth.users(id), action_type text, target_resource_type text,
        target_resource_id text, reason text, details jsonb);
      insert into public.platform_access_settings(singleton) values(true);
      insert into auth.users(id,last_sign_in_at) values ${Object.values(actor).map(id => `('${id}','2026-09-07T00:00:00Z')`).join(',')};
      insert into public.user_roles(user_id,role) values ${roles.filter(r => r !== 'missing').map(r => `('${actor[r]}',${r === 'null' ? 'null' : `'${r}'`})`).join(',')};
      insert into public.admin_capabilities values
        ('${actor.admin}','support_admin',null),('${actor.admin}','analytics_viewer',null),
        ('${actor.admin}','subscription_admin','2026-09-01T00:00:00Z'),
        ('${actor.missing}','role_admin',null),('${actor.null}','role_admin',null);
      create sequence public.local_write_attempts;
      create function public.local_count_write() returns trigger language plpgsql as $$
      begin perform nextval('public.local_write_attempts'); return new; end; $$;
      create trigger local_settings_write before update on public.platform_access_settings for each row execute function public.local_count_write();
      create trigger local_history_write before insert on public.global_beta_all_access_history for each row execute function public.local_count_write();
      create trigger local_audit_write before insert on public.admin_audit_log for each row execute function public.local_count_write();
    `);
    await db.exec(await original('20260730_005_phase4_access_subscriptions.sql', 'admin_authorization_context', encoding === 'crlf'));
    await db.exec(await original('20260730_008_phase4_payments_partnerships.sql', 'phase4_require_founder', encoding === 'crlf'));
    for (const name of ['phase4_global_beta_policy_snapshot', 'phase4_admin_set_global_beta_all_access']) {
      await db.exec(await original('20260810002100_global_beta_all_access.sql', name));
    }
    for (const signature of signatures) await db.exec(`revoke all on function public.${signature} from public,anon,authenticated; grant execute on function public.${signature} to service_role;`);
    const rows = await catalog(db);
    for (const [index, signature] of signatures.entries()) {
      const row = rows.find(r => r.signature === signature);
      assert.equal(hash(row.definition), index < 2 ? knownHashes[encoding][index] : callerHashes[index - 2], `${encoding} exact observed catalog definition: ${signature}`);
      assert.equal(row.acl, '{postgres=X/postgres,service_role=X/postgres}');
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}

for (const encoding of ['lf', 'crlf']) {
  test(`actual production helpers and caller (${encoding}) fail closed without changing allowed access`, async t => {
    const db = await setup(encoding);
    try {
      await t.test('exact old source demonstrates role-less bypass locally; rollback restores every row', async () => {
        const before = await data(db);
        await db.exec('begin');
        try {
          assert.equal(await founder(db, actor.missing), null);
          assert.equal((await context(db, actor.missing)).authorized, true);
          const result = await changePolicy(db, actor.missing, 'local_before_roleless_0001');
          assert.equal(result.enabled, false);
          assert.equal(result.version, 2);
        } finally { await db.exec('rollback'); }
        assert.deepEqual(await data(db), before);
      });
      const allowedBefore = {};
      for (const role of ['admin', 'founder_admin', 'super_admin']) allowedBefore[role] = await context(db, actor[role]);
      const beforeCatalog = await catalog(db);
      const beforeData = await data(db);
      await t.test('atomic migration changes only two exact predicates, with identical metadata and business rows', async () => {
        await db.exec(migration);
        assert.deepEqual(await data(db), beforeData);
        const after = await catalog(db);
        assert.equal(after.length, beforeCatalog.length);
        for (let i = 0; i < beforeCatalog.length; i++) {
          const old = beforeCatalog[i];
          const expected = signatures.slice(0, 2).includes(old.signature)
            ? old.definition.replace('if v_role not in (', 'if v_role is null or v_role not in (') : old.definition;
          assert.deepEqual(after[i], { ...old, definition: expected });
        }
        await db.exec(migration);
        assert.deepEqual(await catalog(db), after, 'exact second application is a no-op');
        assert.deepEqual(await data(db), beforeData);
      });
      for (const role of ['null_actor', ...roles]) {
        await t.test(`service caller authoritative role matrix: ${role}`, async () => {
          const id = role === 'null_actor' ? null : actor[role];
          const before = await data(db);
          const writeCount = await writes(db);
          if (['founder_admin', 'super_admin'].includes(role)) {
            assert.equal(await founder(db, id), role);
          } else await assert.rejects(() => founder(db, id), founderError);
          if (['admin', 'founder_admin', 'super_admin'].includes(role)) {
            const value = await context(db, id);
            assert.deepEqual(value, allowedBefore[role]);
            assert.deepEqual(value.capabilities, role === 'admin' ? ['analytics_viewer', 'support_admin'] : fullCapabilities);
            const read = await service(db, () => db.query('select public.phase4_global_beta_policy_snapshot($1::uuid) as value', [id]));
            assert.equal(read.rows[0].value.signedInAccountCount, roles.length);
          } else {
            await assert.rejects(() => context(db, id), adminError);
            await assert.rejects(() => service(db, () => db.query('select public.phase4_global_beta_policy_snapshot($1::uuid)', [id])), adminError);
          }
          if (!['founder_admin', 'super_admin'].includes(role)) {
            await assert.rejects(() => changePolicy(db, id, `local_denied_${role}_0001`), founderError);
          }
          assert.deepEqual(await data(db), before);
          // nextval is nontransactional: even a subsequently rolled-back write
          // attempt would advance this counter. Authorization must run first.
          assert.deepEqual(await writes(db), writeCount);
        });
      }
      for (const role of ['founder_admin', 'super_admin']) {
        await t.test(`${role} can perform and replay the actual audited public mutation`, async () => {
          const before = await data(db);
          const key = `local_allowed_${role}_0001`;
          const result = await changePolicy(db, actor[role], key, role === 'super_admin');
          assert.equal(result.replayed, false);
          const after = await data(db);
          assert.equal(after.history.length, (before.history?.length || 0) + 1);
          assert.equal(after.audit.length, (before.audit?.length || 0) + 1);
          const writeCount = await writes(db);
          assert.equal((await changePolicy(db, actor[role], key, role === 'super_admin')).replayed, true);
          assert.deepEqual(await data(db), after);
          assert.deepEqual(await writes(db), writeCount);
        });
      }
      for (const role of ['anon', 'authenticated']) {
        await t.test(`${role} still cannot directly execute either helper or privileged caller`, async () => {
          const before = await data(db);
          const count = await writes(db);
          for (const sql of [
            'select public.phase4_require_founder($1::uuid)',
            'select public.admin_authorization_context($1::uuid)',
            'select public.phase4_global_beta_policy_snapshot($1::uuid)',
            "select public.phase4_admin_set_global_beta_all_access($1::uuid,false,'Local blocked direct RPC','local_blocked_direct_0001')",
          ]) await assert.rejects(() => service(db, () => db.query(sql, [actor.founder_admin]), role), { code: '42501' });
          assert.deepEqual(await data(db), before);
          assert.deepEqual(await writes(db), count);
        });
      }
    } finally { await db.close(); }
  });
}

test('unknown second-helper definition or permission drift aborts both updates atomically', async t => {
  const db = await setup('lf');
  try {
    const originals = await catalog(db);
    const founderDefinition = originals.find(r => r.signature === signatures[1]).definition;
    for (const drift of ['definition', 'acl', 'owner', 'search_path', 'volatility', 'security_definer', 'missing']) {
      await t.test(drift, async () => {
        await db.exec('begin');
        try {
          if (drift === 'definition') await db.exec(founderDefinition.replace('return v_role;', "return coalesce(v_role, 'changed');"));
          if (drift === 'acl') await db.exec('grant execute on function public.phase4_require_founder(uuid) to authenticated');
          if (drift === 'owner') await db.exec('alter function public.phase4_require_founder(uuid) owner to service_role');
          if (drift === 'search_path') await db.exec('alter function public.phase4_require_founder(uuid) set search_path=public');
          if (drift === 'volatility') await db.exec('alter function public.phase4_require_founder(uuid) volatile');
          if (drift === 'security_definer') await db.exec('alter function public.phase4_require_founder(uuid) security invoker');
          if (drift === 'missing') await db.exec('drop function public.phase4_require_founder(uuid)');
          const before = await catalog(db);
          const beforeData = await data(db);
          await db.exec('savepoint guarded_migration');
          await assert.rejects(() => db.exec(migration), /Administrator role guard (definition drift|metadata drift|prerequisite missing)/);
          await db.exec('rollback to savepoint guarded_migration');
          assert.deepEqual(await catalog(db), before, 'the first helper must not remain patched after second-helper rejection');
          assert.deepEqual(await data(db), beforeData);
        } finally { await db.exec('rollback'); }
        assert.deepEqual(await catalog(db), originals);
      });
    }
    await t.test('exact mixed already-correct/original state is safely completed', async () => {
      await db.exec(originals.find(r => r.signature === signatures[0]).definition.replace('if v_role not in (', 'if v_role is null or v_role not in ('));
      await db.exec(migration);
      await assert.rejects(() => founder(db, actor.missing), founderError);
      await assert.rejects(() => context(db, actor.missing), adminError);
      const after = await catalog(db);
      await db.exec(migration);
      assert.deepEqual(await catalog(db), after);
    });
  } finally { await db.close(); }
});
