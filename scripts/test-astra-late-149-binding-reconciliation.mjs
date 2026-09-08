import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Actual SQL, disposable local PostgreSQL WASM only. The external bridge is
// byte-pinned, not copied into or used to change applied migrations in this tree.
const integratedBridge = new URL('../supabase/migrations/20260907133129_astra_149_binding_compatibility.sql', import.meta.url);
const bridgePath = resolve(process.env.ASTRA_149_BRIDGE_SQL || fileURLToPath(existsSync(integratedBridge) ? integratedBridge : new URL(
  '../../Bar-Exam-simulator-astra-recovery-20260907/supabase/migrations/20260907133129_astra_149_binding_compatibility.sql', import.meta.url)));
const bridgeBytes = readFileSync(bridgePath);
assert.equal(createHash('sha256').update(bridgeBytes).digest('hex'), 'd69796d6178377b37929408496692b1f654bf8c26cc98c673e9198944a365d97');
assert.equal(bridgeBytes.includes(13), false, 'Transport the reviewed LF bytes without hidden normalization');
const migrationNames = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter((name) => name.endsWith('_astra_late_149_binding_reconciliation.sql'));
assert.equal(migrationNames.length, 1);
const reconciliation = readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), 'utf8');
assert.equal(reconciliation.includes('\r'), false);
const fixtureUrl = new URL('./test-astra-payment-lifecycle.mjs', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8').replaceAll('\r\n', '\n');
const boundary = "  await check('Existing Founder draft blocks publication atomically'";
assert.equal(fixture.split(boundary).length, 2);
const prefix = fixture.split(boundary)[0].replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
for (const [order, temporal] of ['bridge_then_late', 'late_then_bridge'].flatMap((order) => [[order, false], [order, true]])) {
  const code = prefix + '\nconst ORDER=' + JSON.stringify(order)
    + ';const TEMPORAL=' + JSON.stringify(temporal)
    + ';const BRIDGE_SQL=' + JSON.stringify(bridgeBytes.toString('utf8'))
    + ';const RECONCILIATION=' + JSON.stringify(reconciliation)
    + ';const temporalCases=(' + temporalCases.toString() + ')'
    + ';\nawait (' + runCases.toString() + ')();\n} finally { await db.close(); }';
  try { await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')); }
  catch (error) { console.error(JSON.stringify({ order, message: error.message, code: error.code, where: error.where, detail: error.detail })); process.exitCode = 1; break; }
}

async function runCases() {
  let secondSourcePlan;
  if (TEMPORAL) {
    // Expand only this disposable authored source fixture BEFORE publication.
    // The actual activation/clone SQL below copies the extra plan and channel.
    await db.exec('alter table public.pricing_plan_versions disable trigger user; alter table public.pricing_payment_channel_versions disable trigger user');
    try {
      secondSourcePlan = await scalar(`insert into public.pricing_plan_versions(
        revision_id,plan_code,name,price_centavos,duration_days,entitlement_mode,checkout_enabled,
        display_starts_at,display_ends_at,checkout_starts_at,checkout_ends_at)
        values($1,'bar_access_30d','Future second plan',19900,30,'rolling_days',true,
          '2026-09-09T06:00:00Z','2026-09-12T06:00:00Z','2026-09-10T06:00:00Z','2026-09-11T06:00:00Z') returning id`, [oldRevision]);
      await db.query(`insert into public.pricing_payment_channel_versions(revision_id,plan_version_id,
        channel_code,label,qr_public_path,amount_centavos) values($1,$2,'bpi_instapay','Future second channel',
          '/assets/payments/bpi-instapay-199-qr.png',19900)`, [oldRevision, secondSourcePlan]);
    } finally {
      await db.exec('alter table public.pricing_plan_versions enable trigger user; alter table public.pricing_payment_channel_versions enable trigger user');
    }
  }
  await exec(activation); await exec(evidence); await exec(invalidation);
  await exec(functionSql(pricing, 'phase4_pricing_snapshot'));
  if (ORDER === 'bridge_then_late') { await exec(BRIDGE_SQL); await exec(lateProof); }
  else { await exec(lateProof); await exec(BRIDGE_SQL); }
  paymentRpc = 'phase4_create_payment_request_v4';
  newPlan = await scalar("select id from public.pricing_plan_versions where revision_id=$1 and plan_code='early_access_beta'", [newRevision]);
  newChannel = await scalar('select id from public.pricing_payment_channel_versions where revision_id=$1 and plan_version_id=$2', [newRevision, newPlan]);
  await exec(functionSql(read('20260902093000_fix_unlimited_forecast_entitlement_readonly.sql'), 'dd2026_bar_forecast_access_allowed'));
  await exec(read('20260907130000_astra_simulator_access.sql').match(/create or replace function private\.astra_simulator_entitlement[\s\S]+?\$function\$;/)[0]);
  if (TEMPORAL) { await exec(RECONCILIATION); await temporalCases(secondSourcePlan); return; }
  const windowForSource = () => scalar('select public.phase4_payment_offer_window($1,$2,public.astra_test_now())', [oldPlan, oldChannel]);
  const paymentRow = (id) => scalar('select to_jsonb(p) from public.payment_requests p where id=$1', [id]);
  const immutableRows = () => scalar(`select jsonb_build_object(
    'revisions',(select jsonb_agg(to_jsonb(r) order by id) from public.pricing_revisions r),
    'plans',(select jsonb_agg(to_jsonb(p) order by id) from public.pricing_plan_versions p),
    'channels',(select jsonb_agg(to_jsonb(c) order by id) from public.pricing_payment_channel_versions c),
    'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payment_requests p),
    'history',(select jsonb_agg(to_jsonb(h) order by id) from public.payment_request_history h))`);
  const untouchedSignatures = [
    'public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)',
    'public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)',
    'public.phase4_admin_review_payment(uuid,uuid,jsonb,text,text)',
    'public.phase4_admin_invalidate_payment(uuid,uuid,text,text)',
    'public.phase4_pricing_snapshot()',
  ];
  const untouchedDefinitions = await Promise.all(untouchedSignatures.map((s) => scalar('select pg_get_functiondef($1::regprocedure)', [s])));
  await setTime('2026-09-10T06:00:00Z');
  const priorHold = await submit(await user(), { plan: oldPlan, channel: oldChannel });
  assert.equal(priorHold.status, 'needs_information', 'Reproduce the unreconciled installation-order bug');
  const priorCapture = await immutableRows();
  await exec(RECONCILIATION);
  await check('Forward reconciliation changes no pricing, payment or submission-history rows', async () => {
    assert.deepEqual(await immutableRows(), priorCapture);
    for (let i = 0; i < untouchedSignatures.length; i += 1) {
      assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)', [untouchedSignatures[i]]), untouchedDefinitions[i]);
    }
  });
  const beforeCutoff = [];
  await check('Both installation orders admit first source proof before cutoff with immutable IDs and durable effective lineage', async () => {
    const offer = await windowForSource();
    assert.equal(offer.late, false);
    assert.equal(Date.parse(offer.validUntil), Date.parse('2026-09-13T16:00:00Z'));
    assert.equal(offer.bindingCompatibility.sourceRevisionId, oldRevision);
    assert.equal(offer.bindingCompatibility.effectiveTermsRevisionId, newRevision);
    for (const rpc of ['phase4_create_payment_request_v3', 'phase4_create_payment_request_v4']) {
      const accepted = await submit(await user(), { plan: oldPlan, channel: oldChannel, rpc });
      beforeCutoff.push(accepted);
      assert.equal(accepted.status, 'pending'); assert.ok(accepted.provisionalAccessExpiresAt);
      assert.equal(accepted.entitlementMode, 'rolling_days'); assert.equal(accepted.durationDays, 30);
      const row = await paymentRow(accepted.id);
      assert.equal(row.pricing_revision_id, oldRevision); assert.equal(row.pricing_plan_version_id, oldPlan);
      assert.equal(row.pricing_payment_channel_version_id, oldChannel); assert.equal(row.trusted_entitlement_mode, 'fixed_end');
      assert.equal(row.payment_date, null); assert.equal(row.transaction_reference, null); assert.equal(row.paid_at, null);
      const lineage = await scalar("select metadata->'bindingCompatibility' from public.payment_request_history where payment_request_id=$1 and action='submitted'", [accepted.id]);
      assert.equal(lineage.sourcePlanVersionId, oldPlan); assert.equal(lineage.activationHours, 720);
      assert.equal(lineage.effectivePlanVersionId, newPlan);
    }
    const owner = await user();
    const v2 = await scalar('select public.phase4_create_payment_request_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [owner, oldPlan, oldChannel, '2026-09-10', 'INTERNAL-FIXTURE-LEGACY', 'payment-proofs', `${owner}/${randomUUID()}.png`, 'image/png', 1200, hash()]);
    assert.equal(v2.status, 'pending'); assert.equal(v2.durationDays, 30);
    assert.equal((await paymentRow(v2.id)).transaction_reference, 'INTERNAL-FIXTURE-LEGACY');
    assert.equal((await paymentRow(v2.id)).paid_at, null);
  });
  await check('Public STABLE snapshot retains source IDs and clone captures remain independently accepted', async () => {
    const snapshot = await scalar('select public.phase4_pricing_snapshot()');
    assert.equal(snapshot.revisionId, oldRevision); assert.equal(snapshot.plans[0].versionId, oldPlan);
    assert.equal(snapshot.paymentMethods[0].versionId, oldChannel); assert.equal(snapshot.plans[0].durationDays, 30);
    const clone = await submit(await user());
    assert.equal(clone.pricingRevisionId, newRevision); assert.equal(clone.status, 'pending');
    for (const [plan, channel] of [[oldPlan, newChannel], [newPlan, oldChannel], [oldPlan, futureChannel], [futurePlan, futureChannel]]) {
      await assert.rejects(submit(await user(), { plan, channel }), /not open/);
    }
  });
  await check('Previously held proof is not automatically reclassified or granted access; changed captured window stays review-only', async () => {
    const row = await paymentRow(priorHold.id);
    const replay = await submit(row.user_id, { plan: oldPlan, channel: oldChannel, hash: priorHold.proofHash });
    assert.equal(replay.id, priorHold.id); assert.equal(replay.status, 'needs_information');
    assert.equal(replay.provisionalAccessExpiresAt, null);
    await assert.rejects(review(priorHold.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: '2026-09-06T06:00:00Z' } }), /Historical offer evidence changed/);
    assert.deepEqual(await paymentRow(priorHold.id), row);
  });
  await check('At cutoff v4 retains first source proof without access while v3 remains current-only and public price is 199', async () => {
    await setTime('2026-09-13T15:59:59.999999Z'); assert.equal((await windowForSource()).late, false);
    await setTime('2026-09-13T16:00:00Z'); assert.equal((await windowForSource()).late, true);
    assert.equal((await scalar('select public.phase4_pricing_snapshot()')).revisionId, futureRevision);
    await assert.rejects(submit(await user(), { plan: oldPlan, channel: oldChannel, rpc: 'phase4_create_payment_request_v3' }), /not open/);
    assert.equal((await submit(await user(), { plan: futurePlan, channel: futureChannel })).amountCentavos, 19900);
  });
  await setTime('2026-09-15T06:00:00Z');
  const heldOwner = await user();
  const held = await submit(heldOwner, { plan: oldPlan, channel: oldChannel });
  await check('Postcutoff source hold captures the genuine bridge interval and grants neither provisional nor paid access', async () => {
    assert.equal(held.status, 'needs_information'); assert.equal(held.offerReviewRequired, true);
    assert.equal(Date.parse(held.offerValidUntil), Date.parse('2026-09-13T16:00:00Z'));
    const row = await paymentRow(held.id);
    for (const field of ['paid_at', 'payment_date', 'transaction_reference', 'provisional_access_started_at', 'provisional_access_expires_at', 'approved_activation_at', 'subscription_id']) assert.equal(row[field], null);
    assert.equal(await scalar("select private.astra_simulator_entitlement($1)->>'allowed'", [heldOwner]), 'false');
    assert.equal(await scalar('select public.dd2026_bar_forecast_access_allowed($1)', [heldOwner]), false);
    assert.equal(row.proof_object_path, held.proofPath); assert.equal(row.pricing_plan_version_id, oldPlan);
  });
  await check('Explicit authorized disposition and actual in-window verifiedPaidAt are mandatory and failures do not mutate', async () => {
    const before = await paymentRow(held.id);
    await assert.rejects(review(held.id, 'approved', { actor: heldOwner }), /Founder access required/);
    await assert.rejects(review(held.id, 'approved'), /explicit verified disposition/);
    await assert.rejects(review(held.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer' } }), /requires verifiedPaidAt/);
    for (const verifiedPaidAt of ['2026-08-30T23:59:59Z', '2026-09-13T16:00:00Z', '2026-09-14T06:00:00Z', '2026-09-16T06:00:00Z']) {
      await assert.rejects(review(held.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt } }), /historical offer window|cannot be in the future|cannot precede/);
    }
    assert.deepEqual(await paymentRow(held.id), before);
  });
  await check('Held hash cannot cross v2/v3/v4, channel, evidence-mode or owner boundaries', async () => {
    for (const owner of [heldOwner, await user()]) {
      for (const rpc of ['phase4_create_payment_request_v3', 'phase4_create_payment_request_v4']) {
        await assert.rejects(submit(owner, { plan: futurePlan, channel: futureChannel, hash: held.proofHash, rpc }), /already been submitted|SAVED_FOR_REVIEW/);
      }
      await assert.rejects(scalar('select public.phase4_create_payment_request_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [owner, futurePlan, futureChannel, '2026-09-15', randomUUID(), 'payment-proofs', `${owner}/${randomUUID()}.png`, 'image/png', 1200, held.proofHash]), /SAVED_FOR_REVIEW/);
    }
    await assert.rejects(submit(heldOwner, { plan: oldPlan, channel: oldChannel, hash: held.proofHash, rpc: 'phase4_create_payment_request_v3' }), /SAVED_FOR_REVIEW/);
  });
  await check('Verified September 13 source payment can be honored after cutoff for exact 720 hours with replay protection', async () => {
    const key = randomUUID(), payload = { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: '2026-09-13T06:00:00Z' };
    await review(held.id, 'approved', { key, payload });
    const row = await paymentRow(held.id);
    assert.equal(row.status, 'approved'); assert.equal(row.trusted_entitlement_mode, 'fixed_end');
    assert.equal(row.pricing_plan_version_id, oldPlan); assert.equal(row.trusted_amount_centavos, 14900);
    assert.equal(Date.parse(row.paid_at), Date.parse(payload.verifiedPaidAt));
    assert.equal(Date.parse(row.approved_activation_at), Date.parse('2026-09-15T06:00:00Z'));
    assert.equal(Date.parse(row.approved_entitlement_ends_at) - Date.parse(row.approved_entitlement_starts_at), 720 * 3600000);
    assert.equal(row.payment_date, null); assert.equal(row.transaction_reference, null);
    assert.equal((await review(held.id, 'approved', { key, payload })).replayed, true);
    await assert.rejects(review(held.id, 'approved', { key, payload: { ...payload, verifiedPaidAt: '2026-09-13T07:00:00Z' } }), /original payment decision/);
    for (const accepted of beforeCutoff) {
      await review(accepted.id, 'approved');
      const acceptedRow = await paymentRow(accepted.id);
      assert.equal(acceptedRow.paid_at, null);
      assert.equal(Date.parse(acceptedRow.approved_entitlement_ends_at) - Date.parse(acceptedRow.approved_entitlement_starts_at), 720 * 3600000);
    }
  });
  const negative = async (label, sql, args = [], unbridgedEnd = '2026-09-07T06:00:00Z') => check(label, async () => {
    await db.exec('begin');
    try {
      await db.exec('alter table public.pricing_revisions disable trigger user; alter table public.pricing_plan_versions disable trigger user; alter table public.pricing_payment_channel_versions disable trigger user');
      await db.query(sql, args);
      const offer = await windowForSource();
      assert.ok(!offer || !offer.bindingCompatibility);
      if (offer) assert.equal(Date.parse(offer.validUntil), Date.parse(unbridgedEnd));
    } finally { await db.exec('rollback'); }
  });
  for (const [field, value] of [['qr_public_path', '/assets/payments/different.png'], ['account_name', 'Different beneficiary'], ['plan_version_id', null]]) {
    await negative(`Changed clone ${field} cannot extend an old offer`, `update public.pricing_payment_channel_versions set ${field}=$1 where id=$2`, [value, newChannel]);
  }
  await negative('Unrelated same-price ancestor cannot use the bridge', 'update public.pricing_revisions set based_on_revision_id=null where id=$1', [newRevision]);
  await negative('Cancelled original source establishes no review window', "update public.pricing_revisions set state='cancelled',cancelled_at=public.astra_test_now() where id=$1", [oldRevision]);
  await negative('Cancelled internal clone cannot establish a compatibility interval', "update public.pricing_revisions set state='cancelled',cancelled_at=public.astra_test_now() where id=$1", [newRevision], '2026-09-13T16:00:00Z');
  await check('Published source/clone content and state cannot be rewritten through normal table operations', async () => {
    const before = await immutableRows();
    await assert.rejects(db.query("update public.pricing_payment_channel_versions set account_name='Changed' where id=$1", [newChannel]), /content is immutable/);
    await assert.rejects(db.query("update public.pricing_revisions set state='cancelled',cancelled_at=public.astra_test_now() where id=$1", [newRevision]), /revisions are immutable/);
    assert.deepEqual(await immutableRows(), before);
  });
  await check('A genuine later publication ends the bridge before September 14 and its exact instant is exclusive', async () => {
    await db.exec('begin');
    try {
      await db.query("insert into public.pricing_revisions(state,effective_at,published_at,page_config) values('published','2026-09-12T06:00:00Z','2026-09-12T06:00:00Z','{}')");
      const offer = await windowForSource();
      assert.equal(Date.parse(offer.validUntil), Date.parse('2026-09-12T06:00:00Z'));
      const late = await submit(await user(), { plan: oldPlan, channel: oldChannel });
      assert.equal(late.status, 'needs_information'); assert.equal(late.provisionalAccessExpiresAt, null);
      await db.exec('savepoint rejected_review');
      await assert.rejects(review(late.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: '2026-09-12T06:00:00Z' } }), /historical offer window/);
      await db.exec('rollback to savepoint rejected_review');
      await review(late.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: '2026-09-12T05:59:59Z' } });
    } finally { await db.exec('rollback'); }
  });
  await check('Decline retains proof, grants nothing and does not consume an unrelated access grant', async () => {
    const owner = await user(), late = await submit(owner, { plan: oldPlan, channel: oldChannel });
    const independent = await scalar("insert into public.subscriptions(user_id,plan_code,status,source,starts_at,expires_at) values($1,'early_access_beta','active','complimentary',public.astra_test_now(),null) returning id", [owner]);
    const prior = await scalar('select to_jsonb(s) from public.subscriptions s where id=$1', [independent]);
    await review(late.id, 'rejected');
    const row = await paymentRow(late.id);
    assert.equal(row.status, 'rejected'); assert.equal(row.proof_object_path, late.proofPath); assert.equal(row.paid_at, null);
    assert.equal(row.provisional_access_started_at, null); assert.equal(row.subscription_id, null);
    assert.deepEqual(await scalar('select to_jsonb(s) from public.subscriptions s where id=$1', [independent]), prior);
  });
  await check('Non-finite/currently future windows fail closed and cancelled unpublished schedules cannot extend past owner cutoff', async () => {
    assert.equal(await scalar("select public.phase4_payment_offer_window($1,$2,'infinity'::timestamptz)", [oldPlan, oldChannel]), null);
    assert.equal(await scalar('select public.phase4_payment_offer_window($1,$2,null)', [oldPlan, oldChannel]), null);
    assert.equal(await scalar("select public.phase4_payment_offer_window($1,$2,'2026-09-12T06:00:00Z'::timestamptz)", [futurePlan, futureChannel]), null);
    await db.exec('begin');
    try {
      await db.query("insert into public.pricing_revisions(state,effective_at,cancelled_at,page_config) values('cancelled','2026-09-11T06:00:00Z','2026-09-10T06:00:00Z','{}')");
      assert.equal(Date.parse((await windowForSource()).validUntil), Date.parse('2026-09-13T16:00:00Z'));
    } finally { await db.exec('rollback'); }
  });
  await check('Reconciliation is idempotent and service-only; approved/rejected replay does not rewrite windows', async () => {
    const before = await immutableRows(); await exec(RECONCILIATION); await exec(RECONCILIATION);
    assert.deepEqual(await immutableRows(), before);
    for (const signature of ['public.phase4_payment_offer_window(uuid,uuid,timestamptz)', 'public.phase4_create_payment_request_v4(uuid,uuid,uuid,text,text,text,bigint,text)']) {
      for (const role of ['anon', 'authenticated']) assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')', [role, signature]), false);
      assert.equal(await scalar('select has_function_privilege(\'service_role\',$1,\'execute\')', [signature]), true);
    }
    assert.equal((await submit(heldOwner, { plan: oldPlan, channel: oldChannel, hash: held.proofHash })).status, 'approved');
  });
  console.log(JSON.stringify({ order: ORDER, passed: checks.length, engine: 'actual PGlite PostgreSQL', remoteWrites: false,
    limits: ['Sequential sessions only, not concurrency evidence', 'No browser/upload/provider run', 'Previously captured conflicting review windows remain held; no automatic evidence amendment'] }));
}

