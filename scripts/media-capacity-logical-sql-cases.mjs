/** Native CI cases only; uses the existing isolated PostgreSQL runner, never a hosted transport. */
import assert from 'node:assert/strict';
import { createMediaCapacityStore } from '../worker/media-capacity.mjs';

export const LOGICAL_MIGRATION = 'supabase/migrations/20260909231948_shared_media_capacity_logical_sessions.sql';

export async function runLogicalCapacitySqlCases({ run, rpc, read, report, check, quote, id, projectId, coordinatorId }) {
  let sequence = 30000;
  const command = (operation, epoch, logical = 1, extra = {}) => ({ operation, projectId, coordinatorId,
    issuerId: 'production', product: 'study', actorId: id(101), logicalSessionId: id(5000 + logical), epochId: id(epoch),
    ...(operation === 'read' ? {} : { commandId: id(sequence++), policyRevision: 1 }), ...extra });
  const reserve = (epoch, logical = 1, extra = {}) => command('reserve', epoch, logical,
    { scopeKey: 'prod-study-1', reservedSeconds: 600, reservedBytes: 1000000, ...extra });
  const get = (epoch, logical = 1, extra = {}) => rpc(command('read', epoch, logical, extra));
  const good = async value => { const result = await rpc(value); assert.equal(result.ok, true, JSON.stringify(result)); return result; };
  const denied = async (value, code) => assert.deepEqual(await rpc(value), { ok: false, error: { code } });
  const sqlCall = value => `select public.media_capacity_command(${quote(JSON.stringify(value))}::jsonb);`;
  const scalar = sql => run(sql);
  const debit = () => scalar(`select debited_seconds||':'||debited_bytes from private.media_capacity_policies where project_id=${quote(projectId)};`);
  const reset = async () => run(`delete from private.media_capacity_commands;
    delete from private.media_capacity_epochs; delete from private.media_capacity_logical_sessions;
    update private.media_capacity_policies set revision=1,enabled=true,hard_cap=100,reconnect_reserve=10,external_occupancy=0,
      inventory_valid_until_ms=(extract(epoch from clock_timestamp())*1000)::bigint+3600000,
      budget_valid_until_ms=(extract(epoch from clock_timestamp())*1000)::bigint+86400000,
      budget_seconds=1000000,budget_bytes=1000000000,debited_seconds=0,debited_bytes=0;
    update private.media_capacity_scopes set enabled=true,room_cap=12,session_cap=100,event_cap=100,external_occupancy=0;`);
  async function fence(epoch, logical = 1, extra = {}) {
    const row = (await get(epoch, logical, extra)).reservation;
    const requested = command('request_release', epoch, logical, { ...extra, expectedVersion: row.version });
    const releasing = (await good(requested)).reservation;
    const at = Date.now();
    const proof = { releaseCommandId: requested.commandId, projectId, roomName: row.room_name, identity: row.identity,
      revocationAcknowledged: true, absent: true, cutoffSeconds: Math.floor(Math.max(at, releasing.release_requested_at_ms) / 1000) + 1,
      acknowledgedAtMs: at, observedAtMs: at };
    await good(command('confirm_released', epoch, logical, { ...extra, expectedVersion: releasing.version, proof }));
  }
  async function contend(heldCommand, contenderCommand, expectedCode, label) {
    let signal; const ready = new Promise(resolve => { signal = resolve; });
    const holder = run(`begin; set local role service_role; ${sqlCall(heldCommand)} select 'LOGICAL_HOLDER_READY'; select pg_sleep(2); commit;`,
      { app: 'logical-holder', onOutput: value => { if (value.includes('LOGICAL_HOLDER_READY')) signal(); } });
    await Promise.race([ready, holder.then(() => { throw new Error('LOGICAL_HOLDER_NOT_READY'); })]);
    const contender = run(`set role service_role; ${sqlCall(contenderCommand)}`, { app: 'logical-contender' });
    let blocked = false;
    for (let attempt = 0; attempt < 10 && !blocked; attempt++) {
      blocked = await run("select exists(select 1 from pg_stat_activity where application_name='logical-contender' and wait_event_type='Lock');") === 't';
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(blocked, true, label);
    const held = await holder;
    assert.equal(JSON.parse(held.split('\n')[0]).ok, true, 'Holder must actually commit the intended operation');
    assert.deepEqual(JSON.parse(await contender), { ok: false, error: { code: expectedCode } });
    report.nativeLogicalConcurrentConnections = true; check(label);
  }

  // The original suite deliberately leaves fixture policies/scopes present.
  await run(await read(LOGICAL_MIGRATION), { expectedSqlstate: 'P0001' });
  assert.equal(await scalar("select to_regclass('private.media_capacity_logical_sessions') is null;"), 't');
  check('Logical upgrade refuses existing capacity state atomically without adopting a legacy allocation');
  await run('delete from private.media_capacity_commands; delete from private.media_capacity_epochs; delete from private.media_capacity_scopes; delete from private.media_capacity_policies;');
  await run(await read(LOGICAL_MIGRATION));
  assert.equal(await scalar('select count(*) from private.media_capacity_policies;'), '0');
  await run(`insert into private.media_capacity_policies(project_id,coordinator_id) values(${quote(projectId)},${quote(coordinatorId)});
    insert into private.media_capacity_scopes(project_id,scope_key,issuer_id,product,room_name,event_key,session_key,room_cap,session_cap,event_cap) values
    (${quote(projectId)},'prod-study-1','production','study','prod-study-1','same-event-1','same-session-1',12,12,12),
    (${quote(projectId)},'stage-study-1','staging','study','stage-study-1','same-event-1','same-session-1',12,12,12),
    (${quote(projectId)},'prod-debate-1','production','debate','prod-debate-1','debate-event-1','debate-match-1',100,100,100),
    (${quote(projectId)},'prod-private-1','production','debate','prod-private-1','debate-event-1','debate-match-1',100,100,100),
    (${quote(projectId)},'prod-debate-2','production','debate','prod-debate-2','debate-event-2','debate-match-2',100,100,100),
    (${quote(projectId)},'stage-debate-1','staging','debate','stage-debate-1','debate-event-1','debate-match-1',100,100,100);`);
  await denied(reserve(1), 'MEDIA_CAPACITY_DISABLED');
  const old = reserve(1); delete old.issuerId; delete old.product; delete old.logicalSessionId;
  await denied(old, 'MEDIA_CAPACITY_ISSUER_REQUIRED');
  for (const role of ['anon','authenticated']) for (const schema of ['public','private']) {
    await run(`set role ${role}; select ${schema}.media_capacity_command('{}');`, { expectedSqlstate: '42501' });
  }
  await run('set role service_role; select * from private.media_capacity_logical_sessions;', { expectedSqlstate: '42501' });
  await run("set role service_role; update private.media_capacity_logical_sessions set state='closed';", { expectedSqlstate: '42501' });
  check('Successor seeds no capacity; legacy unqualified calls, public execution and direct service logical-table access fail closed');

  await reset(); await good(reserve(1));
  await good(reserve(2, 2, { issuerId: 'staging', scopeKey: 'stage-study-1' }));
  await good(reserve(3, 3, { product: 'debate', scopeKey: 'prod-debate-1' }));
  await good(reserve(4, 4, { product: 'debate', scopeKey: 'prod-debate-2' }));
  await denied(reserve(5, 5), 'MEDIA_CAPACITY_HANDOFF_REQUIRED');
  assert.equal(await debit(), '2400:4000000');
  check('Same actor UUID is issuer-qualified and one-device binding is per product/session, not globally per account');
  for (const extra of [{ issuerId: 'staging' }, { actorId: id(102) }, { product: 'debate' }, { logicalSessionId: id(999) }]) {
    await denied(command('read', 1, 1, extra), 'MEDIA_CAPACITY_SUBJECT_MISMATCH');
  }
  await denied(reserve(8, 8, { issuerId: 'staging' }), 'MEDIA_CAPACITY_SUBJECT_MISMATCH');
  check('Foreign issuer/account/product/logical id and scope cannot inspect or attach another subject allocation');

  await reset(); const initial = reserve(1); const first = await good(initial);
  assert.equal((await good(initial)).replayed, true); assert.equal(await debit(), '600:1000000');
  await denied(reserve(2, 1, { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_PREDECESSOR_UNFENCED');
  await good(command('mark_uncertain', 1, 1, { expectedVersion: 1 }));
  await denied(reserve(2, 1, { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_PREDECESSOR_UNFENCED');
  await denied(command('close_session', 1, 1, { expectedVersion: 2 }), 'MEDIA_CAPACITY_PREDECESSOR_UNFENCED');
  assert.equal(await debit(), '600:1000000');
  check('Pending and uncertain predecessor cannot reuse time or close the one-device logical session');
  await fence(1);
  await run('update private.media_capacity_policies set budget_seconds=600;');
  const deadline = first.logicalSession.funded_deadline_ms;
  for (let epoch = 2; epoch <= 4; epoch++) {
    const value = await good(reserve(epoch, 1, { replacesEpoch: id(epoch - 1) }));
    assert.equal(value.reservation.budget_deadline_ms, deadline); assert.equal(value.logicalSession.funded_deadline_ms, deadline);
    await good(command('mark_issued', epoch, 1, { expectedVersion: value.reservation.version, tokenExpiresAtMs: Date.now() + 20000 }));
    await fence(epoch);
  }
  assert.equal(await debit(), '600:4000000');
  await denied(reserve(5, 1, { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_PREDECESSOR_UNFENCED');
  await denied(reserve(5, 1, { replacesEpoch: id(4), reservedSeconds: 601 }), 'MEDIA_CAPACITY_LOGICAL_BINDING');
  await denied(reserve(5, 1, { replacesEpoch: id(4), fundedDeadlineMs: deadline + 1000 }), 'MEDIA_CAPACITY_INPUT');
  check('Four sequential fenced physical epochs retain one immutable funded interval and time debit while charging bytes four times');
  const last = (await get(4)).reservation;
  await good(command('close_session', 4, 1, { expectedVersion: last.version }));
  assert.equal(await debit(), '600:4000000');
  await denied(reserve(5, 1, { replacesEpoch: id(4) }), 'MEDIA_CAPACITY_LOGICAL_BINDING');
  await denied(reserve(5, 2), 'MEDIA_CAPACITY_BUDGET_LIMIT');
  check('Closing a fully released logical session gives no refund or reusable closed allocation');

  await reset(); await good(reserve(1)); await fence(1);
  await run('update private.media_capacity_logical_sessions set created_at_ms=1,funded_deadline_ms=600001;');
  await denied(reserve(2, 1, { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_LOGICAL_BINDING');
  check('Late replacement cannot extend an expired funded deadline even after predecessor fencing');
  await reset(); await good(reserve(1)); await fence(1);
  await run('update private.media_capacity_policies set budget_bytes=1000000;');
  await denied(reserve(2, 1, { replacesEpoch: id(1) }), 'MEDIA_CAPACITY_BUDGET_LIMIT');
  check('Time reuse never manufactures byte credit');

  const debate = { product: 'debate', scopeKey: 'prod-debate-1' };
  await reset(); const matchRequest = reserve(1, 1, debate); const match = await good(matchRequest); await fence(1, 1, { product: 'debate' });
  await denied(reserve(2, 1, { product: 'debate', scopeKey: 'prod-debate-2', replacesEpoch: id(1) }), 'MEDIA_CAPACITY_LOGICAL_BINDING');
  const privateRoom = await good(reserve(2, 1, { product: 'debate', scopeKey: 'prod-private-1', replacesEpoch: id(1) }));
  assert.equal(privateRoom.logicalSession.funded_deadline_ms, match.logicalSession.funded_deadline_ms);
  check('Fenced main/private transitions keep the same match allocation; a different event/session is rejected');
  await run('update private.media_capacity_policies set enabled=false;');
  const replay = await good(matchRequest);
  assert.equal(replay.replayed, true); assert.equal(replay.enabled, false); assert.equal(replay.reservation.state, 'released');
  await denied(command('mark_issued', 2, 1, { product: 'debate', expectedVersion: 1, tokenExpiresAtMs: Date.now() + 20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED');
  check('Read/replay returns current state without authorizing a fresh mint; current disabled policy rejects markIssued');
  await reset(); await good(reserve(1));
  await run('update private.media_capacity_scopes set enabled=false;');
  await denied(command('mark_issued', 1, 1, { expectedVersion: 1, tokenExpiresAtMs: Date.now() + 20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED');
  await run('update private.media_capacity_scopes set enabled=true; update private.media_capacity_policies set external_occupancy=100;');
  await denied(command('mark_issued', 1, 1, { expectedVersion: 1, tokenExpiresAtMs: Date.now() + 20000 }), 'MEDIA_CAPACITY_GRANT_CLOSED');
  check('Successor keeps scope and current global occupancy checks at the fresh mint boundary');

  await reset(); await good(reserve(1)); await fence(1);
  await contend(reserve(2, 1, { replacesEpoch: id(1) }), reserve(3, 1, { replacesEpoch: id(1) }),
    'MEDIA_CAPACITY_PREDECESSOR_UNFENCED', 'Independent connections cannot attach two successors to the same fenced predecessor');
  assert.equal(await debit(), '600:2000000');
  await reset(); await good(reserve(1)); await fence(1);
  let released = (await get(1)).reservation;
  await contend(command('close_session', 1, 1, { expectedVersion: released.version }), reserve(2, 1, { replacesEpoch: id(1) }),
    'MEDIA_CAPACITY_LOGICAL_BINDING', 'Concurrent close committed first prevents replacement from reopening its logical allocation');
  await reset(); await good(reserve(1)); await fence(1); released = (await get(1)).reservation;
  await contend(reserve(2, 1, { replacesEpoch: id(1) }), command('close_session', 1, 1, { expectedVersion: released.version }),
    'MEDIA_CAPACITY_PREDECESSOR_UNFENCED', 'Concurrent replacement committed first prevents an old-epoch close from releasing its logical device');
  await reset(); await run('update private.media_capacity_policies set hard_cap=2,reconnect_reserve=1;');
  await contend(reserve(1), reserve(2, 2, { issuerId: 'staging', product: 'debate', scopeKey: 'stage-debate-1' }),
    'MEDIA_CAPACITY_PROJECT_LIMIT', 'Production Study and staging Debate compete atomically for one canonical last seat');
  assert.equal(await scalar("select count(*) from private.media_capacity_epochs where state<>'released';"), '1');

  await reset();
  const rolledBack = reserve(9, 9);
  await run(`begin; set local role service_role; ${sqlCall(rolledBack)} rollback;`);
  assert.equal((await get(9, 9)).reservation, null); assert.equal(await debit(), '0:0');
  assert.equal(await scalar('select count(*) from private.media_capacity_logical_sessions;'), '0');
  check('Caller rollback atomically removes logical allocation, physical epoch, command receipt and both budget debits');
  const store = createMediaCapacityStore({ projectId, coordinatorId, issuerId: 'production', product: 'study',
    rpc: (_name, { p_command }) => rpc(p_command) });
  const fromAdapter = await store.reserve({ commandId: id(sequence++), policyRevision: 1, epochId: id(10), actorId: id(101),
    logicalSessionId: id(5010), scopeKey: 'prod-study-1', reservedSeconds: 600, reservedBytes: 1000000 });
  assert.equal(fromAdapter.reservation.logical_session_id, id(5010));
  assert.equal(fromAdapter.reservation.budget_deadline_ms, fromAdapter.logicalSession.funded_deadline_ms);
  check('Current Node adapter consumes the actual successor SQL response without a mirrored mock shape');
}
