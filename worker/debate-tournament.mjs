/** Pure server-side bridge from finalized service records to the shared competition domain. */
import { SEATS, createRunOfShow, validateRules, validateClosingSeats, rubricFingerprint, tabulateBallots, normalizeScorecard, calculateNominationAward, calculateTournamentAwards } from './debate-domain.mjs';
import { applySanctions } from './debate-sanctions.mjs';

export class DebateTournamentError extends Error {
  constructor(code, message) { super(message); this.name = 'DebateTournamentError'; this.code = code; }
}
const copy = value => structuredClone(value);
const values = value => Array.isArray(value) ? value : Object.values(value || {});
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const need = (condition, code, message) => { if (!condition) throw new DebateTournamentError(code, message); };
const latest = match => match.resultVersions?.at(-1);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sameValue = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const decision = result => ({ winner: result.winner, status: result.status, judgingMode: result.judgingMode, teamScores: result.teamScores, ballotSplit: result.ballotSplit });
const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const exclude = (reason, message) => ({ eligible: false, reason, message });
const AWARDS = ['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker', 'bestDebater'];

function eligibilityProblem(match, result) {
  if (!result || result.state !== 'FINAL') return exclude('RESULT_NOT_FINAL', 'Only the latest finalized result can count.');
  if (latest(match)?.id !== result.id) return exclude('RESULT_SUPERSEDED', 'Historical or superseded versions do not count again.');
  if (result.resultKind !== 'normal' || !['affirmative', 'negative'].includes(result.winner)) return exclude('NOT_PLAYED_SCORED_RESULT', 'Byes, forfeits, withdrawals, cancellations and unresolved results do not create speech scores.');
  if (match.awardEligibilityReview || match.requiresReview || result.requiresReview) return exclude('ELIGIBILITY_REVIEW_REQUIRED', 'Actual speaker opportunities or this result require a recorded review.');
  if (values(match.protests).some(p => (p.state || p.status) === 'OPEN')) return exclude('PROTEST_UNRESOLVED', 'A disputed result is excluded while its procedure is under review.');
  return null;
}

function validatePinnedRecord(record, match, result) {
  need(record?.schemaVersion === 2 && record.id === match.id && record.resultId === result.id && record.resultRevision === result.revision && record.ruleVersion === result.ruleVersion, 'FINAL_RECORD_MISMATCH', 'The award record must refer to this exact finalized result and rule version.');
  need(record.matchStatus === 'FINAL' && record.resultKind === 'normal', 'FINAL_RECORD_MISMATCH', 'Only finalized played records are eligible.');
  const rules = validateRules(record.rules), closing = validateClosingSeats(record.closingSeats);
  need(rules.judgingMode !== 'simple', 'SIMPLE_MATCH_UNSCORED', 'Tournament awards require fully scored comparable matches.');
  need(record.rubric === rubricFingerprint(rules), 'RUBRIC_MISMATCH', 'The saved rubric fingerprint must match its rules.');
  const participants = SEATS.map(seat => record.seatParticipantIds?.[seat]);
  need(participants.every(validId) && new Set(participants).size === 6, 'SPEAKER_ATTRIBUTION_UNCONFIRMED', 'Six distinct actual participant identities are required.');
  need(Array.isArray(record.activeJudgeIds) && record.activeJudgeIds.length > 0 && record.activeJudgeIds.every(validId) && new Set(record.activeJudgeIds).size === record.activeJudgeIds.length && !record.activeJudgeIds.some(id => participants.includes(id)), 'JUDGE_ELIGIBILITY_UNCONFIRMED', 'Only an eligible independent assigned panel can supply scores.');
  const stages = createRunOfShow(rules, closing).filter(stage => stage.id.startsWith('stage-'));
  need(Array.isArray(record.completedStages) && record.completedStages.length === stages.length && stages.every(stage => {
    const saved = record.completedStages.find(s => s.stageId === stage.id);
    return saved && validId(saved.attemptId) && sameIds(saved.speakerIds, stage.speakerSeats.map(seat => record.seatParticipantIds[seat]));
  }), 'STAGES_INCOMPLETE', 'Every required speaking stage needs confirmed completion and speaker attribution.');
  const tally = tabulateBallots(record.ballots, rules, record.activeJudgeIds);
  need(tally.complete, 'FINAL_TALLY_MISMATCH', 'The pinned scorecards must include the complete finalized panel.');
  need(Array.isArray(record.sanctions) && sameValue(record.sanctions, result.sanctions), 'FINAL_SANCTIONS_MISMATCH', 'The pinned sanction history must equal the disclosed finalized history.');
  const adjusted = applySanctions(tally, record.sanctions, rules.sanctions);
  need(adjusted.adjustedTally.winner && sameValue(decision(adjusted.adjustedTally), decision(result)) && sameValue(record.officialDecision, decision(result)), 'FINAL_TALLY_MISMATCH', 'The raw scorecards and declared adjustments must reproduce the exact finalized decision.');
  need(sameValue(result.rawTally, adjusted.rawTally) && sameValue(result.adjustedTally, adjusted.adjustedTally) && sameValue(result.adjustments, adjusted.adjustments) && sameValue(result.adjustedTeamScores, adjusted.adjustedTeamScores) && result.awardBasis === 'raw_scorecards', 'FINAL_ADJUSTMENT_MISMATCH', 'The finalized raw and adjusted scores must match the independently recomputed disclosed adjustment.');
  need(record.ballots.every(ballot => ballot.round === record.ballotRound && ballot.submittedAt > 0), 'BALLOT_ROUND_MISMATCH', 'Only submitted ballots from the finalized round can count.');
  calculateNominationAward({ nominations: record.nominations, activeJudgeIds: record.activeJudgeIds });
  return { ...copy(record), rules, closingSeats: closing };
}

