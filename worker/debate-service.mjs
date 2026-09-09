import * as domain from './debate-domain.mjs';
import { assertSanctionPolicyChange, appendSanction, applySanctions } from './debate-sanctions.mjs';
import { captureTournamentMatch, calculateEventTournamentAwards } from './debate-tournament.mjs';
import { fixtureWasStarted, getBoundFixture, requireResolvedFixture, prepareFixtureBinding, markFixtureCorrection, transferFixtureToRematch } from './debate-fixtures.mjs';

export class DebateServiceError extends Error {
  constructor(code, message = code, details) { super(message); this.name = 'DebateServiceError'; this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new DebateServiceError(code, message, details); };
const need = (condition, code, message, details) => { if (!condition) fail(code, message, details); };
const clone = value => structuredClone(value);
const id = () => crypto.randomUUID();
const sides = ['affirmative', 'negative'];
const seatNames = ['A1', 'A2', 'A3', 'N1', 'N2', 'N3'];
const roleNames = new Set(['host', 'cohost', 'moderator', 'timekeeper', 'chief', 'judge', 'debater', 'coach', 'reserve', 'observer']);
const text = (value, max = 2000, required = false) => {
  need(typeof value === 'string' || (!required && value == null), 'INVALID_TEXT', 'Use ordinary text for this field.');
  const result = (value || '').normalize('NFC').trim();
  need(result.length <= max && (!required || result.length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result), 'INVALID_TEXT', 'This text is empty, too long, or contains unsupported control characters.');
  return result;
};
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
const randomCode = (length = 12) => {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let result = '';
  for (const byte of bytes) { if (byte < 248 && result.length < length) result += alphabet[byte % alphabet.length]; }
  return result.length === length ? result : randomCode(length);
};
const member = (event, actorId) => {
  const value = event.members?.[actorId];
  need(value && !value.removed, 'NOT_MEMBER', 'You are not an active member of this event.');
  return value;
};
const organizer = (event, actorId) => member(event, actorId).roles.some(role => ['host', 'cohost'].includes(role));
const requireOrganizer = (event, actorId) => need(organizer(event, actorId), 'FORBIDDEN', 'Only an event organizer can do this.');
const matchOf = (event, payload) => {
  const match = event.matches?.[payload.matchId || event.activeMatchId];
  need(match, 'MATCH_NOT_FOUND', 'Choose an existing match.');
  return match;
};
const participantSide = (match, actorId) => sides.find(side => seatNames.filter(s => s[0] === (side === 'affirmative' ? 'A' : 'N')).some(s => match.seats[s] === actorId));
const isJudge = (match, actorId) => match.judgeIds.includes(actorId) && !participantSide(match, actorId);
const official = (event, match, actorId) => organizer(event, actorId) || [match.chiefId, match.moderatorId].includes(actorId);
const requireOfficial = (event, match, actorId) => need(official(event, match, actorId), 'FORBIDDEN', 'An assigned official must perform this action.');
const requirePanelAdmin = (event, match, actorId) => need(organizer(event, actorId) || match.chiefId === actorId, 'FORBIDDEN', 'An organizer or chief adjudicator must perform this action.');
const requireAcknowledgments = match => need(!match.rulesLockedAt || sides.every(side => match.acknowledgments[side]?.ruleVersion === match.ruleVersion && match.acknowledgments[side]?.actorId === match.captains[side]), 'RULES_ACKNOWLEDGMENT_REQUIRED', 'Both current captains must acknowledge the current rules.');
const currentStage = match => match.runOfShow?.[match.currentStageIndex];
const activeSeats = match => currentStage(match)?.speakerSeats || [];
const mutableSetup = match => need(!match.rulesLockedAt, 'RULES_LOCKED', 'Use a disclosed rules amendment after this match has started.');
const liveMatch = match => need(['live', 'preparation', 'break', 'deliberation'].includes(match.phase), 'MATCH_NOT_READY', 'This match is not in an active phase.');
const mapValues = object => Object.values(object || {});
const privatePhase = match => ['preparation', 'break'].includes(currentStage(match)?.kind);
const DAY = 86400000;
function retentionDeadline(event) {
  if (!event.retention?.approved || event.retention.hold) return null;
  const deadlines = [];
  for (const category of ['operational', 'chat', 'evidence', 'official']) if (event.endsAt && !event.retention.purged?.[category]) deadlines.push(event.endsAt + event.retention[`${category}Days`] * DAY);
  for (const job of mapValues(event.jobs)) if (!job.retentionPurgedAt && (['export', 'mail', 'invitation_mail'].includes(job.type) || ['completed','cancelled'].includes(job.status))) deadlines.push(job.createdAt + (['export','invitation_mail'].includes(job.type) ? 7 : event.retention.operationalDays) * DAY);
  return deadlines.length ? Math.min(...deadlines) : null;
}
function eventTimezone(value) {
  const timezone = text(value, 80, true);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { fail('INVALID_TIMEZONE', 'Choose a valid event timezone.'); }
  return timezone;
}
function eventSchedule(value) {
  if (value == null) return null;
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)), 'INVALID_SCHEDULE', 'Enter a valid scheduled date, time, and timezone offset.');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number), calendar = new Date(Date.UTC(year, month - 1, day));
  need(calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day, 'INVALID_SCHEDULE', 'Enter a valid calendar date.');
  return new Date(value).toISOString();
}
function emailAddress(value) {
  const email = text(value, 254, true).toLowerCase();
  need(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email), 'INVALID_EMAIL', 'Enter a valid email address.');
  return email;
}
function eventContact(value) {
  if (value == null) return null;
  need(typeof value === 'object' && !Array.isArray(value), 'INVALID_CONTACT', 'Enter an organizer contact.');
  const contact = { name: text(value.name, 120), email: value.email ? emailAddress(value.email) : '', url: text(value.url, 2048) };
  if (contact.url) {
    let url; try { url = new URL(contact.url); } catch { fail('INVALID_CONTACT', 'Enter a valid organizer contact URL.'); }
    need(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'INVALID_CONTACT', 'Use an HTTP or HTTPS contact URL without embedded credentials.');
    contact.url = url.href;
  }
  return Object.values(contact).some(Boolean) ? contact : null;
}
function recordMatchAttendance(match, memberId, at, source) {
  need(!['provisional','final','expired'].includes(match.phase) && !match.exceptionalConclusion, 'MATCH_ALREADY_CONCLUDED', 'Participation must be checked in before this match concludes.');
  match.checkIns ||= {};
  const previous = match.checkIns[memberId];
  match.checkIns[memberId] = { memberId, firstCheckedInAt: previous?.firstCheckedInAt ?? at, lastCheckedInAt: at, source };
}
function matchCheckIn(match, now) {
  const scheduledAt = match.scheduledCheckInAt || null, graceMs = match.rules.noShowGraceMs;
  const deadlineAt = scheduledAt ? Date.parse(scheduledAt) + graceMs : null;
  return { scheduledAt, graceMs, deadlineAt, state: deadlineAt == null ? 'UNSCHEDULED' : now < Date.parse(scheduledAt) ? 'UPCOMING' : now < deadlineAt ? 'GRACE_PERIOD' : 'GRACE_ELAPSED', attendance: clone(match.checkIns || {}), findings: (match.noShowFindings || []).map(f => ({ ...clone(f), status: match.checkIns?.[f.memberId] ? 'ARRIVED_AFTER_FINDING' : 'ABSENT' })) };
}

function canChannel(event, match, actorId, channel, writing = false) {
  const me = member(event, actorId);
  if (!me.admitted) return false;
  if (channel === 'public' || channel === 'technical') return me.admitted && (channel !== 'public' || !writing || !match.quietObservers || participantSide(match, actorId) || official(event, match, actorId) || isJudge(match, actorId));
  if (channel === 'judges') return isJudge(match, actorId);
  if (!['team:affirmative', 'team:negative'].includes(channel)) return false;
  const side = channel.split(':')[1];
  const teamId = match.teamIds[side];
  if (participantSide(match, actorId) !== side && !(me.teamId === teamId && me.roles.some(r => ['coach', 'reserve'].includes(r)))) return false;
  if (!writing) return true;
  if (privatePhase(match) || !match.rulesLockedAt) return true;
  if (me.roles.includes('coach')) return false;
  return !activeSeats(match).some(seat => match.seats[seat] === actorId);
}

function neutralController(event, match, actorId) {
  need(official(event, match, actorId) || match.timekeeperId === actorId, 'FORBIDDEN', 'An assigned clock official must perform this action.');
  need(!activeSeats(match).some(seat => match.seats[seat] === actorId), 'FORBIDDEN', 'A neutral official must control your speaking stage.');
}

function allowedSources(event, match, actorId, space, time = Date.now()) {
  const me = member(event, actorId);
  const sources = [];
  if (match.rules.observerCameras !== false || participantSide(match, actorId) || isJudge(match, actorId) || official(event, match, actorId)) sources.push('camera');
  if (space !== 'main' || activeSeats(match).some(seat => match.seats[seat] === actorId) || actorId === match.moderatorId || match.floorGrants?.[actorId]?.expiresAt > time) sources.push('microphone');
  if (match.presenterId === actorId || (space !== 'main' && (participantSide(match, actorId) || isJudge(match, actorId)))) sources.push('screen_share', 'screen_share_audio');
  return sources;
}

function privateInvitationActive(event, match, invitation) {
  if (event.status === 'completed' || !invitation || invitation.revokedAt || invitation.phase !== match.phase || invitation.stageAttemptId !== (match.attempts.at(-1)?.id || null)) return false;
  const guest = event.members[invitation.moderatorId], inviter = event.members[invitation.invitedBy];
  if (!guest?.admitted || !guest.checkedIn || guest.removed || !inviter?.admitted || inviter.removed || match.moderatorId !== guest.id || participantSide(match, guest.id) || guest.teamId && Object.values(match.teamIds).includes(guest.teamId)) return false;
  return invitation.space === 'judges' ? match.phase === 'deliberation' && isJudge(match, inviter.id) : sides.includes(invitation.space) && privatePhase(match) && match.captains[invitation.space] === inviter.id;
}
function authorizeSpace(event, match, actorId, space) {
  const me = member(event, actorId);
  need(event.status !== 'completed', 'EVENT_ENDED', 'This event has ended. Its saved records remain available.');
  need(me.admitted && me.checkedIn, 'FORBIDDEN', 'Check in and wait for admission before joining media.');
  if (space === 'main') return;
  const invited = mapValues(match.privateRoomInvitations).some(invitation => invitation.moderatorId === actorId && invitation.space === space && privateInvitationActive(event, match, invitation));
  if (space === 'judges') { need((isJudge(match, actorId) || invited) && match.phase === 'deliberation', 'FORBIDDEN', 'Only assigned judges or their explicitly invited neutral moderator can enter deliberation.'); return; }
  need(sides.includes(space) && privatePhase(match), 'FORBIDDEN', 'Team preparation rooms open during preparation and the declared break.');
  need(invited || participantSide(match, actorId) === space || (me.teamId === match.teamIds[space] && me.roles.some(r => ['coach', 'reserve'].includes(r))), 'FORBIDDEN', 'This preparation room belongs to the other team.');
}

function readiness(event, match) {
  const issues = [];
  const speakers = seatNames.map(seat => match.seats[seat]);
  if (speakers.some(actorId => !actorId) || new Set(speakers).size !== 6) issues.push('Confirm six distinct speakers in the six seats.');
  for (const side of sides) {
    const sideSeats = seatNames.filter(seat => seat[0] === (side === 'affirmative' ? 'A' : 'N'));
    if (!sideSeats.includes(match.closingSeats[side]) || !match.seats[match.closingSeats[side]]) issues.push(`Confirm the ${side} closing speaker.`);
    if (!sideSeats.some(seat => match.seats[seat] === match.captains[side])) issues.push(`Confirm the ${side} captain.`);
    if (match.acknowledgments[side]?.ruleVersion !== match.ruleVersion) issues.push(`The ${side} captain must accept the current rules and sides.`);
  }
  if (!match.judgeIds.length || new Set(match.judgeIds).size !== match.judgeIds.length || match.judgeIds.some(actorId => speakers.includes(actorId))) issues.push('Assign eligible independent judges.');
  if (match.judgeIds.length % 2 === 0 && !match.evenPanelAccepted) issues.push('Accept the even-panel tie warning.');
  if (![match.moderatorId, match.timekeeperId].some(actorId => actorId && !speakers.includes(actorId))) issues.push('Assign a neutral moderator or timekeeper.');
  if (!event.motions[match.motionId]?.text) issues.push('Set a motion ready for release.');
  for (const actorId of [...speakers, ...match.judgeIds, match.moderatorId, match.timekeeperId].filter(Boolean)) {
    const person = event.members[actorId];
    if (!person || person.removed || !person.admitted || !person.checkedIn) issues.push('All required speakers and officials must be checked in and admitted.');
  }
  for (const actorId of speakers) if (!match.deviceChecks[actorId]?.microphone && !match.accommodations[actorId]?.reason) issues.push('A speaker needs a microphone check or recorded accommodation.');
  return { ready: issues.length === 0, issues: [...new Set(issues)] };
}

function validateAssignments(event, match) {
  const speakers = Object.values(match.seats).filter(Boolean);
  need(new Set(speakers).size === speakers.length, 'ROLE_CONFLICT', 'Each speaking seat needs a different person.');
  need(match.judgeIds.every(actorId => !speakers.includes(actorId)), 'ROLE_CONFLICT', 'A competitor cannot judge their own match.');
  need(!match.chiefId || match.judgeIds.includes(match.chiefId), 'ROLE_CONFLICT', 'The chief adjudicator must be one of the assigned judges.');
  for (const actorId of [...speakers, ...match.judgeIds, match.moderatorId, match.timekeeperId].filter(Boolean)) member(event, actorId);
  for (const other of mapValues(event.matches)) {
    if (other.id === match.id || !['live', 'preparation', 'break', 'deliberation'].includes(other.phase)) continue;
    const assigned = new Set([...Object.values(other.seats), ...other.judgeIds]);
    need(![...speakers, ...match.judgeIds].some(actorId => assigned.has(actorId)), 'ROLE_CONFLICT', 'A participant is assigned to another active match.');
  }
}
function validateRoster(event, payload, teamId) {
  need(Array.isArray(payload.speakerIds) && payload.speakerIds.length === 3 && new Set(payload.speakerIds).size === 3 && payload.speakerIds.includes(payload.captainId), 'INVALID_ROSTER', 'Confirm three distinct registered speakers and a captain among them.');
  for (const actorId of payload.speakerIds) {
    member(event, actorId);
    need(!mapValues(event.teams).some(team => team.id !== teamId && team.speakerIds.includes(actorId)), 'ROLE_CONFLICT', 'A speaker cannot occupy two event teams.');
  }
}

