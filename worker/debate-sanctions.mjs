/** Declared, manually entered sanctions. Pure ESM; no clock, storage, media or scorecard mutation. */
export class DebateSanctionError extends Error {
  constructor(code, message) { super(message); this.name = 'DebateSanctionError'; this.code = code; }
}
const fail = (code, message) => { throw new DebateSanctionError(code, message); };
const clone = value => JSON.parse(JSON.stringify(value));
const SIDES = ['affirmative', 'negative'], SEATS = ['A1', 'A2', 'A3', 'N1', 'N2', 'N3'];
const text = (value, label, max = 2000) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail('INVALID_SANCTION', `${label} is required and must be at most ${max} characters.`);
const identifier = (value, label) => { const result = text(value, label, 100); if (!/^[a-zA-Z0-9_-]+$/.test(result)) fail('INVALID_SANCTION', `${label} contains unsupported characters.`); return result; };
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_SANCTION', `${label} contains unsupported fields.`);
}
function integer(value, label, min = 0) { if (!Number.isSafeInteger(value) || value < min) fail('INVALID_SANCTION', `${label} must be a safe integer of at least ${min}.`); return value; }
function points(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) fail('INVALID_SANCTION', 'A point deduction must have at most two decimal places.');
  const [whole, fraction = ''] = String(value).trim().split('.'), amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000) fail('INVALID_SANCTION', 'Declare a fixed deduction from 0.01 to 100.00 points.');
  return amount;
}

/** An empty policy is the default. Numeric sanctions have no meaning in simple/majority ballots. */
export function validateSanctionPolicy(policy = [], { judgingMode = 'majority' } = {}) {
  if (!['simple', 'majority', 'aggregate'].includes(judgingMode)) fail('INVALID_SANCTION', 'The judging mode is invalid.');
  if (!Array.isArray(policy) || policy.length > 20) fail('INVALID_SANCTION', 'Declare at most twenty sanctions.');
  const seen = new Set();
  return policy.map(entry => {
    object(entry, ['id', 'label', 'description', 'effect', 'points', 'pointsHundredths'], 'Sanction declaration');
    const id = identifier(entry.id, 'Declaration ID'); if (seen.has(id)) fail('INVALID_SANCTION', 'Declaration IDs must be distinct.'); seen.add(id);
    const result = { id, label: text(entry.label, 'Sanction label', 160), description: text(entry.description, 'Sanction conditions'), effect: entry.effect };
    if (entry.effect === 'warning') {
      if (entry.points != null || entry.pointsHundredths != null) fail('INVALID_SANCTION', 'Warnings cannot change points.');
    } else if (entry.effect === 'team_point_deduction') {
      if (judgingMode !== 'aggregate') fail('SANCTION_MODE_UNSUPPORTED', 'Team point deductions require aggregate judging and must be declared before the match starts. Warnings are available in every judging mode.');
      const amount = points(entry.points);
      if (entry.pointsHundredths != null && entry.pointsHundredths !== amount) fail('INVALID_SANCTION', 'The declared point amount is inconsistent.');
      result.points = `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`; result.pointsHundredths = amount;
    } else fail('INVALID_SANCTION', 'Choose a warning or fixed team point deduction.');
    return result;
  });
}

/** Caller passes the authoritative match rulesLockedAt, never a client claim that the match is unstarted. */
export function assertSanctionPolicyChange(previous, next, { startedAt = null, judgingMode = 'majority' } = {}) {
  const normalized = validateSanctionPolicy(next, { judgingMode });
  const canonical = value => JSON.stringify(validateSanctionPolicy(value, { judgingMode }).sort((a, b) => a.id.localeCompare(b.id)));
  if (startedAt !== null && startedAt !== undefined && canonical(previous) !== canonical(normalized)) fail('SANCTION_POLICY_LOCKED', 'Custom sanctions must be declared before start. Preserve this match’s accepted policy.');
  return normalized;
}

function target(value, effect) {
  object(value, ['side', 'seat'], 'Sanction target');
  if (SIDES.includes(value.side) && value.seat === undefined) return { side: value.side };
  if (effect === 'warning' && SEATS.includes(value.seat) && value.side === undefined) return { seat: value.seat };
  fail('INVALID_SANCTION_TARGET', 'Choose one team, or a speaking seat for a warning. Point deductions apply only to a team.');
}

