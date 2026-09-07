import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';

// Runs actual migration/RPC SQL in disposable PostgreSQL WASM. No network,
// customer data, mail provider, remote database, or on-disk database is used.
// Set ASTRA_PGLITE_MODULE to an installed @electric-sql/pglite package if needed.
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.ASTRA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const pricing = read('20260830054727_admin_pricing_revisions.sql');
const proof = read('20260831101000_proof_only_payment_evidence.sql');
const originalPayment = read('20260730_008_phase4_payments_partnerships.sql');
const originalAccess = read('20260730_005_phase4_access_subscriptions.sql');
const activation = read('20260907120000_astra_payment_activation_terms.sql');
const evidence = read('20260907120100_astra_payment_proof_evidence.sql');
const invalidation = read('20260907120200_astra_payment_invalidation.sql');
const functionSql = (source, name) => {
  const result = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`));
  assert.ok(result, `Function ${name} exists in the baseline`);
  return result[0];
};
const tableSql = (source, name) => {
  const result = source.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]+?\\n\\);`));
  assert.ok(result, `Table ${name} exists in the baseline`);
  return result[0];
};
// Only the clock dependency is injected, keeping cutover tests deterministic.
const withClock = (sql) => sql.replace(/\b(?:pg_catalog\.)?clock_timestamp\(\)/g, 'public.astra_test_now()');
const exec = (sql) => db.exec(withClock(sql));
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0];
const setTime = (instant) => db.query('update public.astra_test_clock set instant=$1', [instant]);
const actor = '70000000-0000-4000-8000-000000000001';
const oldRevision = '70000000-0000-4000-8000-000000000010';
const oldPlan = '70000000-0000-4000-8000-000000000011';
const oldChannel = '70000000-0000-4000-8000-000000000012';
const futureRevision = '70000000-0000-4000-8000-000000000020';
const futurePlan = '70000000-0000-4000-8000-000000000021';
const futureChannel = '70000000-0000-4000-8000-000000000022';
const newRevision = 'a9070000-0000-4000-8000-000000000149';
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
async function user() {
  const id = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'fixture@example.invalid')", [id]);
  return id;
}
const hash = (value = randomUUID()) => createHash('sha256').update(value).digest('hex');
let newPlan;
let newChannel;
async function submit(id, options = {}) {
  const proofHash = options.hash || hash();
  const proofPath = `${id}/${randomUUID()}.png`;
  const result = await scalar('select public.phase4_create_payment_request_v3($1,$2,$3,$4,$5,$6,$7,$8)', [
    id, options.plan || newPlan, options.channel || newChannel,
    'payment-proofs', proofPath, 'image/png', 1200, proofHash,
  ]);
  return { ...result, proofHash, proofPath };
}
async function review(id, status, options = {}) {
  const payload = { status, ...(options.payload || {}) };
  return scalar('select public.phase4_admin_review_payment($1,$2,$3,$4,$5)', [
    options.actor || actor, id, payload, 'Controlled local payment verification fixture', options.key || randomUUID(),
  ]);
}
async function invalidate(id, options = {}) {
  return scalar('select public.phase4_admin_invalidate_payment($1,$2,$3,$4)',[
    options.actor || actor,id,'Controlled invalid-proof verification fixture',options.key || randomUUID(),
  ]);
}

