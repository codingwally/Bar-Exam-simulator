import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDebateService } from '../worker/debate-service.mjs';
import { createMemoryDebateStoreForTests } from '../worker/debate-store.mjs';

const sourceUrl = new URL('../supabase/staging/debate-hosted-cleanup.sql', import.meta.url);
const upgradeUrl = new URL('../supabase/staging/debate-hosted-cleanup-event-ids-upgrade.sql', import.meta.url);
const originalSourceHash = 'd4f7c239564d6f4634a2fa8415dd4cb9eebb37b76bb98a5f02d3175774184a14';
const originalPrivateHash = '1d02811f3c315d68ba47cbf1085c1386a6c02e9289e00e0ae9ccfed153aa6467';
const unchangedPublicHash = 'aec0459bac58aee8fc65057c1d9408f4b3e3842c059e38dbcdfa18fb834dcfd2';
const oldEventCheck = "or coalesce(v_event->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'";
const newEventCheck = "or coalesce(v_event->>'id','') !~ '^de-[a-f0-9]{32}$'";
const oldPathSegment = '^(exports|evidence)/[a-f0-9-]{36}/';
const newPathSegment = '^(exports|evidence)/de-[a-f0-9]{32}/';
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const ID = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const originalSource = source => source.replace(newEventCheck, () => oldEventCheck).replace(newPathSegment, () => oldPathSegment);
const functionBodies = source => [...source.matchAll(/as \$function\$([\s\S]*?)\$function\$;/gu)].map(match => match[1]);
async function generatedEvent(actorId, now, title) {
  const store = createMemoryDebateStoreForTests(), service = createDebateService({ store, now: () => now });
  const created = await service.execute({ actor: { id: actorId, displayName: 'Synthetic SQL fixture organizer' }, command: 'create_event',
    payload: { title, rehearsal: true, visibility: 'unlisted' }, expectedRevision: 0, idempotencyKey: 'native-cleanup-default-event-id' });
  assert.match(created.event.id, /^de-[a-f0-9]{32}$/u);
  return created.event.id;
}

test('staging-only helper is outside production migration discovery and has no broad product mutation', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.ok(sourceUrl.pathname.includes('/supabase/staging/'));
  assert.ok(!/\b(?:delete\s+from|update|insert\s+into)\s+(?:auth\.|private\.|storage\.|public\.(?:user_roles|study_|payment_|subscription))/iu.test(source));
  assert.ok(!/\b(?:truncate|drop)\s+(?:table|schema)/iu.test(source));
  assert.ok(source.includes('No SQL') || source.includes('not\n-- immutable database identity'));
});