/** Validate append-only history as well as new input so corrupted or duplicated adjustments fail closed. */
function history(records, policy) {
  if (!Array.isArray(records) || records.length > 500) fail('INVALID_SANCTION', 'The sanction history is invalid or exceeds five hundred records.');
  const declarations = new Map(policy.map(entry => [entry.id, entry])), seen = new Set(), active = new Map(); let previousAt = 0;
  for (const record of records) {
    object(record, ['id', 'action', 'sanctionId', 'target', 'recordId', 'reason', 'actorId', 'at', 'ruleVersion', 'effect', 'label', 'pointsHundredths'], 'Sanction record');
    identifier(record.id, 'Record ID'); if (seen.has(record.id)) fail('DUPLICATE_SANCTION', 'A sanction record ID is already present.'); seen.add(record.id);
    text(record.actorId, 'Official account ID', 200); text(record.reason, 'Sanction reason'); integer(record.ruleVersion, 'Accepted rule version', 1); integer(record.at, 'Record time');
    if (record.at < previousAt) fail('INVALID_SANCTION', 'Sanction history must preserve chronological order.'); previousAt = record.at;
    if (record.action === 'issue') {
      const declaration = declarations.get(record.sanctionId); if (!declaration) fail('SANCTION_UNDECLARED', 'This sanction was not declared in the accepted rules.');
      target(record.target, declaration.effect);
      if (record.recordId !== undefined || record.effect !== declaration.effect || record.label !== declaration.label || record.pointsHundredths !== declaration.pointsHundredths) fail('INVALID_SANCTION', 'The recorded sanction does not match its declared effect.');
      active.set(record.id, record);
    } else if (record.action === 'reverse') {
      const original = active.get(record.recordId);
      if (!original) fail('SANCTION_NOT_ACTIVE', 'Only an active issued sanction can be reversed once.');
      if (record.sanctionId !== original.sanctionId || record.target !== undefined || record.effect !== undefined || record.label !== undefined || record.pointsHundredths !== undefined) fail('INVALID_SANCTION', 'A reversal must reference the original adjustment without replacing it.');
      active.delete(record.recordId);
    } else fail('INVALID_SANCTION', 'Choose issue or reverse.');
  }
  return { active, seen, previousAt };
}

/** Service must authenticate and derive officialIds from current organizer/chief/moderator assignments.
 * context.id/now/ruleVersion are server assigned; command.recordId refers to an original issue when reversing.
 * Neither role strings nor client-supplied authorized flags are accepted as authorization evidence.
 */
export function appendSanction(records, command, context) {
  const { policy = [], judgingMode = 'majority', ruleVersion, actorId, officialIds, now, id } = context || {};
  if (!Array.isArray(officialIds) || !officialIds.includes(actorId) || !actorId) fail('SANCTION_OFFICIAL_REQUIRED', 'A current authorized organizer, chief judge or moderator must enter the sanction.');
  object(command, ['action', 'sanctionId', 'target', 'recordId', 'reason', 'confirmed'], 'Sanction command');
  if (command.confirmed !== true) fail('SANCTION_CONFIRMATION_REQUIRED', 'Confirm this disclosed sanction or reversal.');
  const normalized = validateSanctionPolicy(policy, { judgingMode }), prior = history(records, normalized);
  if (records.length >= 500) fail('INVALID_SANCTION', 'The sanction history is full.');
  identifier(id, 'New record ID'); if (prior.seen.has(id)) fail('DUPLICATE_SANCTION', 'This sanction record already exists; recover the original command receipt.');
  integer(now, 'Record time'); if (now < prior.previousAt) fail('INVALID_SANCTION', 'The record time cannot precede saved sanction history.');
  const record = { id, action: command.action, reason: text(command.reason, 'Sanction reason'), actorId: text(actorId, 'Official account ID', 200), at: now, ruleVersion: integer(ruleVersion, 'Accepted rule version', 1) };
  if (command.action === 'issue') {
    const declaration = normalized.find(entry => entry.id === command.sanctionId); if (!declaration) fail('SANCTION_UNDECLARED', 'Choose a sanction declared in the accepted rules before start.');
    if (command.recordId !== undefined) fail('INVALID_SANCTION', 'An issue cannot reference another sanction record.');
    Object.assign(record, { sanctionId: declaration.id, target: target(command.target, declaration.effect), effect: declaration.effect, label: declaration.label });
    if (declaration.pointsHundredths !== undefined) record.pointsHundredths = declaration.pointsHundredths;
  } else if (command.action === 'reverse') {
    const original = prior.active.get(command.recordId); if (!original) fail('SANCTION_NOT_ACTIVE', 'Only an active issued sanction can be reversed once.');
    if (command.target !== undefined || command.sanctionId !== undefined && command.sanctionId !== original.sanctionId) fail('INVALID_SANCTION', 'A reversal references the original record and cannot change its target.');
    record.recordId = original.id; record.sanctionId = original.sanctionId;
  } else fail('INVALID_SANCTION', 'Choose issue or reverse.');
  return [...clone(records), record];
}

