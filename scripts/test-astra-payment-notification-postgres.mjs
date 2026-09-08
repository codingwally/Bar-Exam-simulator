import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// REAL PostgreSQL 17 / two independent native psql backends. Not a PGlite test.
// CI must provide a fresh, disposable service database. No database is created,
// dropped, discovered remotely or reused; failure is never converted to a skip.
// The minimal notification table/context is NOT a payment/access lifecycle.
// References: https://www.postgresql.org/docs/17/app-psql.html
// https://www.postgresql.org/docs/17/explicit-locking.html
// https://www.postgresql.org/docs/17/view-pg-locks.html
const DATABASE = 'astra_terminal_test';
const MIGRATION = '20260908115426_astra_payment_notification_sent_terminal.sql';
const MIGRATION_SHA = '5e84468e44346e97410c00e09c1e8a76a7d1385847ce499f6e7f241e26e0d64b';
const OLD_COMPLETE_SHA = '245803a0489b74fbd482c2de8fc55f8f6dfc5abf22417799c6cc9f7f02817855';
const NEW_COMPLETE_SHA = '9275b458fa8151cc6c66b9558bf2500685a8d24a53b5e43f58757be4b54318e2';
const CLAIM_SHA = 'c3a34ab7e47759057d3bd63ad3bd71c759b48c686ed62abfb7fc44547f8f1f95';
const sha = value => createHash('sha256').update(value).digest('hex');
const failure = code => Object.assign(new Error(code), {safeCode: code});
const requireTrue = (condition, code) => { if (!condition) throw failure(code); };
const pause = () => new Promise(resolve => setTimeout(resolve, 50));

export function connectionConfig(env = process.env) {
  requireTrue(env.CI === 'true' && env.GITHUB_ACTIONS === 'true'
    && env.ASTRA_TERMINAL_POSTGRES_TEST === '1', 'ASTRA_TERMINAL_CI_OPT_IN_REQUIRED');
  requireTrue(env.PGHOST === '127.0.0.1' && env.PGDATABASE === DATABASE
    && env.PGUSER === 'postgres', 'ASTRA_TERMINAL_LOCAL_TARGET_REQUIRED');
  requireTrue(/^[1-9][0-9]{0,4}$/.test(env.PGPORT || '') && Number(env.PGPORT) <= 65535,
    'ASTRA_TERMINAL_EXPLICIT_PORT_REQUIRED');
  requireTrue(typeof env.PGPASSWORD === 'string' && env.PGPASSWORD.length > 0
    && env.PGPASSWORD.length <= 256 && !/[\r\n\0]/.test(env.PGPASSWORD),
  'ASTRA_TERMINAL_DISPOSABLE_PASSWORD_REQUIRED');
  // Do not inherit libpq service files, hostaddr, options, URLs, user profiles,
  // application credentials or custom startup files. All SQL comes from stdin.
  const childEnv = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP']
    .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  Object.assign(childEnv, {
    PGPASSWORD: env.PGPASSWORD, PGCONNECT_TIMEOUT: '4', PGSSLMODE: 'disable',
    PGGSSENCMODE: 'disable', PGPASSFILE: '/dev/null', PSQL_HISTORY: '/dev/null',
    LC_ALL: 'C', LANG: 'C',
  });
  return {
    args: ['-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off',
      '-h', '127.0.0.1', '-p', env.PGPORT, '-U', 'postgres', '-d', DATABASE],
    env: childEnv,
  };
}

