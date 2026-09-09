/** Two complete service/SQL matches produce eligible tournament and sanctioned PDF records.
 * Local-only synthetic competition logic; never starts HTTP or contacts a provider.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRehearsalRuntime } from './serve-debate-rehearsal.mjs';
import { createDebateService } from '../worker/debate-service.mjs';
import { renderDebateDocument } from '../worker/debate-documents.mjs';

const runtime = await createRehearsalRuntime({ storeMode: 'pglite', autoProcessOutbox: false });
const steps = [], exports = [];
const denied = async () => { throw new Error('No external operation is allowed in this synthetic export test.'); };
const service = createDebateService({ store: runtime.store, now: runtime.now, limits: { maxParticipants: 10 }, adapters: {
  media: denied, mail: denied, invitation_mail: denied, upload: denied,
  export: async job => {
    const rendered = await renderDebateDocument(job.payload.document, { format: 'pdf' });
    const storageKey = `exports/${job.eventId}/${job.id}.pdf`, file = path.join(runtime.outputDir, storageKey);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, rendered.bytes);
    return { status: 'ready', downloadId: job.id, storageKey, filename: rendered.filename, mimeType: rendered.mimeType };
  },
} });
const host = runtime.actors[0], speakers = runtime.actors.slice(1, 7);
let eventId;
const command = async (name, payload = {}, actor = host) => {
  const event = eventId ? await runtime.store.read(eventId) : null;
  const result = await service.execute({ actor, eventId, command: name, payload, expectedRevision: event?.revision || 0, idempotencyKey: `synthetic-export-${randomUUID()}` });
  eventId ||= result.event.id;
  steps.push({ command: name, actorId: actor.id, matchId: payload.matchId || null, receiptId: result.receipt.id, revision: result.receipt.revision });
  return result;
};
const savedMatch = async matchId => (await runtime.store.read(eventId)).matches[matchId];
const policy = [{ id: 'declared-evidence-sanction', label: 'Declared evidence sanction', description: 'A manual ruling after review of evidence submitted outside the accepted conditions.', effect: 'team_point_deduction', points: '10.00' }];
const scorecard = { speakers: Object.fromEntries(['A1','A2','A3','N1','N2','N3'].map(seat => [seat, { evidence: seat[0] === 'A' ? 25 : 20, delivery: 30, questioning: 15, responding: 15 }])), closing: { affirmative: 15, negative: 12 } };
try {
  // The loopback rehearsal server remains unchanged and still requires rehearsal=true.
  // This separate service uses the disposable local database to test eligible competition logic.
  await command('create_event', { title: 'SYNTHETIC LOCAL EXPORT TEST', description: 'Synthetic identities and accelerated local service/SQL commands only. No real competition, media, email or deployment.', rehearsal: false });
  for (const actor of speakers) {
    const invitation = await command('create_invite', { role: 'debater', boundAccountId: actor.id });
    await command('claim_invite', { secret: invitation.receipt.result.secret }, actor);
    await command('check_in', {}, actor); await command('admit_member', { memberId: actor.id });
  }
  const a = await command('confirm_roster', { name: 'Synthetic team A', speakerIds: speakers.slice(0, 3).map(actor => actor.id), captainId: speakers[0].id });
  const n = await command('confirm_roster', { name: 'Synthetic team N', speakerIds: speakers.slice(3).map(actor => actor.id), captainId: speakers[3].id });
  const teamIds = { affirmative: a.receipt.result.teamId, negative: n.receipt.result.teamId }, matchIds = [];
  for (let round = 1; round <= 2; round++) {
    const motion = await command('add_motion', { title: `Synthetic export motion ${round}`, text: `This house would improve public access to learning materials. Local fixture ${round}.` });
    const created = await command('create_match', { title: `Synthetic scored match ${round}`, motionId: motion.receipt.result.motionId, teamIds, judgeIds: [host.id] });
    const matchId = created.receipt.result.matchId; matchIds.push(matchId);
    await command('update_rules', { matchId, rules: { judgingMode: 'aggregate', sanctions: policy } });
    for (const captain of [speakers[0], speakers[3]]) await command('acknowledge_rules', { matchId, ruleVersion: 2 }, captain);
    for (const actor of speakers) await command('record_device_check', { matchId, memberId: actor.id, microphone: false, camera: false, accommodation: 'Synthetic local export test: no physical device or provider is exercised.' });
    if (round === 2) await command('advance_match', { matchId: matchIds[0], nextMatchId: matchId });
    await command('start_match', { matchId });
    for (;;) {
      let match = await savedMatch(matchId); if (match.phase === 'deliberation') break;
      assert.equal(match.timer.state, 'READY');
      await command('claim_clock', { matchId, timerVersion: match.timer.version }); match = await savedMatch(matchId);
      await command('timer', { matchId, type: 'START', timerVersion: match.timer.version });
      await runtime.advance(match.timer.durationMs + 1); match = await savedMatch(matchId);
      await command('claim_clock', { matchId, timerVersion: match.timer.version }); match = await savedMatch(matchId);
      await command('finish_stage', { matchId, timerVersion: match.timer.version }); await command('next_stage', { matchId });
    }
    assert.equal((await savedMatch(matchId)).attempts.filter(attempt => attempt.stageId.startsWith('stage-') && attempt.state === 'FINISHED').length, 14);
    await command('record_sanction', { matchId, action: 'issue', sanctionId: policy[0].id, target: { side: 'affirmative' }, reason: `Synthetic local manual ruling ${round}; the separately disclosed 10-point team deduction does not change raw speech awards.`, confirmed: true });
    await command('open_ballots', { matchId }); await command('submit_ballot', { matchId, scorecard, confirmed: true }); await command('close_ballots', { matchId });
    await command('nominate_award', { matchId, nomineeId: 'A1', reason: 'Synthetic nomination for clear supported argument and responsive questioning.' });
    await command('publish_result', { matchId }); await runtime.advance(900001); await command('finalize_result', { matchId });
    const final = (await savedMatch(matchId)).resultVersions.at(-1);
    assert.equal(final.state, 'FINAL'); assert.equal(final.rawTally.winner, 'affirmative'); assert.equal(final.winner, 'negative');
    assert.equal(final.rawTally.teamScores.affirmative.display, '100.00'); assert.equal(final.adjustedTeamScores.affirmative.display, '90.00'); assert.equal(final.teamScores.negative.display, '92.00');
    assert.equal(final.awardBasis, 'raw_scorecards'); assert.equal(final.awards.bestDebater.winners[0], 'A1');
  }
  const snapshot = await service.snapshot({ actor: host, eventId }), awards = snapshot.event.eventAwards;
  assert.equal(awards.realCompetitionEligible, true); assert.equal(awards.sourceResults.length, 2, JSON.stringify(awards.exclusions)); assert.equal(awards.comparableGroups.length, 1);
  const group = awards.comparableGroups[0];
  for (const key of ['bestSpeaker','bestInterpellator','bestRebuttalSpeaker','bestDebater']) {
    assert.ok(group[key].winners.includes(speakers[0].id), `${key} must contain the actual participant identity`);
    assert.ok(group[key].eligibility.some(entry => entry.id === speakers[0].id && entry.eligible && entry.matchCount === 2));
  }
  const matchId = matchIds.at(-1);
  for (const kind of ['rules','result','event_report']) {
    const created = await command('create_export', { matchId, kind, format: 'pdf' });
    await service.processOutbox({ eventId, limit: 20 });
    const jobId = created.receipt.result.jobId, job = await runtime.store.readJob(jobId); assert.equal(job.status, 'completed', JSON.stringify(job));
    const authorized = await service.authorizeDownload({ actor: host, eventId, downloadId: jobId }), file = path.join(runtime.outputDir, authorized.storageKey), bytes = await readFile(file);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.equal(authorized.document.eventTitle, 'SYNTHETIC LOCAL EXPORT TEST');
    if (kind === 'event_report') assert.equal(authorized.document.eventAwards.comparableGroups.length, 1);
    await assert.rejects(service.authorizeDownload({ actor: speakers[0], eventId, downloadId: jobId }), error => error.code === 'FORBIDDEN');
    exports.push({ kind, file, jobId, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const report = { status: 'PASS_LOCAL_ELIGIBLE_TOURNAMENT_SANCTION_EXPORT', eventId, matchIds, steps, exports, sourceHashes: { ...runtime.manifest.sourceHashes, 'scripts/test-debate-tournament-export.mjs': createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex') }, tournamentAwards: awards,
    limitations: ['Synthetic local PGlite competition logic only; not a real competition record.', 'All fourteen stages in each match used accelerated time, not physical or endurance evidence.', 'No HTTP server, media provider, external email, hosted migration, load test or deployment.'] };
  await writeFile(path.join(runtime.outputDir, 'positive-tournament-sanctions-export.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, outputDir: runtime.outputDir, steps: steps.length, exports }));
} catch (error) {
  await writeFile(path.join(runtime.outputDir, 'positive-tournament-sanctions-export-failure.json'), JSON.stringify({ status: 'FAILED', eventId, steps, exports, sourceHashes: runtime.manifest.sourceHashes, error: { code: error.code || error.name, message: error.message } }, null, 2));
  console.error(JSON.stringify({ status: 'FAILED', outputDir: runtime.outputDir, code: error.code || error.name })); throw error;
} finally { await runtime.close(); }
