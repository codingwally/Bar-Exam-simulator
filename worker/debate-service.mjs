import * as domain from './debate-domain.mjs';

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
const official = (event, match, actorId) => organizer(event, actorId) || [match.chiefId, match.moderatorId, match.timekeeperId].includes(actorId);
const requireOfficial = (event, match, actorId) => need(official(event, match, actorId), 'FORBIDDEN', 'An assigned official must perform this action.');
const requirePanelAdmin = (event, match, actorId) => need(organizer(event, actorId) || match.chiefId === actorId, 'FORBIDDEN', 'An organizer or chief adjudicator must perform this action.');
const currentStage = match => match.runOfShow?.[match.currentStageIndex];
const activeSeats = match => currentStage(match)?.speakerSeats || [];
const mutableSetup = match => need(!match.rulesLockedAt, 'RULES_LOCKED', 'Use a disclosed rules amendment after this match has started.');
const liveMatch = match => need(['live', 'preparation', 'break', 'deliberation'].includes(match.phase), 'MATCH_NOT_READY', 'This match is not in an active phase.');
const mapValues = object => Object.values(object || {});
const privatePhase = match => ['preparation', 'break'].includes(currentStage(match)?.kind);

function canChannel(event, match, actorId, channel, writing = false) {
  const me = member(event, actorId);
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
  requireOfficial(event, match, actorId);
  need(!activeSeats(match).some(seat => match.seats[seat] === actorId), 'FORBIDDEN', 'A neutral official must control your speaking stage.');
}

function allowedSources(event, match, actorId, space) {
  const me = member(event, actorId);
  const sources = [];
  if (match.rules.observerCameras !== false || participantSide(match, actorId) || isJudge(match, actorId) || official(event, match, actorId)) sources.push('camera');
  if (space !== 'main' || activeSeats(match).some(seat => match.seats[seat] === actorId) || actorId === match.moderatorId || match.floorGrants?.[actorId]?.expiresAt > Date.now()) sources.push('microphone');
  if (match.presenterId === actorId || (space !== 'main' && (participantSide(match, actorId) || isJudge(match, actorId)))) sources.push('screen_share', 'screen_share_audio');
  return sources;
}

function authorizeSpace(event, match, actorId, space) {
  const me = member(event, actorId);
  need(me.admitted && me.checkedIn, 'FORBIDDEN', 'Check in and wait for admission before joining media.');
  if (space === 'main') return;
  if (space === 'judges') { need(isJudge(match, actorId) && match.phase === 'deliberation', 'FORBIDDEN', 'Only assigned judges can enter deliberation.'); return; }
  need(sides.includes(space) && privatePhase(match), 'FORBIDDEN', 'Team preparation rooms open during preparation and the declared break.');
  need(participantSide(match, actorId) === space || (me.teamId === match.teamIds[space] && me.roles.some(r => ['coach', 'reserve'].includes(r))), 'FORBIDDEN', 'This preparation room belongs to the other team.');
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
  for (const actorId of [...speakers, ...match.judgeIds, match.moderatorId, match.timekeeperId].filter(Boolean)) member(event, actorId);
  for (const other of mapValues(event.matches)) {
    if (other.id === match.id || !['live', 'preparation', 'break', 'deliberation'].includes(other.phase)) continue;
    const assigned = new Set([...Object.values(other.seats), ...other.judgeIds]);
    need(![...speakers, ...match.judgeIds].some(actorId => assigned.has(actorId)), 'ROLE_CONFLICT', 'A participant is assigned to another active match.');
  }
}

