/** Pure checks and correction propagation for persisted fixture-to-match bindings. */
export class DebateFixtureError extends Error {
  constructor(code, message) { super(message); this.name = 'DebateFixtureError'; this.code = code; }
}
const need = (condition, code, message) => { if (!condition) throw new DebateFixtureError(code, message); };
const copy = value => structuredClone(value);
const SIDES = ['affirmative', 'negative'];
export const fixtureWasStarted = (fixture, match) => Boolean(fixture.startedAt || match?.rulesLockedAt || ['LIVE','PROVISIONAL','FINAL','CORRECTED'].includes(fixture.status));
export function getBoundFixture(event, match) {
  if (!match.fixtureId) return null;
  const fixture = event.fixtures.find(f => f.id === match.fixtureId);
  need(fixture && fixture.matchId === match.id, 'FIXTURE_BINDING_CONFLICT', 'This match must use its recorded published fixture.');
  need(SIDES.every(side => fixture[`${side}TeamId`] === match.teamIds[side]) && fixture.motionId === match.motionId, 'FIXTURE_ASSIGNMENT_CONFLICT', 'The saved fixture and match assignments differ; resolve the recorded fixture review.');
  return fixture;
}
export function requireResolvedFixture(event, fixture) {
  need(fixture && !fixture.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve the fixture review before preparing or starting this match.');
  need(fixture.status !== 'BYE', 'FIXTURE_IS_BYE', 'A bye advances without a played match or speech score.');
  need(fixture.affirmativeTeamId && fixture.negativeTeamId && fixture.affirmativeTeamId !== fixture.negativeTeamId, 'FIXTURE_PREDECESSORS_PENDING', 'Both distinct fixture participants must be resolved.');
  for (const side of SIDES) {
    const sourceId = fixture[`${side}Source`]; if (!sourceId) continue;
    const source = event.fixtures.find(f => f.id === sourceId);
    need(source && !source.requiresReview && ['FINAL','BYE'].includes(source.status) && source.winnerTeamId && source.winnerTeamId === fixture[`${side}TeamId`], 'FIXTURE_PREDECESSORS_PENDING', 'A dependent match requires the currently finalized predecessor winner.');
  }
  return fixture;
}
export function prepareFixtureBinding(event, payload) {
  if (!payload.fixtureId) return null;
  const fixture = requireResolvedFixture(event, event.fixtures.find(f => f.id === payload.fixtureId));
  need(fixture.status === 'SCHEDULED' && !fixture.matchId, 'FIXTURE_ALREADY_BOUND', 'This published fixture already has a match or is not ready to prepare.');
  for (const side of SIDES) need(!payload.teamIds?.[side] || payload.teamIds[side] === fixture[`${side}TeamId`], 'FIXTURE_ASSIGNMENT_CONFLICT', 'Use the exact published fixture teams.');
  need(!fixture.motionId || !payload.motionId || payload.motionId === fixture.motionId, 'FIXTURE_ASSIGNMENT_CONFLICT', 'Use the motion assigned to this fixture.');
  const motionId = fixture.motionId || payload.motionId;
  need(motionId && event.motions[motionId], 'MOTION_NOT_FOUND', 'Assign one of this event’s prepared motions before creating the fixture match.');
  need(SIDES.every(side => event.teams[fixture[`${side}TeamId`]]), 'TEAM_NOT_FOUND', 'Use the registered event teams.');
  return { fixtureId: fixture.id, motionId, teamIds: Object.fromEntries(SIDES.map(side => [side, fixture[`${side}TeamId`]])) };
}
/** An explicit rematch keeps bracket identity but preserves the unresolved played binding in history. */
export function transferFixtureToRematch(event, source, rematch, { at, actorId, reason }) {
  const fixture = getBoundFixture(event, source);
  if (!fixture) return null;
  need(!fixture.requiresReview && !fixture.winnerTeamId && !['FINAL','BYE'].includes(fixture.status), 'REMATCH_FIXTURE_NOT_READY', 'Only this unresolved fixture may be linked to a rematch.');
  need(SIDES.every(side => source.teamIds[side] === rematch.teamIds[side]), 'FIXTURE_ASSIGNMENT_CONFLICT', 'A rematch retains both teams and their disclosed sides.');
  const next = copy(fixture);
  next.rematchHistory ||= [];
  next.rematchHistory.push({ matchId: source.id, resultId: source.resultVersions.at(-1)?.id || null, resultRevision: source.resultVersions.at(-1)?.revision || null, motionId: fixture.motionId, startedAt: fixture.startedAt || null, previousStatus: fixture.status, replacementMatchId: rematch.id, at, actorId, reason });
  Object.assign(next, { matchId: rematch.id, motionId: rematch.motionId, boundAt: at, startedAt: null, status: 'SCHEDULED', winnerTeamId: null, resultId: null, resultRevision: null, resultKind: null });
  return next;
}
/** Block the entire descendant chain immediately; preserve every already-played assignment/result. */
export function markFixtureCorrection(fixtures, sourceId, { resultId, resultRevision, at, actorId, reason }) {
  const next = copy(fixtures), source = next.find(f => f.id === sourceId);
  need(source, 'FIXTURE_NOT_FOUND', 'The corrected match must retain its fixture binding.');
  source.status = 'CORRECTED'; source.supersededResultId = resultId;
  const visited = new Set([sourceId]), queue = [sourceId], affected = [];
  while (queue.length) {
    const parent = queue.shift();
    for (const fixture of next) if (!visited.has(fixture.id) && SIDES.some(side => fixture[`${side}Source`] === parent)) {
      visited.add(fixture.id); queue.push(fixture.id); affected.push(fixture.id);
      fixture.requiresReview = true;
      fixture.pendingCorrection = { sourceFixtureId: sourceId, supersededResultId: resultId, resultRevision, at, actorId, reason };
      if (!fixtureWasStarted(fixture)) fixture.status = 'AWAITING_PREDECESSORS';
    }
  }
  return { fixtures: next, affectedFixtureIds: affected };
}
