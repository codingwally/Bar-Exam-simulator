/** V3 competition rules and arithmetic. Pure browser-safe ESM; no I/O or implicit clock. */
export class DebateDomainError extends Error {
  constructor(code, message, details = null) { super(message); this.name = 'DebateDomainError'; this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new DebateDomainError(code, message, details); };
const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const requiredText = (value, label, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_TEXT', `${label} is required and must be at most ${max} characters.`);
  return value.trim();
};
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_NUMBER', `${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function uniqueIds(values, label, { min = 0, max = 256 } = {}) {
  if (!Array.isArray(values) || values.length < min || values.length > max) fail('INVALID_LIST', `${label} has an invalid size.`);
  const ids = values.map((v) => requiredText(v, label, 200));
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_ID', `${label} must contain distinct identities.`);
  return ids;
}
export const SIDES = freeze(['affirmative', 'negative']);
export const SEATS = freeze(['A1', 'A2', 'A3', 'N1', 'N2', 'N3']);
export const SPEAKER_CRITERIA = freeze(['evidence', 'delivery', 'questioning', 'responding']);
const CRITERIA = [...SPEAKER_CRITERIA, 'closing'];
const sideForSeat = (seat) => seat.startsWith('A') ? 'affirmative' : 'negative';
const seatsForSide = (side) => SEATS.filter((seat) => sideForSeat(seat) === side);
const side = (value) => SIDES.includes(value) ? value : fail('INVALID_SIDE', 'Choose Affirmative or Negative.');
export const DEFAULT_RULES = freeze({
  version: 1, preset: 'Due Diligence Modified Oxford–Oregon — 5/3/5', timezone: 'Asia/Manila', language: 'English',
  judgingMode: 'majority', constructiveMs: 300000, interpellationMs: 180000, rebuttalMs: 300000,
  preparationMs: 900000, closingBreakEnabled: true, closingBreakMs: 300000, deliberationMs: null,
  correctionWindowMs: 900000, noShowGraceMs: 600000, controllerLeaseMs: 30000, controllerRenewMs: 10000,
  warningCuesMs: [60000, 0], warningSound: false, observerCameras: true, observerMicrophones: false,
  admissionMicrophone: false, admissionCamera: false, activeSpeakersPerTeam: 3, quickMatchJudges: 1, formalMatchJudges: 3,
  audienceVoting: false, visibility: 'unlisted', motionPrivate: true, recording: false,
  maxConcurrentHostedEvents: 1, maxEventsPerHour: 3, invitationExpiryMs: 604800000,
  cameraRequired: false, allowWrittenConsultation: true, liveCoachConsultation: false,
  newEvidenceInClosing: false, evidenceFiles: 20, evidenceMaxBytes: 10485760, messageMaxCharacters: 2000,
  caseLabels: ['Necessity', 'Beneficiality', 'Practicability'],
  rubric: {
    weights: { evidence: 25, delivery: 30, questioning: 15, responding: 15, closing: 15 },
    labels: { evidence: 'Evidence / argument support', delivery: 'Delivery / clarity', questioning: 'Questioning', responding: 'Responding', closing: 'Closing rebuttal' },
    help: { evidence: 'Evaluate the relevance and support of the arguments and evidence.',
      delivery: 'Evaluate comprehensibility and organization with disclosed accommodations; do not substitute accent, disability, appearance, camera quality or network failure for delivery quality.',
      questioning: 'Evaluate the clarity, relevance and analytical quality of questions.', responding: 'Evaluate responsive, reasoned answers and fair clarification.',
      closing: 'Evaluate comparative closing analysis and rebuilding of the existing case under the accepted evidence policy.' },
    aggregation: 'mean_speakers_plus_closing', provenance: 'DENR 25/30/30/15 weights; Due Diligence aggregation and award defaults',
  },
  awardPolicy: { scoreTies: 'coaward', bestDebaterTie: 'one_runoff_then_coaward', tournamentMinimumMatches: 2 },
  retentionDays: { operational: 30, chatAndDrafts: 30, evidence: 90, officialRecords: 365 },
});

