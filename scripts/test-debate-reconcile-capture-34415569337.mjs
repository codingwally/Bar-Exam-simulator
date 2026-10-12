import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildExactCaptureSql, FIXED_MANIFEST, EXACT_PROJECT_REF, EXACT_EVENT_ID, EXACT_JOB_ID,
  EXACT_EXCLUDED_ID, EXACT_LEASE_UNTIL_MS, EXACT_STORAGE_KEYS, HELPER_BODY_SHA256 } from './debate-reconcile-capture-34415569337.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const valid = { expectedEventSha256: 'a'.repeat(64), expectedJobSha256: 'b'.repeat(64) };
const helperUrl = new URL('../supabase/staging/debate-hosted-cleanup.sql', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260909080139_debate_room_v3.sql', import.meta.url);

test('exact capture generator rejects malformed or widening arguments and defaults to rollback', () => {
  for (const bad of [undefined, null, [], '', Object.create(null), {}, { ...valid, projectRef: EXACT_PROJECT_REF },
    { ...valid, commit: 1 }, { ...valid, commit: 'true' }, { ...valid, expectedJobSha256: 'B'.repeat(64) },
    { ...valid, expectedEventSha256: "'; commit; --" }, { ...valid, expectedEventSha256: 'a'.repeat(63) }]) {
    assert.throws(() => buildExactCaptureSql(bad), /EXACT_RECONCILE_ARGUMENTS/u);
  }
  const sql = buildExactCaptureSql(valid);
  assert.match(sql, /begin;[\s\S]*set local lock_timeout = '5s';[\s\S]*set local statement_timeout = '20s';/u);
  assert.match(sql, /rollback;\s*$/u);
  assert.match(buildExactCaptureSql({ ...valid, commit: true }), /commit;\s*$/u);
  assert.ok(sql.indexOf('for update;') < sql.indexOf('lock table public.debate_v3_events'));
  assert.ok(sql.indexOf('update public.debate_v3_outbox set') < sql.indexOf('set local role service_role;'));
  assert.ok(sql.indexOf('set local role service_role;') < sql.indexOf('v_capture := public.astra_staging_debate_cleanup_v1'));
  assert.ok(!/\b(?:delete|insert|truncate|create|alter|drop)\s+(?:from|into|table|function|schema)/iu.test(sql));
  assert.equal((sql.match(/\bupdate public\./gu) || []).length, 1);
  assert.equal(FIXED_MANIFEST.fixtures.length, 10);
  assert.equal(new Set(FIXED_MANIFEST.fixtures.map(f => f.id)).size, 10);
  assert.ok(FIXED_MANIFEST.fixtures.every(f => f.id !== EXACT_EXCLUDED_ID));
  assert.throws(() => { FIXED_MANIFEST.fixtures[0].id = EXACT_EXCLUDED_ID; }, TypeError);
  assert.equal(EXACT_STORAGE_KEYS.length, 4);
  assert.equal(sql.includes('hbllomlijfznnuudpdvr'), false);
});

test('helper body guards bind the unchanged checked-in functions exactly', async () => {
  const source = (await readFile(helperUrl, 'utf8')).replaceAll('\r\n', '\n');
  const bodies = [...source.matchAll(/as \$function\$([\s\S]*?)\$function\$;/gu)].map(match => match[1]);
  assert.equal(bodies.length, 2);
  assert.equal(hash(bodies[0]), HELPER_BODY_SHA256.private);
  assert.equal(hash(bodies[1]), HELPER_BODY_SHA256.public);
});

test('native PostgreSQL17.6 exact expired-claim cancellation and unchanged-helper capture are atomic', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || process.env.DEBATE_RECONCILE_SQL_CI !== '1'
    ? 'Native proof requires the isolated Linux GitHub PostgreSQL17.6 debate_reconcile_ci job; no local SQL proof claimed.' : false,
  timeout: 120000,
}, async () => {
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.PGPORT, '5432');
  assert.equal(process.env.PGUSER, 'postgres');
  assert.equal(process.env.PGDATABASE, 'debate_reconcile_ci');
  assert.ok(process.env.PGPASSWORD);
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const helper = (await readFile(helperUrl, 'utf8')).replaceAll('\r\n', '\n');
  const migration = (await readFile(migrationUrl, 'utf8')).replaceAll('\r\n', '\n');
  const output = new URL('../artifacts/debate-local-rehearsal/reconcile-34415569337-native-ci/', import.meta.url);
  await mkdir(output, { recursive: true });
  const report = { kind: 'EXACT_RECONCILE_34415569337_NATIVE_POSTGRES17', status: 'RUNNING', hostedExecuted: false,
    providerCalls: 0, adaptations: [], startedAt: new Date().toISOString(), checks: [], expectedErrors: [],
    dependencySchemaScope: 'Reduced inert Auth/Storage/billing tables; unmodified Debate migration and cleanup helper; no Auth server or Storage API.',
    identityBoundary: 'The generated SQL cannot prove a hosted project; the external coordinator must pin it.',
    sourceHashes: { helper: hash(helper), debateMigration: hash(migration),
      builder: hash((await readFile(new URL('./debate-reconcile-capture-34415569337.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')),
      harness: hash((await readFile(new URL(import.meta.url), 'utf8')).replaceAll('\r\n', '\n')) } };
  const check = (name, condition) => { assert.ok(condition, name); report.checks.push({ name, passed: true }); };
  function run(sql, expectedMessage) {
    return new Promise((resolve, reject) => {
      const child = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
        { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        const state = stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1] || null;
        if (expectedMessage) {
          if (code === 0 || state !== 'P0001' || !stderr.includes(expectedMessage)) {
            return reject(Object.assign(new Error('EXACT_NATIVE_EXPECTED_REJECTION_MISMATCH'), { observedState: state, diagnosticSha256: hash(stderr) }));
          }
          report.expectedErrors.push({ expectedMessage, sqlState: state, diagnosticSha256: hash(stderr) });
          return resolve(null);
        }
        if (code !== 0) return reject(Object.assign(new Error('EXACT_NATIVE_SQL_FAILED'), { observedState: state, diagnosticSha256: hash(stderr) }));
        resolve(stdout.trim());
      });
      child.stdin.end(sql);
    });
  }
  const scalar = sql => run(sql).then(value => JSON.parse(value));
  const host = FIXED_MANIFEST.fixtures[0].id;
  const rowHash = table => scalar(`select to_json(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) from public.${table} t where id=${quote(table === 'debate_v3_events' ? EXACT_EVENT_ID : EXACT_JOB_ID)};`);
  const hashes = async () => ({ expectedEventSha256: await rowHash('debate_v3_events'), expectedJobSha256: await rowHash('debate_v3_outbox') });
  const tableNames = ['auth.users', 'auth.sessions', 'auth.refresh_tokens', 'public.user_roles', 'private.internal_test_accounts',
    'public.debate_v3_events', 'public.debate_v3_outbox', 'public.debate_v3_uploads', 'public.debate_v3_receipts', 'public.debate_v3_audit',
    'public.debate_v3_match_versions', 'public.debate_v3_ballots', 'public.debate_v3_votes', 'public.debate_v3_rate_limits',
    'public.payment_requests', 'storage.buckets', 'storage.objects'];
  const allRows = () => scalar(`select jsonb_build_object(${tableNames.map(name => `${quote(name)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${name} t)`).join(',')},
    'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'body',p.prosrc,'owner',r.rolname,'acl',p.proacl::text,'config',p.proconfig,'definer',p.prosecdef) order by n.nspname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
    where p.proname='astra_staging_debate_cleanup_v1' and n.nspname in ('public','private')));`);
  const captureSql = async (commit = false) => buildExactCaptureSql({ ...await hashes(), commit });
  try {
    const version = await run('show server_version;'); report.postgresVersion = version;
    check('Actual native engine is PostgreSQL17.6', /^17\.6(?:\D|$)/u.test(version));
    check('Dedicated CI database has no preexisting application schemas', await scalar("select to_json(to_regclass('auth.users') is null and to_regclass('public.debate_v3_events') is null);"));
    await run(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; create schema storage; grant usage on schema private to service_role;
      create table auth.users(id uuid primary key,email text,created_at timestamptz,aud text,role text,is_super_admin boolean,
        is_anonymous boolean,is_sso_user boolean,deleted_at timestamptz,email_confirmed_at timestamptz,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
      create table auth.refresh_tokens(id bigint primary key,user_id text,revoked boolean);
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text,assigned_by uuid references auth.users(id));
      create table private.internal_test_accounts(user_id uuid primary key references auth.users(id),email_at_classification text,classification_source text);
      alter table private.internal_test_accounts enable row level security; alter table private.internal_test_accounts force row level security;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text references storage.buckets(id),name text);
      ${['payment_requests','subscriptions','free_beta_access','admin_capabilities','examination_beta_access','examination_participants',
        'examination_attempts_multi','grade_reservations','refund_requests'].map(name => `create table public.${name}(user_id uuid references auth.users(id));`).join('\n')}
      ${['payment_request_history','refund_request_history'].map(name => `create table public.${name}(actor_user_id uuid references auth.users(id));`).join('\n')}
      create table public.subscription_history(user_id uuid references auth.users(id),actor_user_id uuid references auth.users(id));
      create table public.examination_definitions(created_by uuid references auth.users(id));`);
    await run(migration); await run(helper);
    check('Unmodified Debate migration and helper installed; only dependency tables are reduced inert fixtures', true);
    for (const f of FIXED_MANIFEST.fixtures) {
      const email = `dd-study-room-student-${f.runId}@example.com`;
      await run(`insert into auth.users values(${quote(f.id)},${quote(email)},${quote(f.createdAt)},'authenticated','authenticated',false,false,false,null,${quote(f.createdAt)},
        ${json({ full_name: 'Synthetic Study Room student' })},${json({ provider: 'email', providers: ['email'], astra_staging_study_room_fixture: { version: 1, runId: f.runId, label: 'student' } })});
        insert into public.user_roles values(${quote(f.id)},'student',null);
        insert into private.internal_test_accounts values(${quote(f.id)},${quote(email)},${quote(`astra_study_room_staging_v1:${f.runId}:student`)});`);
    }
    const state = { id: EXACT_EVENT_ID, ownerId: host, revision: 647, title: FIXED_MANIFEST.events[0].title,
      rehearsal: true, visibility: 'unlisted', media: {}, members: Object.fromEntries(FIXED_MANIFEST.fixtures.map(f => [f.id, { id: f.id }])),
      jobs: { [EXACT_JOB_ID]: { id: EXACT_JOB_ID, status: 'queued' } } };
    const uploadId = '9c2cbcd5-1278-4579-a75a-ceeecbedab43';
    const matchId = 'd7c78b2e-7977-4cc5-a574-ae8ece487dd1';
    const cleanupId = `upload-cleanup:${uploadId}`;
    const createdMs = Date.parse(FIXED_MANIFEST.fixtures[0].createdAt);
    await run(`insert into public.debate_v3_events values(${quote(EXACT_EVENT_ID)},${quote(host)},647,'draft',${json(state)},${createdMs},${createdMs});`);
    for (const [id, kind, status] of [[EXACT_JOB_ID, 'result', 'running'], ['5f44868b-0086-4d88-837c-5c46461fdb9d', 'scorecard', 'completed'], ['b9a9a95c-14c4-40aa-b993-d13a4904dd10', 'rules', 'completed']]) {
      const job = { id, eventId: EXACT_EVENT_ID, actorId: host, type: 'export', payload: { matchId, document: { kind }, format: 'pdf' } };
      await run(`insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,status,attempts,next_attempt_ms,claim_id,lease_until_ms,result)
        values(${quote(id)},${quote(EXACT_EVENT_ID)},${quote(host)},'export',${json(job)},${quote(status)},1,${createdMs},'inert-original-claim',
        ${status === 'running' ? EXACT_LEASE_UNTIL_MS : 'null'},${status === 'running' ? 'null' : json({ storageKey: `exports/${EXACT_EVENT_ID}/${id}.pdf` })});`);
    }
    const cleanupJob = { id: cleanupId, eventId: EXACT_EVENT_ID, actorId: host, type: 'delete_evidence', payload: { uploadId, matchId, storageKey: EXACT_STORAGE_KEYS[0] } };
    const upload = { id: uploadId, eventId: EXACT_EVENT_ID, actorId: host, matchId, storageKey: EXACT_STORAGE_KEYS[0] };
    await run(`insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,status,next_attempt_ms) values
      (${quote(cleanupId)},${quote(EXACT_EVENT_ID)},${quote(host)},'delete_evidence',${json(cleanupJob)},'cancelled',${createdMs});
      insert into public.debate_v3_uploads values(${quote(uploadId)},${quote(EXACT_EVENT_ID)},${quote(host)},${quote(matchId)},'A',${json(upload)},'retained',${createdMs},${quote(cleanupId)});
      insert into public.debate_v3_receipts values(${quote(host)},'create_event',${quote(EXACT_EVENT_ID)},'original-idempotency','original-hash','{"retained":true}',${createdMs});
      insert into public.debate_v3_audit values(${quote(EXACT_EVENT_ID)},647,${quote(host)},'create_export','{"retained":true}',${createdMs});
      insert into public.debate_v3_rate_limits values(${quote(host)},'discover_events',${Math.floor(createdMs / 60000)},1);
      insert into storage.buckets values('debate-private-v3','debate-private-v3',false,10485760,array['application/pdf','image/jpeg','image/png','text/csv']);
      insert into storage.objects values('11111111-1111-4111-8111-111111111111','debate-private-v3',${quote(EXACT_STORAGE_KEYS[0])});`);
    // Unrelated rows demonstrate cancellation does not widen to another event.
    const foreignId = 'de-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await run(`insert into public.debate_v3_events values(${quote(foreignId)},'unrelated-owner',1,'draft','{"retained":true}',1,1);
      insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,status,next_attempt_ms) values
      ('unrelated-job',${quote(foreignId)},'unrelated-owner','export','{"retained":true}','queued',1);`);
    const original = await allRows();
    await run(`set role service_role; select public.astra_staging_debate_cleanup_v1(${json(FIXED_MANIFEST)},null);`, 'HOSTED_CLEANUP_JOB_SCOPE');
    check('Unchanged helper rejects the original expired running claim without mutations', JSON.stringify(await allRows()) === JSON.stringify(original));
    const dry = await scalar(await captureSql());
    check('Default rollback returns bounded four-key capture while retaining every original row', dry.status === 'CAPTURED' && dry.transactionMode === 'ROLLBACK_ONLY' &&
      JSON.stringify(dry.snapshot.storageKeys) === JSON.stringify(EXACT_STORAGE_KEYS) && JSON.stringify(await allRows()) === JSON.stringify(original));
    const wrongHash = await hashes(); wrongHash.expectedJobSha256 = '0'.repeat(64);
    await run(buildExactCaptureSql({ ...wrongHash, commit: true }), 'EXACT_RECONCILE_JOB_DRIFT');
    check('Bad full-row hash rolls back without cancellation', JSON.stringify(await allRows()) === JSON.stringify(original));
    const nativeCases = [
      ['changed active lease', `update public.debate_v3_outbox set lease_until_ms=floor(extract(epoch from clock_timestamp())*1000)::bigint+600000 where id=${quote(EXACT_JOB_ID)}`,
        `update public.debate_v3_outbox set lease_until_ms=${EXACT_LEASE_UNTIL_MS} where id=${quote(EXACT_JOB_ID)}`, 'EXACT_RECONCILE_JOB_DRIFT'],
      ['wrong fixture identity', `update auth.users set email='inert-wrong-owner@example.com' where id=${quote(host)}`,
        `update auth.users set email=${quote(`dd-study-room-student-${FIXED_MANIFEST.fixtures[0].runId}@example.com`)} where id=${quote(host)}`, 'HOSTED_CLEANUP_AUTH_OWNERSHIP'],
      ['helper source drift', `create or replace function public.astra_staging_debate_cleanup_v1(p_manifest jsonb,p_expected jsonb) returns jsonb language sql volatile security invoker set search_path='' set lock_timeout='5s' set statement_timeout='20s' as 'select null::jsonb;'`,
        `create or replace function public.astra_staging_debate_cleanup_v1(p_manifest jsonb,p_expected jsonb) returns jsonb language sql volatile security invoker set search_path='' set lock_timeout='5s' set statement_timeout='20s' as ${quote([...helper.matchAll(/as \$function\$([\s\S]*?)\$function\$;/gu)][1][1])}`, 'EXACT_RECONCILE_HELPER_DEFINITION_DRIFT'],
      ['helper privilege drift', 'grant execute on function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) to authenticated',
        'revoke execute on function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) from authenticated', 'EXACT_RECONCILE_HELPER_PRIVILEGE_DRIFT'],
      ['helper security drift', 'alter function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) security definer',
        'alter function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) security invoker', 'EXACT_RECONCILE_HELPER_DEFINITION_DRIFT'],
      ['foreign membership', `update public.debate_v3_events set state=jsonb_set(state,'{members}',(state->'members')||'{"foreign":{"id":"foreign"}}'::jsonb) where id=${quote(EXACT_EVENT_ID)}`,
        `update public.debate_v3_events set state=jsonb_set(state,'{members}',(state->'members')-'foreign') where id=${quote(EXACT_EVENT_ID)}`, 'HOSTED_CLEANUP_EVENT_MEMBERS'],
      ['active session', `insert into auth.sessions values('11111111-1111-4111-8111-222222222222',${quote(host)})`,
        'delete from auth.sessions', 'EXACT_RECONCILE_SESSION_OR_REFRESH'],
      ['revoked refresh row', `insert into auth.refresh_tokens values(1,${quote(host)},true)`,
        'delete from auth.refresh_tokens', 'EXACT_RECONCILE_SESSION_OR_REFRESH'],
      ['another running job', `update public.debate_v3_outbox set status='running' where id='5f44868b-0086-4d88-837c-5c46461fdb9d'`,
        "update public.debate_v3_outbox set status='completed' where id='5f44868b-0086-4d88-837c-5c46461fdb9d'", 'HOSTED_CLEANUP_JOB_SCOPE'],
      ['financial reference', `insert into public.payment_requests values(${quote(host)})`, 'delete from public.payment_requests', 'HOSTED_CLEANUP_FINANCIAL_OR_PRIVILEGED_DATA'],
      ['excluded identity reappeared', `insert into auth.users(id) values(${quote(EXACT_EXCLUDED_ID)})`,
        `delete from auth.users where id=${quote(EXACT_EXCLUDED_ID)}`, 'EXACT_RECONCILE_EXCLUDED_REMAINS'],
    ];
    for (const [name, mutation, restore, code] of nativeCases) {
      await run(`${mutation};`);
      const before = await allRows();
      await run(await captureSql(true), code);
      check(`${name} refuses the transaction and preserves all rows and helper definitions`, JSON.stringify(await allRows()) === JSON.stringify(before));
      await run(`${restore};`);
      assert.deepEqual(await allRows(), original);
    }
    const committed = await scalar(await captureSql(true));
    const expected = structuredClone(original);
    const changed = expected['public.debate_v3_outbox'].find(row => row.id === EXACT_JOB_ID);
    Object.assign(changed, { status: 'cancelled', claim_id: null, lease_until_ms: null });
    const after = await allRows();
    // Canonical ordering is unaffected because each outbox row has a distinct ID.
    check('Explicit commit changes only the exact expired claim status and clears its claim and lease', JSON.stringify(after) === JSON.stringify(expected));
    check('Capture binds four exact potential keys and unchanged event without deleting Storage, Auth or Debate data',
      committed.status === 'CAPTURED' && committed.transactionMode === 'COMMIT_REQUESTED' && committed.snapshot.counts.events === 1 &&
      committed.snapshot.counts.outbox === 4 && JSON.stringify(committed.snapshot.storageKeys) === JSON.stringify(EXACT_STORAGE_KEYS) &&
      JSON.stringify(after['public.debate_v3_events']) === JSON.stringify(original['public.debate_v3_events']));
    const normal = await scalar(`set role service_role; select public.astra_staging_debate_cleanup_v1(${json(FIXED_MANIFEST)},null);`);
    check('Unchanged helper independently recaptures the identical committed snapshot', JSON.stringify(normal.snapshot) === JSON.stringify(committed.snapshot));
    await run(buildExactCaptureSql({ ...await hashes(), commit: true }), 'EXACT_RECONCILE_JOB_DRIFT');
    check('Repeating the cancellation refuses the already terminal job without further changes', JSON.stringify(await allRows()) === JSON.stringify(after));
    const claimed = await scalar(`set role service_role; select public.debate_v3_claim_jobs(${quote(EXACT_EVENT_ID)},20,${Date.now()});`);
    check('The normal claim function cannot reclaim the cancelled job', Array.isArray(claimed) && claimed.length === 0);
    const staleFinish = await scalar(`set role service_role; select public.debate_v3_finish_job(${json({
      jobId: EXACT_JOB_ID, claimId: 'inert-original-claim', status: 'completed', result: { storageKey: EXACT_STORAGE_KEYS[1] }, now: Date.now(),
    })});`);
    check('A late completion with the old claim is rejected without any row changes', staleFinish.error?.code === 'JOB_LEASE_CONFLICT' &&
      JSON.stringify(await allRows()) === JSON.stringify(after));
    report.status = 'PASS_EXACT_RECONCILE_NATIVE_POSTGRES17';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = { code: /^[A-Z_]{3,80}$/u.test(error.message) ? error.message : 'EXACT_NATIVE_RECONCILE_FAILED',
      sqlState: error.observedState || null, diagnosticSha256: error.diagnosticSha256 || hash(String(error.message)) };
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  }
});
