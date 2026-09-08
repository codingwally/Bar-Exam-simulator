import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Actual local SQL, no network/provider/Auth service/Storage, no persistent DB.
// Reuse the established disposable lifecycle schema and exact source RPCs. Its
// clock/access adapters remain explicit fixture limits, not hosted or race proof.
const fixtureUrl = new URL('./test-astra-payment-lifecycle.mjs', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8').replaceAll('\r\n', '\n');
const boundary = '  const pendingOwner = await user();';
assert.equal(fixture.split(boundary).length, 2, 'Unique schema-only fixture boundary');
const prefix = fixture.split(boundary)[0].replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));

async function isolationCases() {
  const migrationName='20260908105314_astra_internal_payment_fixture_mail_isolation.sql';
  const migration=readFileSync(new URL(`../supabase/migrations/${migrationName}`, fixtureUrl), 'utf8');
  const soft=read('20260821120000_soft_launch_five_token_trial.sql');
  // Complete reviewed current release pair, not a knowingly incomplete late-v4 window.
  await exec(activation); await exec(evidence); await exec(invalidation); await exec(lateProof);
  await exec(functionSql(pricing,'phase4_pricing_snapshot'));
  await exec(read('20260907133129_astra_149_binding_compatibility.sql'));
  await exec(read('20260907143119_astra_late_149_binding_reconciliation.sql'));
  await setTime('2026-09-07T06:01:00Z');
  newPlan=oldPlan; newChannel=oldChannel;
  await db.exec(`
    alter table auth.users add column raw_user_meta_data jsonb default '{}', add column raw_app_meta_data jsonb default '{}';
    create table public.user_roles(user_id uuid primary key references auth.users(id),role text);
    create table public.admin_capabilities(user_id uuid references auth.users(id));
    create table public.examination_beta_access(user_id uuid references auth.users(id));
  `);
  const registry=read('20260828095004_internal_test_account_reporting_scope.sql');
  await db.exec(registry.match(/create table if not exists private\.internal_test_accounts \([\s\S]+?\n\);/)[0]);
  await db.exec(`alter table private.internal_test_accounts enable row level security;
    alter table private.internal_test_accounts force row level security;
    revoke all on private.internal_test_accounts from public,anon,authenticated,service_role;
    revoke all on schema private from public,anon,authenticated,service_role;`);
  await db.exec(soft.match(/alter table public\.payment_requests\n  add column if not exists verification_email_status[\s\S]+?;/)[0]);
  // Replace only the old harness's empty simplified queue, before any intake.
  await db.exec('drop table public.outbound_notifications');
  await db.exec(tableSql(originalPayment,'outbound_notifications'));
  await db.exec(`alter table public.outbound_notifications drop constraint outbound_notifications_recipient_mailbox_check;
    alter table public.outbound_notifications add constraint outbound_notifications_recipient_mailbox_check
      check(recipient_mailbox in ('plansandpricing@duediligence.ph','founders@duediligence.ph','support@duediligence.ph','premium@duediligence.ph'));
    alter table public.payment_requests alter column updated_at set default public.astra_test_now();
    alter table public.payment_request_history alter column occurred_at set default public.astra_test_now();
    alter table public.outbound_notifications alter column created_at set default public.astra_test_now();`);
  await exec(functionSql(pricing,'phase4_payment_notification_context'));
  await exec(functionSql(soft,'phase4_claim_payment_notification'));
  await exec(functionSql(soft,'phase4_complete_payment_notification'));
  await db.exec(`revoke all on function public.phase4_claim_payment_notification(uuid) from public,anon,authenticated;
    grant execute on function public.phase4_claim_payment_notification(uuid) to service_role;`);

  const sourceFor=(id)=>`astra_payment_fixture_mail_v1:${id}`;
  async function make({registered=false,source,role='student',mismatch=false,metadata=false}={}) {
    const id=randomUUID(), email=`isolation-${id}@example.invalid`;
    await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$3)',
      [id,email,metadata?{classification_source:sourceFor(id),internal_test:true}:{}]);
    if(role!==undefined && role!==false) await db.query('insert into public.user_roles values($1,$2)',[id,role]);
    if(registered) await db.query('insert into private.internal_test_accounts(user_id,email_at_classification,classification_source) values($1,$2,$3)',
      [id,mismatch?'wrong@example.invalid':email,source===undefined?sourceFor(id):source.replace('<owner>',id)]);
    return id;
  }
  const spec=(owner,rpc='phase4_create_payment_request_v4')=>({owner,rpc,path:`${owner}/${randomUUID()}.png`,sha:hash(),ref:randomUUID().replaceAll('-','')});
  async function call(s) {
    if(s.rpc.endsWith('_v2')) return scalar(`select public.${s.rpc}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [s.owner,oldPlan,oldChannel,'2026-09-07',s.ref,'payment-proofs',s.path,'image/png',1200,s.sha]);
    return scalar(`select public.${s.rpc}($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.owner,oldPlan,oldChannel,'payment-proofs',s.path,'image/png',1200,s.sha]);
  }
  const row=(id)=>scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[id]);
  const notice=(id)=>scalar('select to_jsonb(n) from public.outbound_notifications n where related_resource_id=$1',[id]);
  async function capture(id) {
    const p=await row(id), n=await notice(id);
    const h=await scalar('select to_jsonb(h) from public.payment_request_history h where payment_request_id=$1',[id]);
    delete p.id; delete n.id; delete h.id;
    n.related_resource_id='<payment>'; h.payment_request_id='<payment>';
    n.secure_admin_path=n.secure_admin_path.replace(id,'<payment>');
    // Request keys embed the newly generated payment ID in history, not evidence.
    h.request_key=h.request_key.replace(id,'<payment>');
    return {p,n,h};
  }
  async function publicDefinitions() {
    return query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where pronamespace='public'::regnamespace order by 1");
  }
  async function rowsSnapshot() {
    const result={};
    for(const name of ['payment_requests','payment_request_history','outbound_notifications','subscriptions','subscription_history'])
      result[name]=await scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t`);
    result.registry=await scalar("select coalesce(jsonb_agg(to_jsonb(t) order by user_id),'[]') from private.internal_test_accounts t");
    return result;
  }
  const controls=[];
  for(const rpc of ['phase4_create_payment_request_v2','phase4_create_payment_request_v3','phase4_create_payment_request_v4']) for(const registered of [false,true]) {
    const owner=await make({registered}), s=spec(owner,rpc);
    await db.exec('begin');
    const result=await call(s), baseline=await capture(result.id);
    await db.exec('rollback'); controls.push({s,baseline,registered});
  }
  // Existing failed/uncertain evidence must never be adopted or normalized.
  const existing=await call(spec(await make()));
  await db.query("update public.payment_requests set verification_email_status='failed',verification_email_attempts=6,verification_email_last_attempt_at=public.astra_test_now(),verification_email_error='Synthetic unknown outcome' where id=$1",[existing.id]);
  const beforeRows=await rowsSnapshot(), beforeFunctions=await publicDefinitions();
  await db.exec(migration);
  await check('Install changes no preexisting rows or public function bytes/ACLs',async()=>{
    assert.deepEqual(await rowsSnapshot(),beforeRows); assert.deepEqual(await publicDefinitions(),beforeFunctions);
  });
  for(const {s,baseline,registered} of controls) await check(`${s.rpc} ${registered?'dedicated QA':'ordinary'}: exact payment/history/24h, only opted-in statuses differ`,async()=>{
    const result=await call(s), actual=await capture(result.id);
    if(registered) {baseline.p.verification_email_status='suppressed'; baseline.n.status='suppressed';}
    assert.deepEqual(actual,baseline);
    assert.equal(result.status,'pending');
    assert.equal(actual.p.verification_email_attempts,0); assert.equal(actual.n.attempts,0);
    assert.equal(new Date(actual.p.provisional_access_expires_at)-new Date(actual.p.provisional_access_started_at),86400000);
    assert.equal(actual.p.paid_at,null); assert.equal(actual.p.approved_activation_at,null);
    if(!s.rpc.endsWith('_v2')) {assert.equal(actual.p.payment_date,null);assert.equal(actual.p.transaction_reference,null);}
    assert.equal(await scalar('select count(*)::int from public.subscriptions where user_id=$1',[s.owner]),0);
    const frozen=await rowsSnapshot(), replay=await call(s);
    assert.equal(replay.id,result.id); assert.equal(replay.replayed,true); assert.deepEqual(await rowsSnapshot(),frozen);
    const claim=await scalar('select public.phase4_claim_payment_notification($1)',[result.id]);
    if(registered) {assert.equal(claim,null);assert.deepEqual(await rowsSnapshot(),frozen);}
    else {assert.equal(claim.id,result.id);assert.equal(claim.notificationAttempts,1);}
  });
  for(const source of [null,'internal_test','astra_commercial_staging_v1:abcd1234-deadbeef:provisional',
    'astra_payment_fixture_mail_v1:',`astra_payment_fixture_mail_v1:${randomUUID()}`,'astra_payment_fixture_mail_v1:<owner>:extra'])
    await check(`Unmatched private source ${source===null?'absent':source.split(':')[0]} stays ordinary`,async()=>{
      const p=await call(spec(await make({registered:source!==null,source,metadata:true})));
      assert.equal((await row(p.id)).verification_email_status,'pending'); assert.equal((await notice(p.id)).status,'queued');
      const claimed=await scalar('select public.phase4_claim_payment_notification($1)',[p.id]);
      assert.equal(claimed.id,p.id); assert.equal(claimed.notificationAttempts,1);
    });
  const columns=(await query("select column_name from information_schema.columns where table_schema='public' and table_name='payment_requests' and is_generated='NEVER' order by ordinal_position")).map(x=>`"${x.column_name}"`).join(',');
  const prototype=await row(existing.id);
  async function directPayment(owner,patch={}) {
    const p={...prototype,id:randomUUID(),user_id:owner,proof_object_path:`${owner}/${randomUUID()}.png`,proof_sha256:hash(),request_key:hash(),
      verification_email_status:'pending',verification_email_attempts:0,verification_email_last_attempt_at:null,
      verification_email_provider_id:null,verification_email_sent_at:null,verification_email_error:null,...patch};
    return db.query(`insert into public.payment_requests(${columns}) select ${columns} from jsonb_populate_record(null::public.payment_requests,$1::jsonb) returning id`,[p]);
  }
  async function directNotice(payment,patch={}) {
    return scalar(`insert into public.outbound_notifications(notification_type,recipient_mailbox,subject,secure_admin_path,related_resource_type,related_resource_id,status,attempts,last_attempt_at,sent_at,failure_code)
      select notification_type,recipient_mailbox,subject,secure_admin_path,related_resource_type,related_resource_id,status,attempts,last_attempt_at,sent_at,failure_code
      from jsonb_populate_record(null::public.outbound_notifications,$1::jsonb) returning to_jsonb(outbound_notifications)`,[
      {notification_type:'payment_submitted',recipient_mailbox:'premium@duediligence.ph',subject:'Synthetic notification',secure_admin_path:'/admin/payments',
        related_resource_type:'payment_request',related_resource_id:payment,status:'queued',attempts:0,last_attempt_at:null,sent_at:null,failure_code:null,...patch}]);
  }
  for(const [label,options,setup] of [
    ['email mismatch',{mismatch:true}],['missing role',{role:false}],['NULL role',{role:null}],['admin',{role:'admin'}],
    ['capability',{},id=>db.query('insert into public.admin_capabilities values($1)',[id])],
    ['Beta',{},id=>db.query("insert into public.free_beta_access(user_id,enabled,access_program) values($1,true,'founding_beta')",[id])],
    ['examination Beta',{},id=>db.query('insert into public.examination_beta_access values($1)',[id])],
    ['subscription',{},id=>db.query("insert into public.subscriptions(user_id,plan_code,status,starts_at,source) values($1,'early_access_beta','active','2026-09-01','complimentary')",[id])],
  ]) await check(`Exact opted-in ${label} fails closed, not ordinary-send fallback`,async()=>{
    const id=await make({registered:true,...options}); if(setup)await setup(id);
    await assert.rejects(directPayment(id),/ASTRA_PAYMENT_FIXTURE_IDENTITY_UNSAFE/);
    assert.equal(await scalar('select count(*)::int from public.payment_requests where user_id=$1',[id]),0);
  });
  await check('No adoption of existing payment even if root later marks the identity',async()=>{
    const p=await row(existing.id),u=await scalar('select email from auth.users where id=$1',[p.user_id]);
    await db.query('insert into private.internal_test_accounts(user_id,email_at_classification,classification_source) values($1,$2,$3)',[p.user_id,u,sourceFor(p.user_id)]);
    await assert.rejects(directPayment(p.user_id),/ASTRA_PAYMENT_FIXTURE_IDENTITY_UNSAFE/);
    await assert.rejects(directNotice(existing.id),/ASTRA_PAYMENT_FIXTURE_NOTIFICATION_NOT_PRISTINE/);
    assert.deepEqual(await row(existing.id),p);
  });
  for(const patch of [
    {verification_email_status:'suppressed'},{verification_email_status:null},{verification_email_status:'sending'},
    {verification_email_attempts:1},{verification_email_attempts:null},{verification_email_provider_id:'synthetic'},
    {verification_email_error:'unknown'},{verification_email_last_attempt_at:'2026-09-07T00:00:00Z'},{verification_email_sent_at:'2026-09-07T00:00:00Z'},
  ]) await check(`Dirty opted-in payment ${Object.keys(patch)[0]} refused`,async()=>{
    const id=await make({registered:true});await assert.rejects(directPayment(id,patch),/ASTRA_PAYMENT_FIXTURE_NOTIFICATION_NOT_PRISTINE/);
  });
  const safe=await call(spec(await make({registered:true})));
  await check('Actual service-role v4 call invokes private trigger without direct helper privilege',async()=>{
    const s=spec(await make({registered:true}));let result;
    await db.exec('set role service_role');
    try {result=await call(s);assert.equal(await scalar('select public.phase4_claim_payment_notification($1)',[result.id]),null);}
    finally {await db.exec('reset role');}
    assert.equal((await row(result.id)).verification_email_status,'suppressed');assert.equal((await notice(result.id)).status,'suppressed');
  });
  await check('Notice rechecks opted-in identity; later unsafe role fails closed',async()=>{
    const p=await row(safe.id);await db.exec('begin');
    await db.query("update public.user_roles set role='admin' where user_id=$1",[p.user_id]);
    await assert.rejects(directNotice(safe.id),/ASTRA_PAYMENT_FIXTURE_IDENTITY_UNSAFE/);await db.exec('rollback');
  });
  for(const patch of [{status:'suppressed'},{status:null},{attempts:1},{attempts:null},{last_attempt_at:'2026-09-07T00:00:00Z'},{sent_at:'2026-09-07T00:00:00Z'},{failure_code:'unknown'}])
    await check(`Dirty opted-in notice ${Object.keys(patch)[0]} refused`,async()=>{
      await assert.rejects(directNotice(safe.id,patch),/ASTRA_PAYMENT_FIXTURE_NOTIFICATION_NOT_PRISTINE/);
    });
  await check('Unrelated notice type/resource/missing payment remains byte-for-byte queued',async()=>{
    for(const patch of [{notification_type:'refund_submitted'},{related_resource_type:'refund_request'},{related_resource_id:randomUUID()}]) {
      const n=await directNotice(safe.id,patch);assert.equal(n.status,'queued');assert.equal(n.attempts,0);
    }
  });
  await check('Global v1 drain skips all isolated payments; ordinary claim path still executes',async()=>{
    // Ordinary controls already sending and existing failed row is within its backoff.
    assert.equal(await scalar('select public.phase4_claim_payment_notification(null)'),null);
    assert.equal(await scalar("select count(*)::int from public.payment_requests p join private.internal_test_accounts i on i.user_id=p.user_id where i.classification_source='astra_payment_fixture_mail_v1:'||p.user_id::text and p.id<>$1 and (p.verification_email_status<>'suppressed' or p.verification_email_attempts<>0)",[existing.id]),0);
  });
  await check('Private trigger-only owner/search_path/ACL; public roles cannot opt in or call',async()=>{
    assert.equal(await scalar("select count(*)::int from pg_proc where oid in ('private.astra_isolate_payment_fixture_mail()'::regprocedure,'private.astra_isolate_payment_fixture_notice()'::regprocedure) and prosecdef and proconfig=array['search_path=\"\"'] and proacl::text='{postgres=X/postgres}' and pg_get_userbyid(proowner)='postgres'"),2);
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal(await scalar(`select has_function_privilege('${role}','private.astra_isolate_payment_fixture_mail()','EXECUTE') or has_function_privilege('${role}','private.astra_isolate_payment_fixture_notice()','EXECUTE')`),false);
      await db.exec(`set role ${role}`);
      try {await assert.rejects(db.query('select * from private.internal_test_accounts'),/permission denied/);}
      finally {await db.exec('reset role');}
    }
  });
  await check('Exact migration replay preserves every row and existing RPC definition',async()=>{
    const before=await rowsSnapshot();await db.exec(migration);
    assert.deepEqual(await rowsSnapshot(),before);assert.deepEqual(await publicDefinitions(),beforeFunctions);
  });
  for(const [label,sql,pattern] of [
    ['registry table grant','grant update on private.internal_test_accounts to service_role',/REGISTRY_PROTECTION_CHANGED/],
    ['registry column grant','grant select(user_id) on private.internal_test_accounts to authenticated',/REGISTRY_PROTECTION_CHANGED/],
    ['registry RLS','alter table private.internal_test_accounts no force row level security',/REGISTRY_PROTECTION_CHANGED/],
    ['function body',"create or replace function private.astra_isolate_payment_fixture_mail() returns trigger language plpgsql security definer set search_path='' as $$begin return new; end$$",/FUNCTION_DRIFT/],
    ['function ACL','grant execute on function private.astra_isolate_payment_fixture_mail() to service_role',/FUNCTION_DRIFT/],
    ['trigger disabled','alter table public.payment_requests disable trigger astra_isolate_payment_fixture_mail',/TRIGGER_DRIFT/],
  ]) await check(`Migration refuses ${label} drift without repair`,async()=>{
    await db.exec('begin');await db.exec(sql);
    await assert.rejects(db.exec(migration),pattern);await db.exec('rollback');
  });
  assert.match(migration,/set local lock_timeout = '4s'/);assert.match(migration,/set local statement_timeout = '15s'/);
  assert.doesNotMatch(migration,/\b(?:update|delete from|insert into)\s+(?:public|private)\./i,'No stored-row DML in migration');
  console.log(JSON.stringify({ok:true,checks:checks.length,skipped:0,scope:'local actual SQL; source RPC clock/access fixture adapters; no hosted or multi-backend claim'}));
}

const code = `const fixtureUrl=new URL(${JSON.stringify(fixtureUrl.href)});\n${prefix}\nawait (${isolationCases.toString()})();\n} finally { await db.close(); }`;
await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