/** Parse decimal marks exactly. Null/blank are incomplete; values beyond two decimals are invalid. */
export function toHundredths(value, label = 'Score') {
  if (value === null || value === undefined || value === '') fail('INCOMPLETE_SCORECARD', `${label} is missing.`);
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) fail('INVALID_SCORE', `${label} must be a finite decimal.`);
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) fail('INVALID_SCORE', `${label} must be nonnegative with at most two decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) fail('INVALID_SCORE', `${label} is too large.`);
  return result;
}
function exactRatio(numerator, denominator = 1) {
  integer(numerator, 'Numerator'); integer(denominator, 'Denominator', 1);
  return { numerator, denominator };
}
function compareRatio(a, b) { const difference = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator); return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function addRatio(a, b) {
  let numerator = BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator);
  let denominator = BigInt(a.denominator) * BigInt(b.denominator); const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) fail('RATIO_LIMIT', 'Too many incomparable fractional values to tabulate safely.');
  return exactRatio(Number(numerator), Number(denominator));
}
function meanRatio(values) { if (!values.length) return null; const sum = values.reduce(addRatio, exactRatio(0)); return exactRatio(sum.numerator, sum.denominator * values.length); }
/** Exact half-up display rounding; arithmetic/comparison never reads this text back. */
export function formatRatio(ratio, decimalPlaces = 2) {
  integer(decimalPlaces, 'Decimal places', 0, 6); exactRatio(ratio.numerator, ratio.denominator);
  const factor = 10n ** BigInt(decimalPlaces), denominator = BigInt(ratio.denominator);
  const rounded = (2n * BigInt(ratio.numerator) * factor + denominator) / (2n * denominator);
  const digits = rounded.toString().padStart(decimalPlaces + 1, '0');
  return decimalPlaces ? `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}` : digits;
}
const scoreView = (ratio) => ({ ...ratio, display: formatRatio(exactRatio(ratio.numerator, ratio.denominator * 100)) });

export function validateRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RULES', 'Rules must be an object.');
  const rules = { ...clone(DEFAULT_RULES), ...clone(input) };
  if (!['majority', 'simple', 'aggregate'].includes(rules.judgingMode)) fail('INVALID_JUDGING_MODE', 'Choose majority, simple ballot or aggregate judging.');
  for (const key of ['constructiveMs', 'interpellationMs', 'rebuttalMs', 'preparationMs', 'closingBreakMs', 'correctionWindowMs', 'noShowGraceMs']) integer(rules[key], key, 0, 86400000);
  if (rules.deliberationMs !== null) integer(rules.deliberationMs, 'deliberationMs', 0, 86400000);
  integer(rules.version, 'Rule version', 1); integer(rules.controllerLeaseMs, 'Controller lease', 1000, 300000);
  integer(rules.controllerRenewMs, 'Controller renewal', 1, rules.controllerLeaseMs - 1);
  for (const key of ['closingBreakEnabled', 'warningSound', 'observerCameras', 'observerMicrophones', 'audienceVoting', 'motionPrivate', 'cameraRequired', 'allowWrittenConsultation', 'liveCoachConsultation', 'newEvidenceInClosing']) {
    if (typeof rules[key] !== 'boolean') fail('INVALID_RULES', `${key} must be true or false.`);
  }
  if (rules.admissionMicrophone !== false || rules.admissionCamera !== false) fail('DEVICE_CONSENT_REQUIRED', 'Admission starts with microphone and camera off; each user explicitly opts in.');
  if (rules.activeSpeakersPerTeam !== 3 || rules.quickMatchJudges !== 1 || rules.formalMatchJudges !== 3) fail('INVALID_PRESET', 'The preset has three speaking seats per team and offers one-judge or three-judge setup.');
  if (rules.recording !== false) fail('RECORDING_OUT_OF_SCOPE', 'Recording requires separate authorization and implementation.');
  if (!['unlisted', 'private', 'public'].includes(rules.visibility)) fail('INVALID_VISIBILITY', 'Unknown event visibility.');
  requiredText(rules.timezone, 'Timezone', 80); try { new Intl.DateTimeFormat('en', { timeZone: rules.timezone }); } catch { fail('INVALID_TIMEZONE', 'Choose a valid event timezone.'); }
  rules.language = requiredText(rules.language, 'Language', 80); rules.preset = requiredText(rules.preset, 'Preset', 160);
  if (!Array.isArray(rules.caseLabels) || rules.caseLabels.length !== 3) fail('INVALID_CASE_LABELS', 'Provide three ordered case labels.');
  rules.caseLabels = rules.caseLabels.map((v) => requiredText(v, 'Case label', 80));
  for (const [key, max] of [['maxConcurrentHostedEvents', 100], ['maxEventsPerHour', 1000], ['invitationExpiryMs', 604800000], ['evidenceFiles', 20], ['evidenceMaxBytes', 10485760], ['messageMaxCharacters', 2000]]) integer(rules[key], key, 1, max);
  if (!Array.isArray(rules.warningCuesMs) || rules.warningCuesMs.length > 10) fail('INVALID_CUES', 'Provide at most ten warning cues.');
  rules.warningCuesMs.forEach((v) => integer(v, 'Warning cue', 0, 86400000));
  rules.warningCuesMs = [...new Set(rules.warningCuesMs)].sort((a, b) => b - a);
  const custom = input.rubric || {}, original = DEFAULT_RULES.rubric;
  if (custom.aggregation && custom.aggregation !== original.aggregation) fail('INVALID_AGGREGATION', 'Only mean speaker scores plus one closing score is supported.');
  if (custom.formula != null || custom.expression != null) fail('INVALID_AGGREGATION', 'Executable scoring formulas are not supported.');
  const weights = { ...original.weights, ...(custom.weights || {}) }, labels = { ...original.labels, ...(custom.labels || {}) }, help = { ...original.help, ...(custom.help || {}) };
  for (const source of [weights, labels, help]) if (Object.keys(source).some((key) => !CRITERIA.includes(key))) fail('INVALID_RUBRIC', 'The rubric contains an unsupported criterion.');
  const weightsHundredths = Object.fromEntries(CRITERIA.map((key) => [key, toHundredths(weights[key], `${key} maximum`)]));
  if (Object.values(weightsHundredths).reduce((sum, n) => sum + n, 0) !== 10000) fail('INVALID_RUBRIC_TOTAL', 'Rubric weights must total exactly 100.');
  for (const key of CRITERIA) {
    labels[key] = requiredText(labels[key], `${key} label`, 100); help[key] = requiredText(help[key], `${key} guidance`, 2000);
    if (custom.labels?.[key] && custom.labels[key] !== original.labels[key] && !custom.help?.[key]) fail('RUBRIC_HELP_REQUIRED', 'A renamed criterion needs matching guidance.');
    weights[key] = weightsHundredths[key] / 100;
  }
  rules.rubric = { weights, weightsHundredths, labels, help, aggregation: original.aggregation, provenance: original.provenance,
    customized: CRITERIA.some((key) => weights[key] !== original.weights[key] || labels[key] !== original.labels[key] || help[key] !== original.help[key]) };
  rules.awardPolicy = { ...clone(DEFAULT_RULES.awardPolicy), ...(input.awardPolicy || {}) };
  if (rules.awardPolicy.scoreTies !== 'coaward' || rules.awardPolicy.bestDebaterTie !== 'one_runoff_then_coaward') fail('UNSUPPORTED_AWARD_POLICY', 'Only disclosed co-awards and one Best Debater runoff are currently supported.');
  integer(rules.awardPolicy.tournamentMinimumMatches, 'Tournament award minimum', 2, 100);
  rules.retentionDays = { ...DEFAULT_RULES.retentionDays, ...(input.retentionDays || {}) };
  for (const value of Object.values(rules.retentionDays)) integer(value, 'Retention days', 1, 3650);
  return freeze(rules);
}
export function rubricFingerprint(rules = DEFAULT_RULES) { const normalized = validateRules(rules); return CRITERIA.map((key) => `${key}:${normalized.rubric.weightsHundredths[key]}:${normalized.rubric.labels[key]}:${normalized.rubric.help[key]}`).join('|'); }
export function validateClosingSeats(closingSeats = { affirmative: 'A1', negative: 'N1' }) {
  for (const team of SIDES) if (!seatsForSide(team).includes(closingSeats?.[team])) fail('INVALID_CLOSING_SEAT', 'Each closing speaker must be one of that team’s three active seats.');
  return { affirmative: closingSeats.affirmative, negative: closingSeats.negative };
}
export function createRunOfShow(input = DEFAULT_RULES, closingSeats) {
  const rules = validateRules(input), closing = validateClosingSeats(closingSeats), stages = [];
  const add = (id, kind, speakerSeats, durationMs, team = null, required = true) => stages.push({ id, kind, speakerSeats, side: team, durationMs, required });
  if (rules.preparationMs > 0) add('preparation', 'preparation', [], rules.preparationMs);
  let index = 1;
  for (let n = 1; n <= 3; n += 1) {
    add(`stage-${String(index++).padStart(2, '0')}`, 'constructive', [`A${n}`], rules.constructiveMs, 'affirmative');
    add(`stage-${String(index++).padStart(2, '0')}`, 'interpellation', [`N${n}`, `A${n}`], rules.interpellationMs);
    add(`stage-${String(index++).padStart(2, '0')}`, 'constructive', [`N${n}`], rules.constructiveMs, 'negative');
    add(`stage-${String(index++).padStart(2, '0')}`, 'interpellation', [`A${n}`, `N${n}`], rules.interpellationMs);
  }
  if (rules.closingBreakEnabled) add('closing-break', 'break', [], rules.closingBreakMs);
  add('stage-13', 'rebuttal', [closing.negative], rules.rebuttalMs, 'negative'); add('stage-14', 'rebuttal', [closing.affirmative], rules.rebuttalMs, 'affirmative');
  add('deliberation', 'deliberation', [], rules.deliberationMs, null, false);
  return stages;
}
export function defaultScheduleDuration(input = DEFAULT_RULES) { const rules = validateRules(input); return { speakingMs: 6 * rules.constructiveMs + 6 * rules.interpellationMs + 2 * rules.rebuttalMs,
  breakMs: rules.closingBreakEnabled ? rules.closingBreakMs : 0, preparationMs: rules.preparationMs, excludes: ['introductions', 'transitions', 'judging', 'uncontrolled overtime'] }; }

export function createTimer({ matchId, stageAttemptId, durationMs }, nowMs) {
  integer(nowMs, 'Server time'); integer(durationMs, 'Duration', 0, 86400000);
  return { matchId: requiredText(matchId, 'Match ID', 200), stageAttemptId: requiredText(stageAttemptId, 'Attempt ID', 300), durationMs,
    elapsedBeforeRunMs: 0, startedAtServerMs: null, state: 'READY', controllerId: null, leaseExpiresAtServerMs: null, version: 1, updatedAtServerMs: nowMs };
}
function validateTimer(timer) {
  if (!timer || !['READY', 'RUNNING', 'PAUSED', 'FINISHED'].includes(timer.state)) fail('INVALID_TIMER', 'Invalid timer state.');
  integer(timer.durationMs, 'Duration', 0, 86400000); integer(timer.elapsedBeforeRunMs, 'Elapsed time'); integer(timer.version, 'Timer version', 1);
  if (timer.state === 'RUNNING') integer(timer.startedAtServerMs, 'Start time');
  else if (timer.startedAtServerMs !== null) fail('INVALID_TIMER', 'A stopped timer cannot contain an active start time.');
  return timer;
}
export function timerElapsed(timer, nowMs) { validateTimer(timer); integer(nowMs, 'Server time'); return integer(timer.elapsedBeforeRunMs + (timer.state === 'RUNNING' ? Math.max(0, nowMs - timer.startedAtServerMs) : 0), 'Elapsed time'); }
function clockText(seconds) { const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
export function timerDisplay(timer, nowMs) {
  const elapsedMs = timerElapsed(timer, nowMs), remainingMs = timer.durationMs - elapsedMs, overtime = remainingMs <= 0;
  const seconds = overtime ? Math.floor(-remainingMs / 1000) : Math.ceil(remainingMs / 1000), time = clockText(seconds);
  return { matchId: timer.matchId, stageAttemptId: timer.stageAttemptId, version: timer.version, text: overtime ? `Overtime +${time}` : time, time, overtime, elapsedMs, remainingMs, overtimeMs: Math.max(0, -remainingMs), state: timer.state,
    paused: timer.state === 'PAUSED', statusText: `${overtime ? 'Overtime' : timer.state === 'READY' ? 'Ready' : 'Time'}${timer.state === 'PAUSED' ? ' · Paused' : ''}` };
}
function expected(timer, command, nowMs) { validateTimer(timer); integer(nowMs, 'Server time'); if (command.expectedVersion !== timer.version) fail('STALE_VERSION', 'Timer changed. Reload the committed state.', { currentVersion: timer.version }); requiredText(command.actorId, 'Controller identity', 200); }
export function claimTimerLease(timer, command, nowMs, leaseMs = 30000) {
  expected(timer, command, nowMs); integer(leaseMs, 'Lease duration', 1000, 300000);
  if (command.authorized !== true) fail('CONTROLLER_REQUIRED', 'Only a designated controller or authorized official may take control.');
  if (timer.controllerId && timer.controllerId !== command.actorId && nowMs < timer.leaseExpiresAtServerMs && command.takeover !== true) fail('CONTROLLER_LEASE_ACTIVE', 'Another controller holds the current lease.');
  if (command.takeover === true) requiredText(command.reason, 'Takeover reason');
  return { ...timer, controllerId: command.actorId, leaseExpiresAtServerMs: nowMs + leaseMs, version: timer.version + 1, updatedAtServerMs: nowMs };
}
export function renewTimerLease(timer, command, nowMs, leaseMs = 30000) {
  expected(timer, command, nowMs); integer(leaseMs, 'Lease duration', 1000, 300000); controller(timer, command.actorId, nowMs);
  return { ...timer, leaseExpiresAtServerMs: nowMs + leaseMs, version: timer.version + 1, updatedAtServerMs: nowMs };
}
function controller(timer, actorId, nowMs) { if (timer.controllerId !== actorId || !Number.isSafeInteger(timer.leaseExpiresAtServerMs) || nowMs >= timer.leaseExpiresAtServerMs) fail('CONTROLLER_LEASE_REQUIRED', 'Control must be renewed or explicitly taken over before changing the timer.'); }
export function applyTimerCommand(timer, command, nowMs) {
  expected(timer, command, nowMs); controller(timer, command.actorId, nowMs);
  const type = String(command.type || '').toUpperCase(), next = { ...timer, version: timer.version + 1, updatedAtServerMs: nowMs };
  const requireState = (...states) => { if (!states.includes(timer.state)) fail('INVALID_TIMER_TRANSITION', `${type} is not available while ${timer.state}.`); };
  if (type === 'START') { requireState('READY'); next.state = 'RUNNING'; next.startedAtServerMs = nowMs; }
  else if (type === 'PAUSE' || type === 'TECHNICAL_PAUSE') { requireState('RUNNING'); if (type === 'TECHNICAL_PAUSE') requiredText(command.reason, 'Technical pause reason'); next.elapsedBeforeRunMs = timerElapsed(timer, nowMs); next.startedAtServerMs = null; next.state = 'PAUSED'; }
  else if (type === 'RESUME') { requireState('PAUSED'); next.state = 'RUNNING'; next.startedAtServerMs = nowMs; }
  else if (type === 'FINISH') { requireState('RUNNING', 'PAUSED'); next.elapsedBeforeRunMs = timerElapsed(timer, nowMs); next.startedAtServerMs = null; next.state = 'FINISHED'; }
  else if (type === 'RESET') { requireState('READY', 'RUNNING', 'PAUSED'); if (command.confirmed !== true) fail('CONFIRMATION_REQUIRED', 'Confirm resetting this attempt.'); requiredText(command.reason, 'Reset reason'); next.elapsedBeforeRunMs = 0; next.startedAtServerMs = null; next.state = 'READY'; }
  else if (type === 'SET_DURATION' || type === 'EDIT_DURATION') { requireState('READY', 'PAUSED'); requiredText(command.reason, 'Duration change reason'); next.durationMs = integer(command.durationMs, 'Duration', 0, 86400000); }
  else fail('UNKNOWN_TIMER_COMMAND', 'Unknown timer action.');
  return next;
}
/** Call only for successive acknowledged/local samples; never emit cues from an initial/reconnect snapshot. */
export function crossedWarningCues(previous, current, { synchronized = true, previouslyFired = [], thresholdsMs = [60000, 0] } = {}) {
  if (!previous || !synchronized || previous.stageAttemptId !== current?.stageAttemptId || previous.state !== 'RUNNING' || current.state !== 'RUNNING') return [];
  if (!Number.isFinite(previous.remainingMs) || !Number.isFinite(current.remainingMs)) return [];
  return thresholdsMs.filter((threshold) => !previouslyFired.includes(threshold) && previous.remainingMs > threshold && current.remainingMs <= threshold);
}
export function createStageAttempt({ matchId, stage, attempts = [], actorId, reason = null, attemptId }, nowMs) {
  if (!stage?.id || stage.durationMs === null) fail('UNTIMED_STAGE', 'This phase has no configured timer.');
  integer(nowMs, 'Server time'); requiredText(actorId, 'Actor ID', 200);
  if (attempts.some((a) => ['READY', 'RUNNING', 'PAUSED'].includes(a.status))) fail('ACTIVE_ATTEMPT_EXISTS', 'Finish or explicitly abandon the current attempt first.');
  const number = attempts.filter((a) => a.stageId === stage.id).length + 1;
  if (number > 1) requiredText(reason, 'Repeat reason');
  const id = attemptId || `${matchId}:${stage.id}:${number}`;
  if (attempts.some((a) => a.id === id)) fail('DUPLICATE_ATTEMPT', 'Attempt ID already exists.');
  const attempt = { id, stageId: stage.id, number, kind: stage.kind, speakerSeats: [...stage.speakerSeats], side: stage.side,
    durationMs: stage.durationMs, status: 'READY', createdAtMs: nowMs, createdBy: actorId, reason, elapsedMs: 0, overtimeMs: 0, finishedAtMs: null };
  return { attempt, attempts: [...clone(attempts), attempt], timer: createTimer({ matchId, stageAttemptId: id, durationMs: stage.durationMs }, nowMs) };
}
export function recordStageAttempt(attempts, timer, nowMs) {
  validateTimer(timer); const found = attempts.find((a) => a.id === timer.stageAttemptId);
  if (!found) fail('ATTEMPT_NOT_FOUND', 'The stage attempt is missing.');
  if (['FINISHED', 'SKIPPED', 'ABANDONED'].includes(found.status)) fail('IMMUTABLE_ATTEMPT', 'Completed attempts must remain unchanged.');
  const elapsedMs = timerElapsed(timer, nowMs);
  return attempts.map((a) => a.id === found.id ? { ...clone(a), status: timer.state, durationMs: timer.durationMs, elapsedMs,
    overtimeMs: Math.max(0, elapsedMs - timer.durationMs), finishedAtMs: timer.state === 'FINISHED' ? nowMs : null } : clone(a));
}
export function abandonStageAttempt(attempts, attemptId, { actorId, reason, confirmed, skipped = false }, nowMs) {
  requiredText(actorId, 'Actor ID', 200); requiredText(reason, 'Incident reason'); integer(nowMs, 'Server time');
  if (confirmed !== true) fail('CONFIRMATION_REQUIRED', 'Confirm the skipped or abandoned stage.');
  const current = attempts.find((a) => a.id === attemptId);
  if (!current || !['READY', 'RUNNING', 'PAUSED'].includes(current.status)) fail('INVALID_ATTEMPT', 'Only an active attempt may be abandoned.');
  return attempts.map((a) => a.id === attemptId ? { ...clone(a), status: skipped ? 'SKIPPED' : 'ABANDONED', finishedAtMs: nowMs, incident: { actorId, reason } } : clone(a));
}

export function normalizeScorecard(card, input = DEFAULT_RULES, { allowIncomplete = false } = {}) {
  const rules = validateRules(input), units = card?.encoding || 'decimal';
  if (!['decimal', 'hundredths'].includes(units)) fail('INVALID_SCORE_ENCODING', 'Scores must declare decimal or hundredths encoding.');
  if (card?.speakers && Object.keys(card.speakers).some((seat) => !SEATS.includes(seat))) fail('INVALID_SCORE_SEAT', 'Only the six accepted speaker seats may be scored.');
  if (card?.closing && Object.keys(card.closing).some((team) => !SIDES.includes(team))) fail('INVALID_SIDE', 'Closing scores belong to Affirmative and Negative.');
  const missing = [], read = (value, key, maximum) => {
    if (maximum === 0) { if (value != null && value !== '' && Number(value) !== 0) fail('DISABLED_CRITERION', `${key} is disabled.`); return 0; }
    if (value === null || value === undefined || value === '') { missing.push(key); return null; }
    const amount = units === 'hundredths' ? integer(value, key) : toHundredths(value, key);
    if (amount > maximum) fail('SCORE_OUT_OF_RANGE', `${key} exceeds its accepted maximum.`); return amount;
  };
  const speakers = Object.fromEntries(SEATS.map((seat) => [seat, Object.fromEntries(SPEAKER_CRITERIA.map((key) => [key, read(card?.speakers?.[seat]?.[key], `${seat}.${key}`, rules.rubric.weightsHundredths[key])]))]));
  const closing = Object.fromEntries(SIDES.map((team) => [team, read(card?.closing?.[team], `${team}.closing`, rules.rubric.weightsHundredths.closing)]));
  if (missing.length && !allowIncomplete) fail('INCOMPLETE_SCORECARD', 'Every enabled score needs explicit entry; a blank is not zero.', { missing });
  return { encoding: 'hundredths', speakers, closing, complete: missing.length === 0, missing,
    tieBreakSide: card?.tieBreakSide == null ? null : side(card.tieBreakSide), tieBreakReason: card?.tieBreakReason == null ? null : requiredText(card.tieBreakReason, 'Tie-break reason') };
}
export function scoreScorecard(card, input = DEFAULT_RULES) {
  const rules = validateRules(input); if (rules.judgingMode === 'simple') fail('SCORES_UNAVAILABLE', 'Simple ballots have no numerical scores.');
  const normalized = normalizeScorecard(card, rules), subtotals = Object.fromEntries(SEATS.map((seat) => [seat, Object.values(normalized.speakers[seat]).reduce((sum, n) => sum + n, 0)]));
  const teams = Object.fromEntries(SIDES.map((team) => [team, scoreView(exactRatio(seatsForSide(team).reduce((sum, seat) => sum + subtotals[seat], 0) + 3 * normalized.closing[team], 3))]));
  const difference = compareRatio(teams.affirmative, teams.negative), tied = difference === 0;
  const winner = tied ? normalized.tieBreakSide : difference > 0 ? 'affirmative' : 'negative';
  if (tied && normalized.tieBreakSide && !normalized.tieBreakReason) fail('TIE_BREAK_REASON_REQUIRED', 'A tied scorecard needs a recorded reason for the ballot choice.');
  if (!tied && normalized.tieBreakSide && normalized.tieBreakSide !== winner) fail('CONTRADICTORY_BALLOT', 'A majority-mode ballot must follow its exact scorecard total.');
  return { complete: true, normalized, subtotals, teams, winner, tied, tieBreakRequired: tied && !winner };
}
export function tabulateBallots(ballots, input = DEFAULT_RULES, activeJudgeIds = []) {
  const rules = validateRules(input), judges = uniqueIds(activeJudgeIds, 'Active judges', { min: 1, max: 31 });
  if (!Array.isArray(ballots)) fail('INVALID_BALLOTS', 'Ballots must be a list.');
  uniqueIds(ballots.map((ballot) => ballot.judgeId), 'Current ballot judges', { max: 31 });
  if (ballots.some((ballot) => !judges.includes(ballot.judgeId))) fail('INELIGIBLE_JUDGE', 'An unassigned judge cannot participate in tabulation.');
  const missingJudgeIds = judges.filter((id) => !ballots.some((ballot) => ballot.judgeId === id)), invalid = [], counted = [];
  for (const ballot of ballots) {
    try {
      if (rules.judgingMode === 'simple') counted.push({ judgeId: ballot.judgeId, winner: side(ballot.winner), score: null });
      else {
        const score = scoreScorecard(ballot.scorecard, rules);
        if (rules.judgingMode === 'majority' && !score.winner) fail('TIE_BREAK_REQUIRED', 'A tied judge scorecard needs a reasoned ballot choice.');
        if (ballot.winner != null && score.winner && ballot.winner !== score.winner) fail('CONTRADICTORY_BALLOT', 'Submitted ballot contradicts exact scores.');
        counted.push({ judgeId: ballot.judgeId, winner: score.winner, score });
      }
    } catch (error) { if (!(error instanceof DebateDomainError)) throw error; invalid.push({ judgeId: ballot.judgeId, code: error.code }); }
  }
  const complete = !missingJudgeIds.length && !invalid.length, ballotSplit = { affirmative: 0, negative: 0, tiedScorecards: 0 };
  for (const ballot of counted) { if (ballot.winner) ballotSplit[ballot.winner] += 1; else ballotSplit.tiedScorecards += 1; }
  const teamScores = rules.judgingMode === 'simple' || !complete ? null : Object.fromEntries(SIDES.map((team) => [team, scoreView(meanRatio(counted.map((b) => b.score.teams[team])))]));
  let winner = null;
  if (complete) { const comparison = rules.judgingMode === 'aggregate' ? compareRatio(teamScores.affirmative, teamScores.negative) : ballotSplit.affirmative - ballotSplit.negative; winner = comparison > 0 ? 'affirmative' : comparison < 0 ? 'negative' : null; }
  return { status: !complete ? 'AWAITING_BALLOTS' : winner ? 'DECIDED' : 'UNRESOLVED', winner, complete,
    judgingMode: rules.judgingMode, requiredJudgeCount: judges.length, validJudgeCount: counted.length, missingJudgeIds, invalid,
    ballotSplit: complete ? ballotSplit : null, teamScores, tied: complete && !winner };
}
export function resolveOfficialResult({ ballots, rules = DEFAULT_RULES, activeJudgeIds, reconsiderationRound = 0, tiebreakJudge = null, tiebreakBallot = null }) {
  integer(reconsiderationRound, 'Reconsideration round', 0, 1); const result = tabulateBallots(ballots, rules, activeJudgeIds);
  if (result.status !== 'UNRESOLVED') return { ...result, reconsiderationRound, nextAction: result.complete ? null : 'await_required_ballots' };
  if (reconsiderationRound === 0) return { ...result, reconsiderationRound, nextAction: 'same_panel_reconsideration' };
  const eligible = tiebreakJudge?.predeclared === true && tiebreakJudge?.eligible === true && tiebreakJudge?.observedRequired === true && !activeJudgeIds.includes(tiebreakJudge.id);
  if (tiebreakBallot && !eligible) fail('INELIGIBLE_TIEBREAK_JUDGE', 'A tie-break adjudicator must be predeclared, eligible and have observed the required debate.');
  if (!eligible || !tiebreakBallot) return { ...result, reconsiderationRound, nextAction: eligible ? 'await_predeclared_tiebreak' : 'schedule_tie_resolution' };
  if (tiebreakBallot.judgeId !== tiebreakJudge.id) fail('INELIGIBLE_TIEBREAK_JUDGE', 'The tie-break ballot belongs to another account.');
  const deciding = tabulateBallots([tiebreakBallot], rules, [tiebreakJudge.id]);
  return { ...result, status: deciding.winner ? 'DECIDED' : 'UNRESOLVED', winner: deciding.winner, tied: !deciding.winner, reconsiderationRound,
    nextAction: deciding.winner ? null : 'schedule_tie_resolution', resolution: 'predeclared_tiebreak', tiebreakJudgeId: tiebreakJudge.id, originalPanelTie: true };
}

function rankAward(values, definition) {
  const candidates = Object.entries(values).map(([id, score]) => ({ id, score, display: formatRatio(score) }));
  if (!candidates.length) return { status: 'UNAVAILABLE', winners: [], definition };
  candidates.sort((a, b) => compareRatio(b.score, a.score)); const winners = candidates.filter((v) => compareRatio(v.score, candidates[0].score) === 0).map((v) => v.id);
  return { status: winners.length > 1 ? 'COAWARD' : 'AWARDED', winners, candidates, definition };
}
export function calculateNominationAward({ nominations = [], activeJudgeIds, eligibleIds = SEATS, runoff = null }) {
  const judges = uniqueIds(activeJudgeIds, 'Award judges', { min: 1, max: 31 }), eligible = uniqueIds(eligibleIds, 'Eligible nominees', { min: 1, max: 1000 });
  const count = (votes, allowed) => {
    if (!Array.isArray(votes)) fail('INVALID_NOMINATIONS', 'Nominations must be a list.');
    uniqueIds(votes.map((v) => v.judgeId), 'Nomination judges', { max: judges.length });
    const counts = Object.fromEntries(allowed.map((id) => [id, 0]));
    for (const v of votes) { if (!judges.includes(v.judgeId) || !allowed.includes(v.nomineeId)) fail('INELIGIBLE_NOMINATION', 'Only assigned judges may nominate eligible candidates.'); requiredText(v.reason, 'Nomination reason'); counts[v.nomineeId] += 1; }
    const missingJudgeIds = judges.filter((id) => !votes.some((v) => v.judgeId === id)), highest = Math.max(...Object.values(counts));
    return { counts, missingJudgeIds, winners: highest ? allowed.filter((id) => counts[id] === highest) : [] };
  };
  const first = count(nominations, eligible);
  if (first.missingJudgeIds.length) return { status: 'AWAITING_NOMINATIONS', ...first, candidates: first.winners, winners: [] };
  if (first.winners.length === 1) { if (runoff) fail('RUNOFF_NOT_REQUIRED', 'A runoff is only available for tied top nominees.'); return { status: 'AWARDED', ...first }; }
  if (runoff === null) return { status: 'RUNOFF_REQUIRED', counts: first.counts, candidates: first.winners, winners: [] };
  const final = count(runoff, first.winners);
  if (final.missingJudgeIds.length) return { status: 'AWAITING_RUNOFF', counts: first.counts, runoffCounts: final.counts, candidates: first.winners, missingJudgeIds: final.missingJudgeIds, winners: [] };
  return { status: final.winners.length > 1 ? 'COAWARD' : 'AWARDED', counts: first.counts, runoffCounts: final.counts, winners: final.winners };
}
export function calculateAwards({ ballots = [], rules: input = DEFAULT_RULES, activeJudgeIds, closingSeats, nominations = [], runoff = null, matchStatus = 'DRAFT' }) {
  const rules = validateRules(input), closing = validateClosingSeats(closingSeats), judges = uniqueIds(activeJudgeIds, 'Active judges', { min: 1, max: 31 });
  if (matchStatus !== 'FINAL') return { status: 'UNAVAILABLE', reason: 'Awards require a valid finalized played match.' };
  const result = tabulateBallots(ballots, rules, judges); if (!result.complete || !result.winner) return { status: 'UNAVAILABLE', reason: 'A complete resolved valid match is required.', bestDebater: { status: 'UNAVAILABLE' } };
  const bestDebater = calculateNominationAward({ nominations, activeJudgeIds: judges, runoff });
  if (rules.judgingMode === 'simple') return { status: 'PARTIAL', bestSpeaker: { status: 'UNAVAILABLE', reason: 'Simple ballots do not contain scores.' }, bestInterpellator: { status: 'UNAVAILABLE', reason: 'Simple ballots do not contain scores.' }, bestRebuttalSpeaker: { status: 'UNAVAILABLE', reason: 'Simple ballots do not contain scores.' }, bestDebater };
  const cards = ballots.map((b) => scoreScorecard(b.scorecard, rules)), individualMax = 10000 - rules.rubric.weightsHundredths.closing;
  const speaker = {}, interpellator = {}, rebuttal = {};
  for (const seat of SEATS) {
    if (individualMax) speaker[seat] = meanRatio(cards.map((c) => exactRatio(c.subtotals[seat] * 100, individualMax)));
    if (rules.rubric.weightsHundredths.questioning) interpellator[seat] = meanRatio(cards.map((c) => exactRatio(c.normalized.speakers[seat].questioning * 100, rules.rubric.weightsHundredths.questioning)));
  }
  if (rules.rubric.weightsHundredths.closing) for (const team of SIDES) rebuttal[closing[team]] = meanRatio(cards.map((c) => exactRatio(c.normalized.closing[team] * 100, rules.rubric.weightsHundredths.closing)));
  return { status: 'AVAILABLE', bestSpeaker: rankAward(speaker, 'Mean normalized individual subtotal, excluding closing.'),
    bestInterpellator: rankAward(interpellator, 'Mean normalized questioning score; responding is separate.'), bestRebuttalSpeaker: rankAward(rebuttal, 'Mean normalized closing score among actual closing speakers.'), bestDebater };
}
function tournamentNominationAward(bucket, minimumMatches, runoff) {
  const eligibility = Object.entries(bucket.nominationScores).map(([id, values]) => ({ id, matchCount: values.length, eligible: values.length >= minimumMatches }));
  const definition = 'Mean judge nomination share per comparable scored match, with each match weighted equally; one top-candidate runoff before a persistent-tie co-award.';
  if (bucket.missingNominations.length) return { status: 'AWAITING_NOMINATIONS', winners: [], eligibility, missing: bucket.missingNominations, definition };
  const ranked = rankAward(Object.fromEntries(Object.entries(bucket.nominationScores).filter(([, values]) => values.length >= minimumMatches).map(([id, values]) => [id, meanRatio(values)])), definition);
  if (ranked.status === 'UNAVAILABLE') return { ...ranked, eligibility };
  // No reasoned nomination is not an award, even when all six zero totals tie.
  if (!ranked.candidates.some((c) => c.score.numerator > 0)) return { status: 'UNAVAILABLE', winners: [], eligibility, definition, reason: 'No valid nominations.' };
  if (ranked.winners.length === 1) { if (runoff) fail('RUNOFF_NOT_REQUIRED', 'The tournament nomination result is not tied.'); return { ...ranked, eligibility }; }
  const top = ranked.winners, eligibleRunoffJudgeIds = Object.entries(bucket.judgeObserved).filter(([, observed]) => top.every((id) => observed.has(id))).map(([id]) => id).sort();
  if (!runoff) return { ...ranked, status: 'RUNOFF_REQUIRED', winners: [], topCandidateIds: top, eligibleRunoffJudgeIds, eligibility,
    blocker: eligibleRunoffJudgeIds.length ? null : 'No assigned judge has observed all tied top candidates; an eligible runoff remains required.' };
  const judges = uniqueIds(runoff.activeJudgeIds, 'Tournament runoff judges', { min: 1, max: 256 });
  if (JSON.stringify([...judges].sort()) !== JSON.stringify(eligibleRunoffJudgeIds)) fail('INVALID_RUNOFF_PANEL', 'The runoff requires the complete eligible assigned panel that observed all top candidates.');
  const votes = runoff.nominations; if (!Array.isArray(votes)) fail('INVALID_NOMINATIONS', 'Runoff nominations must be a list.');
  uniqueIds(votes.map((v) => v.judgeId), 'Runoff judges', { max: judges.length });
  const counts = Object.fromEntries(top.map((id) => [id, 0]));
  for (const vote of votes) { if (!judges.includes(vote.judgeId) || !top.includes(vote.nomineeId)) fail('INELIGIBLE_NOMINATION', 'Runoff choices are limited to the tied top candidates.'); requiredText(vote.reason, 'Runoff reason'); counts[vote.nomineeId] += 1; }
  const missingJudgeIds = judges.filter((id) => !votes.some((v) => v.judgeId === id));
  if (missingJudgeIds.length) return { ...ranked, status: 'AWAITING_RUNOFF', winners: [], topCandidateIds: top, eligibleRunoffJudgeIds, missingJudgeIds, eligibility };
  const highest = Math.max(...Object.values(counts)), winners = top.filter((id) => counts[id] === highest);
  return { ...ranked, status: winners.length > 1 ? 'COAWARD' : 'AWARDED', winners, runoffCounts: counts, eligibility, eligibleRunoffJudgeIds };
}
export function calculateTournamentAwards({ matches, minimumMatches = 2, nominationRunoffs = [] }) {
  integer(minimumMatches, 'Minimum matches', 2, 100); if (!Array.isArray(matches)) fail('INVALID_MATCHES', 'Matches must be a list.');
  uniqueIds(matches.map((m) => m.id), 'Matches', { max: 1000 });
  const buckets = new Map();
  for (const match of matches) {
    if (match.matchStatus !== 'FINAL' || match.resultKind && match.resultKind !== 'normal') continue;
    const rules = validateRules(match.rules); if (rules.judgingMode === 'simple') continue;
    const summary = tabulateBallots(match.ballots, rules, match.activeJudgeIds); if (!summary.complete || !summary.winner) continue;
    const fingerprint = rubricFingerprint(rules), bucket = buckets.get(fingerprint) || { bestSpeaker: {}, bestInterpellator: {}, bestRebuttalSpeaker: {}, matches: [], nominationScores: {}, missingNominations: [], judgeObserved: {} };
    const awards = calculateAwards({ ...match, rules, nominations: [] });
    uniqueIds(SEATS.map((seat) => match.seatParticipantIds?.[seat]), 'Speaker account identities', { min: 6, max: 6 });
    const nominations = calculateNominationAward({ nominations: match.nominations || [], activeJudgeIds: match.activeJudgeIds });
    for (const judgeId of match.activeJudgeIds) { const observed = bucket.judgeObserved[judgeId] ||= new Set(); Object.values(match.seatParticipantIds).forEach((id) => observed.add(id)); }
    for (const judgeId of nominations.missingJudgeIds || []) bucket.missingNominations.push({ matchId: match.id, judgeId });
    for (const seat of SEATS) { const id = match.seatParticipantIds[seat]; (bucket.nominationScores[id] ||= []).push(exactRatio((nominations.counts?.[seat] || 0) * 100, match.activeJudgeIds.length)); }
    for (const name of ['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker']) for (const candidate of awards[name]?.candidates || []) {
      const id = match.seatParticipantIds[candidate.id]; (bucket[name][id] ||= []).push({ matchId: match.id, score: candidate.score });
    }
    bucket.matches.push(match.id); buckets.set(fingerprint, bucket);
  }
  if (!Array.isArray(nominationRunoffs)) fail('INVALID_NOMINATIONS', 'Tournament runoffs must be a list.');
  const runoffRubrics = nominationRunoffs.map((r) => requiredText(r.rubric, 'Runoff rubric', 20000));
  if (new Set(runoffRubrics).size !== runoffRubrics.length) fail('DUPLICATE_ID', 'Each rubric may have only one tournament runoff.');
  if (nominationRunoffs.some((r) => !buckets.has(r.rubric))) fail('INVALID_RUNOFF_RUBRIC', 'Runoff rubric has no eligible scored matches.');
  return { minimumMatches, comparableGroups: [...buckets].map(([rubric, bucket]) => ({ rubric, matchIds: bucket.matches,
    bestDebater: tournamentNominationAward(bucket, minimumMatches, nominationRunoffs.find((r) => r.rubric === rubric)),
    ...Object.fromEntries(['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker'].map((name) => [name, {
      ...rankAward(Object.fromEntries(Object.entries(bucket[name]).filter(([, values]) => values.length >= minimumMatches).map(([id, values]) => [id, meanRatio(values.map((v) => v.score))])), 'Average each match first, then average comparable matches equally.'),
      eligibility: Object.entries(bucket[name]).map(([id, values]) => ({ id, matchCount: values.length, eligible: values.length >= minimumMatches })),
    }])) })), nonComparableRubrics: buckets.size > 1 };
}

const EXCLUDED_VOTER_ROLES = new Set(['debater', 'competitor', 'coach', 'reserve', 'judge', 'chief', 'chief_adjudicator', 'host', 'organizer', 'cohost', 'co_host', 'moderator', 'timekeeper']);
export function audienceEligibleAccountIds(members) {
  if (!Array.isArray(members)) fail('INVALID_MEMBERS', 'Members must be a list.'); uniqueIds(members.map((m) => m.accountId), 'Member identities');
  return members.filter((m) => m.checkedIn === true && m.signedIn === true && m.roles?.includes('observer') && !m.roles.some((r) => EXCLUDED_VOTER_ROLES.has(r))).map((m) => m.accountId);
}
export function calculateAudienceResult({ eligibleAccountIds, votes, published = true }) {
  const eligible = uniqueIds(eligibleAccountIds, 'Eligible voters', { max: 100000 }), eligibleSet = new Set(eligible);
  if (!Array.isArray(votes)) fail('INVALID_VOTES', 'Votes must be a list.'); uniqueIds(votes.map((v) => v.accountId), 'Current voter identities', { max: 100000 });
  const counts = { affirmative: 0, negative: 0 }; let invalidatedCount = 0;
  for (const vote of votes) { if (!eligibleSet.has(vote.accountId) || vote.invalidated === true) { invalidatedCount += 1; continue; } if (vote.withdrawn === true || vote.choice == null) continue; counts[side(vote.choice)] += 1; }
  const validVotes = counts.affirmative + counts.negative;
  if (!published) return { published: false, eligibleCount: eligible.length, counts: null, validVotes: null, winner: null, turnoutPercent: null, choicePercentages: null };
  const percentage = (numerator, denominator) => denominator ? Number(formatRatio(exactRatio(numerator * 100, denominator))) : null;
  return { published: true, counts, eligibleCount: eligible.length, validVotes, invalidatedCount, turnoutPercent: percentage(validVotes, eligible.length),
    choicePercentages: { affirmative: percentage(counts.affirmative, validVotes), negative: percentage(counts.negative, validVotes) },
    winner: !validVotes || counts.affirmative === counts.negative ? null : counts.affirmative > counts.negative ? 'affirmative' : 'negative',
    status: !validVotes ? 'NO_VOTES' : counts.affirmative === counts.negative ? 'TIE' : 'DECIDED', officialOutcomeEffect: 'none' };
}

function motionFor(index, motionIds, policy) {
  if (!motionIds.length) return null;
  if (index < motionIds.length) return motionIds[index];
  if (policy === 'cycle') return motionIds[index % motionIds.length];
  return null;
}
function fixtureOptions(options) { const motionIds = uniqueIds(options.motionIds || [], 'Motion IDs', { max: 1000 }), motionReusePolicy = options.motionReusePolicy || 'none'; if (!['none', 'cycle'].includes(motionReusePolicy)) fail('INVALID_MOTION_REUSE', 'Choose no reuse or explicit cycle reuse.'); return { motionIds, motionReusePolicy }; }
export function generateRoundRobin(teamIds, options = {}) {
  const teams = uniqueIds(teamIds, 'Teams', { min: 2, max: 128 }), { motionIds, motionReusePolicy } = fixtureOptions(options), rotation = [...teams], fixtures = [], idleSlots = [];
  if (rotation.length % 2) rotation.push(null);
  for (let round = 1; round < rotation.length; round += 1) {
    for (let pair = 0; pair < rotation.length / 2; pair += 1) {
      let a = rotation[pair], b = rotation[rotation.length - 1 - pair];
      if (a === null || b === null) { idleSlots.push({ round, teamId: a || b, status: 'IDLE', win: false }); continue; }
      if ((round + pair) % 2 === 0) [a, b] = [b, a];
      fixtures.push({ id: `rr-${round}-${pair + 1}`, round, affirmativeTeamId: a, negativeTeamId: b, motionId: motionFor(fixtures.length, motionIds, motionReusePolicy), status: 'SCHEDULED' });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  return { method: 'round_robin', fixtures, idleSlots, motionReusePolicy, needsReview: true, sideBalance: Object.fromEntries(teams.map((id) => [id, { affirmative: fixtures.filter((m) => m.affirmativeTeamId === id).length, negative: fixtures.filter((m) => m.negativeTeamId === id).length }])) };
}
export function generateElimination(teamIds, options = {}) {
  const teams = uniqueIds(teamIds, 'Teams', { min: 2, max: 128 }), { motionIds, motionReusePolicy } = fixtureOptions(options), order = uniqueIds(options.seedOrder || teams, 'Seed order', { min: teams.length, max: teams.length });
  if (order.some((id) => !teams.includes(id))) fail('INVALID_SEEDS', 'Seed order must contain the event teams exactly once.');
  const draw = options.randomDraw || null;
  if (draw) { requiredText(draw.actorId, 'Draw actor', 200); integer(draw.atMs, 'Draw time'); if (JSON.stringify(draw.teamOrder) !== JSON.stringify(order)) fail('INVALID_DRAW', 'Recorded random outcome must match the submitted seed order.'); integer(draw.reroll, 'Reroll count', 0, 1000); }
  const size = 2 ** Math.ceil(Math.log2(teams.length)); let seeds = [1, 2];
  while (seeds.length < size) { const complement = seeds.length * 2 + 1; seeds = seeds.flatMap((seed) => [seed, complement - seed]); }
  let inputs = seeds.map((seed) => ({ teamId: order[seed - 1] || null, seed, sourceMatchId: null })), round = 1; const fixtures = [], byes = [];
  while (inputs.length > 1) {
    const next = [];
    for (let pair = 0; pair < inputs.length / 2; pair += 1) {
      const a = inputs[2 * pair], b = inputs[2 * pair + 1], id = `se-${round}-${pair + 1}`;
      const bye = round === 1 && (!a.teamId || !b.teamId), winnerTeamId = bye ? a.teamId || b.teamId : null;
      const fixture = { id, round, affirmativeTeamId: a.teamId, negativeTeamId: b.teamId, affirmativeSource: a.sourceMatchId, negativeSource: b.sourceMatchId,
        affirmativeSeed: a.seed || null, negativeSeed: b.seed || null, status: bye ? 'BYE' : round === 1 ? 'SCHEDULED' : 'AWAITING_PREDECESSORS',
        winnerTeamId, motionId: bye ? null : motionFor(fixtures.filter((m) => m.status !== 'BYE').length, motionIds, motionReusePolicy), score: null };
      fixtures.push(fixture); if (bye) byes.push({ matchId: id, teamId: winnerTeamId, speechScore: null, ballotScore: null }); next.push({ teamId: winnerTeamId, sourceMatchId: id });
    }
    inputs = next; round += 1;
  }
  return { method: draw ? 'recorded_random' : 'seeded', bracketSize: size, seedOrder: order, draw: draw ? clone(draw) : null, fixtures, byes, motionReusePolicy, needsReview: true };
}
export function canAdvanceResult(result) { return result?.status === 'FINAL' && Boolean(result.winnerTeamId) && !['unresolved', 'cancelled', 'double_forfeit'].includes(result.resultKind); }
export function applyFixtureResult(fixtures, matchId, result) {
  if (!canAdvanceResult(result)) fail('RESULT_NOT_FINAL', 'Only a finalized resolved winner may advance.');
  const current = fixtures.find((m) => m.id === matchId); if (!current) fail('MATCH_NOT_FOUND', 'Fixture not found.');
  if (![current.affirmativeTeamId, current.negativeTeamId].includes(result.winnerTeamId)) fail('INVALID_WINNER', 'Winner must belong to the fixture.');
  const reviews = [];
  const updated = fixtures.map((m) => {
    if (m.id === matchId) return { ...clone(m), status: 'FINAL', winnerTeamId: result.winnerTeamId, resultRevision: result.revision, resultKind: result.resultKind || 'normal' };
    const field = m.affirmativeSource === matchId ? 'affirmativeTeamId' : m.negativeSource === matchId ? 'negativeTeamId' : null;
    if (!field) return clone(m);
    if (m[field] && m[field] !== result.winnerTeamId && ['LIVE', 'FINAL', 'PROVISIONAL', 'RUNNING'].includes(m.status)) { reviews.push(m.id); return { ...clone(m), requiresReview: true, pendingCorrection: { sourceMatchId: matchId, winnerTeamId: result.winnerTeamId, resultRevision: result.revision } }; }
    const next = { ...clone(m), [field]: result.winnerTeamId }; if (next.affirmativeTeamId && next.negativeTeamId && next.status === 'AWAITING_PREDECESSORS') next.status = 'SCHEDULED'; return next;
  });
  // Preserve every already-derived result below an affected completed match;
  // mark the dependency chain instead of silently replacing its participants.
  const reviewSet = new Set(reviews), queue = [...reviews];
  while (queue.length) {
    const sourceId = queue.shift();
    for (const match of updated) if ((match.affirmativeSource === sourceId || match.negativeSource === sourceId) && !reviewSet.has(match.id)) {
      reviewSet.add(match.id); queue.push(match.id); match.requiresReview = true;
      match.pendingCorrection = { sourceMatchId: matchId, winnerTeamId: result.winnerTeamId, resultRevision: result.revision };
    }
  }
  return { fixtures: updated, downstreamReviewMatchIds: [...reviewSet] };
}
export function calculateStandings(teamIds, matches, { qualifyingPlaces = null } = {}) {
  const teams = uniqueIds(teamIds, 'Teams', { min: 2, max: 128 }); if (!Array.isArray(matches)) fail('INVALID_MATCHES', 'Matches must be a list.'); uniqueIds(matches.map((m) => m.id), 'Match IDs', { max: 10000 });
  if (qualifyingPlaces !== null) integer(qualifyingPlaces, 'Qualifying places', 1, teams.length);
  const rows = Object.fromEntries(teams.map((teamId) => [teamId, { teamId, wins: 0, played: 0, scoredMatches: 0, scores: [], rubrics: [], miniLeagueWins: null }]));
  const final = matches.filter((m) => m.status === 'FINAL' && !['bye', 'cancelled', 'postponed', 'unresolved'].includes(m.resultKind));
  for (const match of final) {
    const ids = [match.affirmativeTeamId, match.negativeTeamId]; if (ids.some((id) => !rows[id]) || ids[0] === ids[1]) fail('INVALID_MATCH_TEAMS', 'A standings match must contain two distinct registered teams.');
    if (match.winnerTeamId != null && !ids.includes(match.winnerTeamId)) fail('INVALID_WINNER', 'Winner must belong to the match.');
    if (match.resultKind === 'double_forfeit' && match.winnerTeamId) fail('INVALID_FORFEIT', 'A double forfeit awards neither team a win.');
    ids.forEach((id) => { rows[id].played += 1; }); if (match.winnerTeamId) rows[match.winnerTeamId].wins += 1;
    if ((!match.resultKind || match.resultKind === 'normal') && match.teamScores) for (const team of SIDES) {
      const id = match[`${team}TeamId`], score = match.teamScores[team]; exactRatio(score.numerator, score.denominator);
      const rubric = requiredText(match.rubricId, 'Comparable rubric ID', 20000); rows[id].scores.push(score); rows[id].rubrics.push(rubric); rows[id].scoredMatches += 1;
    }
  }
  const groups = new Map(); for (const row of Object.values(rows)) { const group = groups.get(row.wins) || []; group.push(row); groups.set(row.wins, group); }
  const ordered = [], rulesApplied = [];
  for (const [wins, group] of [...groups].sort((a, b) => b[0] - a[0])) {
    const ids = group.map((r) => r.teamId), completeMutual = ids.length > 1 && ids.every((id, i) => ids.slice(i + 1).every((other) => final.some((m) => [m.affirmativeTeamId, m.negativeTeamId].includes(id) && [m.affirmativeTeamId, m.negativeTeamId].includes(other))));
    if (completeMutual) group.forEach((r) => { r.miniLeagueWins = final.filter((m) => ids.includes(m.affirmativeTeamId) && ids.includes(m.negativeTeamId) && m.winnerTeamId === r.teamId).length; });
    const rubricIds = new Set(group.flatMap((r) => r.rubrics)), comparable = rubricIds.size === 1 && group.every((r) => r.scoredMatches > 0);
    group.forEach((r) => { r.meanScore = r.scores.length && new Set(r.rubrics).size === 1 ? scoreView(meanRatio(r.scores)) : null; });
    const compare = (a, b) => (completeMutual ? b.miniLeagueWins - a.miniLeagueWins : 0) || (comparable ? compareRatio(b.meanScore, a.meanScore) : 0);
    group.sort(compare); rulesApplied.push({ wins, teamIds: ids, miniLeagueApplied: completeMutual, comparableScoreApplied: comparable });
    let previous = null; for (const row of group) { const tiedPrevious = previous && compare(previous, row) === 0; row.rank = tiedPrevious ? previous.rank : ordered.length + 1; row.tied = Boolean(tiedPrevious); if (tiedPrevious) previous.tied = true; ordered.push(row); previous = row; }
  }
  const tiedGroups = [...new Set(ordered.filter((r) => r.tied).map((r) => r.rank))].map((rank) => ({ rank, teamIds: ordered.filter((r) => r.rank === rank).map((r) => r.teamId) }));
  const unresolvedQualification = qualifyingPlaces !== null && tiedGroups.some((g) => g.rank <= qualifyingPlaces && g.rank + g.teamIds.length - 1 > qualifyingPlaces);
  return { rows: ordered.map(({ scores, rubrics, ...row }) => row), rulesApplied, tiedGroups, unresolvedQualification,
    nextAction: unresolvedQualification ? 'schedule_tie_resolution' : null, excludedKinds: ['bye', 'cancelled', 'postponed', 'unresolved', 'provisional'] };
}
