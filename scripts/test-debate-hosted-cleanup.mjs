import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedDataSafety, HOSTED_BUCKET, hostedHash } from './debate-hosted-cleanup.mjs';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';

const NOW = Date.parse('2026-09-09T15:00:00Z'), ID = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const copy = value => structuredClone(value);
function harness({ intercept, pauseChange } = {}) {
  const fixtures = ['host', 'observer'].map((purpose, i) => ({ id: ID(i + 1), purpose, runId: `dv3study-${String(i).padStart(8, '0')}`,
    createdAt: new Date(NOW - 10000000).toISOString(), signOutState: 'confirmed', authDeniedBeforeCleanup: true, workerDeniedBeforeCleanup: true }));
  const runTag = 'dv3host-aaaaaaaaaaaaaaaa', title = `Hosted Debate ${runTag} main`, eventId = ID(20);
  const event = { id: eventId, owner_id: fixtures[0].id, revision: 8, status: 'draft', created_at_ms: NOW - 10000000, updated_at_ms: NOW,
    state: { id: eventId, ownerId: fixtures[0].id, revision: 8, title, rehearsal: true, visibility: 'unlisted',
      members: Object.fromEntries(fixtures.map(f => [f.id, { id: f.id }])), media: {} } };
  const jobId = ID(30), key = `exports/${eventId}/${jobId}.pdf`;
  const tables = { debate_v3_events: [event], debate_v3_uploads: [],
    debate_v3_outbox: [{ id: jobId, event_id: eventId, actor_id: fixtures[0].id, type: 'export', status: 'completed', claim_id: ID(40),
      job: { id: jobId, type: 'export', eventId, actorId: fixtures[0].id, payload: { format: 'pdf' } }, result: { storageKey: key } }],
    debate_v3_receipts: [{ actor_id: fixtures[0].id, command: 'create_event', event_id: eventId, idempotency_key: ID(41), receipt: {} }],
    debate_v3_audit: [{ event_id: eventId, revision: 1, actor_id: fixtures[0].id, command: 'create_event', record: {} }],
    debate_v3_match_versions: [], debate_v3_ballots: [], debate_v3_votes: [],
    debate_v3_rate_limits: [{ actor_id: fixtures[0].id, action: 'discover_events', bucket: Math.floor(NOW / 60000), count: 3 }] };
  const matchingBucket = { id: HOSTED_BUCKET.id, name: HOSTED_BUCKET.id, public: false,
    file_size_limit: HOSTED_BUCKET.fileSizeLimit, allowed_mime_types: [...HOSTED_BUCKET.allowedMimeTypes] };
  let bucket = copy(matchingBucket); const files = new Set([key]), calls = [], checkpoints = [], record = {};
  function matches(row, params) {
    return [...params].filter(([k]) => !['select', 'limit'].includes(k)).every(([key, filter]) => {
      if (key === 'state' && filter.startsWith('cs.')) return Object.keys(JSON.parse(filter.slice(3)).members).every(id => Object.hasOwn(row.state.members, id));
      return filter === 'is.null' ? row[key] === null : filter === `eq.${row[key]}`;
    });
  }
  const service = async (route, options = {}) => {
    const url = new URL(route, FIXTURE_TARGET.supabaseUrl), method = options.method || 'GET';
    calls.push({ route, method, body: options.body });
    const custom = await intercept?.({ url, method, options, tables, files, bucket }); if (custom) return custom;
    if (url.pathname === `/storage/v1/bucket/${HOSTED_BUCKET.id}`) return bucket ? { status: 200, body: copy(bucket) } : { status: 400, body: { statusCode: '404' } };
    if (url.pathname === '/storage/v1/bucket' && method === 'POST') { bucket = JSON.parse(options.body); return { status: 200, body: {} }; }
    if (url.pathname === `/storage/v1/object/${HOSTED_BUCKET.id}` && method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) files.delete(key); return { status: 200, body: [] }; }
    if (url.pathname.startsWith(`/storage/v1/object/info/${HOSTED_BUCKET.id}/`)) return files.has(url.pathname.split(`${HOSTED_BUCKET.id}/`)[1]) ? { status: 200, body: {} } : { status: 400, body: { statusCode: '404' } };
    if (url.pathname === '/rest/v1/rpc/astra_staging_debate_cleanup_v1') {
      const { p_manifest, p_expected } = JSON.parse(options.body);
      const snapshot = { version: 1, manifestSha256: hostedHash(p_manifest), snapshotSha256: hostedHash(tables),
        counts: Object.fromEntries(Object.entries(tables).map(([name, values]) => [name.slice('debate_v3_'.length), values.length])),
        storageKeys: tables.debate_v3_outbox.length ? [key] : [] };
      if (!p_expected) return { status: 200, body: { status: 'CAPTURED', snapshot } };
      assert.deepEqual(snapshot, p_expected, 'Inert atomic transport refuses changed full rows'); assert.equal(files.size, 0);
      for (const table of Object.keys(tables)) tables[table] = [];
      return { status: 200, body: { status: 'DELETED_ATOMICALLY', snapshot, deletedCounts: snapshot.counts } };
    }
    const table = url.pathname.split('/').at(-1); assert.ok(tables[table], `Unexpected table ${table}`);
    const found = tables[table].filter(row => matches(row, url.searchParams));
    if (method === 'DELETE') tables[table] = tables[table].filter(row => !found.includes(row));
    return { status: 200, body: copy(found), range: found.length ? `0-${found.length - 1}/${found.length}` : '*/0' };
  };
  const ownership = { fixtures, runTag, eventIntents: [{ title, id: eventId }], sessionsFenced: true };
  const safety = createHostedDataSafety({ supabaseUrl: FIXTURE_TARGET.supabaseUrl, service,
    persist: async () => checkpoints.push(copy(record)), clock: () => NOW,
    pause: async ms => { assert.ok([30000, 32500].includes(ms)); pauseChange?.({ tables }); } });
  return { fixtures, event, tables, files, calls, record, ownership, safety, matchingBucket, checkpoints,
    setBucket: value => { bucket = value; } };
}

