import { createHash } from 'node:crypto';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';

export const HOSTED_BUCKET = Object.freeze({ id: 'debate-private-v3', public: false,
  fileSizeLimit: 10485760, allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'] });
export const HOSTED_ACTOR_NAMES = Object.freeze(['host', 'A1', 'A2', 'A3', 'N1', 'N2', 'N3', 'judge2', 'judge3', 'observer', 'excluded']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const opaque = /^[a-zA-Z0-9:_-]{8,160}$/u;
const need = (value, code) => { if (!value) { const error = new Error(code); error.code = code; throw error; } };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hostedHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const same = (a, b) => hostedHash(a) === hostedHash(b);

// Callers supply only the fixed staging service transport; response bodies never
// enter evidence. This module imports no CLI and makes no request on import.
export function createHostedDataSafety({ supabaseUrl, service, persist, clock = Date.now,
  pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  need(supabaseUrl === FIXTURE_TARGET.supabaseUrl && typeof service === 'function' && typeof persist === 'function', 'HOSTED_SAFETY_SCOPE');
  async function rows(table, filters, limit = 1000) {
    need(/^debate_v3_(?:events|receipts|audit|match_versions|ballots|votes|outbox|uploads|rate_limits)$/u.test(table), 'HOSTED_TABLE_SCOPE');
    const query = new URLSearchParams({ ...filters, select: '*', limit: String(limit + 1) });
    const response = await service(`/rest/v1/${table}?${query}`, { headers: { Prefer: 'count=exact' } });
    const total = /^(?:\d+-\d+|\*)\/(\d+)$/u.exec(response.range || '');
    need(Array.isArray(response.body) && response.body.length <= limit && total && Number(total[1]) === response.body.length, 'HOSTED_INCOMPLETE_DISCOVERY');
    return response.body;
  }
  async function bucketPreflight() {
    const response = await service(`/storage/v1/bucket/${HOSTED_BUCKET.id}`, {}, [200, 400, 404]);
    if (response.status === 404 || (response.status === 400 && String(response.body?.statusCode) === '404'))
      return { status: 'ABSENT', bucketId: HOSTED_BUCKET.id, projectRef: FIXTURE_TARGET.projectRef };
    need(response.status === 200, 'HOSTED_BUCKET_LOOKUP_FAILED');
    const bucket = response.body;
    need(bucket?.id === HOSTED_BUCKET.id && bucket.name === HOSTED_BUCKET.id && bucket.public === false &&
      Number(bucket.file_size_limit) === HOSTED_BUCKET.fileSizeLimit &&
      Array.isArray(bucket.allowed_mime_types) && same([...bucket.allowed_mime_types].sort(), HOSTED_BUCKET.allowedMimeTypes), 'HOSTED_BUCKET_CONTRACT_MISMATCH');
    return { status: 'MATCHING_PRIVATE_BUCKET', bucketId: HOSTED_BUCKET.id, projectRef: FIXTURE_TARGET.projectRef,
      public: false, fileSizeLimit: HOSTED_BUCKET.fileSizeLimit, allowedMimeTypes: [...HOSTED_BUCKET.allowedMimeTypes] };
  }
  async function ensureBucket(record) {
    const before = await bucketPreflight();
    if (before.status === 'MATCHING_PRIVATE_BUCKET') return before;
    record.bucket = { ...before, creationState: 'REQUESTED' }; await persist();
    let uncertain = false;
    try { await service('/storage/v1/bucket', { method: 'POST', body: JSON.stringify({ id: HOSTED_BUCKET.id,
      name: HOSTED_BUCKET.id, public: false, file_size_limit: HOSTED_BUCKET.fileSizeLimit,
      allowed_mime_types: HOSTED_BUCKET.allowedMimeTypes }) }, [200, 201]); }
    catch { uncertain = true; }
    // Never retry a bucket mutation after an unknown response. A matching
    // readback safely resolves concurrent create or a lost successful response.
    const after = await bucketPreflight(); need(after.status === 'MATCHING_PRIVATE_BUCKET', 'HOSTED_BUCKET_CREATE_UNCONFIRMED');
    record.bucket = { ...after, creationState: uncertain ? 'MATCHING_READBACK_AFTER_UNCERTAIN_CREATE' : 'CREATED_AND_VERIFIED', retainedAsFeatureInfrastructure: true };
    await persist(); return record.bucket;
  }
  function validateFixtureSet(fixtures) {
    need(Array.isArray(fixtures) && fixtures.length > 0 && fixtures.length <= HOSTED_ACTOR_NAMES.length, 'HOSTED_FIXTURE_SET');
    need(fixtures.every(f => HOSTED_ACTOR_NAMES.includes(f.purpose) && uuid.test(f.id || '') && /^dv3study-[a-f0-9]{8}$/u.test(f.runId || '')) &&
      new Set(fixtures.map(f => f.id)).size === fixtures.length && new Set(fixtures.map(f => f.purpose)).size === fixtures.length, 'HOSTED_FIXTURE_SET');
    return new Set(fixtures.map(f => f.id));
  }
  function validateEvent(row, { fixtures, runTag, title }) {
    const actors = validateFixtureSet(fixtures), host = fixtures.find(f => f.purpose === 'host');
    need(/^dv3host-[a-f0-9]{16}$/u.test(runTag || '') && ['main', 'isolation'].some(suffix => title === `Hosted Debate ${runTag} ${suffix}`), 'HOSTED_EVENT_TAG');
    need(row && uuid.test(row.id || '') && row.owner_id === host?.id && row.state?.id === row.id &&
      row.state.ownerId === host.id && row.state.title === title && row.state.rehearsal === true && row.state.visibility === 'unlisted' &&
      Number.isSafeInteger(row.revision) && row.revision > 0 && row.state.revision === row.revision &&
      row.state.members && Object.keys(row.state.members).length > 0 && Object.keys(row.state.members).every(id => actors.has(id)) &&
      Object.values(row.state.members).every(member => member && actors.has(member.id)) &&
      Object.keys(row.state.media || {}).length === 0, 'HOSTED_EVENT_OWNERSHIP');
    return actors;
  }
  async function eventData(event, ownership) {
    const actors = validateEvent(event, ownership), tables = {};
    for (const table of ['uploads', 'outbox', 'receipts', 'audit', 'match_versions', 'ballots', 'votes']) {
      tables[table] = await rows(`debate_v3_${table}`, { event_id: `eq.${event.id}` });
      need(tables[table].every(row => row.event_id === event.id && (row.actor_id === undefined || actors.has(row.actor_id)) &&
        (row.judge_id === undefined || actors.has(row.judge_id))), 'HOSTED_FOREIGN_CHILD');
    }
    need(tables.outbox.every(job => ['export', 'delete_evidence', 'delete_export'].includes(job.type) &&
      job.job?.eventId === event.id && job.job.actorId === job.actor_id && job.job.id === job.id && job.job.type === job.type), 'HOSTED_JOB_SCOPE');
    const keys = new Set();
    for (const job of tables.outbox) {
      let key;
      if (job.type === 'export') {
        need(opaque.test(job.id) && ['pdf', 'csv'].includes(job.job.payload?.format), 'HOSTED_EXPORT_SCOPE');
        key = `exports/${event.id}/${job.id}.${job.job.payload.format}`;
        need(!job.result?.storageKey || job.result.storageKey === key, 'HOSTED_EXPORT_SCOPE');
      } else key = job.job.payload?.storageKey;
      need(typeof key === 'string' && (key.startsWith(`exports/${event.id}/`) || key.startsWith(`evidence/${event.id}/`)) &&
        /^(exports|evidence)\/[a-f0-9-]{36}\/(?:[a-zA-Z0-9:_-]{8,160}\/)?[a-zA-Z0-9_-]{8,160}\.(pdf|csv|png|jpg)$/u.test(key), 'HOSTED_FILE_SCOPE');
      keys.add(key);
    }
    for (const upload of tables.uploads) {
      need(uuid.test(upload.id) && actors.has(upload.actor_id) && upload.record?.id === upload.id &&
        upload.record.eventId === event.id && upload.record.actorId === upload.actor_id &&
        upload.record.matchId === upload.match_id && keys.has(upload.record.storageKey) &&
        tables.outbox.some(job => job.id === upload.cleanup_job_id && job.type === 'delete_evidence' &&
          job.job.payload.uploadId === upload.id && job.job.payload.storageKey === upload.record.storageKey), 'HOSTED_UPLOAD_SCOPE');
    }
    return { event, tables, keys: [...keys].sort() };
  }
  async function collectOwnedEvents({ fixtures, runTag, eventIntents }) {
    validateFixtureSet(fixtures);
    need(Array.isArray(eventIntents) && eventIntents.length <= 2, 'HOSTED_EVENT_INTENTS');
    const events = [];
    for (const fixture of fixtures) for (const event of await rows('debate_v3_events', { owner_id: `eq.${fixture.id}` }, 2)) {
      const intent = eventIntents.find(value => value.title === event.state?.title);
      need(intent && (!intent.id || intent.id === event.id), 'HOSTED_UNEXPECTED_OWNED_EVENT');
      validateEvent(event, { fixtures, runTag, title: intent.title });
      intent.id = event.id; intent.ownerId = event.owner_id; intent.creationState = 'EXACT_OWNED_EVENT_CONFIRMED';
      events.push({ event, intent });
    }
    for (const fixture of fixtures) {
      const membership = await rows('debate_v3_events', { state: `cs.${JSON.stringify({ members: { [fixture.id]: {} } })}` }, 2);
      need(membership.every(row => events.some(event => event.event.id === row.id)), 'HOSTED_FOREIGN_EVENT_MEMBERSHIP');
    }
    await persist(); return events;
  }
  async function removeFile(key, journal) {
    need(!journal.some(record => record.storageKey === key && record.state === 'DELETE_REQUESTED'), 'HOSTED_STORAGE_OUTCOME_UNRESOLVED');
    const record = { storageKey: key, state: 'DELETE_REQUESTED' }; journal.push(record); await persist();
    await service(`/storage/v1/object/${HOSTED_BUCKET.id}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [key] }) }, [200]);
    const absent = await service(`/storage/v1/object/info/${HOSTED_BUCKET.id}/${key}`, {}, [400, 404]);
    need(absent.status === 404 || (absent.status === 400 && (String(absent.body?.statusCode) === '404' || ['NoSuchKey', 'not_found'].includes(absent.body?.code))), 'HOSTED_FILE_DELETE_UNVERIFIED');
    record.state = 'DELETED_ABSENCE_VERIFIED'; await persist();
  }
  async function verifyAbsence({ fixtures, eventIds, storageKeys }) {
    for (const id of eventIds) {
      need((await rows('debate_v3_events', { id: `eq.${id}` }, 1)).length === 0, 'HOSTED_EVENT_REMAINS');
      for (const table of ['uploads','outbox','receipts','audit','match_versions','ballots','votes'])
        need((await rows(`debate_v3_${table}`, { event_id: `eq.${id}` })).length === 0, 'HOSTED_EVENT_CHILD_REMAINS');
    }
    for (const fixture of fixtures) {
      need((await rows('debate_v3_events', { owner_id: `eq.${fixture.id}` }, 2)).length === 0, 'HOSTED_EVENT_REMAINS');
      need((await rows('debate_v3_events', { state: `cs.${JSON.stringify({ members: { [fixture.id]: {} } })}` }, 2)).length === 0, 'HOSTED_EVENT_MEMBERSHIP_REMAINS');
      for (const [table, column] of [['uploads','actor_id'],['outbox','actor_id'],['receipts','actor_id'],['audit','actor_id'],
        ['ballots','judge_id'],['votes','actor_id'],['rate_limits','actor_id']])
        need((await rows(`debate_v3_${table}`, { [column]: `eq.${fixture.id}` })).length === 0, 'HOSTED_ACTOR_DATA_REMAINS');
    }
    for (const key of storageKeys) {
      const response = await service(`/storage/v1/object/info/${HOSTED_BUCKET.id}/${key}`, {}, [200, 400, 404]);
      need(response.status === 404 || (response.status === 400 && (String(response.body?.statusCode) === '404' ||
        ['NoSuchKey', 'not_found'].includes(response.body?.code))), 'HOSTED_FILE_DELETE_UNVERIFIED');
    }
  }
  async function cleanupEvents(record, { fixtures, runTag, eventIntents, sessionsFenced, forceAtomicProbe = false }) {
    need(!(record.files || []).some(file => file.state === 'DELETE_REQUESTED'), 'HOSTED_STORAGE_OUTCOME_UNRESOLVED');
    need(sessionsFenced === true && fixtures.every(f => f.signOutState === 'confirmed' && f.authDeniedBeforeCleanup && f.workerDeniedBeforeCleanup), 'HOSTED_SESSIONS_NOT_FENCED');
    validateFixtureSet(fixtures);
    if (record.atomic?.state === 'DELETE_REQUESTED') {
      need(same(record.atomic.fixtureIds, fixtures.map(f => f.id).sort()) && record.atomic.eventIds.every(id => eventIntents.some(intent => intent.id === id)), 'HOSTED_RECONCILIATION_SCOPE');
      await verifyAbsence({ fixtures, eventIds: record.atomic.eventIds, storageKeys: record.atomic.snapshot.storageKeys });
      record.atomic.originalResponseState = 'UNCONFIRMED'; record.atomic.state = 'ABSENCE_RECONCILED_AFTER_UNCERTAIN_RESPONSE';
      record.atomic.reconciledAt = new Date(clock()).toISOString(); record.complete = true; await persist(); return record;
    }
    record.events ||= []; record.deletions ||= []; record.files ||= [];
    const events = await collectOwnedEvents({ fixtures, runTag, eventIntents }), frozenEvents = [];
    for (const { event, intent } of events) {
      const ownership = { fixtures, runTag, title: intent.title }; let initial = await eventData(event, ownership);
      // Every known runner session has already been denied by live Auth and the
      // actual Worker. Allow accepted-before-logout work to drain, then require
      // a second exact snapshot with no active claims before any deletion.
      for (let attempts = 0; initial.tables.outbox.some(job => job.status === 'running') && attempts < 4; attempts++) {
        await pause(30000);
        const currentRows = await rows('debate_v3_events', { id: `eq.${event.id}` }, 1);
        need(currentRows.length === 1, 'HOSTED_EVENT_DISAPPEARED'); initial = await eventData(currentRows[0], ownership);
      }
      need(initial.tables.outbox.every(job => job.status !== 'running'), 'HOSTED_OUTBOX_STILL_RUNNING');
      await pause(32500); await pause(32500);
      const afterRows = await rows('debate_v3_events', { id: `eq.${event.id}` }, 1);
      need(afterRows.length === 1, 'HOSTED_EVENT_DISAPPEARED');
      const frozen = await eventData(afterRows[0], ownership);
      need(hostedHash(initial) === hostedHash(frozen) && frozen.tables.outbox.every(job => job.status !== 'running'), 'HOSTED_EVENT_CHANGED_AFTER_FENCE');
      record.events.push({ id: frozen.event.id, ownerId: frozen.event.owner_id, revision: frozen.event.revision, snapshotSha256: hostedHash(frozen),
        sessionFenceConfirmed: true, drainMilliseconds: 65000, capturedAt: new Date(clock()).toISOString() }); await persist();
      frozenEvents.push({ frozen, ownership, intent });
    }
    // Rate-limit rows are shared infrastructure; only exact fixture actors and
    // recognized Debate actions may be removed. Never delete by bucket age.
    const rateWindows = { discover_events: 60000, claim_invite: 60000, join_public_event: 60000, reserve_upload: 3600000 };
    const frozenRates = [];
    for (const fixture of fixtures) {
      const rates = await rows('debate_v3_rate_limits', { actor_id: `eq.${fixture.id}` });
      need(rates.every(row => { const window = rateWindows[row.action], createdAt = Date.parse(fixture.createdAt);
        return row.actor_id === fixture.id && window && Number.isFinite(createdAt) && Number.isSafeInteger(row.bucket) &&
          row.bucket >= Math.floor(createdAt / window) - 1 && row.bucket <= Math.floor(clock() / window) + 1 &&
          Number.isSafeInteger(row.count) && row.count > 0 && row.count <= 10000;
      }), 'HOSTED_RATE_LIMIT_SCOPE');
      frozenRates.push({ fixture, rates });
    }
    if (!forceAtomicProbe && !frozenEvents.length && frozenRates.every(value => value.rates.length === 0)) {
      record.complete = true; await persist(); return record;
    }
    const rpcManifest = { projectRef: FIXTURE_TARGET.projectRef, runTag,
      fixtures: fixtures.map(({ id, runId, purpose, createdAt }) => ({ id, runId, purpose, createdAt })),
      events: frozenEvents.map(({ frozen, intent }) => ({ id: frozen.event.id, title: intent.title })) };
    const expectedCounts = { events: frozenEvents.length, uploads: 0, outbox: 0, receipts: 0, audit: 0, match_versions: 0,
      ballots: 0, votes: 0, rate_limits: frozenRates.reduce((total, value) => total + value.rates.length, 0) };
    for (const { frozen } of frozenEvents) for (const [table, list] of Object.entries(frozen.tables)) expectedCounts[table] += list.length;
    const expectedKeys = [...new Set(frozenEvents.flatMap(({ frozen }) => frozen.keys))].sort();
    const endpoint = '/rest/v1/rpc/astra_staging_debate_cleanup_v1';
    const captured = await service(endpoint, { method: 'POST', body: JSON.stringify({ p_manifest: rpcManifest, p_expected: null }) });
    const snapshot = captured.body?.snapshot;
    need(captured.body?.status === 'CAPTURED' && snapshot?.version === 1 && /^[a-f0-9]{64}$/u.test(snapshot.manifestSha256 || '') &&
      /^[a-f0-9]{64}$/u.test(snapshot.snapshotSha256 || '') && same(snapshot.counts, expectedCounts) && same(snapshot.storageKeys, expectedKeys), 'HOSTED_ATOMIC_CAPTURE_CONTRACT');
    // Bind the server capture to the same full client rows on both sides of the
    // request. A changed value either fails this readback or the final native
    // server hash comparison before any database deletion.
    for (const { frozen, ownership } of frozenEvents) {
      const reread = await rows('debate_v3_events', { id: `eq.${frozen.event.id}` }, 1);
      need(reread.length === 1 && same(await eventData(reread[0], ownership), frozen), 'HOSTED_CHANGED_DURING_ATOMIC_CAPTURE');
    }
    for (const { fixture, rates } of frozenRates) need(same(await rows('debate_v3_rate_limits', { actor_id: `eq.${fixture.id}` }), rates), 'HOSTED_CHANGED_DURING_ATOMIC_CAPTURE');
    record.atomic = { state: 'CAPTURED', snapshot, fixtureIds: fixtures.map(f => f.id).sort(), eventIds: frozenEvents.map(({ frozen }) => frozen.event.id),
      lockScope: 'nine Debate tables only; SHARE ROW EXCLUSIVE',
      lockTimeoutMs: 5000, configuredStatementTimeoutMs: 20000, hostedPostgrestTimeoutHoistingVerified: false,
      targetIdentityVerifiedBy: 'fixed external staging transport' }; await persist();
    for (const key of expectedKeys) await removeFile(key, record.files);
    record.atomic.state = 'DELETE_REQUESTED'; await persist();
    let confirmed = false;
    try {
      const removed = await service(endpoint, { method: 'POST', body: JSON.stringify({ p_manifest: rpcManifest, p_expected: snapshot }) });
      confirmed = removed.body?.status === 'DELETED_ATOMICALLY' && same(removed.body.snapshot, snapshot) && same(removed.body.deletedCounts, expectedCounts);
    } catch { /* Retain only the unknown-response fact, never provider error text. */ }
    record.atomic.originalResponseState = confirmed ? 'CONFIRMED' : 'UNCONFIRMED'; await persist();
    await verifyAbsence({ fixtures, eventIds: record.atomic.eventIds, storageKeys: expectedKeys });
    for (const { intent } of frozenEvents) intent.cleanupState = 'EVENT_AND_FILES_ABSENT';
    record.helperVerified = confirmed;
    record.atomic.state = confirmed ? 'DELETED_ABSENCE_VERIFIED' : 'ABSENCE_RECONCILED_AFTER_UNCERTAIN_RESPONSE';
    if (!confirmed) record.atomic.reconciledAt = new Date(clock()).toISOString();
    record.complete = true; await persist(); return record;
  }
  return Object.freeze({ rows, bucketPreflight, ensureBucket, collectOwnedEvents, validateEvent, eventData, cleanupEvents });
}