/** Capture once inside the finalization transaction. Never expose this private record in a snapshot. */
export function captureTournamentMatch(match, result = latest(match)) {
  try {
    const problem = eligibilityProblem(match, result); if (problem) return problem;
    need(validId(match.id) && validId(result.id) && Number.isSafeInteger(result.revision) && result.revision > 0, 'INVALID_FINAL_RECORD', 'Match and finalized revision identities are required.');
    need(result.ruleVersion === match.ruleVersion, 'RULE_VERSION_MISMATCH', 'Finalization must capture the accepted current rule version.');
    const rules = validateRules(match.rules); if (rules.judgingMode === 'simple') return exclude('SIMPLE_MATCH_UNSCORED', 'Simple matches have no numeric tournament score; per-match nomination awards remain separate.');
    const closingSeats = validateClosingSeats(match.closingSeats);
    const stages = createRunOfShow(rules, closingSeats).filter(stage => stage.id.startsWith('stage-'));
    const completedStages = stages.map(stage => {
      const attempt = values(match.attempts).filter(a => a.stageId === stage.id).at(-1);
      need(attempt?.state === 'FINISHED', 'STAGES_INCOMPLETE', 'An incomplete or replayed stage cannot be counted as a completed tournament performance.');
      need(sameIds(attempt.speakerIds, stage.speakerSeats.map(seat => match.seats?.[seat])), 'SPEAKER_ATTRIBUTION_UNCONFIRMED', 'A substitution or changed speaker needs explicit opportunity review.');
      return { stageId: stage.id, attemptId: attempt.id, speakerIds: copy(attempt.speakerIds) };
    });
    const ballots = values(match.ballots).filter(b => b.round === match.ballotRound && match.judgeIds.includes(b.judgeId)).map(b => ({
      judgeId: b.judgeId, round: b.round, submittedAt: b.submittedAt, scorecard: normalizeScorecard(b.scorecard, rules),
    }));
    const nominations = values(match.nominations).filter(n => match.judgeIds.includes(n.judgeId)).map(n => ({ judgeId: n.judgeId, nomineeId: n.nomineeId, reason: n.reason }));
    need(sameValue(match.sanctions || [], result.sanctions), 'FINAL_SANCTIONS_MISMATCH', 'Final capture must use the actual disclosed match sanction history.');
    const record = { schemaVersion: 2, id: match.id, resultId: result.id, resultRevision: result.revision, ruleVersion: result.ruleVersion,
      ballotRound: match.ballotRound, matchStatus: 'FINAL', resultKind: 'normal', rules, rubric: rubricFingerprint(rules),
      seatParticipantIds: Object.fromEntries(SEATS.map(seat => [seat, match.seats?.[seat]])), closingSeats,
      activeJudgeIds: copy(match.judgeIds), ballots, nominations, completedStages, sanctions: copy(result.sanctions), officialDecision: copy(decision(result)) };
    return { eligible: true, record: freeze(validatePinnedRecord(record, match, result)) };
  } catch (error) { if (!error.code) throw error; return exclude(error.code, error.message); }
}