function sources() {
  const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  const soft = read('20260821120000_soft_launch_five_token_trial.sql');
  const extract = name => {
    const matches = [...soft.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`, 'g'))];
    requireTrue(matches.length === 1, 'ASTRA_TERMINAL_SOURCE_MATCH_REQUIRED');
    return matches[0][0];
  };
  const body = sql => sql.split('as $$')[1].split('$$;')[0];
  const claim = extract('phase4_claim_payment_notification');
  const complete = extract('phase4_complete_payment_notification');
  const migration = read(MIGRATION);
  requireTrue(sha(body(claim)) === CLAIM_SHA && sha(body(complete)) === OLD_COMPLETE_SHA
    && sha(migration) === MIGRATION_SHA, 'ASTRA_TERMINAL_SOURCE_PIN_MISMATCH');
  requireTrue(migration.match(/^begin;$/gm)?.length === 1
    && migration.match(/^commit;$/gm)?.length === 1, 'ASTRA_TERMINAL_FULL_TRANSACTION_REQUIRED');
  return {claim, complete, migration};
}

class PsqlBackend {
  constructor(config, name) {
    this.name = name;
    this.pending = null;
    this.buffer = '';
    this.outputBytes = 0;
    this.closed = false;
    this.exitResult = null;
    this.process = spawn('psql', config.args, {env: config.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    this.exit = new Promise(resolve => {
      this.process.once('close', (code, signal) => {
        this.closed = true;
        this.exitResult = {code, signal};
        this.rejectPending('ASTRA_TERMINAL_PSQL_EXIT');
        resolve(this.exitResult);
      });
    });
    this.process.on('error', () => this.rejectPending('ASTRA_TERMINAL_PSQL_UNAVAILABLE'));
    this.process.stdin.on('error', () => this.rejectPending('ASTRA_TERMINAL_PSQL_INPUT_FAILED'));
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', data => this.receive(data));
    // Never expose raw psql errors/SQL, passwords, host details or row bodies.
    // A nonzero exit is enough to fail closed; all expected SQL errors are caught
    // inside source-bound test DO blocks with exact SQLSTATE/message checks.
    this.process.stderr.on('data', data => {
      this.outputBytes += data.length;
      if (this.outputBytes > 131072) this.stop('ASTRA_TERMINAL_OUTPUT_BOUND');
    });
  }
  rejectPending(code) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(failure(code));
  }
  stop(code) {
    this.rejectPending(code);
    if (!this.closed) this.process.kill('SIGKILL');
  }
  receive(data) {
    this.outputBytes += Buffer.byteLength(data);
    if (this.outputBytes > 131072) return this.stop('ASTRA_TERMINAL_OUTPUT_BOUND');
    this.buffer += data;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      const pending = this.pending;
      if (!pending) {
        if (line.trim()) this.stop('ASTRA_TERMINAL_UNEXPECTED_OUTPUT');
        continue;
      }
      if (line === pending.marker) {
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(pending.lines.filter(value => value.trim()).join('\n'));
      } else pending.lines.push(line);
    }
  }
  run(sql) {
    if (this.closed || this.pending) return Promise.reject(failure('ASTRA_TERMINAL_BACKEND_NOT_IDLE'));
    const marker = `ASTRA_DONE_${randomUUID().replaceAll('-', '')}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop('ASTRA_TERMINAL_COMMAND_TIMEOUT'), 20000);
      this.pending = {marker, resolve, reject, timer, lines: []};
      this.process.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
    // Concurrent commands are awaited after observing a lock; observe rejection
    // immediately too, so a prerequisite failure cannot be an unhandled promise.
    promise.catch(() => {});
    return promise;
  }
  async json(sql) {
    const output = await this.run(sql);
    try { return JSON.parse(output); } catch { throw failure('ASTRA_TERMINAL_RESULT_SHAPE'); }
  }
  async close() {
    if (!this.closed) {
      this.rejectPending('ASTRA_TERMINAL_BACKEND_CLOSING');
      this.process.stdin.end('\\q\n');
      const kill = setTimeout(() => this.process.kill('SIGKILL'), 2000);
      await this.exit;
      clearTimeout(kill);
    }
    return this.exitResult;
  }
}

async function observeBlocked(observer, blockedPid, blockerPid, relationLock = false) {
  const deadline = Date.now() + 2500; // Below the actual migration's 4s lock timeout.
  while (Date.now() < deadline) {
    const observed = await observer.json(`select jsonb_build_object(
      'blocked', ${blockerPid}=any(pg_blocking_pids(${blockedPid})),
      'waiting', exists(select 1 from pg_locks where pid=${blockedPid} and not granted),
      'relationLock', exists(select 1 from pg_locks where pid=${blockedPid}
        and relation='public.payment_requests'::regclass and mode='ShareRowExclusiveLock' and not granted));`);
    if (observed.blocked && observed.waiting && (!relationLock || observed.relationLock)) return;
    await pause();
  }
  throw failure('ASTRA_TERMINAL_EXPECTED_LOCK_NOT_OBSERVED');
}

