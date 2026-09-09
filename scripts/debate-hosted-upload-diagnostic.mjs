/** One actual Worker upload inside the existing hosted fixture/deployment lifecycle. */
import { randomUUID, createHash } from 'node:crypto';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { summarizeHostedEvidenceUpload } from './test-debate-browser-hosted-organizer.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const EVENT = /^de-[a-f0-9]{32}$/u;
const ACTORS = ['host', 'A1', 'A2', 'A3', 'N1', 'N2', 'N3'];
const HASH = /^[a-f0-9]{40}$/u;
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const pdfObjects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>'];
let pdf = '%PDF-1.4\n% Empty diagnostic page; no personal data.\n'; const offsets = [0];
for (const [index, object] of pdfObjects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
export const UPLOAD_DIAGNOSTIC_FILE = Buffer.from(pdf);

export async function runHostedUploadDiagnostic({ lifecycle, workerUrl, sourceSha, workerVersion,
  persist, request = fetch, clock = Date.now, rememberSession = value => value } = {}) {
  need(workerUrl === FIXTURE_TARGET.workerUrl && HASH.test(sourceSha || '') && UUID.test(workerVersion || '')
    && typeof persist === 'function', 'UPLOAD_DIAGNOSTIC_CONTEXT_INVALID');
  const owned = lifecycle.snapshot();
  need(owned.sourceSha === sourceSha && /^dv3host-[a-f0-9]{16}$/u.test(owned.runTag || '')
    && owned.noMail === true && owned.noMediaProvider === true && owned.fixtures?.length === 11,
  'UPLOAD_DIAGNOSTIC_FIXTURES_INVALID');
  const report = { schemaVersion: 1, kind: 'HOSTED_SINGLE_UPLOAD_DIAGNOSTIC', status: 'RUNNING',
    sourceSha, workerVersion, startedAt: new Date(clock()).toISOString(), requests: [], upload: null,
    uploadAttempts: 0, completedTimerStages: 0, credentialsStored: false, rawBodiesStored: false,
    providerMedia: false, realMail: false, publicLaunch: false, fullAcceptance: false,
    deploymentScope: 'EXISTING_REVIEWED_STAGING_DEPLOYMENT_BY_PARENT_DRIVER',
    cleanupScope: 'EXISTING_EXACT_11_FIXTURE_LIFECYCLE_BY_PARENT_DRIVER',
    independentAbsence: 'PENDING_SEPARATE_POST_RUN_READBACK' };
  const began = clock(), sessions = {}, actors = {};
  let eventId, revision = 0;
  const save = () => persist(structuredClone(report));
  async function send(purpose, route, operation, options = {}) {
    need(clock() - began < 300000, 'UPLOAD_DIAGNOSTIC_DEADLINE');
    const observation = { operation, path: route.split('?')[0], status: null, outcome: 'REQUESTED' };
    report.requests.push(observation); await save();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (operation === 'single_evidence_upload') {
        need(report.uploadAttempts === 0, 'UPLOAD_DIAGNOSTIC_DUPLICATE_UPLOAD');
        report.uploadAttempts++;
      }
      const response = await request(workerUrl + route, { ...options, redirect: 'error', cache: 'no-store',
        headers: { Origin: workerUrl, Authorization: `Bearer ${sessions[purpose].access_token}`,
          'Content-Type': 'application/json', ...options.headers }, signal: controller.signal });
      observation.status = response.status;
      const reader = response.body?.getReader(), chunks = []; let size = 0;
      if (reader) for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 262144) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
      observation.outcome = 'RESPONSE_RECEIVED'; await save();
      return { response, body };
    } catch {
      observation.outcome = 'OUTCOME_UNKNOWN'; await save();
      // Never retry a command or upload after an unknown mutating response.
      throw Object.assign(new Error('UPLOAD_DIAGNOSTIC_REQUEST_UNKNOWN'), { code: 'UPLOAD_DIAGNOSTIC_REQUEST_UNKNOWN' });
    } finally { clearTimeout(timer); }
  }
  async function command(name, payload = {}, purpose = 'host') {
    const idempotencyKey = randomUUID();
    if (name === 'create_event') await lifecycle.recordEventIntent({ title: payload.title, idempotencyKey });
    const { response, body } = await send(purpose, '/debate-room/command', name, { method: 'POST',
      body: JSON.stringify({ command: name, payload, ...(eventId ? { eventId } : {}), expectedRevision: revision, idempotencyKey }) });
    need(response.status === 200 && body?.ok === true && EVENT.test(body.event?.id || '')
      && Number.isSafeInteger(body.event?.revision) && body.event.revision === revision + 1
      && (!eventId || body.event.id === eventId), 'UPLOAD_DIAGNOSTIC_SETUP_FAILED');
    eventId = body.event.id; revision = body.event.revision;
    if (name === 'create_event') {
      await lifecycle.recordEvent({ id: eventId, title: payload.title }); report.eventId = eventId; await save();
    }
    return body.receipt?.result;
  }
  try {
    await save();
    for (const purpose of ACTORS) {
      const fixture = owned.fixtures.find(item => item.purpose === purpose);
      need(UUID.test(fixture?.id || '') && fixture.registrationState === 'confirmed'
        && fixture.registrationReceipt?.registered === true && fixture.registrationReceipt?.fixtureUserId === fixture.id
        && fixture.registrationReceipt?.dataScope === 'internal_test', 'UPLOAD_DIAGNOSTIC_FIXTURES_INVALID');
      const session = rememberSession(await lifecycle.sessionFor(purpose));
      need(session?.user?.id === fixture.id && typeof session.access_token === 'string' && session.access_token.length > 80,
        'UPLOAD_DIAGNOSTIC_SESSION_INVALID');
      sessions[purpose] = session; actors[purpose] = fixture.id;
    }
    need(new Set(Object.values(actors)).size === ACTORS.length, 'UPLOAD_DIAGNOSTIC_FIXTURES_INVALID');
    await command('create_event', { title: `Hosted Debate ${owned.runTag} main`, rehearsal: true, visibility: 'unlisted' });
    for (const purpose of ACTORS.slice(1)) {
      const invitation = await command('create_invite', { role: 'debater', boundAccountId: actors[purpose] });
      need(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/u.test(invitation?.secret || ''), 'UPLOAD_DIAGNOSTIC_SETUP_FAILED');
      await command('claim_invite', { secret: invitation.secret }, purpose);
      await command('check_in', {}, purpose);
      await command('admit_member', { memberId: actors[purpose] });
    }
    const teams = {};
    for (const [side, seats] of [['affirmative', ['A1','A2','A3']], ['negative', ['N1','N2','N3']]]) {
      teams[side] = (await command('confirm_roster', { name: `Diagnostic ${side}`, speakerIds: seats.map(seat => actors[seat]),
        captainId: actors[seats[0]] }))?.teamId;
      need(UUID.test(teams[side] || ''), 'UPLOAD_DIAGNOSTIC_SETUP_FAILED');
    }
    const motionId = (await command('add_motion', { text: 'This house would keep practice materials accessible.' }))?.motionId;
    const matchId = (await command('create_match', { motionId, teamIds: teams, judgeIds: [actors.host] }))?.matchId;
    need(UUID.test(matchId || ''), 'UPLOAD_DIAGNOSTIC_SETUP_FAILED'); report.matchId = matchId;
    const before = await lifecycle.readEvent(eventId), match = before.matches?.[matchId];
    need(before.rehearsal === true && before.ownerId === actors.host && before.visibility === 'unlisted'
      && match?.phase === 'setup' && match.timer === null && match.attempts.length === 0
      && Object.keys(before.media || {}).length === 0, 'UPLOAD_DIAGNOSTIC_NOT_UNTIMED');
    await save();
    const expected = { mimeType: 'application/pdf', size: UPLOAD_DIAGNOSTIC_FILE.length, sha256: digest(UPLOAD_DIAGNOSTIC_FILE) };
    const { response, body } = await send('N1', `/debate-room/evidence/upload?${new URLSearchParams({ eventId, matchId, channel: 'public' })}`,
      'single_evidence_upload', { method: 'POST', body: UPLOAD_DIAGNOSTIC_FILE,
        headers: { 'Content-Type': expected.mimeType, 'X-Debate-Filename': 'staging-upload-diagnostic.pdf' } });
    report.upload = summarizeHostedEvidenceUpload({ status: response.status, contentType: response.headers.get('content-type'), body, expected });
    await save();
    need(report.upload.status === 200 && report.upload.ok === true && report.upload.contentType === 'application/json'
      && report.upload.errorCode === null && report.upload.uploadReceiptPresent === true
      && report.upload.attachmentMimeType === expected.mimeType && report.upload.attachmentSize === expected.size,
    'UPLOAD_DIAGNOSTIC_UPLOAD_REJECTED');
    need(clock() - began < 300000, 'UPLOAD_DIAGNOSTIC_DEADLINE');
    const after = await lifecycle.readEvent(eventId);
    need(after.matches?.[matchId]?.phase === 'setup' && after.matches[matchId].timer === null
      && after.matches[matchId].attempts.length === 0 && Object.keys(after.media || {}).length === 0,
    'UPLOAD_DIAGNOSTIC_NOT_UNTIMED');
    report.status = 'PASS_HOSTED_SINGLE_UPLOAD_ONLY';
  } catch (error) {
    report.status = 'FAIL_HOSTED_SINGLE_UPLOAD_DIAGNOSTIC';
    report.failureCode = /^UPLOAD_DIAGNOSTIC_[A-Z_]+$/u.test(error?.code || '') ? error.code : 'UPLOAD_DIAGNOSTIC_STEP_FAILED';
  } finally {
    report.finishedAt = new Date(clock()).toISOString(); report.elapsedMs = clock() - began; await save();
  }
  return report;
}