test('fixed staging bucket preflight is read-only and matching infrastructure is retained', async () => {
  const h = harness(); assert.equal((await h.safety.bucketPreflight()).status, 'MATCHING_PRIVATE_BUCKET');
  await h.safety.ensureBucket(h.record); assert.ok(h.calls.every(call => call.method === 'GET'));
  assert.throws(() => createHostedDataSafety({ supabaseUrl: 'https://wrong.invalid', service() {}, persist() {} }), /HOSTED_SAFETY_SCOPE/);
});
test('absent private bucket is created once with exact limits and verified; mismatches never mutate', async () => {
  const h = harness(); h.setBucket(null); await h.safety.ensureBucket(h.record);
  assert.equal(h.record.bucket.creationState, 'CREATED_AND_VERIFIED'); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.deepEqual(JSON.parse(h.calls.find(c => c.method === 'POST').body), h.matchingBucket);
  for (const changed of [{ public: true }, { file_size_limit: null }, { allowed_mime_types: ['image/*'] }]) {
    const denied = harness(); denied.setBucket({ ...denied.matchingBucket, ...changed });
    await assert.rejects(denied.safety.ensureBucket(denied.record), /HOSTED_BUCKET_CONTRACT_MISMATCH/);
    assert.ok(denied.calls.every(c => c.method === 'GET'));
  }
});
test('unknown bucket create does not retry and resolves only from matching readback', async () => {
  let h; h = harness({ intercept: ({ url, method }) => {
    if (url.pathname === '/storage/v1/bucket' && method === 'POST') { h.setBucket(h.matchingBucket); throw new Error('UNSAFE_RAW_PROVIDER_RESPONSE'); }
  } }); h.setBucket(null); await h.safety.ensureBucket(h.record);
  assert.equal(h.record.bucket.creationState, 'MATCHING_READBACK_AFTER_UNCERTAIN_CREATE');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1); assert.ok(!JSON.stringify(h.record).includes('UNSAFE_RAW'));
});
test('owned event cleanup fences sessions and removes files before one frozen atomic database deletion', async () => {
  const h = harness(); await h.safety.cleanupEvents(h.record, h.ownership);
  assert.equal(h.record.complete, true); assert.equal(h.files.size, 0);
  assert.ok(Object.values(h.tables).every(rows => rows.length === 0));
  const writes = h.calls.filter(c => c.method === 'DELETE');
  assert.ok(writes[0].route.startsWith('/storage/v1/object/debate-private-v3'));
  assert.equal(writes.length, 1); assert.ok(writes.every(call => call.route.startsWith('/storage/')));
  assert.equal(h.calls.filter(c => c.route.includes('/rpc/astra_staging_debate_cleanup_v1')).length, 2);
  assert.equal(h.record.atomic.state, 'DELETED_ABSENCE_VERIFIED');
});
test('missing session fence or foreign event ownership permits no deletion', async () => {
  for (const mutate of [h => { h.ownership.sessionsFenced = false; }, h => { h.fixtures[0].authDeniedBeforeCleanup = false; },
    h => { h.event.state.rehearsal = false; }, h => { h.event.owner_id = ID(99); h.event.state.members[ID(99)] = { id: ID(99) }; },
    h => { h.event.state.members[ID(99)] = { id: ID(99) }; }, h => { h.event.state.media.live = {}; }]) {
    const h = harness(); mutate(h); await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership));
    assert.ok(h.calls.every(call => call.method !== 'DELETE'));
  }
});
test('foreign child, provider job, wrong file binding or incomplete discovery holds before file deletion', async () => {
  for (const mutate of [h => { h.tables.debate_v3_audit[0].actor_id = ID(99); },
    h => { h.tables.debate_v3_outbox[0].type = 'mail'; }, h => { h.tables.debate_v3_outbox[0].job.type = 'mail'; },
    h => { h.tables.debate_v3_outbox[0].result.storageKey = `exports/${ID(99)}/${ID(30)}.pdf`; }]) {
    const h = harness(); mutate(h); await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership));
    assert.ok(h.calls.every(call => call.method !== 'DELETE'));
  }
  const h = harness({ intercept: ({ url }) => url.pathname.endsWith('/debate_v3_events') ? { status: 200, body: [], range: '*/1' } : null });
  await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership), /HOSTED_INCOMPLETE_DISCOVERY/);
  assert.ok(h.calls.every(call => call.method !== 'DELETE'));
});
test('active outbox and changes during drain prevent every destructive operation', async () => {
  const active = harness(); active.tables.debate_v3_outbox[0].status = 'running';
  await assert.rejects(active.safety.cleanupEvents(active.record, active.ownership), /HOSTED_OUTBOX_STILL_RUNNING/);
  const drift = harness({ pauseChange: ({ tables }) => { tables.debate_v3_events[0].updated_at_ms++; } });
  await assert.rejects(drift.safety.cleanupEvents(drift.record, drift.ownership), /HOSTED_EVENT_CHANGED_AFTER_FENCE/);
  assert.ok([...active.calls, ...drift.calls].every(call => call.method !== 'DELETE'));
});
test('unconfirmed file absence holds event records; unknown delete response records exact intent without retry', async () => {
  for (const mode of ['present', 'unknown']) {
    const h = harness({ intercept: ({ url, method }) => {
      if (mode === 'present' && url.pathname.includes('/object/info/')) return { status: 200, body: {} };
      if (mode === 'unknown' && method === 'DELETE') throw new Error('UNKNOWN_DELETE');
    } });
    await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership));
    assert.equal(h.tables.debate_v3_events.length, 1); assert.equal(h.tables.debate_v3_outbox.length, 1);
    assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1); assert.equal(h.record.files[0].state, 'DELETE_REQUESTED');
  }
});
test('rate cleanup rejects unrelated actions and bucket windows even when no event exists', async () => {
  for (const mutation of [row => { row.action = 'billing'; }, row => { row.action = 'invitation_mail_minute'; }, row => { row.bucket = 0; }, row => { row.count = 0; }]) {
    const h = harness(); for (const name of Object.keys(h.tables)) if (name !== 'debate_v3_rate_limits') h.tables[name] = [];
    mutation(h.tables.debate_v3_rate_limits[0]); await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership), /HOSTED_RATE_LIMIT_SCOPE/);
    assert.ok(h.calls.every(call => call.method !== 'DELETE'));
  }
});
test('hash proof is deterministic while distinguishing changed state', () => {
  assert.equal(hostedHash({ a: 1, b: 2 }), hostedHash({ b: 2, a: 1 }));
  assert.notEqual(hostedHash({ a: 1 }), hostedHash({ a: 2 }));
});