try {
  await db.exec("set timezone='UTC'");
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text,is_anonymous boolean default false);
    create table public.profiles(id uuid primary key,display_name text);
    create table public.astra_test_clock(instant timestamptz not null);
    insert into public.astra_test_clock values('2026-09-07T06:00:00Z');
    create function public.astra_test_now() returns timestamptz language sql volatile as
      'select instant from public.astra_test_clock';
    create function extensions.digest(text,text) returns bytea language sql immutable as
      'select pg_catalog.sha256(pg_catalog.convert_to($1,''UTF8''))';
    create function public.jsonb_has_forbidden_keys(jsonb,text[]) returns boolean language sql immutable as 'select false';
    create table public.plan_catalog(plan_code text primary key,price_php numeric,duration_days integer,status text default 'active',updated_at timestamptz);
    insert into public.plan_catalog(plan_code,price_php,duration_days) values('early_access_beta',149,null),('bar_access_30d',199,30);
    create table public.admin_action_requests(request_key text primary key,actor_user_id uuid,action text,target_resource_id text,result jsonb,completed_at timestamptz);
    create table public.admin_audit_log(id uuid default gen_random_uuid(),actor_user_id uuid,action_type text,target_user_id uuid,target_resource_type text,target_resource_id text,reason text,details jsonb);
    create table public.outbound_notifications(notification_type text,recipient_mailbox text,subject text,secure_admin_path text,related_resource_type text,related_resource_id uuid);
    create function public.phase4_access_snapshot(uuid,boolean,text) returns jsonb language plpgsql as
      'begin if $2 then raise exception ''Trial activation is forbidden in this fixture''; end if; return jsonb_build_object(''basis'',''introductory_tokens'',''tokensRemaining'',7); end';
    create function public.phase4_require_founder(p_actor_user_id uuid) returns void language plpgsql as
      'begin if p_actor_user_id is distinct from ''${actor}''::uuid then raise exception ''Founder access required''; end if; end;';
    create function public.phase4_admin_operational_data_scoped_v1(uuid,text,text,integer,integer,text) returns jsonb language sql as
      'select jsonb_build_object(''items'',coalesce(jsonb_agg(to_jsonb(p)),''[]''::jsonb)) from public.payment_requests p';
  `.replace(/    create function public\.phase4_admin_operational_data_scoped_v1[\s\S]*$/, ''));
  await exec(tableSql(originalAccess, 'subscriptions'));
  await exec(tableSql(originalAccess, 'subscription_history'));
  for (const name of ['pricing_revisions','pricing_assets','pricing_plan_versions','pricing_payment_channel_versions']) await exec(tableSql(pricing, name));
  await exec(tableSql(originalPayment, 'payment_requests'));
  for (const name of ['payment_request_history','refund_requests','refund_request_history']) await exec(tableSql(originalPayment, name));
  await db.exec(`
    alter table public.payment_requests drop constraint payment_requests_payment_method_check;
    alter table public.payment_requests add constraint payment_requests_payment_method_check check(payment_method ~ '^[a-z][a-z0-9_]{2,63}$');
    alter table public.payment_requests add column provisional_access_started_at timestamptz,
      add column provisional_access_expires_at timestamptz,add column provisional_access_revoked_at timestamptz,
      add column verification_email_status text default 'pending',add column verification_email_attempts integer default 0,
      add column subscriber_receipt_status text default 'pending',add column subscriber_receipt_attempts integer default 0;
    alter table public.payment_requests add column subscriber_receipt_error text;
    alter table public.payment_requests alter column submitted_at set default public.astra_test_now();
    create unique index payment_requests_method_reference_uidx on public.payment_requests(payment_method,reference_normalized);
    create unique index payment_requests_one_provisional_per_user_uidx on public.payment_requests(user_id) where provisional_access_started_at is not null;
    create unique index subscriptions_one_live_per_user_idx on public.subscriptions(user_id) where status in('trialing','pending_payment','active','paused');
    create unique index pricing_revisions_one_draft_uidx on public.pricing_revisions((true)) where state='draft';
    create unique index pricing_revisions_one_scheduled_uidx on public.pricing_revisions((true)) where state='scheduled';
    create function public.phase4_admin_operational_data_scoped_v1(uuid,text,text,integer,integer,text) returns jsonb language sql as
      'select jsonb_build_object(''items'',coalesce(jsonb_agg(to_jsonb(p)),''[]''::jsonb)) from public.payment_requests p';
  `);
  for (const name of ['payment_requests','subscriptions']) {
    const alter = pricing.match(new RegExp(`alter table public\\.${name}\\n  add column[\\s\\S]+?;`));
    assert.ok(alter); await exec(alter[0]);
  }
  await exec(proof.match(/alter table public\.payment_requests\n  add column[\s\S]+?;/)[0]);
  for (const name of ['phase4_clone_pricing_revision','phase4_guard_pricing_revision_mutation','phase4_guard_pricing_child_mutation','phase4_enforce_live_subscription_plan','phase4_pricing_revision_snapshot','phase4_create_refund_request']) await exec(functionSql(pricing, name));
  await exec(functionSql(proof,'phase4_guard_payment_evidence_provenance'));
  await exec(functionSql(proof,'phase4_create_payment_request_v3'));
  await db.query('insert into auth.users(id,email) values($1,$2)', [actor,'founder@example.invalid']);
  await db.query(`insert into public.pricing_revisions(id,state,effective_at,published_at,page_config)
    values($1,'published','2026-08-31T00:00:00Z','2026-08-31T00:00:00Z',$2),
          ($3,'scheduled','2026-09-13T16:00:00Z',null,$2)`, [oldRevision,{page:{title:'Owner-authored heading'},faqs:[{question:'Custom?',answer:'Preserve me.'}]},futureRevision]);
  await db.query(`insert into public.pricing_plan_versions(id,revision_id,plan_code,name,price_centavos,entitlement_mode,fixed_ends_at,duration_days,features,description,renewal_note,checkout_enabled,checkout_ends_at)
    values($1,$2,'early_access_beta','Owner-authored plan',14900,'fixed_end','2026-10-01T15:59:59Z',null,'["Original feature"]','Owner description','Owner renewal note',true,'2026-09-13T16:00:00Z'),
          ($3,$4,'bar_access_30d','Scheduled plan',19900,'rolling_days',null,30,'[]','Future description','Future note',true,null)`, [oldPlan,oldRevision,futurePlan,futureRevision]);
  await db.query(`update public.pricing_plan_versions set checkout_starts_at='2026-09-13T16:00:00Z' where id=$1`,[futurePlan]);
  await db.query(`insert into public.pricing_payment_channel_versions(id,revision_id,plan_version_id,channel_code,label,account_name,account_details,instructions,qr_public_path,amount_centavos)
    values($1,$2,$3,'bpi_instapay','BPI InstaPay','Owner beneficiary','Owner details','Owner instructions','/assets/payments/bpi-instapay-149.png',14900),
          ($4,$5,$6,'bpi_instapay','BPI InstaPay','Scheduled beneficiary','Scheduled details','Scheduled instructions','/assets/payments/bpi-instapay-199-qr.png',19900)`,[oldChannel,oldRevision,oldPlan,futureChannel,futureRevision,futurePlan]);
  await db.exec(`
    create trigger phase4_guard_pricing_revision_mutation_trigger before update or delete on public.pricing_revisions for each row execute function public.phase4_guard_pricing_revision_mutation();
    create trigger phase4_guard_pricing_plan_versions_trigger before insert or update or delete on public.pricing_plan_versions for each row execute function public.phase4_guard_pricing_child_mutation();
    create trigger phase4_guard_pricing_payment_channels_trigger before insert or update or delete on public.pricing_payment_channel_versions for each row execute function public.phase4_guard_pricing_child_mutation();
    create trigger phase4_enforce_live_subscription_plan_trigger before insert or update on public.subscriptions for each row execute function public.phase4_enforce_live_subscription_plan();
    create trigger phase4_guard_payment_evidence_provenance_trigger before update on public.payment_requests for each row execute function public.phase4_guard_payment_evidence_provenance();
  `);
  const pendingOwner = await user();
  const oldPending = await submit(pendingOwner,{plan:oldPlan,channel:oldChannel});
  const originalProof = await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[oldPending.id]);
  const scheduledBefore = await scalar('select to_jsonb(r) from public.pricing_revisions r where id=$1',[futureRevision]);
  await check('Existing Founder draft blocks publication atomically',async()=>{
    const draft=randomUUID(); await db.query('insert into public.pricing_revisions(id) values($1)',[draft]);
    await assert.rejects(exec(activation),/existing Founder pricing draft/); await db.exec('rollback');
    assert.equal(await scalar("select count(*)::int from information_schema.columns where table_name='payment_requests' and column_name='approved_activation_at'"),0);
    await db.query("update public.pricing_revisions set state='cancelled',effective_at=public.astra_test_now(),cancelled_at=public.astra_test_now() where id=$1",[draft]);
  });
  await exec(activation); await exec(evidence); await exec(invalidation);
  newPlan=await scalar('select id from public.pricing_plan_versions where revision_id=$1',[newRevision]);
  newChannel=await scalar('select id from public.pricing_payment_channel_versions where revision_id=$1',[newRevision]);
  await check('Publication preserves authored copy, QR configuration, and future schedule',async()=>{
    assert.deepEqual(await scalar('select to_jsonb(r) from public.pricing_revisions r where id=$1',[futureRevision]),scheduledBefore);
    assert.equal(await scalar('select page_config=(select page_config from public.pricing_revisions where id=$2) from public.pricing_revisions where id=$1',[oldRevision,newRevision]),true);
    const a=await scalar('select to_jsonb(p)-array[\'id\',\'revision_id\',\'duration_days\',\'entitlement_mode\',\'fixed_ends_at\',\'created_at\'] from public.pricing_plan_versions p where id=$1',[oldPlan]);
    const b=await scalar('select to_jsonb(p)-array[\'id\',\'revision_id\',\'duration_days\',\'entitlement_mode\',\'fixed_ends_at\',\'created_at\'] from public.pricing_plan_versions p where id=$1',[newPlan]);
    assert.deepEqual(a,b);
    const channels=await query('select to_jsonb(c)-array[\'id\',\'revision_id\',\'plan_version_id\',\'created_at\'] as value from public.pricing_payment_channel_versions c where id=any($1::uuid[])',[ [oldChannel,newChannel] ]);
    assert.deepEqual(channels[0].value,channels[1].value);
    const preserved=await scalar('select to_jsonb(p)-array[\'approved_activation_at\',\'approved_duration_days\',\'approved_entitlement_mode\'] from public.payment_requests p where id=$1',[oldPending.id]);
    assert.deepEqual(preserved,originalProof);
    const retry=await submit(pendingOwner,{plan:oldPlan,channel:oldChannel,hash:oldPending.proofHash});
    assert.equal(retry.replayed,true); assert.equal(retry.id,oldPending.id);
    assert.equal(retry.entitlementMode,'rolling_days'); assert.equal(retry.durationDays,30); assert.equal(retry.fixedEndsAt,null);
  });
  await check('Cloning an old revision preserves owner configuration without restoring fixed149 terms',async()=>{
    const draft=randomUUID(); await db.query('insert into public.pricing_revisions(id) values($1)',[draft]);
    await scalar('select public.phase4_clone_pricing_revision($1,$2)',[oldRevision,draft]);
    const plan=(await query('select entitlement_mode,duration_days,fixed_ends_at,name,description from public.pricing_plan_versions where revision_id=$1',[draft]))[0];
    assert.deepEqual(plan,{entitlement_mode:'rolling_days',duration_days:30,fixed_ends_at:null,name:'Owner-authored plan',description:'Owner description'});
    await db.query("update public.pricing_revisions set state='cancelled',effective_at=public.astra_test_now(),cancelled_at=public.astra_test_now() where id=$1",[draft]);
  });
  await check('Thirty days preserves elapsed time at month/year/leap/DST boundaries',async()=>{
    for(const [start,end] of [
      ['2026-09-02T05:46:00Z','2026-10-02T05:46:00Z'],
      ['2026-09-01T06:00:00Z','2026-10-01T06:00:00Z'],
      ['2027-01-31T10:15:00Z','2027-03-02T10:15:00Z'],
      ['2028-01-31T10:15:00Z','2028-03-01T10:15:00Z'],
      ['2026-12-15T23:59:59Z','2027-01-14T23:59:59Z'],
      ['2026-10-20T14:00:00Z','2026-11-19T14:00:00Z'],
    ]) {
      await db.exec("set timezone='America/New_York'");
      assert.equal(new Date(await scalar('select public.phase4_exact_payment_term_end($1,30)',[start])).toISOString(),new Date(end).toISOString());
    }
    await assert.rejects(scalar("select public.phase4_exact_payment_term_end('infinity',30)"),/finite start/);
    await db.exec("set timezone='UTC'");
  });
  await check('Proof-only writes real null evidence and exactly one 24-hour provisional window',async()=>{
    const id=await user(),p=await submit(id);
    const row=(await query('select payment_date,transaction_reference,reference_normalized,paid_at,approved_entitlement_starts_at,extract(epoch from provisional_access_expires_at-provisional_access_started_at)::int as seconds from public.payment_requests where id=$1',[p.id]))[0];
    assert.deepEqual(row,{payment_date:null,transaction_reference:null,reference_normalized:null,paid_at:null,approved_entitlement_starts_at:null,seconds:86400});
    await assert.rejects(submit(await user(),{hash:p.proofHash}),/already been submitted/);
    await assert.rejects(submit(id),/already awaiting review/);
    await review(p.id,'rejected',{payload:{verifiedPaidAt:null}});
    const fresh=await submit(id); assert.equal(fresh.provisionalAccessExpiresAt,null);
  });
  await check('Legacy evidence requirements remain enforced',async()=>{
    const id=await user(),p=await submit(id);
    await assert.rejects(db.query("insert into public.payment_requests(user_id,plan_code,trusted_amount_php,payment_method,proof_object_path,proof_original_name,proof_mime_type,proof_size_bytes,proof_sha256,request_key) values($1,'early_access_beta',149,'bpi_instapay',$2,'proof.png','image/png',100,$3,$4)",[id,`${id}/${randomUUID()}.png`,hash(),randomUUID()]),/legacy_fields_required/);
    assert.ok(p.id);
  });
  await check('149 approval anchors activation, keeps optional verified-paid evidence distinct, and replays once',async()=>{
    const key=randomUUID(); const result=await review(oldPending.id,'approved',{key,payload:{verifiedPaidAt:'2026-09-06T05:46:00Z'}});
    assert.equal(result.payment.activatedAt,'2026-09-07T06:00:00+00:00');
    assert.equal(result.payment.purchasedStartsAt,result.payment.activatedAt);
    assert.equal(result.payment.verifiedPaidAt,'2026-09-06T05:46:00+00:00');
    assert.equal(result.payment.purchasedEndsAt,'2026-10-07T06:00:00+00:00');
    assert.equal(result.payment.durationDays,30);
    await assert.rejects(db.query('update public.payment_requests set approved_duration_days=null where id=$1',[oldPending.id]),/approved_term_v1_check/);
    await assert.rejects(db.query('update public.payment_requests set approved_entitlement_mode=null where id=$1',[oldPending.id]),/approved_term_v1_check/);
    assert.equal((await review(oldPending.id,'approved',{key})).replayed,true);
    await assert.rejects(review(oldPending.id,'rejected',{key}),/conflicts with the original/);
    await assert.rejects(review(oldPending.id,'rejected'),/no longer reviewable/);
    assert.equal(await scalar('select count(*)::int from public.subscription_history where user_id=$1',[pendingOwner]),1);
  });
  await check('Needs Information and Decline persist without paid access; contradictory approval is blocked',async()=>{
    const id=await user(),p=await submit(id);
    await review(p.id,'needs_information',{payload:{verifiedPaidAt:null}});
    const result=await review(p.id,'rejected',{payload:{verifiedPaidAt:null}});
    assert.equal(result.payment.status,'rejected'); assert.ok(result.payment.provisional_access_revoked_at);
    assert.equal(await scalar('select count(*)::int from public.subscriptions where user_id=$1',[id]),0);
    assert.equal(await scalar('select count(*)::int from public.payment_request_history where payment_request_id=$1',[p.id]),3);
    assert.ok(await scalar('select proof_object_path from public.payment_requests where id=$1',[p.id]));
    await assert.rejects(review(p.id,'approved'),/no longer reviewable/);
    await assert.rejects(review(p.id,'rejected',{actor:await user()}),/Founder access required/);
  });
  await check('Renewal stacks after valid finite access and old receipts retain their own segment',async()=>{
    const p=await submit(pendingOwner); const result=await review(p.id,'approved');
    assert.equal(result.payment.purchasedStartsAt,'2026-10-07T06:00:00+00:00');
    assert.equal(result.payment.purchasedEndsAt,'2026-11-06T06:00:00+00:00');
    const receipt=await scalar('select public.phase4_subscription_receipt_context($1)',[oldPending.id]);
    assert.equal(receipt.purchasedEndsAt,'2026-10-07T06:00:00+00:00');
    assert.equal(receipt.durationDays,30); assert.equal(receipt.fixedEndsAt,null);
  });
  await check('Expired finite access cannot backdate a newly approved purchase',async()=>{
    const id=await user(),subscription=randomUUID();
    await db.query("insert into public.subscriptions(id,user_id,plan_code,status,starts_at,expires_at,source) values($1,$2,'early_access_beta','active','2026-07-01T00:00:00Z','2026-07-31T00:00:00Z','manual_payment')",[subscription,id]);
    const p=await submit(id),result=await review(p.id,'approved');
    assert.equal(result.payment.purchasedStartsAt,'2026-09-07T06:00:00+00:00');
    assert.equal(result.payment.purchasedEndsAt,'2026-10-07T06:00:00+00:00');
    assert.equal(result.payment.activatedAt,result.payment.purchasedStartsAt);
  });
  await check('Non-expiring independent access is untouched while purchased term remains exactly30 days',async()=>{
    const id=await user(); const subscription=randomUUID();
    await db.query("insert into public.subscriptions(id,user_id,plan_code,status,starts_at,source) values($1,$2,'early_access_beta','active','2026-01-01T00:00:00Z','complimentary')",[subscription,id]);
    const before=await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]);
    const p=await submit(id),result=await review(p.id,'approved');
    assert.equal(result.payment.approved_entitlement_changed,false);
    assert.equal(new Date(result.payment.purchasedEndsAt)-new Date(result.payment.purchasedStartsAt),30*86400000);
    assert.deepEqual(await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]),before);
  });
  await check('Ambiguous inactive/future non-expiring grants block approval atomically for manual resolution',async()=>{
    for(const [status,start] of [['pending_payment','2026-01-01T00:00:00Z'],['trialing','2026-01-01T00:00:00Z'],['paused','2026-01-01T00:00:00Z'],['active','2026-10-01T00:00:00Z']]) {
      const id=await user(),subscription=randomUUID();
      await db.query("insert into public.subscriptions(id,user_id,plan_code,status,starts_at,source) values($1,$2,'early_access_beta',$3,$4,'complimentary')",[subscription,id,status,start]);
      const p=await submit(id),key=randomUUID();
      const beforeSubscription=await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]);
      const beforePayment=await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[p.id]);
      await assert.rejects(review(p.id,'approved',{key}),/PAYMENT_EXISTING_ENTITLEMENT_REQUIRES_REVIEW/);
      assert.deepEqual(await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]),beforeSubscription);
      assert.deepEqual(await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[p.id]),beforePayment);
      assert.equal(await scalar('select count(*)::int from public.admin_action_requests where request_key=$1',[key]),0);
      assert.equal(await scalar('select count(*)::int from public.subscription_history where user_id=$1',[id]),0);
    }
  });
  await check('Future finite independent grants block approval without changing proof, provisional access, or grant',async()=>{
    for(const status of ['active','paused','pending_payment','trialing']) {
      const id=await user(),subscription=randomUUID();
      await db.query("insert into public.subscriptions(id,user_id,plan_code,status,starts_at,expires_at,source) values($1,$2,'early_access_beta',$3,'2026-09-20T06:00:00Z','2026-10-20T06:00:00Z','complimentary')",[subscription,id,status]);
      const p=await submit(id),key=randomUUID();
      const beforeSubscription=await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]);
      const beforePayment=await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[p.id]);
      const beforePaymentHistory=await scalar('select jsonb_agg(to_jsonb(h) order by h.id) from public.payment_request_history h where payment_request_id=$1',[p.id]);
      await assert.rejects(review(p.id,'approved',{key}),/PAYMENT_EXISTING_ENTITLEMENT_REQUIRES_REVIEW/);
      assert.deepEqual(await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]),beforeSubscription);
      assert.deepEqual(await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[p.id]),beforePayment);
      assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(h) order by h.id) from public.payment_request_history h where payment_request_id=$1',[p.id]),beforePaymentHistory);
      assert.equal(await scalar('select count(*)::int from public.admin_action_requests where request_key=$1',[key]),0);
      assert.equal(await scalar('select count(*)::int from public.subscription_history where user_id=$1',[id]),0);
      // A repeated blocked request also cannot turn the pending proof into an approval.
      await assert.rejects(review(p.id,'approved',{key}),/PAYMENT_EXISTING_ENTITLEMENT_REQUIRES_REVIEW/);
      assert.deepEqual(await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[p.id]),beforePayment);
    }
  });
  await check('Approved-proof invalidation is idempotent and preserves proof, purchased metadata, and sent receipt',async()=>{
    const id=await user(),p=await submit(id);await review(p.id,'approved');
    await db.query("update public.payment_requests set subscriber_receipt_status='sent' where id=$1",[p.id]);
    const evidenceBefore=await scalar('select jsonb_build_array(proof_object_path,proof_sha256,approved_activation_at,approved_entitlement_starts_at,approved_entitlement_ends_at) from public.payment_requests where id=$1',[p.id]);
    const key=randomUUID(),result=await invalidate(p.id,{key});
    assert.equal(result.payment.status,'rejected');assert.equal(result.subscription.source,'invalidated_payment');
    assert.equal(result.subscription.status,'cancelled');assert.equal(result.subscriberReceipt.status,'sent');
    assert.equal(result.access.tokensRemaining,7);assert.equal(result.proofPreserved,true);
    assert.deepEqual(await scalar('select jsonb_build_array(proof_object_path,proof_sha256,approved_activation_at,approved_entitlement_starts_at,approved_entitlement_ends_at) from public.payment_requests where id=$1',[p.id]),evidenceBefore);
    assert.equal((await invalidate(p.id,{key})).replayed,true);
    await assert.rejects(invalidate(p.id),/Only an approved payment/);
    await assert.rejects(db.query("update public.subscriptions set status='active' where id=$1",[result.subscription.id]),/invalidated_payment_cancelled_check/);
    assert.equal(await scalar("select count(*)::int from public.payment_request_history where payment_request_id=$1 and previous_status='approved' and new_status='rejected'",[p.id]),1);
  });
  await check('Renewal invalidation unwinds newest first and refuses an ancestor while later paid access remains',async()=>{
    const id=await user(),first=await submit(id);await review(first.id,'approved');
    const original=await scalar('select to_jsonb(s) from public.subscriptions s where user_id=$1',[id]);
    const second=await submit(id);await review(second.id,'approved');
    await assert.rejects(invalidate(first.id),/Another approved payment/);
    const reverted=await invalidate(second.id);assert.equal(reverted.priorAccessRestored,true);
    assert.equal(reverted.subscription.expires_at,original.expires_at);
    assert.equal((await invalidate(first.id)).accessReversed,true);
  });
  await check('Invalidation preserves independent unlimited access and blocks refund, sending receipt, or later changes',async()=>{
    const id=await user(),subscription=randomUUID();
    await db.query("insert into public.subscriptions(id,user_id,plan_code,status,starts_at,source) values($1,$2,'early_access_beta','active','2026-01-01T00:00:00Z','complimentary')",[subscription,id]);
    const original=await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]);
    const p=await submit(id);await review(p.id,'approved');assert.equal((await invalidate(p.id)).accessReversed,false);
    assert.deepEqual(await scalar('select to_jsonb(s) from public.subscriptions s where id=$1',[subscription]),original);
    for(const kind of ['sending','refund','changed']) {
      const owner=await user(),payment=await submit(owner);await review(payment.id,'approved');
      if(kind==='sending') await db.query("update public.payment_requests set subscriber_receipt_status='sending' where id=$1",[payment.id]);
      if(kind==='refund') await db.query("insert into public.refund_requests(user_id,payment_request_id,reason,paid_amount_php,suggested_refund_php,calculation_note,request_key) values($1,$2,'Controlled pending refund',149,149,'Fixture', $3)",[owner,payment.id,randomUUID()]);
      if(kind==='changed') await db.query("update public.subscriptions set reason='Independent later change',version=version+1 where user_id=$1",[owner]);
      const before=await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[payment.id]);
      await assert.rejects(invalidate(payment.id),kind==='sending'?/currently being delivered/:kind==='refund'?/active refund workflow/:/changed after approval/);
      assert.deepEqual(await scalar('select to_jsonb(p) from public.payment_requests p where id=$1',[payment.id]),before);
      await assert.rejects(invalidate(payment.id,{actor:await user()}),/Founder access required/);
    }
  });
  await check('Cutover preserves accepted149 replay/approval and applies199 only at the boundary',async()=>{
    await setTime('2026-09-13T15:59:59Z');
    const id=await user(),accepted=await submit(id);
    await assert.rejects(submit(await user(),{plan:futurePlan,channel:futureChannel}),/not open for checkout/);
    await setTime('2026-09-13T16:00:00Z');
    const replay=await submit(id,{hash:accepted.proofHash}); assert.equal(replay.id,accepted.id); assert.equal(replay.replayed,true);
    await assert.rejects(submit(await user()),/not open for checkout/);
    const laterApproval=await review(accepted.id,'approved'); assert.equal(laterApproval.payment.trusted_amount_centavos,14900);
    const future=await submit(await user(),{plan:futurePlan,channel:futureChannel});
    const result=await review(future.id,'approved');
    assert.equal(result.payment.trusted_amount_centavos,19900); assert.equal(result.payment.purchasedStartsAt,'2026-09-13T16:00:00+00:00');
    assert.equal(result.payment.purchasedEndsAt,'2026-10-13T16:00:00+00:00');
  });
  await check('Billing, verifier, admin, and receipt projections agree on stored purchased term',async()=>{
    const billing=await scalar('select public.phase4_student_billing_snapshot($1)',[pendingOwner]);
    const payment=billing.payments.find(p=>p.id===oldPending.id);
    for(const name of ['phase4_payment_notification_context','phase4_subscription_receipt_context']) {
      const row=await scalar(`select public.${name}($1)`,[oldPending.id]);
      for(const key of ['durationDays','entitlementMode','purchasedStartsAt','purchasedEndsAt','fixedEndsAt','activatedAt']) assert.deepEqual(row[key],payment[key],`${name}.${key}`);
    }
    const admin=await scalar("select public.phase4_admin_operational_data_scoped_v2($1,'payments','',50,0,'all')",[actor]);
    assert.equal(admin.items.find(p=>p.id===oldPending.id).purchasedEndsAt,payment.purchasedEndsAt);
  });
  await check('Migration reruns preserve accepted payments, subscription terms, and future pricing',async()=>{
    const before=await scalar('select jsonb_agg(to_jsonb(p) order by id) from public.payment_requests p');
    const subscriptions=await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.subscriptions s');
    await exec(activation); await exec(evidence); await exec(invalidation);
    assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(p) order by id) from public.payment_requests p'),before);
    assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.subscriptions s'),subscriptions);
    assert.deepEqual(await scalar('select to_jsonb(r) from public.pricing_revisions r where id=$1',[futureRevision]),scheduledBefore);
    for(const signature of ['phase4_admin_review_payment(uuid,uuid,jsonb,text,text)','phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)','phase4_admin_invalidate_payment(uuid,uuid,text,text)']) {
      assert.equal(await scalar('select has_function_privilege(\'anon\',$1,\'execute\')',[signature]),false);
      assert.equal(await scalar('select has_function_privilege(\'authenticated\',$1,\'execute\')',[signature]),false);
    }
  });
  console.log(JSON.stringify({passed:checks.length,engine:'PGlite PostgreSQL',mocked:['clock','founder identity fixture','notification sinks','base admin listing','forbidden-key predicate','post-invalidation access snapshot'],remoteWrites:false}));
} catch (error) {
  console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,detail:error.detail,stack:error.code?undefined:error.stack}));
  process.exitCode=1;
} finally { await db.close(); }
