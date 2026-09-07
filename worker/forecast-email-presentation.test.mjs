import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { buildForecastResultEmail, forecastResultLink, createForecastResultExporter } from './forecast-result-export.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const SUBJECT = 'Commercial and Taxation Laws';
const attempt = {
  id: ID, subject: SUBJECT, setId: `sha256:${'a'.repeat(64)}`, status: 'complete', resultRevision: 1,
  completedAt: '2026-09-07T01:20:00Z',
  answers: Array.from({ length: 20 }, (_, i) => ({ questionId: `q${i + 1}`, answer: `Private original answer ${i + 1}` })),
  questions: Array.from({ length: 20 }, (_, i) => ({ id: `q${i + 1}`, prompt: `Private prompt ${i + 1}` })),
};
attempt.result = {
  complete: true, attemptId: ID, ownerId: OWNER, subject: SUBJECT, setId: attempt.setId, resultRevision: 1,
  schemaVersion: 'forecast-attempt-v1', questionCount: 20, completedQuestionCount: 20,
  totalScore: 50, maxScore: 100, percentage: 50,
  analytics: { averageScore: 2.5, grammarAverage: 1.2, issueSpottingAverage: 4.7,
    performanceBands: { strong: 0, developing: 20, needsFocus: 0 } },
  results: attempt.answers.map((answer, i) => ({ ...answer, userAnswer: answer.answer, number: i + 1,
    question: attempt.questions[i].prompt, score: 2.5, maxScore: 5, suggestedAnswer: 'Private suggested answer',
    mockBarCoaching: { nextStep: 'Private saved coaching' },
    grammar: { score: i % 2 ? 1.2 : 1.1, corrections: [] },
    issueSpotting: { score: i % 2 ? 4.7 : 4.6, identified: [], missed: [] } })),
};

test('branded HTML and plain text quote canonical summary, separate diagnostics, exact private locator and no answer leakage', () => {
  const email = buildForecastResultEmail(attempt, OWNER);
  for (const text of [email.text, email.html]) {
    for (const value of [SUBJECT, ID, '50 / 100', '(50%)', '20 answers assessed', '0 strong', '20 developing', '0 need focus', '1.2 / 5', '4.7 / 5', '2026-09-07 09:20', 'Revision 1']) assert.ok(text.includes(value), value);
    assert.match(text, /do not change your practice score/);
    assert.match(text, /account that owns this report/);
    assert.match(text, /Current Forecast access is required/);
    assert.match(text, /no new grading was performed/);
    assert.doesNotMatch(text, /Private original|Private prompt|Private suggested|Private saved|Bearer|token=/);
  }
  const link = new URL(email.link);
  assert.equal(link.origin, 'https://duediligence.ph'); assert.equal(link.pathname, '/');
  assert.equal(link.hash, '#bar-forecast-2026'); assert.deepEqual([...link.searchParams], [['forecastAttempt', ID]]);
  assert.match(email.html, /https:\/\/duediligence\.ph\/assets\/brand\/logo1-master\.png/);
  assert.match(email.html, /max-width:640px/); assert.match(email.html, /max-width:480px/);
  assert.match(email.html, /#002147/); assert.match(email.html, /#c5a059/); assert.match(email.html, /#fffdf8/);
  assert.match(email.html, /name="viewport"/); assert.match(email.html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(email.html, /<script|<iframe|<form|onerror=|javascript:/i);
});

test('presentation cannot use another owner, incomplete report, invented totals or invalid summary bands', () => {
  assert.throws(() => buildForecastResultEmail(attempt, OTHER), { code: 'BAR_FORECAST_EXPORT_NOT_READY' });
  for (const mutate of [
    (value) => { value.status = 'processing'; }, (value) => { value.result.totalScore = 51; },
    (value) => { value.result.analytics.grammarAverage = 1.1; },
    (value) => { value.result.analytics.performanceBands.developing = 21; },
  ]) { const value = structuredClone(attempt); mutate(value); assert.throws(() => buildForecastResultEmail(value, OWNER)); }
  for (const value of ['https://evil.test', `${ID}&redirect=https://evil.test`, '../../x', '', null]) {
    assert.throws(() => forecastResultLink(value), { code: 'BAR_FORECAST_EXPORT_INVALID' });
  }
  const escaped = structuredClone(attempt); escaped.subject = 'Civil <img src=x onload="evil"> & Law'; escaped.result.subject = escaped.subject;
  assert.match(buildForecastResultEmail(escaped, OWNER).html, /Civil &lt;img/);
  assert.doesNotMatch(buildForecastResultEmail(escaped, OWNER).html, /<img src=x/);
});

test('explicit exporter sends the canonical HTML/text with the same PDF and idempotency claim', async () => {
  const bytes = new TextEncoder().encode('%PDF-test'); let sent = 0;
  const exporter = createForecastResultExporter({
    attemptStore: { getOwned: async (_env, ownerId, attemptId) => { assert.equal(ownerId, OWNER); assert.equal(attemptId, ID); return { attempt }; } },
    renderPdf: async () => bytes,
    rpc: async (_env, name, args) => {
      if (name.endsWith('_email_claim')) return { ok: true, claimed: true, leaseToken: OTHER, idempotencyKey: `forecast-result/${ID}/r1` };
      if (name.endsWith('_email_settle')) { assert.equal(args.p_status, 'provider_accepted'); return { ok: true, email: { status: 'provider_accepted' } }; }
      return { ok: true };
    },
    sendEmail: async (_env, message) => {
      sent += 1;
      assert.equal(message.to, 'verified@example.test'); assert.equal(message.html, buildForecastResultEmail(attempt, OWNER).html);
      assert.equal(message.text, buildForecastResultEmail(attempt, OWNER).text);
      assert.equal(message.attachment.bytes, bytes); assert.equal(message.idempotencyKey, `forecast-result/${ID}/r1`);
      return { accepted: true, providerMessageId: 'fixture-message' };
    },
  });
  assert.equal(sent, 0);
  const result = await exporter.email({}, { id: OWNER, email: 'verified@example.test', email_confirmed_at: '2026-09-01T00:00:00Z' }, ID);
  assert.equal(sent, 1); assert.equal(result.email.status, 'provider_accepted'); assert.match(result.message, /Delivery is not yet confirmed/);
});

const phase2 = await readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const forecast = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
function extract(source, name) {
  const found = new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}`, 'mu').exec(source);
  assert.ok(found, name); return found[0];
}

test('Google auth round-trip retains only a valid exact-route UUID, never an external redirect or arbitrary query', () => {
  for (const [search, hash, expected] of [
    [`?forecastAttempt=${ID}&redirect=https://evil.test&token=secret`, '#bar-forecast-2026', `/?forecastAttempt=${ID}#bar-forecast-2026`],
    [`?forecastAttempt=${ID}&forecastAttempt=${OTHER}`, '#bar-forecast-2026', '/#bar-forecast-2026'],
    ['?forecastAttempt=https://evil.test', '#bar-forecast-2026', '/#bar-forecast-2026'],
    [`?forecastAttempt=${ID}`, '#quorum', '/#quorum'],
  ]) {
    let stored = ''; let destination = '';
    const location = { origin: 'https://duediligence.ph', pathname: '/', search };
    const context = vm.createContext({ URL, URLSearchParams, location, state: { authReturnPending: true }, authReturnStorageKey: 'auth',
      safeSessionWrite: (_key, value) => { stored = value; }, safeSessionRead: () => stored, safeSessionRemove: () => { stored = ''; },
      history: { state: {}, replaceState: (_state, _title, value) => { destination = value; } },
      global: { dispatchEvent: () => {} }, PopStateEvent: class {} });
    vm.runInContext(['safeReturnHash', 'forecastAuthReturnSearch', 'rememberAuthReturn', 'restoreAuthDestination'].map((name) => extract(phase2, name)).join('\n'), context);
    context.hash = hash; vm.runInContext('rememberAuthReturn(hash)', context);
    location.search = ''; // Google returns to the configured callback URL.
    vm.runInContext('restoreAuthDestination()', context);
    assert.equal(destination, expected); assert.equal(stored, '');
    context.unsafe = `https://evil.test/?forecastAttempt=${ID}#bar-forecast-2026`;
    assert.equal(vm.runInContext('forecastAuthReturnSearch(unsafe)', context), '');
    context.unsafe = `https://duediligence.ph/admin/?forecastAttempt=${ID}#bar-forecast-2026`;
    assert.equal(vm.runInContext('forecastAuthReturnSearch(unsafe)', context), '');
  }
});