function snapshotEvent(event, actorId, now) {
  const me = member(event, actorId), host = organizer(event, actorId);
  const result = {
    id: event.id, revision: event.revision, title: event.title, description: event.description, timezone: event.timezone, language: event.language,
    scheduledAt: event.scheduledAt, visibility: event.visibility, rehearsal: event.rehearsal, status: event.status, createdAt: event.createdAt,
    ownerId: event.ownerId, activeMatchId: event.activeMatchId, retention: event.retention,
    members: mapValues(event.members).filter(p => !p.removed || host).map(({ id, displayName, roles, teamId, checkedIn, admitted, removed, conflictDeclarations }) => ({ id, displayName, roles, teamId, checkedIn, admitted, removed, ...(host ? { conflictDeclarations } : {}) })),
    teams: mapValues(event.teams).map(team => clone(team)),
    motions: mapValues(event.motions).filter(m => host || m.releasedAt).map(({ id, title, text, releasedAt, version }) => ({ id, title, text, releasedAt, version })),
    fixtures: clone(event.fixtures || []), standings: clone(event.standings || null), myId: actorId,
    invites: host ? mapValues(event.invites).map(({ id, role, teamId, expiresAt, revokedAt, usedBy, requiresApproval }) => ({ id, role, teamId, expiresAt, revokedAt, usedBy, requiresApproval })) : [],
    outbox: mapValues(event.jobs).filter(j => j.actorId === actorId || host).map(({ id, type, status, createdAt, resultVersion, error, downloadId }) => ({ id, type, status, createdAt, resultVersion, error, downloadId })),
    matches: [],
  };
  for (const match of mapValues(event.matches)) {
    const judge = isJudge(match, actorId), panelAdmin = host || match.chiefId === actorId;
    const ballots = mapValues(match.ballots).filter(b => b.round === match.ballotRound);
    const poll = match.polls[match.activePollId];
    const publicPoll = poll ? { id: poll.id, state: poll.state, openedAt: poll.openedAt, closedAt: poll.closedAt, eligible: poll.eligible.includes(actorId), myVote: poll.votes[actorId]?.side || null, ...(poll.state === 'Published' ? { result: poll.result } : {}) } : null;
    const visibleResults = match.resultVersions.filter(r => ['PROVISIONAL_PUBLISHED', 'FINAL', 'SUPERSEDED'].includes(r.state));
    const mySide = participantSide(match, actorId);
    result.matches.push({
      id: match.id, title: match.title, motionId: match.motionId, teamIds: match.teamIds, seats: match.seats, captains: match.captains, closingSeats: match.closingSeats,
      judgeIds: match.judgeIds, chiefId: match.chiefId, moderatorId: match.moderatorId, timekeeperId: match.timekeeperId, hostIds: match.hostIds,
      rules: match.rules, ruleVersion: match.ruleVersion, rulesLockedAt: match.rulesLockedAt, acknowledgments: match.acknowledgments,
      phase: match.phase, currentStageIndex: match.currentStageIndex, runOfShow: match.runOfShow, attempts: match.attempts,
      timer: match.timer, readiness: readiness(event, match), ballotState: match.ballotState, ballotRound: match.ballotRound,
      ballotCompletion: { received: ballots.filter(b => b.submittedAt && match.judgeIds.includes(b.judgeId)).length, required: match.judgeIds.length },
      ...(judge ? { myDraft: clone(match.drafts[actorId] || null), myBallot: clone(match.ballots[`${match.ballotRound}:${actorId}`] || null) } : {}),
      poll: publicPoll, resultVersions: visibleResults.map(r => { const copy = clone(r); delete copy.ballots; delete copy.scorecards; delete copy.privateNotes; if (copy.feedback) copy.feedback = mySide ? { [mySide]: copy.feedback[mySide] } : {}; return copy; }),
      messages: match.messages.filter(message => canChannel(event, match, actorId, message.channel) && (!message.blockedRecipients?.includes(actorId))).slice(-100).map(({ blockedRecipients, ...message }) => message),
      evidence: match.evidence.filter(item => canChannel(event, match, actorId, item.channel)).map(({ storageKey, ...item }) => item),
      incidents: match.incidents.filter(incident => incident.public || panelAdmin || incident.actorId === actorId),
      protests: match.protests.filter(protest => panelAdmin || protest.actorId === actorId),
      myMedia: event.media[actorId]?.matchId === match.id ? { ...event.media[actorId], sources: allowedSources(event, match, actorId, event.media[actorId].space) } : null,
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
  const enqueue = (ctx, type, payload, resultVersion) => {
    const job = { id: id(), eventId: ctx.event.id, matchId: payload.session?.matchId || payload.matchId, actorId: ctx.actorId, type, payload, createdAt: ctx.time, resultVersion };
    ctx.jobs.push(job); ctx.event.jobs[job.id] = { id: job.id, actorId: job.actorId, type, status: 'queued', createdAt: ctx.time, resultVersion };
    return job.id;
  };
  const refreshMedia = ctx => {
    for (const session of mapValues(ctx.event.media)) {
      const match = ctx.event.matches[session.matchId];
      if (!match || session.status === 'left') continue;
      let allowed = true;
      try { authorizeSpace(ctx.event, match, session.userId, session.space); } catch { allowed = false; }
      const action = allowed ? 'permissions' : 'leave';
      session.sources = allowed ? allowedSources(ctx.event, match, session.userId, session.space) : [];
      session.status = 'pending';
      session.operationId = enqueue(ctx, 'media', { action, session: clone(session) });
    }
  };
  const setAttempt = (ctx, match, stageIndex, reason = '') => {
    const stage = match.runOfShow[stageIndex]; need(stage, 'STAGE_NOT_FOUND', 'There is no stage at that position.');
    const attempt = { id: id(), stageId: stage.id, stageIndex, number: match.attempts.filter(a => a.stageId === stage.id).length + 1, createdAt: ctx.time, createdBy: ctx.actorId, reason, state: 'READY' };
    match.attempts.push(attempt); match.currentStageIndex = stageIndex;
    match.timer = stage.durationMs === null ? null : domain.createTimer({ matchId: match.id, stageAttemptId: attempt.id, durationMs: stage.durationMs }, ctx.time);
    match.phase = stage.kind === 'preparation' ? 'preparation' : stage.kind === 'break' ? 'break' : stage.kind === 'deliberation' ? 'deliberation' : 'live';
    refreshMedia(ctx); return attempt;
  };
  const handlers = {};

  handlers.create_event = ctx => {
    const p = ctx.payload;
    let timezone = text(p.timezone || 'Asia/Manila', 80, true); try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { fail('INVALID_TIMEZONE', 'Choose a valid event timezone.'); }
    ctx.event = { id: ctx.eventId, revision: 0, ownerId: ctx.actorId, title: text(p.title, 160, true), description: text(p.description, 4000), timezone, language: text(p.language || 'English', 80), scheduledAt: p.scheduledAt || null, visibility: p.visibility === 'public' ? 'public' : 'unlisted', rehearsal: p.rehearsal === true, status: 'draft', createdAt: ctx.time, updatedAt: ctx.time, members: {}, teams: {}, motions: {}, matches: {}, invites: {}, media: {}, jobs: {}, fixtures: [], activeMatchId: null, retention: { operationalDays: 30, chatDays: 30, evidenceDays: 90, officialDays: 365, approved: false, hold: false } };
    ctx.event.members[ctx.actorId] = { id: ctx.actorId, displayName: text(ctx.actor.displayName || p.displayName || 'Organizer', 120, true), roles: ['host'], teamId: null, admitted: true, checkedIn: true, removed: false, conflictDeclarations: [] };
    return { eventId: ctx.event.id };
  };
  handlers.update_event = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload;
    for (const field of ['title', 'description', 'language']) if (Object.hasOwn(p, field)) ctx.event[field] = text(p[field], field === 'description' ? 4000 : 160, field === 'title');
    if (p.scheduledAt !== undefined) { need(p.scheduledAt === null || Number.isFinite(Date.parse(p.scheduledAt)), 'INVALID_SCHEDULE', 'Enter a valid schedule.'); ctx.event.scheduledAt = p.scheduledAt; }
    if (p.visibility !== undefined) { need(['unlisted', 'public'].includes(p.visibility), 'INVALID_VISIBILITY', 'Choose unlisted or public.'); ctx.event.visibility = p.visibility; }
    return { saved: true };
  };
  handlers.create_invite = async ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, role = p.role || 'observer';
    need(roleNames.has(role), 'INVALID_ROLE', 'Choose a supported event role.');
    need(mapValues(ctx.event.invites).filter(i => !i.revokedAt && i.expiresAt > ctx.time).length < 100, 'INVITE_LIMIT', 'Revoke unused invitations first.');
    const secret = randomCode(12), inviteId = id();
    const boundAccountId = p.boundAccountId ? text(p.boundAccountId, 128, true) : null;
    const emailHash = p.boundEmail ? await digest(text(p.boundEmail, 254, true).toLowerCase()) : null;
    const end = ctx.event.endsAt || ctx.time + 7 * 86400000;
    ctx.event.invites[inviteId] = { id: inviteId, digest: await digest(secret), role, teamId: p.teamId || null, boundAccountId, emailHash, requiresApproval: role !== 'observer' && !boundAccountId && !emailHash, expiresAt: Math.min(ctx.time + 7 * 86400000, end), revokedAt: null, usedBy: [] };
    return { inviteId, secret, eventId: ctx.event.id, expiresAt: ctx.event.invites[inviteId].expiresAt };
  };
  handlers.revoke_invite = ctx => { requireOrganizer(ctx.event, ctx.actorId); const invite = ctx.event.invites[ctx.payload.inviteId]; need(invite, 'INVITE_NOT_FOUND', 'This invitation does not exist.'); invite.revokedAt = ctx.time; return { revoked: true }; };
  handlers.claim_invite = async ctx => {
    const secretHash = await digest(text(ctx.payload.secret, 128, true).toUpperCase());
    const invite = mapValues(ctx.event.invites).find(inv => inv.digest === secretHash && !inv.revokedAt && inv.expiresAt > ctx.time);
    need(invite && (!invite.boundAccountId || invite.boundAccountId === ctx.actorId) && (!invite.emailHash || (ctx.actor.verified && ctx.actor.email && invite.emailHash === await digest(ctx.actor.email.toLowerCase()))), 'INVITE_INVALID', 'This invitation is invalid, expired, or intended for another account.');
    need(!ctx.event.members[ctx.actorId]?.removed, 'FORBIDDEN', 'An organizer must reinstate you before you rejoin.');
    const existing = ctx.event.members[ctx.actorId];
    if (!existing) ctx.event.members[ctx.actorId] = { id: ctx.actorId, displayName: text(ctx.actor.displayName || 'Participant', 120, true), roles: invite.requiresApproval ? ['observer'] : [invite.role], teamId: invite.teamId, admitted: invite.role !== 'observer' && !invite.requiresApproval, checkedIn: false, removed: false, requestedRole: invite.requiresApproval ? invite.role : null, conflictDeclarations: [] };
    if (!invite.usedBy.includes(ctx.actorId)) invite.usedBy.push(ctx.actorId);
    return { claimed: true, awaitingAdmission: !ctx.event.members[ctx.actorId].admitted };
  };
  handlers.check_in = ctx => { const me = member(ctx.event, ctx.actorId); me.checkedIn = ctx.payload.checkedIn !== false; if (ctx.payload.displayName) me.displayName = text(ctx.payload.displayName, 120, true); if (Array.isArray(ctx.payload.conflictDeclarations)) me.conflictDeclarations = ctx.payload.conflictDeclarations.slice(0, 20).map(v => text(v, 500, true)); return { checkedIn: me.checkedIn }; };
  handlers.admit_member = ctx => { requireOrganizer(ctx.event, ctx.actorId); const person = member(ctx.event, ctx.payload.memberId); person.admitted = ctx.payload.admitted !== false; if (ctx.payload.approveRequestedRole && person.requestedRole) { person.roles = [person.requestedRole]; person.requestedRole = null; } refreshMedia(ctx); return { admitted: person.admitted }; };
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
  handlers.propose_roster = ctx => { const p = ctx.payload, team = ctx.event.teams[p.teamId]; need(team && (team.captainId === ctx.actorId || organizer(ctx.event, ctx.actorId)), 'FORBIDDEN', 'Only this captain can propose the roster.'); team.proposal = { speakerIds: p.speakerIds, captainId: p.captainId, proposedBy: ctx.actorId, at: ctx.time }; return { proposed: true }; };
  handlers.confirm_roster = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload;
    need(Array.isArray(p.speakerIds) && p.speakerIds.length === 3 && new Set(p.speakerIds).size === 3 && p.speakerIds.includes(p.captainId), 'INVALID_ROSTER', 'Confirm three distinct speakers and a captain among them.');
    const teamId = p.teamId || id();
    for (const actorId of p.speakerIds) { const person = member(ctx.event, actorId); need(!mapValues(ctx.event.teams).some(t => t.id !== teamId && t.speakerIds.includes(actorId)), 'ROLE_CONFLICT', 'A speaker cannot occupy two event teams.'); person.teamId = teamId; if (!person.roles.includes('debater')) person.roles.push('debater'); }
    ctx.event.teams[teamId] = { id: teamId, name: text(p.name || ctx.event.teams[teamId]?.name, 120, true), school: text(p.school, 160), speakerIds: clone(p.speakerIds), captainId: p.captainId, confirmedAt: ctx.time };
    return { teamId };
  };
  handlers.add_motion = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(mapValues(ctx.event.motions).length < 100, 'MOTION_LIMIT', 'This event has reached its motion limit.'); const motionId = id(); ctx.event.motions[motionId] = { id: motionId, title: text(ctx.payload.title || `Motion ${mapValues(ctx.event.motions).length + 1}`, 160), text: text(ctx.payload.text, 8000, true), version: 1, releasedAt: null }; return { motionId }; };
  handlers.create_match = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, matchId = id(); need(mapValues(ctx.event.matches).length < 256, 'MATCH_LIMIT', 'This event has reached its match limit.');
    const judges = [...new Set(p.judgeIds || [])], rules = domain.validateRules(p.rules || {});
    const match = { id: matchId, title: text(p.title || `Match ${mapValues(ctx.event.matches).length + 1}`, 160), motionId: p.motionId || null, teamIds: clone(p.teamIds || {}), seats: Object.fromEntries(seatNames.map(seat => [seat, p.seats?.[seat] || null])), captains: clone(p.captains || {}), closingSeats: { affirmative: p.closingSeats?.affirmative || 'A1', negative: p.closingSeats?.negative || 'N1' }, judgeIds: judges, chiefId: p.chiefId || judges[0] || null, moderatorId: p.moderatorId || judges[0] || null, timekeeperId: p.timekeeperId || p.moderatorId || judges[0] || null, hostIds: p.hostIds || [ctx.event.ownerId], rules, ruleVersion: 1, rulesLockedAt: null, evenPanelAccepted: p.evenPanelAccepted === true, acknowledgments: {}, phase: 'setup', currentStageIndex: -1, runOfShow: [], attempts: [], timer: null, deviceChecks: {}, accommodations: {}, drafts: {}, ballots: {}, ballotHistory: [], ballotRound: 1, ballotState: 'DRAFT', polls: {}, activePollId: null, resultVersions: [], incidents: [], protests: [], messages: [], evidence: [], nominations: {}, floorGrants: {}, presenterId: null, rulesHistory: [], panelHistory: [], quietObservers: false };
    for (const side of sides) { const team = ctx.event.teams[match.teamIds[side]]; if (team) { const prefix = side === 'affirmative' ? 'A' : 'N'; team.speakerIds.forEach((actorId, index) => { match.seats[`${prefix}${index + 1}`] ||= actorId; }); match.captains[side] ||= team.captainId; } }
    validateAssignments(ctx.event, match); ctx.event.matches[matchId] = match; ctx.event.activeMatchId ||= matchId; return { matchId };
  };
  handlers.update_rules = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload); mutableSetup(match);
    match.rules = domain.validateRules({ ...match.rules, ...ctx.payload.rules }); match.ruleVersion++; match.acknowledgments = {};
    if (ctx.payload.closingSeats) match.closingSeats = clone(ctx.payload.closingSeats);
    if (ctx.payload.motionId) { need(ctx.event.motions[ctx.payload.motionId], 'MOTION_NOT_FOUND', 'Choose an existing motion.'); match.motionId = ctx.payload.motionId; }
    match.evenPanelAccepted = ctx.payload.evenPanelAccepted === true || match.evenPanelAccepted;
    return { ruleVersion: match.ruleVersion };
  };
  handlers.acknowledge_rules = ctx => { const match = matchOf(ctx.event, ctx.payload), side = sides.find(s => match.captains[s] === ctx.actorId); need(side, 'FORBIDDEN', 'Only the assigned captain can acknowledge these rules.'); need(ctx.payload.ruleVersion === match.ruleVersion, 'REVISION_CONFLICT', 'Review the newest rules before accepting.'); match.acknowledgments[side] = { actorId: ctx.actorId, ruleVersion: match.ruleVersion, at: ctx.time }; return { acknowledged: true }; };
  handlers.draw_sides = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload); mutableSetup(match);
    const swap = ctx.payload.random === true ? (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 1 : ctx.payload.swap === true;
    if (swap) { [match.teamIds.affirmative, match.teamIds.negative] = [match.teamIds.negative, match.teamIds.affirmative]; [match.captains.affirmative, match.captains.negative] = [match.captains.negative, match.captains.affirmative]; for (let n = 1; n <= 3; n++) [match.seats[`A${n}`], match.seats[`N${n}`]] = [match.seats[`N${n}`], match.seats[`A${n}`]]; }
    match.sideDraws ||= []; match.sideDraws.push({ actorId: ctx.actorId, at: ctx.time, method: ctx.payload.random ? 'random' : 'manual', swapped: swap, teams: clone(match.teamIds) }); match.ruleVersion++; match.acknowledgments = {}; return { swapped: swap, drawNumber: match.sideDraws.length, teams: match.teamIds };
  };
  handlers.record_device_check = ctx => { const match = matchOf(ctx.event, ctx.payload); const actorId = ctx.payload.memberId || ctx.actorId; if (actorId !== ctx.actorId) requireOfficial(ctx.event, match, ctx.actorId); member(ctx.event, actorId); match.deviceChecks[actorId] = { microphone: ctx.payload.microphone === true, camera: ctx.payload.camera === true, checkedBy: ctx.actorId, at: ctx.time }; if (ctx.payload.accommodation) { requireOfficial(ctx.event, match, ctx.actorId); match.accommodations[actorId] = { reason: text(ctx.payload.accommodation, 2000, true), actorId: ctx.actorId, at: ctx.time }; } return { recorded: true }; };
  handlers.readiness = ctx => readiness(ctx.event, matchOf(ctx.event, ctx.payload));
  handlers.release_motion = ctx => { requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload), motion = ctx.event.motions[match.motionId]; need(motion, 'MOTION_NOT_FOUND', 'Set the match motion first.'); motion.releasedAt ||= ctx.time; match.motionReleasedAt ||= ctx.time; return { releasedAt: motion.releasedAt }; };
  handlers.start_match = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); mutableSetup(match); validateAssignments(ctx.event, match); const ready = readiness(ctx.event, match); need(ready.ready, 'MATCH_NOT_READY', 'Complete the readiness checks before starting.', ready); const motion = ctx.event.motions[match.motionId]; motion.releasedAt ||= ctx.time; match.motionReleasedAt = motion.releasedAt; match.rulesLockedAt = ctx.time; match.rulesHistory.push({ version: match.ruleVersion, rules: clone(match.rules), at: ctx.time }); match.runOfShow = domain.createRunOfShow(match.rules, match.closingSeats); ctx.event.status = 'live'; ctx.event.activeMatchId = match.id; return { attempt: setAttempt(ctx, match, 0) }; };
  handlers.claim_clock = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); need(match.timer, 'CLOCK_NOT_READY', 'Load a stage first.'); match.timer = domain.claimTimerLease(match.timer, { actorId: ctx.actorId, authorized: true, expectedVersion: ctx.payload.timerVersion ?? match.timer.version, takeover: ctx.payload.takeover === true, reason: ctx.payload.reason }, ctx.time); return { timer: match.timer }; };
  handlers.renew_clock = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); match.timer = domain.renewTimerLease(match.timer, { actorId: ctx.actorId, expectedVersion: ctx.payload.timerVersion ?? match.timer.version }, ctx.time); return { timer: match.timer }; };
  handlers.timer = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); liveMatch(match); const command = { ...ctx.payload, type: ctx.payload.type, actorId: ctx.actorId, expectedVersion: ctx.payload.timerVersion }; match.timer = domain.applyTimerCommand(match.timer, command, ctx.time); const attempt = match.attempts.find(a => a.id === match.timer.stageAttemptId); attempt.state = match.timer.state; if (match.timer.state === 'FINISHED') { attempt.elapsedMs = domain.timerElapsed(match.timer, ctx.time); attempt.finishedAt = ctx.time; } return { timer: match.timer }; };
  handlers.finish_stage = ctx => { ctx.payload.type = 'finish'; return handlers.timer(ctx); };
  handlers.next_stage = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); need(match.timer?.state === 'FINISHED', 'STAGE_NOT_READY', 'Finish the current stage before loading the next.'); return { attempt: setAttempt(ctx, match, match.currentStageIndex + 1) }; };
  handlers.return_stage = ctx => { const match = matchOf(ctx.event, ctx.payload); neutralController(ctx.event, match, ctx.actorId); need(['PAUSED', 'FINISHED', 'READY'].includes(match.timer?.state), 'CLOCK_NOT_READY', 'Pause or finish before returning to a stage.'); const target = Number(ctx.payload.stageIndex); need(Number.isInteger(target) && target >= 0 && target <= match.currentStageIndex, 'INVALID_STAGE', 'Choose a prior stage.'); return { attempt: setAttempt(ctx, match, target, text(ctx.payload.reason, 2000, true)) }; };

  handlers.enter_space = ctx => {
    const match = matchOf(ctx.event, ctx.payload), space = ctx.payload.space || 'main'; authorizeSpace(ctx.event, match, ctx.actorId, space);
    need(sessionMaximum > 0, 'MEDIA_UNCONFIGURED', 'The verified media operating limit must be configured before media admission.');
    const current = ctx.event.media[ctx.actorId];
    need(!current || current.status === 'left' || current.deviceId === ctx.payload.deviceId || ctx.payload.handoff === true, 'MEDIA_SESSION_CONFLICT', 'Confirm device handoff to replace your existing media connection.');
    const connected = mapValues(ctx.event.media).filter(s => s.matchId === match.id && s.userId !== ctx.actorId && s.status !== 'left' && s.expiresAt > ctx.time);
    need(connected.length < sessionMaximum, 'CAPACITY_LIMIT', 'This debate has reached its verified safe media capacity. Remain in the lobby and retry.');
    const session = { eventId: ctx.event.id, matchId: match.id, userId: ctx.actorId, space, identity: `dd-debate-${ctx.actorId}`, roomName: `dd-debate-${ctx.event.id}-${match.id}-${space}`, sources: allowedSources(ctx.event, match, ctx.actorId, space), maxParticipants: sessionMaximum, status: 'pending', deviceId: text(ctx.payload.deviceId, 128, true), expiresAt: ctx.time + 120000 };
    ctx.event.media[ctx.actorId] = session;
    session.operationId = enqueue(ctx, 'media', { action: 'join', session: clone(session), previousSession: current?.status !== 'left' ? current : null });
    return { status: 'pending', operationId: session.operationId };
  };
  handlers.renew_media = ctx => { const match = matchOf(ctx.event, ctx.payload), session = ctx.event.media[ctx.actorId]; need(session && session.matchId === match.id && session.deviceId === ctx.payload.deviceId && session.status === 'ready', 'MEDIA_SESSION_CONFLICT', 'Rejoin from your active media device.'); authorizeSpace(ctx.event, match, ctx.actorId, session.space); session.expiresAt = ctx.time + 120000; return { expiresAt: session.expiresAt }; };
  handlers.leave_media = ctx => { const session = ctx.event.media[ctx.actorId]; if (!session || session.status === 'left') return { left: true }; session.status = 'pending'; session.operationId = enqueue(ctx, 'media', { action: 'leave', session: clone(session) }); return { status: 'pending' }; };
  handlers.grant_floor = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); member(ctx.event, ctx.payload.memberId); match.floorGrants[ctx.payload.memberId] = { expiresAt: ctx.payload.granted === false ? ctx.time : ctx.time + 300000, grantedBy: ctx.actorId }; refreshMedia(ctx); return { granted: ctx.payload.granted !== false }; };
  handlers.assign_presenter = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); if (ctx.payload.memberId) member(ctx.event, ctx.payload.memberId); match.presenterId = ctx.payload.memberId || null; refreshMedia(ctx); return { presenterId: match.presenterId }; };

  handlers.request_help = ctx => { const match = matchOf(ctx.event, ctx.payload); const incident = { id: id(), actorId: ctx.actorId, type: ['technical', 'ruling', 'accommodation'].includes(ctx.payload.type) ? ctx.payload.type : 'technical', reason: text(ctx.payload.reason, 2000, true), at: ctx.time, state: 'OPEN', public: false }; match.incidents.push(incident); return { incidentId: incident.id }; };
  handlers.resolve_incident = ctx => { const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const incident = match.incidents.find(i => i.id === ctx.payload.incidentId); need(incident, 'INCIDENT_NOT_FOUND', 'Choose an existing request.'); incident.state = ctx.payload.acknowledgeOnly ? 'ACKNOWLEDGED' : 'RESOLVED'; incident.resolution = text(ctx.payload.resolution, 2000, true); incident.resolvedBy = ctx.actorId; incident.resolvedAt = ctx.time; return { state: incident.state }; };
  handlers.substitute_speaker = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const seat = ctx.payload.seat;
    need(seatNames.includes(seat), 'INVALID_SEAT', 'Choose a speaking seat.'); need(match.timer?.state !== 'RUNNING', 'CLOCK_NOT_READY', 'Pause before substituting a speaker.');
    const reserve = member(ctx.event, ctx.payload.memberId), side = seat[0] === 'A' ? 'affirmative' : 'negative';
    need(reserve.roles.includes('reserve') && reserve.teamId === match.teamIds[side] && !Object.values(match.seats).includes(reserve.id) && !match.judgeIds.includes(reserve.id), 'ROLE_CONFLICT', 'Choose an approved reserve from this team.');
    const previousId = match.seats[seat]; match.seats[seat] = reserve.id;
    match.incidents.push({ id: id(), type: 'substitution', actorId: ctx.actorId, reason: text(ctx.payload.reason, 2000, true), at: ctx.time, public: true, seat, previousId, replacementId: reserve.id, captainNotice: true, judgeNotice: true });
    match.awardEligibilityReview = true; refreshMedia(ctx); return { seat, previousId, replacementId: reserve.id };
  };
  handlers.conclude_match = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requireOfficial(ctx.event, match, ctx.actorId); const kind = ctx.payload.kind || 'normal';
    need(['normal', 'forfeit', 'double_forfeit', 'cancelled', 'withdrawn', 'postponed'].includes(kind), 'INVALID_CONCLUSION', 'Choose a supported conclusion.');
    if (kind === 'normal') {
      need(match.runOfShow.filter(s => s.speakerSeats.length).every(s => match.attempts.some(a => a.stageId === s.id && a.state === 'FINISHED')), 'STAGES_INCOMPLETE', 'Complete all required speaking stages first.');
      match.phase = 'deliberation'; match.ballotState = 'DRAFT';
    } else {
      const reason = text(ctx.payload.reason, 2000, true); need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the exceptional match conclusion.');
      if (kind === 'forfeit') need(sides.includes(ctx.payload.winner), 'INVALID_WINNER', 'Identify the opponent receiving the forfeit win.');
      match.phase = kind; match.exceptionalConclusion = { kind, winner: kind === 'forfeit' ? ctx.payload.winner : null, reason, at: ctx.time, actorId: ctx.actorId };
      match.incidents.push({ id: id(), type: kind, actorId: ctx.actorId, reason, at: ctx.time, public: true });
    }
    if (match.timer?.state === 'RUNNING') { match.timer.elapsedBeforeRunMs = domain.timerElapsed(match.timer, ctx.time); match.timer.startedAtServerMs = null; match.timer.state = 'PAUSED'; match.timer.version++; }
    refreshMedia(ctx); return { phase: match.phase };
  };
  handlers.save_draft = ctx => {
    const match = matchOf(ctx.event, ctx.payload); need(isJudge(match, ctx.actorId), 'FORBIDDEN', 'Only an assigned judge can save a private scorecard.');
    need(!['FINAL', 'CLOSED'].includes(match.ballotState), 'BALLOTS_CLOSED', 'Ballots are closed; request an authorized correction.');
    const scorecard = ctx.payload.scorecard ? domain.normalizeScorecard(ctx.payload.scorecard, match.rules, { allowIncomplete: true }) : match.drafts[ctx.actorId]?.scorecard || null;
    match.drafts[ctx.actorId] = { judgeId: ctx.actorId, scorecard, notes: text(ctx.payload.notes, 12000), savedAt: ctx.time, revision: (match.drafts[ctx.actorId]?.revision || 0) + 1 };
    return { saved: true, savedAt: ctx.time, draftRevision: match.drafts[ctx.actorId].revision };
  };
  handlers.open_ballots = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); need(match.phase === 'deliberation' || match.exceptionalConclusion, 'BALLOTS_NOT_READY', 'Finish speaking before opening final ballots.'); need(['DRAFT', 'REOPENED'].includes(match.ballotState), 'BALLOTS_CLOSED', 'This ballot round cannot be opened.'); match.ballotState = 'OPEN'; return { ballotState: 'OPEN', round: match.ballotRound }; };
  handlers.submit_ballot = ctx => {
    const match = matchOf(ctx.event, ctx.payload); need(isJudge(match, ctx.actorId), 'FORBIDDEN', 'Only an assigned eligible judge can submit this ballot.'); need(match.ballotState === 'OPEN', 'BALLOTS_CLOSED', 'Final ballots are not open.'); need(ctx.payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Review and confirm your final ballot.');
    let scorecard = null, winner = ctx.payload.winner;
    if (match.rules.judgingMode !== 'simple') { const calculated = domain.scoreScorecard(ctx.payload.scorecard || match.drafts[ctx.actorId]?.scorecard, match.rules); need(match.rules.judgingMode === 'aggregate' || calculated.winner, 'TIE_BREAK_REQUIRED', 'Record a reasoned choice for the exactly tied scorecard.'); scorecard = calculated.normalized; winner = calculated.winner; }
    else need(sides.includes(winner), 'INVALID_WINNER', 'Choose Affirmative or Negative.');
    const key = `${match.ballotRound}:${ctx.actorId}`; if (match.ballots[key]) match.ballotHistory.push(clone(match.ballots[key]));
    const ballot = { id: id(), judgeId: ctx.actorId, round: match.ballotRound, scorecard, winner, submittedAt: ctx.time, version: (match.ballots[key]?.version || 0) + 1, feedback: { affirmative: text(ctx.payload.feedback?.affirmative, 4000), negative: text(ctx.payload.feedback?.negative, 4000) } };
    match.ballots[key] = ballot; return { ballotId: ballot.id, submittedAt: ctx.time, version: ballot.version };
  };
  const currentBallots = match => mapValues(match.ballots).filter(b => b.round === match.ballotRound && match.judgeIds.includes(b.judgeId));
  handlers.close_ballots = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); need(match.ballotState === 'OPEN', 'BALLOTS_CLOSED', 'This round is not open.'); const tally = domain.tabulateBallots(currentBallots(match), match.rules, match.judgeIds); need(tally.complete, 'AWAITING_BALLOTS', 'Await every assigned judge or record an authorized panel change.', { missingJudgeIds: tally.missingJudgeIds, invalid: tally.invalid }); match.ballotState = 'CLOSED'; match.closedTally = tally; return { closed: true, status: tally.status }; };
  handlers.reconsider_ballots = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); need(match.ballotState === 'CLOSED' && match.closedTally?.status === 'UNRESOLVED' && match.ballotRound === 1, 'RECONSIDERATION_UNAVAILABLE', 'Only one same-panel reconsideration is available for an unresolved result.'); match.incidents.push({ id: id(), type: 'reconsideration', reason: text(ctx.payload.reason, 2000, true), actorId: ctx.actorId, at: ctx.time, public: true }); match.ballotRound++; match.ballotState = 'REOPENED'; return { round: match.ballotRound }; };
  handlers.change_panel = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); need(match.ballotState !== 'FINAL', 'BALLOTS_CLOSED', 'Use the result-correction procedure after finalization.');
    const judges = ctx.payload.judgeIds; need(Array.isArray(judges) && judges.length >= 1 && judges.length <= 31 && new Set(judges).size === judges.length && judges.every(actorId => !participantSide(match, actorId)), 'ROLE_CONFLICT', 'Choose eligible independent judges.');
    for (const actorId of judges) member(ctx.event, actorId);
    const added = judges.filter(actorId => !match.judgeIds.includes(actorId));
    if (match.rulesLockedAt) need(added.every(actorId => ctx.payload.observedJudgeIds?.includes(actorId)), 'JUDGE_OBSERVATION_REQUIRED', 'A substitute judge must have observed the required debate; record that confirmation.');
    match.panelHistory.push({ judgeIds: match.judgeIds, nextJudgeIds: judges, reason: text(ctx.payload.reason, 2000, true), actorId: ctx.actorId, at: ctx.time, captainNotice: true });
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
    need(!latestResult(match) || latestResult(match).state === 'SUPERSEDED', 'RESULT_ALREADY_PUBLISHED', 'Use the correction workflow for a published result.');
    const exceptional = match.exceptionalConclusion;
    need(exceptional || match.ballotState === 'CLOSED', 'BALLOTS_NOT_READY', 'Close all required ballots first.');
    const tally = exceptional ? { status: exceptional.winner ? 'DECIDED' : 'UNRESOLVED', winner: exceptional.winner, teamScores: null, ballotSplit: null, judgingMode: match.rules.judgingMode } : domain.tabulateBallots(currentBallots(match), match.rules, match.judgeIds);
    const version = { id: id(), revision: match.resultVersions.length + 1, state: 'PROVISIONAL_PUBLISHED', publishedAt: ctx.time, correctionDeadline: ctx.time + match.rules.correctionWindowMs, actorId: ctx.actorId, ruleVersion: match.ruleVersion, ...tally, resultKind: exceptional?.kind || (tally.winner ? 'normal' : 'unresolved'), feedback: {}, awards: null };
    if (ctx.payload.releaseFeedback === true) for (const side of sides) version.feedback[side] = currentBallots(match).map(b => b.feedback[side]).filter(Boolean);
    match.resultVersions.push(version); match.phase = 'provisional'; match.ballotState = 'PROVISIONAL_PUBLISHED'; return { resultId: version.id, revision: version.revision, status: version.status };
  };
  handlers.protest_result = ctx => { const match = matchOf(ctx.event, ctx.payload), result = latestResult(match); need(sides.some(side => match.captains[side] === ctx.actorId), 'FORBIDDEN', 'Only an assigned captain can file a result protest.'); need(result?.state === 'PROVISIONAL_PUBLISHED' && ctx.time <= result.correctionDeadline, 'CORRECTION_WINDOW_CLOSED', 'The procedural correction window has closed.'); const protest = { id: id(), resultId: result.id, actorId: ctx.actorId, reason: text(ctx.payload.reason, 2000, true), type: ['calculation', 'eligibility', 'procedure'].includes(ctx.payload.type) ? ctx.payload.type : 'procedure', state: 'OPEN', at: ctx.time }; match.protests.push(protest); return { protestId: protest.id }; };
  handlers.resolve_protest = ctx => { const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); const protest = match.protests.find(p => p.id === ctx.payload.protestId); need(protest, 'PROTEST_NOT_FOUND', 'Choose an existing protest.'); protest.state = 'RESOLVED'; protest.disposition = text(ctx.payload.disposition, 2000, true); protest.resolvedAt = ctx.time; protest.resolvedBy = ctx.actorId; return { resolved: true }; };
  handlers.nominate_award = ctx => { const match = matchOf(ctx.event, ctx.payload); need(isJudge(match, ctx.actorId), 'FORBIDDEN', 'Only an assigned judge may nominate an award.'); need(match.ballotState !== 'FINAL', 'BALLOTS_CLOSED', 'Nominations close on finalization.'); need(seatNames.includes(ctx.payload.nomineeId), 'INVALID_NOMINEE', 'Choose one of the six actual speaking seats.'); const nomination = { judgeId: ctx.actorId, nomineeId: ctx.payload.nomineeId, reason: text(ctx.payload.reason, 2000, true) }; if (ctx.payload.runoff) { const state = domain.calculateNominationAward({ nominations: mapValues(match.nominations), activeJudgeIds: match.judgeIds }); need(state.status === 'RUNOFF_REQUIRED' && state.candidates.includes(nomination.nomineeId), 'INVALID_NOMINEE', 'The runoff is limited to tied top nominees.'); match.nominationRunoff ||= {}; match.nominationRunoff[ctx.actorId] = nomination; } else match.nominations[ctx.actorId] = nomination; return { saved: true }; };
  const updateStandings = event => {
    if (mapValues(event.teams).length < 2) return;
    const matches = mapValues(event.matches).filter(m => latestResult(m)?.state === 'FINAL').map(m => { const r = latestResult(m); return { id: m.id, status: 'FINAL', resultKind: r.resultKind, affirmativeTeamId: m.teamIds.affirmative, negativeTeamId: m.teamIds.negative, winnerTeamId: r.winner ? m.teamIds[r.winner] : null, teamScores: r.teamScores, rubricId: domain.rubricFingerprint(m.rules) }; });
    event.standings = domain.calculateStandings(Object.keys(event.teams), matches);
  };
  handlers.finalize_result = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); const result = latestResult(match);
    need(result?.state === 'PROVISIONAL_PUBLISHED', 'RESULT_NOT_READY', 'Publish provisional results first.'); need(ctx.time >= result.correctionDeadline, 'CORRECTION_WINDOW_OPEN', 'Wait until the correction window closes.'); need(!match.protests.some(p => p.state === 'OPEN'), 'PROTEST_UNRESOLVED', 'Resolve outstanding protests before finalization.');
    need(result.winner || ['cancelled', 'double_forfeit', 'withdrawn', 'postponed'].includes(result.resultKind), 'RESULT_UNRESOLVED', 'Resolve the tie or schedule the declared tie-resolution process.');
    result.state = 'FINAL'; result.finalizedAt = ctx.time; result.finalizedBy = ctx.actorId;
    if (result.resultKind === 'normal' && !match.awardEligibilityReview) result.awards = domain.calculateAwards({ ballots: currentBallots(match), rules: match.rules, activeJudgeIds: match.judgeIds, closingSeats: match.closingSeats, nominations: mapValues(match.nominations), runoff: match.nominationRunoff ? mapValues(match.nominationRunoff) : null, matchStatus: 'FINAL' });
    else result.awards = { status: 'UNAVAILABLE', reason: match.awardEligibilityReview ? 'Substitution requires review of actual speaker opportunities.' : 'No speech awards are generated for this exceptional conclusion.' };
    match.ballotState = 'FINAL'; match.phase = 'final'; updateStandings(ctx.event); return { resultId: result.id, revision: result.revision, awards: result.awards };
  };
  handlers.correct_result = ctx => {
    const match = matchOf(ctx.event, ctx.payload); requirePanelAdmin(ctx.event, match, ctx.actorId); const previous = latestResult(match); need(previous && ['PROVISIONAL_PUBLISHED', 'FINAL'].includes(previous.state), 'RESULT_NOT_READY', 'Choose a published result to correct.');
    const reason = text(ctx.payload.reason, 2000, true); previous.state = 'SUPERSEDED'; previous.supersededAt = ctx.time;
    match.incidents.push({ id: id(), type: 'result_correction', reason, actorId: ctx.actorId, at: ctx.time, public: true, supersededResultId: previous.id });
    match.ballotRound++; match.ballotState = 'REOPENED'; match.phase = 'deliberation'; match.downstreamReviewRequired = ctx.event.fixtures.some(f => f.affirmativeSource === match.fixtureId || f.negativeSource === match.fixtureId);
    for (const job of mapValues(ctx.event.jobs)) if (job.resultVersion === previous.id) job.superseded = true;
    return { supersededResultId: previous.id, round: match.ballotRound, downstreamReviewRequired: match.downstreamReviewRequired };
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
    if (p.attachment) { need(['application/pdf', 'image/png', 'image/jpeg'].includes(p.attachment.mimeType) && Number.isInteger(p.attachment.size) && p.attachment.size > 0 && p.attachment.size <= 10485760, 'UNSAFE_FILE', 'Use a PDF, PNG or JPEG no larger than 10 MB.'); need(typeof adapters.validateEvidence === 'function', 'EVIDENCE_UNCONFIGURED', 'Secure evidence upload verification is not configured.'); attachment = await adapters.validateEvidence({ actorId: ctx.actorId, eventId: ctx.event.id, matchId: match.id, uploadId: p.attachment.uploadId, mimeType: p.attachment.mimeType, size: p.attachment.size }); need(attachment?.verified === true, 'UNSAFE_FILE', 'This uploaded file has not passed type and ownership checks.'); }
    const previous = p.previousId ? match.evidence.find(e => e.id === p.previousId && e.actorId === ctx.actorId) : null; need(!p.previousId || previous, 'EVIDENCE_NOT_FOUND', 'You can revise only your own evidence.');
    const evidence = { id: id(), actorId: ctx.actorId, team: participantSide(match, ctx.actorId) || null, matchId: match.id, title: text(p.title, 160, true), description: text(p.description, 2000), sourceUrl, attachment: attachment ? { id: attachment.id, mimeType: attachment.mimeType, size: attachment.size, scanStatus: attachment.scanStatus || 'not_scanned' } : null, storageKey: attachment?.storageKey || null, channel, version: (previous?.version || 0) + 1, previousId: previous?.id || null, at: ctx.time, lateRuling: p.ruling || null };
    match.evidence.push(evidence); return { evidenceId: evidence.id, version: evidence.version };
  };
  handlers.generate_fixtures = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const p = ctx.payload, teams = p.teamIds || Object.keys(ctx.event.teams); need(teams.every(t => ctx.event.teams[t]), 'TEAM_NOT_FOUND', 'Use registered event teams.');
    let generation;
    if (p.method === 'round_robin') generation = domain.generateRoundRobin(teams, { motionIds: p.motionIds || [], motionReusePolicy: p.motionReusePolicy || 'none' });
    else if (p.method === 'elimination') { const order = clone(p.seedOrder || teams); let draw = null; if (p.random === true) { for (let i = order.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [order[i], order[j]] = [order[j], order[i]]; } draw = { actorId: ctx.actorId, atMs: ctx.time, teamOrder: order, reroll: (ctx.event.fixtureDraws?.length || 0) }; } generation = domain.generateElimination(teams, { seedOrder: order, randomDraw: draw, motionIds: p.motionIds || [], motionReusePolicy: p.motionReusePolicy || 'none' }); }
    else fail('INVALID_FIXTURE_METHOD', 'Choose round-robin or single elimination; manual fixtures are created with individual matches.');
    ctx.event.fixtureDraft = generation; ctx.event.fixtureDraws ||= []; ctx.event.fixtureDraws.push({ at: ctx.time, actorId: ctx.actorId, method: p.method, generation: clone(generation) }); return { generation };
  };
  handlers.publish_fixtures = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(ctx.payload.confirmed === true && ctx.event.fixtureDraft, 'CONFIRMATION_REQUIRED', 'Review and confirm the generated fixtures.'); need(!ctx.event.fixtures.some(f => ['LIVE', 'FINAL'].includes(f.status)), 'FIXTURES_LOCKED', 'Started fixtures cannot be overwritten.'); ctx.event.fixtures = clone(ctx.event.fixtureDraft.fixtures); ctx.event.fixtureDraft.needsReview = false; return { published: true, fixtures: ctx.event.fixtures }; };
  handlers.advance_match = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload), result = latestResult(match); need(result?.state === 'FINAL' && result.winner, 'RESULT_UNRESOLVED', 'Finalize a resolved official winner before advancing.');
    if (ctx.payload.fixtureId) { const update = domain.applyFixtureResult(ctx.event.fixtures, ctx.payload.fixtureId, { status: 'FINAL', winnerTeamId: match.teamIds[result.winner], revision: result.revision, resultKind: result.resultKind }); ctx.event.fixtures = update.fixtures; }
    if (ctx.payload.nextMatchId) { const next = ctx.event.matches[ctx.payload.nextMatchId]; need(next && next.id !== match.id && next.phase === 'setup', 'MATCH_NOT_READY', 'Choose a different prepared next match.'); validateAssignments(ctx.event, next); ctx.event.activeMatchId = next.id; }
    ctx.event.status = 'draft'; return { activeMatchId: ctx.event.activeMatchId, fixtures: ctx.event.fixtures };
  };

  function authorizedDocument(event, match, actorId, kind, resultId) {
    const person = member(event, actorId), host = organizer(event, actorId);
    need(['rules', 'scorecard', 'result', 'event_report', 'csv', 'certificate'].includes(kind), 'INVALID_EXPORT', 'Choose a supported export.');
    const base = { eventId: event.id, eventTitle: event.title, matchId: match.id, matchTitle: match.title, rules: clone(match.rules), rulesVersion: match.ruleVersion, runOfShow: clone(match.runOfShow), createdFor: actorId, rehearsal: event.rehearsal };
    if (kind === 'rules') return { ...base, kind, motion: event.motions[match.motionId]?.releasedAt || host ? clone(event.motions[match.motionId] || null) : null };
    if (kind === 'scorecard') { need(isJudge(match, actorId), 'FORBIDDEN', 'Only the judge can export their own scorecard.'); return { ...base, kind, ballot: clone(match.ballots[`${match.ballotRound}:${actorId}`] || null), draft: clone(match.drafts[actorId] || null) }; }
    const result = match.resultVersions.find(r => r.id === (resultId || latestResult(match)?.id)); need(result && ['PROVISIONAL_PUBLISHED', 'FINAL'].includes(result.state), 'RESULT_NOT_READY', 'Choose a currently published result.');
    if (kind === 'certificate') { requireOrganizer(event, actorId); need(result.state === 'FINAL', 'RESULT_NOT_READY', 'Certificates require finalized records.'); }
    if (kind === 'event_report') requireOrganizer(event, actorId);
    const visible = snapshotEvent(event, actorId, now()).matches.find(m => m.id === match.id).resultVersions.find(r => r.id === result.id);
    return { ...base, kind, result: visible, resultVersion: result.id, resultRevision: result.revision, seats: clone(match.seats), teams: clone(match.teamIds), participants: mapValues(event.members).filter(p => p.checkedIn).map(({ id, displayName }) => ({ id, displayName })), ...(kind === 'event_report' ? { standings: clone(event.standings), fixtures: clone(event.fixtures) } : {}) };
  }
  handlers.create_export = ctx => { const match = matchOf(ctx.event, ctx.payload), document = authorizedDocument(ctx.event, match, ctx.actorId, ctx.payload.kind || 'result', ctx.payload.resultId); const jobId = enqueue(ctx, 'export', { matchId: match.id, document, format: ctx.payload.format || (ctx.payload.kind === 'csv' ? 'csv' : 'pdf') }, document.resultVersion); return { jobId, status: 'queued' }; };
  handlers.send_results = ctx => {
    requireOrganizer(ctx.event, ctx.actorId); const match = matchOf(ctx.event, ctx.payload), p = ctx.payload;
    need(p.confirmed === true && p.previewConfirmed === true, 'CONFIRMATION_REQUIRED', 'Preview the recipients and explicitly confirm Send.');
    need(Array.isArray(p.recipientIds) && p.recipientIds.length > 0 && p.recipientIds.length <= 100, 'INVALID_RECIPIENTS', 'Choose event participants as recipients.');
    const jobIds = [];
    for (const actorId of [...new Set(p.recipientIds)]) { member(ctx.event, actorId); if (ctx.event.rehearsal) need(limits.approvedRehearsalRecipientIds?.includes(actorId), 'FORBIDDEN', 'Rehearsal mail is limited to approved test recipients.'); const document = authorizedDocument(ctx.event, match, actorId, 'result', p.resultId); jobIds.push(enqueue(ctx, 'mail', { matchId: match.id, recipientId: actorId, document, rehearsal: ctx.event.rehearsal }, document.resultVersion)); }
    return { jobIds, status: 'queued', delivery: 'not_yet_attempted' };
  };
  handlers.cancel_job = ctx => { const job = ctx.event.jobs[ctx.payload.jobId]; need(job && (job.actorId === ctx.actorId || organizer(ctx.event, ctx.actorId)), 'FORBIDDEN', 'You cannot manage this job.'); need(['queued', 'failed'].includes(job.status), 'JOB_NOT_READY', 'Only queued or failed work can be cancelled.'); job.status = 'cancelled'; ctx.cancelJobs.push(job.id); return { cancelled: true }; };
  handlers.retry_job = ctx => { const job = ctx.event.jobs[ctx.payload.jobId]; need(job && (job.actorId === ctx.actorId || organizer(ctx.event, ctx.actorId)), 'FORBIDDEN', 'You cannot manage this job.'); need(job.status === 'failed', 'JOB_NOT_READY', 'This job is not awaiting retry.'); job.status = 'queued'; ctx.retryJobs.push(job.id); return { queued: true }; };
  handlers.set_retention = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(ctx.actor.platformOperator === true, 'FORBIDDEN', 'Retention policy changes require an authorized platform operator.'); for (const field of ['operationalDays', 'chatDays', 'evidenceDays', 'officialDays']) if (ctx.payload[field] !== undefined) { need(Number.isInteger(ctx.payload[field]) && ctx.payload[field] >= 1 && ctx.payload[field] <= 3650, 'INVALID_RETENTION', 'Choose a retention period from 1 to 3650 days.'); ctx.event.retention[field] = ctx.payload[field]; } ctx.event.retention.approved = ctx.payload.approved === true; if (ctx.payload.hold !== undefined) { ctx.event.retention.hold = ctx.payload.hold === true; ctx.event.retention.holdReason = text(ctx.payload.reason, 2000, ctx.payload.hold === true); } return { retention: ctx.event.retention }; };
  handlers.cleanup_records = ctx => {
    need(ctx.actor.platformOperator === true, 'FORBIDDEN', 'Cleanup requires an authorized platform operator.'); requireOrganizer(ctx.event, ctx.actorId); need(!ctx.event.retention.hold, 'RETENTION_HOLD', 'A documented hold protects these records.');
    const ended = ctx.event.endsAt; need(ended && ended < ctx.time, 'EVENT_NOT_ENDED', 'Set the actual event end before cleanup.');
    let messages = 0, drafts = 0, evidence = 0;
    for (const match of mapValues(ctx.event.matches)) {
      if (ctx.time >= ended + ctx.event.retention.chatDays * 86400000) { messages += match.messages.length; drafts += Object.keys(match.drafts).length; match.messages = []; match.drafts = {}; }
      if (ctx.time >= ended + ctx.event.retention.evidenceDays * 86400000) { evidence += match.evidence.length; for (const item of match.evidence) if (item.storageKey) enqueue(ctx, 'delete_evidence', { matchId: match.id, storageKey: item.storageKey }); match.evidence = []; }
    }
    return { messagesRemoved: messages, draftsRemoved: drafts, evidenceRemovalQueued: evidence };
  };
  handlers.end_event = ctx => { requireOrganizer(ctx.event, ctx.actorId); need(!mapValues(ctx.event.matches).some(m => ['live', 'preparation', 'break'].includes(m.phase)), 'MATCH_STILL_ACTIVE', 'Conclude the active speaking phase before ending the event.'); ctx.event.status = 'completed'; ctx.event.endsAt = ctx.time; for (const session of mapValues(ctx.event.media)) if (session.status !== 'left') { session.status = 'pending'; session.operationId = enqueue(ctx, 'media', { action: 'leave', session: clone(session) }); } return { endedAt: ctx.time }; };

  async function execute(input, claimAttempt = 0) {
    const actorId = authenticate(input.actor), command = input.command, payload = input.payload || {}, time = now();
    need(typeof command === 'string' && Object.hasOwn(handlers, command), 'UNKNOWN_COMMAND', 'This debate action is not supported.');
    need(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_PAYLOAD', 'Check the action details.');
    need(typeof input.idempotencyKey === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey), 'IDEMPOTENCY_REQUIRED', 'Use a unique action receipt key.');
    const unversionedClaim = command === 'claim_invite' && input.expectedRevision === undefined;
    need(unversionedClaim || (Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0), 'REVISION_REQUIRED', 'Refresh the saved event revision before this action.');
    const eventId = command === 'create_event' ? (input.eventId || `de-${(await digest(`${actorId}:${input.idempotencyKey}`)).slice(0, 32)}`) : text(input.eventId, 128, true);
    const payloadHash = await digest(JSON.stringify(canonical(payload))), receiptQuery = { eventId, actorId, command, idempotencyKey: input.idempotencyKey, payloadHash };
    const previousReceipt = await store.receipt(receiptQuery);
    if (previousReceipt) { const saved = await store.read(eventId); return { ok: true, receipt: previousReceipt, event: snapshotEvent(saved, actorId, time), serverNow: time }; }
    let event = command === 'create_event' ? null : await store.read(eventId);
    need(command === 'create_event' || event, 'EVENT_NOT_FOUND', 'This event does not exist or is unavailable.');
    if (event && command !== 'claim_invite') member(event, actorId);
    if (command === 'claim_invite' && claimAttempt === 0) { need(typeof store.rateLimit === 'function', 'STORE_UNCONFIGURED', 'Invitation abuse protection is not configured.'); need(await store.rateLimit(actorId, 'claim_invite', time, 12, 60000), 'INVITE_RATE_LIMIT', 'Please wait before trying another invitation.'); }
    const expectedRevision = unversionedClaim ? event.revision : input.expectedRevision;
    need((event?.revision || 0) === expectedRevision, 'REVISION_CONFLICT', 'The event changed. Refresh and review before trying again.', { revision: event?.revision || 0 });
    const ctx = { event, eventId, actorId, actor: input.actor, payload: clone(payload), time, jobs: [], cancelJobs: [], retryJobs: [] };
    const result = await handlers[command](ctx); ctx.event.updatedAt = time;
    const storedResult = clone(result);
    if (storedResult?.secret) { delete storedResult.secret; storedResult.secretShownOnce = true; }
    const receipt = { id: id(), eventId, command, committedAt: time, result: storedResult };
    let committed;
    try { committed = await store.commit({ ...receiptQuery, expectedRevision, now: time, state: ctx.event, receipt, audit: { actorId, command, at: time, matchId: payload.matchId || null, correlationId: receipt.id }, jobs: ctx.jobs, cancelJobs: ctx.cancelJobs, retryJobs: ctx.retryJobs }); }
    catch (error) { if (unversionedClaim && error.code === 'REVISION_CONFLICT' && claimAttempt < 2) return execute(input, claimAttempt + 1); throw error; }
    if (result?.secret) committed = { ...committed, result: { ...committed.result, secret: result.secret } };
    const latest = await store.read(eventId);
    return { ok: true, receipt: committed, event: snapshotEvent(latest, actorId, time), serverNow: time };
  }

  async function authorizeMedia({ actor, eventId, matchId, deviceId }) {
    const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
    const match = matchOf(event, { matchId }), session = event.media[actorId];
    need(session && session.matchId === match.id && session.expiresAt > now() && (!deviceId || session.deviceId === deviceId), 'MEDIA_SESSION_CONFLICT', 'Rejoin from your active media device.');
    authorizeSpace(event, match, actorId, session.space); need(session.status === 'ready', 'MEDIA_PENDING', 'Wait for the secure room transition to finish.');
    return { ...session, sources: allowedSources(event, match, actorId, session.space) };
  }
  async function processOutbox({ eventId, limit = 5 }) {
    const jobs = await store.claimJobs(eventId, Math.max(1, Math.min(20, limit)), now()), outcomes = [];
    for (const job of jobs || []) {
      let result = null, status = 'completed', errorCode = null;
      try {
        const event = await store.read(job.eventId); need(event, 'EVENT_NOT_FOUND', 'This event is no longer available.');
        if (job.type === 'media') {
          const session = event.media[job.payload.session.userId];
          if (!session || session.operationId !== job.id) { result = { status: 'superseded' }; }
          else { if (job.payload.action !== 'leave') authorizeSpace(event, matchOf(event, { matchId: session.matchId }), session.userId, session.space); need(typeof adapters.media === 'function', 'MEDIA_UNCONFIGURED', 'Media is not configured.'); const applied = await adapters.media(job); result = { status: job.payload.action === 'leave' ? 'left' : 'ready', identity: applied?.identity || session.identity, roomName: applied?.roomName || session.roomName }; }
        } else {
          need(typeof adapters[job.type] === 'function', 'ADAPTER_UNCONFIGURED', 'This delivery service is not configured.');
          member(event, job.actorId);
          if (job.payload.document?.resultVersion) { const match = matchOf(event, { matchId: job.matchId }); const version = match.resultVersions.find(r => r.id === job.payload.document.resultVersion); need(version && version.state !== 'SUPERSEDED', 'RESULT_SUPERSEDED', 'Generate a new output for the corrected result.'); }
          let authorizedJob = job;
          if (job.payload.document) {
            const viewerId = job.type === 'mail' ? job.payload.recipientId : job.payload.document.createdFor;
            member(event, viewerId);
            const fresh = authorizedDocument(event, matchOf(event, { matchId: job.matchId }), viewerId, job.payload.document.kind, job.payload.document.resultVersion);
            authorizedJob = { ...job, payload: { ...job.payload, document: fresh } };
          }
          const applied = await adapters[job.type](authorizedJob);
          need(applied && typeof applied.status === 'string', 'DELIVERY_UNCONFIRMED', 'The delivery service did not confirm its outcome.');
          result = { status: applied.status, ...(typeof applied.downloadId === 'string' ? { downloadId: applied.downloadId } : {}), ...(typeof applied.deliveryStatus === 'string' ? { deliveryStatus: applied.deliveryStatus } : {}), ...(typeof applied.storageKey === 'string' ? { storageKey: applied.storageKey } : {}), ...(typeof applied.filename === 'string' ? { filename: applied.filename } : {}), ...(typeof applied.mimeType === 'string' ? { mimeType: applied.mimeType } : {}) };
        }
      } catch (error) { status = 'failed'; errorCode = error.code || 'DELIVERY_FAILED'; }
      await store.finishJob({ jobId: job.id, claimId: job.claimId, status, result, error: errorCode, now: now() });
      for (let attempt = 0; attempt < 3; attempt++) {
        const event = await store.read(job.eventId); if (!event) break;
        if (event.jobs[job.id]) Object.assign(event.jobs[job.id], { status, error: errorCode, ...(result?.downloadId ? { downloadId: result.downloadId } : {}) });
        if (job.type === 'media') { const session = event.media[job.payload.session.userId]; if (session?.operationId === job.id) session.status = status === 'failed' ? 'failed' : result.status === 'superseded' ? session.status : result.status; }
        const key = `job:${job.id}:${job.claimId}:${attempt}`;
        try { await store.commit({ actorId: job.actorId, command: '__outbox_complete', eventId: job.eventId, idempotencyKey: key, payloadHash: await digest(JSON.stringify({ status, result, errorCode })), expectedRevision: event.revision, state: event, now: now(), receipt: { id: id(), eventId: job.eventId, command: '__outbox_complete', committedAt: now(), result: { jobId: job.id, status } }, audit: { actorId: job.actorId, command: '__outbox_complete', at: now(), jobId: job.id }, jobs: [] }); break; } catch (error) { if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error; }
      }
      outcomes.push({ jobId: job.id, status, error: errorCode });
    }
    return outcomes;
  }
  return {
    execute, authorizeMedia, processOutbox,
    async snapshot({ actor, eventId }) { const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.'); return { ok: true, event: snapshotEvent(event, actorId, now()), serverNow: now() }; },
    async list({ actor }) { const actorId = authenticate(actor), events = await store.list(actorId); return { ok: true, events: (events || []).filter(e => e.members?.[actorId] && !e.members[actorId].removed).map(e => ({ id: e.id, title: e.title, revision: e.revision, rehearsal: e.rehearsal, visibility: e.visibility, status: e.status, createdAt: e.createdAt, roleNames: e.members[actorId].roles })), serverNow: now() }; },
    async authorizeDocument({ actor, eventId, matchId, kind = 'result', resultId }) { const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.'); return authorizedDocument(event, matchOf(event, { matchId }), actorId, kind, resultId); },
    async authorizeDownload({ actor, eventId, downloadId }) {
      const actorId = authenticate(actor), event = await store.read(eventId); need(event, 'EVENT_NOT_FOUND', 'This event does not exist.'); member(event, actorId);
      need(typeof store.readJob === 'function', 'STORE_UNCONFIGURED', 'Secure download lookup is not configured.');
      const job = await store.readJob(downloadId);
      need(job && job.id === downloadId && job.eventId === eventId && job.type === 'export' && job.actorId === actorId && job.status === 'completed' && job.result?.downloadId === downloadId, 'FORBIDDEN', 'This download is unavailable to this account.');
      need(job.createdAt + 7 * 86400000 > now(), 'DOWNLOAD_EXPIRED', 'Generate a new authorized copy; this download has expired.');
      const document = authorizedDocument(event, matchOf(event, { matchId: job.matchId }), actorId, job.payload.document.kind, job.payload.document.resultVersion);
      const extension = job.payload.format === 'csv' ? 'csv' : 'pdf';
      const expectedKey = `exports/${eventId}/${job.id}.${extension}`;
      need(!job.result.storageKey || job.result.storageKey === expectedKey, 'FORBIDDEN', 'This file does not belong to the requested export.');
      return { storageKey: expectedKey, filename: job.result.filename || `debate-${job.id}.${extension}`, mimeType: job.result.mimeType || (extension === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf'), document };
    },
    commandNames: Object.freeze(Object.keys(handlers)),
  };
}
