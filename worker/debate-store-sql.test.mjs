import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDebateStore } from './debate-store.mjs';
import { createDebateService } from './debate-service.mjs';

test('additive SQL executes in disposable local PGlite; RLS denial, receipts, CAS and outbox leases', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('./debate-schema-draft.sql', import.meta.url), 'utf8'));
    const rpc = async (name, args) => {
      const keys = Object.keys(args), values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
      const query = `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`;
      return (await db.query(query, values)).rows[0].result;
    };
    const store = createDebateStore({ rpc });
    const actor = { id: 'sql-owner', displayName: 'Owner' };
    const service = createDebateService({ store, now: () => 1800000000000 });
    const command = { actor, command: 'create_event', payload: { title: 'SQL controlled event' }, expectedRevision: 0, idempotencyKey: 'sql-create-12345' };
    const created = await service.execute(command);
    const retry = await service.execute(command);
    assert.equal(created.receipt.id, retry.receipt.id);
    assert.equal((await db.query('select count(*)::integer as count from public.debate_v3_audit')).rows[0].count, 1);
    await assert.rejects(service.execute({ ...command, payload: { title: 'Changed' } }), { code: 'IDEMPOTENCY_CONFLICT' });
    const stale = { actor, eventId: created.event.id, command: 'update_event', payload: { title: 'Stale' }, expectedRevision: 0, idempotencyKey: 'sql-stale-12345' };
    await assert.rejects(service.execute(stale), { code: 'REVISION_CONFLICT' });
    await db.exec('set role authenticated;');
    await assert.rejects(db.query('select state from public.debate_v3_events'), error => error.code === '42501');
    await assert.rejects(db.query('select public.debate_v3_read($1)', [created.event.id]), error => error.code === '42501');
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select public.debate_v3_list($1)', [actor.id]), error => error.code === '42501');
    await db.exec('reset role;');
    const state = await store.read(created.event.id), time = 1800000000000;
    const request = { actorId: actor.id, eventId: state.id, command: 'create_export', expectedRevision: state.revision, idempotencyKey: 'sql-job-12345', payloadHash: '0'.repeat(64), now: time, state, receipt: { id: 'receipt-job' }, audit: { command: 'job' }, jobs: [{ id: 'job-one', eventId: state.id, actorId: actor.id, type: 'export', payload: {} }] };
    await store.commit(request);
    assert.equal((await store.claimJobs(state.id, 5, time)).length, 1);
    assert.equal((await store.claimJobs(state.id, 5, time)).length, 0);
    await assert.rejects(store.finishJob({ jobId: 'job-one', claimId: 'wrong', status: 'completed', now: time }), { code: 'JOB_LEASE_CONFLICT' });
    const tables = await db.query("select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'debate_v3_%'");
    assert.equal(tables.rows.length, 8);
    assert.ok(tables.rows.every(row => row.rowsecurity));
  } finally { await db.close(); }
});
