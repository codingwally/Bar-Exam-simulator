/** Service-role-only adapter. The injected rpc must use the existing server credential. */
export class DebateStoreError extends Error {
  constructor(code, message = code, details) { super(message); this.name = 'DebateStoreError'; this.code = code; this.details = details; }
}

export function createDebateStore({ rpc }) {
  if (typeof rpc !== 'function') throw new TypeError('A server-side RPC adapter is required.');
  async function call(name, args) {
    let response;
    try { response = await rpc(name, args); }
    catch { throw new DebateStoreError('STORE_UNAVAILABLE', 'Saved debate information is temporarily unavailable.'); }
    if (response?.error && typeof response.error === 'object') throw new DebateStoreError(response.error.code || 'STORE_UNAVAILABLE', 'Saved debate information is temporarily unavailable.');
    const data = response && Object.hasOwn(response, 'data') ? response.data : response;
    if (data?.error && typeof data.error === 'object') throw new DebateStoreError(data.error.code, data.error.message, data.error.details);
    return data;
  }
  return {
    read: eventId => call('debate_v3_read', { p_event_id: eventId }),
    list: actorId => call('debate_v3_list', { p_actor_id: actorId }),
    discover: (limit = 20, cursor = null) => call('debate_v3_discover', { p_limit: limit, p_cursor: cursor }),
    receipt: input => call('debate_v3_receipt', { p_request: input }),
    rateLimit: (actorId, action, now, limit, windowMs) => call('debate_v3_rate_limit', { p_actor_id: actorId, p_action: action, p_now: now, p_limit: limit, p_window_ms: windowMs }),
    commit: request => call('debate_v3_commit', { p_request: request }),
    claimJobs: (eventId, limit, now) => call('debate_v3_claim_jobs', { p_event_id: eventId, p_limit: limit, p_now: now }),
    finishJob: request => call('debate_v3_finish_job', { p_request: request }),
    readJob: jobId => call('debate_v3_read_job', { p_job_id: jobId }),
    activeEvents: (limit = 20, cursor = null, now = Date.now()) => call('debate_v3_active_events', { p_limit: limit, p_cursor: cursor, p_now: now }),
    reserveUpload: request => call('debate_v3_reserve_upload', { p_request: request }),
    readUpload: uploadId => call('debate_v3_read_upload', { p_upload_id: uploadId }),
    completeUpload: request => call('debate_v3_complete_upload', { p_request: request }),
    failUpload: request => call('debate_v3_fail_upload', { p_request: request }),
    expiredJobs: (eventId, now) => call('debate_v3_expired_jobs', { p_event_id: eventId, p_now: now }),
  };
}