const rowSql = id => `select to_jsonb(p) from public.payment_requests p where id='${id}'::uuid;`;
const finishSql = (id, provider) => `select public.phase4_complete_payment_notification('${id}'::uuid,'sent','${provider}',null);`;
const metadataSql = `select jsonb_build_object(
  'claim', (select to_jsonb(p)-'oid' from pg_proc p where oid='public.phase4_claim_payment_notification(uuid)'::regprocedure),
  'completion', (select to_jsonb(p)-'oid'-'prosrc' from pg_proc p where oid='public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure));`;

export async function runPostgresTest(env = process.env) {
  const config = connectionConfig(env); // Guard before process launch or SQL read.
  const source = sources();
  const backends = [];
  const checks = [];
  const wholeTimer = setTimeout(() => {
    for (const backend of backends) backend.stop('ASTRA_TERMINAL_WHOLE_TEST_TIMEOUT');
  }, 60000);
  let result;
  try {
    const a = new PsqlBackend(config, 'writer-a'); backends.push(a);
    const identity = await a.json(`select jsonb_build_object(
      'database',current_database(),'user',current_user,'sessionUser',session_user,
      'owner',(select pg_get_userbyid(datdba) from pg_database where datname=current_database()),
      'version',current_setting('server_version_num')::integer,'pid',pg_backend_pid(),
      'pristine',not exists(select 1 from pg_class where relnamespace='public'::regnamespace)
        and not exists(select 1 from pg_proc where pronamespace='public'::regnamespace)
        and not exists(select 1 from pg_namespace where nspname not in ('public','information_schema') and nspname !~ '^pg_')
        and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')));`);
    requireTrue(identity.database === DATABASE && identity.user === 'postgres' && identity.sessionUser === 'postgres'
      && identity.owner === 'postgres' && identity.version >= 170000 && identity.version < 180000
      && identity.pristine && Number.isSafeInteger(identity.pid), 'ASTRA_TERMINAL_PRISTINE_POSTGRES17_REQUIRED');
    checks.push('actual-postgresql17-pristine-loopback-database');
    await a.run(`set statement_timeout='8s'; set lock_timeout='6s'; set idle_in_transaction_session_timeout='10s';
      set timezone='UTC'; set application_name='astra-terminal-writer-a';
      create role anon; create role authenticated; create role service_role;
      create schema private; revoke all on schema private from public,anon,authenticated,service_role;
      create table public.payment_requests(
        id uuid primary key,submitted_at timestamptz not null default clock_timestamp(),
        status text not null default 'pending',student_note text,
        verification_email_status text not null default 'pending'
          check(verification_email_status in ('pending','sending','sent','failed','suppressed')),
        verification_email_attempts integer not null default 0,
        verification_email_provider_id text,verification_email_error text,
        verification_email_last_attempt_at timestamptz,verification_email_sent_at timestamptz);
      grant usage on schema public to anon,authenticated,service_role;
      grant select,update on public.payment_requests to service_role;
      create function public.phase4_payment_notification_context(p_id uuid) returns jsonb language sql as
        'select jsonb_build_object(''id'',id,''notificationAttempts'',verification_email_attempts) from public.payment_requests where id=p_id';
      ${source.claim}
      ${source.complete}
      revoke all on function public.phase4_claim_payment_notification(uuid) from public,anon,authenticated;
      grant execute on function public.phase4_claim_payment_notification(uuid) to service_role;
      revoke all on function public.phase4_complete_payment_notification(uuid,text,text,text) from public,anon,authenticated;
      grant execute on function public.phase4_complete_payment_notification(uuid,text,text,text) to service_role;`);
    const b = new PsqlBackend(config, 'writer-b'); backends.push(b);
    const second = await b.json(`set statement_timeout='8s'; set lock_timeout='6s';
      set idle_in_transaction_session_timeout='10s'; set timezone='UTC';
      set application_name='astra-terminal-writer-b';
      select jsonb_build_object('pid',pg_backend_pid(),'database',current_database(),'version',current_setting('server_version_num')::integer);`);
    requireTrue(second.database === DATABASE && second.version === identity.version
      && Number.isSafeInteger(second.pid) && second.pid !== identity.pid, 'ASTRA_TERMINAL_DISTINCT_BACKENDS_REQUIRED');
    const beforeMetadata = await a.json(metadataSql);

    // Positive control: the unchanged old completion really can erase a success.
    const baselineId = randomUUID();
    await a.run(`insert into public.payment_requests(id,verification_email_status) values('${baselineId}','sending');
      ${finishSql(baselineId, 'synthetic-control-first')}
      select public.phase4_complete_payment_notification('${baselineId}','failed',null,'synthetic-control-stale');`);
    const baseline = await a.json(rowSql(baselineId));
    requireTrue(baseline.verification_email_status === 'failed' && baseline.verification_email_provider_id === null
      && baseline.verification_email_sent_at !== null, 'ASTRA_TERMINAL_OLD_DEFECT_CONTROL_REQUIRED');
    checks.push('exact-old-completion-reproduces-sent-to-failed-defect');

    // A is an already-running old writer. B runs the ENTIRE unchanged migration.
    const installId = randomUUID();
    await a.run(`insert into public.payment_requests(id,verification_email_status,verification_email_attempts,verification_email_last_attempt_at)
      values('${installId}','sending',1,clock_timestamp());
      begin; set local role service_role; ${finishSql(installId, 'synthetic-first-before-install')} reset role;`);
    const firstSent = await a.json(rowSql(installId));
    requireTrue(firstSent.verification_email_status === 'sent' && firstSent.verification_email_sent_at !== null,
      'ASTRA_TERMINAL_FIRST_SENT_REQUIRED');
    let migrationSettled = false;
    const installation = b.run(source.migration).finally(() => { migrationSettled = true; });
    installation.catch(() => {});
    await observeBlocked(a, second.pid, identity.pid, true);
    requireTrue(!migrationSettled, 'ASTRA_TERMINAL_MIGRATION_DID_NOT_WAIT');
    await a.run('commit;');
    await installation;
    assert.deepEqual(await b.json(rowSql(installId)), firstSent);
    assert.deepEqual(await b.json(metadataSql), beforeMetadata);
    const installed = await b.json(`select jsonb_build_object(
      'completionHash',(select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
        where oid='public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure),
      'trigger',exists(select 1 from pg_trigger where tgrelid='public.payment_requests'::regclass
        and tgname='astra_guard_payment_notification_sent' and tgtype=19 and tgenabled='O' and not tgisinternal));`);
    requireTrue(installed.completionHash === NEW_COMPLETE_SHA && installed.trigger, 'ASTRA_TERMINAL_INSTALL_REQUIRED');
    checks.push('real-migration-lock-wait-preserves-committed-old-writer-first-sent');

    // Preserve the EXACT old body under a test-only name AFTER installation.
    await a.run(`${source.complete.replace('public.phase4_complete_payment_notification(', 'public.astra_test_legacy_complete(')}
      revoke all on function public.astra_test_legacy_complete(uuid,text,text,text) from public,anon,authenticated;
      grant execute on function public.astra_test_legacy_complete(uuid,text,text,text) to service_role;`);
    const legacyHash = await a.json(`select to_jsonb(encode(sha256(convert_to(prosrc,'UTF8')),'hex'))
      from pg_proc where oid='public.astra_test_legacy_complete(uuid,text,text,text)'::regprocedure;`);
    requireTrue(legacyHash === OLD_COMPLETE_SHA, 'ASTRA_TERMINAL_LEGACY_BODY_REQUIRED');
    const raceId = randomUUID();
    await a.run(`insert into public.payment_requests(id,verification_email_status,verification_email_attempts,verification_email_last_attempt_at)
      values('${raceId}','sending',2,clock_timestamp());`);
    await b.run(`begin; set local role service_role; ${finishSql(raceId, 'synthetic-newer-success')} reset role;`);
    const newerSent = await b.json(rowSql(raceId));
    requireTrue(newerSent.verification_email_status === 'sent' && newerSent.verification_email_sent_at !== null,
      'ASTRA_TERMINAL_NEWER_SENT_REQUIRED');
    let legacySettled = false;
    const stale = a.run(`begin; set local role service_role;
      do $test$
      begin
        begin
          perform public.astra_test_legacy_complete('${raceId}'::uuid,'failed',null,'synthetic-older-failure');
        exception when sqlstate 'P0001' then
          if sqlerrm <> 'ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE' then raise; end if;
          return;
        end;
        raise exception 'ASTRA_TERMINAL_EXPECTED_GUARD_ERROR';
      end;
      $test$;
      commit;`).finally(() => { legacySettled = true; });
    stale.catch(() => {});
    await observeBlocked(b, identity.pid, second.pid);
    requireTrue(!legacySettled, 'ASTRA_TERMINAL_LEGACY_DID_NOT_WAIT');
    await b.run('commit;');
    await stale;
    assert.deepEqual(await b.json(rowSql(raceId)), newerSent);
    checks.push('real-row-lock-race-rejects-old-failure-after-new-sent-commit');

    await a.run(`select public.phase4_complete_payment_notification('${raceId}','failed',null,'synthetic-replay');
      select public.phase4_complete_payment_notification('${raceId}','sent','synthetic-replacement',null);`);
    assert.deepEqual(await a.json(rowSql(raceId)), newerSent);
    assert.deepEqual(await a.json(rowSql(installId)), firstSent);
    assert.deepEqual(await a.json(metadataSql), beforeMetadata);
    checks.push('first-success-full-rows-and-existing-claim-interface-acl-remain-unchanged');
    result = {ok: true, checks, skips: 0, engine: 'PostgreSQL 17', distinctBackends: 2,
      twoBackendRaceProven: true, actualLockWaitsObserved: 2, migrationSha256: MIGRATION_SHA,
      oldCompletionSha256: OLD_COMPLETE_SHA, newCompletionSha256: NEW_COMPLETE_SHA,
      hosted: false, provider: false, databaseDisposition: 'disposable-CI-service-only',
      limitation: 'Terminal sent metadata only; no claim-generation fence or exactly-once email claim.'};
  } finally {
    clearTimeout(wholeTimer);
    const exits = await Promise.all(backends.map(backend => backend.close()));
    if (result) requireTrue(exits.every(exit => exit?.code === 0 && !exit.signal), 'ASTRA_TERMINAL_BACKEND_CLOSE_FAILED');
  }
  return {...result, ownedPsqlProcessesClosed: true};
}

