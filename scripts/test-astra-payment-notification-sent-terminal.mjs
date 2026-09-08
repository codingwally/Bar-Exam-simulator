import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';

// Actual original claim/completion/receipt SQL and migration, disposable PGlite.
// Only the notification context is an explicit ID/attempt adapter. Minimal row
// schema: not a payment/access lifecycle, provider or two-backend race proof.
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.ASTRA_PGLITE_MODULE||'@electric-sql/pglite');
const read=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const soft=read('20260821120000_soft_launch_five_token_trial.sql');
const receipt=read('20260824123000_subscription_receipt_delivery.sql');
const migration=read('20260908115426_astra_payment_notification_sent_terminal.sql');
const functionSql=(source,name)=>{
 const matches=[...source.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`,'g'))];
 assert.equal(matches.length,1);return matches[0][0];
};
const claim=functionSql(soft,'phase4_claim_payment_notification');
const complete=functionSql(soft,'phase4_complete_payment_notification');
const completeReceipt=functionSql(receipt,'phase4_complete_subscription_receipt');
const body=sql=>sql.split('as $$')[1].split('$$;')[0];
const sha=s=>createHash('sha256').update(s).digest('hex');
assert.equal(sha(body(claim)),'c3a34ab7e47759057d3bd63ad3bd71c759b48c686ed62abfb7fc44547f8f1f95');
assert.equal(sha(body(complete)),'245803a0489b74fbd482c2de8fc55f8f6dfc5abf22417799c6cc9f7f02817855');
assert.equal(migration.match(/^begin;$/gm)?.length,1);
assert.equal(migration.match(/^commit;$/gm)?.length,1);
const inner=migration.replace(/^begin;\n/m,'').replace(/^commit;\n?$/m,'');
const db=new PGlite();let checks=0;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=id=>scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[id]);
const finish=(id,status,provider=null,error=null)=>scalar('select public.phase4_complete_payment_notification($1,$2,$3,$4)',[id,status,provider,error]);
const legacy=(id,status,provider=null,error=null)=>scalar('select public.astra_test_legacy_complete($1,$2,$3,$4)',[id,status,provider,error]);
const check=async(name,fn)=>{await fn();checks++;console.log(`PASS ${checks}: ${name}`);};
const expectError=async(fn,code,message)=>assert.rejects(fn,e=>e.code===code&&(!message||e.message===message));
async function fresh(status='pending'){
 const id=randomUUID();await db.query('insert into public.payment_requests(id,verification_email_status) values($1,$2)',[id,status]);return id;
}
async function snapshot(){
 return {
  rows:await scalar("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.payment_requests p"),
  functions:await scalar("select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'catalog',to_jsonb(p)-'oid','definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace)"),
  triggers:await scalar("select coalesce(jsonb_agg(to_jsonb(t)-'oid' order by tgname),'[]') from pg_trigger t where tgrelid='public.payment_requests'::regclass")
 };
}
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function drift(sql,message){
 const before=await snapshot();await isolated(async()=>{await db.exec(sql);await expectError(()=>db.exec(inner),'P0001',message);});assert.deepEqual(await snapshot(),before);
}
const six=p=>Object.fromEntries(Object.entries(p).filter(([k])=>k.startsWith('verification_email_')));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create schema private;revoke all on schema private from public,anon,authenticated,service_role;
  create table public.payment_requests(
   id uuid primary key,submitted_at timestamptz not null default clock_timestamp(),
   status text not null default 'pending',paid_at timestamptz,student_note text,
   verification_email_status text not null default 'pending'
     check(verification_email_status in ('pending','sending','sent','failed','suppressed')),
   verification_email_attempts integer not null default 0,
   verification_email_provider_id text,verification_email_error text,
   verification_email_last_attempt_at timestamptz,verification_email_sent_at timestamptz,
   subscriber_receipt_status text not null default 'pending',subscriber_receipt_provider_id text,
   subscriber_receipt_error text,subscriber_receipt_sent_at timestamptz);
  grant usage on schema public to anon,authenticated,service_role;
  grant select,update on public.payment_requests to service_role;
  create function public.phase4_payment_notification_context(p_id uuid) returns jsonb language sql as
    'select jsonb_build_object(''id'',id,''notificationAttempts'',verification_email_attempts) from public.payment_requests where id=p_id';`);
 await db.exec(claim);await db.exec(complete);await db.exec(completeReceipt);
 await db.exec(complete.replace('public.phase4_complete_payment_notification(','public.astra_test_legacy_complete('));
 for(const signature of ['phase4_claim_payment_notification(uuid)','phase4_complete_payment_notification(uuid,text,text,text)',
   'phase4_complete_subscription_receipt(uuid,text,text,text)','astra_test_legacy_complete(uuid,text,text,text)'])
  await db.exec(`revoke all on function public.${signature} from public,anon,authenticated;grant execute on function public.${signature} to service_role;`);
 const oldDefinition=await scalar("select pg_get_functiondef('public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure)");
 const oldMetadata=await scalar("select to_jsonb(p)-'prosrc'-'oid' from pg_proc p where oid='public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure");
 await check('Original completion reproduces newer-sent then old-failed metadata corruption',async()=>{
  const id=await fresh('sending');await finish(id,'sent','synthetic-B');const sent=await row(id);
  await finish(id,'failed',null,'synthetic-A');const failed=await row(id);
  assert.equal(failed.verification_email_status,'failed');assert.equal(failed.verification_email_provider_id,null);
  assert.equal(failed.verification_email_sent_at,sent.verification_email_sent_at);
 });
 await check('Whole migration rollback restores original definitions/ACL/rows and absent guard',async()=>{
  const before=await snapshot();await isolated(async()=>{await db.exec(inner);assert.ok(await scalar("select to_regprocedure('private.astra_guard_payment_notification_sent()') is not null"));});assert.deepEqual(await snapshot(),before);
 });
 await check('Failure after completion replacement rolls back the whole migration',async()=>{
  const before=await snapshot();await isolated(()=>expectError(()=>db.exec(inner.replace('    execute v_guard_definition;',"    raise exception 'SYNTHETIC_SECOND_COMPONENT_FAILURE';")),'P0001','SYNTHETIC_SECOND_COMPONENT_FAILURE'));assert.deepEqual(await snapshot(),before);
 });
 await check('Original completion source drift is refused without repair',()=>drift(complete.replace("'Invalid payment notification status'","'Changed status'"),'ASTRA_PAYMENT_NOTIFICATION_SENT_SOURCE_DRIFT'));
 await check('Claim source drift is refused without repair',()=>drift(claim.replace("interval '10 minutes'","interval '11 minutes'"),'ASTRA_PAYMENT_NOTIFICATION_SENT_SOURCE_DRIFT'));
 await check('Original ACL expansion refused',()=>drift('grant execute on function public.phase4_complete_payment_notification(uuid,text,text,text) to authenticated','ASTRA_PAYMENT_NOTIFICATION_SENT_METADATA_DRIFT'));
 await check('Original strictness drift refused',()=>drift('alter function public.phase4_complete_payment_notification(uuid,text,text,text) strict','ASTRA_PAYMENT_NOTIFICATION_SENT_METADATA_DRIFT'));
 await check('Original default drift refused',()=>drift(complete.replace('p_error text default null',"p_error text default 'changed'"),'ASTRA_PAYMENT_NOTIFICATION_SENT_METADATA_DRIFT'));
 await check('Guard overload collision refused',()=>drift("create function private.astra_guard_payment_notification_sent(integer) returns integer language sql as 'select 1'",'ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_DRIFT'));
 await check('Field nullability drift refused',()=>drift('alter table public.payment_requests alter column verification_email_attempts drop not null','ASTRA_PAYMENT_NOTIFICATION_SENT_PREREQUISITE'));
 await check('Exact CRLF original source is accepted without arbitrary normalization',async()=>{
  await isolated(async()=>{await db.exec(complete.replaceAll('\n','\r\n'));await db.exec(inner);assert.equal(await scalar("select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure"),'9275b458fa8151cc6c66b9558bf2500685a8d24a53b5e43f58757be4b54318e2');});
 });
 const beforeInstall=await snapshot();
 await check('Raw CRLF full migration installs and exact same-byte replay succeeds',async()=>{
  // Deliberately do not send this through read(), which normalizes source files.
  const rawCrlf=migration.replaceAll('\n','\r\n');assert.ok(rawCrlf.includes('\r\n'));
  await db.exec(rawCrlf);const installed=await snapshot();await db.exec(rawCrlf);
  assert.deepEqual(await snapshot(),installed);assert.deepEqual(installed.rows,beforeInstall.rows);
 });
 await check('Installation changes no stored rows; only exact completion body and new guard',async()=>{
  const after=await snapshot();assert.deepEqual(after.rows,beforeInstall.rows);
  assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc'-'oid' from pg_proc p where oid='public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure"),oldMetadata);
  const expected=oldDefinition.replace('  where id = p_payment_request_id;','  where id = p_payment_request_id\n    and verification_email_status <> \'sent\';');
  assert.equal(await scalar("select pg_get_functiondef('public.phase4_complete_payment_notification(uuid,text,text,text)'::regprocedure)"),expected);
  for(const f of beforeInstall.functions.filter(f=>!f.name.startsWith('phase4_complete_payment_notification(')))
   assert.deepEqual(after.functions.find(g=>g.name===f.name),f);
  assert.equal(after.functions.length,beforeInstall.functions.length+1);assert.equal(after.triggers.length,1);
 });
 await check('Complete exact reapply is byte/ACL/row idempotent',async()=>{const before=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),before);});
 const successful=await fresh();
 await check('Actual claim, normal success, trimming and void return preserved',async()=>{
  const claimed=await scalar('select public.phase4_claim_payment_notification($1)',[successful]);assert.equal(claimed.notificationAttempts,1);
  assert.equal(await finish(successful,'sent',`  ${'B'.repeat(220)}  `), '');
  const p=await row(successful);assert.equal(p.verification_email_status,'sent');assert.equal(p.verification_email_provider_id,'B'.repeat(180));assert.ok(p.verification_email_sent_at);
 });
 await check('Terminal failure/suppression/sent replay are exact no-ops and return void',async()=>{
  const before=await row(successful);for(const status of ['failed','suppressed','sent'])assert.equal(await finish(successful,status,'different','old failure'),'');assert.deepEqual(await row(successful),before);
 });
 await check('Exact frozen old completion failure is rejected after sent; no metadata erased',async()=>{
  const before=await row(successful);await expectError(()=>legacy(successful,'failed',null,'older attempt'),'P0001','ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE');assert.deepEqual(await row(successful),before);
 });
 await check('Exact frozen old success cannot restamp first terminal provider/timestamp',async()=>{
  const before=await row(successful);await expectError(()=>legacy(successful,'sent','different'),'P0001','ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE');assert.deepEqual(await row(successful),before);
 });
 const mutations={verification_email_status:"'failed'",verification_email_attempts:'verification_email_attempts+1',
  verification_email_provider_id:'null',verification_email_error:"'changed'",verification_email_last_attempt_at:'null',verification_email_sent_at:'null'};
 for(const [field,value]of Object.entries(mutations))await check(`Terminal ${field} mutation denied atomically`,async()=>{
  const before=await row(successful);await expectError(()=>db.query(`update public.payment_requests set ${field}=${value},student_note='must rollback' where id=$1`,[successful]),'P0001','ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE');assert.deepEqual(await row(successful),before);
 });
 const nullMetadata=await fresh('sent');
 for(const [field,value]of Object.entries({verification_email_provider_id:"'synthetic'",verification_email_error:"'synthetic'",verification_email_last_attempt_at:'clock_timestamp()',verification_email_sent_at:'clock_timestamp()'}))
  await check(`Terminal NULL-to-value ${field} also denied`,async()=>{const before=await row(nullMetadata);await expectError(()=>db.query(`update public.payment_requests set ${field}=${value} where id=$1`,[nullMetadata]),'P0001','ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE');assert.deepEqual(await row(nullMetadata),before);});
 await check('Unrelated ordinary approval/note and real receipt-completion SQL remain allowed',async()=>{
  const frozen=six(await row(successful));await db.query("update public.payment_requests set status='approved',paid_at=clock_timestamp(),student_note='synthetic review' where id=$1",[successful]);
  await scalar("select public.phase4_complete_subscription_receipt($1,'sent','synthetic-receipt',null)",[successful]);
  const p=await row(successful);assert.equal(p.status,'approved');assert.equal(p.subscriber_receipt_status,'sent');assert.deepEqual(six(p),frozen);
 });
 await check('Exact same six-field assignment passes without suppressing other changes',async()=>{
  await db.query("update public.payment_requests set verification_email_status=verification_email_status,student_note='allowed' where id=$1",[successful]);assert.equal((await row(successful)).student_note,'allowed');
 });
 await check('Sent row remains excluded from actual specific claim',async()=>{const before=await row(successful);assert.equal(await scalar('select public.phase4_claim_payment_notification($1)',[successful]),null);assert.deepEqual(await row(successful),before);});
 await check('Unsent failure preserves existing default error/truncation behavior',async()=>{
  const id=await fresh('sending');await finish(id,'failed',null,'  ');assert.equal((await row(id)).verification_email_error,'delivery_failed');
  await finish(id,'failed',null,'E'.repeat(700));assert.equal((await row(id)).verification_email_error,'E'.repeat(500));
 });
 await check('Unsent suppression still works and legacy unsent first success still works',async()=>{
  const id=await fresh('sending');await finish(id,'suppressed');assert.equal((await row(id)).verification_email_status,'suppressed');
  const other=await fresh('sending');await legacy(other,'sent','legacy-first');assert.equal((await row(other)).verification_email_provider_id,'legacy-first');
 });
 await check('Known residual: older failure while newer attempt still sending is NOT fenced',async()=>{
  const id=await fresh('sending');await db.query('update public.payment_requests set verification_email_attempts=2 where id=$1',[id]);await legacy(id,'failed',null,'old attempt');assert.equal((await row(id)).verification_email_status,'failed');
 });
 await check('Invalid status retains exact P0001 wording including NULL/missing IDs',async()=>{
  for(const id of [successful,null,randomUUID()])await expectError(()=>finish(id,'invalid'),'P0001','Invalid payment notification status');
 });
 await check('NULL status on unsent preserves NOT NULL denial and no mutation',async()=>{
  const id=await fresh();const before=await row(id);await expectError(()=>finish(id,null),'23502');assert.deepEqual(await row(id),before);
 });
 await check('NULL/missing owner ID has no row; terminal NULL status is predicate no-op',async()=>{
  const before=await snapshot();for(const id of [null,randomUUID()])assert.equal(await finish(id,null),'');assert.equal(await finish(successful,null),'');assert.deepEqual(await snapshot(),before);
 });
 for(const role of ['anon','authenticated'])await check(`${role} cannot call original completion RPC`,async()=>{
  await isolated(async()=>{await db.exec(`set local role ${role}`);await expectError(()=>finish(successful,'failed'),'42501');});
 });
 await check('Service-role completion returns void on sent no-op with unchanged ACL',async()=>{
  const before=await row(successful);await isolated(async()=>{await db.exec('set local role service_role');assert.equal(await finish(successful,'failed'),'');});assert.deepEqual(await row(successful),before);
 });
 for(const role of ['anon','authenticated','service_role'])await check(`${role} receives no new private guard execution privilege`,async()=>{
  assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,'private.astra_guard_payment_notification_sent()']),false);
  await isolated(async()=>{await db.exec(`set local role ${role}`);await expectError(()=>scalar('select private.astra_guard_payment_notification_sent()'),'42501');});
 });
 await check('Service direct mutation cannot bypass the pure invoker row guard',async()=>{
  await isolated(async()=>{await db.exec('set local role service_role');await expectError(()=>db.query("update public.payment_requests set verification_email_status='failed' where id=$1",[successful]),'P0001','ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE');});
 });
 await check('Guard is private SECINVOC, pure and has no table/role/GUC bypass',async()=>{
  const p=await scalar("select to_jsonb(p) from pg_proc p where oid='private.astra_guard_payment_notification_sent()'::regprocedure");assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=""']);assert.deepEqual(p.proacl,['postgres=X/postgres']);
  assert.doesNotMatch(p.prosrc,/\b(select|insert|update\s+public|delete|execute|current_setting|set_config)\b/i);
 });
 await check('Guard disabled replay is refused',()=>drift('alter table public.payment_requests disable trigger astra_guard_payment_notification_sent','ASTRA_PAYMENT_NOTIFICATION_SENT_TRIGGER_DRIFT'));
 await check('Missing guard trigger partial replay is refused',()=>drift('drop trigger astra_guard_payment_notification_sent on public.payment_requests','ASTRA_PAYMENT_NOTIFICATION_SENT_PARTIAL_INSTALL'));
 await check('Original completion with installed guard partial replay is refused',()=>drift(complete,'ASTRA_PAYMENT_NOTIFICATION_SENT_PARTIAL_INSTALL'));
 await check('Guard LEAKPROOF metadata drift refused',()=>drift('alter function private.astra_guard_payment_notification_sent() leakproof','ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_DRIFT'));
 await check('Guard execute grant drift refused',()=>drift('grant execute on function private.astra_guard_payment_notification_sent() to service_role','ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_DRIFT'));
 await check('Guard body drift refused',async()=>{
  const definition=await scalar("select pg_get_functiondef('private.astra_guard_payment_notification_sent()'::regprocedure)");await drift(definition.replace('return new;','return old;'),'ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_DRIFT');
 });
 console.log(JSON.stringify({ok:true,checks,skips:0,sourceSql:true,hosted:false,provider:false,twoBackendRaceProven:false,scope:'Terminal sent metadata only; no claim-generation or transport exactly-once claim.'}));
}finally{await db.close();}
