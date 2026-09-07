import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';

// Reuses the actual SQL lifecycle's disposable PostgreSQL fixture, never a
// remote project or customer snapshot. The template is operator-only SQL.
const fixtureUrl=new URL('./test-astra-payment-lifecycle.mjs',import.meta.url);
const template=readFileSync(new URL('./astra-payment-cohort-repair.template.sql',import.meta.url),'utf8');
const journalDdl=readFileSync(new URL('../supabase/migrations/20260907071547_astra_payment_term_repair_journal.sql',import.meta.url),'utf8');
assert.equal(/\b(?:create|alter|drop|grant|revoke|comment on)\s+(?:table|function|index|schema|all|select)/i.test(template),false,'Private operator script has no DDL');
const marker="  await check('Cutover preserves accepted149 replay/approval and applies199 only at the boundary',async()=>{";
let fixture=readFileSync(fixtureUrl,'utf8');
assert.equal(fixture.split(marker).length,2,'Unambiguous local fixture hook');
fixture=fixture.replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
fixture=fixture.replace(marker,'  await globalThis.astraCohortRegression({db,query,scalar,actor,user,oldPlan,oldRevision,originalProof});\n'+marker);
globalThis.astraCohortRegression=async({db,query,scalar,actor,user,oldPlan,oldRevision,originalProof})=>{
  const ids=[];
  const anchors=['2026-09-01T06:31:48.773453Z','2026-09-01T09:02:34.254816Z',
    '2026-09-02T05:48:28.789758Z','2026-09-02T18:09:45.395825Z',
    '2026-09-04T00:16:18.685141Z','2026-09-05T16:50:42.117205Z'];
  const columns=(await query("select attname from pg_attribute where attrelid='public.payment_requests'::regclass and attnum>0 and not attisdropped and attgenerated='' order by attnum")).map(x=>x.attname);
  assert.ok(columns.every(x=>/^[a-z_][a-z_0-9]*$/.test(x)));
  for(const anchor of anchors){
    const id=await user(),subscription=randomUUID(),payment=randomUUID(),key=randomUUID();ids.push(payment);
    await db.query(`insert into public.subscriptions(id,user_id,plan_code,status,starts_at,expires_at,source,
      pricing_revision_id,pricing_plan_version_id,entitlement_mode,created_by,updated_by)
      values($1,$2,'early_access_beta','active',$3::timestamptz-interval '2 minutes','2026-10-01T15:59:59Z','manual_payment',$4,$5,'fixed_end',$6,$6)`,[subscription,id,anchor,oldRevision,oldPlan,actor]);
    const starts=await scalar('select starts_at::text from public.subscriptions where id=$1',[subscription]);
    const p={...originalProof,id:payment,user_id:id,subscription_id:subscription,status:'approved',version:2,
      reviewed_at:anchor,reviewed_by:actor,review_reason:'Original local approval fixture',submitted_at:starts,
      provisional_access_started_at:starts,approved_entitlement_starts_at:starts,approved_entitlement_ends_at:'2026-10-01T15:59:59Z',
      approved_entitlement_changed:true,approved_prior_expires_at:null,approved_prior_subscription_state:null,
      proof_object_path:`${id}/${randomUUID()}.png`,proof_sha256:payment.replaceAll('-','').repeat(2),request_key:key,
      subscriber_receipt_status:'sent',subscriber_receipt_attempts:1,
      transaction_reference:payment.replaceAll('-',''),paid_at:null,paid_at_verified_by:null,paid_at_verified_at:null,paid_at_verification_source:null};
    await db.query(`insert into public.payment_requests(${columns.join(',')}) select ${columns.map(x=>'p.'+x).join(',')} from jsonb_populate_record(null::public.payment_requests,$1::jsonb) p`,[p]);
    await db.query(`insert into public.payment_request_history(payment_request_id,actor_user_id,action,previous_status,new_status,reason,request_key)
      values($1,$2,'approved','pending','approved','Original local approval fixture',$3)`,[payment,actor,key+'_payment']);
    await db.query(`insert into public.subscription_history(subscription_id,user_id,actor_user_id,action,previous_state,new_state,reason,request_key)
      select id,user_id,$2,'activate','{}',to_jsonb(s),'Original local approval fixture',$3 from public.subscriptions s where id=$1`,[subscription,actor,key+'_subscription']);
  }
  const rows=await query(`select p.id payment_id,p.user_id,p.subscription_id,to_jsonb(p) payment_before,to_jsonb(s) subscription_before,
    p.reviewed_at::text original_activation_anchor,(p.reviewed_at+interval '720 hours')::text corrected_purchased_end,
    case when s.expires_at>p.reviewed_at+interval '720 hours' then 'preserve_longer' else 'extend' end proposed_direction,
    (select jsonb_agg(to_jsonb(h) order by h.id) from public.payment_request_history h where h.payment_request_id=p.id and h.action='approved') approval_payment_history,
    (select jsonb_agg(to_jsonb(h) order by h.id) from public.subscription_history h where h.subscription_id=s.id) approval_subscription_history,
    (select jsonb_agg(to_jsonb(h) order by h.id) from public.subscription_history h where h.subscription_id=s.id) complete_subscription_history
    from public.payment_requests p join public.subscriptions s on s.id=p.subscription_id where p.id=any($1::uuid[])`,[ids]);
  const snapshot={snapshotTime:'2026-09-07T06:00:00Z',readOnly:true,rows};
  const snapshotText=JSON.stringify(snapshot),snapshotHash=createHash('sha256').update(snapshotText).digest('hex');
  const sql=template.replace('__ASTRA_COHORT_SNAPSHOT_JSON__',snapshotText).replace('__ASTRA_COHORT_SNAPSHOT_SHA256__',snapshotHash);
  const commitSql=sql.replace(/ROLLBACK;\s*$/,'COMMIT;');
  const before=await scalar('select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_requests p where id=any($1::uuid[])',[ids]);
  await assert.rejects(db.exec(sql),/ASTRA_REPAIR_JOURNAL_MIGRATION_REQUIRED/);await db.exec('rollback');
  await db.exec(journalDdl);
  await db.exec('alter table public.payment_term_repair_journal disable row level security');
  await assert.rejects(db.exec(sql),/ASTRA_REPAIR_JOURNAL_SCHEMA_OR_ACCESS_CHANGED/);await db.exec('rollback');
  await db.exec('alter table public.payment_term_repair_journal enable row level security');
  await db.exec('grant select on public.payment_term_repair_journal to anon');
  await assert.rejects(db.exec(sql),/ASTRA_REPAIR_JOURNAL_SCHEMA_OR_ACCESS_CHANGED/);await db.exec('rollback');
  await db.exec('revoke select on public.payment_term_repair_journal from anon');
  await assert.rejects(db.exec(sql),/ASTRA_REPAIR_ACTOR_REQUIRED/); await db.exec('rollback');
  await db.query("select set_config('astra.payment_repair_actor',$1,false)",[actor]);
  await assert.rejects(db.exec(sql.replace(snapshotHash,'e'.repeat(64))),/ASTRA_REPAIR_FROZEN_SCOPE_INVALID/);await db.exec('rollback');
  await db.exec(sql);
  assert.equal(await scalar('select count(*)::int from public.payment_term_repair_journal'),0,'Dry run leaves preinstalled journal empty');
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_requests p where id=any($1::uuid[])',[ids]),before);
  console.log('PASS Cohort dry run rolls back all six rows and leaves installed journal empty; migration and actor required');
  console.log('PASS Private DML preflight refuses disabled journal RLS and exposed ACL');
  // Modify a late-sorted row so earlier loop updates must also roll back.
  const last=ids.toSorted().at(-1);
  await db.query("update public.payment_requests set review_reason='Changed after the frozen snapshot' where id=$1",[last]);
  await assert.rejects(db.exec(commitSql),/ASTRA_REPAIR_FROZEN_STATE_CHANGED/);await db.exec('rollback');
  assert.equal(await scalar('select count(*)::int from public.payment_term_repair_journal'),0);
  await db.query('update public.payment_requests set review_reason=$2 where id=$1',[last,rows.find(x=>x.payment_id===last).payment_before.review_reason]);
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_requests p where id=any($1::uuid[])',[ids]),before);
  console.log('PASS Changed sixth frozen record rolls back the entire cohort');
  const refundId=randomUUID(),first=rows[0];
  await db.query(`insert into public.refund_requests(id,user_id,payment_request_id,subscription_id,reason,paid_amount_php,suggested_refund_php,calculation_note,request_key)
    values($1,$2,$3,$4,'New independent refund request',149,149,'Local refund fixture', $5)`,[refundId,first.user_id,first.payment_id,first.subscription_id,randomUUID()]);
  await assert.rejects(db.exec(commitSql),/ASTRA_REPAIR_OTHER_ENTITLEMENT_OR_REFUND/);await db.exec('rollback');
  await db.query("update public.refund_requests set status='rejected' where id=$1",[refundId]);
  const peerId=randomUUID(),peer={...first.payment_before,id:peerId,request_key:randomUUID(),provisional_access_started_at:null,
    provisional_access_expires_at:null,proof_object_path:`${first.user_id}/${randomUUID()}.png`,
    proof_sha256:peerId.replaceAll('-','').repeat(2),transaction_reference:peerId.replaceAll('-','')};
  await db.query(`insert into public.payment_requests(${columns.join(',')}) select ${columns.map(x=>'p.'+x).join(',')} from jsonb_populate_record(null::public.payment_requests,$1::jsonb) p`,[peer]);
  await assert.rejects(db.exec(commitSql),/ASTRA_REPAIR_OTHER_ENTITLEMENT_OR_REFUND/);await db.exec('rollback');
  await db.query("update public.payment_requests set status='rejected' where id=$1",[peerId]);
  console.log('PASS Snapshot hash mismatch, new active refund, and approved peer all fail closed');
  await db.exec(commitSql);
  const journal=await query('select * from public.payment_term_repair_journal order by payment_request_id');
  assert.equal(journal.length,6);assert.equal(journal.filter(x=>x.direction==='extend').length,4);assert.equal(journal.filter(x=>x.direction==='preserve_longer').length,2);
  for(const j of journal){
    assert.equal(j.before_state.payment.paid_at,null);assert.equal(j.after_state.payment.paid_at,null);
    assert.equal(j.after_state.payment.subscriber_receipt_status,'sent');assert.equal(j.after_state.payment.subscriber_receipt_attempts,1);
    assert.equal(j.before_state.subscription.starts_at,j.after_state.subscription.starts_at);
    assert.equal(j.after_state.payment.approved_activation_at,j.before_state.payment.reviewed_at);
    assert.equal(j.after_state.approvalPaymentHistory.length,1);assert.equal(j.after_state.subscriptionHistory.length,2);
    assert.equal(j.before_state.payment.pricing_plan_version_id,j.after_state.payment.pricing_plan_version_id);
    assert.equal(j.after_state.subscription.entitlement_mode,'rolling_days');assert.equal(j.after_state.subscription.term_duration_days,30);
  }
  assert.equal(await scalar('select count(*)::int from public.payment_requests where id=any($1::uuid[]) and extract(epoch from approved_entitlement_ends_at-approved_entitlement_starts_at)=2592000',[ids]),6);
  assert.equal(await scalar("select count(*)::int from public.payment_requests where id=any($1::uuid[]) and to_char(approved_activation_at,'US') not like '%000'",[ids]),6,'All original microseconds survive');
  const fullAfter=await scalar('select jsonb_agg(to_jsonb(j) order by payment_request_id) from public.payment_term_repair_journal j');
  await db.exec(commitSql);
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(j) order by payment_request_id) from public.payment_term_repair_journal j'),fullAfter);
  console.log('PASS Exactly4 extensions+2preserves, microseconds, proof/offer/receipts preserved, no-op replay');
  await db.query("update public.subscriptions set reason='Later independent admin action' where id=$1",[journal[0].subscription_id]);
  await assert.rejects(db.exec(commitSql),/ASTRA_REPAIR_REPLAY_STATE_CHANGED/);await db.exec('rollback');
  console.log('PASS Replay refuses later independent subscription change');
  for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_table_privilege($1,'public.payment_term_repair_journal','select,insert,update,delete')",[role]),false);
  assert.equal(await scalar("select has_table_privilege('service_role','public.payment_term_repair_journal','update,delete')"),false);
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.payment_term_repair_journal'::regclass"),true);
  assert.equal(await scalar("select count(*)::int from pg_policy where polrelid='public.payment_term_repair_journal'::regclass"),0);
  console.log('PASS Journal RLS enabled, no public policies or anonymous/authenticated privileges');
};
try{await import('data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'));}
catch(error){console.error(error.message);process.exitCode=1;}
finally{delete globalThis.astraCohortRegression;}