async function temporalCases(secondSourcePlan) {
  const secondClonePlan = await scalar("select id from public.pricing_plan_versions where revision_id=$1 and plan_code='bar_access_30d'", [newRevision]);
  const windowForSource = () => scalar('select public.phase4_payment_offer_window($1,$2,public.astra_test_now())', [oldPlan, oldChannel]);
  const currentBinding = () => scalar('select public.phase4_astra_149_binding_compatibility(public.astra_test_now())');
  const row = (id) => scalar('select to_jsonb(p) from public.payment_requests p where id=$1', [id]);
  const firstLoss = '2026-09-10T06:00:00Z';
  let boundaryHold;
  await check('Authored second-plan overlap ends the first source-binding interval at its exact exclusive boundary', async () => {
    const columns = "array['id','revision_id','created_at']";
    assert.deepEqual(await scalar(`select to_jsonb(p)-${columns} from public.pricing_plan_versions p where id=$1`, [secondSourcePlan]),
      await scalar(`select to_jsonb(p)-${columns} from public.pricing_plan_versions p where id=$1`, [secondClonePlan]));
    await setTime('2026-09-10T05:59:59.999999Z');
    assert.ok(await currentBinding());
    const before = await windowForSource();
    assert.equal(before.late, false); assert.equal(Date.parse(before.validUntil), Date.parse(firstLoss));
    assert.equal(before.bindingCompatibility.sourceBindingInterval, 'first_continuous');
    assert.equal(Date.parse(before.bindingCompatibility.sourceBindingValidUntil), Date.parse(firstLoss));
    assert.equal((await scalar('select public.phase4_pricing_snapshot()')).revisionId, oldRevision);
    assert.equal((await submit(await user(), { plan: oldPlan, channel: oldChannel })).status, 'pending');
    await setTime(firstLoss);
    assert.equal(await currentBinding(), null);
    assert.equal((await scalar('select public.phase4_pricing_snapshot()')).revisionId, newRevision);
    await assert.rejects(submit(await user(), { plan: oldPlan, channel: oldChannel, rpc: 'phase4_create_payment_request_v3' }), /not open/);
    assert.equal((await windowForSource()).late, true);
    boundaryHold = await submit(await user(), { plan: oldPlan, channel: oldChannel });
    assert.equal(boundaryHold.status, 'needs_information'); assert.equal(boundaryHold.provisionalAccessExpiresAt, null);
    const saved = await row(boundaryHold.id);
    for (const field of ['paid_at', 'payment_date', 'transaction_reference', 'provisional_access_started_at', 'provisional_access_expires_at', 'subscription_id']) assert.equal(saved[field], null);
    assert.equal(Date.parse(boundaryHold.offerValidUntil), Date.parse(firstLoss));
    assert.equal(await scalar("select private.astra_simulator_entitlement($1)->>'allowed'", [saved.user_id]), 'false');
  });
  await check('Historical verification accepts only payment before the authored binding loss, not at the boundary', async () => {
    const before = await row(boundaryHold.id);
    await assert.rejects(review(boundaryHold.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: firstLoss } }), /historical offer window/);
    assert.deepEqual(await row(boundaryHold.id), before);
    await review(boundaryHold.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: '2026-09-10T05:59:59Z' } });
    const approved = await row(boundaryHold.id);
    assert.equal(Date.parse(approved.paid_at), Date.parse('2026-09-10T05:59:59Z'));
    assert.equal(approved.payment_date, null); assert.equal(approved.transaction_reference, null);
    assert.equal(Date.parse(approved.approved_entitlement_ends_at) - Date.parse(approved.approved_entitlement_starts_at), 720 * 3600000);
  });
  await check('Later source-binding reappearance is explicitly unsupported: v4 holds and never merges disjoint windows', async () => {
    await setTime('2026-09-11T06:00:00Z'); // min(display end, checkout end): second plan closes now.
    assert.ok(await currentBinding());
    assert.equal((await scalar('select public.phase4_pricing_snapshot()')).revisionId, oldRevision);
    // Existing v3 remains untouched. V4 deliberately supports only the FIRST
    // continuous source interval, and is more conservative after reappearance.
    assert.equal((await submit(await user(), { plan: oldPlan, channel: oldChannel, rpc: 'phase4_create_payment_request_v3' })).status, 'pending');
    const held = await submit(await user(), { plan: oldPlan, channel: oldChannel });
    assert.equal(held.status, 'needs_information'); assert.equal(held.provisionalAccessExpiresAt, null);
    assert.equal(Date.parse(held.offerValidUntil), Date.parse(firstLoss));
    const before = await row(held.id);
    await assert.rejects(review(held.id, 'approved', { payload: { offerReviewDisposition: 'honor_verified_offer', verifiedPaidAt: '2026-09-11T06:00:00Z' } }), /historical offer window/);
    assert.deepEqual(await row(held.id), before);
    assert.equal((await submit(before.user_id, { plan: oldPlan, channel: oldChannel, hash: held.proofHash })).status, 'needs_information');
  });
  await check('Only a nonempty visible/enabled overlap before the original ceiling can shorten the interval', async () => {
    for (const variant of [
      { label: 'disjoint', displayStart: '2026-09-10T06:00:00Z', displayEnd: '2026-09-10T07:00:00Z', checkoutStart: '2026-09-10T08:00:00Z', checkoutEnd: '2026-09-10T09:00:00Z' },
      { label: 'touching', displayStart: '2026-09-10T06:00:00Z', displayEnd: '2026-09-10T07:00:00Z', checkoutStart: '2026-09-10T07:00:00Z', checkoutEnd: '2026-09-10T09:00:00Z' },
      { label: 'closed before clone', displayStart: '2026-09-01T06:00:00Z', displayEnd: '2026-09-06T06:00:00Z', checkoutStart: '2026-09-01T06:00:00Z', checkoutEnd: '2026-09-06T06:00:00Z' },
      { label: 'opens after cutoff', displayStart: '2026-09-15T06:00:00Z', checkoutStart: '2026-09-15T06:00:00Z' },
      { label: 'hidden', displayStart: firstLoss, checkoutStart: firstLoss, visible: false },
      { label: 'disabled', displayStart: firstLoss, checkoutStart: firstLoss, enabled: false },
      { label: 'unbounded display', checkoutStart: '2026-09-09T06:00:00Z', expectedUntil: '2026-09-09T06:00:00Z' },
    ]) {
      await db.exec('begin');
      try {
        await db.exec('alter table public.pricing_plan_versions disable trigger user');
        await db.query(`update public.pricing_plan_versions set display_starts_at=$1,display_ends_at=$2,
          checkout_starts_at=$3,checkout_ends_at=$4,visible=$5,checkout_enabled=$6 where id=any($7::uuid[])`,
        [variant.displayStart || null, variant.displayEnd || null, variant.checkoutStart || null, variant.checkoutEnd || null,
          variant.visible ?? true, variant.enabled ?? true, [secondSourcePlan, secondClonePlan]]);
        assert.equal(Date.parse((await windowForSource()).validUntil), Date.parse(variant.expectedUntil || '2026-09-13T16:00:00Z'), variant.label);
      } finally { await db.exec('rollback'); }
    }
  });
  await check('A genuine publication earlier than the second-plan opening remains the authoritative end', async () => {
    await db.exec('begin');
    try {
      await db.query("insert into public.pricing_revisions(state,effective_at,published_at,page_config) values('published','2026-09-09T06:00:00Z','2026-09-09T06:00:00Z','{}')");
      assert.equal(Date.parse((await windowForSource()).validUntil), Date.parse('2026-09-09T06:00:00Z'));
    } finally { await db.exec('rollback'); }
  });
  await check('Temporal-window migration reruns retain payment and captured review evidence unchanged', async () => {
    const snapshots = () => scalar(`select jsonb_build_object(
      'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payment_requests p),
      'history',(select jsonb_agg(to_jsonb(h) order by id) from public.payment_request_history h))`);
    const before = await snapshots(); await exec(RECONCILIATION); await exec(RECONCILIATION);
    assert.deepEqual(await snapshots(), before);
    assert.equal(Date.parse((await windowForSource()).validUntil), Date.parse(firstLoss));
  });
  console.log(JSON.stringify({ order: ORDER, scenario: 'authored_second_plan_temporal_boundary', passed: checks.length,
    engine: 'actual PGlite PostgreSQL', remoteWrites: false,
    limits: ['First continuous source-binding interval only; later reappearance remains review-only', 'No genuine concurrent sessions, browser, upload or production evidence'] }));
}