export function selfTest() {
  const base = {CI: 'true', GITHUB_ACTIONS: 'true', ASTRA_TERMINAL_POSTGRES_TEST: '1',
    PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: DATABASE, PGUSER: 'postgres', PGPASSWORD: 'synthetic-only'};
  const expectRefused = env => assert.throws(() => connectionConfig(env), error => /^ASTRA_TERMINAL_/.test(error.safeCode));
  let checks = 0;
  for (const key of ['CI', 'GITHUB_ACTIONS', 'ASTRA_TERMINAL_POSTGRES_TEST', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    const missing = {...base}; delete missing[key]; expectRefused(missing); checks++;
  }
  for (const [key, value] of [['PGHOST','localhost'],['PGHOST','production.example.com'],['PGHOST','::1'],
    ['PGDATABASE','postgres'],['PGDATABASE','host=production.example.com'],['PGUSER','service_role'],
    ['PGPORT','0'],['PGPORT','65536'],['PGPORT','5432 host=other'],['PGPASSWORD','bad\nvalue']]) {
    expectRefused({...base,[key]:value}); checks++;
  }
  const config = connectionConfig({...base, PGHOSTADDR:'203.0.113.1', PGSERVICE:'remote',
    PGSERVICEFILE:'/unexpected', PGOPTIONS:'-c role=other', DATABASE_URL:'sensitive-sentinel',
    SUPABASE_SERVICE_ROLE_KEY:'sensitive-sentinel'});
  for (const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
    assert.equal(Object.hasOwn(config.env,key),false); checks++;
  }
  assert.equal(config.args.includes('synthetic-only'),false);
  assert.equal(config.args.at(-1),DATABASE);
  assert.equal(config.args[config.args.indexOf('-h')+1],'127.0.0.1'); checks++;
  sources(); checks++;
  return {ok:true,mode:'inert-self-test',checks,skips:0,postgresStarted:false,twoBackendRaceProven:false};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    requireTrue(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--self-test'),
      'ASTRA_TERMINAL_UNRECOGNIZED_ARGUMENT');
    console.log(JSON.stringify(process.argv[2] === '--self-test' ? selfTest() : await runPostgresTest()));
  } catch (error) {
    console.log(JSON.stringify({ok:false,code:error.safeCode || 'ASTRA_TERMINAL_ASSERTION_FAILED',
      skips:0,twoBackendRaceProven:false}));
    process.exitCode = 1;
  }
}
