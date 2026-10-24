import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { LOGICAL_MIGRATION, runLogicalCapacitySqlCases } from './media-capacity-logical-sql-cases.mjs';

export const MIGRATION = 'supabase/migrations/20260909193705_shared_media_capacity_foundation.sql';
const root = new URL('../', import.meta.url);
const read = async file => (await readFile(new URL(file, root), 'utf8')).replaceAll('\r\n', '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const projectId = 'p_capacitytest01', coordinatorId = '00000000-0000-4000-8000-000000000001';
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
let sequence = 1000;
const command = (operation, fields = {}) => ({ operation, projectId, coordinatorId, commandId: id(sequence++), policyRevision: 1, ...fields });
const reserve = (epoch, actor, scopeKey = 'study-room-1', extra = {}) => command('reserve', { epochId: id(epoch), actorId: id(actor), scopeKey, reservedSeconds: 600, reservedBytes: 1000000, ...extra });
const sqlCall = input => `select public.media_capacity_command(${quote(JSON.stringify(input))}::jsonb);`;

test('capacity migration is disabled and additive without modifying existing room/auth/billing tables', async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /enabled boolean not null default false/);
  assert.ok(!/insert into private\.media_capacity_(?:policies|scopes)/i.test(sql));
  assert.ok(!/\b(?:create|alter|drop|update|insert into|delete from)\s+(?:table\s+)?(?:auth\.|storage\.|public\.(?:debate_v3|study_room|user_roles|subscriptions))/i.test(sql));
  assert.match(sql, /from private\.media_capacity_policies where project_id=project for update/);
  assert.match(sql, /revoke all on private\.media_capacity_policies[\s\S]+from public,anon,authenticated,service_role/);
});

