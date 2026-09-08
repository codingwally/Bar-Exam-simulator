// Isolated PostgreSQL fixture; only external Auth/access prerequisites are local
// stubs. All attempts, canonical results, scopes, journals and quotas use the real
// checked-in migrations/functions. Missing PGlite is an error, never a skipped test.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createForecastAttemptStore } from './forecast-attempt-store.mjs';
import { BAR_FORECAST_SUBJECTS, forecastSetId } from './bar-forecast-core.mjs';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const USER = { id: OWNER, email: 'scope-owner@example.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
export const MIGRATION = '20260907222627_astra_forecast_analytics_browser_scopes.sql';
export async function fixture({ skipScopeMigration = false } = {}) {
  const path = process.env.ASTRA_PGLITE_MODULE || process.env.PGLITE_MODULE_PATH;
  const { PGlite } = await import(path ? pathToFileURL(path.replace(/[/\\]$/u, '') + (path.endsWith('.js') ? '' : '/dist/index.js')).href : '@electric-sql/pglite');
  const db = new PGlite();
  try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    insert into auth.users values('${OWNER}','${USER.email}','${USER.email_confirmed_at}'),('${OTHER}','other@example.test','2026-09-01T00:00:00Z');
    create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
    insert into public.dd2026_bar_forecast_consents select id,'2026-09-01' from auth.users;
    create table public.scope_fixture_access(owner_id uuid primary key,allowed boolean not null);
    insert into public.scope_fixture_access values('${OWNER}',true),('${OTHER}',true);
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select coalesce((select allowed from public.scope_fixture_access where owner_id=$1),false)';
    grant usage on schema public,auth to service_role;
    grant select on public.dd2026_bar_forecast_consents,public.scope_fixture_access to service_role;
    revoke all on auth.users from public,anon,authenticated,service_role;`);
  let previousClaim;
  for (const name of ['20260907060650_astra_forecast_attempts.sql','20260907064532_astra_forecast_result_exports.sql','20260907172508_astra_forecast_summary_email.sql',MIGRATION]) {
    if (name === MIGRATION) previousClaim=(await db.query("select prosrc from pg_proc where oid='public.dd2026_forecast_result_email_claim(uuid,uuid,integer,text,text)'::regprocedure")).rows[0].prosrc;
    if (name !== MIGRATION || !skipScopeMigration) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const rpc = async (_env, name, args) => {
    if (!/^dd2026_forecast_[a-z_]+$/u.test(name)) throw new Error('Unsafe fixture RPC');
    const entries = Object.entries(args);
    await db.exec('set role service_role');
    try { return (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value))).rows[0].value; }
    finally { await db.exec('reset role'); }
  };
  const store = createForecastAttemptStore({ rpc });
  async function accept({ ownerId = OWNER, subject = BAR_FORECAST_SUBJECTS[0], classified = true, long = false } = {}) {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `scope-fixture-${i + 1}`, number: i + 1, subject, title: `Local scope verification ${i + 1}`,
      checksum: String(i + 1).padStart(64, '0'),
      payloadCanonical: JSON.stringify(classified && i < 18 ? { syllabus_unit_id: i < 9 ? 'FIX-I' : 'FIX-II', syllabus_unit: i < 9 ? 'First saved unit' : 'Second saved unit', syllabus_topic: i % 2 ? 'Second saved topic' : 'First saved topic' } : { number: i + 1 }),
      prompt: `Question ${i + 1}: Apply the controlling rule to the decisive material facts.`,
      suggestedAnswer: `Suggested answer ${i + 1}: The rule governs because its legal elements are supported by the material facts.`,
      legalBasis: 'Local fixture authority for rendering and aggregation tests only.',
      controllingDoctrine: 'Apply each legal element to the decisive material facts.', jurisprudence: 'Local fixture reference', citation: 'Local fixture source',
      userAnswer: long && i === 0 ? `${'These material facts establish the controlling legal elements and support the requested conclusion. '.repeat(55)}End of long first answer.`
        : `Answer ${i + 1}: The material facts establish the controlling legal elements and support the requested conclusion. ${i === 19 ? 'Final answer twenty: ₱149, Señor Niño, café.' : ''}`,
    }));
    return (await store.accept({}, { ownerId, clientAttemptId: crypto.randomUUID(), subject, setId: await forecastSetId(rows), rowsWithAnswers: rows })).attempt;
  }
  async function complete(options = {}) {
    const attempt = await accept(options);
    for (let batch = 0; batch < 5; batch++) {
      const claim = await store.claim({}, { attemptId: attempt.id });
      await store.checkpoint({}, claim, { results: claim.rows.map((row) => ({ questionId: row.id, score: options.score ?? 4,
        grammar: { score: 3, corrections: [] }, issueSpotting: { score: 4.5, identified: [], missed: [] } })) });
    }
    return (await store.finalize({}, attempt.id)).attempt;
  }
  const snapshot = (args = {}) => rpc({}, 'dd2026_forecast_analytics_snapshot', { p_actor_user_id: OWNER, p_request_id: crypto.randomUUID(), ...args });
  return { db, rpc, store, accept, complete, snapshot, previousClaim, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
const HASH='a'.repeat(64), TEMPLATE='forecast-analytics-email-summary-v1';
const UNKNOWN='99999999-9999-4999-8999-999999999999';
const expectCode=(value,code)=>{assert.equal(value.ok,false);assert.equal(value.error.code,code);};
test('actual Analytics browser SQL: complete-only scopes, owner membership, summary-only frozen mail and shared quotas',async(t)=>{
  const f=await fixture();
  try{
    const claimsBefore=f.previousClaim.replace(/\r/g,'');
    await t.test('only one current selected-quota expression changes; all summary/fencing/keys retained',async()=>{
      const after=(await f.db.query("select prosrc from pg_proc where oid='public.dd2026_forecast_result_email_claim(uuid,uuid,integer,text,text)'::regprocedure")).rows[0].prosrc.replace(/\r/g,'');
      assert.equal(createHash('sha256').update(claimsBefore).digest('hex'),'bd39a1a0934ebc849221d84832e431c703509a00a0faf394078213e61ba15dd8');
      assert.equal(after,claimsBefore.replace("(select count(*) from public.dd2026_forecast_result_exports where owner_id=p_actor_user_id and email_requested_at>v_now-interval '24 hours')","public.dd2026_forecast_email_quota_used(p_actor_user_id)"));
      assert.match(after,/astra\.forecast_summary_claim/u);
      assert.equal((await f.db.query("select count(*)::int n from pg_trigger where tgname='dd2026_forecast_result_summary_guard'")).rows[0].n,1);
    });
    const attempts=[];for(let i=0;i<21;i++)attempts.push(await f.complete({score:i===20?0:4}));
    const pending=await f.accept(),failed=await f.accept();
    await f.db.query("update public.dd2026_forecast_attempts set status='failed' where id=$1",[failed.id]);
    const foreign=await f.complete({ownerId:OTHER,score:5,classified:false});
    // Explicit corrupt-import fixture, not a legitimate finalizer result.
    const invalid=crypto.randomUUID();
    await f.db.query(`insert into public.dd2026_forecast_attempts select (jsonb_populate_record(null::public.dd2026_forecast_attempts,
      to_jsonb(a)||jsonb_build_object('id',$2::text,'client_attempt_id',$2::text,'accepted_at',clock_timestamp(),'result',
        a.result||jsonb_build_object('attemptId',$2::text,'completedQuestionCount','not-a-number')))).*
      from public.dd2026_forecast_attempts a where id=$1`,[attempts[0].id,invalid]);
    const key=crypto.randomUUID(),saved=await f.snapshot({p_request_id:key}); assert.equal(saved.ok,true);
    const full=saved.scope;
    const byCount=async(n)=>f.snapshot({p_from:attempts[attempts.length-n].completedAt});
    const one=(await byCount(1)).scope,six=(await byCount(6)).scope,eighteen=(await byCount(18)).scope;
    const call=(name,scope=one,args={})=>f.rpc({},'dd2026_forecast_analytics_'+name,{p_actor_user_id:OWNER,p_scope_id:scope.id,...args});
    const claim=(scope=one,args={})=>call('email_claim',scope,{p_scope_hash:scope.scopeHash,p_recipient_email:USER.email,p_template_version:TEMPLATE,p_payload_hash:HASH,...args});
    const settle=(scope,c,status='provider_accepted',args={})=>call('email_settle',scope,{p_lease_token:c.leaseToken,p_status:status,p_provider_id:status==='provider_accepted'?'synthetic-accepted':null,...args});
    const scopeRow=async(scope=one)=>(await f.db.query('select to_jsonb(e) value from public.dd2026_forecast_analytics_exports e where id=$1',[scope.id])).rows[0].value;
    await t.test('complete validity precedes pagination and aggregates; real zero is included; unfinished/foreign/corrupt rows excluded',async()=>{
      assert.equal(full.manifest.length,21);assert.equal(full.analytics.completedAttempts,21);assert.equal(full.analytics.averagePercentage,76.2);
      assert.equal(full.analytics.pendingAttempts,1);assert.equal(full.analytics.failedAttempts,1);
      for(const id of[pending.id,failed.id,foreign.id,invalid])assert.equal(full.manifest.some(x=>x.attemptId===id),false);
      const page=await f.rpc({},'dd2026_forecast_analytics_history',{p_actor_user_id:OWNER,p_limit:1,p_complete_only:true});
      assert.equal(page.attempts.length,1);assert.equal(page.attempts[0].id,attempts.at(-1).id);assert.deepEqual(page.analytics,full.analytics);
      assert.equal(one.manifest.length,1);assert.equal(one.analytics.averagePercentage,0);assert.equal(six.manifest.length,6);assert.equal(eighteen.manifest.length,18);
      assert.equal(Object.hasOwn(saved,'attempts'),false);
      assert.equal(JSON.stringify(saved).includes('The material facts establish'),false);
    });
    await t.test('saved unit/topic counts match complete question and attempt samples, without diagnostics double count',async()=>{
      assert.deepEqual(full.analytics.classificationCoverage,{questionSamples:420,completedAttempts:21,unitClassifiedQuestions:378,unitUnknownQuestions:42,topicClassifiedQuestions:378,topicUnknownQuestions:42});
      assert.equal(full.analytics.byUnit.length,2);assert.equal(full.analytics.byTopic.length,4);
      assert.equal(full.analytics.byUnit[0].questionSamples,189);assert.equal(full.analytics.byUnit[0].completedAttempts,21);
      for(const payload of[null,'not-json','{}','[]'])assert.equal(await f.rpc({},'dd2026_forecast_analytics_saved_classification',{p_payload:payload}),null);
      const other=await f.snapshot({p_actor_user_id:OTHER});assert.equal(other.scope.analytics.classificationCoverage.unitUnknownQuestions,20);
    });
    await t.test('request replay and normalized time-zone filters freeze the identical scope and never include later completions',async()=>{
      assert.equal((await f.snapshot()).scope.id,full.id);
      const a=await f.snapshot({p_from:'2020-01-01T00:00:00Z',p_to:'2030-01-01T00:00:00Z'});
      const b=await f.snapshot({p_from:'2020-01-01T08:00:00+08:00',p_to:'2030-01-01T08:00:00+08:00'});assert.equal(a.scope.id,b.scope.id);
      await f.db.exec("set timezone='Asia/Manila'");
      try{assert.equal((await f.snapshot({p_from:'2020-01-01T00:00:00Z',p_to:'2030-01-01T00:00:00Z'})).scope.id,a.scope.id);}finally{await f.db.exec("set timezone='UTC'");}
      await f.complete({subject:BAR_FORECAST_SUBJECTS[1]});
      assert.deepEqual((await f.snapshot({p_request_id:key})).scope,full);
      expectCode(await f.snapshot({p_request_id:key,p_subject:BAR_FORECAST_SUBJECTS[1]}),'BAR_FORECAST_ANALYTICS_REQUEST_CONFLICT');
      expectCode(await f.snapshot({p_subject:'Unknown'}),'BAR_FORECAST_HISTORY_INVALID');
      expectCode(await f.snapshot({p_from:'2031-01-01T00:00:00Z'}),'BAR_FORECAST_ANALYTICS_EMPTY');
      expectCode(await f.snapshot({p_from:'infinity'}),'BAR_FORECAST_HISTORY_INVALID');
      expectCode(await f.snapshot({p_from:'2027-01-01T00:00:00Z',p_to:'2026-01-01T00:00:00Z'}),'BAR_FORECAST_HISTORY_INVALID');
    });
    await t.test('one member returns exact saved canonical report and hash; foreign/nonmember requests never hydrate',async()=>{
      const value=await call('attempt',one,{p_attempt_id:attempts.at(-1).id});assert.equal(value.ok,true);
      assert.equal(value.scopeHash,one.scopeHash);assert.equal(value.resultHash,one.manifest[0].resultHash);
      assert.deepEqual(value.attempt.result,attempts.at(-1).result);assert.equal(value.attempt.result.results.length,20);
      expectCode(await call('attempt',one,{p_attempt_id:attempts[0].id}),'BAR_FORECAST_ANALYTICS_NOT_FOUND');
      expectCode(await call('attempt',one,{p_attempt_id:foreign.id}),'BAR_FORECAST_ANALYTICS_NOT_FOUND');
      expectCode(await call('get',one,{p_actor_user_id:OTHER}),'BAR_FORECAST_ANALYTICS_NOT_FOUND');
      await assert.rejects(f.db.query('select public.dd2026_forecast_analytics_get($1,$2,true)',[OWNER,one.id]),/does not exist/u);
    });
    await t.test('NULL and unknown owners fail closed, access and consent are current, public roles have no APIs/tables',async()=>{
      for(const owner of[null,UNKNOWN]){
        expectCode(await f.snapshot({p_actor_user_id:owner}),'BAR_FORECAST_ACCESS_REQUIRED');
        expectCode(await call('get',one,{p_actor_user_id:owner}),'BAR_FORECAST_ACCESS_REQUIRED');
        expectCode(await call('attempt',one,{p_actor_user_id:owner,p_attempt_id:attempts.at(-1).id}),'BAR_FORECAST_ACCESS_REQUIRED');
      }
      await f.db.query('update public.scope_fixture_access set allowed=false where owner_id=$1',[OWNER]);
      expectCode(await call('get'),'BAR_FORECAST_ACCESS_REQUIRED');await f.db.query('update public.scope_fixture_access set allowed=true where owner_id=$1',[OWNER]);
      await f.db.query('delete from public.dd2026_bar_forecast_consents where user_id=$1',[OWNER]);
      expectCode(await claim(),'BAR_FORECAST_CONSENT_REQUIRED');
      await f.db.query("insert into public.dd2026_bar_forecast_consents values($1,'2026-09-01')",[OWNER]);
      for(const role of['anon','authenticated']){
        const rows=(await f.db.query("select p.oid::regprocedure::text signature,has_function_privilege($1,p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'dd2026_forecast_analytics_%'",[role])).rows;
        assert.ok(rows.length>=14);assert.ok(rows.every(x=>!x.allowed));
        assert.equal((await f.db.query("select has_table_privilege($1,'public.dd2026_forecast_analytics_exports','SELECT') allowed",[role])).rows[0].allowed,false);
        await f.db.exec('set role '+role);try{await assert.rejects(f.db.query('select public.dd2026_forecast_analytics_get($1,$2)',[OWNER,one.id]),/permission denied/u);}finally{await f.db.exec('reset role');}
      }
      assert.equal((await f.db.query("select has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0].allowed,false);
    });
    await t.test('browser observation is first-only client metadata, never a PDF hash/download/email claim',async()=>{
      const args={p_scope_hash:one.scopeHash,p_pdf_version:'forecast-analytics-pdf-v1',p_byte_count:123};
      assert.deepEqual(await call('browser_prepared',one,args),{ok:true,recorded:true,clientReported:true,event:'browser_analytics_pdf_prepared_client_reported'});
      const first=await scopeRow();const replay=await call('browser_prepared',one,{...args,p_byte_count:456});assert.equal(replay.recorded,false);assert.deepEqual(await scopeRow(),first);
      assert.equal(first.browser_prepared_byte_count,123);assert.equal(first.email_status,'not_requested');assert.equal(first.email_requested_at,null);
      for(const field of['pdf_hash','downloads','file_name','byte_count'])assert.equal(Object.hasOwn(first,field),false);
      for(const changed of[{p_scope_hash:HASH},{p_pdf_version:'unknown'},{p_byte_count:null},{p_byte_count:0},{p_byte_count:10485761}])expectCode(await call('browser_prepared',one,{...args,...changed}),'BAR_FORECAST_EXPORT_INVALID');
    });
    await t.test('summary claim is verified-self, immutable template/body/sender fingerprint and accepted replay is idempotent',async()=>{
      expectCode(await claim(one,{p_recipient_email:'other@example.test'}),'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED');
      expectCode(await claim(one,{p_scope_hash:HASH}),'BAR_FORECAST_EXPORT_INVALID');
      expectCode(await claim(one,{p_template_version:'pdf_attachment'}),'BAR_FORECAST_EXPORT_INVALID');
      expectCode(await claim(one,{p_payload_hash:null}),'BAR_FORECAST_EXPORT_INVALID');
      const c=await claim();assert.equal(c.claimed,true);assert.equal(c.idempotencyKey,'forecast-analytics/'+one.id+'/v1');
      assert.equal((await claim()).claimed,false);assert.equal((await scopeRow()).delivery_kind,'summary_link');
      expectCode(await claim(one,{p_payload_hash:'b'.repeat(64)}),'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
      assert.equal((await settle(one,c)).email.status,'provider_accepted');assert.equal((await settle(one,c)).email.status,'provider_accepted');
      assert.equal((await claim()).claimed,false);assert.equal((await scopeRow()).email_executions,1);
      for(const update of["scope_hash='"+HASH+"'","analytics='{}'","email_payload_hash='"+'b'.repeat(64)+"'","email_status='failed'","browser_prepared_byte_count=999"])
        await assert.rejects(f.db.query('update public.dd2026_forecast_analytics_exports set '+update+' where id=$1',[one.id]),/immutable/u);
    });
    await t.test('combined five quota accepts scope-first then selected summaries; sixth denied both routes without extra row request',async()=>{
      const individual=async(attempt)=>f.rpc({},'dd2026_forecast_result_summary_email_claim',{p_actor_user_id:OWNER,p_attempt_id:attempt.id,p_result_revision:1,p_recipient_email:USER.email,p_result:attempt.result,p_completed_at:attempt.completedAt,p_template_version:'forecast-summary-link-v1',p_payload_hash:HASH});
      for(const attempt of attempts.slice(0,4))assert.equal((await individual(attempt)).claimed,true);
      expectCode(await individual(attempts[4]),'BAR_FORECAST_EMAIL_RATE_LIMIT');
      expectCode(await claim(six),'BAR_FORECAST_EMAIL_RATE_LIMIT');
      assert.equal(Number(await f.rpc({},'dd2026_forecast_email_quota_used',{p_actor_user_id:OWNER})),5);
      assert.equal((await scopeRow(six)).email_requested_at,null);assert.equal((await claim()).claimed,false);
      // The independent table guard survives even an old function body.
      const original=f.previousClaim;
      await f.db.exec("create or replace function public.dd2026_forecast_result_email_claim(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_recipient_email text,p_pdf_hash text) returns jsonb language plpgsql security invoker set search_path='' as $old$"+original+"$old$;");
      await assert.rejects(individual(attempts[4]),/BAR_FORECAST_EMAIL_RATE_LIMIT/u);
      // An unmarked old PDF claimer still cannot claim a newer summary row.
      expectCode(await f.rpc({},'dd2026_forecast_result_email_claim',{p_actor_user_id:OWNER,p_attempt_id:attempts[0].id,p_result_revision:1,p_recipient_email:USER.email,p_pdf_hash:null}),'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
    });
    await t.test('selected-first then scope requests share quota; expired lease and uncertainty retain same key and stop after three claims',async()=>{
      const mine=[];for(let i=0;i<5;i++)mine.push(await f.complete({ownerId:OTHER,score:4}));
      const otherArgs={p_actor_user_id:OTHER,p_recipient_email:'other@example.test'};
      for(const attempt of mine.slice(0,4)){
        const c=await f.rpc({},'dd2026_forecast_result_summary_email_claim',{...otherArgs,p_attempt_id:attempt.id,p_result_revision:1,p_result:attempt.result,p_completed_at:attempt.completedAt,p_template_version:'forecast-summary-link-v1',p_payload_hash:HASH});assert.equal(c.claimed,true);
      }
      const scope=(await f.snapshot({p_actor_user_id:OTHER,p_from:mine.at(-1).completedAt})).scope;
      const c=await claim(scope,otherArgs);assert.equal(c.claimed,true);assert.equal((await claim(scope,otherArgs)).claimed,false);
      await f.db.query("update public.dd2026_forecast_analytics_exports set email_lease_expires_at=statement_timestamp()-interval '1 second' where id=$1",[scope.id]);
      const c2=await claim(scope,otherArgs);assert.equal(c2.claimed,true);assert.equal(c2.idempotencyKey,c.idempotencyKey);assert.notEqual(c2.leaseToken,c.leaseToken);
      expectCode(await settle(scope,c,'provider_accepted',{p_actor_user_id:OTHER}),'BAR_FORECAST_EMAIL_LEASE_LOST');
      assert.equal((await settle(scope,c2,'uncertain',{p_actor_user_id:OTHER})).email.status,'uncertain');
      assert.equal((await claim(scope,otherArgs)).claimed,false);
      await f.db.query("update public.dd2026_forecast_analytics_exports set email_retry_at=statement_timestamp()-interval '1 second' where id=$1",[scope.id]);
      const c3=await claim(scope,otherArgs);assert.equal(c3.claimed,true);assert.equal(c3.idempotencyKey,c.idempotencyKey);
      await settle(scope,c3,'uncertain',{p_actor_user_id:OTHER});
      expectCode(await claim(scope,otherArgs),'BAR_FORECAST_EMAIL_RETRY_LIMIT');
      const another=(await f.snapshot({p_actor_user_id:OTHER})).scope;
      expectCode(await claim(another,otherArgs),'BAR_FORECAST_EMAIL_RATE_LIMIT');
      assert.equal(Number(await f.rpc({},'dd2026_forecast_email_quota_used',{p_actor_user_id:OTHER})),5);
    });
    await t.test('missing member invalidates metadata and member retrieval instead of silently truncating',async()=>{
      await f.db.query('delete from public.dd2026_forecast_attempts where id=$1',[attempts.at(-1).id]);
      expectCode(await call('get'),'BAR_FORECAST_ANALYTICS_CHANGED');
      expectCode(await call('attempt',one,{p_attempt_id:attempts.at(-1).id}),'BAR_FORECAST_ANALYTICS_CHANGED');
    });
  }finally{await f.close();}
});

test('forward scope migration preserves legacy uncertain payloads and stops expired scope mail without a fresh key',async(t)=>{
  const f=await fixture({skipScopeMigration:true});
  try{
    const attempt=await f.complete();
    const pdf={p_actor_user_id:OWNER,p_attempt_id:attempt.id,p_result_revision:1,p_pdf_hash:HASH};
    await f.rpc({},'dd2026_forecast_result_pdf_record',{...pdf,p_file_name:`duediligence-forecast-${attempt.id}-r1.pdf`,p_byte_count:321,p_download:false});
    const prior=await f.rpc({},'dd2026_forecast_result_email_claim',{...pdf,p_recipient_email:USER.email});
    await f.rpc({},'dd2026_forecast_result_email_settle',{p_actor_user_id:OWNER,p_attempt_id:attempt.id,p_result_revision:1,p_lease_token:prior.leaseToken,p_status:'uncertain',p_provider_id:null});
    const row=async()=>(await f.db.query('select to_jsonb(e) value from public.dd2026_forecast_result_exports e where attempt_id=$1',[attempt.id])).rows[0].value;
    const before=await row();
    await f.db.exec(await readFile(new URL('../supabase/migrations/'+MIGRATION,import.meta.url),'utf8'));
    await t.test('all legacy uncertain journal fields and original provider key survive unchanged',async()=>{
      assert.deepEqual(await row(),before);assert.equal(prior.idempotencyKey,`forecast-result/${attempt.id}/r1`);
      expectCode(await f.rpc({},'dd2026_forecast_result_summary_email_claim',{p_actor_user_id:OWNER,p_attempt_id:attempt.id,p_result_revision:1,p_recipient_email:USER.email,p_result:attempt.result,p_completed_at:attempt.completedAt,p_template_version:'forecast-summary-link-v1',p_payload_hash:HASH}),'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
      assert.deepEqual(await row(),before);
    });
    await t.test('23-hour expiry holds scope request with original metadata; invalid lease/status never settles',async()=>{
      const scope=(await f.snapshot()).scope;
      // Explicit local aging fixture; the server clock/functions are not replaced.
      await f.db.query(`update public.dd2026_forecast_analytics_exports set email_status='uncertain',recipient_hash=encode(sha256(convert_to($2,'UTF8')),'hex'),
        email_requested_at=statement_timestamp()-interval '24 hours',email_retry_at=statement_timestamp()-interval '1 hour',
        email_executions=1,email_template_version=$3,email_payload_hash=$4 where id=$1`,[scope.id,USER.email,TEMPLATE,HASH]);
      const priorScope=(await f.db.query('select to_jsonb(e) value from public.dd2026_forecast_analytics_exports e where id=$1',[scope.id])).rows[0].value;
      expectCode(await f.rpc({},'dd2026_forecast_analytics_email_claim',{p_actor_user_id:OWNER,p_scope_id:scope.id,p_scope_hash:scope.scopeHash,p_recipient_email:USER.email,p_template_version:TEMPLATE,p_payload_hash:HASH}),'BAR_FORECAST_EMAIL_RETRY_LIMIT');
      const get=await f.rpc({},'dd2026_forecast_analytics_get',{p_actor_user_id:OWNER,p_scope_id:scope.id});assert.equal(get.email.retryAllowed,false);
      expectCode(await f.rpc({},'dd2026_forecast_analytics_email_settle',{p_actor_user_id:OWNER,p_scope_id:scope.id,p_lease_token:null,p_status:'provider_accepted',p_provider_id:'bad'}),'BAR_FORECAST_EMAIL_LEASE_LOST');
      assert.deepEqual((await f.db.query('select to_jsonb(e) value from public.dd2026_forecast_analytics_exports e where id=$1',[scope.id])).rows[0].value,priorScope);
    });
  }finally{await f.close();}
});
test('unknown selected-claim source or public ACL aborts entire forward migration without retained scope schema',async(t)=>{
  const f=await fixture({skipScopeMigration:true});
  try{
    const sql=await readFile(new URL('../supabase/migrations/'+MIGRATION,import.meta.url),'utf8');
    const signature='public.dd2026_forecast_result_email_claim(uuid,uuid,integer,text,text)';
    for(const [name,change]of[
      ['source drift',`create or replace function public.dd2026_forecast_result_email_claim(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_recipient_email text,p_pdf_hash text) returns jsonb language plpgsql security invoker set search_path='' as $changed$${f.previousClaim.replace("p_pdf_hash then","p_pdf_hash then /* unsupported drift */")}$changed$;`],
      ['anonymous execute',`grant execute on function ${signature} to anon;`],
      ['definer drift',`alter function ${signature} security definer;`],
    ])await t.test(name,async()=>{
      await f.db.exec('begin;');
      try{await f.db.exec(change);await assert.rejects(f.db.exec(sql),/Unknown selected email source or ACL/u);}finally{await f.db.exec('rollback;');}
      assert.equal((await f.db.query("select to_regclass('public.dd2026_forecast_analytics_exports') x")).rows[0].x,null);
      assert.equal((await f.db.query("select prosrc from pg_proc where oid=$1::regprocedure",[signature])).rows[0].prosrc,f.previousClaim);
    });
  }finally{await f.close();}
});