function namedAwards(group, records, people) {
  const participantIds = [...new Set(records.flatMap(r => Object.values(r.seatParticipantIds)))].sort();
  const participant = id => ({ id, displayName: people.get(id)?.displayName || 'Participant' });
  const named = { ...copy(group), sourceResults: records.map(r => ({ matchId: r.id, resultId: r.resultId, resultRevision: r.resultRevision, rulesVersion: r.ruleVersion })),
    participants: participantIds.map(id => ({ ...participant(id), completedMatchCount: records.filter(r => Object.values(r.seatParticipantIds).includes(id)).length })) };
  for (const key of AWARDS) {
    const award = group[key], eligibility = award.eligibility || [];
    named[key] = { ...copy(award), scope: 'TOURNAMENT', winners: copy(award.winners || []), winnerParticipants: (award.winners || []).map(participant),
      candidates: (award.candidates || []).map(candidate => ({ ...copy(candidate), ...participant(candidate.id) })),
      eligibility: participantIds.map(id => {
        const row = eligibility.find(e => e.id === id) || { id, matchCount: 0, eligible: false };
        return { ...copy(row), ...participant(id), reason: row.eligible ? null : key === 'bestRebuttalSpeaker' ? 'Requires at least the minimum number of actual closing performances under this rubric.' : 'Requires at least the minimum number of fully scored comparable matches.' };
      }),
    };
  }
  return named;
}

/** Public aggregate only: no ballots, individual nominations, private reasons or draft notes leave this API. */
export function calculateEventTournamentAwards(event, { minimumMatches = 2, nominationRunoffs = [], includeRehearsal = false } = {}) {
  need(event && validId(event.id), 'INVALID_EVENT', 'An authoritative event record is required.');
  need(Number.isSafeInteger(minimumMatches) && minimumMatches >= 2 && minimumMatches <= 100, 'INVALID_MINIMUM_MATCHES', 'Tournament awards require at least two completed comparable matches.');
  need(Array.isArray(nominationRunoffs), 'INVALID_RUNOFF', 'Runoffs must be a list.');
  const base = { eventId: event.id, minimumMatches, scope: event.rehearsal ? 'REHEARSAL' : 'TOURNAMENT', rehearsal: !!event.rehearsal,
    realCompetitionEligible: !event.rehearsal, sourceResults: [], exclusions: [], invalidatedRunoffs: [], comparableGroups: [], nonComparableRubrics: false };
  if (event.rehearsal && !includeRehearsal) return { ...base, status: 'REHEARSAL_EXCLUDED', reason: 'Rehearsal records do not count toward real tournament awards.' };
  const matches = values(event.matches); need(matches.length <= 1000 && matches.every(m => validId(m.id)) && new Set(matches.map(m => m.id)).size === matches.length, 'INVALID_MATCHES', 'Use distinct event matches within the supported event limit.');
  const records = [];
  for (const match of matches) {
    const result = latest(match), problem = eligibilityProblem(match, result);
    if (problem) { base.exclusions.push({ matchId: match.id, resultId: result?.id || null, ...problem }); continue; }
    if (!result.tournamentRecord) { base.exclusions.push({ matchId: match.id, resultId: result.id, ...exclude('FINAL_RECORD_NOT_FROZEN', 'No private immutable tournament record was captured at finalization.') }); continue; }
    try { records.push(validatePinnedRecord(result.tournamentRecord, match, result)); }
    catch (error) { if (!error.code) throw error; base.exclusions.push({ matchId: match.id, resultId: result.id, ...exclude(error.code, error.message) }); }
  }
  base.sourceResults = records.map(r => ({ matchId: r.id, resultId: r.resultId, resultRevision: r.resultRevision, rulesVersion: r.ruleVersion, rubric: r.rubric }));
  const validRunoffs = [], seenRubrics = new Set();
  for (const runoff of nominationRunoffs) {
    need(runoff && typeof runoff.rubric === 'string' && !seenRubrics.has(runoff.rubric), 'INVALID_RUNOFF', 'Only one tournament nomination runoff may be saved per rubric.'); seenRubrics.add(runoff.rubric);
    const resultIds = records.filter(r => r.rubric === runoff.rubric).map(r => r.resultId);
    if (!resultIds.length || !sameIds(resultIds, runoff.resultIds)) { base.invalidatedRunoffs.push({ rubric: runoff.rubric, reason: 'SOURCE_RESULTS_CHANGED' }); continue; }
    validRunoffs.push({ rubric: runoff.rubric, activeJudgeIds: copy(runoff.activeJudgeIds), nominations: copy(runoff.nominations) });
  }
  const calculated = calculateTournamentAwards({ matches: records, minimumMatches, nominationRunoffs: validRunoffs });
  const people = new Map(values(event.members).map(person => [person.id, { displayName: typeof person.displayName === 'string' ? person.displayName.slice(0, 200) : 'Participant' }]));
  return { ...base, status: records.length ? 'CALCULATED' : 'UNAVAILABLE', nonComparableRubrics: calculated.nonComparableRubrics,
    comparableGroups: calculated.comparableGroups.map(group => {
      const named = namedAwards(group, records.filter(r => r.rubric === group.rubric), people);
      for (const key of AWARDS) named[key].scope = base.scope;
      return named;
    }) };
}