function snapshotEvent(event, actorId, now) {
  const me = member(event, actorId), host = organizer(event, actorId);
  const conflictReviewer = host || mapValues(event.matches).some(match => match.chiefId === actorId);
  if (!me.admitted) return {
    id: event.id, revision: event.revision, title: event.title, description: event.description, timezone: event.timezone,
    language: event.language, scheduledAt: event.scheduledAt, visibility: event.visibility, rehearsal: event.rehearsal, status: event.status,
    myId: actorId, awaitingAdmission: true, members: [{ id: me.id, displayName: me.displayName, roles: me.roles, admitted: false, checkedIn: me.checkedIn }],
    activeMatchId: null, matches: [], teams: [], motions: [], fixtures: [], invites: [], outbox: [],
  };
  const result = {
    id: event.id, revision: event.revision, title: event.title, description: event.description, timezone: event.timezone, language: event.language,
    scheduledAt: event.scheduledAt, visibility: event.visibility, rehearsal: event.rehearsal, status: event.status, createdAt: event.createdAt,
    ownerId: event.ownerId, activeMatchId: event.activeMatchId, retention: event.retention, contact: clone(event.contact || null),
    members: mapValues(event.members).filter(p => !p.removed || host).map(({ id, displayName, roles, teamId, checkedIn, admitted, removed, conflictDeclarations }) => ({ id, displayName, roles, teamId, checkedIn, admitted, removed, ...(conflictReviewer || id === actorId ? { conflictDeclarations } : {}) })),
    teams: mapValues(event.teams).map(team => clone(team)),
    motions: mapValues(event.motions).filter(m => host || m.releasedAt).map(({ id, title, text, releasedAt, version }) => ({ id, title, text, releasedAt, version })),
    fixtures: clone(event.fixtures || []), ...(host ? { fixtureDraft: clone(event.fixtureDraft || null) } : {}), standings: clone(event.standings || null), eventAwards: calculateEventTournamentAwards(event, { nominationRunoffs: event.tournamentNominationRunoffs || [] }), myId: actorId,
    invites: host ? mapValues(event.invites).map(({ id, role, teamId, expiresAt, revokedAt, usedBy, requiresApproval }) => ({ id, role, teamId, expiresAt, revokedAt, usedBy, requiresApproval })) : [],
    outbox: mapValues(event.jobs).filter(j => j.actorId === actorId || host).map(({ id, type, status, createdAt, resultVersion, error, downloadId, recipientLabel }) => ({ id, type, status, createdAt, resultVersion, error, downloadId, ...(recipientLabel ? { recipientLabel } : {}) })),
    matches: [],
  };
  for (const match of mapValues(event.matches)) {
    if (match.officialRecordsExpired) { result.matches.push({ id: match.id, title: match.title, phase: 'expired', officialRecordsExpired: true }); continue; }
    const judge = isJudge(match, actorId), panelAdmin = host || match.chiefId === actorId;
    let mediaSpace = 'main';
    const viewerMedia = event.media[actorId];
    if (viewerMedia?.matchId === match.id && viewerMedia.expiresAt > now && ['ready', 'pending'].includes(viewerMedia.status) && viewerMedia.desiredAction !== 'leave') {
      try { authorizeSpace(event, match, actorId, viewerMedia.space); mediaSpace = viewerMedia.space; } catch { /* No private room identities after role revocation. */ }
    }
    const ballots = mapValues(match.ballots).filter(b => b.round === match.ballotRound);
    const poll = match.polls[match.activePollId];
    const publicPoll = poll ? { id: poll.id, state: poll.state, openedAt: poll.openedAt, closedAt: poll.closedAt, eligible: poll.eligible.includes(actorId), myVote: poll.votes[actorId]?.side || null, ...(poll.state === 'Published' ? { result: poll.result } : {}) } : null;
    const visibleResults = match.resultVersions.filter(r => ['PROVISIONAL_PUBLISHED', 'FINAL', 'SUPERSEDED'].includes(r.state));
    const mySide = participantSide(match, actorId);
    const nominationState = match.ballotState === 'FINAL' && match.resultVersions.at(-1)?.awards?.bestDebater ? match.resultVersions.at(-1).awards.bestDebater : match.judgeIds.length ? domain.calculateNominationAward({ nominations: mapValues(match.nominations).filter(n => match.judgeIds.includes(n.judgeId)), activeJudgeIds: match.judgeIds, runoff: match.nominationRunoff ? mapValues(match.nominationRunoff).filter(n => match.judgeIds.includes(n.judgeId)) : null }) : { status: 'NOT_READY' };
    result.matches.push({
      id: match.id, title: match.title, motionId: match.motionId, teamIds: match.teamIds, seats: match.seats, captains: match.captains, closingSeats: match.closingSeats,
      checkIn: matchCheckIn(match, now),
      sanctions: clone(match.sanctions || []),
      fixtureId: match.fixtureId || null, requiresReview: !!match.requiresReview, downstreamReviewRequired: !!match.downstreamReviewRequired,
      originalFixtureId: match.originalFixtureId || null, rematchOf: match.rematchOf || null, rematchId: match.rematchId || null, rematchReason: match.rematchReason || null,
      tieResolution: { method: 'same_panel_reconsideration_then_rematch', predeclaredTiebreakJudge: null, status: match.closedTally?.status || null, reconsiderationUsed: match.ballotRound >= 2, rematchAvailable: !match.rematchId && match.closedTally?.status === 'UNRESOLVED' && match.ballotRound === 2 && ['CLOSED','PROVISIONAL_PUBLISHED'].includes(match.ballotState) },
      privateRoomInvitations: mapValues(match.privateRoomInvitations).map(invitation => ({ ...clone(invitation), status: invitation.revokedAt ? 'REVOKED' : privateInvitationActive(event, match, invitation) ? 'ACTIVE' : 'EXPIRED' })),
      judgeIds: match.judgeIds, chiefId: match.chiefId, moderatorId: match.moderatorId, timekeeperId: match.timekeeperId, hostIds: match.hostIds,
      rules: match.rules, ruleVersion: match.ruleVersion, rulesLockedAt: match.rulesLockedAt, acknowledgments: match.acknowledgments,
      phase: match.phase, quietObservers: match.quietObservers === true, currentStageIndex: match.currentStageIndex, runOfShow: match.runOfShow, attempts: match.attempts,
      timer: match.timer, readiness: readiness(event, match), ballotState: match.ballotState, ballotRound: match.ballotRound,
      ballotCompletion: { received: ballots.filter(b => b.submittedAt && match.judgeIds.includes(b.judgeId)).length, required: match.judgeIds.length },
      ...(judge ? { myDraft: clone(match.drafts[actorId] || null), myBallot: clone(match.ballots[`${match.ballotRound}:${actorId}`] || null) } : {}),
      nominationStatus: { status: nominationState.status, missingJudgeCount: nominationState.missingJudgeIds?.length || 0, candidates: judge || panelAdmin ? ['RUNOFF_REQUIRED','AWAITING_RUNOFF'].includes(nominationState.status) ? clone(nominationState.candidates || []) : [] : [], runoffSubmitted: judge && Boolean(match.nominationRunoff?.[actorId]) },
      ...(judge ? { myNomination: clone(match.nominations?.[actorId] || null), myNominationRunoff: clone(match.nominationRunoff?.[actorId] || null) } : {}),
      poll: publicPoll, resultVersions: visibleResults.map(r => { const copy = clone(r); delete copy.ballots; delete copy.scorecards; delete copy.privateNotes; delete copy.tournamentRecord; if (copy.feedback) copy.feedback = mySide ? { [mySide]: copy.feedback[mySide] } : {}; return copy; }),
      messages: match.messages.filter(message => canChannel(event, match, actorId, message.channel) && (!message.blockedRecipients?.includes(actorId))).slice(-100).map(({ blockedRecipients, ...message }) => message),
      evidence: match.evidence.filter(item => canChannel(event, match, actorId, item.channel)).map(({ storageKey, ...item }) => item),
      incidents: match.incidents.filter(incident => incident.public || official(event, match, actorId) || incident.actorId === actorId),
      protests: match.protests.filter(protest => panelAdmin || protest.actorId === actorId),
      myMedia: event.media[actorId]?.matchId === match.id ? (({ revocations, ...session }) => ({ ...session, sources: allowedSources(event, match, actorId, session.space, now) }))(event.media[actorId]) : null,
      mediaParticipants: mapValues(event.media).filter(s => s.matchId === match.id && s.space === mediaSpace && s.status !== 'left' && s.desiredAction !== 'leave' && s.expiresAt > now && event.members[s.userId]?.admitted && !event.members[s.userId]?.removed).filter(s => { try { authorizeSpace(event, match, s.userId, s.space); return true; } catch { return false; } }).map(s => ({ userId: s.userId, identity: s.identity })),
      accommodations: Object.fromEntries(Object.entries(match.accommodations).filter(([person]) => person === actorId || panelAdmin)),
      deviceChecks: panelAdmin ? match.deviceChecks : { [actorId]: match.deviceChecks[actorId] || null },
    });
  }
  return result;
}