test('a changed full receipt after capture aborts atomic deletion without deleting the changed database row', async () => {
  const h = harness({ intercept: ({ url, method, tables }) => {
    if (url.pathname.startsWith('/storage/v1/object/info/') && method === 'GET') tables.debate_v3_receipts[0].receipt.changedAfterCapture = true;
  } });
  await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership));
  assert.equal(h.tables.debate_v3_receipts.length, 1); assert.equal(h.tables.debate_v3_receipts[0].receipt.changedAfterCapture, true);
  assert.equal(h.tables.debate_v3_events.length, 1); assert.equal(h.tables.debate_v3_audit.length, 1);
  assert.equal(h.record.atomic.state, 'DELETE_REQUESTED');
});

test('unknown atomic and storage mutation outcomes never trigger blind retry on cleanup re-entry', async () => {
  for (const stage of ['storage', 'atomic']) {
    const h = harness({ intercept: ({ url, method, options }) => {
      if (stage === 'storage' && method === 'DELETE') throw new Error('UNKNOWN_STORAGE_RESULT');
      if (stage === 'atomic' && url.pathname.endsWith('/astra_staging_debate_cleanup_v1') && JSON.parse(options.body).p_expected) throw new Error('UNKNOWN_ATOMIC_RESULT');
    } });
    await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership));
    const writesBefore = h.calls.filter(call => call.method !== 'GET').length;
    await assert.rejects(h.safety.cleanupEvents(h.record, h.ownership), /HOSTED_(?:EVENT_REMAINS|STORAGE_OUTCOME_UNRESOLVED)/);
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, writesBefore); assert.equal(h.tables.debate_v3_events.length, 1);
  }
});

test('a lost successful atomic response is reconciled only by all exact event, child, actor and storage absence checks', async () => {
  const h = harness({ intercept: ({ url, options, tables }) => {
    if (url.pathname.endsWith('/astra_staging_debate_cleanup_v1') && JSON.parse(options.body).p_expected) {
      for (const table of Object.keys(tables)) tables[table] = []; throw new Error('LOST_SUCCESS_RESPONSE');
    }
  } });
  await h.safety.cleanupEvents(h.record, h.ownership);
  assert.equal(h.record.complete, true); assert.equal(h.record.helperVerified, false);
  assert.equal(h.record.atomic.originalResponseState, 'UNCONFIRMED');
  assert.equal(h.record.atomic.state, 'ABSENCE_RECONCILED_AFTER_UNCERTAIN_RESPONSE');
  assert.equal(h.calls.filter(call => call.route.endsWith('/astra_staging_debate_cleanup_v1') && JSON.parse(call.body).p_expected).length, 1);
  assert.ok(h.calls.some(call => call.method === 'GET' && call.route.includes('debate_v3_match_versions')));
});
