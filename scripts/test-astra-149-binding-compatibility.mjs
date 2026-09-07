import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Reuse the established disposable SQL fixture without changing that test or
// mocking the migration/RPC under test. Only its setup prefix is evaluated.
// No network, remote DB, customer records, files or notification provider.
const fixtureUrl = new URL('./test-astra-payment-lifecycle.mjs', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8').replaceAll('\r\n', '\n');
const boundary = "  await check('Publication preserves authored copy, QR configuration, and future schedule'";
assert.equal(fixture.split(boundary).length, 2, 'Reviewed fixture setup boundary must be unique');
const migrationName = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter((name) => name.endsWith('_astra_149_binding_compatibility.sql'));
assert.equal(migrationName.length, 1);
const prefix = fixture.split(boundary)[0].replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));

async function compatibilityCases() {
  const { default: vm } = await import('node:vm');
  const { execFileSync } = await import('node:child_process');
  const compatibilitySql = read(BRIDGE_NAME);
  await exec(functionSql(pricing, 'phase4_create_payment_request_v2'));
  await exec(functionSql(pricing, 'phase4_pricing_snapshot'));
  const snapshot = () => scalar('select public.phase4_pricing_snapshot()');
  const compatible = () => scalar('select public.phase4_astra_149_binding_compatibility(public.astra_test_now())');
  const before = await scalar('select public.phase4_pricing_revision_snapshot($1,true,public.astra_test_now())', [oldRevision]);
  const immutableBefore = await scalar(`select jsonb_build_object(
    'revisions',(select jsonb_agg(to_jsonb(r) order by id) from public.pricing_revisions r),
    'plans',(select jsonb_agg(to_jsonb(p) order by id) from public.pricing_plan_versions p),
    'channels',(select jsonb_agg(to_jsonb(c) order by id) from public.pricing_payment_channel_versions c))`);
  const originalV2 = await scalar("select pg_get_functiondef('public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)'::regprocedure)");
  const originalV3 = await scalar("select pg_get_functiondef('public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)'::regprocedure)");
  await exec(compatibilitySql);
  await setTime('2026-09-07T06:01:00Z');
  const projected = await snapshot();
  await check('Exact public snapshot uses one statement snapshot; a VOLATILE counterfactual switches bindings', async () => {
    const volatility = (signature) => scalar('select provolatile from pg_proc where oid=$1::regprocedure', [signature]);
    assert.equal(await volatility('public.phase4_pricing_snapshot()'), 's');
    assert.equal(await volatility('public.phase4_astra_149_binding_compatibility(timestamptz)'), 's');
    assert.equal(await volatility('public.phase4_pricing_revision_snapshot(uuid,boolean,timestamptz)'), 'v');
    for (const signature of [
      'public.phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)',
      'public.phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)',
    ]) assert.equal(await volatility(signature), 'v', 'Mutating intake must remain VOLATILE');
    await db.exec('begin');
    try {
      // Single-backend MVCC witness, NOT a two-backend overlap claim. A test-only
      // helper makes a publication visible between helper and fallback SELECT.
      // The exact installed public function is otherwise unchanged. Its nested
      // VOLATILE renderer remains safe because it receives the captured old ID.
      await db.exec('alter table public.pricing_revisions disable trigger user');
      await db.query("update public.pricing_revisions set effective_at='2026-09-08T00:00:00Z' where id=$1", [newRevision]);
      await db.exec(`create or replace function public.phase4_astra_149_binding_compatibility(p_now timestamptz)
        returns jsonb language plpgsql volatile security invoker set search_path='' as $witness$
        begin
          update public.pricing_revisions set effective_at='2026-09-07T06:00:00Z'
          where id='${newRevision}'::uuid;
          return null;
        end; $witness$;`);
      const consistent = await snapshot();
      assert.equal(consistent.revisionId, oldRevision);
      assert.equal(consistent.plans[0].versionId, oldPlan);
      assert.equal(consistent.paymentMethods[0].versionId, oldChannel);
      await db.query("update public.pricing_revisions set effective_at='2026-09-08T00:00:00Z' where id=$1", [newRevision]);
      await db.exec('alter function public.phase4_pricing_snapshot() volatile');
      const inconsistent = await snapshot();
      assert.equal(inconsistent.revisionId, newRevision, 'Prior VOLATILE declaration exposes the newly visible clone');
      assert.equal(inconsistent.plans[0].versionId, newPlan);
    } finally { await db.exec('rollback'); }
    assert.equal(await volatility('public.phase4_pricing_snapshot()'), 's');
    assert.ok(await compatible());
  });
  await check('Public checkout preserves all original binding IDs with explicit effective-term provenance', async () => {
    assert.equal(projected.revisionId, oldRevision);
    assert.equal(projected.plans[0].versionId, oldPlan);
    assert.equal(projected.paymentMethods[0].versionId, oldChannel);
    assert.equal(projected.plans[0].durationDays, 30);
    assert.equal(projected.plans[0].entitlementMode, 'rolling_days');
    assert.equal(projected.plans[0].fixedEndsAt, null);
    assert.equal(projected.plans[0].checkoutOpen, true);
    assert.equal(projected.contentHash, null);
    assert.equal(projected.bindingCompatibility.effectiveTermsRevisionId, newRevision);
    assert.equal(projected.bindingCompatibility.sourceRevisionId, oldRevision);
    assert.deepEqual(projected.config.plans, projected.plans);
    const raw = await scalar('select public.phase4_pricing_revision_snapshot($1,false,public.astra_test_now())', [oldRevision]);
    assert.equal(raw.plans[0].entitlementMode, 'fixed_end');
    const adminLive = await scalar('select public.phase4_pricing_revision_snapshot($1,false,public.astra_test_now())', [newRevision]);
    assert.equal(adminLive.revisionId, newRevision);
    assert.equal(adminLive.plans[0].versionId, newPlan);
    assert.equal(adminLive.plans[0].entitlementMode, 'rolling_days');
  });

  await check('Actual cached production and current Pages refresh retains selected file despite changed public hash/terms', async () => {
    const root = new URL('../', TEST_URL);
    const productionSha = '8fd31bf8cccbc21b142035eba50d747c5559b800';
    for (const revision of [productionSha, 'HEAD']) {
      const source = execFileSync('git', ['show', `${revision}:assets/phase2-experience.js`], { cwd: root, encoding: 'utf8' });
      const safetySource = execFileSync('git', ['show', `${revision}:assets/pricing-checkout-safety.js`], { cwd: root, encoding: 'utf8' });
      const pricingCore = execFileSync('git', ['show', `${revision}:worker/pricing-core.mjs`], { cwd: root, encoding: 'utf8' });
      const { sanitizePublicPricingSnapshot } = await import('data:text/javascript;base64,'+Buffer.from(pricingCore).toString('base64'));
      const publicBefore = sanitizePublicPricingSnapshot(before);
      const publicProjected = sanitizePublicPricingSnapshot(projected);
      assert.equal(publicProjected.revisionId, oldRevision);
      assert.equal(publicProjected.plans[0].durationDays, 30);
      assert.equal(publicProjected.plans[0].fixedEntitlementEndsAt, null);
      assert.equal('contentHash' in publicProjected, false, 'Worker must not claim the immutable source hash describes projected terms');
      const extract = (name) => {
        const start = source.indexOf(`  function ${name}(`);
        assert.ok(start >= 0, `${revision}:${name}`);
        const end = source.slice(start + 3).search(/\n  (?:async )?function /);
        assert.ok(end >= 0);
        return source.slice(start, start + 3 + end);
      };
      const proofFile = Object.freeze({ name: 'internal-proof.png', size: 1200, type: 'image/png' });
      const state = { pricingSnapshot: publicBefore, selectedPricingPlan: publicBefore.plans[0],
        selectedPaymentMethod: publicBefore.paymentMethods[0], selectedPaymentProof: null };
      const input = { files: [] };
      const formHost = { querySelector: () => ({}), replaceChildren() {}, innerHTML: '' };
      const host = {};
      let restored = null;
      const context = vm.createContext({ state, input, console, Date, URL,
        document: { getElementById: (id) => ({ 'dd2-pricing-page': host, 'dd2-payment-host': formHost,
          'dd2-payment-proof': input })[id] || null },
        DataTransfer: class { constructor() { this.files = []; this.items = { add: (f) => this.files.push(f) }; } },
        unlimitedFeatureActionContext: () => null, isRegularSubscriptionPlan: () => false,
        normalizedCommercialPricing: (x) => x, normalizedCommercialPlans: (x) => x.plans,
        commercialPaymentMethods: () => state.pricingSnapshot.paymentMethods,
        commercialQrUrl: (x) => x?.qrUrl || '',
        previewCommercialPaymentProof: () => { restored = input.files[0]; },
        setStatus: () => {}, validCommercialProof: () => '',
      });
      vm.runInContext(safetySource, context);
      context.pricingCheckoutSafety = context.DueDiligencePricingCheckoutSafety;
      context.global = { DueDiligencePricingRenderer: { render() {} }, DataTransfer: context.DataTransfer };
      state.selectedPaymentProof = context.pricingCheckoutSafety.captureProof(proofFile, oldPlan, oldChannel);
      vm.runInContext(extract('restoreCommercialPaymentProof'), context);
      // DOM construction is stubbed; actual production restore/file-binding logic runs.
      context.renderPaymentForm = (plan, methodId) => {
        state.selectedPricingPlan = plan;
        state.selectedPaymentMethod = state.pricingSnapshot.paymentMethods.find((x) => x.versionId === methodId);
        context.restoreCommercialPaymentProof();
      };
      vm.runInContext(extract('renderCommercialPlanCards'), context);
      context.renderCommercialPlanCards(publicProjected);
      assert.equal(state.selectedPaymentProof.file, proofFile, revision);
      assert.equal(restored, proofFile, revision);
      assert.equal(state.selectedPricingPlan.versionId, oldPlan);
      assert.equal(state.selectedPaymentMethod.versionId, oldChannel);
    }
  });

  const sourceOwner = await user();
  const accepted = await submit(sourceOwner, { plan: oldPlan, channel: oldChannel });
  await check('First source proof is accepted without rebind or fabricated evidence; amendment is durable', async () => {
    assert.equal(accepted.status, 'pending');
    assert.equal(accepted.pricingRevisionId, oldRevision);
    assert.equal(accepted.planVersionId, oldPlan);
    assert.equal(accepted.durationDays, 30);
    assert.equal(accepted.entitlementMode, 'rolling_days');
    assert.ok(accepted.provisionalAccessExpiresAt);
    const row = await scalar('select to_jsonb(p) from public.payment_requests p where id=$1', [accepted.id]);
    assert.equal(row.trusted_entitlement_mode, 'fixed_end');
    assert.equal(row.payment_date, null); assert.equal(row.transaction_reference, null); assert.equal(row.paid_at, null);
    assert.equal(row.proof_object_path, accepted.proofPath);
    const history = await scalar("select metadata->'bindingCompatibility' from public.payment_request_history where payment_request_id=$1 and action='submitted'", [accepted.id]);
    assert.equal(history.sourcePlanVersionId, oldPlan);
    assert.equal(history.effectivePlanVersionId, newPlan);
    assert.equal(history.activationHours, 720);
    assert.equal(await scalar('select count(*)::int from public.subscriptions where user_id=$1', [sourceOwner]), 0);
  });
  const cloneOwner = await user();
  const cloneAccepted = await submit(cloneOwner);
  await check('Already-captured clone IDs remain accepted and replayed without mapping back', async () => {
    const retry = await submit(cloneOwner, { hash: cloneAccepted.proofHash });
    assert.equal(retry.id, cloneAccepted.id); assert.equal(retry.replayed, true);
    assert.equal(retry.pricingRevisionId, newRevision); assert.equal(retry.planVersionId, newPlan);
  });
  const legacyOwner = await user(), legacyHash = hash(), legacyPath = `${legacyOwner}/${randomUUID()}.png`;
  const legacyArgs = [legacyOwner, oldPlan, oldChannel, '2026-09-07', 'INTERNAL-ACTUAL-REFERENCE',
    'payment-proofs', legacyPath, 'image/png', 1200, legacyHash];
  const legacySubmit = () => scalar('select public.phase4_create_payment_request_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', legacyArgs);
  const legacy = await legacySubmit();
  await check('Supported v2 retains supplied evidence and projects effective terms on first response/replay', async () => {
    const retry = await legacySubmit();
    assert.equal(retry.id, legacy.id); assert.equal(retry.replayed, true);
    assert.equal(legacy.entitlementMode, 'rolling_days'); assert.equal(retry.durationDays, 30);
    const row = await scalar('select to_jsonb(p) from public.payment_requests p where id=$1', [legacy.id]);
    assert.equal(row.transaction_reference, 'INTERNAL-ACTUAL-REFERENCE'); assert.equal(row.paid_at, null);
    assert.equal(row.pricing_plan_version_id, oldPlan);
  });
  await check('Mixed source/clone and future channel/plan IDs are never rebound', async () => {
    for (const [plan, channel] of [[oldPlan, newChannel], [newPlan, oldChannel], [oldPlan, futureChannel], [futurePlan, futureChannel]]) {
      const owner = await user();
      await assert.rejects(submit(owner, { plan, channel }), /not compatible|not open/);
      assert.equal(await scalar('select count(*)::int from public.payment_requests where user_id=$1', [owner]), 0);
    }
  });

  const negative = async (label, sql, args = []) => check(label, async () => {
    await db.exec('begin');
    try {
      // Deliberately corrupt only disposable fixture rows to challenge guards.
      await db.exec('alter table public.pricing_revisions disable trigger user; alter table public.pricing_plan_versions disable trigger user; alter table public.pricing_payment_channel_versions disable trigger user');
      await db.query(sql, args);
      assert.equal(await compatible(), null);
      await assert.rejects(submit(await user(), { plan: oldPlan, channel: oldChannel }), /not open/);
    } finally { await db.exec('rollback'); }
  });
  for (const [label, field, value] of [
    ['different beneficiary', 'account_name', 'Unrelated beneficiary'],
    ['different bank details', 'account_details', 'Unrelated details'],
    ['different QR', 'qr_public_path', '/assets/payments/unrelated.png'],
    ['different instructions', 'instructions', 'Different instructions'],
  ]) await negative(`Same-price clone with ${label} has no source alias`, `update public.pricing_payment_channel_versions set ${field}=$1 where id=$2`, [value, newChannel]);
  await negative('NULL versus plan-specific channel association is not equivalent', 'update public.pricing_payment_channel_versions set plan_version_id=null where id=$1', [newChannel]);
  await negative('Disabled channel is not an alias', 'update public.pricing_payment_channel_versions set enabled=false where id=$1', [newChannel]);
  await negative('Changed clone term is not an alias', 'update public.pricing_plan_versions set duration_days=31 where id=$1', [newPlan]);
  await negative('Changed plan copy is not an alias', "update public.pricing_plan_versions set description='Changed offer description' where id=$1", [newPlan]);
  await negative('Changed page copy is not an alias', "update public.pricing_revisions set page_config='{\"page\":{\"title\":\"Changed offer\"}}' where id=$1", [newRevision]);
  await negative('Changed source checkout bounds are not an alias', "update public.pricing_plan_versions set checkout_ends_at='2026-09-12T16:00:00Z' where id=$1", [oldPlan]);
  await negative('Missing direct source provenance is not an alias', 'update public.pricing_revisions set based_on_revision_id=null where id=$1', [newRevision]);
  await negative('Cancelled source is not an alias', "update public.pricing_revisions set state='cancelled',cancelled_at=public.astra_test_now() where id=$1", [oldRevision]);
  await negative('Draft source is not an alias', "update public.pricing_revisions set state='draft',effective_at=null,published_at=null where id=$1", [oldRevision]);
  await negative('Duplicate generic channels cannot defeat multiset equivalence', `insert into public.pricing_payment_channel_versions(revision_id,plan_version_id,channel_code,label,qr_public_path,amount_centavos)
    values($1,null,'bpi_instapay','Duplicate fixture','/assets/payments/bpi-instapay-149.png',14900)`, [newRevision]);
  await negative('A second open source plan prevents advertising unsupported old bindings', `insert into public.pricing_plan_versions(revision_id,plan_code,name,price_centavos,duration_days,entitlement_mode,checkout_enabled)
    values($1,'bar_access_30d','Other open plan',19900,30,'rolling_days',true),
          ($2,'bar_access_30d','Other open plan',19900,30,'rolling_days',true)`, [oldRevision,newRevision]);
  await negative('An intervening publication makes the source an ineligible ancestor', `insert into public.pricing_revisions(state,effective_at,published_at,page_config)
    values('published','2026-09-06T00:00:00Z','2026-09-06T00:00:00Z','{}')`);
  await negative('A later publication stops the bridge even when the amount might be unchanged', `insert into public.pricing_revisions(state,effective_at,published_at,page_config)
    values('published','2026-09-07T06:00:30Z','2026-09-07T06:00:30Z','{}')`);

  await check('Bridge publication instant is inclusive; explicit caller timezone does not change equivalence', async () => {
    await setTime('2026-09-07T05:59:59.999999Z'); assert.equal(await compatible(), null);
    await setTime('2026-09-07T06:00:00Z'); assert.ok(await compatible());
    await db.exec("set timezone='Asia/Manila'"); assert.ok(await compatible()); await db.exec("set timezone='UTC'");
  });
  await check('September 14 cutoff is exclusive and published 199 remains authoritative', async () => {
    await setTime('2026-09-13T15:59:59.999999Z'); assert.ok(await compatible());
    await setTime('2026-09-13T16:00:00Z'); assert.equal(await compatible(), null);
    assert.equal((await snapshot()).revisionId, futureRevision);
    await assert.rejects(submit(await user(), { plan: oldPlan, channel: oldChannel }), /not open/);
    const next = await submit(await user(), { plan: futurePlan, channel: futureChannel });
    assert.equal(next.amountCentavos, 19900);
  });
  await check('Precutoff accepted source/clone/v2 replays survive cutoff; approval yields exactly 720 hours', async () => {
    const replay = await submit(sourceOwner, { plan: oldPlan, channel: oldChannel, hash: accepted.proofHash });
    assert.equal(replay.id, accepted.id); assert.equal(replay.replayed, true);
    assert.equal((await submit(cloneOwner, { hash: cloneAccepted.proofHash })).id, cloneAccepted.id);
    assert.equal((await legacySubmit()).id, legacy.id);
    await review(accepted.id, 'approved');
    const approved = await scalar('select to_jsonb(p) from public.payment_requests p where id=$1', [accepted.id]);
    assert.equal(approved.paid_at, null);
    assert.equal(approved.pricing_plan_version_id, oldPlan);
    assert.equal(approved.trusted_amount_centavos, 14900);
    assert.equal(Date.parse(approved.approved_entitlement_ends_at)-Date.parse(approved.approved_entitlement_starts_at), 720*3600000);
  });
  await check('Bridge is idempotent, preserves all immutable publications and retains service-only boundaries', async () => {
    await exec(compatibilitySql);
    const immutableAfter = await scalar(`select jsonb_build_object(
      'revisions',(select jsonb_agg(to_jsonb(r) order by id) from public.pricing_revisions r),
      'plans',(select jsonb_agg(to_jsonb(p) order by id) from public.pricing_plan_versions p),
      'channels',(select jsonb_agg(to_jsonb(c) order by id) from public.pricing_payment_channel_versions c))`);
    assert.deepEqual(immutableAfter, immutableBefore);
    for (const signature of ['phase4_astra_149_binding_compatibility(timestamptz)', 'phase4_pricing_snapshot()',
      'phase4_create_payment_request_v2(uuid,uuid,uuid,date,text,text,text,text,bigint,text)',
      'phase4_create_payment_request_v3(uuid,uuid,uuid,text,text,text,bigint,text)']) {
      for (const role of ['anon','authenticated']) assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')', [role,signature]), false);
    }
    assert.ok(originalV2.includes('Resolve an already accepted retry'));
    assert.ok(originalV3.includes('Accepted retries resolve before'));
  });
  console.log(JSON.stringify({ passed: checks.length, engine: 'actual PGlite PostgreSQL', remoteWrites: false,
    uiEvidence: 'actual production/current render and file restoration functions with DOM/File API test doubles',
    limits: ['No browser or live staging run', 'No true concurrent backend test', 'Unmodified later late-proof migration requires reconciliation before integration'] }));
}

const code = prefix + '\nconst BRIDGE_NAME=' + JSON.stringify(migrationName[0])
  + ';\nconst TEST_URL=' + JSON.stringify(import.meta.url)
  + ';\nawait (' + compatibilityCases.toString() + ')();\n} finally { await db.close(); }';
try { await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')); }
catch (error) { console.error(JSON.stringify({ message: error.message, code: error.code, where: error.where, detail: error.detail })); process.exitCode = 1; }
