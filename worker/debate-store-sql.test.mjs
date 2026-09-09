import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDebateStore } from './debate-store.mjs';
import { createDebateService } from './debate-service.mjs';
import { createDebateMediaAdapter } from './debate-media.mjs';

test('hosted default table grants are replaced: audit update/truncate denied while service transactions and approved cleanup work', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create table public.hosted_default_acl_probe(id integer);
    `);
    const privilege = async (role, table, operation) => (await db.query('select has_table_privilege($1,$2,$3) as allowed', [role, `public.${table}`, operation])).rows[0].allowed;
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal(await privilege(role, 'hosted_default_acl_probe', 'UPDATE'), true, 'The fixture must actually reproduce inherited hosted default UPDATE grants');
      assert.equal(await privilege(role, 'hosted_default_acl_probe', 'TRUNCATE'), true, 'The fixture must actually reproduce inherited hosted default TRUNCATE grants');
    }
    const migration = await readFile(new URL('./debate-schema-draft.sql', import.meta.url), 'utf8');
    assert.equal(migration, await readFile(new URL('../supabase/migrations/20260909080139_debate_room_v3.sql', import.meta.url), 'utf8'), 'The tested draft and deployable migration must have identical bytes');
    await db.exec(migration);
    const tables = (await db.query("select tablename from pg_tables where schemaname='public' and tablename like 'debate_v3_%' order by tablename")).rows.map(row => row.tablename);
    assert.equal(tables.length, 10);
    for (const table of tables) {
      for (const role of ['anon','authenticated']) for (const operation of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal(await privilege(role, table, operation), false, `${role} must not inherit ${operation} on ${table}`);
      for (const operation of ['SELECT','INSERT','DELETE']) assert.equal(await privilege('service_role', table, operation), true, `Required service ${operation} on ${table}`);
      assert.equal(await privilege('service_role', table, 'UPDATE'), table !== 'debate_v3_audit', `Only intended service UPDATE on ${table}`);
      for (const operation of ['TRUNCATE','REFERENCES','TRIGGER']) assert.equal(await privilege('service_role', table, operation), false, `No inherited service ${operation} on ${table}`);
    }
    await db.exec('set role service_role;');
    assert.equal((await db.query('select current_user as role')).rows[0].role, 'service_role');
    const store = createDebateStore({ rpc: async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value))).rows[0].result });
    let now = 1800000000000, eventId, sequence = 0;
    const actor = { id: 'hosted-acl-local-owner', displayName: 'Synthetic ACL test owner', platformOperator: true };
    const service = createDebateService({ store, now: () => now });
    const command = async (name, payload = {}) => {
      const before = eventId ? await store.read(eventId) : null;
      const result = await service.execute({ actor, eventId, command: name, payload, expectedRevision: before?.revision || 0, idempotencyKey: `hosted-acl-local-${++sequence}` });
      eventId ||= result.event.id; return result;
    };
    await command('create_event', { title: 'Synthetic inherited-ACL event' });
    await command('update_event', { title: 'Service UPDATE remains authorized' });
    const saved = await store.read(eventId); assert.equal(saved.revision, 2); assert.equal(saved.title, 'Service UPDATE remains authorized');
    const auditBefore = (await db.query('select * from public.debate_v3_audit where event_id=$1 order by revision', [eventId])).rows;
    assert.equal(auditBefore.length, 2, 'The service commit inserted both append-only audit rows');
    await assert.rejects(db.query("update public.debate_v3_audit set record='{\"tampered\":true}'::jsonb where event_id=$1", [eventId]), error => error.code === '42501');
    await assert.rejects(db.query('truncate table public.debate_v3_audit'), error => error.code === '42501');
    assert.deepEqual((await db.query('select * from public.debate_v3_audit where event_id=$1 order by revision', [eventId])).rows, auditBefore, 'Denied writes cannot alter the original audit');
    await command('end_event');
    await command('set_retention', { approved: true, operationalDays: 1, chatDays: 1, evidenceDays: 1, officialDays: 1 });
    now += 86400001;
    await command('cleanup_records');
    assert.ok((await store.read(eventId)).retention.purged.official);
    assert.deepEqual((await db.query('select command from public.debate_v3_audit where event_id=$1', [eventId])).rows, [{ command: 'cleanup_records' }], 'Approved transactional retention may DELETE expired audit rows while retaining its own receipt');
    assert.equal((await db.query('select current_user as role')).rows[0].role, 'service_role', 'No superuser elevation was used for authorized CRUD or cleanup');
  } finally { await db.close(); }
});

test('additive SQL executes in disposable local PGlite; RLS denial, receipts, CAS and outbox leases', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('./debate-schema-draft.sql', import.meta.url), 'utf8'));
    await db.exec('set role service_role;');
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
    await assert.rejects(db.query('select public.debate_v3_active_events(20,null)'), error => error.code === '42501');
    await assert.rejects(db.query('select public.debate_v3_discover(20,null)'), error => error.code === '42501');
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select public.debate_v3_list($1)', [actor.id]), error => error.code === '42501');
    await assert.rejects(db.query('select public.debate_v3_active_events(20,null)'), error => error.code === '42501');
    await assert.rejects(db.query('select public.debate_v3_discover(20,null)'), error => error.code === '42501');
    await db.exec('reset role;');
    const state = await store.read(created.event.id), time = 1800000000000;
    const request = { actorId: actor.id, eventId: state.id, command: 'create_export', expectedRevision: state.revision, idempotencyKey: 'sql-job-12345', payloadHash: '0'.repeat(64), now: time, state, receipt: { id: 'receipt-job' }, audit: { command: 'job' }, jobs: [{ id: 'job-one', eventId: state.id, actorId: actor.id, type: 'export', payload: {} }] };
    await store.commit(request);
    assert.deepEqual((await store.activeEvents()).eventIds, [state.id]);
    const claimed = await store.claimJobs(state.id, 5, time);
    assert.equal(claimed.length, 1);
    assert.equal((await store.claimJobs(state.id, 5, time)).length, 0);
    const activeJob = await store.readJob('job-one');
    assert.equal(activeJob.claimId, claimed[0].claimId); assert.equal(activeJob.leaseUntil, time + 60000);
    await assert.rejects(store.finishJob({ jobId: 'job-one', claimId: 'wrong', status: 'completed', now: time }), { code: 'JOB_LEASE_CONFLICT' });
    await store.finishJob({ jobId: 'job-one', claimId: claimed[0].claimId, status: 'failed', error: 'LOCAL_REHEARSAL_MAIL_DISABLED', now: time });
    const failedJob = await store.readJob('job-one');
    assert.equal(failedJob.status, 'failed');
    assert.equal(failedJob.error, 'LOCAL_REHEARSAL_MAIL_DISABLED', 'A saved delivery error is data, not a failed RPC envelope.');
    await db.exec('set role service_role;');
    assert.deepEqual((await store.discover()).events, []);
    for (const n of [1, 2]) await service.execute({ actor, command: 'create_event', payload: { title: `Public SQL debate ${n}`, visibility: 'public' }, expectedRevision: 0, idempotencyKey: `sql-public-create-${n}` });
    const publicPage = await service.discover({ actor, limit: 1 });
    assert.equal(publicPage.events.length, 1); assert.ok(publicPage.nextCursor);
    const nextPage = await service.discover({ actor, limit: 1, cursor: publicPage.nextCursor });
    assert.equal(nextPage.events.length, 1); assert.equal(nextPage.nextCursor, null);
    assert.notEqual(nextPage.events[0].id, publicPage.events[0].id);
    assert.deepEqual(Object.keys(publicPage.events[0]).sort(), ['description', 'id', 'language', 'scheduledAt', 'status', 'timezone', 'title']);
    const visitor = { id: 'sql-public-visitor', displayName: 'Local visitor' };
    const waiting = await service.execute({ actor: visitor, eventId: publicPage.events[0].id, command: 'join_public_event', payload: {}, idempotencyKey: 'sql-public-join-12345' });
    assert.equal(waiting.event.awaitingAdmission, true); assert.deepEqual(waiting.event.matches, []); assert.equal(waiting.event.members.length, 1);
    const tables = await db.query("select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'debate_v3_%'");
    assert.equal(tables.rows.length, 10);
    assert.ok(tables.rows.every(row => row.rowsecurity));
  } finally { await db.close(); }
});

test('actual SQL retention honors approval, category deadlines and holds, purges private deliveries and isolates another event', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('./debate-schema-draft.sql', import.meta.url), 'utf8')); await db.exec('set role service_role;');
    const store = createDebateStore({ rpc: async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, Object.values(args).map(v => v && typeof v === 'object' ? JSON.stringify(v) : v))).rows[0].result });
    let time = 1800000000000, eventId, sequence = 0, deletionFails = true;
    const owner = { id: 'retention-sql-owner', displayName: 'Local owner', platformOperator: true }, deleted = [];
    const service = createDebateService({ store, now: () => time, adapters: {
      export: async job => ({ status: 'ready', downloadId: job.id }),
      delete_export: async job => { if (deletionFails) throw new Error('Local storage outage'); deleted.push(job.payload.storageKey); return { status: 'deleted' }; },
    } });
    const command = async (name, payload = {}, actor = owner) => { const state = eventId ? await store.read(eventId) : null; const result = await service.execute({ actor, eventId, command: name, payload, expectedRevision: state?.revision || 0, idempotencyKey: `retention-sql-${++sequence}` }); eventId ||= result.event.id; return result; };
    await command('create_event', { title: 'Local retention target' });
    const other = await service.execute({ actor: owner, command: 'create_event', payload: { title: 'Unrelated event retained', description: 'UNRELATED_PRIVATE_MARKER' }, expectedRevision: 0, idempotencyKey: 'retention-unrelated-123' });
    const actors = Array.from({ length: 6 }, (_, index) => ({ id: `retention-speaker-${index}`, displayName: `Local ${index}` }));
    for (const actor of actors) { const invite = await command('create_invite', { role: 'debater', boundAccountId: actor.id }); await command('claim_invite', { secret: invite.receipt.result.secret }, actor); }
    const a = (await command('confirm_roster', { name: 'A', speakerIds: actors.slice(0,3).map(a => a.id), captainId: actors[0].id })).receipt.result.teamId;
    const n = (await command('confirm_roster', { name: 'N', speakerIds: actors.slice(3).map(a => a.id), captainId: actors[3].id })).receipt.result.teamId;
    const matchId = (await command('create_match', { teamIds: { affirmative: a, negative: n }, judgeIds: [owner.id] })).receipt.result.matchId;
    await command('save_draft', { notes: 'PRIVATE_SQL_DRAFT', scorecard: {} }); await command('send_message', { channel: 'judges', text: 'PRIVATE_SQL_CHAT' });
    const jobId = (await command('create_export', { kind: 'scorecard' })).receipt.result.jobId;
    await service.processOutbox({ eventId });
    // Controlled official-record fixtures exercise physical table expiry. They
    // are not a claim that a real panel submitted these local test records.
    const fixture = await store.read(eventId); fixture.matches[matchId].ballots = { [`1:${owner.id}`]: { round: 1, judgeId: owner.id, notes: 'PRIVATE_SQL_BALLOT' } };
    await store.commit({ actorId: owner.id, eventId, command: '__local_retention_fixture', expectedRevision: fixture.revision, state: fixture, now: time, idempotencyKey: 'retention-fixture-123', payloadHash: 'a'.repeat(64), receipt: { id: 'local-retention-fixture', committedAt: time }, audit: { command: 'local-retention-fixture' }, jobs: [] });
    await command('end_event');
    await assert.rejects(command('cleanup_records'), { code: 'RETENTION_UNAPPROVED' });
    await command('set_retention', { approved: true, operationalDays: 1, chatDays: 2, evidenceDays: 3, officialDays: 4 });
    const officialAuditCount = (await db.query('select count(*)::integer n from public.debate_v3_audit where event_id=$1', [eventId])).rows[0].n;
    time += 86400001; await service.sweep();
    let saved = await store.read(eventId); assert.ok(saved.retention.purged.operational); assert.equal(saved.retention.purged.chat, undefined);
    assert.equal(saved.matches[matchId].drafts[owner.id].notes, 'PRIVATE_SQL_DRAFT'); assert.equal((await db.query('select count(*)::integer n from public.debate_v3_ballots where event_id=$1', [eventId])).rows[0].n, 1);
    assert.ok((await db.query('select count(*)::integer n from public.debate_v3_audit where event_id=$1', [eventId])).rows[0].n >= officialAuditCount, 'Operational expiry preserves official command audit until the event-end official deadline.');
    await command('set_retention', { hold: true, reason: 'Local protected record hold' }); time += 4 * 86400000;
    await assert.rejects(command('cleanup_records'), { code: 'RETENTION_HOLD' }); await service.sweep(); assert.ok((await store.readJob(jobId)).payload.document);
    await command('set_retention', { hold: false, reason: 'Local hold released' }); await service.sweep();
    saved = await store.read(eventId); assert.equal(saved.matches[matchId].messages.length, 0); assert.deepEqual(saved.matches[matchId].drafts, {}); assert.equal(saved.matches[matchId].officialRecordsExpired, true);
    assert.equal(saved.matches[matchId].rules, null); assert.deepEqual(saved.motions, {});
    assert.deepEqual((await service.snapshot({ actor: owner, eventId })).event.matches, [{ id: matchId, title: saved.matches[matchId].title, phase: 'expired', officialRecordsExpired: true }]);
    const expired = await store.readJob(jobId); assert.equal(expired.payload.document, undefined); assert.ok(expired.payload.retentionPurgedAt); assert.equal(expired.actorId, 'RETENTION_REDACTED');
    for (const table of ['debate_v3_ballots','debate_v3_votes','debate_v3_match_versions']) assert.equal((await db.query(`select count(*)::integer n from public.${table} where event_id=$1`, [eventId])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::integer n from public.debate_v3_audit where event_id=$1 and at_ms<$2', [eventId, time])).rows[0].n, 0, 'Official expiry removes the old audit while retaining the cleanup receipt.');
    assert.equal((await store.read(other.event.id)).description, 'UNRELATED_PRIVATE_MARKER'); assert.equal(deleted.length, 0);
    deletionFails = false; time += 3000; await service.sweep(); assert.equal(deleted.length, 1);
    await db.exec('set role authenticated;'); await assert.rejects(db.query('select public.debate_v3_expired_jobs($1,$2)', [eventId, time]), error => error.code === '42501');
  } finally { await db.close(); }
});

test('actual SQL sweep rediscovers completed orphan upload metadata even without event end or public outbox projection', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('./debate-schema-draft.sql', import.meta.url), 'utf8')); await db.exec('set role service_role;');
    const store = createDebateStore({ rpc: async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, Object.values(args).map(v => v && typeof v === 'object' ? JSON.stringify(v) : v))).rows[0].result });
    let time = 1800000000000; const actor = { id: 'local-orphan-owner', displayName: 'Local owner', platformOperator: true }, deleted = [];
    const service = createDebateService({ store, now: () => time, adapters: { delete_evidence: async job => { deleted.push(job.payload.storageKey); return { status: 'deleted' }; } } });
    const created = await service.execute({ actor, command: 'create_event', payload: { title: 'Disposable orphan retention fixture' }, expectedRevision: 0, idempotencyKey: 'local-orphan-event-123' });
    const state = await store.read(created.event.id), eventId = state.id, matchId = 'local-metadata-fixture';
    // Minimal service-role metadata fixture; this is not a played debate or a hosted participant.
    state.retention = { ...state.retention, approved: true, operationalDays: 1, nextCleanupAt: null };
    state.matches[matchId] = { id: matchId, title: 'Metadata fixture', phase: 'setup' };
    await store.commit({ actorId: actor.id, eventId, command: '__local_metadata_fixture', expectedRevision: state.revision, state, now: time, idempotencyKey: 'local-orphan-fixture-123', payloadHash: 'b'.repeat(64), receipt: { id: 'local-orphan-fixture' }, audit: { command: 'local-metadata-fixture' }, jobs: [] });
    const reservation = await store.reserveUpload({ id: 'orphan-one', actorId: actor.id, eventId, matchId, channel: 'public', mimeType: 'application/pdf', storageKey: `evidence/${eventId}/${matchId}/orphan-one.pdf`, createdAt: time, expiresAt: time + 1800000 });
    time += 1800001; await service.processOutbox({ eventId });
    assert.equal(deleted.length, 1); assert.equal((await store.readUpload(reservation.id)).status, 'deleted');
    assert.deepEqual((await store.read(eventId)).jobs, {}); assert.equal((await store.read(eventId)).retention.nextCleanupAt, null);
    assert.deepEqual((await store.activeEvents(20, null, time)).eventIds, []);
    time += 86400000;
    assert.deepEqual((await store.activeEvents(20, null, time)).eventIds, [eventId], 'Due private completion metadata is independently discoverable.');
    await service.sweep();
    assert.equal(await store.readUpload(reservation.id), null);
    const job = await store.readJob(reservation.cleanupJobId); assert.ok(job.payload.retentionPurgedAt); assert.equal(job.payload.storageKey, undefined); assert.equal(job.actorId, 'RETENTION_REDACTED');
    assert.deepEqual((await store.activeEvents(20, null, time)).eventIds, []);
  } finally { await db.close(); }
});

test('actual service-role SQL media jobs bind leases, retire epochs, and sweep expired sessions without client traffic', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('./debate-schema-draft.sql', import.meta.url), 'utf8'));
    await db.exec('set role service_role;');
    const store = createDebateStore({ rpc: async (name, args) => {
      const values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
      return (await db.query(`select public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, values).catch(error => { process.stderr.write(`Local SQL: ${error.code}: ${error.message}\n`); throw error; })).rows[0].result;
    } });
    let time = 1800000000000, eventId, sequence = 0, service;
    const removed = [], actor = { id: 'sql-media-owner', displayName: 'Local official' };
    const media = createDebateMediaAdapter({ DEBATE_MEDIA_ENABLED: 'true', LIVEKIT_URL: 'wss://test-only.livekit.cloud', LIVEKIT_API_KEY: 'test-only', LIVEKIT_API_SECRET: 'test-only-local-secret' }, {
      now: () => time, authorizeJob: job => service.authorizeMediaJob(job), service: {
        async listRooms(names) { return [{ name: names[0], maxParticipants: 10 }]; },
        async removeParticipant(...args) { removed.push(args); },
        async updateParticipant() { assert.fail('No mutable media grants.'); },
      },
    });
    service = createDebateService({ store, now: () => time, limits: { maxParticipants: 10 }, adapters: { media: media.apply,
      validateEvidence: async input => ({ verified: true, id: input.uploadId, mimeType: input.mimeType, size: input.size, digest: 'b'.repeat(64), storageKey: `evidence/${input.eventId}/${input.matchId}/${input.uploadId}.pdf` }),
      delete_evidence: async () => ({ status: 'deleted' }),
    } });
    const command = async (name, payload = {}, commandActor = actor) => {
      const state = eventId ? await store.read(eventId) : null;
      const result = await service.execute({ actor: commandActor, eventId, command: name, payload, expectedRevision: state?.revision || 0, idempotencyKey: `sql-media-command-${++sequence}` });
      eventId ||= result.event.id; return result;
    };
    await command('create_event', { title: 'Actual SQL media rehearsal', rehearsal: true });
    const speakers = Array.from({ length: 6 }, (_, i) => ({ id: `sql-speaker-${i}`, displayName: `Local speaker ${i + 1}` }));
    for (const speaker of speakers) { const invite = await command('create_invite', { role: 'debater', boundAccountId: speaker.id }); await command('claim_invite', { secret: invite.receipt.result.secret }, speaker); }
    const affirmative = await command('confirm_roster', { name: 'Local affirmative', speakerIds: speakers.slice(0, 3).map(p => p.id), captainId: speakers[0].id });
    const negative = await command('confirm_roster', { name: 'Local negative', speakerIds: speakers.slice(3).map(p => p.id), captainId: speakers[3].id });
    const motion = await command('add_motion', { text: 'This house would publish learning materials.' });
    const created = await command('create_match', { motionId: motion.receipt.result.motionId, teamIds: { affirmative: affirmative.receipt.result.teamId, negative: negative.receipt.result.teamId }, judgeIds: [actor.id] }), matchId = created.receipt.result.matchId;
    await command('enter_space', { matchId, deviceId: 'device-one' });
    assert.equal((await service.processOutbox({ eventId }))[0].status, 'completed');
    const first = await service.authorizeMedia({ actor, eventId, matchId, deviceId: 'device-one' });
    assert.equal(first.status, 'ready');
    await command('enter_space', { matchId, deviceId: 'device-two', handoff: true });
    assert.equal((await service.processOutbox({ eventId }))[0].status, 'completed');
    const second = await service.authorizeMedia({ actor, eventId, matchId, deviceId: 'device-two' });
    assert.notEqual(second.identity, first.identity); assert.equal(removed[0][1], first.identity);
    assert.equal(removed[0][2].revokeTokenTs, 1800000001n);
    time += 120001;
    const sweep = await service.sweep(); assert.equal(sweep.outcomes.length, 1);
    assert.equal((await store.read(eventId)).media[actor.id].status, 'left');
    assert.equal(removed.at(-1)[1], second.identity);
    assert.deepEqual(await store.activeEvents(), { eventIds: [], nextCursor: null });
    const reservation = await service.reserveEvidenceUpload({ actor, eventId, matchId, channel: 'public', mimeType: 'application/pdf' });
    const attachment = { uploadId: reservation.id, mimeType: 'application/pdf', size: 123 };
    await service.completeEvidenceUpload({ actor, eventId, matchId, reservationId: reservation.id, attachment });
    await command('share_evidence', { matchId, title: 'SQL upload evidence', attachment });
    assert.equal((await store.readUpload(reservation.id)).status, 'retained');
    assert.equal((await store.readJob(reservation.cleanupJobId)).status, 'cancelled');
    await assert.rejects(command('share_evidence', { matchId, title: 'Duplicate', attachment }), { code: 'UPLOAD_UNAVAILABLE' });
    const abandoned = await service.reserveEvidenceUpload({ actor, eventId, matchId, channel: 'public', mimeType: 'application/pdf' });
    time += 1800001; await service.sweep(); assert.equal((await store.readUpload(abandoned.id)).status, 'deleted');
    // 101 persistent ACTIVE metadata fixtures exercise pagination fairness,
    // not 101 connected people or a provider capacity claim.
    await db.query("insert into public.debate_v3_events(id,owner_id,revision,status,state,created_at_ms,updated_at_ms) select 'fair-event-'||lpad(n::text,3,'0'),'local-fixture',1,'draft',jsonb_build_object('media',jsonb_build_object('fixture',jsonb_build_object('status','ready'))),0,0 from generate_series(1,101) n");
    const visited = [];
    for (let pass = 0; pass < 6; pass++) visited.push(...(await store.activeEvents(20, null)).eventIds);
    assert.equal(new Set(visited).size, 101, 'A new worker each minute still eventually reaches event101.');
    assert.equal((await store.activeEvents(20, 'stale-caller-cursor')).eventIds[0], 'fair-event-001', 'Cursor wraps and ignores stale caller rewind.');
  } finally { await db.close(); }
});