test('generated event fixture and exact old-to-new helper upgrade source retain real ID and Auth boundaries', async () => {
  const source = (await readFile(sourceUrl, 'utf8')).replaceAll('\r\n', '\n');
  const original = originalSource(source), upgrade = (await readFile(upgradeUrl, 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(hash(original), originalSourceHash, 'The legacy native installation is byte-exact known applied SQL.');
  assert.equal(hash(functionBodies(original)[0]), originalPrivateHash);
  assert.equal(hash(functionBodies(source)[1]), unchangedPublicHash);
  assert.ok(upgrade.includes(hash(functionBodies(source)[0])) && upgrade.includes(originalPrivateHash) && upgrade.includes(unchangedPublicHash));
  assert.ok(source.includes(newEventCheck) && source.includes(newPathSegment));
  assert.ok(source.includes("coalesce(v_fixture->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8]"), 'Auth IDs still require UUIDs.');
  const eventId = await generatedEvent(ID(1), 1800000000000, 'Native generated event identifier regression');
  assert.notEqual(eventId, ID(100));
  assert.ok(!/\b(?:delete\s+from|update|insert\s+into)\s+(?:auth\.|private\.|storage\.|public\.)/iu.test(upgrade));
});

test('native PostgreSQL17.6 atomic owned cleanup, full-row drift denial, privileges and real connection contention', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || process.env.DEBATE_HOSTED_SQL_CI !== '1'
    ? 'Native SQL runs only in the dedicated isolated Linux CI PostgreSQL17.6 service; no local SQL execution claimed.' : false,
  timeout: 180000,
}, async () => {
  assert.equal(process.env.PGHOST, '127.0.0.1'); assert.equal(process.env.PGPORT, '5432');
  assert.equal(process.env.PGUSER, 'postgres'); assert.equal(process.env.PGDATABASE, 'debate_cleanup_ci');
  assert.ok(process.env.PGPASSWORD && !/SUPABASE|CLOUDFLARE/iu.test(process.env.PGPASSWORD));
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const output = new URL('../artifacts/debate-local-rehearsal/hosted-atomic-cleanup-ci/', import.meta.url);
  await mkdir(output, { recursive: true });
  const sqlSource = (await readFile(sourceUrl, 'utf8')).replaceAll('\r\n', '\n');
  const legacySource = originalSource(sqlSource), upgradeSource = (await readFile(upgradeUrl, 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(hash(legacySource), originalSourceHash);
  const debateMigration = (await readFile(new URL('../supabase/migrations/20260909080139_debate_room_v3.sql', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const report = { kind: 'NATIVE_CI_POSTGRES17_STAGING_CLEANUP', status: 'RUNNING', hostedExecuted: false,
    sourceSha256: hash(sqlSource), adaptations: [], nativeConcurrentConnections: false, providerCalls: 0,
    dependencySchemaScope: 'Inert reduced Auth/Storage/billing fixtures; unmodified real Debate migration/helper SQL; no Auth server or Storage API.',
    sourceHashes: { helper: hash(sqlSource), exactLegacyHelper: hash(legacySource), guardedUpgrade: hash(upgradeSource), debateMigration: hash(debateMigration),
      eventIdService: hash((await readFile(new URL('../worker/debate-service.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')),
      eventIdTestStore: hash((await readFile(new URL('../worker/debate-store.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')),
      harness: hash((await readFile(new URL(import.meta.url), 'utf8')).replaceAll('\r\n', '\n')) },
    identityBoundary: 'Only the external target-pinned coordinator proves hosted project identity; payload ref is context.',
    statementTimeoutEvidence: 'Native test sets an outer statement timeout explicitly; hosted PostgREST hoisting remains separate verification.',
    lockScope: 'nine Debate tables only; SHARE ROW EXCLUSIVE; per-lock timeout5s', checks: [], expectedErrors: [] };
  function run(sql, { applicationName = 'debate-cleanup-test', expectedCode, expectedMessage } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
        { env: { ...env, PGAPPNAME: applicationName }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 3000000) child.kill(); });
      child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1000000) child.kill(); });
      child.on('error', () => reject(new Error('NATIVE_PSQL_SPAWN_FAILED')));
      child.on('close', code => {
        const state = /ERROR:\s+([A-Z0-9]{5}):/u.exec(stderr)?.[1] || null;
        if (expectedCode) {
          if (code === 0 || state !== expectedCode || (expectedMessage && !stderr.includes(expectedMessage))) return reject(Object.assign(new Error('NATIVE_EXPECTED_SQLSTATE_MISMATCH'), { observedState: state }));
          report.expectedErrors.push({ sqlState: state, ...(expectedMessage ? { expectedMessage } : {}), messageSha256: hash(stderr) }); return resolve(state);
        }
        if (code !== 0) return reject(Object.assign(new Error('NATIVE_SQL_FAILED'), { observedState: state, diagnosticSha256: hash(stderr) }));
        resolve(stdout.trim());
      });
      child.stdin.end(sql);
    });
  }
  const scalar = sql => run(sql).then(value => value === 't' ? true : value === 'f' ? false : JSON.parse(value));
  const check = (name, condition) => { assert.ok(condition, name); report.checks.push({ name, passed: true }); };
  const purposes = ['host','A1','A2','A3','N1','N2','N3','judge2','judge3','observer','excluded'];
  const createdAt = new Date().toISOString(), createdMs = Date.parse(createdAt), runTag = 'dv3host-aaaaaaaaaaaaaaaa';
  const fixtures = purposes.map((purpose, index) => ({ id: ID(index + 1), purpose, runId: `dv3study-${index.toString(16).padStart(8, '0')}`, createdAt }));
  const host = fixtures[0].id, exportId = ID(101), uploadId = ID(102), matchId = ID(103);
  const title = `Hosted Debate ${runTag} main`, eventId = await generatedEvent(host, createdMs, title);
  const foreignEventId = await generatedEvent(ID(999), createdMs, 'Unrelated retained fixture');
  report.generatedEventId = eventId; report.eventIdProvenance = 'Unmodified createDebateService.execute(create_event) with no supplied eventId, using its explicit test-only memory store.';
  const exportKey = `exports/${eventId}/${exportId}.pdf`;
  const evidenceKey = `evidence/${eventId}/${matchId}/${uploadId}.pdf`, cleanupId = `upload-cleanup:${uploadId}`;
  const manifest = { projectRef: 'hlzqmreeoghbldnhlybr', runTag, fixtures, events: [{ id: eventId, title }] };
  const rpc = (expected, scope = manifest) => `select public.astra_staging_debate_cleanup_v1(${json(scope)},${expected === null ? 'null' : json(expected)});`;
  const asService = sql => `set role service_role; ${sql}`;
  const capture = () => scalar(asService(rpc(null)));
  const counts = () => scalar(`select jsonb_build_object('events',(select count(*) from public.debate_v3_events),
    'receipts',(select count(*) from public.debate_v3_receipts),'audit',(select count(*) from public.debate_v3_audit),
    'outbox',(select count(*) from public.debate_v3_outbox),'uploads',(select count(*) from public.debate_v3_uploads),
    'match_versions',(select count(*) from public.debate_v3_match_versions),'ballots',(select count(*) from public.debate_v3_ballots),
    'votes',(select count(*) from public.debate_v3_votes),
    'rates',(select count(*) from public.debate_v3_rate_limits),'users',(select count(*) from auth.users));`);
  try {
    const version = await run('show server_version;'); report.postgresVersion = version;
    check('Actual engine is PostgreSQL17.6 without SQL source adaptations', /^17\.6(?:\D|$)/u.test(version));
    await run(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; create schema storage; grant usage on schema private to service_role;
      create table auth.users(id uuid primary key,email text,created_at timestamptz,aud text,role text,is_super_admin boolean,
        is_anonymous boolean,is_sso_user boolean,deleted_at timestamptz,email_confirmed_at timestamptz,
        raw_user_meta_data jsonb,raw_app_meta_data jsonb);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
      create table auth.refresh_tokens(id bigint primary key,user_id text,revoked boolean);
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text,assigned_by uuid references auth.users(id));
      create table private.internal_test_accounts(user_id uuid primary key references auth.users(id),email_at_classification text,classification_source text);
      alter table private.internal_test_accounts enable row level security; alter table private.internal_test_accounts force row level security;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text references storage.buckets(id),name text);
      ${['payment_requests','subscriptions','free_beta_access','admin_capabilities','examination_beta_access',
        'examination_participants','examination_attempts_multi','grade_reservations','refund_requests'].map(table => `create table public.${table}(user_id uuid references auth.users(id));`).join('\n')}
      ${['payment_request_history','refund_request_history'].map(table => `create table public.${table}(actor_user_id uuid references auth.users(id));`).join('\n')}
      create table public.subscription_history(user_id uuid references auth.users(id),actor_user_id uuid references auth.users(id));
      create table public.examination_definitions(created_by uuid references auth.users(id));`);
    await run(debateMigration);
    await run(sqlSource);
    check('Exact reviewed staging helper SQL installs with no adaptation', true);
    await run('drop function public.astra_staging_debate_cleanup_v1(jsonb,jsonb); drop function private.astra_staging_debate_cleanup_v1(jsonb,jsonb);');
    await run(legacySource);
    check('Ephemeral CI reconstructs and installs the byte-exact already-hosted legacy helper', true);
    for (const f of fixtures) {
      const email = `dd-study-room-student-${f.runId}@example.com`;
      await run(`insert into auth.users values(${quote(f.id)},${quote(email)},${quote(createdAt)},'authenticated','authenticated',false,false,false,null,${quote(createdAt)},
        ${json({ full_name: 'Synthetic Study Room student' })},${json({ provider: 'email', providers: ['email'], astra_staging_study_room_fixture: { version: 1, runId: f.runId, label: 'student' } })});
        insert into public.user_roles values(${quote(f.id)},'student',null);
        insert into private.internal_test_accounts values(${quote(f.id)},${quote(email)},${quote(`astra_study_room_staging_v1:${f.runId}:student`)});`);
    }
    const event = { id: eventId, ownerId: host, revision: 2, title, rehearsal: true, visibility: 'unlisted', media: {},
      members: Object.fromEntries(fixtures.slice(0, 10).map(f => [f.id, { id: f.id }])) };
    const exportJob = { id: exportId, eventId, actorId: host, type: 'export', payload: { kind: 'rules', format: 'pdf' } };
    const cleanupJob = { id: cleanupId, eventId, actorId: host, type: 'delete_evidence', payload: { uploadId, matchId, storageKey: evidenceKey } };
    const upload = { id: uploadId, eventId, actorId: host, matchId, storageKey: evidenceKey, mime: 'application/pdf', size: 20 };
    await run(`insert into public.debate_v3_events values(${quote(eventId)},${quote(host)},2,'draft',${json(event)},${createdMs},${createdMs});
      insert into public.debate_v3_receipts values(${quote(host)},'create_event',${quote(eventId)},'owned-idempotency','hash',${json({ id: ID(110), result: { eventId } })},${createdMs});
      insert into public.debate_v3_audit values(${quote(eventId)},2,${quote(host)},'create_event',${json({ immutable: true })},${createdMs});
      insert into public.debate_v3_outbox(id,event_id,actor_id,type,job,status,next_attempt_ms,claim_id,result) values
        (${quote(exportId)},${quote(eventId)},${quote(host)},'export',${json(exportJob)},'completed',${createdMs},${quote(ID(111))},${json({ storageKey: exportKey })}),
        (${quote(cleanupId)},${quote(eventId)},${quote(host)},'delete_evidence',${json(cleanupJob)},'cancelled',${createdMs},null,null);
      insert into public.debate_v3_uploads values(${quote(uploadId)},${quote(eventId)},${quote(host)},${quote(matchId)},'A',${json(upload)},'retained',${createdMs + 86400000},${quote(cleanupId)});
      insert into public.debate_v3_rate_limits values(${quote(host)},'discover_events',${Math.floor(createdMs / 60000)},1);
      insert into public.debate_v3_match_versions values(${quote(eventId)},${quote(matchId)},2,${json({ saved: true })});
      insert into public.debate_v3_ballots values(${quote(eventId)},${quote(matchId)},1,${quote(host)},${json({ scores: { A: 80, N: 79 } })},2);
      insert into public.debate_v3_votes values(${quote(eventId)},${quote(matchId)},${quote(ID(140))},${quote(fixtures[9].id)},${json({ teamId: 'A' })},2);
      insert into public.debate_v3_events values(${quote(foreignEventId)},${quote(ID(999))},1,'draft',${json({ id: foreignEventId, ownerId: ID(999), members: { [ID(999)]: { id: ID(999) } }, title: 'Unrelated retained fixture' })},${createdMs},${createdMs});
      insert into public.debate_v3_receipts values(${quote(ID(999))},'create_event',${quote(foreignEventId)},'foreign-idempotency','foreign-hash','{"retained":true}',${createdMs});
      insert into public.debate_v3_rate_limits values(${quote(ID(999))},'discover_events',${Math.floor(createdMs / 60000)},1);
      insert into storage.buckets values('debate-private-v3','debate-private-v3',false,10485760,array['application/pdf','image/jpeg','image/png','text/csv']);`);
    const foreignRows = () => scalar(`select jsonb_build_object('event',(select to_jsonb(e) from public.debate_v3_events e where id=${quote(foreignEventId)}),
      'receipt',(select to_jsonb(r) from public.debate_v3_receipts r where actor_id=${quote(ID(999))}),
      'rate',(select to_jsonb(r) from public.debate_v3_rate_limits r where actor_id=${quote(ID(999))}));`);
    const unrelatedBefore = await foreignRows();
    const functionState = () => scalar(`select jsonb_agg(jsonb_build_object('schema',n.nspname,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      'owner',r.rolname,'securityDefiner',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) order by n.nspname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
      where p.proname='astra_staging_debate_cleanup_v1' and n.nspname in ('private','public');`);
    const legacyFunctions = await functionState(), beforeUpgrade = await counts();
    await run(asService(rpc(null)), { expectedCode: 'P0001', expectedMessage: 'HOSTED_CLEANUP_EVENT_INTENT' });
    check('The actual generated de- event reproduces the legacy helper rejection before upgrade', JSON.stringify(await counts()) === JSON.stringify(beforeUpgrade));
    for (const [name, mutation, expectedMessage] of [
      ['private body drift', `create or replace function private.astra_staging_debate_cleanup_v1(p_manifest jsonb,p_expected jsonb)
        returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='5s' set statement_timeout='20s'
        as ${quote(functionBodies(legacySource)[0] + '\n-- intentional inert native drift\n')};`, 'HOSTED_CLEANUP_UPGRADE_DEFINITION_DRIFT'],
      ['public security drift', 'alter function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) security definer;', 'HOSTED_CLEANUP_UPGRADE_DEFINITION_DRIFT'],
      ['public timeout drift', "alter function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) set statement_timeout='21s';", 'HOSTED_CLEANUP_UPGRADE_DEFINITION_DRIFT'],
      ['unexpected authenticated execute grant', 'grant execute on function public.astra_staging_debate_cleanup_v1(jsonb,jsonb) to authenticated;', 'HOSTED_CLEANUP_UPGRADE_PRIVILEGE_DRIFT'],
    ]) {
      // The deliberate mutation and exact upgrade source share one transaction.
      // psql closes its failed connection, rolling back the inert test mutation.
      await run(`begin; ${mutation}\n${upgradeSource}`, { expectedCode: 'P0001', expectedMessage });
      check(`Guarded upgrade refuses ${name} and rolls back without row changes`,
        JSON.stringify(await functionState()) === JSON.stringify(legacyFunctions) && JSON.stringify(await counts()) === JSON.stringify(beforeUpgrade));
    }
    await run(upgradeSource);
    const upgradedFunctions = await functionState();
    check('Exact guarded upgrade yields fresh-install private body while preserving public wrapper, owner, ACL and config',
      JSON.stringify(upgradedFunctions) === JSON.stringify(legacyFunctions.map(f => f.schema === 'private' ? { ...f, bodySha256: hash(functionBodies(sqlSource)[0]) } : f)));
    check('Guarded upgrade changes no fixture or unrelated table rows', JSON.stringify(await counts()) === JSON.stringify(beforeUpgrade) && JSON.stringify(await foreignRows()) === JSON.stringify(unrelatedBefore));
    await run(upgradeSource, { expectedCode: 'P0001', expectedMessage: 'HOSTED_CLEANUP_UPGRADE_DEFINITION_DRIFT' });
    check('Already upgraded helper refuses a second application without mutating the definition', JSON.stringify(await functionState()) === JSON.stringify(upgradedFunctions));
    const initial = await capture(); check('Capture accepts real export and retained evidence job envelopes', initial.status === 'CAPTURED' && initial.snapshot.storageKeys.length === 2);
    check('Generated de- event and exact export/evidence paths are captured for atomic cleanup',
      /^de-[a-f0-9]{32}$/u.test(eventId) && initial.snapshot.counts.events === 1 &&
      initial.snapshot.storageKeys.includes(exportKey) && initial.snapshot.storageKeys.includes(evidenceKey));
    for (const invalidId of [ID(100), 'de-' + 'a'.repeat(31), 'de-' + 'a'.repeat(33), 'de-' + 'A'.repeat(32), eventId + '/other']) {
      await run(asService(rpc(null, { ...manifest, events: [{ id: invalidId, title }] })),
        { expectedCode: 'P0001', expectedMessage: 'HOSTED_CLEANUP_EVENT_INTENT' });
    }
    check('UUID, malformed, uppercase and path-bearing event intents remain rejected', JSON.stringify(await counts()) === JSON.stringify(beforeUpgrade));
    await run(asService(rpc(null, { ...manifest, fixtures: [{ ...fixtures[0], id: eventId }, ...fixtures.slice(1)] })),
      { expectedCode: 'P0001', expectedMessage: 'HOSTED_CLEANUP_FIXTURE_SCOPE' });
    check('Generated event IDs cannot replace Auth fixture UUIDs', true);
    for (const invalidKey of [`evidence/${ID(100)}/${matchId}/${uploadId}.pdf`,
      `evidence/${foreignEventId}/${matchId}/${uploadId}.pdf`, `evidence/${eventId}/../${uploadId}.pdf`]) {
      await run(`update public.debate_v3_outbox set job=jsonb_set(job,'{payload,storageKey}',${json(invalidKey)}) where id=${quote(cleanupId)};`);
      await run(asService(rpc(null)), { expectedCode: 'P0001', expectedMessage: 'HOSTED_CLEANUP_STORAGE_KEY' });
      await run(`update public.debate_v3_outbox set job=jsonb_set(job,'{payload,storageKey}',${json(evidenceKey)}) where id=${quote(cleanupId)};`);
    }
    check('UUID event paths, another event prefix and traversal cannot enter an accepted snapshot', JSON.stringify(await capture()) === JSON.stringify(initial));
    check('Snapshot exposes only native hashes/counts/keys, no private record content', !JSON.stringify(initial).includes('immutable'));
    for (const role of ['anon', 'authenticated']) {
      await run(`set role ${role}; ${rpc(null)}`, { expectedCode: '42501' });
      await run(`set role ${role}; select private.astra_staging_debate_cleanup_v1(${json(manifest)},null);`, { expectedCode: '42501' });
    }
    const privileges = await scalar(`select jsonb_build_object('anon',has_function_privilege('anon','public.astra_staging_debate_cleanup_v1(jsonb,jsonb)','execute'),
      'authenticated',has_function_privilege('authenticated','public.astra_staging_debate_cleanup_v1(jsonb,jsonb)','execute'),
      'service',has_function_privilege('service_role','public.astra_staging_debate_cleanup_v1(jsonb,jsonb)','execute'),
      'auditUpdate',has_table_privilege('service_role','public.debate_v3_audit','update'),
      'auditTruncate',has_table_privilege('service_role','public.debate_v3_audit','truncate'));`);
    check('Only service invokes helper and audit UPDATE/TRUNCATE stay denied', !privileges.anon && !privileges.authenticated && privileges.service && !privileges.auditUpdate && !privileges.auditTruncate);
    await run(asService(rpc(null, { ...manifest, projectRef: 'hbllomlijfznnuudpdvr' })), { expectedCode: 'P0001' });
    check('Wrong project context fails while external project identity remains separately pinned', true);
    const beforeDrift = await counts();
    await run(`update public.debate_v3_receipts set receipt=receipt||'{"changedAfterCapture":true}'::jsonb where actor_id=${quote(host)};`);
    await run(asService(rpc(initial.snapshot)), { expectedCode: 'P0001' });
    check('Changed non-key receipt JSON aborts before every DB deletion', JSON.stringify(await counts()) === JSON.stringify(beforeDrift));
    check('Changed receipt itself remains for reconciliation', await scalar(`select receipt ? 'changedAfterCapture' from public.debate_v3_receipts where actor_id=${quote(host)};`));
    await run(`update public.debate_v3_receipts set receipt=receipt-'changedAfterCapture' where actor_id=${quote(host)};`);
    for (const [name, mutate, restore] of [
      ['immutable classification', `update private.internal_test_accounts set classification_source='foreign' where user_id=${quote(host)}`, `update private.internal_test_accounts set classification_source=${quote(`astra_study_room_staging_v1:${fixtures[0].runId}:student`)} where user_id=${quote(host)}`],
      ['platform promotion', `update public.user_roles set role='admin' where user_id=${quote(host)}`, `update public.user_roles set role='student' where user_id=${quote(host)}`],
      ['active Auth session', `insert into auth.sessions values(${quote(ID(120))},${quote(host)})`, `delete from auth.sessions where id=${quote(ID(120))}`],
      ['billing data', `insert into public.payment_requests values(${quote(host)})`, `delete from public.payment_requests where user_id=${quote(host)}`],
      ['embedded provider job type', `update public.debate_v3_outbox set job=jsonb_set(job,'{type}','"mail"') where id=${quote(exportId)}`, `update public.debate_v3_outbox set job=jsonb_set(job,'{type}','"export"') where id=${quote(exportId)}`],
      ['running delivery claim', `update public.debate_v3_outbox set status='running' where id=${quote(exportId)}`, `update public.debate_v3_outbox set status='completed' where id=${quote(exportId)}`],
      ['foreign event member', `update public.debate_v3_events set state=jsonb_set(state,'{members}',(state->'members')||${json({ [ID(999)]: { id: ID(999) } })}) where id=${quote(eventId)}`, `update public.debate_v3_events set state=jsonb_set(state,'{members}',(state->'members')-${quote(ID(999))}::text) where id=${quote(eventId)}`],
    ]) {
      await run(`${mutate};`); await run(asService(rpc(null)), { expectedCode: 'P0001' });
      await run(asService(rpc(initial.snapshot)), { expectedCode: 'P0001' });
      check(`${name} fails before any Debate deletion`, JSON.stringify(await counts()) === JSON.stringify(beforeDrift)); await run(`${restore};`);
    }
    await run(`insert into storage.objects values(${quote(ID(130))},'debate-private-v3',${quote(exportKey)});`);
    await run(asService(rpc(initial.snapshot)), { expectedCode: 'P0001' });
    check('Fixture Storage metadata presence blocks DB cleanup', JSON.stringify(await counts()) === JSON.stringify(beforeDrift));
    await run(`delete from storage.objects where id=${quote(ID(130))};`);
    async function waitForLock(applicationName, mode) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const held = await scalar(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
          where a.application_name=${quote(applicationName)} and l.relation='public.debate_v3_rate_limits'::regclass and l.mode=${quote(mode)} and l.granted);`);
        if (held) return; await pause(50);
      }
      throw new Error('NATIVE_LOCK_BARRIER_TIMEOUT');
    }
    const holderName = 'debate-cleanup-capture-holder';
    const holder = run(`begin; set local role service_role; set local statement_timeout='15s'; ${rpc(null)} select pg_sleep(4); rollback;`, { applicationName: holderName });
    await waitForLock(holderName, 'ShareRowExclusiveLock');
    await run(`set statement_timeout='1s'; insert into public.debate_v3_rate_limits values(${quote(host)},'claim_invite',${Math.floor(createdMs / 60000)},1);`, { expectedCode: '57014' });
    await holder;
    check('A second native connection cannot INSERT a no-FK rate phantom while capture holds locks', JSON.stringify(await counts()) === JSON.stringify(beforeDrift));
    const blockerName = 'debate-cleanup-write-blocker';
    const blocker = run(`begin; lock public.debate_v3_rate_limits in row exclusive mode; select pg_sleep(7); rollback;`, { applicationName: blockerName });
    await waitForLock(blockerName, 'RowExclusiveLock');
    await run(`set statement_timeout='12s'; ${asService(rpc(initial.snapshot))}`, { expectedCode: '55P03' });
    await blocker;
    check('Five-second lock contention fails with no partial deletion or retry', JSON.stringify(await counts()) === JSON.stringify(beforeDrift));
    report.nativeConcurrentConnections = true;
    const result = await scalar(asService(rpc(initial.snapshot)));
    check('Exact captured event, export/evidence records, receipts, audit and rate rows delete in one transaction', result.status === 'DELETED_ATOMICALLY');
    const after = await counts(); check('All scoped Debate data absent and all11 Auth identities retained for lifecycle cleanup',
      Object.entries(after).every(([name, value]) => name === 'users' ? value === 11 : ['events', 'receipts', 'rates'].includes(name) ? value === 1 : value === 0));
    check('Unrelated coexisting event, receipt and no-FK rate rows remain byte-for-byte equivalent', JSON.stringify(await foreignRows()) === JSON.stringify(unrelatedBefore));
    check('Private feature bucket is retained', await scalar("select count(*)=1 from storage.buckets where id='debate-private-v3' and public=false;"));
    report.status = 'PASS_NATIVE_POSTGRES17_ATOMIC_CLEANUP';
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: /^[A-Z_]{3,80}$/u.test(error.message) ? error.message : 'NATIVE_ATOMIC_CLEANUP_FAILED',
      sqlState: error.observedState || null, messageSha256: hash(String(error.message)) };
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  }
});