test('Forecast consumes a link only after current owner, entitlement flow and consent; malformed links never request a report', () => {
  let opened = []; let messages = [];
  const state = { isOpen: true, consentAccepted: true, ownerId: OWNER };
  const location = { hash: '#bar-forecast-2026', search: `?forecastAttempt=${ID}` };
  const context = vm.createContext({ state, location, URLSearchParams, ROUTE: '#bar-forecast-2026',
    runtimeOwnerId: () => OWNER, openSavedForecast: (id) => opened.push(id), renderSubjectPicker: (message) => messages.push(message) });
  vm.runInContext(extract(forecast, 'openForecastAttemptLink'), context);
  assert.equal(vm.runInContext('openForecastAttemptLink()', context), true); assert.deepEqual(opened, [ID]);
  for (const change of [() => { state.isOpen = false; }, () => { state.consentAccepted = false; },
    () => { state.ownerId = OTHER; }, () => { location.hash = '#quorum'; }]) {
    Object.assign(state, { isOpen: true, consentAccepted: true, ownerId: OWNER }); location.hash = '#bar-forecast-2026'; opened = [];
    change(); assert.equal(vm.runInContext('openForecastAttemptLink()', context), false); assert.equal(opened.length, 0);
  }
  Object.assign(state, { isOpen: true, consentAccepted: true, ownerId: OWNER }); location.hash = '#bar-forecast-2026';
  for (const search of [`?forecastAttempt=${ID}&forecastAttempt=${OTHER}`, '?forecastAttempt=javascript:alert(1)', '?forecastAttempt=']) {
    location.search = search; opened = []; messages = [];
    assert.equal(vm.runInContext('openForecastAttemptLink()', context), true); assert.equal(opened.length, 0); assert.match(messages[0], /invalid/);
  }
  location.search = ''; assert.equal(vm.runInContext('openForecastAttemptLink()', context), false);
  assert.match(extract(forecast, 'checkAuthorization'), /state\.consentAccepted\) renderSubjectPicker\('', true\)/);
  assert.match(extract(forecast, 'renderDisclaimer'), /state\.consentAccepted = true;\s+renderSubjectPicker\('', true\)/);
  assert.match(extract(forecast, 'openSavedForecast'), /operation: 'attempt', attemptId/);
  assert.match(extract(forecast, 'openSavedForecast'), /forecastRequestIsCurrent\(ownerId, generation\)/);
});