export function createDebateService({ store, adapters = {}, now = Date.now, limits = {} }) {
  need(store?.read && store?.commit, 'STORE_UNCONFIGURED', 'Persistent Debate Room storage must be configured.');
  const authenticate = actor => { need(actor?.id && typeof actor.id === 'string' && actor.id.length <= 128, 'AUTH_REQUIRED', 'Sign in to use Debate Room.'); return actor.id; };
  const sessionMaximum = Number.isInteger(limits.maxParticipants) && limits.maxParticipants > 0 && limits.maxParticipants <= 100 ? limits.maxParticipants : 0;
  const actorSnapshot = (event, actor, time) => ({ ...snapshotEvent(event, actor.id, time), maxMediaParticipants: sessionMaximum, canManageRetention: actor.platformOperator === true && organizer(event, actor.id) });
  const enqueue = (ctx, type, payload, resultVersion) => {
    const job = { id: id(), eventId: ctx.event.id, matchId: payload.session?.matchId || payload.matchId, actorId: ctx.actorId, type, payload, createdAt: ctx.time, resultVersion };
    const recipientLabel = payload.recipientId ? ctx.event.members[payload.recipientId]?.displayName : type === 'invitation_mail' ? payload.recipientEmail : undefined;
    ctx.jobs.push(job); ctx.event.jobs[job.id] = { id: job.id, actorId: job.actorId, type, status: 'queued', createdAt: ctx.time, resultVersion, ...(recipientLabel ? { recipientLabel: text(recipientLabel, 254, true) } : {}) };
    return job.id;
  };
  // Pending epochs cannot receive credentials. Carry unresolved retired live
  // identities forward, but do not accumulate never-admitted pending epochs.
  const retiredMedia = session => [...new Map([...(session?.revocations || []), ...(session && session.status !== 'left' && (session.everReady || session.status === 'ready') ? [{ identity: session.identity, roomName: session.roomName }] : [])].map(binding => [`${binding.roomName}:${binding.identity}`, binding])).values()];
  const queueMedia = (ctx, session, action) => {
    session.status = 'pending'; session.desiredAction = action;
    session.operationId = enqueue(ctx, 'media', { action, session: clone(session) });
  };
  const refreshMedia = ctx => {
    for (const session of mapValues(ctx.event.media)) {
      const match = ctx.event.matches[session.matchId];
      if (!match || session.status === 'left') continue;
      let allowed = session.expiresAt > ctx.time;
      try { authorizeSpace(ctx.event, match, session.userId, session.space); } catch { allowed = false; }
      const sources = allowed ? allowedSources(ctx.event, match, session.userId, session.space, ctx.time) : [];
      if (!allowed) {
        if (session.desiredAction !== 'leave') { session.sources = []; queueMedia(ctx, session, 'leave'); }
        continue;
      }
      // Clock ticks/renewals and unrelated roles do not remount active media.
      if (session.desiredAction === 'leave' || JSON.stringify(sources) === JSON.stringify(session.sources)) continue;
      const epochId = id(), replacement = { ...session, epochId, identity: `dd-debate-${epochId}`, everReady: false, sources, revocations: retiredMedia(session) };
      ctx.event.media[session.userId] = replacement;
      queueMedia(ctx, replacement, 'permissions');
    }
  };
  const setAttempt = (ctx, match, stageIndex, reason = '') => {
    const stage = match.runOfShow[stageIndex]; need(stage, 'STAGE_NOT_FOUND', 'There is no stage at that position.');
    const previousAttempt = match.attempts.find(a => a.id === match.timer?.stageAttemptId);
    if (previousAttempt && previousAttempt.state !== 'FINISHED') { previousAttempt.elapsedMs = domain.timerElapsed(match.timer, ctx.time); previousAttempt.state = 'ABANDONED'; previousAttempt.abandonedAt = ctx.time; previousAttempt.abandonReason = reason || 'Authorized phase transition'; }
    const attempt = { id: id(), stageId: stage.id, stageIndex, ruleVersion: match.ruleVersion, speakerSeats: clone(stage.speakerSeats), speakerIds: stage.speakerSeats.map(seat => match.seats[seat]), number: match.attempts.filter(a => a.stageId === stage.id).length + 1, createdAt: ctx.time, createdBy: ctx.actorId, reason, state: 'READY', adjustments: [] };
    match.attempts.push(attempt); match.currentStageIndex = stageIndex;
    match.timer = stage.durationMs === null ? null : domain.createTimer({ matchId: match.id, stageAttemptId: attempt.id, durationMs: stage.durationMs }, ctx.time);
    match.phase = stage.kind === 'preparation' ? 'preparation' : stage.kind === 'break' ? 'break' : stage.kind === 'deliberation' ? 'deliberation' : 'live';
    refreshMedia(ctx); return attempt;
  };
  const handlers = {};

  handlers.create_event = ctx => {
    const p = ctx.payload;
    const timezone = eventTimezone(p.timezone || 'Asia/Manila');
    need(p.rehearsal === undefined || typeof p.rehearsal === 'boolean', 'INVALID_REHEARSAL', 'Choose rehearsal or competition explicitly.');
    need(p.visibility === undefined || ['unlisted', 'public'].includes(p.visibility), 'INVALID_VISIBILITY', 'Choose unlisted or public.');
    ctx.event = { id: ctx.eventId, revision: 0, ownerId: ctx.actorId, title: text(p.title, 160, true), description: text(p.description, 4000), timezone, language: text(p.language || 'English', 80), scheduledAt: eventSchedule(p.scheduledAt), visibility: p.visibility || 'unlisted', rehearsal: p.rehearsal === true, status: 'draft', createdAt: ctx.time, updatedAt: ctx.time, members: {}, teams: {}, motions: {}, matches: {}, invites: {}, media: {}, jobs: {}, fixtures: [], activeMatchId: null, retention: { operationalDays: 30, chatDays: 30, evidenceDays: 90, officialDays: 365, approved: false, hold: false } };
    ctx.event.members[ctx.actorId] = { id: ctx.actorId, displayName: text(ctx.actor.displayName || p.displayName || 'Organizer', 120, true), roles: ['host'], teamId: null, admitted: true, checkedIn: true, removed: false, conflictDeclarations: [] };
    ctx.event.contact = eventContact(p.contact);
    return { eventId: ctx.event.id };
  };
  handlers.update_event = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload;
    if (Object.hasOwn(p, 'contact')) ctx.event.contact = eventContact(p.contact);
    for (const field of ['title', 'description', 'language']) if (Object.hasOwn(p, field)) ctx.event[field] = text(p[field], field === 'description' ? 4000 : 160, field === 'title');
    if (p.scheduledAt !== undefined) ctx.event.scheduledAt = eventSchedule(p.scheduledAt);
    if (p.timezone !== undefined) { const timezone = eventTimezone(p.timezone); need(timezone === ctx.event.timezone || !mapValues(ctx.event.matches).some(m => m.rulesLockedAt), 'EVENT_SETTINGS_LOCKED', 'Event timezone is locked after a match starts.'); ctx.event.timezone = timezone; }
    if (p.rehearsal !== undefined) { need(typeof p.rehearsal === 'boolean', 'INVALID_REHEARSAL', 'Choose rehearsal or competition explicitly.'); need(p.rehearsal === ctx.event.rehearsal || !mapValues(ctx.event.matches).some(m => m.rulesLockedAt || m.attempts.length || m.phase !== 'setup'), 'EVENT_SETTINGS_LOCKED', 'Rehearsal status cannot change after a match starts.'); ctx.event.rehearsal = p.rehearsal; }
    if (p.visibility !== undefined) { need(['unlisted', 'public'].includes(p.visibility), 'INVALID_VISIBILITY', 'Choose unlisted or public.'); ctx.event.visibility = p.visibility; }
    return { saved: true };
  };
  handlers.create_invite = async ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, role = p.role || 'observer';
    need(ctx.event.status !== 'completed', 'EVENT_ENDED', 'This event has ended and no longer accepts invitations.');
    need(roleNames.has(role), 'INVALID_ROLE', 'Choose a supported event role.');
    need(mapValues(ctx.event.invites).filter(i => !i.revokedAt && i.expiresAt > ctx.time).length < 100, 'INVITE_LIMIT', 'Revoke unused invitations first.');
    const secret = randomCode(12), inviteId = id();
    const boundAccountId = p.boundAccountId ? text(p.boundAccountId, 128, true) : null;
    const emailHash = p.boundEmail ? await digest(emailAddress(p.boundEmail)) : null;
    const end = ctx.event.endsAt || ctx.time + 7 * 86400000;
    ctx.event.invites[inviteId] = { id: inviteId, digest: await digest(secret), role, teamId: p.teamId || null, boundAccountId, emailHash, requiresApproval: role !== 'observer' && !boundAccountId && !emailHash, expiresAt: Math.min(ctx.time + 7 * 86400000, end), revokedAt: null, usedBy: [] };
    return { inviteId, secret, eventId: ctx.event.id, expiresAt: ctx.event.invites[inviteId].expiresAt };
  };
  handlers.revoke_invite = ctx => { requireOrganizer(ctx.event, ctx.actorId); const invite = ctx.event.invites[ctx.payload.inviteId]; need(invite, 'INVITE_NOT_FOUND', 'This invitation does not exist.'); invite.revokedAt = ctx.time; return { revoked: true }; };
  async function authorizeInvitationMail(event, actorId, payload, time) {
    requireOrganizer(event, actorId);
    const invite = event.invites[payload.inviteId], recipientEmail = emailAddress(payload.recipientEmail);
    need(event.status !== 'completed' && invite && !invite.revokedAt && invite.expiresAt > time && (!payload.inviteDigest || payload.inviteDigest === invite.digest), 'INVITE_INVALID', 'This invitation is no longer available.');
    need(!invite.emailHash || invite.emailHash === await digest(recipientEmail), 'INVITE_INVALID', 'This invitation is bound to a different email address.');
    if (invite.boundAccountId) {
      need(typeof adapters.recipientEmail === 'function', 'ADAPTER_UNCONFIGURED', 'Verified account email lookup is required for this bound invitation.');
      need(emailAddress(await adapters.recipientEmail(invite.boundAccountId)) === recipientEmail, 'INVITE_INVALID', 'This invitation is bound to a different account.');
    }
    if (event.rehearsal) need(limits.approvedRehearsalRecipientEmails?.map(email => email.toLowerCase()).includes(recipientEmail), 'FORBIDDEN', 'Rehearsal invitations are limited to approved test recipients.');
    return { invite, recipientEmail };
  }
  handlers.preview_invitation_mail = async ctx => {
    const { invite, recipientEmail } = await authorizeInvitationMail(ctx.event, ctx.actorId, ctx.payload, ctx.time);
    return { inviteId: invite.id, role: invite.role, recipientEmail, expiresAt: invite.expiresAt, eventTitle: ctx.event.title, rehearsal: ctx.event.rehearsal };
  };
  handlers.send_invitation = async ctx => {
    need(ctx.payload.previewConfirmed === true && ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Preview this recipient and explicitly confirm Send.');
    const { invite, recipientEmail } = await authorizeInvitationMail(ctx.event, ctx.actorId, ctx.payload, ctx.time);
    const secret = text(ctx.payload.secret, 128, true).toUpperCase();
    need(await digest(secret) === invite.digest, 'INVITE_INVALID', 'Use the original secret for this invitation.');
    need(await store.rateLimit(ctx.actorId, 'invitation_mail_minute', ctx.time, 20, 60000) && await store.rateLimit(ctx.actorId, 'invitation_mail_hour', ctx.time, 100, 3600000), 'MAIL_RATE_LIMIT', 'Please wait before sending more invitations.');
    need(typeof adapters.sealInvitation === 'function', 'ADAPTER_UNCONFIGURED', 'Secure invitation email is not configured.');
    const sealedInvitation = await adapters.sealInvitation({ eventId: ctx.event.id, inviteId: invite.id, recipientEmail, secret, expiresAt: invite.expiresAt });
    need(typeof sealedInvitation === 'string' && sealedInvitation.length <= 8192 && !sealedInvitation.includes(secret), 'INVITATION_SEAL_FAILED', 'The invitation could not be sealed securely.');
    const jobId = enqueue(ctx, 'invitation_mail', { inviteId: invite.id, recipientEmail, sealedInvitation, inviteDigest: invite.digest, expiresAt: invite.expiresAt, rehearsal: ctx.event.rehearsal, eventTitle: ctx.event.title });
    return { jobId, recipientEmail, status: 'queued', delivery: 'not_yet_attempted' };
  };
  handlers.claim_invite = async ctx => {
    need(ctx.event.status !== 'completed' && (!ctx.event.endsAt || ctx.event.endsAt > ctx.time), 'INVITE_INVALID', 'This event invitation has expired.');
    const secretHash = await digest(text(ctx.payload.secret, 128, true).toUpperCase());
    const invite = mapValues(ctx.event.invites).find(inv => inv.digest === secretHash && !inv.revokedAt && inv.expiresAt > ctx.time);
    need(invite && (!invite.boundAccountId || invite.boundAccountId === ctx.actorId) && (!invite.emailHash || (ctx.actor.verified && ctx.actor.email && invite.emailHash === await digest(ctx.actor.email.toLowerCase()))), 'INVITE_INVALID', 'This invitation is invalid, expired, or intended for another account.');
    need(!ctx.event.members[ctx.actorId]?.removed, 'FORBIDDEN', 'An organizer must reinstate you before you rejoin.');
    const existing = ctx.event.members[ctx.actorId];
    if (!existing) ctx.event.members[ctx.actorId] = { id: ctx.actorId, displayName: text(ctx.actor.displayName || 'Participant', 120, true), roles: invite.requiresApproval ? ['observer'] : [invite.role], teamId: invite.teamId, admitted: invite.role !== 'observer' && !invite.requiresApproval, checkedIn: false, removed: false, requestedRole: invite.requiresApproval ? invite.role : null, conflictDeclarations: [] };
    if (!invite.usedBy.includes(ctx.actorId)) invite.usedBy.push(ctx.actorId);
    return { claimed: true, awaitingAdmission: !ctx.event.members[ctx.actorId].admitted };
  };
  handlers.join_public_event = ctx => {
    need(ctx.event.visibility === 'public' && !ctx.event.rehearsal && ctx.event.status !== 'completed', 'PUBLIC_EVENT_UNAVAILABLE', 'This event is not open for public admission.');
    need(!ctx.event.members[ctx.actorId]?.removed, 'FORBIDDEN', 'An organizer must reinstate you before you rejoin.');
    if (!ctx.event.members[ctx.actorId]) ctx.event.members[ctx.actorId] = { id: ctx.actorId, displayName: text(ctx.actor.displayName || 'Participant', 120, true), roles: ['observer'], teamId: null, admitted: false, checkedIn: false, removed: false, conflictDeclarations: [] };
    return { joined: true, awaitingAdmission: !ctx.event.members[ctx.actorId].admitted };
  };
  handlers.check_in = ctx => { const me = member(ctx.event, ctx.actorId); me.checkedIn = ctx.payload.checkedIn !== false; if (ctx.payload.matchId) { need(me.admitted, 'FORBIDDEN', 'Wait for event admission before checking in for this match.'); const match = matchOf(ctx.event, ctx.payload); if (me.checkedIn) recordMatchAttendance(match, me.id, ctx.time, 'check_in'); } if (ctx.payload.displayName) me.displayName = text(ctx.payload.displayName, 120, true); if (Array.isArray(ctx.payload.conflictDeclarations)) me.conflictDeclarations = ctx.payload.conflictDeclarations.slice(0, 20).map(v => text(v, 500, true)); refreshMedia(ctx); return { checkedIn: me.checkedIn }; };
  handlers.admit_member = ctx => { requireOrganizer(ctx.event, ctx.actorId); const person = member(ctx.event, ctx.payload.memberId); need(person.id !== ctx.event.ownerId || ctx.payload.admitted !== false, 'FORBIDDEN', 'The event owner must retain admission.'); person.admitted = ctx.payload.admitted !== false; if (ctx.payload.approveRequestedRole && person.requestedRole) { person.roles = [person.requestedRole]; person.requestedRole = null; } refreshMedia(ctx); return { admitted: person.admitted }; };
  handlers.assign_role = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, person = member(ctx.event, p.memberId);
    need(Array.isArray(p.roles) && p.roles.length > 0 && p.roles.every(r => roleNames.has(r)), 'INVALID_ROLE', 'Choose supported roles.');
    need(p.memberId !== ctx.event.ownerId || p.roles.includes('host'), 'OWNER_ROLE_REQUIRED', 'The event owner must retain organizer access.');
    person.roles = [...new Set(p.roles)]; person.teamId = p.teamId || null;
    for (const match of mapValues(ctx.event.matches)) if (match.activePollId) { const poll = match.polls[match.activePollId]; if (!audienceEligible(ctx.event, match, person.id)) { poll.revocations ||= []; poll.revocations.push({ actorId: person.id, at: ctx.time, reason: 'role_change' }); if (poll.votes[person.id]) poll.votes[person.id].invalidatedAt = ctx.time; } }
    refreshMedia(ctx); return { assigned: true };
  };
  handlers.remove_member = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(ctx.payload.memberId !== ctx.event.ownerId, 'FORBIDDEN', 'The event owner cannot be removed.'); const person = member(ctx.event, ctx.payload.memberId); person.removed = true; person.admitted = false; for (const match of mapValues(ctx.event.matches)) for (const poll of mapValues(match.polls)) if (poll.votes[person.id]) poll.votes[person.id].invalidatedAt = ctx.time; refreshMedia(ctx); return { removed: true }; };
  handlers.reinstate_member = ctx => { requireOrganizer(ctx.event, ctx.actorId); const person = ctx.event.members[ctx.payload.memberId]; need(person?.removed, 'MEMBER_NOT_FOUND', 'Choose a removed participant.'); person.removed = false; person.admitted = false; return { reinstated: true }; };
  handlers.propose_roster = ctx => {
    const p = ctx.payload, team = ctx.event.teams[p.teamId]; need(team && (team.captainId === ctx.actorId || organizer(ctx.event, ctx.actorId)), 'FORBIDDEN', 'Only this captain can propose the roster.');
    validateRoster(ctx.event, p, team.id);
    team.proposal = { speakerIds: clone(p.speakerIds), captainId: p.captainId, name: text(p.name ?? team.name, 120, true), school: text(p.school ?? team.school, 160), proposedBy: ctx.actorId, at: ctx.time };
    return { proposed: true };
  };
  handlers.confirm_roster = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload;
    const teamId = p.teamId || id(), previous = ctx.event.teams[teamId];
    need(!p.teamId || previous, 'TEAM_NOT_FOUND', 'Choose an existing team to update.');
    validateRoster(ctx.event, p, teamId);
    const changed = !!previous && (JSON.stringify(previous.speakerIds) !== JSON.stringify(p.speakerIds) || previous.captainId !== p.captainId);
    const linked = mapValues(ctx.event.matches).filter(match => Object.values(match.teamIds).includes(teamId));
    if (changed) need(!linked.some(match => match.rulesLockedAt && ['live','preparation','break','deliberation','provisional'].includes(match.phase)), 'ROSTER_LOCKED', 'A match with this team is in progress. Use its audited reserve substitution procedure; update the event roster after the match finishes.');
    for (const actorId of previous?.speakerIds || []) if (!p.speakerIds.includes(actorId)) { const person = ctx.event.members[actorId]; if (person?.teamId === teamId && !person.roles.some(role => ['coach','reserve'].includes(role))) person.teamId = null; }
    for (const actorId of p.speakerIds) { const person = member(ctx.event, actorId); person.teamId = teamId; if (!person.roles.includes('debater')) person.roles.push('debater'); }
    ctx.event.teams[teamId] = { id: teamId, name: text(p.name || previous?.name, 120, true), school: text(p.school ?? previous?.school, 160), speakerIds: clone(p.speakerIds), captainId: p.captainId, confirmedAt: ctx.time };
    const updatedMatchIds = [];
    if (changed) for (const match of linked.filter(candidate => !candidate.rulesLockedAt)) {
      match.rosterHistory ||= []; match.rosterHistory.push({ seats: clone(match.seats), captains: clone(match.captains), closingSeats: clone(match.closingSeats), ruleVersion: match.ruleVersion, actorId: ctx.actorId, at: ctx.time });
      for (const side of sides.filter(side => match.teamIds[side] === teamId)) {
        const prefix = side === 'affirmative' ? 'A' : 'N', previousCloser = match.seats[match.closingSeats[side]];
        p.speakerIds.forEach((actorId, index) => { match.seats[`${prefix}${index + 1}`] = actorId; });
        match.captains[side] = p.captainId;
        match.closingSeats[side] = `${prefix}${Math.max(0, p.speakerIds.indexOf(previousCloser)) + 1}`;
      }
      validateAssignments(ctx.event, match); match.ruleVersion++; match.acknowledgments = {}; match.deviceChecks = {}; match.accommodations = {};
      if (Object.keys(match.drafts).length) { match.draftHistory ||= []; match.draftHistory.push({ reason: 'Roster changed before match lock', at: ctx.time, drafts: clone(match.drafts) }); }
      match.drafts = {}; match.nominations = {}; delete match.nominationRunoff;
      match.incidents.push({ id: id(), type: 'roster_updated', actorId: ctx.actorId, at: ctx.time, reason: 'Confirmed team roster changed before match lock. Review the named seats and renewed readiness.', public: true, teamId, ruleVersion: match.ruleVersion, captainNotice: true, judgeNotice: true });
      updatedMatchIds.push(match.id);
    }
    refreshMedia(ctx);
    return { teamId, updatedMatchIds, acknowledgmentsRequired: updatedMatchIds.length > 0 };
  };
  handlers.add_motion = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(mapValues(ctx.event.motions).length < 100, 'MOTION_LIMIT', 'This event has reached its motion limit.'); const motionId = id(); ctx.event.motions[motionId] = { id: motionId, title: text(ctx.payload.title || `Motion ${mapValues(ctx.event.motions).length + 1}`, 160), text: text(ctx.payload.text, 8000, true), version: 1, releasedAt: null }; return { motionId }; };
  handlers.create_match = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, matchId = id(); need(mapValues(ctx.event.matches).length < 256, 'MATCH_LIMIT', 'This event has reached its match limit.');
    const binding = prepareFixtureBinding(ctx.event, p); if (binding) { p.teamIds = binding.teamIds; p.motionId = binding.motionId; }
    const judges = [...new Set(p.judgeIds || [])], rules = domain.validateRules({ timezone: ctx.event.timezone, language: ctx.event.language, ...p.rules });
    const match = { id: matchId, title: text(p.title || `Match ${mapValues(ctx.event.matches).length + 1}`, 160), motionId: p.motionId || null, teamIds: clone(p.teamIds || {}), seats: Object.fromEntries(seatNames.map(seat => [seat, p.seats?.[seat] || null])), captains: clone(p.captains || {}), closingSeats: { affirmative: p.closingSeats?.affirmative || 'A1', negative: p.closingSeats?.negative || 'N1' }, judgeIds: judges, chiefId: p.chiefId || judges[0] || null, moderatorId: p.moderatorId || judges[0] || null, timekeeperId: p.timekeeperId || p.moderatorId || judges[0] || null, hostIds: p.hostIds || [ctx.event.ownerId], rules, ruleVersion: 1, rulesLockedAt: null, evenPanelAccepted: p.evenPanelAccepted === true, acknowledgments: {}, phase: 'setup', currentStageIndex: -1, runOfShow: [], attempts: [], timer: null, deviceChecks: {}, accommodations: {}, drafts: {}, ballots: {}, ballotHistory: [], ballotRound: 1, ballotState: 'DRAFT', polls: {}, activePollId: null, resultVersions: [], incidents: [], protests: [], messages: [], evidence: [], nominations: {}, floorGrants: {}, presenterId: null, rulesHistory: [], panelHistory: [], quietObservers: false };
    for (const side of sides) { const team = ctx.event.teams[match.teamIds[side]]; if (team) { const prefix = side === 'affirmative' ? 'A' : 'N'; team.speakerIds.forEach((actorId, index) => { match.seats[`${prefix}${index + 1}`] ||= actorId; }); match.captains[side] ||= team.captainId; } }
    for (const side of sides) {
      const seats = seatNames.filter(seat => seat[0] === (side === 'affirmative' ? 'A' : 'N'));
      need(seats.some(seat => match.seats[seat] === match.captains[side]), 'INVALID_ROSTER', 'Each team captain must occupy that team’s confirmed speaking seats.');
      match.closingSeats[side] = p.closingSeats?.[side] || seats.find(seat => match.seats[seat] === match.captains[side]);
    }
    domain.validateClosingSeats(match.closingSeats);
    match.scheduledCheckInAt = eventSchedule(p.scheduledCheckInAt === undefined ? ctx.event.scheduledAt : p.scheduledCheckInAt);
    match.checkIns = {}; match.noShowFindings = [];
    match.sanctions = [];
    for (const side of sides) { const team = ctx.event.teams[match.teamIds[side]]; need(team && Object.keys(match.teamIds).length === 2, 'TEAM_NOT_FOUND', 'Assign both registered event teams.'); need(seatNames.filter(seat => seat[0] === (side === 'affirmative' ? 'A' : 'N')).every(seat => team.speakerIds.includes(match.seats[seat])), 'ROLE_CONFLICT', 'Each assigned speaker must belong to the confirmed team roster.'); }
    need(match.teamIds.affirmative !== match.teamIds.negative, 'ROLE_CONFLICT', 'A team cannot debate itself.');
    validateAssignments(ctx.event, match); if (binding) { const fixture = ctx.event.fixtures.find(f => f.id === binding.fixtureId); fixture.matchId = matchId; fixture.motionId = binding.motionId; fixture.boundAt = ctx.time; match.fixtureId = fixture.id; }
    ctx.event.matches[matchId] = match; ctx.event.activeMatchId ||= matchId; return { matchId, fixtureId: match.fixtureId || null };
  };
  handlers.update_rules = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload); mutableSetup(match);
    match.rules = domain.validateRules({ ...match.rules, ...ctx.payload.rules }); match.ruleVersion++; match.acknowledgments = {};
    if (ctx.payload.closingSeats) match.closingSeats = clone(ctx.payload.closingSeats);
    if (ctx.payload.motionId) { need(ctx.event.motions[ctx.payload.motionId], 'MOTION_NOT_FOUND', 'Choose an existing motion.'); const fixture = getBoundFixture(ctx.event, match); if (fixture) fixture.motionId = ctx.payload.motionId; match.motionId = ctx.payload.motionId; }
    match.evenPanelAccepted = ctx.payload.evenPanelAccepted === true || match.evenPanelAccepted;
    refreshMedia(ctx);
    return { ruleVersion: match.ruleVersion };
  };
  handlers.update_match_schedule = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload); mutableSetup(match);
    need(!match.noShowFindings?.length, 'SCHEDULE_LOCKED', 'A recorded no-show finding preserves its original check-in deadline.');
    match.scheduledCheckInAt = eventSchedule(ctx.payload.scheduledCheckInAt);
    return { checkIn: matchCheckIn(match, ctx.time) };
  };
  handlers.record_no_show = ctx => {
    const match = matchOf(ctx.event, ctx.payload), person = member(ctx.event, ctx.payload.memberId); requireOfficial(ctx.event, match, ctx.actorId);
    need(!match.rulesLockedAt && match.phase === 'setup', 'NO_SHOW_UNAVAILABLE', 'No-show findings apply only before a match starts; use the technical incident procedure after participation.');
    need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the participant is absent after the check-in grace period.');
    const checkIn = matchCheckIn(match, ctx.time);
    need(checkIn.deadlineAt !== null && ctx.time >= checkIn.deadlineAt, 'NO_SHOW_GRACE_OPEN', 'Wait until the scheduled check-in and its full grace period have elapsed.');
    need([...Object.values(match.seats), ...match.judgeIds, match.moderatorId, match.timekeeperId].includes(person.id), 'NOT_ASSIGNED', 'Only a required match participant can receive a no-show finding.');
    need(!match.checkIns?.[person.id], 'PARTICIPANT_ATTENDED', 'This participant checked in for the match. A later absence or disconnection is not a no-show.');
    need(!match.noShowFindings?.some(f => f.memberId === person.id), 'NO_SHOW_ALREADY_RECORDED', 'This participant already has a no-show finding.');
    const finding = { id: id(), memberId: person.id, actorId: ctx.actorId, at: ctx.time, scheduledAt: checkIn.scheduledAt, deadlineAt: checkIn.deadlineAt, reason: text(ctx.payload.reason, 2000, true) };
    match.noShowFindings ||= []; match.noShowFindings.push(finding);
    match.incidents.push({ ...finding, type: 'no_show', public: true });
    return { findingId: finding.id, checkIn: matchCheckIn(match, ctx.time), humanDecisionRequired: true };
  };
  handlers.amend_rules = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload);
    need(match.rulesLockedAt && !['final', 'provisional'].includes(match.phase) && match.timer?.state !== 'RUNNING', 'RULES_LOCKED', 'Pause the current stage before a disclosed live rules amendment.');
    const reason = text(ctx.payload.reason, 2000, true);
    const revised = domain.validateRules({ ...match.rules, ...ctx.payload.rules });
    assertSanctionPolicyChange(match.rules.sanctions, revised.sanctions, { startedAt: match.rulesLockedAt, judgingMode: revised.judgingMode });
    for (const field of ['judgingMode', 'rubric', 'caseLabels', 'awardPolicy', 'noShowGraceMs']) need(JSON.stringify(canonical(revised[field])) === JSON.stringify(canonical(match.rules[field])), 'JUDGING_RULES_LOCKED', 'The accepted judging mode, rubric, case labels, award policy, and no-show grace cannot change after the match starts.');
    const nextRun = domain.createRunOfShow(revised, match.closingSeats), currentId = currentStage(match)?.id;
    need(nextRun.some(stage => stage.id === currentId), 'INVALID_AMENDMENT', 'The current stage cannot be removed by an amendment.');
    match.rulesHistory.push({ version: match.ruleVersion, rules: clone(match.rules), at: ctx.time, reason, actorId: ctx.actorId });
    match.rules = revised; match.ruleVersion++; match.acknowledgments = {}; match.runOfShow = nextRun; match.currentStageIndex = nextRun.findIndex(stage => stage.id === currentId);
    match.incidents.push({ id: id(), type: 'rules_amendment', actorId: ctx.actorId, at: ctx.time, reason, public: true, ruleVersion: match.ruleVersion, captainNotice: true, judgeNotice: true });
    refreshMedia(ctx);
    return { ruleVersion: match.ruleVersion, acknowledgmentsRequired: true, existingTimerPreserved: true };
  };
  handlers.acknowledge_rules = ctx => { const match = matchOf(ctx.event, ctx.payload), side = sides.find(s => match.captains[s] === ctx.actorId); need(side, 'FORBIDDEN', 'Only the assigned captain can acknowledge these rules.'); need(ctx.payload.ruleVersion === match.ruleVersion, 'REVISION_CONFLICT', 'Review the newest rules before accepting.'); match.acknowledgments[side] = { actorId: ctx.actorId, ruleVersion: match.ruleVersion, at: ctx.time }; return { acknowledged: true }; };
  handlers.draw_sides = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload); mutableSetup(match);
    const fixture = getBoundFixture(ctx.event, match); if (fixture) requireResolvedFixture(ctx.event, fixture);
    const swap = ctx.payload.random === true ? (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 1 : ctx.payload.swap === true;
    if (swap) { [match.teamIds.affirmative, match.teamIds.negative] = [match.teamIds.negative, match.teamIds.affirmative]; [match.captains.affirmative, match.captains.negative] = [match.captains.negative, match.captains.affirmative]; for (let n = 1; n <= 3; n++) [match.seats[`A${n}`], match.seats[`N${n}`]] = [match.seats[`N${n}`], match.seats[`A${n}`]]; }
    if (swap && fixture) for (const suffix of ['TeamId','Source','Seed']) [fixture[`affirmative${suffix}`], fixture[`negative${suffix}`]] = [fixture[`negative${suffix}`], fixture[`affirmative${suffix}`]];
    match.sideDraws ||= []; match.sideDraws.push({ actorId: ctx.actorId, at: ctx.time, method: ctx.payload.random ? 'random' : 'manual', swapped: swap, teams: clone(match.teamIds) }); match.ruleVersion++; match.acknowledgments = {}; return { swapped: swap, drawNumber: match.sideDraws.length, teams: match.teamIds };
  };
  handlers.record_device_check = ctx => { const match = matchOf(ctx.event, ctx.payload); const actorId = ctx.payload.memberId || ctx.actorId; if (actorId !== ctx.actorId) requireOfficial(ctx.event, match, ctx.actorId); member(ctx.event, actorId); match.deviceChecks[actorId] = { microphone: ctx.payload.microphone === true, camera: ctx.payload.camera === true, checkedBy: ctx.actorId, at: ctx.time }; if (actorId === ctx.actorId) recordMatchAttendance(match, actorId, ctx.time, 'device_check'); if (ctx.payload.accommodation) { requireOfficial(ctx.event, match, ctx.actorId); match.accommodations[actorId] = { reason: text(ctx.payload.accommodation, 2000, true), actorId: ctx.actorId, at: ctx.time }; } return { recorded: true }; };
  handlers.readiness = ctx => readiness(ctx.event, matchOf(ctx.event, ctx.payload));
  handlers.release_motion = ctx => { requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload), motion = ctx.event.motions[match.motionId]; need(motion, 'MOTION_NOT_FOUND', 'Set the match motion first.'); motion.releasedAt ||= ctx.time; match.motionReleasedAt ||= ctx.time; return { releasedAt: motion.releasedAt }; };
  handlers.start_match = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); mutableSetup(match);
    need(!match.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve this match’s recorded fixture review before starting.');
    const fixture = getBoundFixture(ctx.event, match); if (fixture) { requireResolvedFixture(ctx.event, fixture); need(fixture.status === 'SCHEDULED', 'FIXTURE_NOT_READY', 'This fixture is not waiting for its first start.'); }
    validateAssignments(ctx.event, match); const ready = readiness(ctx.event, match); need(ready.ready, 'MATCH_NOT_READY', 'Complete the readiness checks before starting.', ready);
    recordMatchAttendance(match, ctx.actorId, ctx.time, 'start_match');
    const motion = ctx.event.motions[match.motionId]; motion.releasedAt ||= ctx.time; match.motionReleasedAt = motion.releasedAt; match.rulesLockedAt = ctx.time; match.rulesHistory.push({ version: match.ruleVersion, rules: clone(match.rules), at: ctx.time }); match.runOfShow = domain.createRunOfShow(match.rules, match.closingSeats);
    if (fixture) { fixture.status = 'LIVE'; fixture.startedAt = ctx.time; }
    ctx.event.status = 'live'; ctx.event.activeMatchId = match.id; return { attempt: setAttempt(ctx, match, 0) };
  };
  handlers.claim_clock = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); need(match.timer, 'CLOCK_NOT_READY', 'Load a stage first.'); match.timer = domain.claimTimerLease(match.timer, { actorId: ctx.actorId, authorized: true, expectedVersion: ctx.payload.timerVersion ?? match.timer.version, takeover: ctx.payload.takeover === true, reason: ctx.payload.reason }, ctx.time); return { timer: match.timer }; };
  handlers.renew_clock = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); match.timer = domain.renewTimerLease(match.timer, { actorId: ctx.actorId, expectedVersion: ctx.payload.timerVersion ?? match.timer.version }, ctx.time); return { timer: match.timer }; };
  handlers.timer = ctx => {
    const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); liveMatch(match);
    const command = { ...ctx.payload, type: ctx.payload.type, actorId: ctx.actorId, expectedVersion: ctx.payload.timerVersion };
    if (['START', 'RESUME'].includes(String(command.type).toUpperCase())) {
      requireAcknowledgments(match);
      need(!mapValues(ctx.event.media).some(session => session.matchId === match.id && session.status !== 'left' && (session.status !== 'ready' || session.expiresAt <= ctx.time || JSON.stringify(session.sources) !== JSON.stringify(allowedSources(ctx.event, match, session.userId, session.space, ctx.time)))), 'MEDIA_PENDING', 'Wait for pending media permissions or revocations before starting the stage.');
    }
    const previousTimer = clone(match.timer); match.timer = domain.applyTimerCommand(match.timer, command, ctx.time);
    const attempt = match.attempts.find(a => a.id === match.timer.stageAttemptId); attempt.state = match.timer.state; attempt.adjustments ||= [];
    attempt.adjustments.push({ type: String(command.type).toUpperCase(), actorId: ctx.actorId, at: ctx.time, reason: ctx.payload.reason || null, previousVersion: previousTimer.version, previousElapsedMs: domain.timerElapsed(previousTimer, ctx.time), durationMs: match.timer.durationMs });
    if (match.timer.state === 'FINISHED') { attempt.elapsedMs = domain.timerElapsed(match.timer, ctx.time); attempt.overtimeMs = Math.max(0, attempt.elapsedMs - match.timer.durationMs); attempt.finishedAt = ctx.time; }
    return { timer: match.timer };
  };
  handlers.finish_stage = ctx => { ctx.payload.type = 'finish'; return handlers.timer(ctx); };
  handlers.next_stage = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); need(match.timer?.state === 'FINISHED', 'STAGE_NOT_READY', 'Finish the current stage before loading the next.'); return { attempt: setAttempt(ctx, match, match.currentStageIndex + 1) }; };
  handlers.return_stage = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); need(['PAUSED', 'FINISHED', 'READY'].includes(match.timer?.state), 'CLOCK_NOT_READY', 'Pause or finish before returning to a stage.'); const target = Number(ctx.payload.stageIndex); need(Number.isInteger(target) && target >= 0 && target <= match.currentStageIndex, 'INVALID_STAGE', 'Choose a prior stage.'); return { attempt: setAttempt(ctx, match, target, text(ctx.payload.reason, 2000, true)) }; };

  handlers.invite_private_room = ctx => {
    const match = matchOf(ctx.event, ctx.payload), space = ctx.payload.space;
    need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm that room participants can see this moderator invitation.');
    authorizeSpace(ctx.event, match, ctx.actorId, space);
    need(space === 'judges' ? isJudge(match, ctx.actorId) : sides.includes(space) && match.captains[space] === ctx.actorId, 'FORBIDDEN', 'Only that team’s captain or an assigned deliberating judge can invite a moderator.');
    const moderatorId = ctx.payload.moderatorId || match.moderatorId, moderator = member(ctx.event, moderatorId);
    need(moderatorId === match.moderatorId && moderator.admitted && moderator.checkedIn && !participantSide(match, moderatorId) && !(moderator.teamId && Object.values(match.teamIds).includes(moderator.teamId)), 'ROLE_CONFLICT', 'Invite the checked-in neutral moderator assigned to this match.');
    need(!mapValues(match.privateRoomInvitations).some(invitation => invitation.space === space && invitation.moderatorId === moderatorId && privateInvitationActive(ctx.event, match, invitation)), 'INVITATION_ALREADY_ACTIVE', 'The moderator already has a visible invitation for this room and phase.');
    const invitation = { id: id(), space, moderatorId, invitedBy: ctx.actorId, reason: text(ctx.payload.reason, 2000, true), phase: match.phase, stageAttemptId: match.attempts.at(-1)?.id || null, createdAt: ctx.time, revokedAt: null };
    match.privateRoomInvitations ||= {}; match.privateRoomInvitations[invitation.id] = invitation;
    match.incidents.push({ id: id(), type: 'private_room_invitation', actorId: ctx.actorId, at: ctx.time, public: true, invitationId: invitation.id, space, moderatorId, reason: invitation.reason });
    return { invitation: clone(invitation) };
  };
  handlers.revoke_private_room_invitation = ctx => {
    const match = matchOf(ctx.event, ctx.payload), invitation = match.privateRoomInvitations?.[ctx.payload.invitationId];
    need(invitation, 'INVITATION_NOT_FOUND', 'Choose a recorded private-room invitation.');
    need(organizer(ctx.event, ctx.actorId) || invitation.moderatorId === ctx.actorId || (invitation.space === 'judges' ? isJudge(match, ctx.actorId) : match.captains[invitation.space] === ctx.actorId), 'FORBIDDEN', 'The room’s captain or judge, invited moderator, or organizer may revoke this invitation.');
    need(!invitation.revokedAt, 'INVITATION_REVOKED', 'This invitation was already revoked.');
    invitation.revokedAt = ctx.time; invitation.revokedBy = ctx.actorId; invitation.revocationReason = text(ctx.payload.reason, 2000, true);
    match.incidents.push({ id: id(), type: 'private_room_invitation_revoked', actorId: ctx.actorId, at: ctx.time, public: true, invitationId: invitation.id, space: invitation.space, moderatorId: invitation.moderatorId, reason: invitation.revocationReason });
    refreshMedia(ctx); return { revoked: true, invitationId: invitation.id };
  };
  handlers.enter_space = ctx => {
    const match = matchOf(ctx.event, ctx.payload), space = ctx.payload.space || 'main'; authorizeSpace(ctx.event, match, ctx.actorId, space);
    recordMatchAttendance(match, ctx.actorId, ctx.time, 'media_admission');
    need(sessionMaximum > 0, 'MEDIA_UNCONFIGURED', 'The verified media operating limit must be configured before media admission.');
    const current = ctx.event.media[ctx.actorId];
    need(!current || current.status === 'left' || current.deviceId === ctx.payload.deviceId || ctx.payload.handoff === true, 'MEDIA_SESSION_CONFLICT', 'Confirm device handoff to replace your existing media connection.');
    // An expired lease still occupies its seat until provider removal confirms.
    const connected = mapValues(ctx.event.media).filter(s => s.matchId === match.id && s.userId !== ctx.actorId && s.status !== 'left');
    need(connected.length < sessionMaximum, 'CAPACITY_LIMIT', 'This debate has reached its verified safe media capacity. Remain in the lobby and retry.');
    const epochId = id();
    const session = { eventId: ctx.event.id, matchId: match.id, userId: ctx.actorId, space, epochId, identity: `dd-debate-${epochId}`, roomName: `dd-debate-${ctx.event.id}-${match.id}-${space}`, sources: allowedSources(ctx.event, match, ctx.actorId, space, ctx.time), revocations: retiredMedia(current), maxParticipants: sessionMaximum, status: 'pending', deviceId: text(ctx.payload.deviceId, 128, true), expiresAt: ctx.time + 120000 };
    ctx.event.media[ctx.actorId] = session;
    queueMedia(ctx, session, 'join');
    return { status: 'pending', operationId: session.operationId };
  };
  handlers.renew_media = ctx => { const match = matchOf(ctx.event, ctx.payload), session = ctx.event.media[ctx.actorId]; need(session && session.matchId === match.id && session.deviceId === ctx.payload.deviceId && session.status === 'ready' && session.expiresAt > ctx.time, 'MEDIA_SESSION_CONFLICT', 'Rejoin from your active media device.'); authorizeSpace(ctx.event, match, ctx.actorId, session.space); session.expiresAt = ctx.time + 120000; refreshMedia(ctx); return { expiresAt: session.expiresAt }; };
  handlers.leave_media = ctx => { const session = ctx.event.media[ctx.actorId]; if (!session || session.status === 'left') return { left: true }; queueMedia(ctx, session, 'leave'); return { status: 'pending' }; };
  handlers.grant_floor = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); member(ctx.event, ctx.payload.memberId); match.floorGrants[ctx.payload.memberId] = { expiresAt: ctx.payload.granted === false ? ctx.time : ctx.time + 300000, grantedBy: ctx.actorId }; refreshMedia(ctx); return { granted: ctx.payload.granted !== false }; };
  handlers.assign_presenter = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); if (ctx.payload.memberId) member(ctx.event, ctx.payload.memberId); match.presenterId = ctx.payload.memberId || null; refreshMedia(ctx); return { presenterId: match.presenterId }; };

  handlers.request_help = ctx => { const match = matchOf(ctx.event, ctx.payload); const incident = { id: id(), actorId: ctx.actorId, type: ['technical', 'ruling', 'accommodation'].includes(ctx.payload.type) ? ctx.payload.type : 'technical', reason: text(ctx.payload.reason, 2000, true), at: ctx.time, state: 'OPEN', public: false }; match.incidents.push(incident); return { incidentId: incident.id }; };
  handlers.resolve_incident = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const incident = match.incidents.find(i => i.id === ctx.payload.incidentId); need(incident, 'INCIDENT_NOT_FOUND', 'Choose an existing request.'); incident.state = ctx.payload.acknowledgeOnly ? 'ACKNOWLEDGED' : 'RESOLVED'; incident.resolution = text(ctx.payload.resolution, 2000, true); incident.resolvedBy = ctx.actorId; incident.resolvedAt = ctx.time; return { state: incident.state }; };
  handlers.substitute_speaker = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const seat = ctx.payload.seat;
    need(['setup', 'preparation', 'live', 'break'].includes(match.phase) && match.ballotState === 'DRAFT', 'SUBSTITUTION_NOT_READY', 'Substitute before adjudication; retained or published performances cannot be reassigned.');
    need(seatNames.includes(seat), 'INVALID_SEAT', 'Choose a speaking seat.'); need(match.timer?.state !== 'RUNNING', 'CLOCK_NOT_READY', 'Pause before substituting a speaker.');
    const reserve = member(ctx.event, ctx.payload.memberId), side = seat[0] === 'A' ? 'affirmative' : 'negative';
    need(reserve.roles.includes('reserve') && reserve.teamId === match.teamIds[side] && !Object.values(match.seats).includes(reserve.id) && ![...match.judgeIds, match.chiefId, match.moderatorId, match.timekeeperId].includes(reserve.id), 'ROLE_CONFLICT', 'Choose an approved reserve from this team who is not an assigned official.');
    need(reserve.admitted && reserve.checkedIn && (match.deviceChecks[reserve.id]?.microphone || match.accommodations[reserve.id]?.reason), 'RESERVE_NOT_READY', 'Admit and check in the reserve, then record their microphone check or accommodation.');
    const reason = text(ctx.payload.reason, 2000, true), previousId = match.seats[seat], oldSeats = clone(match.seats), oldCaptains = clone(match.captains), oldClosingSeats = clone(match.closingSeats), oldRuleVersion = match.ruleVersion;
    match.seats[seat] = reserve.id;
    const captainId = ctx.payload.captainId ?? (match.captains[side] === previousId ? reserve.id : match.captains[side]);
    need(seatNames.some(key => key[0] === seat[0] && match.seats[key] === captainId), 'INVALID_CAPTAIN', 'The replacement captain must be one of this side’s three active speakers.');
    match.captains[side] = captainId; validateAssignments(ctx.event, match);
    match.rosterHistory ||= []; match.rosterHistory.push({ type: 'substitution', seats: oldSeats, captains: oldCaptains, closingSeats: oldClosingSeats, ruleVersion: oldRuleVersion, actorId: ctx.actorId, at: ctx.time, reason });
    if (Object.keys(match.drafts).length) { match.draftHistory ||= []; match.draftHistory.push({ reason, at: ctx.time, seats: oldSeats, captains: oldCaptains, closingSeats: oldClosingSeats, ruleVersion: oldRuleVersion, drafts: clone(match.drafts) }); }
    if (Object.keys(match.nominations || {}).length || match.nominationRunoff) { match.nominationHistory ||= []; match.nominationHistory.push({ kind: 'substitution', nominations: clone(match.nominations || {}), runoff: clone(match.nominationRunoff || null), seats: oldSeats, at: ctx.time, actorId: ctx.actorId, reason }); }
    match.drafts = {}; match.nominations = {}; delete match.nominationRunoff;
    match.ruleVersion++; match.acknowledgments = {};
    if (match.rulesLockedAt) match.rulesHistory.push({ version: match.ruleVersion, rules: clone(match.rules), at: ctx.time, reason, source: 'substitution' });
    delete match.floorGrants[previousId]; if (match.presenterId === previousId) match.presenterId = null;
    const current = match.attempts.find(attempt => attempt.id === match.timer?.stageAttemptId);
    const replay = current?.speakerSeats.includes(seat) && ['READY','PAUSED'].includes(current.state) ? setAttempt(ctx, match, match.currentStageIndex, `Approved substitution: ${reason}`) : null;
    match.incidents.push({ id: id(), type: 'substitution', actorId: ctx.actorId, reason, at: ctx.time, public: true, seat, previousId, replacementId: reserve.id, captainId, ruleVersion: match.ruleVersion, captainNotice: true, judgeNotice: true, previousAttemptId: replay ? current.id : null, replayAttemptId: replay?.id || null });
    match.awardEligibilityReview = true; refreshMedia(ctx);
    return { seat, previousId, replacementId: reserve.id, captainId, ruleVersion: match.ruleVersion, acknowledgmentsRequired: true, replayRequired: !!replay, replayAttemptId: replay?.id || null, awardEligibilityReview: true };
  };
  handlers.conclude_match = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const kind = ctx.payload.kind || 'normal';
    need(['normal', 'forfeit', 'double_forfeit', 'cancelled', 'withdrawn', 'postponed'].includes(kind), 'INVALID_CONCLUSION', 'Choose a supported conclusion.');
    if (kind === 'normal') {
      const required = domain.createRunOfShow(match.rules, match.closingSeats).filter(s => s.id.startsWith('stage-'));
      need(match.rulesLockedAt && required.length === 14 && required.every(stage => match.attempts.filter(a => a.stageId === stage.id).at(-1)?.state === 'FINISHED'), 'STAGES_INCOMPLETE', 'Start the match and finish the latest attempt of every required speaking stage first.');
      match.phase = 'deliberation'; match.ballotState = 'DRAFT';
    } else {
      const reason = text(ctx.payload.reason, 2000, true); need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the exceptional match conclusion.');
      const findingIds = ctx.payload.noShowFindingIds || [];
      need(Array.isArray(findingIds) && findingIds.length <= 20 && new Set(findingIds).size === findingIds.length, 'INVALID_NO_SHOW', 'Choose distinct recorded no-show findings.');
      for (const findingId of findingIds) { const finding = match.noShowFindings?.find(f => f.id === findingId); need(finding && !match.checkIns?.[finding.memberId], 'NO_SHOW_CHANGED', 'A referenced no-show finding is missing or the participant has since arrived. Review the current attendance.'); }
      if (kind === 'forfeit') need(sides.includes(ctx.payload.winner), 'INVALID_WINNER', 'Identify the opponent receiving the forfeit win.');
      match.phase = kind; match.exceptionalConclusion = { kind, winner: kind === 'forfeit' ? ctx.payload.winner : null, reason, at: ctx.time, actorId: ctx.actorId, noShowFindingIds: clone(findingIds) };
      match.incidents.push({ id: id(), type: kind, actorId: ctx.actorId, reason, at: ctx.time, public: true });
    }
    if (match.timer?.state === 'RUNNING') { match.timer.elapsedBeforeRunMs = domain.timerElapsed(match.timer, ctx.time); match.timer.startedAtServerMs = null; match.timer.state = 'PAUSED'; match.timer.version++; }
    refreshMedia(ctx); return { phase: match.phase };
  };
  handlers.save_draft = ctx => {
    const match = matchOf(ctx.event, ctx.payload); need(isJudge(match, ctx.actorId), 'FORBIDDEN', 'Only an assigned judge can save a private scorecard.');
    need(!['FINAL', 'CLOSED'].includes(match.ballotState), 'BALLOTS_CLOSED', 'Ballots are closed; request an authorized correction.');
    const previous = match.drafts[ctx.actorId] || {};
    const scorecard = match.rules.judgingMode === 'simple' ? null : ctx.payload.scorecard ? domain.normalizeScorecard(ctx.payload.scorecard, match.rules, { allowIncomplete: true }) : previous.scorecard || null;
    const winner = ctx.payload.winner === undefined ? previous.winner || null : ctx.payload.winner;
    need(winner === null || sides.includes(winner), 'INVALID_WINNER', 'Choose Affirmative or Negative.');
    match.drafts[ctx.actorId] = { judgeId: ctx.actorId, scorecard, winner, reason: text(ctx.payload.reason ?? previous.reason, 4000), feedback: { affirmative: text(ctx.payload.feedback?.affirmative ?? previous.feedback?.affirmative, 4000), negative: text(ctx.payload.feedback?.negative ?? previous.feedback?.negative, 4000) }, notes: text(ctx.payload.notes ?? previous.notes, 12000), savedAt: ctx.time, revision: (previous.revision || 0) + 1 };
    return { saved: true, savedAt: ctx.time, draftRevision: match.drafts[ctx.actorId].revision };
  };
  handlers.open_ballots = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); requireAcknowledgments(match); need(match.phase === 'deliberation' || match.exceptionalConclusion, 'BALLOTS_NOT_READY', 'Finish speaking before opening final ballots.'); need(['DRAFT', 'REOPENED'].includes(match.ballotState), 'BALLOTS_CLOSED', 'This ballot round cannot be opened.'); match.ballotState = 'OPEN'; return { ballotState: 'OPEN', round: match.ballotRound }; };
  handlers.submit_ballot = ctx => {
    const match = matchOf(ctx.event, ctx.payload); need(isJudge(match, ctx.actorId), 'FORBIDDEN', 'Only an assigned eligible judge can submit this ballot.'); need(match.ballotState === 'OPEN', 'BALLOTS_CLOSED', 'Final ballots are not open.'); need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Review and confirm your final ballot.');
    requireAcknowledgments(match);
    let scorecard = null, winner = ctx.payload.winner || match.drafts[ctx.actorId]?.winner;
    if (match.rules.judgingMode !== 'simple') { const calculated = domain.scoreScorecard(ctx.payload.scorecard || match.drafts[ctx.actorId]?.scorecard, match.rules); need(match.rules.judgingMode === 'aggregate' || calculated.winner, 'TIE_BREAK_REQUIRED', 'Record a reasoned choice for the exactly tied scorecard.'); scorecard = calculated.normalized; winner = calculated.winner; }
    else need(sides.includes(winner), 'INVALID_WINNER', 'Choose Affirmative or Negative.');
    const key = `${match.ballotRound}:${ctx.actorId}`; if (match.ballots[key]) match.ballotHistory.push(clone(match.ballots[key]));
    const ballot = { id: id(), judgeId: ctx.actorId, round: match.ballotRound, scorecard, winner, reason: text(ctx.payload.reason ?? match.drafts[ctx.actorId]?.reason, 4000), submittedAt: ctx.time, version: (match.ballots[key]?.version || 0) + 1, feedback: { affirmative: text(ctx.payload.feedback?.affirmative ?? match.drafts[ctx.actorId]?.feedback?.affirmative, 4000), negative: text(ctx.payload.feedback?.negative ?? match.drafts[ctx.actorId]?.feedback?.negative, 4000) } };
    match.ballots[key] = ballot; return { ballotId: ballot.id, submittedAt: ctx.time, version: ballot.version };
  };
  const currentBallots = match => mapValues(match.ballots).filter(b => b.round === match.ballotRound && match.judgeIds.includes(b.judgeId));
  handlers.close_ballots = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); requireAcknowledgments(match); need(match.ballotState === 'OPEN', 'BALLOTS_CLOSED', 'This round is not open.'); const tally = domain.tabulateBallots(currentBallots(match), match.rules, match.judgeIds); need(tally.complete, 'AWAITING_BALLOTS', 'Await every assigned judge or record an authorized panel change.', { missingJudgeIds: tally.missingJudgeIds, invalid: tally.invalid }); match.ballotState = 'CLOSED'; match.closedTally = applySanctions(tally, match.sanctions || [], match.rules.sanctions).adjustedTally; return { closed: true, status: match.closedTally.status }; };
  handlers.record_sanction = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId);
    need(match.rulesLockedAt && ['live','preparation','break','deliberation'].includes(match.phase) && !match.exceptionalConclusion && !['PROVISIONAL_PUBLISHED','FINAL'].includes(match.ballotState), 'SANCTION_RECORD_LOCKED', 'Record sanctions during the started match. Published decisions require the explicit correction workflow first.');
    requireAcknowledgments(match);
    const command = { action: ctx.payload.action, sanctionId: ctx.payload.sanctionId, target: ctx.payload.target, recordId: ctx.payload.recordId, reason: ctx.payload.reason, confirmed: ctx.payload.confirmed };
    for (const key of Object.keys(command)) if (command[key] === undefined) delete command[key];
    const officialIds = mapValues(ctx.event.members).filter(p => !p.removed && p.admitted && official(ctx.event, match, p.id)).map(p => p.id);
    match.sanctions = appendSanction(match.sanctions || [], command, { policy: match.rules.sanctions, judgingMode: match.rules.judgingMode, ruleVersion: match.ruleVersion, actorId: ctx.actorId, officialIds, now: ctx.time, id: id() });
    const record = match.sanctions.at(-1);
    match.incidents.push({ id: record.id, type: 'sanction', actorId: ctx.actorId, at: ctx.time, reason: record.reason, action: record.action, public: true, sanctionRecordId: record.id });
    if (match.ballotState === 'CLOSED') match.closedTally = applySanctions(domain.tabulateBallots(currentBallots(match), match.rules, match.judgeIds), match.sanctions, match.rules.sanctions).adjustedTally;
    return { record: clone(record), rawScorecardsUnchanged: true, resultStatus: match.closedTally?.status || null };
  };
  handlers.reconsider_ballots = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); need(match.ballotState === 'CLOSED' && match.closedTally?.status === 'UNRESOLVED' && match.ballotRound === 1, 'RECONSIDERATION_UNAVAILABLE', 'Only one same-panel reconsideration is available for an unresolved result.'); match.incidents.push({ id: id(), type: 'reconsideration', reason: text(ctx.payload.reason, 2000, true), judgeIds: clone(match.judgeIds), actorId: ctx.actorId, at: ctx.time, public: true }); match.ballotRound++; match.ballotState = 'REOPENED'; return { round: match.ballotRound }; };
  handlers.create_rematch = ctx => {
    const source = matchOf(ctx.event, ctx.payload), p = ctx.payload; requireOrganizer(ctx.event, ctx.actorId);
    need(p.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the linked rematch while retaining the unresolved result.');
    need(!source.rematchId && !source.requiresReview && source.closedTally?.status === 'UNRESOLVED' && source.ballotRound === 2 && ['CLOSED','PROVISIONAL_PUBLISHED'].includes(source.ballotState), 'REMATCH_NOT_READY', 'Close the one permitted reconsideration round with an unresolved tally before scheduling a rematch.');
    const reconsideration = source.incidents.find(incident => incident.type === 'reconsideration');
    need(reconsideration && JSON.stringify([...(reconsideration.judgeIds || [])].sort()) === JSON.stringify([...source.judgeIds].sort()), 'RECONSIDERATION_PANEL_CHANGED', 'A rematch requires the recorded same-panel reconsideration.');
    need(!source.protests.some(protest => protest.state === 'OPEN'), 'PROTEST_UNRESOLVED', 'Resolve outstanding procedural protests before linking a rematch.');
    const reason = text(p.reason, 2000, true), motionId = p.motionId || source.motionId;
    need(ctx.event.motions[motionId], 'MOTION_NOT_FOUND', 'Choose a prepared event motion for the rematch.');
    if (!latestResult(source)) handlers.publish_result(ctx);
    need(latestResult(source)?.status === 'UNRESOLVED' && !latestResult(source)?.winner, 'REMATCH_NOT_READY', 'The source result must remain published and unresolved.');
    source.phase = 'unresolved';
    const created = handlers.create_match({ ...ctx, payload: { title: p.title || `Rematch — ${source.title}`, motionId, teamIds: clone(source.teamIds), seats: clone(source.seats), captains: clone(source.captains), closingSeats: clone(source.closingSeats), judgeIds: clone(source.judgeIds), chiefId: source.chiefId, moderatorId: source.moderatorId, timekeeperId: source.timekeeperId, hostIds: clone(source.hostIds), rules: clone(source.rules), evenPanelAccepted: source.evenPanelAccepted } });
    const rematch = ctx.event.matches[created.matchId], fixture = transferFixtureToRematch(ctx.event, source, rematch, { at: ctx.time, actorId: ctx.actorId, reason });
    if (fixture) { ctx.event.fixtures = ctx.event.fixtures.map(item => item.id === fixture.id ? fixture : item); source.originalFixtureId = fixture.id; source.fixtureId = null; rematch.fixtureId = fixture.id; }
    source.rematchId = rematch.id; source.rematchReason = reason; source.ballotState = 'UNRESOLVED'; rematch.rematchOf = source.id; rematch.rematchReason = reason;
    source.incidents.push({ id: id(), type: 'rematch_scheduled', actorId: ctx.actorId, at: ctx.time, reason, public: true, rematchId: rematch.id, unresolvedResultId: latestResult(source).id });
    refreshMedia(ctx); updateStandings(ctx.event);
    return { matchId: rematch.id, rematchOf: source.id, unresolvedResultId: latestResult(source).id, fixtureId: rematch.fixtureId || null };
  };
  handlers.change_panel = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); need(match.ballotState !== 'FINAL', 'BALLOTS_CLOSED', 'Use the result-correction procedure after finalization.');
    const judges = ctx.payload.judgeIds; need(Array.isArray(judges) && judges.length >= 1 && judges.length <= 31 && new Set(judges).size === judges.length && judges.every(actorId => !participantSide(match, actorId)), 'ROLE_CONFLICT', 'Choose eligible independent judges.');
    for (const actorId of judges) member(ctx.event, actorId);
    const added = judges.filter(actorId => !match.judgeIds.includes(actorId));
    if (match.rulesLockedAt) need(added.every(actorId => ctx.payload.observedJudgeIds?.includes(actorId)), 'JUDGE_OBSERVATION_REQUIRED', 'A substitute judge must have observed the required debate; record that confirmation.');
    match.panelHistory.push({ judgeIds: match.judgeIds, nextJudgeIds: judges, reason: text(ctx.payload.reason, 2000, true), actorId: ctx.actorId, at: ctx.time, captainNotice: true });
    if (match.nominationRunoff && JSON.stringify([...match.judgeIds].sort()) !== JSON.stringify([...judges].sort())) { match.nominationHistory ||= []; match.nominationHistory.push({ kind: 'panel_change_runoff_reset', nominations: clone(match.nominationRunoff), at: ctx.time, actorId: ctx.actorId, reason: ctx.payload.reason }); delete match.nominationRunoff; }
    match.judgeIds = clone(judges); match.chiefId = judges.includes(match.chiefId) ? match.chiefId : judges[0]; if (!match.rulesLockedAt) { match.ruleVersion++; match.acknowledgments = {}; } refreshMedia(ctx); return { judgeIds: judges };
  };
  function audienceEligible(event, match, actorId) {
    const me = event.members[actorId];
    return me && !me.removed && me.admitted && me.checkedIn && me.roles.includes('observer') && !me.roles.some(r => ['host', 'cohost', 'moderator', 'timekeeper', 'chief', 'judge', 'coach', 'reserve', 'debater'].includes(r)) && !participantSide(match, actorId) && !isJudge(match, actorId) && ![match.moderatorId, match.timekeeperId, ...match.hostIds].includes(actorId);
  }
  const pollOf = (match, payload) => { const poll = match.polls[payload.pollId || match.activePollId]; need(poll, 'POLL_NOT_FOUND', 'Choose an audience poll.'); return poll; };
  handlers.open_poll = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); need(match.phase === 'deliberation' || ['provisional', 'final'].includes(match.phase), 'POLL_NOT_READY', 'The default audience poll opens after the speaking phase.'); need(!match.activePollId || match.polls[match.activePollId].state !== 'Open', 'POLL_ALREADY_OPEN', 'Close the current audience poll first.'); const pollId = id(); match.polls[pollId] = { id: pollId, state: 'Open', eligible: mapValues(ctx.event.members).filter(p => audienceEligible(ctx.event, match, p.id)).map(p => p.id), votes: {}, history: [], openedAt: ctx.time }; match.activePollId = pollId; return { pollId }; };
  handlers.vote = ctx => { const match = matchOf(ctx.event, ctx.payload), poll = pollOf(match, ctx.payload); need(poll.state === 'Open', 'POLL_CLOSED', 'This audience poll is closed.'); need(poll.eligible.includes(ctx.actorId) && audienceEligible(ctx.event, match, ctx.actorId), 'FORBIDDEN', 'You are not an eligible observer for this poll round.'); need(sides.includes(ctx.payload.side), 'INVALID_VOTE', 'Choose Affirmative or Negative.'); if (poll.votes[ctx.actorId]) poll.history.push(clone(poll.votes[ctx.actorId])); poll.votes[ctx.actorId] = { id: id(), accountId: ctx.actorId, side: ctx.payload.side, at: ctx.time }; return { voteId: poll.votes[ctx.actorId].id, accepted: true }; };
  handlers.withdraw_vote = ctx => { const match = matchOf(ctx.event, ctx.payload), poll = pollOf(match, ctx.payload); need(poll.state === 'Open', 'POLL_CLOSED', 'This audience poll is closed.'); if (poll.votes[ctx.actorId]) { poll.history.push(clone(poll.votes[ctx.actorId])); poll.votes[ctx.actorId].side = null; poll.votes[ctx.actorId].withdrawnAt = ctx.time; } return { withdrawn: true }; };
  handlers.close_poll = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const poll = pollOf(match, ctx.payload); need(poll.state === 'Open', 'POLL_CLOSED', 'This audience poll is not open.'); poll.state = 'Closed'; poll.closedAt = ctx.time; return { closed: true }; };
  handlers.publish_poll = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const poll = pollOf(match, ctx.payload); need(poll.state === 'Closed', 'POLL_NOT_READY', 'Close the audience poll first.'); poll.result = domain.calculateAudienceResult({ eligibleAccountIds: poll.eligible, votes: mapValues(poll.votes).map(v => ({ accountId: v.accountId, choice: v.side, withdrawn: !!v.withdrawnAt, invalidated: !!v.invalidatedAt })) }); poll.state = 'Published'; return { result: poll.result }; };
  const latestResult = match => match.resultVersions.at(-1);
  handlers.publish_result = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId);
    need(!match.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve the affected matchup before publishing its official result.');
    need(!latestResult(match) || latestResult(match).state === 'SUPERSEDED', 'RESULT_ALREADY_PUBLISHED', 'Use the correction workflow for a published result.');
    const exceptional = match.exceptionalConclusion;
    need(exceptional || match.ballotState === 'CLOSED', 'BALLOTS_NOT_READY', 'Close all required ballots first.');
    if (!exceptional) requireAcknowledgments(match);
    const rawTally = exceptional ? { status: exceptional.winner ? 'DECIDED' : 'UNRESOLVED', winner: exceptional.winner, teamScores: null, ballotSplit: null, judgingMode: match.rules.judgingMode } : domain.tabulateBallots(currentBallots(match), match.rules, match.judgeIds);
    const sanctionResult = exceptional ? { rawTally: clone(rawTally), adjustedTeamScores: null, adjustments: [], adjustedTally: clone(rawTally), awardBasis: 'raw_scorecards', application: 'not_applied_exceptional_conclusion' } : applySanctions(rawTally, match.sanctions || [], match.rules.sanctions);
    const tally = sanctionResult.adjustedTally;
    const version = { id: id(), revision: match.resultVersions.length + 1, state: 'PROVISIONAL_PUBLISHED', publishedAt: ctx.time, correctionDeadline: ctx.time + match.rules.correctionWindowMs, actorId: ctx.actorId, ruleVersion: match.ruleVersion, ...tally, ...sanctionResult, sanctions: clone(match.sanctions || []), motion: clone(ctx.event.motions[match.motionId] || null), resultKind: exceptional?.kind || (tally.winner ? 'normal' : 'unresolved'), feedback: {}, awards: null };
    if (ctx.payload.releaseFeedback === true) for (const side of sides) version.feedback[side] = currentBallots(match).map(b => b.feedback[side]).filter(Boolean);
    match.resultVersions.push(version); match.phase = 'provisional'; match.ballotState = 'PROVISIONAL_PUBLISHED';
    const fixture = getBoundFixture(ctx.event, match); if (fixture) { fixture.status = 'PROVISIONAL'; fixture.resultId = version.id; fixture.resultRevision = version.revision; fixture.resultKind = version.resultKind; }
    return { resultId: version.id, revision: version.revision, status: version.status };
  };
  handlers.protest_result = ctx => { const match = matchOf(ctx.event, ctx.payload), result = latestResult(match); need(sides.some(side => match.captains[side] === ctx.actorId), 'FORBIDDEN', 'Only an assigned captain can file a result protest.'); need(result?.state === 'PROVISIONAL_PUBLISHED' && ctx.time <= result.correctionDeadline, 'CORRECTION_WINDOW_CLOSED', 'The procedural correction window has closed.'); const protest = { id: id(), resultId: result.id, actorId: ctx.actorId, reason: text(ctx.payload.reason, 2000, true), type: ['calculation', 'eligibility', 'procedure'].includes(ctx.payload.type) ? ctx.payload.type : 'procedure', state: 'OPEN', at: ctx.time }; match.protests.push(protest); return { protestId: protest.id }; };
  handlers.resolve_protest = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); const protest = match.protests.find(p => p.id === ctx.payload.protestId); need(protest, 'PROTEST_NOT_FOUND', 'Choose an existing protest.'); protest.state = 'RESOLVED'; protest.disposition = text(ctx.payload.disposition, 2000, true); protest.resolvedAt = ctx.time; protest.resolvedBy = ctx.actorId; return { resolved: true }; };
  handlers.nominate_award = ctx => {
    const match = matchOf(ctx.event, ctx.payload); need(isJudge(match, ctx.actorId), 'FORBIDDEN', 'Only an assigned judge may nominate an award.'); need(match.ballotState !== 'FINAL', 'BALLOTS_CLOSED', 'Nominations close on finalization.'); need(seatNames.includes(ctx.payload.nomineeId), 'INVALID_NOMINEE', 'Choose one of the six actual speaking seats.');
    const nomination = { judgeId: ctx.actorId, nomineeId: ctx.payload.nomineeId, reason: text(ctx.payload.reason, 2000, true) };
    if (ctx.payload.runoff) {
      const state = domain.calculateNominationAward({ nominations: mapValues(match.nominations).filter(n => match.judgeIds.includes(n.judgeId)), activeJudgeIds: match.judgeIds });
      need(state.status === 'RUNOFF_REQUIRED' && state.candidates.includes(nomination.nomineeId), 'INVALID_NOMINEE', 'The runoff is limited to tied top nominees after every initial nomination is submitted.');
      match.nominationRunoff ||= {}; need(!match.nominationRunoff[ctx.actorId], 'NOMINATION_ALREADY_SUBMITTED', 'Your runoff nomination is already saved.'); match.nominationRunoff[ctx.actorId] = nomination;
    } else {
      need(!match.nominationRunoff, 'NOMINATIONS_LOCKED', 'Initial nominations are locked once the single runoff begins.');
      if (match.nominations[ctx.actorId]) { match.nominationHistory ||= []; match.nominationHistory.push({ kind: 'initial_revision', previous: clone(match.nominations[ctx.actorId]), at: ctx.time }); }
      match.nominations[ctx.actorId] = nomination;
    }
    return { saved: true };
  };
  const updateStandings = event => {
    if (mapValues(event.teams).length < 2) return;
    const matches = mapValues(event.matches).filter(m => latestResult(m)?.state === 'FINAL').map(m => { const r = latestResult(m); return { id: m.id, status: 'FINAL', resultKind: r.resultKind, affirmativeTeamId: m.teamIds.affirmative, negativeTeamId: m.teamIds.negative, winnerTeamId: r.winner ? m.teamIds[r.winner] : null, teamScores: r.teamScores, rubricId: domain.rubricFingerprint(m.rules) }; });
    event.standings = domain.calculateStandings(Object.keys(event.teams), matches);
  };
  handlers.finalize_result = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); const result = latestResult(match);
    need(!match.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve the affected matchup before finalizing its official result.');
    need(result?.state === 'PROVISIONAL_PUBLISHED', 'RESULT_NOT_READY', 'Publish provisional results first.'); need(ctx.time >= result.correctionDeadline, 'CORRECTION_WINDOW_OPEN', 'Wait until the correction window closes.'); need(!match.protests.some(p => p.state === 'OPEN'), 'PROTEST_UNRESOLVED', 'Resolve outstanding protests before finalization.');
    need(result.winner || ['cancelled', 'double_forfeit', 'withdrawn', 'postponed'].includes(result.resultKind), 'RESULT_UNRESOLVED', 'Resolve the tie or schedule the declared tie-resolution process.');
    result.state = 'FINAL'; result.finalizedAt = ctx.time; result.finalizedBy = ctx.actorId;
    if (result.resultKind === 'normal' && !match.awardEligibilityReview) {
      const nominations = mapValues(match.nominations).filter(n => match.judgeIds.includes(n.judgeId));
      result.awards = domain.calculateAwards({ ballots: currentBallots(match), rules: match.rules, activeJudgeIds: match.judgeIds, closingSeats: match.closingSeats, nominations, runoff: match.nominationRunoff ? mapValues(match.nominationRunoff).filter(n => match.judgeIds.includes(n.judgeId)) : null, matchStatus: 'FINAL', sanctions: match.sanctions || [] });
      if (match.rules.judgingMode === 'simple' && !nominations.length) result.awards.bestDebater = { status: 'UNAVAILABLE', reason: 'No optional nomination award was submitted before finalization.' };
      else need(!['AWAITING_NOMINATIONS','RUNOFF_REQUIRED','AWAITING_RUNOFF'].includes(result.awards.bestDebater?.status), 'NOMINATIONS_NOT_READY', 'Complete the assigned judges’ reasoned nominations and required top-candidate runoff before finalizing awards.', { status: result.awards.bestDebater?.status });
    }
    else result.awards = { status: 'UNAVAILABLE', reason: match.awardEligibilityReview ? 'Substitution requires review of actual speaker opportunities.' : 'No speech awards are generated for this exceptional conclusion.' };
    const capture = captureTournamentMatch(match, result);
    if (capture.eligible) result.tournamentRecord = clone(capture.record); else result.tournamentExclusion = { reason: capture.reason, message: capture.message };
    match.ballotState = 'FINAL'; match.phase = 'final';
    const fixture = getBoundFixture(ctx.event, match);
    if (fixture) { fixture.status = 'FINAL'; fixture.resultId = result.id; fixture.resultRevision = result.revision; fixture.resultKind = result.resultKind; fixture.winnerTeamId = result.winner ? match.teamIds[result.winner] : null; }
    updateStandings(ctx.event); return { resultId: result.id, revision: result.revision, awards: result.awards };
  };
  handlers.correct_result = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); const previous = latestResult(match); need(previous && ['PROVISIONAL_PUBLISHED', 'FINAL'].includes(previous.state), 'RESULT_NOT_READY', 'Choose a published result to correct.');
    const reason = text(ctx.payload.reason, 2000, true); previous.state = 'SUPERSEDED'; previous.supersededAt = ctx.time;
    match.incidents.push({ id: id(), type: 'result_correction', reason, actorId: ctx.actorId, at: ctx.time, public: true, supersededResultId: previous.id });
    const bound = getBoundFixture(ctx.event, match);
    if (bound) {
      const marked = markFixtureCorrection(ctx.event.fixtures, bound.id, { resultId: previous.id, resultRevision: previous.revision, at: ctx.time, actorId: ctx.actorId, reason }); ctx.event.fixtures = marked.fixtures;
      for (const fixtureId of marked.affectedFixtureIds) { const dependent = mapValues(ctx.event.matches).find(m => m.fixtureId === fixtureId); if (dependent) dependent.requiresReview = true; }
      match.downstreamReviewRequired = marked.affectedFixtureIds.length > 0;
    }
    match.ballotRound++; match.ballotState = 'REOPENED'; match.phase = 'deliberation'; updateStandings(ctx.event);
    for (const job of mapValues(ctx.event.jobs)) if (job.resultVersion === previous.id) job.superseded = true;
    return { supersededResultId: previous.id, round: match.ballotRound, downstreamReviewRequired: match.downstreamReviewRequired };
  };

  handlers.quiet_observers = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId);
    need(typeof ctx.payload.quiet === 'boolean', 'INVALID_SETTING', 'Choose whether observer public chat is quiet.');
    match.quietObservers = ctx.payload.quiet; match.quietReason = text(ctx.payload.reason, 2000, true);
    return { quietObservers: match.quietObservers };
  };
  handlers.send_message = ctx => {
    const match = matchOf(ctx.event, ctx.payload), channel = ctx.payload.channel || 'public'; need(canChannel(ctx.event, match, ctx.actorId, channel, true), 'FORBIDDEN', 'You cannot send to this audience during the current stage.');
    need(match.messages.filter(m => m.actorId === ctx.actorId && m.at > ctx.time - 10000).length < 6, 'MESSAGE_RATE_LIMIT', 'Please wait a moment before sending another message.');
    const blockedRecipients = channel.startsWith('team:') && currentStage(match)?.kind === 'interpellation' ? activeSeats(match).map(s => match.seats[s]) : [];
    const message = { id: id(), actorId: ctx.actorId, channel, text: text(ctx.payload.text, 2000, true), at: ctx.time, blockedRecipients };
    need(match.messages.length < 10000, 'MESSAGE_LIMIT', 'This match has reached its message limit.'); match.messages.push(message); return { messageId: message.id, sent: true, audience: channel };
  };
  handlers.share_evidence = async ctx => {
    const match = matchOf(ctx.event, ctx.payload), p = ctx.payload, channel = p.channel || 'public';
    need(participantSide(match, ctx.actorId) || official(ctx.event, match, ctx.actorId), 'FORBIDDEN', 'A competing team or authorized official must submit evidence.');
    need(canChannel(ctx.event, match, ctx.actorId, channel, true), 'FORBIDDEN', 'You cannot share evidence to this audience.');
    const closingStarted = match.attempts.some(a => a.stageId === 'stage-13' && a.state !== 'READY');
    if (closingStarted) { requireOfficial(ctx.event, match, ctx.actorId); text(p.ruling, 2000, true); }
    need(match.evidence.filter(e => !e.deletedAt && e.attachment).length < 20 || !p.attachment, 'EVIDENCE_LIMIT', 'This match permits at most 20 active shared files.');
    let sourceUrl = null; if (p.sourceUrl) { try { const url = new URL(p.sourceUrl); need(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'UNSAFE_URL', 'Use an ordinary HTTP or HTTPS source link.'); sourceUrl = url.toString(); } catch { fail('UNSAFE_URL', 'Enter a valid source link.'); } }
    let attachment = null;
    if (p.attachment) {
      need(['application/pdf', 'image/png', 'image/jpeg'].includes(p.attachment.mimeType) && Number.isInteger(p.attachment.size) && p.attachment.size > 0 && p.attachment.size <= 10485760, 'UNSAFE_FILE', 'Use a PDF, PNG or JPEG no larger than 10 MB.');
      need(typeof adapters.validateEvidence === 'function', 'EVIDENCE_UNCONFIGURED', 'Secure evidence upload verification is not configured.');
      attachment = await adapters.validateEvidence({ actorId: ctx.actorId, eventId: ctx.event.id, matchId: match.id, channel, uploadId: p.attachment.uploadId, mimeType: p.attachment.mimeType, size: p.attachment.size });
      need(attachment?.verified === true && /^[a-f0-9]{64}$/.test(attachment.digest || ''), 'UNSAFE_FILE', 'This uploaded file has not passed integrity and ownership checks.');
      const reservation = await store.readUpload(attachment.id);
      need(reservation && reservation.actorId === ctx.actorId && reservation.eventId === ctx.event.id && reservation.matchId === match.id && reservation.channel === channel && reservation.status === 'uploaded' && reservation.expiresAt > ctx.time
        && reservation.storageKey === attachment.storageKey && reservation.metadata?.digest === attachment.digest && reservation.metadata?.size === attachment.size, 'UPLOAD_UNAVAILABLE', 'This verified upload is unavailable or already shared.');
      ctx.consumeUploads.push(reservation.id); ctx.cancelJobs.push(reservation.cleanupJobId);
    }
    const previous = p.previousId ? match.evidence.find(e => e.id === p.previousId && e.actorId === ctx.actorId) : null; need(!p.previousId || previous, 'EVIDENCE_NOT_FOUND', 'You can revise only your own evidence.');
    const evidence = { id: id(), actorId: ctx.actorId, team: participantSide(match, ctx.actorId) || null, matchId: match.id, title: text(p.title, 160, true), description: text(p.description, 2000), sourceUrl, attachment: attachment ? { id: attachment.id, mimeType: attachment.mimeType, size: attachment.size, digest: attachment.digest, scanStatus: attachment.scanStatus || 'not_scanned' } : null, storageKey: attachment?.storageKey || null, channel, version: (previous?.version || 0) + 1, previousId: previous?.id || null, at: ctx.time, lateRuling: p.ruling || null };
    match.evidence.push(evidence); return { evidenceId: evidence.id, version: evidence.version };
  };
  handlers.generate_fixtures = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, teams = p.teamIds || Object.keys(ctx.event.teams); need(teams.every(t => ctx.event.teams[t]), 'TEAM_NOT_FOUND', 'Use registered event teams.');
    need((p.motionIds || []).every(motionId => ctx.event.motions[motionId]), 'MOTION_NOT_FOUND', 'Fixture motions must belong to this event.');
    let generation;
    if (p.method === 'round_robin') generation = domain.generateRoundRobin(teams, { motionIds: p.motionIds || [], motionReusePolicy: p.motionReusePolicy || 'none' });
    else if (p.method === 'elimination') { const order = clone(p.seedOrder || teams); let draw = null; if (p.random === true) { for (let i = order.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [order[i], order[j]] = [order[j], order[i]]; } draw = { actorId: ctx.actorId, atMs: ctx.time, teamOrder: order, reroll: (ctx.event.fixtureDraws?.length || 0) }; } generation = domain.generateElimination(teams, { seedOrder: order, randomDraw: draw, motionIds: p.motionIds || [], motionReusePolicy: p.motionReusePolicy || 'none' }); }
    else fail('INVALID_FIXTURE_METHOD', 'Choose round-robin or single elimination; manual fixtures are created with individual matches.');
    ctx.event.fixtureDraft = generation; ctx.event.fixtureDraws ||= []; ctx.event.fixtureDraws.push({ at: ctx.time, actorId: ctx.actorId, method: p.method, generation: clone(generation) }); return { generation };
  };
  handlers.publish_fixtures = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(ctx.payload.confirmed === true && ctx.event.fixtureDraft, 'CONFIRMATION_REQUIRED', 'Review and confirm the generated fixtures.'); need(!ctx.event.fixtures.some(f => f.matchId || fixtureWasStarted(f)), 'FIXTURES_LOCKED', 'Bound or started fixtures cannot be overwritten.'); ctx.event.fixtures = clone(ctx.event.fixtureDraft.fixtures); ctx.event.fixtureDraft.needsReview = false; return { published: true, fixtures: ctx.event.fixtures }; };
  handlers.advance_match = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload), result = latestResult(match); need(result?.state === 'FINAL' && result.winner, 'RESULT_UNRESOLVED', 'Finalize a resolved official winner before advancing.');
    need(!match.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve this match’s fixture review before advancing its result.');
    need(!ctx.payload.fixtureId || ctx.payload.fixtureId === match.fixtureId, 'FIXTURE_BINDING_CONFLICT', 'A result can advance only its own recorded fixture.');
    const fixture = getBoundFixture(ctx.event, match);
    if (fixture) { need(!fixture.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve the fixture review before advancing.'); const update = domain.applyFixtureResult(ctx.event.fixtures, fixture.id, { status: 'FINAL', winnerTeamId: match.teamIds[result.winner], revision: result.revision, resultKind: result.resultKind }); ctx.event.fixtures = update.fixtures; for (const reviewId of update.downstreamReviewMatchIds) { const affected = mapValues(ctx.event.matches).find(m => m.fixtureId === reviewId); if (affected) affected.requiresReview = true; } }
    if (ctx.payload.nextMatchId) { const next = ctx.event.matches[ctx.payload.nextMatchId]; need(next && next.id !== match.id && next.phase === 'setup', 'MATCH_NOT_READY', 'Choose a different prepared next match.'); need(!next.requiresReview, 'FIXTURE_REVIEW_REQUIRED', 'Resolve the next match’s fixture review.'); const nextFixture = getBoundFixture(ctx.event, next); if (nextFixture) requireResolvedFixture(ctx.event, nextFixture); validateAssignments(ctx.event, next); ctx.event.activeMatchId = next.id; }
    ctx.event.status = 'draft'; return { activeMatchId: ctx.event.activeMatchId, fixtures: ctx.event.fixtures };
  };
  handlers.resolve_fixture_review = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const fixture = ctx.event.fixtures.find(f => f.id === ctx.payload.fixtureId);
    need(fixture?.requiresReview, 'FIXTURE_REVIEW_NOT_REQUIRED', 'Choose an affected fixture awaiting a recorded review.');
    const reason = text(ctx.payload.reason, 2000, true), match = fixture.matchId ? ctx.event.matches[fixture.matchId] : null;
    const started = fixtureWasStarted(fixture, match), resolution = ctx.payload.resolution;
    need(started ? resolution === 'retain_played' : resolution === 'rebind_unstarted', 'INVALID_FIXTURE_RESOLUTION', started ? 'A started match may be retained only by an explicit recorded decision; use the result correction procedure if its outcome must change.' : 'An unstarted match must rebind to the current finalized predecessor winners.');
    const reviewed = clone(fixture); reviewed.requiresReview = false;
    for (const side of sides) { const sourceId = reviewed[`${side}Source`]; if (sourceId) { const source = ctx.event.fixtures.find(f => f.id === sourceId); need(source && ['FINAL','BYE'].includes(source.status) && source.winnerTeamId && !source.requiresReview, 'FIXTURE_PREDECESSORS_PENDING', 'Resolve and finalize predecessor reviews first.'); reviewed[`${side}TeamId`] = source.winnerTeamId; } }
    requireResolvedFixture(ctx.event, reviewed);
    fixture.reviewHistory ||= []; fixture.reviewHistory.push({ at: ctx.time, actorId: ctx.actorId, reason, resolution, correction: clone(fixture.pendingCorrection), originalTeamIds: { affirmative: fixture.affirmativeTeamId, negative: fixture.negativeTeamId }, currentSourceTeamIds: { affirmative: reviewed.affirmativeTeamId, negative: reviewed.negativeTeamId } });
    if (!started) {
      fixture.affirmativeTeamId = reviewed.affirmativeTeamId; fixture.negativeTeamId = reviewed.negativeTeamId; fixture.status = 'SCHEDULED';
      if (match) { for (const side of sides) { const team = ctx.event.teams[fixture[`${side}TeamId`]]; need(team, 'TEAM_NOT_FOUND', 'A current predecessor team is unavailable.'); match.teamIds[side] = team.id; match.captains[side] = team.captainId; team.speakerIds.forEach((actorId, index) => { match.seats[`${side === 'affirmative' ? 'A' : 'N'}${index + 1}`] = actorId; }); } match.ruleVersion++; match.acknowledgments = {}; match.deviceChecks = {}; match.accommodations = {}; validateAssignments(ctx.event, match); }
    } else fixture.retainedAfterReview = true;
    fixture.requiresReview = false; delete fixture.pendingCorrection;
    if (match) { match.requiresReview = false; match.incidents.push({ id: id(), type: 'fixture_review', actorId: ctx.actorId, at: ctx.time, reason, resolution, public: true }); }
    for (const candidate of mapValues(ctx.event.matches)) if (candidate.downstreamReviewRequired) candidate.downstreamReviewRequired = ctx.event.fixtures.some(f => f.requiresReview && (f.pendingCorrection?.sourceFixtureId || f.pendingCorrection?.sourceMatchId) === candidate.fixtureId);
    return { fixtureId: fixture.id, resolution, ruleAcknowledgmentsRequired: Boolean(match && !started), preservedStartedMatch: started };
  };
  handlers.nominate_tournament_award = ctx => {
    const summary = calculateEventTournamentAwards(ctx.event, { nominationRunoffs: ctx.event.tournamentNominationRunoffs || [] }), group = summary.comparableGroups.find(g => g.rubric === ctx.payload.rubric);
    need(group && ['RUNOFF_REQUIRED','AWAITING_RUNOFF'].includes(group.bestDebater.status), 'TOURNAMENT_RUNOFF_NOT_READY', 'A tied eligible tournament nomination result is required.');
    const panel = group.bestDebater.eligibleRunoffJudgeIds; need(panel.includes(ctx.actorId), 'FORBIDDEN', 'Only the eligible assigned judges who observed every top candidate may enter this runoff.');
    const candidates = group.bestDebater.topCandidateIds; need(candidates.includes(ctx.payload.nomineeId), 'INVALID_NOMINEE', 'Choose a tied top candidate by their participant identity.');
    const resultIds = group.sourceResults.map(r => r.resultId); ctx.event.tournamentNominationRunoffs ||= [];
    let round = ctx.event.tournamentNominationRunoffs.find(r => r.rubric === group.rubric);
    if (!round || JSON.stringify([...round.resultIds].sort()) !== JSON.stringify([...resultIds].sort())) { ctx.event.tournamentNominationRunoffs = ctx.event.tournamentNominationRunoffs.filter(r => r.rubric !== group.rubric); round = { rubric: group.rubric, resultIds, activeJudgeIds: panel, nominations: [], openedAt: ctx.time }; ctx.event.tournamentNominationRunoffs.push(round); }
    need(!round.nominations.some(n => n.judgeId === ctx.actorId), 'TOURNAMENT_RUNOFF_ALREADY_SUBMITTED', 'Your confirmed tournament runoff nomination is already saved.');
    need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Review and confirm this reasoned tournament nomination.');
    round.nominations.push({ judgeId: ctx.actorId, nomineeId: ctx.payload.nomineeId, reason: text(ctx.payload.reason, 2000, true), submittedAt: ctx.time });
    return { saved: true, eventAwards: calculateEventTournamentAwards(ctx.event, { nominationRunoffs: ctx.event.tournamentNominationRunoffs }) };
  };

  function authorizedDocument(event, match, actorId, kind, resultId, options = {}) {
    const person = member(event, actorId), host = organizer(event, actorId);
    need(person.admitted, 'FORBIDDEN', 'Wait for admission before requesting event documents.');
    need(!match.officialRecordsExpired, 'RECORDS_EXPIRED', 'These official records reached the approved retention period.');
    need(['rules', 'scorecard', 'result', 'event_report', 'csv', 'certificate'].includes(kind), 'INVALID_EXPORT', 'Choose a supported export.');
    const base = { eventId: event.id, eventTitle: event.title, matchId: match.id, matchTitle: match.title, rules: clone(match.rules), rulesVersion: match.ruleVersion, runOfShow: clone(match.runOfShow.length ? match.runOfShow : domain.createRunOfShow(match.rules, match.closingSeats)), createdFor: actorId, rehearsal: event.rehearsal,
      seats: clone(match.seats), teams: clone(match.teamIds), teamRoster: mapValues(event.teams).map(({ id, name }) => ({ id, name })),
      participants: mapValues(event.members).filter(p => !p.removed && (p.checkedIn || Object.values(match.seats).includes(p.id))).map(({ id, displayName }) => ({ id, displayName })) };
    if (kind === 'rules') return { ...base, kind, motion: event.motions[match.motionId]?.releasedAt || host ? clone(event.motions[match.motionId] || null) : null };
    if (kind === 'scorecard') { need(isJudge(match, actorId), 'FORBIDDEN', 'Only the judge can export their own scorecard.'); return { ...base, kind, ballot: clone(match.ballots[`${match.ballotRound}:${actorId}`] || null), draft: clone(match.drafts[actorId] || null) }; }
    const result = match.resultVersions.find(r => r.id === (resultId || latestResult(match)?.id)); need(result && ['PROVISIONAL_PUBLISHED', 'FINAL'].includes(result.state), 'RESULT_NOT_READY', 'Choose a currently published result.');
    let certificate = {};
    if (kind === 'certificate') {
      requireOrganizer(event, actorId); need(result.state === 'FINAL', 'RESULT_NOT_READY', 'Certificates require finalized records.');
      const participant = member(event, options.participantId), attendance = match.checkIns?.[participant.id];
      need(attendance, 'PARTICIPATION_UNCONFIRMED', 'A certificate for this match requires attendance recorded for this match before it concluded.');
      const roles = [];
      if (participantSide(match, participant.id)) roles.push('debater');
      if (Object.values(match.captains).includes(participant.id)) roles.push('captain');
      if (isJudge(match, participant.id)) roles.push('judge');
      for (const [field, role] of [['chiefId','chief'], ['moderatorId','moderator'], ['timekeeperId','timekeeper']]) if (match[field] === participant.id) roles.push(role);
      roles.push(...participant.roles.filter(role => ['host','cohost'].includes(role) || ['coach','reserve'].includes(role) && Object.values(match.teamIds).includes(participant.teamId)));
      if (!roles.length) roles.push('observer');
      certificate = { participant: { id: participant.id, displayName: participant.displayName, roles: [...new Set(roles)] }, participation: clone(attendance), certificateType: options.awardKey ? 'award' : 'participation', issuer: 'Event organizer', awardKey: options.awardKey || null };
      if (options.awardKey) {
        need(['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker', 'bestDebater'].includes(options.awardKey), 'INVALID_AWARD', 'Choose an award from the finalized result.');
        const award = result.awards?.[options.awardKey];
        need(['AWARDED', 'COAWARD'].includes(award?.status) && award.winners?.some(seat => match.seats[seat] === participant.id), 'AWARD_UNCONFIRMED', 'This participant did not receive that finalized award.');
        certificate.award = clone(award);
      }
    }
    if (kind === 'event_report') requireOrganizer(event, actorId);
    const visibleEvent = snapshotEvent(event, actorId, now()), visible = visibleEvent.matches.find(m => m.id === match.id).resultVersions.find(r => r.id === result.id);
    const publishedPoll = match.polls[match.activePollId];
    return { ...base, kind, ...certificate, result: visible, resultVersion: result.id, resultRevision: result.revision,
      audienceChoice: publishedPoll?.state === 'Published' ? { pollId: publishedPoll.id, state: publishedPoll.state, publishedAt: publishedPoll.publishedAt, result: clone(publishedPoll.result) } : null,
      ...(kind === 'event_report' ? { standings: clone(event.standings), fixtures: clone(event.fixtures), eventAwards: visibleEvent.eventAwards } : {}) };
  }
  handlers.create_export = ctx => { const match = matchOf(ctx.event, ctx.payload), document = authorizedDocument(ctx.event, match, ctx.actorId, ctx.payload.kind || 'result', ctx.payload.resultId, ctx.payload); const format = ctx.payload.format || (ctx.payload.kind === 'csv' ? 'csv' : 'pdf'); need(['pdf','csv'].includes(format), 'INVALID_EXPORT', 'Choose PDF or CSV.'); const jobId = enqueue(ctx, 'export', { matchId: match.id, document, format }, document.resultVersion); return { jobId, status: 'queued' }; };
  handlers.send_results = async ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload), p = ctx.payload;
    need(p.confirmed === true && p.previewConfirmed === true, 'CONFIRMATION_REQUIRED', 'Preview the recipients and explicitly confirm Send.');
    need(Array.isArray(p.recipientIds) && p.recipientIds.length > 0 && p.recipientIds.length <= 100, 'INVALID_RECIPIENTS', 'Choose event participants as recipients.');
    const jobIds = [];
    for (const actorId of [...new Set(p.recipientIds)]) { member(ctx.event, actorId); if (ctx.event.rehearsal) need(limits.approvedRehearsalRecipientIds?.includes(actorId), 'FORBIDDEN', 'Rehearsal mail is limited to approved test recipients.'); const document = authorizedDocument(ctx.event, match, actorId, 'result', p.resultId); need(await store.rateLimit(ctx.actorId, 'result_mail_recipient_hour', ctx.time, 100, 3600000), 'MAIL_RATE_LIMIT', 'This organizer has reached the hourly result recipient allowance.'); jobIds.push(enqueue(ctx, 'mail', { matchId: match.id, recipientId: actorId, document, rehearsal: ctx.event.rehearsal }, document.resultVersion)); }
    return { jobIds, status: 'queued', delivery: 'not_yet_attempted' };
  };
  handlers.cancel_job = ctx => { const job = ctx.event.jobs[ctx.payload.jobId]; need(job && (job.actorId === ctx.actorId || organizer(ctx.event, ctx.actorId)), 'FORBIDDEN', 'You cannot manage this job.'); need(!['media', 'delete_evidence', 'delete_export'].includes(job.type), 'FORBIDDEN', 'Lifecycle cleanup cannot be cancelled. An authorized retention hold protects eligible retained records.'); need(['queued', 'failed'].includes(job.status), 'JOB_NOT_READY', 'Only queued or failed work can be cancelled.'); job.status = 'cancelled'; ctx.cancelJobs.push(job.id); return { cancelled: true }; };
  handlers.retry_job = ctx => { const job = ctx.event.jobs[ctx.payload.jobId]; need(job && (job.actorId === ctx.actorId || organizer(ctx.event, ctx.actorId)), 'FORBIDDEN', 'You cannot manage this job.'); need(job.status === 'failed', 'JOB_NOT_READY', 'This job is not awaiting retry.'); job.status = 'queued'; ctx.retryJobs.push(job.id); return { queued: true }; };
  handlers.set_retention = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); need(ctx.actor.platformOperator === true, 'FORBIDDEN', 'Retention policy changes require an authorized platform operator.');
    for (const field of ['operationalDays', 'chatDays', 'evidenceDays', 'officialDays']) if (ctx.payload[field] !== undefined) {
      need(Number.isInteger(ctx.payload[field]) && ctx.payload[field] >= 1 && ctx.payload[field] <= 3650, 'INVALID_RETENTION', 'Choose a retention period from 1 to 3650 days.');
      need(!ctx.event.retention.purged?.[field.replace('Days', '')] || ctx.payload[field] === ctx.event.retention[field], 'RETENTION_ALREADY_APPLIED', 'Expired records cannot be restored by changing their retention period.');
      ctx.event.retention[field] = ctx.payload[field];
    }
    if (ctx.payload.approved !== undefined) { need(typeof ctx.payload.approved === 'boolean', 'INVALID_RETENTION', 'Choose whether this policy is approved.'); ctx.event.retention.approved = ctx.payload.approved; }
    if (ctx.payload.hold !== undefined) { need(typeof ctx.payload.hold === 'boolean', 'INVALID_RETENTION', 'Choose whether these records are on hold.'); ctx.event.retention.hold = ctx.payload.hold; ctx.event.retention.holdReason = text(ctx.payload.reason, 2000, true); }
    ctx.event.retention.approvedBy = ctx.actorId; ctx.event.retention.reviewedAt = ctx.time;
    ctx.event.retention.nextCleanupAt = retentionDeadline(ctx.event);
    return { retention: ctx.event.retention };
  };
  async function cleanupRecords(ctx) {
    const policy = ctx.event.retention;
    need(policy.approved === true, 'RETENTION_UNAPPROVED', 'An authorized platform operator must approve retention before cleanup.');
    need(!policy.hold, 'RETENTION_HOLD', 'A documented hold protects these records.');
    const ended = ctx.event.endsAt, due = category => Boolean(ended && ctx.time >= ended + policy[`${category}Days`] * DAY && !policy.purged?.[category]);
    const categories = ['operational', 'chat', 'evidence', 'official'].filter(due);
    let messages = 0, drafts = 0, evidence = 0;
    for (const match of mapValues(ctx.event.matches)) {
      if (due('chat')) { messages += match.messages.length; drafts += Object.keys(match.drafts).length; match.messages = []; match.drafts = {}; match.draftHistory = []; }
      if (due('evidence')) {
        evidence += match.evidence.length;
        for (const item of match.evidence) if (item.storageKey) enqueue(ctx, 'delete_evidence', { matchId: match.id, storageKey: item.storageKey, retainedEvidence: true });
        match.evidence = [];
      }
      if (due('operational')) {
        for (const field of ['deviceChecks', 'accommodations', 'floorGrants', 'privateRoomInvitations']) match[field] = {};
        match.incidents = []; match.presenterId = null;
        for (const poll of mapValues(match.polls)) { poll.votes = {}; poll.eligible = []; }
      }
      if (due('official')) {
        for (const field of ['ballots', 'nominations', 'nominationRunoff', 'acknowledgments', 'checkIns']) match[field] = {};
        for (const field of ['ballotHistory', 'resultVersions', 'rulesHistory', 'panelHistory', 'rosterHistory', 'protests', 'attempts', 'runOfShow', 'nominationHistory', 'noShowFindings', 'sanctions']) match[field] = [];
        match.polls = {}; match.activePollId = null; match.closedTally = null; match.timer = null; match.currentStageIndex = -1;
        match.rules = null; match.exceptionalConclusion = null; match.motionId = null;
        match.officialRecordsExpired = true;
      }
    }
    if (due('operational')) { ctx.event.invites = {}; for (const p of mapValues(ctx.event.members)) p.conflictDeclarations = []; for (const [actorId, session] of Object.entries(ctx.event.media)) if (session.status === 'left') delete ctx.event.media[actorId]; }
    if (due('official')) { ctx.event.fixtures = []; ctx.event.fixtureDraft = null; ctx.event.fixtureDraws = []; ctx.event.standings = null; ctx.event.tournamentNominationRunoffs = []; ctx.event.motions = {}; ctx.event.activeMatchId = null; }
    const expired = await store.expiredJobs(ctx.event.id, ctx.time);
    for (const job of expired) {
      if (job.type === 'export') enqueue(ctx, 'delete_export', { sourceJobId: job.id, storageKey: `exports/${ctx.event.id}/${job.id}.${job.payload.format === 'csv' ? 'csv' : 'pdf'}` });
      if (ctx.event.jobs[job.id]) Object.assign(ctx.event.jobs[job.id], { actorId: 'RETENTION_REDACTED', status: 'cancelled', retentionPurgedAt: ctx.time, downloadId: null, recipientLabel: null });
    }
    policy.purged ||= {}; for (const category of categories) policy.purged[category] = ctx.time;
    policy.nextCleanupAt = retentionDeadline(ctx.event);
    if (expired.length >= 100) policy.nextCleanupAt = Math.min(policy.nextCleanupAt ?? Infinity, ctx.time + 60000);
    ctx.retentionCleanup = { categories, jobIds: expired.map(job => job.id) };
    return { messagesRemoved: messages, draftsRemoved: drafts, evidenceRemovalQueued: evidence, expiredDeliveries: expired.length, categories };
  }
  handlers.cleanup_records = async ctx => { need(ctx.actor.platformOperator === true, 'FORBIDDEN', 'Cleanup requires an authorized platform operator.'); requireOrganizer(ctx.event, ctx.actorId); return cleanupRecords(ctx); };
  handlers.end_event = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(!mapValues(ctx.event.matches).some(m => ['live', 'preparation', 'break'].includes(m.phase)), 'MATCH_STILL_ACTIVE', 'Conclude the active speaking phase before ending the event.'); ctx.event.status = 'completed'; ctx.event.endsAt ||= ctx.time; for (const session of mapValues(ctx.event.media)) if (session.status !== 'left' && session.desiredAction !== 'leave') queueMedia(ctx, session, 'leave'); return { endedAt: ctx.event.endsAt }; };

  async function execute(input, claimAttempt = 0) {
    const actorId = authenticate(input.actor), command = input.command, payload = input.payload || {}, time = now();
    need(typeof command === 'string' && Object.hasOwn(handlers, command), 'UNKNOWN_COMMAND', 'This debate action is not supported.');
    need(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_PAYLOAD', 'Check the action details.');
    need(typeof input.idempotencyKey === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey), 'IDEMPOTENCY_REQUIRED', 'Use a unique action receipt key.');
    const joining = ['claim_invite', 'join_public_event'].includes(command), waitingCommand = joining || ['check_in', 'leave_media'].includes(command);
    const unversionedClaim = joining && input.expectedRevision === undefined;
    need(unversionedClaim || (Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0), 'REVISION_REQUIRED', 'Refresh the saved event revision before this action.');
    const eventId = command === 'create_event' ? (input.eventId || `de-${(await digest(`${actorId}:${input.idempotencyKey}`)).slice(0, 32)}`) : text(input.eventId, 128, true);
    const payloadHash = await digest(JSON.stringify(canonical(payload))), receiptQuery = { eventId, actorId, command, idempotencyKey: input.idempotencyKey, payloadHash };
    const previousReceipt = await store.receipt(receiptQuery);
    if (previousReceipt) { const saved = await store.read(eventId); need(member(saved, actorId).admitted || waitingCommand, 'FORBIDDEN', 'Wait for admission before continuing this event action.'); return { ok: true, receipt: previousReceipt, event: actorSnapshot(saved, input.actor, time), serverNow: time }; }
    let event = command === 'create_event' ? null : await store.read(eventId);
    need(command === 'create_event' || event, 'EVENT_NOT_FOUND', 'This event does not exist or is unavailable.');
    if (event && !joining) need(member(event, actorId).admitted || waitingCommand, 'FORBIDDEN', 'Wait for admission before continuing this event action.');
    if (joining && claimAttempt === 0) { need(typeof store.rateLimit === 'function', 'STORE_UNCONFIGURED', 'Admission abuse protection is not configured.'); need(await store.rateLimit(actorId, command, time, 12, 60000), 'INVITE_RATE_LIMIT', 'Please wait before trying another admission request.'); }
    const expectedRevision = unversionedClaim ? event.revision : input.expectedRevision;
    need((event?.revision || 0) === expectedRevision, 'REVISION_CONFLICT', 'The event changed. Refresh and review before trying again.', { revision: event?.revision || 0 });
    const ctx = { event, eventId, actorId, actor: input.actor, payload: clone(payload), time, jobs: [], cancelJobs: [], retryJobs: [], consumeUploads: [] };
    if (['create_match','update_rules','amend_rules'].includes(command) && Object.keys(payload).some(key => /tie[_-]?break/i.test(key))) fail('TIEBREAK_CONFIGURATION_UNSUPPORTED', 'This preset declares no tiebreak adjudicator. Use the audited same-panel reconsideration and linked rematch.');
    const targetMatch = event?.matches?.[payload.matchId || event.activeMatchId];
    if (event?.status === 'completed' && ['send_message', 'share_evidence', 'save_draft', 'start_match', 'create_match', 'advance_match', 'create_rematch', 'check_in', 'record_device_check', 'record_no_show', 'update_match_schedule', 'claim_clock', 'renew_clock', 'timer', 'finish_stage', 'next_stage', 'return_stage', 'substitute_speaker', 'enter_space', 'renew_media', 'invite_private_room'].includes(command)) fail('EVENT_ENDED', 'This event has ended. Its retained records remain available.');
    if (targetMatch?.officialRecordsExpired && !['cleanup_records', 'set_retention', 'update_event', 'remove_member', 'leave_media', 'end_event'].includes(command)) fail('RECORDS_EXPIRED', 'These match records reached their approved retention period.');
    if (targetMatch?.rematchId && ['start_match','amend_rules','claim_clock','renew_clock','timer','finish_stage','next_stage','return_stage','conclude_match','substitute_speaker','open_ballots','submit_ballot','close_ballots','reconsider_ballots','change_panel','publish_result','finalize_result','correct_result','nominate_award','record_sanction'].includes(command)) fail('REMATCH_SOURCE_LOCKED', 'This preserved unresolved match has a linked rematch. Continue the rematch; its original ballots and attempts remain unchanged.');
    const result = await handlers[command](ctx); ctx.event.updatedAt = time;
    const storedResult = clone(result);
    if (storedResult?.secret) { delete storedResult.secret; storedResult.secretShownOnce = true; }
    const receipt = { id: id(), eventId, command, committedAt: time, result: storedResult };
    let committed;
    ctx.event.retention.nextCleanupAt = retentionDeadline(ctx.event);
    try { committed = await store.commit({ ...receiptQuery, expectedRevision, now: time, state: ctx.event, receipt, audit: { actorId, command, at: time, matchId: payload.matchId || null, correlationId: receipt.id }, jobs: ctx.jobs, cancelJobs: ctx.cancelJobs, retryJobs: ctx.retryJobs, consumeUploads: ctx.consumeUploads, retentionCleanup: ctx.retentionCleanup }); }
    catch (error) { if (unversionedClaim && error.code === 'REVISION_CONFLICT' && claimAttempt < 2) return execute(input, claimAttempt + 1); throw error; }
    if (result?.secret) committed = { ...committed, result: { ...committed.result, secret: result.secret } };
    const latest = await store.read(eventId);
    return { ok: true, receipt: committed, event: actorSnapshot(latest, input.actor, time), serverNow: time };
  }

  async function authorizeMedia({ actor, eventId, matchId, deviceId }) {
    const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
    const match = matchOf(event, { matchId }), session = event.media[actorId];
    need(session && session.matchId === match.id && session.expiresAt > now() && (!deviceId || session.deviceId === deviceId), 'MEDIA_SESSION_CONFLICT', 'Rejoin from your active media device.');
    authorizeSpace(event, match, actorId, session.space); need(session.status === 'ready', 'MEDIA_PENDING', 'Wait for the secure room transition to finish.');
    const sources = allowedSources(event, match, actorId, session.space, now());
    need(JSON.stringify(sources) === JSON.stringify(session.sources) && !session.revocations?.length, 'MEDIA_PENDING', 'Wait for the current media permission to be confirmed.');
    return { ...session, sources };
  }
  // Internal only: never route this method to client-supplied jobs. Recheck the
  // durable claim as well as the current permission epoch before/after each RPC.
  async function authorizeMediaJob(job) {
    const event = await store.read(job.eventId), savedJob = await store.readJob(job.id);
    need(savedJob?.status === 'running' && savedJob.claimId === job.claimId && savedJob.leaseUntil > now(), 'JOB_LEASE_CONFLICT', 'This delivery lease is no longer current.');
    const session = event?.media?.[job.payload.session.userId];
    need(session && session.operationId === job.id && session.identity === job.payload.session.identity && session.roomName === job.payload.session.roomName, 'MEDIA_SESSION_CONFLICT', 'This room transition was replaced by a newer permission.');
    if (job.payload.action !== 'leave') {
      const match = matchOf(event, { matchId: session.matchId }); authorizeSpace(event, match, session.userId, session.space);
      need(session.expiresAt > now() && JSON.stringify(session.sources) === JSON.stringify(allowedSources(event, match, session.userId, session.space, now())), 'MEDIA_PENDING', 'This media permission has expired.');
    }
    return { identity: session.identity, operationId: session.operationId };
  }
  async function recordOutboxOutcome(job, status, result, errorCode) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const event = await store.read(job.eventId); if (!event) return;
      if (event.jobs[job.id]) Object.assign(event.jobs[job.id], { status, error: errorCode, ...(result?.downloadId ? { downloadId: result.downloadId } : {}) });
      if (job.type === 'media') { const session = event.media[job.payload.session.userId]; if (session?.operationId === job.id) { session.status = status === 'failed' ? 'failed' : result?.status === 'superseded' ? session.status : result?.status; if (status === 'completed' && ['ready', 'left'].includes(result?.status)) { session.revocations = []; if (result.status === 'ready') session.everReady = true; } } }
      event.retention.nextCleanupAt = retentionDeadline(event);
      const key = `job:${job.id}:${job.claimId || `repair-${event.revision}`}:${attempt}`;
      try { await store.commit({ actorId: job.actorId, command: '__outbox_complete', eventId: job.eventId, idempotencyKey: key, payloadHash: await digest(JSON.stringify({ status, result, errorCode })), expectedRevision: event.revision, state: event, now: now(), receipt: { id: id(), eventId: job.eventId, command: '__outbox_complete', committedAt: now(), result: { jobId: job.id, status } }, audit: { actorId: job.actorId, command: '__outbox_complete', at: now(), jobId: job.id }, jobs: [] }); return; } catch (error) { if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error; }
    }
  }
  async function processOutbox({ eventId, limit = 5, deadlineAt = now() + 45000 }) {
    for (let attempt = 0; attempt < 3 && now() < deadlineAt; attempt++) {
      const event = await store.read(eventId);
      if (!event?.retention.approved || event.retention.hold) break;
      if ((event.retention.nextCleanupAt == null || event.retention.nextCleanupAt > now()) && !(await store.expiredJobs(eventId, now())).length) break;
      const ctx = { event, actorId: event.ownerId, time: now(), jobs: [] };
      const result = await cleanupRecords(ctx);
      if (!ctx.retentionCleanup.categories.length && !ctx.retentionCleanup.jobIds.length) break;
      try {
        await store.commit({ eventId, actorId: event.ownerId, command: '__retention_cleanup', idempotencyKey: `retention:${eventId}:${event.revision}`, payloadHash: await digest(JSON.stringify(ctx.retentionCleanup)), expectedRevision: event.revision, now: ctx.time, state: event,
          receipt: { id: id(), eventId, command: '__retention_cleanup', committedAt: ctx.time, result }, audit: { actorId: event.ownerId, command: '__retention_cleanup', at: ctx.time, categories: ctx.retentionCleanup.categories }, jobs: ctx.jobs, retentionCleanup: ctx.retentionCleanup });
        break;
      } catch (error) { if (!['REVISION_CONFLICT','JOB_ALREADY_RUNNING'].includes(error.code) || attempt === 2) throw error; }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const event = await store.read(eventId); if (!event) break;
      const ctx = { event, actorId: event.ownerId, time: now(), jobs: [] };
      refreshMedia(ctx);
      if (!ctx.jobs.length) break;
      try {
        await store.commit({ eventId, actorId: event.ownerId, command: '__media_reconcile', idempotencyKey: `media:${eventId}:${event.revision}`, payloadHash: await digest(JSON.stringify(ctx.jobs.map(j => j.payload.session.userId))), expectedRevision: event.revision, now: ctx.time, state: event, receipt: { id: id(), eventId, command: '__media_reconcile', committedAt: ctx.time, result: { count: ctx.jobs.length } }, audit: { actorId: event.ownerId, command: '__media_reconcile', at: ctx.time }, jobs: ctx.jobs });
        break;
      } catch (error) { if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error; }
    }
    // Repair a Worker crash between the durable delivery receipt and the public
    // event projection without invoking the external adapter a second time.
    if (typeof store.readJob === 'function') {
      const event = await store.read(eventId);
      for (const pending of mapValues(event?.jobs).filter(j => ['queued', 'failed'].includes(j.status)).slice(0, 20)) {
        const stored = await store.readJob(pending.id);
        if (stored && ['completed', 'failed'].includes(stored.status) && stored.status !== pending.status) await recordOutboxOutcome(stored, stored.status, stored.result, stored.error || null);
      }
    }
    const outcomes = [];
    // Claim just before each delivery; do not lease a page of work that waits
    // behind a slow provider call. No new claim starts after the sweep deadline.
    for (let index = 0; index < Math.max(1, Math.min(20, limit)) && now() < deadlineAt; index++) {
      const [job] = await store.claimJobs(eventId, 1, now()); if (!job) break;
      let result = null, status = 'completed', errorCode = null;
      try {
        const event = await store.read(job.eventId); need(event, 'EVENT_NOT_FOUND', 'This event is no longer available.');
        if (job.type === 'media') {
          const session = event.media[job.payload.session.userId];
          if (!session || session.operationId !== job.id) { result = { status: 'superseded' }; }
          else { await authorizeMediaJob(job); need(typeof adapters.media === 'function', 'MEDIA_UNCONFIGURED', 'Media is not configured.'); const applied = await adapters.media(job); await authorizeMediaJob(job); const expected = job.payload.action === 'leave' ? 'left' : 'ready'; need(applied?.status === expected, 'MEDIA_UNCONFIRMED', 'The media service did not confirm this room change.'); result = { status: expected, identity: session.identity, roomName: session.roomName }; }
        } else {
          need(typeof adapters[job.type] === 'function', 'ADAPTER_UNCONFIGURED', 'This delivery service is not configured.');
          if (job.type === 'delete_evidence' && job.payload.uploadId) {
            const upload = await store.readUpload(job.payload.uploadId);
            need(upload && upload.actorId === job.actorId && upload.eventId === job.eventId && upload.storageKey === job.payload.storageKey && upload.status !== 'retained', 'UPLOAD_UNAVAILABLE', 'This cleanup no longer applies to an abandoned upload.');
          } else member(event, job.actorId);
          if (job.type === 'delete_evidence' && job.payload.retainedEvidence) need(event.retention.approved && !event.retention.hold && event.retention.purged?.evidence && !mapValues(event.matches).some(m => m.evidence.some(e => e.storageKey === job.payload.storageKey)), 'RETENTION_HOLD', 'This evidence is protected from cleanup.');
          if (job.type === 'delete_export') {
            const source = await store.readJob(job.payload.sourceJobId), extension = source?.payload.format === 'csv' ? 'csv' : 'pdf';
            need(event.retention.approved && !event.retention.hold && source?.eventId === event.id && source.type === 'export' && source.payload.retentionPurgedAt && job.payload.storageKey === `exports/${event.id}/${source.id}.${extension}`, 'RETENTION_HOLD', 'This export is protected from cleanup.');
          }
          if (job.type === 'invitation_mail') await authorizeInvitationMail(event, job.actorId, job.payload, now());
          if (job.type === 'mail') requireOrganizer(event, job.actorId);
          if (job.payload.document?.resultVersion) { const match = matchOf(event, { matchId: job.matchId }); const version = match.resultVersions.find(r => r.id === job.payload.document.resultVersion); need(version && version.state !== 'SUPERSEDED', 'RESULT_SUPERSEDED', 'Generate a new output for the corrected result.'); }
          let authorizedJob = job;
          if (job.payload.document) {
            const viewerId = job.type === 'mail' ? job.payload.recipientId : job.payload.document.createdFor;
            member(event, viewerId);
            const fresh = authorizedDocument(event, matchOf(event, { matchId: job.matchId }), viewerId, job.payload.document.kind, job.payload.document.resultVersion, { participantId: job.payload.document.participant?.id, awardKey: job.payload.document.awardKey });
            authorizedJob = { ...job, payload: { ...job.payload, document: fresh } };
          }
          const applied = await adapters[job.type](authorizedJob);
          need(applied && (['delete_evidence', 'delete_export'].includes(job.type) ? ['deleted', 'completed'].includes(applied.status) : ['completed', 'ready', 'accepted', 'sent', 'delivered'].includes(applied.status)), 'DELIVERY_UNCONFIRMED', 'The delivery service did not confirm its outcome.');
          result = { status: applied.status, ...(typeof applied.downloadId === 'string' ? { downloadId: applied.downloadId } : {}), ...(typeof applied.deliveryStatus === 'string' ? { deliveryStatus: applied.deliveryStatus } : {}), ...(typeof applied.storageKey === 'string' ? { storageKey: applied.storageKey } : {}), ...(typeof applied.filename === 'string' ? { filename: applied.filename } : {}), ...(typeof applied.mimeType === 'string' ? { mimeType: applied.mimeType } : {}) };
          if (['mail', 'invitation_mail'].includes(job.type) && typeof applied.providerId === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(applied.providerId)) result.providerId = applied.providerId;
        }
      } catch (error) { status = 'failed'; errorCode = error.code || 'DELIVERY_FAILED'; }
      await store.finishJob({ jobId: job.id, claimId: job.claimId, status, result, error: errorCode, now: now() });
      await recordOutboxOutcome(job, status, result, errorCode);
      outcomes.push({ jobId: job.id, status, error: errorCode });
    }
    return outcomes;
  }
  async function authorizeEvidenceUpload({ actor, eventId, matchId, channel = 'public' }) {
    const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
    const match = matchOf(event, { matchId }), person = member(event, actorId);
    need(event.status !== 'completed' && person.admitted && person.checkedIn && (participantSide(match, actorId) || official(event, match, actorId)) && canChannel(event, match, actorId, channel, true), 'FORBIDDEN', 'You cannot upload evidence to this audience.');
    return { eventId, matchId: match.id, actorId, channel, maxBytes: 10485760, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'] };
  }
  return {
    execute, authorizeMedia, authorizeMediaJob, processOutbox, authorizeEvidenceUpload,
    async reserveEvidenceUpload(input) {
      const allowed = await authorizeEvidenceUpload(input), mimeType = String(input.mimeType || '').split(';')[0].trim().toLowerCase();
      need(allowed.allowedMimeTypes.includes(mimeType), 'UNSAFE_FILE', 'Use a PDF, PNG or JPEG no larger than 10 MB.');
      need(await store.rateLimit(allowed.actorId, 'reserve_upload', now(), 20, 3600000), 'UPLOAD_LIMIT', 'Wait before uploading another evidence file.');
      const uploadId = id(), ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
      return store.reserveUpload({ id: uploadId, actorId: allowed.actorId, eventId: allowed.eventId, matchId: allowed.matchId, channel: allowed.channel, mimeType,
        storageKey: `evidence/${allowed.eventId}/${allowed.matchId}/${uploadId}.${ext}`, createdAt: now(), expiresAt: now() + 1800000 });
    },
    async completeEvidenceUpload({ actor, eventId, matchId, reservationId, attachment }) {
      const actorId = authenticate(actor), reservation = await store.readUpload(reservationId);
      need(reservation && reservation.actorId === actorId && reservation.eventId === eventId && reservation.matchId === matchId, 'FORBIDDEN', 'This upload belongs to another request.');
      const query = { actor, eventId, matchId, channel: reservation.channel }; await authorizeEvidenceUpload(query);
      need(attachment && attachment.mimeType === reservation.mimeType && Number.isInteger(attachment.size) && attachment.size > 0 && attachment.size <= 10485760, 'UNSAFE_FILE', 'This file does not match its reserved upload.');
      const verified = await adapters.validateEvidence({ actorId, eventId, matchId, channel: reservation.channel, uploadId: attachment.uploadId, mimeType: attachment.mimeType, size: attachment.size });
      await authorizeEvidenceUpload(query);
      need(verified?.verified === true && verified.id === reservationId && verified.storageKey === reservation.storageKey && verified.mimeType === reservation.mimeType && verified.size === attachment.size && /^[a-f0-9]{64}$/.test(verified.digest || ''), 'UNSAFE_FILE', 'The uploaded bytes do not match their private reservation.');
      return store.completeUpload({ id: reservationId, actorId, eventId, now: now(), metadata: { digest: verified.digest, mimeType: verified.mimeType, size: verified.size } });
    },
    async failEvidenceUpload({ actor, eventId, reservationId }) { return store.failUpload({ id: reservationId, actorId: authenticate(actor), eventId, now: now() }); },
    async sweep({ limit = 20, cursor = null, jobsPerEvent = 3, deadlineAt = now() + 45000 } = {}) {
      need(typeof store.activeEvents === 'function', 'STORE_UNCONFIGURED', 'Scheduled media cleanup is unavailable.');
      const page = await store.activeEvents(limit, cursor, now()), outcomes = [];
      for (let offset = 0; offset < page.eventIds.length && now() < deadlineAt; offset += 3) {
        const batch = page.eventIds.slice(offset, offset + 3);
        const results = await Promise.allSettled(batch.map(eventId => processOutbox({ eventId, limit: jobsPerEvent, deadlineAt })));
        results.forEach((result, index) => outcomes.push({ eventId: batch[index], ...(result.status === 'fulfilled' ? { outcomes: result.value } : { error: result.reason.code || 'SWEEP_FAILED' }) }));
      }
      return { outcomes, nextCursor: page.nextCursor, deadlineReached: now() >= deadlineAt, deferredEvents: Math.max(0, page.eventIds.length - outcomes.length) };
    },
    async snapshot({ actor, eventId }) { authenticate(actor); const event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.'); return { ok: true, event: actorSnapshot(event, actor, now()), serverNow: now() }; },
    async messages({ actor, eventId, matchId, channel = 'public', before = null, limit = 50 }) {
      const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
      const match = matchOf(event, { matchId }); need(canChannel(event, match, actorId, channel), 'FORBIDDEN', 'This conversation is not available to this account.');
      const size = Number(limit); need(Number.isInteger(size) && size >= 1 && size <= 100, 'INVALID_LIMIT', 'Choose a page size from 1 to 100.');
      const visible = match.messages.filter(m => m.channel === channel && !m.blockedRecipients?.includes(actorId));
      const end = before ? visible.findIndex(m => m.id === before) : visible.length;
      need(end >= 0, 'INVALID_CURSOR', 'Refresh this conversation before loading older messages.');
      const start = Math.max(0, end - size), page = visible.slice(start, end).map(({ id, actorId, channel, text, at }) => ({ id, actorId, channel, text, at }));
      return { ok: true, messages: page, nextCursor: start > 0 ? page[0].id : null, serverNow: now() };
    },
    async list({ actor }) { const actorId = authenticate(actor), events = await store.list(actorId); return { ok: true, events: (events || []).filter(e => e.members?.[actorId] && !e.members[actorId].removed).map(e => ({ id: e.id, title: e.title, revision: e.revision, rehearsal: e.rehearsal, visibility: e.visibility, status: e.status, createdAt: e.createdAt, roleNames: e.members[actorId].roles })), serverNow: now() }; },
    async discover({ actor, limit = 20, cursor = null }) {
      const actorId = authenticate(actor);
      need(typeof store.discover === 'function' && typeof store.rateLimit === 'function', 'STORE_UNCONFIGURED', 'Event discovery is not configured.');
      need(await store.rateLimit(actorId, 'discover_events', now(), 60, 60000), 'DISCOVERY_LIMIT', 'Please wait before refreshing public events.');
      const size = Number(limit); need(Number.isInteger(size) && size >= 1 && size <= 100, 'INVALID_LIMIT', 'Choose a page size from 1 to 100.');
      const page = await store.discover(size, cursor ? text(cursor, 128, true) : null);
      return { ok: true, events: page.events.map(({ id, title, description, scheduledAt, timezone, language, status }) => ({ id, title, description, scheduledAt, timezone, language, status })), nextCursor: page.nextCursor, serverNow: now() };
    },
    async authorizeDocument({ actor, eventId, matchId, kind = 'result', resultId, participantId, awardKey }) { const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.'); return authorizedDocument(event, matchOf(event, { matchId }), actorId, kind, resultId, { participantId, awardKey }); },
    async authorizeEvidence({ actor, eventId, matchId, evidenceId }) {
      const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
      const match = matchOf(event, { matchId }), evidence = match.evidence.find(item => item.id === evidenceId && !item.deletedAt);
      need(evidence && canChannel(event, match, actorId, evidence.channel) && evidence.attachment && evidence.storageKey && /^[a-f0-9]{64}$/.test(evidence.attachment.digest || ''), 'FORBIDDEN', 'This evidence file is unavailable to this account.');
      return { eventId, matchId: match.id, evidenceId, storageKey: evidence.storageKey, attachmentId: evidence.attachment.id, mimeType: evidence.attachment.mimeType, size: evidence.attachment.size, digest: evidence.attachment.digest, filename: `evidence-${evidence.id}.${evidence.attachment.mimeType === 'application/pdf' ? 'pdf' : evidence.attachment.mimeType === 'image/png' ? 'png' : 'jpg'}` };
    },
    async authorizeDownload({ actor, eventId, downloadId }) {
      const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.'); member(event, actorId);
      need(typeof store.readJob === 'function', 'STORE_UNCONFIGURED', 'Secure download lookup is not configured.');
      const job = await store.readJob(downloadId);
      need(job && job.id === downloadId && job.eventId === eventId && job.type === 'export' && job.actorId === actorId && job.status === 'completed' && job.result?.downloadId === downloadId, 'FORBIDDEN', 'This download is unavailable to this account.');
      need(job.createdAt + 7 * 86400000 > now(), 'DOWNLOAD_EXPIRED', 'Generate a new authorized copy; this download has expired.');
      const document = authorizedDocument(event, matchOf(event, { matchId: job.matchId }), actorId, job.payload.document.kind, job.payload.document.resultVersion, { participantId: job.payload.document.participant?.id, awardKey: job.payload.document.awardKey });
      const extension = job.payload.format === 'csv' ? 'csv' : 'pdf';
      const expectedKey = `exports/${eventId}/${job.id}.${extension}`;
      need(!job.result.storageKey || job.result.storageKey === expectedKey, 'FORBIDDEN', 'This file does not belong to the requested export.');
      return { storageKey: expectedKey, filename: job.result.filename || `debate-${job.id}.${extension}`, mimeType: job.result.mimeType || (extension === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf'), document };
    },
    commandNames: Object.freeze(Object.keys(handlers)),
  };
}