/** Explicitly test-only durable-store double; never select it as a hosted fallback. */
export function createMemoryDebateStoreForTests() {
  const events = new Map(), receipts = new Map(), jobs = new Map(), history = [], rates = new Map(), uploads = new Map();
  let tail = Promise.resolve(), sweepCursor = null;
  const copy = value => value == null ? value : structuredClone(value);
  const key = p => [p.actorId, p.command, p.eventId, p.idempotencyKey].join('\u0000');
  const atomic = fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  const expires = (event, job) => Math.min(job.createdAt + (['export','invitation_mail'].includes(job.type) ? 7 : event.retention.operationalDays) * 86400000,
    event.endsAt && job.payload.document ? event.endsAt + (job.payload.document.kind === 'scorecard' ? event.retention.chatDays : event.retention.officialDays) * 86400000 : Infinity);
  const expiredJobs = (eventId, now) => {
    const event = events.get(eventId); if (!event?.retention.approved || event.retention.hold) return [];
    return [...jobs.values()].filter(j => j.eventId === eventId && (['export','mail','invitation_mail'].includes(j.type) || ['completed','cancelled'].includes(j.status)) && !j.payload.retentionPurgedAt && (j.status !== 'running' || j.leaseUntil < now - 60000) && expires(event, j) <= now).slice(0, 100);
  };
  return {
    testOnly: true,
    async read(id) { return copy(events.get(id) || null); },
    async list(actorId) { return copy([...events.values()].filter(e => e.members?.[actorId] && !e.members[actorId].removed)); },
    async discover(limit = 20, cursor = null) {
      const available = [...events.values()].filter(e => e.visibility === 'public' && !e.rehearsal && e.status !== 'completed' && (!cursor || e.id > cursor)).sort((a, b) => a.id.localeCompare(b.id));
      const publicEvents = available.slice(0, Math.max(1, Math.min(100, limit))).map(({ id, title, description, scheduledAt, timezone, language, status }) => ({ id, title, description, scheduledAt, timezone, language, status }));
      return copy({ events: publicEvents, nextCursor: available.length > publicEvents.length ? publicEvents.at(-1).id : null });
    },
    activeEvents: (limit = 20, _cursor = null, now = Date.now()) => atomic(() => {
      const active = [...events.values()].filter(e => (e.retention?.approved && !e.retention.hold && e.retention.nextCleanupAt != null && e.retention.nextCleanupAt <= now) || expiredJobs(e.id, now).length > 0 || Object.values(e.media || {}).some(s => s.status !== 'left') || [...jobs.values()].some(j => j.eventId === e.id && ['queued','failed','running'].includes(j.status) && (j.attempts < 10 || ['media', 'delete_evidence', 'delete_export'].includes(j.type)))).map(e => e.id).sort();
      let remaining = active.filter(id => !sweepCursor || id > sweepCursor); if (!remaining.length && sweepCursor) remaining = active;
      const eventIds = remaining.slice(0, Math.max(1, Math.min(100, limit))); sweepCursor = remaining.length > eventIds.length ? eventIds.at(-1) : null;
      return { eventIds, nextCursor: sweepCursor };
    }),
    async receipt(p) { const saved = receipts.get(key(p)); if (!saved) return null; if (saved.payloadHash !== p.payloadHash) throw new DebateStoreError('IDEMPOTENCY_CONFLICT'); return copy(saved.receipt); },
    async rateLimit(actorId, action, now, limit, windowMs) { const k = `${actorId}:${action}:${Math.floor(now / windowMs)}`; rates.set(k, (rates.get(k) || 0) + 1); return rates.get(k) <= limit; },
    reserveUpload: p => atomic(() => {
      const event = events.get(p.eventId), person = event?.members?.[p.actorId];
      if (!person?.admitted || person.removed || event.status === 'completed' || !event.matches[p.matchId]) throw new DebateStoreError('FORBIDDEN');
      const cleanupJobId = `upload-cleanup:${p.id}`;
      const record = { ...copy(p), status: 'reserved', cleanupJobId }; uploads.set(p.id, record);
      jobs.set(cleanupJobId, { id: cleanupJobId, eventId: p.eventId, matchId: p.matchId, actorId: p.actorId, type: 'delete_evidence', createdAt: p.createdAt,
        payload: { uploadId: p.id, matchId: p.matchId, storageKey: p.storageKey }, status: 'queued', attempts: 0, nextAttemptAt: p.expiresAt });
      return copy(record);
    }),
    async readUpload(uploadId) { return copy(uploads.get(uploadId) || null); },
    async expiredJobs(eventId, now) { return copy(expiredJobs(eventId, now)); },
    completeUpload: p => atomic(() => {
      const upload = uploads.get(p.id); if (!upload || upload.actorId !== p.actorId || upload.eventId !== p.eventId || !['reserved', 'uploaded'].includes(upload.status) || upload.expiresAt <= p.now) throw new DebateStoreError('UPLOAD_UNAVAILABLE');
      upload.status = 'uploaded'; upload.metadata = copy(p.metadata); return { uploaded: true, id: p.id };
    }),
    failUpload: p => atomic(() => {
      const upload = uploads.get(p.id); if (!upload || upload.actorId !== p.actorId || upload.eventId !== p.eventId) throw new DebateStoreError('FORBIDDEN');
      if (upload.status === 'retained') return { retained: true };
      upload.status = 'failed'; const job = jobs.get(upload.cleanupJobId); if (job.status !== 'running') job.status = 'queued'; job.nextAttemptAt = p.now; return { cleanupQueued: true };
    }),
    commit: p => atomic(() => {
      const saved = receipts.get(key(p));
      if (saved) { if (saved.payloadHash !== p.payloadHash) throw new DebateStoreError('IDEMPOTENCY_CONFLICT'); return copy(saved.receipt); }
      const previous = events.get(p.eventId);
      if ((previous?.revision || 0) !== p.expectedRevision) throw new DebateStoreError('REVISION_CONFLICT', 'This event changed. Refresh and review before trying again.', { revision: previous?.revision || 0 });
      if (!previous) {
        const recent = [...events.values()].filter(e => e.ownerId === p.actorId && e.createdAt > p.now - 3600000);
        if (recent.length >= 3) throw new DebateStoreError('EVENT_CREATION_LIMIT');
      }
      if (p.state.status === 'live' && previous?.status !== 'live' && [...events.values()].some(e => e.id !== p.eventId && e.ownerId === p.state.ownerId && e.status === 'live')) throw new DebateStoreError('LIVE_EVENT_LIMIT');
      for (const jobId of p.cancelJobs || []) { const job = jobs.get(jobId); if (!job || job.eventId !== p.eventId || !['queued', 'failed'].includes(job.status)) throw new DebateStoreError('JOB_ALREADY_RUNNING', 'This delivery has already started and cannot be cancelled.'); }
      for (const jobId of p.retryJobs || []) { const job = jobs.get(jobId); if (!job || job.eventId !== p.eventId || job.status !== 'failed') throw new DebateStoreError('JOB_NOT_READY', 'This delivery is not waiting for retry.'); }
      for (const uploadId of p.consumeUploads || []) { const upload = uploads.get(uploadId); if (!upload || upload.eventId !== p.eventId || upload.actorId !== p.actorId || upload.status !== 'uploaded' || upload.expiresAt <= p.now) throw new DebateStoreError('UPLOAD_UNAVAILABLE'); }
      if (p.retentionCleanup) {
        if (!previous?.retention.approved || previous.retention.hold || !['cleanup_records','__retention_cleanup'].includes(p.command)) throw new DebateStoreError('RETENTION_HOLD');
        for (const category of p.retentionCleanup.categories) if (!previous.endsAt || p.now < previous.endsAt + previous.retention[`${category}Days`] * 86400000) throw new DebateStoreError('RETENTION_NOT_DUE');
        const eligible = new Set(expiredJobs(p.eventId, p.now).map(j => j.id)); for (const jobId of p.retentionCleanup.jobIds) if (!eligible.has(jobId)) throw new DebateStoreError('JOB_ALREADY_RUNNING');
      }
      const next = copy(p.state); next.revision = p.expectedRevision + 1; events.set(p.eventId, next);
      const receipt = { ...p.receipt, revision: next.revision };
      receipts.set(key(p), { payloadHash: p.payloadHash, receipt: copy(receipt) });
      history.push(copy({ eventId: p.eventId, revision: next.revision, audit: p.audit, state: next }));
      for (const job of p.jobs || []) { if (!jobs.has(job.id)) jobs.set(job.id, copy({ ...job, status: 'queued', attempts: 0, nextAttemptAt: p.now })); }
      for (const id of p.cancelJobs || []) { const job = jobs.get(id); if (job?.eventId === p.eventId && ['queued', 'failed'].includes(job.status)) job.status = 'cancelled'; }
      for (const id of p.retryJobs || []) { const job = jobs.get(id); if (job?.eventId === p.eventId && job.status === 'failed') { job.status = 'queued'; job.nextAttemptAt = p.now; } }
      for (const id of p.consumeUploads || []) uploads.get(id).status = 'retained';
      if (p.retentionCleanup) {
        for (const jobId of p.retentionCleanup.jobIds) { const job = jobs.get(jobId); job.status = 'cancelled'; job.result = null; job.error = null; job.actorId = 'RETENTION_REDACTED'; job.payload = { retentionPurgedAt: p.now, format: job.payload.format }; for (const [uploadId, upload] of uploads) if (upload.cleanupJobId === jobId && ['retained','deleted'].includes(upload.status)) uploads.delete(uploadId); }
        if (p.retentionCleanup.categories.includes('operational') || p.retentionCleanup.categories.includes('evidence')) for (const [uploadId, upload] of uploads) if (upload.eventId === p.eventId && (upload.status === 'deleted' || p.retentionCleanup.categories.includes('evidence') && upload.status === 'retained')) uploads.delete(uploadId);
        for (const [receiptKey, entry] of receipts) if (entry.receipt.eventId === p.eventId && entry.receipt.committedAt < p.now - previous.retention.operationalDays * 86400000) receipts.delete(receiptKey);
      }
      return copy(receipt);
    }),
    claimJobs: (eventId, limit, now) => atomic(() => {
      const eligible = [...jobs.values()].filter(j => j.eventId === eventId && (['queued', 'failed'].includes(j.status) || (j.status === 'running' && j.leaseUntil < now)) && j.nextAttemptAt <= now && (j.attempts < 10 || ['media', 'delete_evidence', 'delete_export'].includes(j.type))).slice(0, limit);
      for (const job of eligible) { job.status = 'running'; job.attempts++; job.leaseUntil = now + 60000; job.claimId = crypto.randomUUID(); }
      return copy(eligible);
    }),
    finishJob: p => atomic(() => {
      const job = jobs.get(p.jobId); if (!job || job.claimId !== p.claimId || job.status !== 'running') throw new DebateStoreError('JOB_LEASE_CONFLICT');
      Object.assign(job, { status: p.status, result: copy(p.result), error: p.error, nextAttemptAt: p.now + Math.min(['media', 'delete_evidence', 'delete_export'].includes(job.type) ? 60000 : 3600000, 1000 * 2 ** Math.min(16, job.attempts)) });
      if (job.type === 'delete_evidence' && p.status === 'completed' && job.payload.uploadId) { const upload = uploads.get(job.payload.uploadId); if (upload && upload.status !== 'retained') upload.status = 'deleted'; }
      return copy(job);
    }),
    inspectForTests: () => copy({ events: [...events.values()], jobs: [...jobs.values()], history }),
    async readJob(jobId) { return copy(jobs.get(jobId) || null); },
  };
}