test('native PostgreSQL17 atomically limits physical epochs across Study and Debate', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || process.env.MEDIA_CAPACITY_SQL_CI !== '1'
    ? 'Native SQL runs only in dedicated isolated Linux CI; no local or hosted SQL proof is claimed.' : false,
  timeout: 120000,
}, async () => {
  assert.equal(process.env.PGHOST, '127.0.0.1'); assert.equal(process.env.PGPORT, '5432');
  assert.equal(process.env.PGUSER, 'postgres'); assert.equal(process.env.PGDATABASE, 'media_capacity_ci');
  assert.ok(process.env.PGPASSWORD);
  const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const output = new URL('artifacts/debate-local-rehearsal/media-capacity-native-ci/', root);
  await mkdir(output, { recursive: true });
  const report = { kind: 'NATIVE_POSTGRES17_MEDIA_CAPACITY_FOUNDATION', status: 'RUNNING', startedAt: new Date().toISOString(),
    hostedExecuted: false, issuerIntegrated: false, providerObserved: false, nativeConcurrentConnections: false, nativeLogicalConcurrentConnections: false,
    dependencySchemaScope: 'Dedicated empty PostgreSQL17 database and inert anon/authenticated/service_role roles; exact new migration; no Auth server, Storage, LiveKit or existing product schema.',
    sourceHashesLf: {}, checks: [], expectedErrors: [], statementTimeoutMs: 10000, hostedPostgrestTimeoutHoisting: 'UNVERIFIED' };
  function run(sql, { expectedSqlstate, app = 'capacity-native', onOutput } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('psql', ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'], { env: { ...env, PGAPPNAME: app }, stdio: ['pipe','pipe','pipe'] });
      let stdout = '', stderr = '', finished = false;
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('CAPACITY_NATIVE_TIMEOUT')); }, 20000);
      child.on('error', () => { clearTimeout(timer); reject(new Error('CAPACITY_NATIVE_SPAWN_FAILED')); });
      child.stdout.on('data', data => { stdout += data.toString(); if (stdout.length > 1000000) child.kill('SIGTERM'); onOutput?.(stdout); });
      child.stderr.on('data', data => { stderr += data.toString(); if (stderr.length > 1000000) child.kill('SIGTERM'); });
      child.on('close', code => {
        clearTimeout(timer); if (finished) return; finished = true;
        if (expectedSqlstate) {
          const actual = /ERROR:\s+([A-Z0-9]{5}):/u.exec(stderr)?.[1];
          if (code !== 0 && actual === expectedSqlstate) { report.expectedErrors.push({ expectedSqlstate, actualSqlstate: actual }); resolve(actual); }
          else reject(new Error('CAPACITY_EXPECTED_SQLSTATE_MISMATCH'));
        } else if (code !== 0) {
          report.lastDatabaseError = { sqlstate: /ERROR:\s+([A-Z0-9]{5}):/u.exec(stderr)?.[1] || null, messageSha256: hash(stderr) };
          reject(new Error('CAPACITY_NATIVE_SQL_FAILED'));
        } else resolve(stdout.trim());
      });
      child.stdin.end(sql);
    });
  }
  const rpc = async input => JSON.parse(await run(`set role service_role; ${sqlCall(input)}`));
  const get = epoch => rpc({ operation: 'read', projectId, coordinatorId, epochId: id(epoch) });
  const good = async input => { const result = await rpc(input); assert.equal(result.ok, true, JSON.stringify(result)); return result; };
  const denied = async (input, code) => { const result = await rpc(input); assert.deepEqual(result, { ok: false, error: { code } }); };
  const check = name => report.checks.push({ name, passed: true });
  const reset = async () => run(`delete from private.media_capacity_commands where project_id=${quote(projectId)};
    delete from private.media_capacity_epochs where project_id=${quote(projectId)};
    update private.media_capacity_policies set revision=1,enabled=true,hard_cap=100,reconnect_reserve=10,external_occupancy=0,
      inventory_valid_until_ms=(extract(epoch from clock_timestamp())*1000)::bigint+3600000,
      budget_valid_until_ms=(extract(epoch from clock_timestamp())*1000)::bigint+86400000,
      budget_seconds=1000000,budget_bytes=1000000000,debited_seconds=0,debited_bytes=0 where project_id=${quote(projectId)};
    update private.media_capacity_scopes set enabled=true,room_cap=10,session_cap=100,event_cap=100,external_occupancy=0 where project_id=${quote(projectId)};`);
  async function fence(epoch) {
    const existing = (await get(epoch)).reservation;
    const releasing = command('request_release', { epochId: id(epoch), expectedVersion: existing.version });
    const row = (await good(releasing)).reservation;
    const at = Date.now();
    return { row, releasing, input: command('confirm_released', { epochId: id(epoch), expectedVersion: row.version,
      proof: { releaseCommandId: releasing.commandId, projectId, roomName: row.room_name, identity: row.identity,
        revocationAcknowledged: true, absent: true, cutoffSeconds: Math.floor(Math.max(at, row.release_requested_at_ms) / 1000) + 1, acknowledgedAtMs: at, observedAtMs: at } }) };
  }
  try {
    for (const file of [MIGRATION,LOGICAL_MIGRATION,'worker/media-capacity.mjs','worker/media-capacity.test.mjs','scripts/test-media-capacity-sql.mjs','scripts/media-capacity-logical-sql-cases.mjs','.github/workflows/media-capacity-foundation.yml','docs/debate-room-v3/media-capacity-foundation.md']) report.sourceHashesLf[file] = hash(await read(file));
    report.postgresVersion = await run('show server_version;'); assert.match(report.postgresVersion, /^17\./);
    assert.equal(await run("select current_database()='media_capacity_ci' and to_regclass('private.media_capacity_policies') is null;"), 't');
    await run('create role anon; create role authenticated; create role service_role bypassrls;');
    await run(await read(MIGRATION));
    assert.equal(await run('select count(*) from private.media_capacity_policies;'), '0'); check('Migration installs no enabled policies, scopes or reservations');
    await denied(reserve(1, 101), 'MEDIA_CAPACITY_PROJECT_MISMATCH');
    await run(`insert into private.media_capacity_policies(project_id,coordinator_id) values(${quote(projectId)},${quote(coordinatorId)});
      insert into private.media_capacity_scopes(project_id,scope_key,product,room_name,event_key,session_key,room_cap,session_cap,event_cap) values
      (${quote(projectId)},'study-room-1','study','study-room-1','study-event-1','study-session-1',12,12,12),
      (${quote(projectId)},'debate-main-1','debate','debate-main-1','debate-event-1','debate-session-1',100,100,100),
      (${quote(projectId)},'debate-private-1','debate','debate-private-1','debate-event-1','debate-session-1',100,100,100),
      (${quote(projectId)},'debate-main-2','debate','debate-main-2','debate-event-2','debate-session-2',100,100,100);`);
    await denied(reserve(1, 101), 'MEDIA_CAPACITY_DISABLED'); check('Disabled policy cannot admit');
    for (const role of ['anon','authenticated']) for (const schema of ['public','private']) await run(`set role ${role}; select ${schema}.media_capacity_command('{}');`, { expectedSqlstate: '42501' });
    for (const table of ['policies','scopes','epochs','commands']) await run(`set role service_role; select * from private.media_capacity_${table};`, { expectedSqlstate: '42501' });
    await run('set role service_role; update private.media_capacity_policies set enabled=true;', { expectedSqlstate: '42501' }); check('Only RPC execute is granted; public users and direct service table access denied');
    await reset();
    await denied({ ...reserve(1, 101), coordinatorId: id(999) }, 'MEDIA_CAPACITY_PROJECT_MISMATCH');
    await denied({ ...reserve(1, 101), projectId: 'p_foreign0001' }, 'MEDIA_CAPACITY_PROJECT_MISMATCH');
    await denied({ ...reserve(1, 101), policyRevision: 2 }, 'MEDIA_CAPACITY_POLICY_CHANGED'); check('Exact coordinator, project and policy revision required');
    const first = reserve(1, 101); await good(first); assert.equal((await good(first)).replayed, true);
    await denied({ ...first, reservedSeconds: 601 }, 'MEDIA_CAPACITY_IDEMPOTENCY_CONFLICT');
    assert.equal(await run(`select count(*) from private.media_capacity_epochs where project_id=${quote(projectId)};`), '1');
    assert.equal(await run(`select debited_seconds from private.media_capacity_policies where project_id=${quote(projectId)};`), '600'); check('Idempotent replay does not duplicate seats or debit budgets');
    await denied(reserve(2, 101), 'MEDIA_CAPACITY_HANDOFF_REQUIRED');
    await denied(reserve(2, 102, 'study-room-1', { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_REPLACEMENT_INVALID'); check('Second view/device cannot consume a new or forged handoff grant');
    await good(command('mark_issued', { epochId: id(1), expectedVersion: 1, tokenExpiresAtMs: Date.now() + 20000 }));
    await good(command('mark_connected', { epochId: id(1), expectedVersion: 2 }));
    const renewed = await good(command('mark_issued', { epochId: id(1), expectedVersion: 3, tokenExpiresAtMs: Date.now()+20000 }));
    assert.equal(renewed.reservation.state, 'connected');
    assert.equal(await run(`select count(*) from private.media_capacity_epochs where project_id=${quote(projectId)};`), '1');
    assert.equal(await run(`select debited_seconds from private.media_capacity_policies where project_id=${quote(projectId)};`), '600'); check('Same physical epoch renews within its allocation without a new seat or budget debit');
    await denied(command('mark_issued', { epochId: id(1), expectedVersion: 1, tokenExpiresAtMs: Date.now() + 20000 }), 'MEDIA_CAPACITY_VERSION_CONFLICT'); check('Stale mutation cannot revive an old epoch');
    await reset(); await good(reserve(1,101)); await run("update private.media_capacity_scopes set enabled=false where scope_key='study-room-1';");
    await denied(command('mark_issued', { epochId: id(1), expectedVersion: 1, tokenExpiresAtMs: Date.now()+20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED'); check('Scope closure during signing preparation cannot issue a grant');
    for (const drift of [
      `update private.media_capacity_policies set external_occupancy=100 where project_id=${quote(projectId)};`,
      `update private.media_capacity_policies set external_occupancy=10 where project_id=${quote(projectId)}; update private.media_capacity_scopes set external_occupancy=10 where scope_key='study-room-1';`,
      `update private.media_capacity_scopes set session_cap=1 where session_key='study-session-1'; update private.media_capacity_policies set external_occupancy=1 where project_id=${quote(projectId)}; update private.media_capacity_scopes set external_occupancy=1 where scope_key='study-room-1';`,
    ]) {
      await reset(); await good(reserve(1,101)); await run(drift);
      await denied(command('mark_issued', { epochId: id(1), expectedVersion: 1, tokenExpiresAtMs: Date.now()+20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED');
      assert.equal((await get(1)).reservation.state, 'reserved');
    }
    check('Current project, room and session occupancy is rechecked before mint intention');
    await reset(); await good(reserve(1,101)); await good(reserve(2,102,'debate-main-1'));
    await run(`update private.media_capacity_epochs set budget_deadline_ms=created_at_ms+1 where epoch_id=${quote(id(2))};`);
    await denied(command('mark_issued', { epochId: id(1), expectedVersion: 1, tokenExpiresAtMs: Date.now()+20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED'); check('Another unresolved overrun blocks new mint intentions as well as new reservations');
    await reset(); await run(`update private.media_capacity_policies set hard_cap=3,reconnect_reserve=1 where project_id=${quote(projectId)};`);
    await good(reserve(1,101)); await good(command('mark_issued', { epochId: id(1), expectedVersion: 1, tokenExpiresAtMs: Date.now() + 20000 }));
    await good(reserve(2,102,'debate-main-1'));
    await denied(reserve(3,103,'debate-main-2'), 'MEDIA_CAPACITY_PROJECT_LIMIT');
    await good(reserve(3,101,'debate-main-1', { replacesEpoch: id(1) }));
    await denied(reserve(4,101,'debate-main-2', { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_REPLACEMENT_INVALID');
    assert.equal(await run(`select count(*) from private.media_capacity_epochs where project_id=${quote(projectId)} and state<>'released';`), '3'); check('Reconnect reserve admits one exact replacement while both physical epochs remain counted');
    await reset(); await run(`update private.media_capacity_scopes set room_cap=1 where scope_key='study-room-1';`);
    await good(reserve(1,101)); await denied(reserve(2,102), 'MEDIA_CAPACITY_ROOM_LIMIT'); check('Room cap is independent of project headroom');
    await reset(); await run(`update private.media_capacity_scopes set session_cap=1 where session_key='debate-session-1';`);
    await good(reserve(1,101,'debate-main-1')); await denied(reserve(2,102,'debate-private-1'), 'MEDIA_CAPACITY_ROOM_LIMIT'); check('Private rooms share the same session cap');
    await reset(); await run(`update private.media_capacity_scopes set session_key='debate-other-session',event_cap=1 where scope_key='debate-private-1';`);
    await good(reserve(1,101,'debate-main-1')); await denied(reserve(2,102,'debate-private-1'), 'MEDIA_CAPACITY_ROOM_LIMIT'); check('Different sessions still share their event cap');
    await reset(); await run(`update private.media_capacity_policies set external_occupancy=90 where project_id=${quote(projectId)};`);
    await denied(reserve(1,101), 'MEDIA_CAPACITY_PROJECT_LIMIT'); check('Unmanaged provider occupancy consumes project capacity');
    await reset(); await run(`update private.media_capacity_scopes set external_occupancy=10 where scope_key='study-room-1';`);
    await denied(reserve(1,101), 'MEDIA_CAPACITY_INVENTORY_INVALID');
    await run(`update private.media_capacity_policies set external_occupancy=10 where project_id=${quote(projectId)};`);
    await denied(reserve(1,101), 'MEDIA_CAPACITY_ROOM_LIMIT'); check('Unmanaged room occupants count locally and cannot exceed declared project occupancy');
    await reset(); await run(`update private.media_capacity_policies set inventory_valid_until_ms=0 where project_id=${quote(projectId)};`);
    await denied(reserve(1,101), 'MEDIA_CAPACITY_INVENTORY_STALE'); check('Stale inventory closes admission');
    await reset(); await run(`update private.media_capacity_policies set budget_seconds=599 where project_id=${quote(projectId)};`);
    await denied(reserve(1,101), 'MEDIA_CAPACITY_BUDGET_LIMIT');
    await reset(); await run(`update private.media_capacity_policies set budget_bytes=999999 where project_id=${quote(projectId)};`);
    await denied(reserve(1,101), 'MEDIA_CAPACITY_BUDGET_LIMIT'); check('Both seconds and byte allocations bound admission');
    await reset(); await good(reserve(1,101));
    await good(command('mark_uncertain', { epochId: id(1), expectedVersion: 1 }));
    await run(`update private.media_capacity_epochs set token_expires_at_ms=1,budget_deadline_ms=created_at_ms+1 where epoch_id=${quote(id(1))};`);
    await denied(reserve(2,102), 'MEDIA_CAPACITY_BUDGET_RECONCILIATION_REQUIRED');
    assert.equal((await get(1)).reservation.state, 'uncertain'); check('Expired or uncertain epochs are held and block new budget admission');
    const release = await fence(1);
    for (const proof of [{ ...release.input.proof, absent: false }, { ...release.input.proof, revocationAcknowledged: false },
      { ...release.input.proof, identity: `mc-${id(99)}` }, { ...release.input.proof, roomName: 'wrong-room-0001' },
      { ...release.input.proof, observedAtMs: Date.now()-20000 }, { ...release.input.proof, cutoffSeconds: Math.floor(release.row.release_requested_at_ms/1000) }]) {
      await denied({ ...release.input, commandId: id(sequence++), proof }, 'MEDIA_CAPACITY_FENCE_UNCONFIRMED');
      assert.equal((await get(1)).reservation.state, 'revoking');
    }
    check('Bad, stale, same-second and wrong-identity fences cannot release a seat');
    await good(release.input); assert.equal((await get(1)).reservation.state, 'released');
    assert.equal(await run(`select debited_seconds from private.media_capacity_policies where project_id=${quote(projectId)};`), '600');
    assert.equal((await good(release.releasing)).reservation.state, 'released', 'Replay returns current state');
    await denied(command('mark_issued', { epochId: id(1), expectedVersion: (await get(1)).reservation.version, tokenExpiresAtMs: Date.now()+20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED'); check('Valid fence releases exactly one epoch, never refunds budget or revives a retired token');
    // Real independent connections contend on the shared policy row. Study wins
    // one uncommitted seat; Debate must block, then observe that committed seat.
    await reset(); await run(`update private.media_capacity_policies set hard_cap=2,reconnect_reserve=1 where project_id=${quote(projectId)};`);
    let readyResolve; const ready = new Promise(resolve => { readyResolve = resolve; });
    const holder = run(`begin; set local role service_role; ${sqlCall(reserve(1,101))} select 'CAPACITY_HOLDER_READY'; select pg_sleep(2); commit;`, { app: 'capacity-holder', onOutput: value => { if (value.includes('CAPACITY_HOLDER_READY')) readyResolve(); } });
    await Promise.race([ready, holder.then(() => { throw new Error('CAPACITY_HOLDER_NOT_READY'); })]);
    const started = performance.now();
    const contender = run(`set role service_role; ${sqlCall(reserve(2,102,'debate-main-2'))}`, { app: 'capacity-contender' });
    let blocked = false;
    for (let attempt = 0; attempt < 10 && !blocked; attempt++) {
      blocked = await run("select exists(select 1 from pg_stat_activity where application_name='capacity-contender' and wait_event_type='Lock');") === 't';
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(blocked, true, 'A second actual backend waits on the first transaction');
    await holder;
    assert.deepEqual(JSON.parse(await contender), { ok: false, error: { code: 'MEDIA_CAPACITY_PROJECT_LIMIT' } });
    assert.ok(performance.now()-started>500);
    assert.equal(await run(`select count(*) from private.media_capacity_epochs where project_id=${quote(projectId)};`), '1');
    report.nativeConcurrentConnections = true; check('Concurrent Study and different-event Debate admissions cannot take the same final seat');
    await reset();
    const aborted = reserve(9,109);
    await run(`begin; set local role service_role; ${sqlCall(aborted)} rollback;`);
    assert.equal((await get(9)).reservation, null);
    assert.equal(await run(`select debited_seconds from private.media_capacity_policies where project_id=${quote(projectId)};`), '0'); check('Caller rollback atomically removes reservation, idempotency receipt and budget debit');
    report.foundationCheckCount = report.checks.length;
    await runLogicalCapacitySqlCases({ run, rpc, read, report, check, quote, id, projectId, coordinatorId });
    for (const [file, digest] of Object.entries(report.sourceHashesLf)) assert.equal(hash(await read(file)), digest, file);
    report.status = 'PASS_NATIVE_MEDIA_CAPACITY_FOUNDATION_ONLY';
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: /^[A-Z_]{3,80}$/u.test(error.message) ? error.message : 'CAPACITY_NATIVE_ASSERTION_FAILED', messageSha256: hash(String(error.message)) }; throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2)+'\n');
  }
});