function scoreRatio(value) {
  if (!value || !Number.isSafeInteger(value.numerator) || value.numerator < 0 || !Number.isSafeInteger(value.denominator) || value.denominator < 1) fail('INVALID_SANCTION_TALLY', 'The raw score must be an exact nonnegative ratio.');
  return { numerator: BigInt(value.numerator), denominator: BigInt(value.denominator) };
}
function scoreView(numerator, denominator) {
  let a = numerator < 0n ? -numerator : numerator, b = denominator; while (b) [a, b] = [b, a % b];
  const divisor = a || 1n; numerator /= divisor; denominator /= divisor;
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || numerator < BigInt(Number.MIN_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) fail('SANCTION_ARITHMETIC_LIMIT', 'This adjustment cannot be represented safely.');
  const absolute = numerator < 0n ? -numerator : numerator, rounded = (absolute * 2n + denominator) / (denominator * 2n);
  const display = `${numerator < 0n && rounded > 0n ? '-' : ''}${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`;
  return { numerator: Number(numerator), denominator: Number(denominator), display };
}

/** Inputs/scorecards remain untouched. Numeric sanctions affect only the separately disclosed aggregate result.
 * Negative totals are displayed, never silently clamped. Adjustment-created ties remain unresolved.
 * Awards must continue to use raw scorecards, not adjustedTeamScores.
 */
export function applySanctions(rawTally, records = [], policy = []) {
  if (!rawTally || !['simple', 'majority', 'aggregate'].includes(rawTally.judgingMode)) fail('INVALID_SANCTION_TALLY', 'Provide the original panel tabulation.');
  const normalized = validateSanctionPolicy(policy, { judgingMode: rawTally.judgingMode }), { active } = history(records, normalized);
  const adjustments = clone([...active.values()]), raw = clone(rawTally), adjustedTally = clone(rawTally);
  const deductions = adjustments.filter(record => record.effect === 'team_point_deduction');
  let adjustedTeamScores = null;
  if (deductions.length) {
    if (!rawTally.complete || !['DECIDED', 'UNRESOLVED'].includes(rawTally.status)) fail('SANCTION_BALLOTS_INCOMPLETE', 'Complete and close the panel ballots before applying a point deduction.');
    adjustedTeamScores = Object.fromEntries(SIDES.map(side => {
      const ratio = scoreRatio(rawTally.teamScores?.[side]), deduction = deductions.filter(record => record.target.side === side).reduce((sum, record) => sum + BigInt(record.pointsHundredths), 0n);
      return [side, scoreView(ratio.numerator - deduction * ratio.denominator, ratio.denominator)];
    }));
    const a = adjustedTeamScores.affirmative, n = adjustedTeamScores.negative, difference = BigInt(a.numerator) * BigInt(n.denominator) - BigInt(n.numerator) * BigInt(a.denominator);
    adjustedTally.teamScores = clone(adjustedTeamScores); adjustedTally.winner = difference > 0n ? 'affirmative' : difference < 0n ? 'negative' : null;
    adjustedTally.tied = difference === 0n; adjustedTally.status = difference === 0n ? 'UNRESOLVED' : 'DECIDED';
  }
  return { rawTally: raw, adjustments, adjustedTeamScores, adjustedTally, awardBasis: 'raw_scorecards' };
}
