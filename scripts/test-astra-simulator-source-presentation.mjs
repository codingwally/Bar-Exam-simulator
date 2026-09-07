// Isolated PostgreSQL + actual source rendering. Never connects to a remote project.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationName = '20260907130001_astra_simulator_verified_source_presentation.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const source = await read('assets/examinations.js');
const bank = JSON.parse(await read('content/question-bank/website-upload.json')).records;
const IDs = ['REM-2022-II-Q01A', 'REM-2022-II-Q01B', 'REM-2019-A02B', 'ETH-2019-A05B'];
const families = [
  ['REM-2022-II-Q01A', 'REM-2022-II-Q01B'],
  ['REM-2019-A02A', 'REM-2019-A02B', 'REM-2019-A02C'],
  ['ETH-2019-A05A', 'ETH-2019-A05B', 'ETH-2019-A05C'],
];
const owner = '11111111-1111-4111-8111-111111111111';
const unpaid = '22222222-2222-4222-8222-222222222222';
const digest = 'a'.repeat(64);
const promptFor = (id) => bank.find((row) => row['Question ID'] === id)['Essay Question'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const markupStart = source.indexOf('  function simulationQuestionPromptMarkup(');
const markupEnd = source.indexOf('\n  // simulation-submitted-answer-', markupStart);
assert.ok(markupStart > 0 && markupEnd > markupStart);
const render = vm.runInNewContext(`${source.slice(markupStart, markupEnd)}; simulationQuestionPromptMarkup`, { escapeHtml });
const savedQuestions = [];

test('four exact reviewed prompts remain byte-for-byte original in the question bank', () => {
  for (const id of IDs) assert.ok(migration.includes(sha(promptFor(id))), id);
  assert.doesNotMatch(migration, /update\s+public\.examination_version_questions\s+set/i);
  assert.doesNotMatch(migration, /set\s+(?:prompt_snapshot|model_answer_snapshot|snapshot_hash)\s*=/i);
  assert.match(source, /simulationQuestionPromptMarkup\(question, state\.active\.examination\.track\)/);
  assert.match(source, /simulationQuestionPromptMarkup\(\{ \.\.\.result, prompt \}, track\)/);
});

test('old snapshots and all other tracks keep exact original presentation', () => {
  for (const id of IDs) {
    const question = { prompt: promptFor(id) };
    assert.equal(render(question, 'bar_feels'), `<div class="dd-question-prompt">${escapeHtml(question.prompt)}</div>`);
    assert.equal(render({ ...question, sourcePresentation: { schemaVersion: 1 } }, 'per_subject'), render(question, 'bar_feels'));
  }
});

let PGlite;
let pgcrypto;
try {
  const moduleURL = process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH) : null;
  ({ PGlite } = await import(moduleURL?.href || '@electric-sql/pglite'));
  ({ pgcrypto } = await import(moduleURL ? new URL('./contrib/pgcrypto.js', moduleURL).href : '@electric-sql/pglite/contrib/pgcrypto'));
} catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
if (process.argv.includes('--sql') && !PGlite) throw new Error('PGLITE_MODULE_PATH is required for --sql; this gate cannot silently skip.');

