/** Service-role-only adapter. The injected rpc must use the existing server credential. */
export class DebateStoreError extends Error {
  constructor(code, message = code, details) { super(message); this.name = 'DebateStoreError'; this.code = code; this.details = details; }
}

export function createDebateStore({ rpc }) {
  if (typeof rpc !== 'function') throw new TypeError('A server-side RPC adapter is required.');
  async function call(name, args) {
    const response = await rpc(name, args);
    if (response?.error) throw new DebateStoreError(response.error.code || 'STORE_UNAVAILABLE', 'Saved debate information is temporarily unavailable.');
    const data = response && Object.hasOwn(response, 'data') ? response.data : response;
    if (data?.error) throw new DebateStoreError(data.error.code, data.error.message, data.error.details);
    return data;
  }
  return {
    read: eventId => call('debate_v3_read', { p_event_id: eventId }),
    list: actorId => call('debate_v3_list', { p_actor_id: actorId }),
    receipt: input => call('debate_v3_receipt', { p_request: input }),
    rateLimit: (actorId, action, now, limit, windowMs) => call('debate_v3_rate_limit', { p_actor_id: actorId, p_action: action, p_now: now, p_limit: limit, p_window_ms: windowMs }),
    commit: request => call('debate_v3_commit', { p_request: request }),
    claimJobs: (eventId, limit, now) => call('debate_v3_claim_jobs', { p_event_id: eventId, p_limit: limit, p_now: now }),
    finishJob: request => call('debate_v3_finish_job', { p_request: request }),
    readJob: jobId => call('debate_v3_read_job', { p_job_id: jobId }),
  };
}

/** Explicitly test-only durable-store double; never select it as a hosted fallback. */
export function createMemoryDebateStoreForTests() {
  const events = new Map(), receipts = new Map(), jobs = new Map(), history = [], rates = new Map();
  let tail = Promise.resolve();
  const copy = value => value == null ? value : structuredClone(value);
  const key = p => [p.actorId, p.command, p.eventId, p.idempotencyKey].join('\u0000');
  const atomic = fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  return {
    testOnly: true,
    async read(id) { return copy(events.get(id) || null); },
    async list(actorId) { return copy([...events.values()].filter(e => e.members?.[actorId] && !e.members[actorId].removed)); },
    async receipt(p) { const saved = receipts.get(key(p)); if (!saved) return null; if (saved.payloadHash !== p.payloadHash) throw new DebateStoreError('IDEMPOTENCY_CONFLICT'); return copy(saved.receipt); },
    async rateLimit(actorId, action, now, limit, windowMs) { const k = `${actorId}:${action}:${Math.floor(now / windowMs)}`; rates.set(k, (rates.get(k) || 0) + 1); return rates.get(k) <= limit; },
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
      const next = copy(p.state); next.revision = p.expectedRevision + 1; events.set(p.eventId, next);
      const receipt = { ...p.receipt, revision: next.revision };
      receipts.set(key(p), { payloadHash: p.payloadHash, receipt: copy(receipt) });
      history.push(copy({ eventId: p.eventId, revision: next.revision, audit: p.audit, state: next }));
      for (const job of p.jobs || []) { if (!jobs.has(job.id)) jobs.set(job.id, copy({ ...job, status: 'queued', attempts: 0, nextAttemptAt: p.now })); }
      for (const id of p.cancelJobs || []) { const job = jobs.get(id); if (job?.eventId === p.eventId && ['queued', 'failed'].includes(job.status)) job.status = 'cancelled'; }
      for (const id of p.retryJobs || []) { const job = jobs.get(id); if (job?.eventId === p.eventId && job.status === 'failed') { job.status = 'queued'; job.nextAttemptAt = p.now; } }
      return copy(receipt);
    }),
    claimJobs: (eventId, limit, now) => atomic(() => {
      const eligible = [...jobs.values()].filter(j => j.eventId === eventId && (['queued', 'failed'].includes(j.status) || (j.status === 'running' && j.leaseUntil < now)) && j.nextAttemptAt <= now && j.attempts < 10).slice(0, limit);
      for (const job of eligible) { job.status = 'running'; job.attempts++; job.leaseUntil = now + 60000; job.claimId = crypto.randomUUID(); }
      return copy(eligible);
    }),
    finishJob: p => atomic(() => {
      const job = jobs.get(p.jobId); if (!job || job.claimId !== p.claimId || job.status !== 'running') throw new DebateStoreError('JOB_LEASE_CONFLICT');
      Object.assign(job, { status: p.status, result: copy(p.result), error: p.error, nextAttemptAt: p.now + Math.min(3600000, 1000 * 2 ** job.attempts) });
      return copy(job);
    }),
    inspectForTests: () => copy({ events: [...events.values()], jobs: [...jobs.values()], history }),
    async readJob(jobId) { return copy(jobs.get(jobId) || null); },
  };
}