test('future-only presentation and family allocation under actual PostgreSQL', {
  skip: !PGlite && 'Use --sql with PGLITE_MODULE_PATH for the required release SQL gate.',
}, async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const sql = async (text, args = []) => (await db.query(text, args)).rows;
  // Match Linux CI/migration source bytes; Windows checkout CRLF is not a DB-body revision.
  const apply = async (name) => db.exec((await read(`supabase/migrations/${name}`)).replaceAll('\r\n', '\n'));
  const asRole = async (role, text, args = []) => {
    await db.exec(`set role ${role}`);
    try { return await sql(text, args); } finally { await db.exec('reset role'); }
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema private; create schema extensions;
      set check_function_bodies = off;
      create table auth.users(id uuid primary key, is_anonymous boolean default false);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key);
      create table public.user_roles(user_id uuid,role text);
      create table public.subscriptions(user_id uuid,status text,source text,starts_at timestamptz,expires_at timestamptz,plan_code text,updated_at timestamptz);
      create table public.free_beta_access(user_id uuid,enabled boolean,access_program text,expires_at timestamptz);
      create table public.payment_requests(user_id uuid,status text,provisional_access_started_at timestamptz,provisional_access_expires_at timestamptz,provisional_access_revoked_at timestamptz,proof_object_path text);
      insert into auth.users(id) values('${owner}'),('${unpaid}');
      insert into public.subscriptions values('${owner}','active','manual_payment',now()-interval '1 day',now()+interval '29 days','bar_access_30d',now());
      create function public.dd2026_is_admin(uuid) returns boolean language sql as 'select exists(select 1 from public.user_roles where user_id=$1)';
      -- Unrelated profile/terms dependency; actual admission below still reads real fixture entitlement rows.
      create function public.phase4_access_snapshot(uuid,boolean,text) returns jsonb language sql as 'select ''{"allowed":true,"termsRequired":false,"profileCompleted":true}''::jsonb';
      grant usage on schema public, private, extensions to service_role;`);
    await apply('20260729120725_examinations_bar_feels_shared_engine.sql');
    await apply('20260824172926_bar_exam_simulation_randomized_allocations_v1.sql');
    await apply('20260824172927_bar_simulation_answer_capture_trigger_v1.sql');
    await apply('20260824172928_bar_simulation_attempt_triggers_v1.sql');
    await apply('20260824172930_bar_simulation_answer_clear_race_hardening_v1.sql');
    await apply('20260824172931_bar_simulation_start_hash_expression_hardening_v1.sql');
    // Exact current renamed query body, without changing any source text/hash.
    await db.exec('alter function public.examination_query(uuid,text,jsonb) rename to examination_query_pre_protected_review_release; revoke all on function public.examination_query_pre_protected_review_release(uuid,text,jsonb) from public,anon,authenticated,service_role;');
    const protectedRelease = (await read('supabase/migrations/20260826110207_subject_matter_unlimited_review_release.sql')).replaceAll('\r\n', '\n');
    const wrapperStart = protectedRelease.indexOf('create or replace function public.examination_query(');
    const wrapperEnd = protectedRelease.indexOf('\ncommit;', wrapperStart);
    assert.ok(wrapperStart > 0 && wrapperEnd > wrapperStart);
    const releaseCheckStart = protectedRelease.indexOf('create or replace function public.subject_matter_review_release_authorized(');
    const releaseCheckEnd = protectedRelease.indexOf('\n$$;', releaseCheckStart) + '\n$$;'.length;
    assert.ok(releaseCheckStart > 0 && releaseCheckEnd > releaseCheckStart);
    await db.exec(protectedRelease.slice(releaseCheckStart, releaseCheckEnd));
    // Real unchanged public wrapper + exact ACL statements; other subject-review schema is out of this gate's scope.
    await db.exec(protectedRelease.slice(wrapperStart, wrapperEnd));
    await apply('20260906100248_bar_simulation_timer_advisory_hotfix.sql');
    await t.test('wrong lexical migration order is rejected atomically until the 130000 dependency is present', async () => {
      await assert.rejects(apply(migrationName), /ASTRA_SIMULATOR_PRESENTATION_DEPENDENCY_REQUIRED/);
      await db.exec('rollback');
      assert.equal((await sql("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='examination_version_questions' and column_name='source_presentation'"))[0].count, 0);
      assert.equal((await sql("select to_regprocedure('private.astra_simulator_select_subject(uuid,text,text,integer)') value"))[0].value, null);
    });
    await apply('20260907130000_astra_simulator_access.sql');
    const signatures = ['public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)', 'public.examination_render_attempt(uuid,boolean)', 'public.examination_query_pre_protected_review_release(uuid,text,jsonb)', 'public.examination_command(uuid,text,jsonb)', 'public.examination_query(uuid,text,jsonb)'];
    const before = await sql('select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid=any($1::regprocedure[])', [signatures]);
    const createVersion = async (track = 'bar_feels') => {
      const definition = randomUUID(); const version = randomUUID();
      await sql(`insert into public.examination_definitions(id,track,assessment_kind,title,subject,created_by) values($1,$3,'system_test','Synthetic N11 fixture','Remedial Law, Legal and Judicial Ethics',$2)`, [definition, owner, track]);
      await sql(`insert into public.examination_versions(id,exam_id,version_number,label,duration_seconds,default_timer_mode,grading_route,answer_release_rule,created_by) values($1,$2,1,'Fixture',14400,'strict','ai','after_ai',$3)`, [version, definition, owner]);
      return { definition, version };
    };
    const questionIds = new Map();
    const addQuestion = async (id, subject, prompt = `Synthetic question ${id}: apply the stated rule to these fixture facts.`) => {
      const uuid = randomUUID(); const hash = sha(id + prompt);
      await sql(`insert into public.examination_questions(id,source_key,source_type,subject,prompt_text,model_answer,legal_basis,review_status,publication_ready,content_hash) values($1,$2,'google_sheet',$3,$4,'Synthetic approved answer, not a legal reference.','Synthetic legal basis.','approved',true,$5)`, [uuid, `bar-feels:${id}`, subject, prompt, hash]);
      await sql('insert into public.bar_simulation_question_pool(question_id,source_question_id,subject,content_hash,source_digest) values($1,$2,$3,$4,$5)', [uuid, id, subject, hash, digest]);
      questionIds.set(id, uuid); return uuid;
    };
    for (const family of families) for (const id of family) await addQuestion(id, id.startsWith('ETH') ? 'Legal and Judicial Ethics' : 'Remedial Law', promptFor(id));
    const snapshot = async (version, id, ordinal, metadata = null) => sql(`insert into public.examination_version_questions(version_id,question_id,ordinal,prompt_snapshot,model_answer_snapshot,legal_basis_snapshot,snapshot_hash${metadata ? ',source_presentation' : ''}) select $1,id,$3,prompt_text,model_answer,legal_basis,content_hash${metadata ? ',$4::jsonb' : ''} from public.examination_questions where id=$2 returning *`, metadata ? [version, questionIds.get(id), ordinal, metadata] : [version, questionIds.get(id), ordinal]);
    const oldVersion = await createVersion();
    const oldRows = await snapshot(oldVersion.version, IDs[0], 1);
    await sql(`update public.examination_versions set status='published',question_count=1,snapshot_hash=$2,published_at=now() where id=$1`, [oldVersion.version, digest]);
    // The originally CLI-generated100050 file is now ordered after main130000.
    await apply(migrationName);
    await db.exec('set check_function_bodies = on');

    await t.test('migration preserves old snapshots and command/grading/advisory body; all modified RPC ACLs unchanged', async () => {
      const after = await sql('select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid=any($1::regprocedure[])', [signatures]);
      for (const item of before) assert.equal(after.find((row) => row.signature === item.signature).acl, item.acl);
      const command = before.find((row) => row.signature.includes('examination_command'));
      assert.equal(after.find((row) => row.signature === command.signature).definition, command.definition);
      const wrapper = before.find((row) => row.signature === 'examination_query(uuid,text,jsonb)');
      assert.equal(after.find((row) => row.signature === wrapper.signature).definition, wrapper.definition);
      const row = (await sql('select * from public.examination_version_questions where version_id=$1', [oldVersion.version]))[0];
      assert.equal(row.source_presentation, null); delete row.source_presentation;
      assert.deepEqual(row, oldRows[0]);
      await assert.rejects(sql('update public.examination_version_questions set prompt_snapshot=prompt_snapshot where version_id=$1', [oldVersion.version]), /EXAM_VERSION_IMMUTABLE/);
    });

    await t.test('all four future snapshots preserve exact source/key/model answer/hash and render corrected display only', async () => {
      const { version } = await createVersion();
      for (const [index, id] of IDs.entries()) {
        const original = (await sql('select * from public.examination_questions where id=$1', [questionIds.get(id)]))[0];
        const saved = (await snapshot(version, id, index + 1, { forged: true }))[0];
        const meta = saved.source_presentation;
        savedQuestions.push({ prompt: saved.prompt_snapshot, sourcePresentation: meta });
        assert.equal(saved.prompt_snapshot, original.prompt_text);
        assert.equal(saved.snapshot_hash, original.content_hash);
        assert.equal(saved.model_answer_snapshot, original.model_answer);
        assert.equal(meta.originalPromptSha256, sha(original.prompt_text));
        assert.equal(meta.originalSnapshotHash, original.content_hash);
        assert.equal(meta.sourceQuestionId, id); assert.equal(meta.practiceMaximum, 5);
        const sourceRecord = bank.find((row) => row['Question ID'] === id);
        assert.equal(meta.sourceYear, Number(sourceRecord['Bar Year']));
        assert.equal(meta.originalQuestionNumber, sourceRecord['Question No.']);
        assert.equal(original.source_key, `bar-feels:${id}`);
        const html = render({ prompt: saved.prompt_snapshot, sourcePresentation: meta }, 'bar_feels');
        assert.match(html, /data-simulation-source-presentation/);
        assert.ok(html.includes(escapeHtml(meta.displayPrompt)));
        assert.match(html, /Practice: 5 points\./);
        if (id.startsWith('REM-2022')) {
          assert.doesNotMatch(html, /This item has five questions/);
          assert.ok(html.includes(`Answer only part (${meta.selectedPart})`));
          assert.equal(meta.displayPrompt, original.prompt_text.slice('[This item has five questions.] '.length));
        } else {
          assert.ok(html.includes(`Original exam weight: ${meta.originalWeightPercent}%.`));
          assert.doesNotMatch(meta.displayPrompt, /\([\d.]+%\)$/);
          assert.equal(`${meta.displayPrompt} (${meta.originalWeightPercent}%)`, original.prompt_text);
        }
        for (const broken of [{ revision: 'unknown' }, { originalPromptSha256: '0'.repeat(64) }, { displayPrompt: '<script>changed()</script>' }, { originalWeightPercent: 99 }, { instruction: 'Answer everything' }]) {
          assert.equal(render({ prompt: saved.prompt_snapshot, sourcePresentation: { ...meta, ...broken } }, 'bar_feels'), render({ prompt: saved.prompt_snapshot }, 'bar_feels'));
        }
        await assert.rejects(sql('update public.examination_version_questions set source_presentation=null where version_id=$1 and question_id=$2', [version, questionIds.get(id)]), /BAR_SIMULATION_PRESENTATION_IMMUTABLE/);
      }
      const ordinary = await createVersion('per_subject');
      assert.equal((await snapshot(ordinary.version, IDs[0], 1, { forged: true }))[0].source_presentation, null);
      const sibling = await createVersion();
      assert.equal((await snapshot(sibling.version, 'REM-2019-A02A', 1, { forged: true }))[0].source_presentation, null);
    });

    await t.test('changed source remains unmodified and unreviewed; no stale metadata or new admission outage', async () => {
      const { version } = await createVersion();
      const id = questionIds.get(IDs[0]);
      const savedBefore = await sql('select * from public.examination_version_questions order by version_id,question_id');
      await db.exec('begin');
      try {
        await sql("update public.examination_questions set prompt_text=prompt_text || ' changed' where id=$1", [id]);
        const saved = (await snapshot(version, IDs[0], 1, { forged: true }))[0];
        assert.equal(saved.source_presentation, null);
        assert.equal(saved.prompt_snapshot, promptFor(IDs[0]) + ' changed');
        assert.equal(render({ prompt: saved.prompt_snapshot, sourcePresentation: saved.source_presentation }, 'bar_feels'), `<div class="dd-question-prompt">${escapeHtml(saved.prompt_snapshot)}</div>`);
      } finally { await db.exec('rollback'); }
      assert.equal((await sql('select prompt_text from public.examination_questions where id=$1', [id]))[0].prompt_text, promptFor(IDs[0]));
      assert.deepEqual(await sql('select * from public.examination_version_questions order by version_id,question_id'), savedBefore);
    });

    await t.test('known families only; eligible groups, original exposure and fail-closed quota are retained', async () => {
      for (const family of families) {
        const rows = await sql('select private.astra_simulator_parent_family(id) family from unnest($1::text[]) id', [family]);
        assert.equal(new Set(rows.map((row) => row.family)).size, 1); assert.ok(rows[0].family);
      }
      assert.equal((await sql("select private.astra_simulator_parent_family('REM-2022-II-Q01C') family"))[0].family, null);
      for (const subject of ['Remedial Law', 'Legal and Judicial Ethics']) for (let i = 0; i < 12; i += 1) await addQuestion(`${subject}-${i}`, subject);
      const choose = (subject = 'Remedial Law', count = 20) => sql('select p.source_question_id id from private.astra_simulator_select_subject($1,$2,$3,$4) s join public.bar_simulation_question_pool p on p.question_id=s.question_id', [owner, subject, digest, count]);
      for (let i = 0; i < 20; i += 1) {
        const selected = await choose();
        assert.equal(selected.length, 14); // Two known families + twelve independent ungrouped IDs.
        for (const family of families) assert.ok(selected.filter((row) => family.includes(row.id)).length <= 1);
      }
      const exposed = questionIds.get('REM-2022-II-Q01A');
      // Only one specific answer is excluded: its sibling remains eligible in a later attempt.
      await sql('insert into public.bar_simulation_answered_questions(user_id,question_id) values($1,$2)', [owner, exposed]);
      const afterExposure = await choose();
      assert.ok(!afterExposure.some((row) => row.id === 'REM-2022-II-Q01A'));
      assert.ok(afterExposure.some((row) => row.id === 'REM-2022-II-Q01B'));
      await sql('update public.bar_simulation_question_pool set eligible=false where question_id=$1', [questionIds.get('Remedial Law-0')]);
      await sql('update public.bar_simulation_question_pool set source_digest=$2 where question_id=$1', [questionIds.get('Remedial Law-1'), 'b'.repeat(64)]);
      await sql('update public.examination_questions set publication_ready=false where id=$1', [questionIds.get('Remedial Law-2')]);
      await sql('update public.examination_questions set content_hash=$2 where id=$1', [questionIds.get('Remedial Law-3'), 'c'.repeat(64)]);
      const selected = await choose(); assert.equal(selected.length, 10);
      for (let i = 0; i < 4; i += 1) assert.ok(!selected.some((row) => row.id === `Remedial Law-${i}`));
    });

    await t.test('browser roles cannot call the selector or attach metadata; service helper surface stays private', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await sql("select has_function_privilege($1,'private.astra_simulator_select_subject(uuid,text,text,integer)','execute') allowed", [role]))[0].allowed, false);
        assert.equal((await sql("select has_function_privilege($1,'private.astra_simulator_parent_family(text)','execute') allowed", [role]))[0].allowed, false);
      }
      for (const role of ['anon', 'authenticated']) await assert.rejects(asRole(role, 'select * from public.examination_version_questions limit 1'), /permission denied/);
    });

    await t.test('actual allocator returns twenty private snapshots, remains idempotent and refuses insufficient groups/unpaid access', async () => {
      const { definition, version } = await createVersion();
      await sql("update public.examination_definitions set assessment_kind='curated',status='published',active_version_id=$2 where id=$1", [definition, version]);
      await sql("update public.examination_versions set status='published',question_count=20,snapshot_hash=$2,published_at=now() where id=$1", [version, digest]);
      await sql("update public.bar_simulation_runtime_config set allocation_enabled=true,current_source_digest=$1", [digest]);
      const call = (user, request = 'fixture-request-00000001') => asRole('service_role', 'select public.bar_simulation_start_attempt_v1($1,$2,\'strict\',$3,$4) result', [user, version, request, 'fixture-tab-token-0000000000000000000001']);
      await assert.rejects(call(unpaid), /EXAM_PREMIUM_REQUIRED/);
      const first = (await call(owner))[0].result;
      assert.match(first.attempt.attemptId, /^[0-9a-f-]{36}$/);
      assert.equal(first.questions.length, 20);
      assert.equal(first.examination.questionCount, 20);
      const allocation = await sql('select p.source_question_id id,p.subject from public.bar_simulation_allocation_questions q join public.bar_simulation_question_pool p on p.question_id=q.question_id where q.allocation_id=$1', [first.allocationId]);
      assert.equal(allocation.filter((row) => row.subject === 'Remedial Law').length, 10);
      assert.equal(allocation.filter((row) => row.subject === 'Legal and Judicial Ethics').length, 10);
      for (const family of families) assert.ok(allocation.filter((row) => family.includes(row.id)).length <= 1);
      const replay = (await call(owner))[0].result;
      assert.equal(replay.attempt.attemptId, first.attempt.attemptId); assert.equal(replay.replayed, true);
      assert.deepEqual(replay.questions, first.questions);
      const answerQuestion = first.questions[0];
      const verbatimAnswer = 'Synthetic preserved answer.\n\nParagraph two — punctuation stays intact.';
      await asRole('service_role', 'update public.examination_responses set answer_text=$3,revision=revision+1 where attempt_id=$1 and question_id=$2', [first.attempt.attemptId, answerQuestion.questionId, verbatimAnswer]);
      const verdict = (await asRole('service_role', "select public.examination_query($1,'verdict',jsonb_build_object('attemptId',$2::text)) result", [owner, first.attempt.attemptId]))[0].result;
      assert.equal(verdict.results.length, 20); assert.equal(verdict.released, false);
      for (const row of verdict.results) {
        const accepted = first.questions.find((question) => question.questionId === row.questionId);
        assert.equal(row.prompt, accepted.prompt);
        assert.deepEqual(row.sourcePresentation, accepted.sourcePresentation);
        assert.equal(row.modelAnswer, null); assert.equal(row.aiScore, null);
      }
      assert.equal(verdict.results.find((row) => row.questionId === answerQuestion.questionId).answerText, verbatimAnswer);
      assert.equal((await sql('select count(*)::int count from public.bar_simulation_answered_questions where user_id=$1 and question_id=$2', [owner, answerQuestion.questionId]))[0].count, 1);
      await assert.rejects(asRole('service_role', "select public.examination_query($1,'verdict',jsonb_build_object('attemptId',$2::text))", [unpaid, first.attempt.attemptId]), /EXAM_ATTEMPT_NOT_FOUND/);
      const countBefore = (await sql('select count(*)::int count from public.examination_attempts_multi'))[0].count;
      assert.equal((await sql("update public.examination_attempts_multi set status='submitted',submitted_at=now() where id=$1 returning status", [first.attempt.attemptId]))[0].status, 'submitted');
      await sql('update public.bar_simulation_question_pool set eligible=false where question_id=$1', [questionIds.get('Remedial Law-4')]);
      await assert.rejects(call(owner, 'fixture-request-00000002'), /BAR_SIMULATION_POOL_EXHAUSTED:Remedial Law/);
      assert.equal((await sql('select count(*)::int count from public.examination_attempts_multi'))[0].count, countBefore);
      assert.equal((await sql('select source_presentation from public.examination_version_questions where version_id=$1 and question_id=$2', [first.examination.versionId, answerQuestion.questionId]))[0].source_presentation?.originalSnapshotHash || null, answerQuestion.sourcePresentation?.originalSnapshotHash || null);
      await sql("update public.subscriptions set status='expired' where user_id=$1", [owner]);
      await assert.rejects(call(owner), /EXAM_PREMIUM_REQUIRED/); // Admission still precedes old receipt replay.
    });
  } finally { await db.close(); }
});

test('real DOM shows source part and historical weight separately; original facts remain exact and untrusted metadata falls back', {
  skip: !process.argv.includes('--browser') && 'Use --browser --sql for the required rendered release gate.',
}, async () => {
  assert.equal(savedQuestions.length, 4, 'Browser gate requires the four actual PostgreSQL snapshot DTOs.');
  const require = createRequire(import.meta.url);
  const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
    ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href) : require('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    for (const question of savedQuestions) {
      for (const placement of ['writing', 'verdict']) {
        await page.setContent(`<main data-placement="${placement}">${render(question, 'bar_feels')}</main>`);
        const presentation = page.locator('[data-simulation-source-presentation]');
        assert.equal(await presentation.count(), 1);
        assert.equal(await presentation.locator('.dd-question-prompt').textContent(), question.sourcePresentation.displayPrompt);
        assert.equal(await presentation.locator('.dd-question-label').textContent(), question.sourcePresentation.sourceLabel);
        assert.match(await presentation.locator('[data-source-scoring]').textContent(), /Practice: 5 points\./);
        if (question.sourcePresentation.originalWeightPercent == null) {
          assert.equal(await presentation.locator('[data-selected-part-instruction]').textContent(), question.sourcePresentation.instruction);
        } else assert.match(await presentation.locator('[data-source-scoring]').textContent(), /Original exam weight: (?:2\.5|3)%\. Practice: 5 points\./);
      }
      const tampered = { ...question, sourcePresentation: { ...question.sourcePresentation, displayPrompt: '<img src="https://example.invalid/" onerror="alert(1)">' } };
      await page.setContent(render(tampered, 'bar_feels'));
      assert.equal(await page.locator('[data-simulation-source-presentation]').count(), 0);
      assert.equal(await page.locator('.dd-question-prompt').textContent(), question.prompt);
      assert.equal(await page.locator('img,script').count(), 0);
    }
  } finally { await browser.close(); }
});
