/** CI-owned browser: actual hosted DOM -> Worker Auth -> Supabase -> DOM. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { HOSTED_ACTOR_NAMES } from './debate-hosted-cleanup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const PRIVATE_NOTE = 'CI_JUDGE_PRIVATE_NOTE_DO_NOT_DISCLOSE';
const PRIVATE_TEAM = 'CI_AFFIRMATIVE_PRIVATE_STRATEGY_DO_NOT_DISCLOSE';
// Independent V3 section 09 oracle: do not import the product's stage generator.
export const HOSTED_DEFAULT_TIMED_STAGES = Object.freeze([
  ['preparation', 'preparation', [], 900000],
  ['stage-01', 'constructive', ['A1'], 300000],
  ['stage-02', 'interpellation', ['N1', 'A1'], 180000],
  ['stage-03', 'constructive', ['N1'], 300000],
  ['stage-04', 'interpellation', ['A1', 'N1'], 180000],
  ['stage-05', 'constructive', ['A2'], 300000],
  ['stage-06', 'interpellation', ['N2', 'A2'], 180000],
  ['stage-07', 'constructive', ['N2'], 300000],
  ['stage-08', 'interpellation', ['A2', 'N2'], 180000],
  ['stage-09', 'constructive', ['A3'], 300000],
  ['stage-10', 'interpellation', ['N3', 'A3'], 180000],
  ['stage-11', 'constructive', ['N3'], 300000],
  ['stage-12', 'interpellation', ['A3', 'N3'], 180000],
  ['closing-break', 'break', [], 300000],
  ['stage-13', 'rebuttal', ['N1'], 300000],
  ['stage-14', 'rebuttal', ['A1'], 300000],
].map(([id, kind, speakerSeats, durationMs]) => Object.freeze({ id, kind, speakerSeats: Object.freeze(speakerSeats), durationMs })));

export function assertHostedDefaultRunOfShow(stages) {
  assert.deepEqual(stages.map(({ id, kind, speakerSeats, durationMs }) => ({ id, kind, speakerSeats, durationMs })),
    [...HOSTED_DEFAULT_TIMED_STAGES, { id: 'deliberation', kind: 'deliberation', speakerSeats: [], durationMs: null }]);
}

export function assertHostedFinishedAttempt(attempt, index, seats) {
  const expected = HOSTED_DEFAULT_TIMED_STAGES[index]; assert.ok(expected && attempt);
  assert.equal(attempt.stageId, expected.id); assert.equal(attempt.stageIndex, index);
  assert.equal(attempt.state, 'FINISHED'); assert.equal(attempt.number, 1); assert.equal(attempt.ruleVersion, 1);
  assert.deepEqual(attempt.speakerSeats, expected.speakerSeats);
  assert.deepEqual(attempt.speakerIds, expected.speakerSeats.map(seat => seats[seat]));
  const types = index === 1 ? ['START', 'PAUSE', 'RESUME', 'FINISH'] : ['START', 'FINISH'];
  assert.deepEqual(attempt.adjustments.map(item => item.type), types);
  let runningAt = null, elapsedMs = 0, previousAt = attempt.createdAt;
  assert.ok(Number.isSafeInteger(previousAt));
  for (const adjustment of attempt.adjustments) {
    assert.ok(Number.isSafeInteger(adjustment.at) && adjustment.at >= previousAt);
    assert.equal(adjustment.durationMs, expected.durationMs);
    if (['START', 'RESUME'].includes(adjustment.type)) { assert.equal(runningAt, null); runningAt = adjustment.at; }
    else { assert.ok(runningAt !== null); elapsedMs += adjustment.at - runningAt; runningAt = null; }
    previousAt = adjustment.at;
  }
  assert.equal(runningAt, null); assert.equal(attempt.finishedAt, previousAt);
  assert.equal(attempt.elapsedMs, elapsedMs); assert.ok(elapsedMs >= expected.durationMs + 1000);
  assert.equal(attempt.overtimeMs, elapsedMs - expected.durationMs);
  return { id: expected.id, kind: expected.kind, seats: [...expected.speakerSeats], attemptId: attempt.id,
    state: 'FINISHED', durationMs: expected.durationMs, startedAt: attempt.adjustments[0].at,
    finishedAt: attempt.finishedAt, elapsedMs, overtimeMs: attempt.overtimeMs, adjustmentTypes: types };
}

export function assertHostedCorrectedAwards(final) {
  assert.equal(final.state, 'FINAL'); assert.equal(final.winner, 'affirmative');
  assert.equal(final.awards?.status, 'AVAILABLE');
  const expected = { bestSpeaker: ['A2', 'A3'], bestInterpellator: ['A1', 'A2', 'A3', 'N1', 'N2', 'N3'],
    bestRebuttalSpeaker: ['A1'], bestDebater: ['A2'] };
  for (const [name, winners] of Object.entries(expected)) {
    assert.equal(final.awards[name]?.status, winners.length > 1 ? 'COAWARD' : 'AWARDED');
    assert.deepEqual(final.awards[name].winners.slice().sort(), winners);
  }
  assert.deepEqual(final.awards.bestRebuttalSpeaker.candidates.map(candidate => candidate.id).sort(), ['A1', 'N1']);
  return expected;
}

export function assertHostedExportVersion(kind, job, final) {
  assert.equal(job?.type, 'export');
  if (['result', 'event_report', 'csv', 'certificate'].includes(kind)) assert.equal(job.resultVersion, final.id);
  else { assert.ok(['rules', 'scorecard'].includes(kind)); assert.ok(job.resultVersion == null); }
}

export function assertHostedNextMatchState(next, prior, motionId, { started = false } = {}) {
  assert.ok(next?.id && next.id !== prior.id); assert.equal(next.motionId, motionId); assert.notEqual(motionId, prior.motionId);
  for (const key of ['drafts', 'ballots', 'polls', 'nominations']) assert.deepEqual(next[key], {});
  for (const key of ['ballotHistory', 'resultVersions', 'messages', 'evidence', 'incidents', 'protests']) assert.deepEqual(next[key], []);
  assert.equal(next.ballotRound, 1); assert.equal(next.ballotState, 'DRAFT'); assert.equal(next.activePollId, null);
  if (!started) {
    assert.equal(next.phase, 'setup'); assert.equal(next.rulesLockedAt, null); assert.equal(next.timer, null);
    assert.deepEqual(next.runOfShow, []); assert.deepEqual(next.attempts, []); assert.deepEqual(next.acknowledgments, {});
    assert.ok(next.motionReleasedAt == null);
  } else {
    assert.equal(next.phase, 'preparation'); assert.equal(next.currentStageIndex, 0); assertHostedDefaultRunOfShow(next.runOfShow);
    assert.ok(Number.isSafeInteger(next.motionReleasedAt) && next.motionReleasedAt > prior.motionReleasedAt);
    assert.equal(next.attempts.length, 1); const attempt = next.attempts[0];
    assert.equal(attempt.stageId, 'preparation'); assert.equal(attempt.state, 'READY'); assert.deepEqual(attempt.adjustments, []);
    assert.ok(!prior.attempts.some(item => item.id === attempt.id));
    assert.equal(next.timer?.matchId, next.id); assert.equal(next.timer.stageAttemptId, attempt.id);
    assert.equal(next.timer.state, 'READY'); assert.equal(next.timer.durationMs, 900000);
    assert.equal(next.timer.elapsedBeforeRunMs, 0); assert.equal(next.timer.startedAtServerMs, null); assert.equal(next.timer.controllerId, null);
  }
}

export function assertHostedPriorMatchPreserved(before, after) { assert.deepEqual(after, before); }

export function hostedBrowserEnvironment(env = process.env) {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'DISPLAY', 'XDG_RUNTIME_DIR']
    .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
}

export function assertCiExecution({ platform = process.platform, env = process.env } = {}) {
  assert.equal(platform, 'linux', 'This test may launch a browser only on an isolated Linux CI runner, never the user desktop.');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'A GitHub Actions runner is required.');
  assert.equal(env.DEBATE_HOSTED_BROWSER_CI, '1', 'Explicit DEBATE_HOSTED_BROWSER_CI=1 is required.');
}

export function finalizeHostedBrowserShutdown(report) {
  const verified = report.pageErrors.length === 0 && report.unexpectedNetwork.length === 0 &&
    report.consoleErrors.every(error => error.expectedResourceRejection === true);
  report.shutdownObservationsVerified = verified;
  if (!verified) report.status = 'FAIL';
}

const BOOTSTRAP_PATHS = new Set(['/debate-room/events', '/debate-room/discover']);
const BOOTSTRAP_ERROR_CODES = new Set(['ORIGIN_NOT_ALLOWED', 'STUDY_ROOM_ACCOUNT_UNAVAILABLE',
  'DEBATE_PREVIEW_RESTRICTED', 'ADMIN_FORBIDDEN', 'ADMIN_DATA_UNAVAILABLE', 'SIGN_IN_REQUIRED',
  'AUTH_REQUIRED', 'INVALID_TOKEN', 'DEBATE_UNAVAILABLE']);
// Fixed codes from the upload path in debate-integration, debate-delivery and
// debate-service. Unknown errors remain OTHER_ERROR, never arbitrary server text.
const UPLOAD_ERROR_CODES = new Set([...BOOTSTRAP_ERROR_CODES, 'METHOD_NOT_ALLOWED', 'FORBIDDEN',
  'EVENT_NOT_FOUND', 'MATCH_NOT_FOUND', 'NOT_MEMBER', 'UNSAFE_FILE', 'UPLOAD_LIMIT', 'UPLOAD_INVALID',
  'UPLOAD_CHANGED', 'UPLOAD_UNAVAILABLE', 'FILE_REQUIRED', 'FILE_TOO_LARGE', 'STORAGE_UNCONFIGURED',
  'PRIVATE_STORAGE_UNCONFIRMED', 'INVALID_FILE_KEY', 'STORAGE_WRITE_UNCONFIRMED', 'DOWNLOAD_UNAVAILABLE', 'STORE_UNAVAILABLE',
  'EVIDENCE_INPUT_READ_FAILED', 'EVIDENCE_BUCKET_CHECK_FAILED', 'EVIDENCE_WRITE_FAILED', 'EVIDENCE_READBACK_FAILED', 'EVIDENCE_SEAL_FAILED']);
const UPLOAD_PATH = '/debate-room/evidence/upload';
const UPLOAD_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const classifiedMime = (value, allowed) => {
  const type = typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
  return !type ? 'ABSENT' : allowed.includes(type) ? type : 'OTHER';
};

export function summarizeHostedEvidenceUpload({ status, contentType, body, expected }) {
  assert.ok(Number.isInteger(status) && status >= 100 && status <= 599);
  assert.ok(UPLOAD_MIME_TYPES.includes(expected?.mimeType) && Number.isSafeInteger(expected?.size) &&
    expected.size > 0 && expected.size <= 10485760 && /^[a-f0-9]{64}$/.test(expected.sha256 || ''));
  const attachment = body?.attachment, size = attachment?.size;
  return { path: UPLOAD_PATH, status, contentType: classifiedMime(contentType, ['application/json', 'text/html']),
    ok: typeof body?.ok === 'boolean' ? body.ok : null,
    errorCode: body?.error?.code == null ? null : UPLOAD_ERROR_CODES.has(body.error.code) ? body.error.code : 'OTHER_ERROR',
    attachmentMimeType: classifiedMime(attachment?.mimeType, UPLOAD_MIME_TYPES),
    attachmentSize: Number.isSafeInteger(size) && size > 0 && size <= 10485760 ? size : null,
    uploadReceiptPresent: typeof attachment?.uploadId === 'string' && attachment.uploadId.length > 0,
    expected: { mimeType: expected.mimeType, size: expected.size, sha256: expected.sha256 } };
}

// Both listeners are armed before the real form click. A failed upload cannot
// leave a 30-second command waiter alive; a command alone cannot bypass upload.
export async function submitHostedEvidenceWithUpload({ page, origin, eventId, matchId, expected, click, record }) {
  let resolve, reject, commandResponse, uploadVerified = false, active = true;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
  const fail = code => { if (active) reject(Object.assign(new Error(code), { code })); };
  const isUpload = request => {
    const url = new URL(request.url());
    return url.origin === origin && url.pathname === UPLOAD_PATH && request.method() === 'POST' &&
      url.searchParams.get('eventId') === eventId && url.searchParams.get('matchId') === matchId;
  };
  const finish = () => { if (active && uploadVerified && commandResponse) resolve(commandResponse); };
  const response = received => {
    const request = received.request(), url = new URL(received.url());
    if (isUpload(request)) {
      (async () => {
        const body = await received.json().catch(() => null);
        if (!active) return;
        const summary = summarizeHostedEvidenceUpload({ status: received.status(),
          contentType: received.headers()['content-type'], body, expected });
        record(summary);
        if (summary.status !== 200 || summary.ok !== true) { fail('HOSTED_EVIDENCE_UPLOAD_FAILED'); return; }
        if (summary.contentType !== 'application/json' || summary.errorCode !== null || !summary.uploadReceiptPresent ||
          summary.attachmentMimeType !== expected.mimeType || summary.attachmentSize !== expected.size) {
          fail('HOSTED_EVIDENCE_UPLOAD_INVALID_RESPONSE'); return;
        }
        uploadVerified = true; finish();
      })().catch(() => fail('HOSTED_EVIDENCE_UPLOAD_OBSERVATION_FAILED'));
    } else if (url.origin === origin && url.pathname === '/debate-room/command' && request.method() === 'POST') {
      let input; try { input = request.postDataJSON(); } catch { return; }
      if (input?.command === 'share_evidence' && input.eventId === eventId && input.payload?.matchId === matchId) {
        commandResponse = received; finish();
      }
    }
  };
  const requestFailed = request => { if (isUpload(request)) {
    record({ path: UPLOAD_PATH, status: null, outcome: 'TRANSPORT_FAILED' }); fail('HOSTED_EVIDENCE_UPLOAD_TRANSPORT_FAILED');
  } };
  page.on('response', response); page.on('requestfailed', requestFailed);
  const timeout = setTimeout(() => fail(uploadVerified ? 'HOSTED_EVIDENCE_COMMAND_UNCONFIRMED' : 'HOSTED_EVIDENCE_UPLOAD_UNCONFIRMED'), 30000);
  try { const [received] = await Promise.all([completed, click()]); return received; }
  finally { active = false; clearTimeout(timeout); page.off('response', response); page.off('requestfailed', requestFailed); }
}

// Only classifications cross the artifact boundary. Never retain raw headers,
// response bodies, full navigation URLs or invitation fragments.
export function summarizeHostedNavigation(value, origin, ownedEventId) {
  try {
    const url = new URL(value), params = new URLSearchParams(url.hash.slice(1));
    return { sameOrigin: url.origin === origin, path: url.pathname === '/debate-room/' ? '/debate-room/' : 'OTHER',
      hasEvent: params.has('event'), matchesOwnedEvent: !!ownedEventId && params.get('event') === ownedEventId,
      hasMatch: params.has('match'), hasInvite: params.has('invite') };
  } catch { return { validUrl: false }; }
}

export function summarizeHostedBootstrap({ pathname, status, contentType, body, headers = {}, origin }) {
  assert.ok(BOOTSTRAP_PATHS.has(pathname));
  assert.ok(Number.isInteger(status) && status >= 100 && status <= 599);
  const header = name => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  const suppliedOrigin = header('origin'), referer = header('referer');
  const classified = (value, choices) => value == null ? 'ABSENT' : choices.includes(value) ? value : 'OTHER';
  let refererRelation = referer == null ? 'ABSENT' : 'OTHER';
  try { if (new URL(referer).origin === origin) refererRelation = 'same-origin'; } catch {}
  const type = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : '';
  return { path: pathname, status, contentType: classified(type || null, ['application/json', 'text/html']),
    ok: typeof body?.ok === 'boolean' ? body.ok : null,
    eventCount: Array.isArray(body?.events) ? body.events.length : null,
    errorCode: body?.error?.code == null ? null : BOOTSTRAP_ERROR_CODES.has(body.error.code) ? body.error.code : 'OTHER_ERROR',
    request: { origin: suppliedOrigin == null ? 'ABSENT' : suppliedOrigin === origin ? 'same-origin'
      : suppliedOrigin === '' ? 'EMPTY' : suppliedOrigin === 'null' ? 'null' : 'OTHER',
      fetchSite: classified(header('sec-fetch-site'), ['same-origin', 'same-site', 'cross-site', 'none']),
      fetchMode: classified(header('sec-fetch-mode'), ['cors', 'same-origin', 'no-cors', 'navigate', 'websocket']),
      fetchDest: classified(header('sec-fetch-dest'), ['empty', 'document', 'iframe', 'script']),
      referer: refererRelation, authorizationPresent: typeof header('authorization') === 'string' && header('authorization').length > 0 } };
}

export async function runHostedBrowserOrganizer({ lifecycle, workerUrl, sourceSha, workerVersion, outputDir, browserFactory } = {}) {
  assertCiExecution();
  assert.equal(workerUrl, FIXTURE_TARGET.workerUrl);
  assert.match(sourceSha || '', /^[a-f0-9]{40}$/); assert.match(workerVersion || '', /^[a-f0-9-]{36}$/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', env: hostedBrowserEnvironment() }).trim(), sourceSha);
  const OUTPUT = path.resolve(outputDir);
  assert.ok(OUTPUT.startsWith(path.join(ROOT, 'artifacts/debate-local-rehearsal') + path.sep));
  const fixtureManifest = lifecycle.snapshot(), purposes = HOSTED_ACTOR_NAMES;
  const ACTOR = index => fixtureManifest.fixtures.find(f => f.purpose === purposes[index]).id;
  assert.equal(fixtureManifest.fixtures.length, 11);
  // Refuse to overwrite any previous run or reuse its database/browser profile.
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await mkdir(OUTPUT);
  await mkdir(path.join(OUTPUT, 'screenshots'));
  await mkdir(path.join(OUTPUT, 'downloads'));
  const started = Date.now();
  const report = {
    kind: 'ISOLATED_CI_HOSTED_BROWSER_ORGANIZER', status: 'RUNNING', startedAt: new Date().toISOString(),
    sourceSha, workerVersion, workerUrl, actualHostedAuth: true, mainWorkerBootstrap: true, physicalMediaVerified: false,
    defaultFlowDurationMs: 4680000, correctionWindowMs: 900000, credentialsStored: false, rawDomStored: false, tracesStored: false,
    testSha256: sha(await readFile(fileURLToPath(import.meta.url))), checks: [], actions: [], stages: [], downloads: [], screenshots: [],
    unexpectedNetwork: [], pageErrors: [], consoleErrors: [], expectedRejections: [], commandRejections: [],
    clockClaims: [], bootstrap: [], navigation: [], evidenceUploads: [], sessionRefreshes: 0,
    claims: { actualBrowserDom: true, actualHostedSql: true, syntheticIdentity: true, actualHostedAuth: true,
      mainWorkerBootstrap: true, studyRoomUi: false, physicalMedia: false, providerMedia: false,
      realEmail: false, nativePostgresConcurrency: false, controlEndurance90Minutes: false, hostedDeployment: true, googleOAuth: false },
    gaps: ['Real temporary password sessions bootstrap the normal SDK; Google OAuth callback is not exercised.',
      'Study Room UI has a separate test; Debate waiting state does not prove Study admission.',
      'Physical microphones/cameras/screen audio, provider media, live capacity and real email remain unverified. Timers use real default durations; media endurance is not claimed.',
      'The next three-judge match is started, not played to another final decision; tournament awards remain rehearsal-excluded.',
      'PDF signatures, page counts and exact downloaded bytes are checked; PDF page layout requires the separate visual export review.'],
  };
  const check = (name, condition, detail = {}) => { assert.ok(condition, name); report.checks.push({ name, status: 'PASS', ...detail }); };
  let browser, host, guest, eventId, matchId;
  const origin = workerUrl, appUrl = `${workerUrl}/debate-room/`;
  const contexts = new Map(), snapshots = new Map(), actorIds = new Map(), checkpoints = new Map(), captured = [];
  let trafficSequence = 0;
  const observedRequests = new WeakMap(), manualClaimIntents = new Map();
  let requestSequence = 0, manualClaimSequence = 0;
  const pendingObservation = new Set();
  const snapshotFor = page => snapshots.get(page);
  const matchFor = (page, id = matchId) => snapshotFor(page)?.matches.find(match => match.id === id);
  const action = (page, name, suffix = '') => page.locator(`[data-action="${name}"]${suffix}:visible`).first();
  // Poll locator results in Node. waitForFunction compiles strings in the page
  // and is rejected by the application's deliberately unchanged CSP.
  const pollLocator = async (description, read, accepts) => {
    const deadline = Date.now() + 20000; let last;
    do {
      last = await read(); if (accepts(last)) return last;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.fail(`Timed out waiting for ${description}; last locator value: ${JSON.stringify(last)}`);
  };
  const textIncludes = async (page, selector, text) => {
    const target = page.locator(selector); await target.waitFor({ state: 'attached' });
    return pollLocator(`${selector} to contain ${text}`, () => target.textContent(), value => value?.includes(text));
  };
  const notSaving = page => pollLocator('the current action to finish', () => page.locator('#status').textContent(), value => value !== 'Saving…');
  const screenshot = async (page, name) => {
    assert.equal(await page.locator('#dialog').isVisible(), false, 'Never capture an invitation or private Auth dialog.');
    const relative = `screenshots/${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(OUTPUT, relative), fullPage: true }); report.screenshots.push(relative);
  };
  const checkLiveToolPanels = async () => {
    const originalTile = await host.locator('#affirmative-tiles .tile').first().elementHandle();
    await host.locator('[data-live-tool=conversation]').click();
    await host.locator('#tool-conversation').waitFor({ state: 'visible' });
    await host.locator('#message-form textarea').fill('Unsent layout check');
    await host.keyboard.press('Escape');
    await host.locator('#live-tools-dialog').waitFor({ state: 'hidden' });
    check('Escape closes the room tool and returns keyboard focus', await host.locator('[data-live-tool=conversation]').evaluate(element => element === document.activeElement));
    await host.locator('[data-live-tool=conversation]').click();
    check('Opening and closing Conversation preserves an unsent draft', await host.locator('#message-form textarea').inputValue() === 'Unsent layout check');
    await host.locator('#message-form textarea').fill(''); await host.locator('#live-tools-close').click();
    await host.locator('[data-live-tool=evidence]').click();
    await host.locator('#evidence-form [name=title]').fill('Unsent evidence layout check');
    await host.locator('#live-tools-close').click(); await host.locator('[data-live-tool=evidence]').click();
    check('Opening and closing Evidence preserves its unsent form', await host.locator('#evidence-form [name=title]').inputValue() === 'Unsent evidence layout check');
    await host.locator('#evidence-form [name=title]').fill(''); await host.locator('#live-tools-close').click();
    await host.locator('[data-live-tool=stages]').click();
    check('Stages opens the complete current run of show', await host.locator('#tool-stages').isVisible()
      && await host.locator('#run-of-show li').count() === matchFor(host).runOfShow.length);
    await host.locator('#live-tools-close').click(); await host.locator('[data-live-tool=rooms]').click();
    check('Rooms exposes private-room choices and the ruling or help request', await host.locator('#private-space-controls').isVisible()
      && await host.locator('#request-help').isVisible());
    await host.locator('#live-tools-close').click();
    check('Room tool panels preserve the subscribed participant tile node', await host.locator('#affirmative-tiles .tile').first().evaluate((element, previous) => element === previous, originalTile));
    await originalTile.dispose();
    await host.locator('.timer-options summary').click();
    for (const name of ['return-stage', 'technical-pause', 'reset-clock', 'edit-clock']) await host.locator('.timer-options [data-action="' + name + '"]').hover({ trial: true });
    check('Timer options expose all four existing secondary controls without running an action', true);
    await host.locator('.timer-options summary').click();
  };
  const checkLiveMediaLayout = async (width, height = 900, imageLabel = 'live-media-controls') => {
    await host.setViewportSize({ width, height });
    await host.locator('.site-header').scrollIntoViewIfNeeded();
    const selectors = ['.media-dock', '#arena', '.judges-rail', '#affirmative-name', '#negative-name'];
    const boxes = await Promise.all(selectors.map(selector => host.locator(selector).boundingBox()));
    check(`Live room layout exposes the media controls, arena and headings at ${width}px`, boxes.every(box => box && box.width > 0 && box.height > 0));
    const [dock, arena, ...headings] = boxes;
    const desktop = width >= 1100 && height >= 650;
    check(`Media controls remain separate from the arena and headings at ${width}px`, desktop
      ? arena.y + arena.height <= dock.y + 1 && headings.every(box => box.y + box.height <= dock.y + 1)
      : dock.y + dock.height <= arena.y + 1 && headings.every(box => dock.y + dock.height <= box.y + 1),
      { width, height, position: desktop ? 'bottom' : 'above arena', geometry: Object.fromEntries(selectors.map((selector, index) => [selector, boxes[index]])) });
    const ids = ['join-media', 'mic', 'camera', 'share', 'devices', 'audio', 'leave-media'];
    const controls = await Promise.all(ids.map(async id => ({ id, box: await host.locator(`.media-dock #${id}`).boundingBox(),
      disabled: await host.locator(`.media-dock #${id}`).isDisabled() })));
    const contained = (inner, outer) => inner && outer && inner.x >= outer.x - 1 && inner.y >= outer.y - 1
      && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
    const disjoint = (a, b) => a && b && (a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1
      || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1);
    check(`All seven media controls fit inside the dock without horizontal viewport overflow at ${width}px`, await host.locator('.media-dock button').count() === ids.length
      && controls.every(({ box }) => contained(box, dock) && box.x >= 0 && box.x + box.width <= width + 1
        && box.width >= 44 && box.height >= 44), { width, controls });
    check(`Media controls have separate hit areas at ${width}px`, controls.every(({ box }, index) => controls.slice(index + 1).every(other => disjoint(box, other.box))));
    // Trial checks only: scroll and test visibility/stability/hit targeting,
    // including disabled controls, without entering media or dispatching clicks.
    for (const id of ids) await host.locator(`.media-dock #${id}`).hover({ trial: true });
    check(`Every media control passes browser hit-target checks at ${width}px`, true, { width, controlIds: ids, action: 'hover trial only' });
    await host.locator('.site-header').scrollIntoViewIfNeeded();
    if (desktop) {
      const viewport = { x: 0, y: 0, width, height }, items = [];
      for (const selector of ['#live-motion', '#active-match', '.affirmative', '.negative', '.judges-rail', '.observers', '#clock', '#stage-controls', '.media-dock', '.live-tool-actions']) {
        const box = await host.locator(selector).boundingBox();
        check(selector + ' fits in the desktop window', contained(box, viewport) && box.width > 0 && box.height > 0, { width, height, box });
        items.push({ selector, box });
      }
      for (const selector of ['#affirmative-tiles .tile', '#negative-tiles .tile', '#judge-tiles .tile', '#observer-tiles .tile']) {
        const count = await host.locator(selector).count();
        check(selector + ' has its assigned visible bench', count > 0 && (!selector.includes('affirmative') && !selector.includes('negative') || count === 3));
        for (let index = 0; index < count; index++) {
          const tile = host.locator(selector).nth(index), box = await tile.boundingBox(), caption = await tile.locator('.caption').boundingBox();
          check(selector + ' participant and caption fit without page scrolling', contained(box, viewport) && contained(caption, box) && box.height >= 64, { width, height, index, box, caption });
          const pin = await tile.locator('.tile-pin').boundingBox(), initials = await tile.locator('.initials').boundingBox();
          check(selector + ' keeps the desktop Pin, initials and caption separate', contained(pin, box) && contained(initials, box)
            && pin.width >= 44 && pin.height >= 44 && disjoint(pin, initials) && disjoint(pin, caption) && disjoint(initials, caption),
            { width, height, index, box, pin, initials, caption });
        }
      }
      for (const selector of ['#stage-controls>button', '.live-tool-actions button', '#observers-prev', '#observers-next']) {
        const count = await host.locator(selector).count();
        for (let index = 0; index < count; index++) {
          const control = host.locator(selector).nth(index), box = await control.boundingBox();
          check(selector + ' is reachable in the desktop window', contained(box, viewport) && box.height >= 44 && box.width >= 44, { width, height, index, box });
          await control.hover({ trial: true });
        }
      }
      const floorScroll = await host.locator('.floor').evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight }));
      check('The clock and main timer controls fit together without inner scrolling', floorScroll.scrollHeight <= floorScroll.height + 1, { width, height, floorScroll });
      if (await host.locator('#clock.overtime').count()) {
        const clockGeometry = await host.locator('#clock').evaluate(element => ({ fontSize: parseFloat(getComputedStyle(element).fontSize),
          lineHeight: parseFloat(getComputedStyle(element).lineHeight), height: element.clientHeight, width: element.clientWidth,
          scrollHeight: element.scrollHeight, scrollWidth: element.scrollWidth }));
        (report.layoutMeasurements ||= []).push({ kind: 'questioning-overtime-clock', viewport: { width, height }, clock: clockGeometry });
        check('Desktop overtime is readable on one complete line without clipping', clockGeometry.fontSize >= 28
          && clockGeometry.height <= clockGeometry.lineHeight + 2 && clockGeometry.scrollHeight <= clockGeometry.height + 1
          && clockGeometry.scrollWidth <= clockGeometry.width + 1, { width, height, clockGeometry });
        const current = matchFor(host), seats = current.runOfShow[current.currentStageIndex].speakerSeats;
        const speakerText = await host.locator('#speaker-label').textContent();
        check('Both questioning participants retain their complete names beside overtime', seats.length === 2
          && seats.every(seat => speakerText.includes(snapshotFor(host).members.find(person => person.id === current.seats[seat]).displayName)));
      }
      const scroll = await host.locator('html').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, x: window.scrollX, y: window.scrollY }));
      check('Desktop live view has no outer page scroll at ' + width + 'x' + height,
        scroll.scrollWidth <= scroll.width + 1 && scroll.scrollHeight <= scroll.height + 1 && scroll.x === 0 && scroll.y === 0, { width, height, scroll, items });
    }
    if (width === 320) {
      const tiles = [];
      for (const selector of ['.judge-tiles .tile', '.observer-tiles .tile']) {
        const count = await host.locator(selector).count(); assert.ok(count > 0, selector + ' must contain an actual participant tile');
        for (let index = 0; index < count; index++) {
          const tile = host.locator(selector).nth(index);
          const [box, pin, initials, caption] = await Promise.all([tile.boundingBox(), tile.locator('.tile-pin').boundingBox(),
            tile.locator('.initials').boundingBox(), tile.locator('.caption').boundingBox()]);
          assert.ok(contained(pin, box) && contained(initials, box) && contained(caption, box)
            && pin.width >= 44 && pin.height >= 44 && initials.height >= 48 && caption.height > 0
            && disjoint(pin, initials) && disjoint(pin, caption) && disjoint(initials, caption), selector + ' keeps Pin, initials and caption separate');
          tiles.push({ selector, index, box, pin, initials, caption });
        }
      }
      check('Narrow adjudicator and observer tiles reserve separate Pin, initials and caption areas', true, { width, tiles });
    }
    await screenshot(host, `${imageLabel}-${width}x${height}`);
  };
  const observe = page => {
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) report.navigation.push({ actorId: actorIds.get(page),
      checkpoint: checkpoints.get(page) || 'APP_ACTIVITY', at: Date.now(), ...summarizeHostedNavigation(page.url(), origin, eventId) }); });
    page.on('pageerror', error => report.pageErrors.push({ actorId: actorIds.get(page), messageSha256: sha(error.message) }));
    page.on('console', message => { if (message.type() === 'error') { const raw = message.text();
      report.consoleErrors.push({ actorId: actorIds.get(page), message: /^Failed to load resource: the server responded with a status of \d+/.exec(raw)?.[0] || 'REDACTED_BROWSER_ERROR',
        messageSha256: sha(raw), location: (() => { try { return new URL(message.location().url).origin + new URL(message.location().url).pathname; } catch { return 'UNKNOWN'; } })(), at: Date.now() }); } });
    page.on('request', request => {
      const observation = { requestId: ++requestSequence, actorId: actorIds.get(page), requestedAt: Date.now(),
        checkpoint: checkpoints.get(page) || 'APP_ACTIVITY' };
      if (BOOTSTRAP_PATHS.has(new URL(request.url()).pathname)) observation.navigation = summarizeHostedNavigation(page.url(), origin, eventId);
      if (new URL(request.url()).pathname === '/debate-room/command') {
        const input = request.postDataJSON();
        Object.assign(observation, { command: input?.command, eventId: input?.eventId, matchId: input?.payload?.matchId, timerVersion: input?.payload?.timerVersion });
        if (input?.command === 'claim_clock') {
          observation.manualClaimId = manualClaimIntents.get(page) || null;
          report.clockClaims.push(observation);
        }
      }
      observedRequests.set(request, observation);
    });
    page.on('response', response => {
      const receivedAt = Date.now();
      const work = (async () => {
        const url = new URL(response.url());
        if (url.origin === FIXTURE_TARGET.supabaseUrl && url.pathname === '/auth/v1/token' && response.ok()) {
          const purpose = contexts.get(page.context()), session = await response.json();
          if (purpose) await lifecycle.acceptBrowserSession(purpose, session, { refreshResponse: true }); report.sessionRefreshes++; return;
        }
        if (url.origin === origin && BOOTSTRAP_PATHS.has(url.pathname)) {
          const body = await response.json().catch(() => null);
          report.bootstrap.push({ ...observedRequests.get(response.request()), receivedAt,
            ...summarizeHostedBootstrap({ pathname: url.pathname, status: response.status(),
              contentType: response.headers()['content-type'], body, headers: await response.request().allHeaders(), origin }) });
          if (response.ok()) assert.ok(body?.ok && Array.isArray(body.events));
          return;
        }
        if (url.origin !== origin || !url.pathname.startsWith('/debate-room/')) return;
        if (!['/debate-room/command', '/debate-room/claim', '/debate-room/snapshot'].includes(url.pathname)) return;
        const body = await response.json().catch(() => null); if (!body) return;
        const observation = observedRequests.get(response.request()), actorId = observation?.actorId;
        if (url.pathname === '/debate-room/command' && !response.ok()) report.commandRejections.push({ ...observation, code: body.error?.code, status: response.status(), at: receivedAt, url: response.url() });
        captured.push({ sequence: ++trafficSequence, actorId, body }); if (captured.length > 80) captured.shift();
        if (body.event && actorId === actorIds.get(page)) {
          const previous = snapshotFor(page);
          if (!previous || previous.id !== body.event.id || previous.revision <= body.event.revision) snapshots.set(page, body.event);
        }
      })(); pendingObservation.add(work); work.then(() => pendingObservation.delete(work), error => {
        pendingObservation.delete(work); report.pageErrors.push({ actorId: actorIds.get(page), observationFailureSha256: sha(String(error?.message || 'ERROR')) });
      });
    });
  };
  const waitApp = async page => {
    await page.locator('#create-event').waitFor();
    await textIncludes(page, '#account', 'Synthetic Study Room student');
    assert.equal(await page.locator('#local-actor').count(), 0);
    await pollLocator('application startup', () => page.locator('#status').textContent(), value => !['Opening Debate Room. Your microphone and camera are off.', 'Saving…'].includes(value));
  };
  const fresh = async page => {
    if (!(await page.locator('#event').isVisible())) return;
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/debate-room/snapshot' && r.request().method() === 'GET');
    const [received] = await Promise.all([response, page.locator('#refresh').click()]); const body = await received.json();
    assert.ok(body.ok && body.event, 'Refresh reads an authorized saved snapshot'); snapshots.set(page, body.event);
    await notSaving(page);
  };
  const tab = async (page, panel) => { await page.locator(`#event-tabs [data-panel="${panel}"]`).click(); await page.locator(`#panel-${panel}`).waitFor({ state: 'visible' }); };
  const command = async (page, name, click, { reject, upload } = {}) => {
    await notSaving(page);
    if (name === 'claim_clock') manualClaimIntents.set(page, ++manualClaimSequence);
    let response;
    try {
      if (upload) {
        assert.equal(name, 'share_evidence'); assert.equal(reject, undefined);
        response = await submitHostedEvidenceWithUpload({ page, origin, eventId, matchId, click, expected: upload,
          record: summary => report.evidenceUploads.push({ actorId: actorIds.get(page), at: Date.now(), ...summary }) });
      } else {
        const waiting = page.waitForResponse(response => {
          if (new URL(response.url()).pathname !== '/debate-room/command') return false;
          try { return response.request().postDataJSON()?.command === name; } catch { return false; }
        });
        [response] = await Promise.all([waiting, click()]);
      }
    } finally { if (name === 'claim_clock') manualClaimIntents.delete(page); }
    const body = await response.json(), observation = observedRequests.get(response.request());
    if (reject) {
      assert.equal(body.error?.code, reject); report.expectedRejections.push({ ...observation, command: name, code: reject, status: response.status(), at: Date.now(), url: response.url() });
      await pollLocator('the rejected action message', () => page.locator('#status').getAttribute('data-error'), value => value === 'true'); return body;
    }
    assert.equal(response.status(), 200, `${name}: ${body.error?.code || body.error?.message || response.status()}`);
    assert.ok(body.ok && body.receipt?.id && body.event, `${name} must commit through the actual service`);
    snapshots.set(page, body.event);
    if (name === 'claim_clock') {
      assert.ok(observation?.manualClaimId, 'Timer control must originate from the explicit DOM claim action');
      observation.receiptId = body.receipt.id;
    }
    report.actions.push({ command: name, actorId: actorIds.get(page), receiptId: body.receipt.id, revision: body.event.revision,
      eventId: body.event.id, matchId: response.request().postDataJSON()?.payload?.matchId || null });
    await textIncludes(page, '#status', 'Saved.');
    return body;
  };
  const submit = async (page, name, options) => {
    const body = await command(page, name, () => page.locator('#dialog-submit').click(), options);
    if (!options?.reject) await page.locator('#dialog').waitFor({ state: 'hidden' }); return body;
  };
  const open = async (page, name, title, suffix = '') => { await action(page, name, suffix).click(); await textIncludes(page, '#dialog-title', title); };
  const field = (page, name) => page.locator(`#dialog-fields [name="${name}"]`);
  const reasonAction = async (page, name, commandName, reason, suffix = '') => {
    await action(page, name, suffix).click(); await page.locator('#dialog').waitFor(); await field(page, 'reason').fill(reason); return submit(page, commandName);
  };
  const closePage = async page => {
    if (!page || page.isClosed()) return;
    const context = page.context(), purpose = contexts.get(context), storage = await context.storageState();
    const serialized = storage.origins.find(item => item.origin === origin)?.localStorage.find(item => item.name === `sb-${FIXTURE_TARGET.projectRef}-auth-token`)?.value;
    await context.close(); await Promise.allSettled([...pendingObservation]);
    if (serialized) await lifecycle.acceptBrowserSession(purpose, JSON.parse(serialized));
    contexts.delete(context); snapshots.delete(page); actorIds.delete(page); checkpoints.delete(page);
  };
  const newPage = async purpose => {
    const session = await lifecycle.sessionFor(purpose);
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: 'en-GB', acceptDownloads: true, serviceWorkers: 'block',
      storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: `sb-${FIXTURE_TARGET.projectRef}-auth-token`, value: JSON.stringify(session) }] }] } });
    contexts.set(context, purpose);
    await context.route('**/*', async route => {
      try {
      const request = route.request(), url = new URL(request.url());
      const authRoute = url.origin === FIXTURE_TARGET.supabaseUrl && ['/auth/v1/token', '/auth/v1/user'].includes(url.pathname);
      if (url.origin !== origin && !authRoute) { report.unexpectedNetwork.push({ originSha256: sha(url.origin), pathSha256: sha(url.pathname) }); return route.abort('blockedbyclient'); }
      if (url.origin === origin && url.pathname === '/debate-room/command' && request.method() === 'POST') {
        const input = request.postDataJSON();
        if (input?.command === 'create_event') await lifecycle.recordEventIntent({ title: input.payload.title, idempotencyKey: input.idempotencyKey });
      }
      if (authRoute && url.pathname === '/auth/v1/token' && request.method() === 'POST') {
        assert.equal(url.searchParams.get('grant_type'), 'refresh_token'); await lifecycle.recordBrowserRefreshIntent(purpose);
      }
      return route.continue();
      } catch (error) {
        report.pageErrors.push({ purpose, routeFailureSha256: sha(String(error?.message || 'ERROR')) });
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    const page = await context.newPage(); actorIds.set(page, session.user.id); checkpoints.set(page, 'INITIAL_BOOTSTRAP'); observe(page);
    page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
    const response = await page.goto(appUrl); assert.equal(response?.status(), 200);
    await waitApp(page); checkpoints.set(page, 'APP_ACTIVITY'); return page;
  };
  const closeGuest = async () => { await closePage(guest); guest = null; };
  const useGuest = async (id, { openEvent = true, selectedMatch = matchId } = {}) => {
    await closeGuest(); const purpose = fixtureManifest.fixtures.find(f => f.id === id)?.purpose;
    assert.ok(purpose && purpose !== 'host'); guest = await newPage(purpose);
    if (openEvent && eventId) {
      const eventNavigation = await guest.goto(`${appUrl}#${new URLSearchParams({ event: eventId, ...(selectedMatch ? { match: selectedMatch } : {}) })}`);
      if (!eventNavigation) await guest.reload();
      await textIncludes(guest, '#event-title', report.eventTitle); await fresh(guest);
    }
  };
  const assertPrivateAbsent = async (page, markers, since = 0) => {
    await Promise.all([...pendingObservation]); const html = await page.content();
    for (const marker of markers) {
      check('Private marker absent from unauthorized DOM: ' + marker, !html.includes(marker));
      const responses = captured.filter(item => item.actorId === actorIds.get(page) && item.sequence > since);
      check('Private marker absent from unauthorized snapshots: ' + marker, responses.length > 0 && responses.every(item => !JSON.stringify(item.body).includes(marker)));
    }
  };
  const waitReal = async milliseconds => {
    assert.equal(guest, null, 'Dormant participant pages must be closed during the timed flow.');
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, deadline - Date.now())));
      if (report.pageErrors.length) throw new Error('HOSTED_BROWSER_BACKGROUND_ERROR');
    }
    await fresh(host);
  };
  const fillScore = async (page, corrected = false) => {
    await tab(page, 'judge');
    check('Full scorecard exposes all 26 numeric controls', await page.locator('#score-form input[type="number"]').count() === 26);
    for (const seat of ['A1', 'A2', 'A3', 'N1', 'N2', 'N3']) for (const [criterion, maximum] of Object.entries({ evidence: 25, delivery: 30, questioning: 15, responding: 15 })) {
      const value = criterion === 'evidence' ? seat.startsWith('N') ? 20 : corrected && seat === 'A1' ? 24 : 25 : maximum;
      await page.locator(`#score-form [name="${seat}.${criterion}"]`).fill(String(value));
    }
    await page.locator('#score-form [name="closing.affirmative"]').fill('15'); await page.locator('#score-form [name="closing.negative"]').fill('12');
    await page.locator('#score-form [name="reason"]').fill(corrected ? 'Corrected one transcribed evidence mark after the recorded procedural review.' : 'Affirmative provided stronger supported cases; the panel decision is independent of the audience poll.');
    await page.locator('#score-form [name="feedback.affirmative"]').fill('CI_TEAM_A_FEEDBACK_PRIVATE');
    await page.locator('#score-form [name="feedback.negative"]').fill('CI_TEAM_N_FEEDBACK_PRIVATE');
    await page.locator('#score-form [name="notes"]').fill(PRIVATE_NOTE);
    await command(page, 'save_draft', () => page.locator('#score-form button[type="submit"]').click());
    await textIncludes(page, '#draft-status', 'Saved');
  };
  const ballot = async page => { await open(page, 'submit-ballot', 'Review final ballot'); await field(page, 'confirmed').check(); return submit(page, 'submit_ballot'); };
  const prepareMatch = async target => {
    const match = matchFor(host, target);
    for (const id of Object.values(match.seats)) {
      await useGuest(id, { selectedMatch: target }); await command(guest, 'check_in', () => guest.locator('#check-in').click());
      if (Object.values(match.captains).includes(id)) { await tab(guest, 'rules'); await command(guest, 'acknowledge_rules', () => action(guest, 'acknowledge').click()); }
    }
    await fresh(host); await tab(host, 'help');
    for (const id of Object.values(match.seats)) {
      await open(host, 'record-accommodation', 'Record approved accommodation'); await field(host, 'memberId').selectOption(id);
      await field(host, 'accommodation').fill('CI hosted control rehearsal; physical audio not verified. Organizer permits software controls rehearsal only; no microphone-tested claim.');
      await submit(host, 'record_device_check');
    }
    await tab(host, 'rules'); await command(host, 'release_motion', () => action(host, 'release-motion').click());
    await tab(host, 'overview'); check('Current match readiness is saved and rendered', matchFor(host, target).readiness.ready === true);
    await textIncludes(host, '#overview-content', 'All required readiness checks are confirmed.');
    await closeGuest();
  };
  try {
    const require = createRequire(import.meta.url), requireWorker = createRequire(path.join(ROOT, 'worker/package.json'));
    const { chromium } = require('playwright'); const { PDFDocument } = requireWorker('pdf-lib');
    browser = browserFactory ? await browserFactory() : await chromium.launch({ headless: true, channel: 'chrome', env: hostedBrowserEnvironment() });
    report.browser = { version: browser.version(), channel: 'chrome', headless: true, node: process.version, platform: process.platform };
    host = await newPage('host');
    report.eventTitle = `Hosted Debate ${fixtureManifest.runTag} main`;
    checkpoints.set(host, 'CREATE_EVENT');
    await host.locator('#create-event').click(); await field(host, 'title').fill(report.eventTitle); await field(host, 'rehearsal').check();
    await field(host, 'description').fill('Synthetic Linux CI hosted organizer control rehearsal; physical audio not verified. Real default timers, no live media or outbound email.');
    await field(host, 'visibility').selectOption('unlisted');
    const created = await submit(host, 'create_event'); eventId = created.event.id; report.eventId = eventId;
    await lifecycle.recordEvent({ id: eventId, title: report.eventTitle });
    checkpoints.set(host, 'RELOAD_OWNED_EVENT');
    await host.reload(); await textIncludes(host, '#event-title', report.eventTitle); await fresh(host);
    check('New event survives actual browser reload', snapshotFor(host).id === eventId);
    checkpoints.set(host, 'APP_ACTIVITY');
    await command(host, 'check_in', () => host.locator('#check-in').click());
    for (let index = 1; index < 10; index++) {
      await fresh(host); await tab(host, 'participants'); await open(host, 'invite', 'Create invitation');
      await field(host, 'role').selectOption(index <= 6 ? 'debater' : index <= 8 ? 'judge' : 'observer');
      await command(host, 'create_invite', () => host.locator('#dialog-submit').click());
      await textIncludes(host, '#dialog-title', 'Invitation ready'); const link = await host.locator('#dialog-fields textarea[readonly]').inputValue();
      check('Invitation contains a complete same-origin event and secret link', new URL(link).origin === origin && new URLSearchParams(new URL(link).hash.slice(1)).get('event') === eventId);
      await host.locator('#dialog-submit').click(); await host.locator('#dialog').waitFor({ state: 'hidden' });
      await useGuest(ACTOR(index), { openEvent: false });
      await guest.locator('#join-form [name="eventId"]').fill(link);
      const [claimed] = await Promise.all([guest.waitForResponse(r => new URL(r.url()).pathname === '/debate-room/claim'), guest.locator('#join-form button[type="submit"]').click()]);
      const claimBody = await claimed.json(); assert.ok(claimBody.ok); snapshots.set(guest, claimBody.event);
      report.actions.push({ command: 'claim_invite', actorId: ACTOR(index), eventId, revision: claimBody.event.revision, via: 'invitation-link DOM form' });
      await textIncludes(guest, '#overview-content', 'Waiting for the host');
      check('Unadmitted identity receives only its own waiting snapshot', claimBody.event.awaitingAdmission === true && claimBody.event.members.length === 1 && claimBody.event.matches.length === 0 && claimBody.event.motions.length === 0);
      check('Waiting participant cannot open other workspaces', await guest.locator('#event-tabs button[data-panel]:disabled').count() === 8);
      check('Waiting participant cannot open supporting room tools', await guest.locator('[data-live-tool]:disabled').count() === 4
        && await guest.locator('[data-live-tool]:visible').count() === 0 && !await guest.locator('#live-tools-dialog').isVisible());
      if (index === 9) await screenshot(guest, 'observer-waiting');
      await command(guest, 'check_in', () => guest.locator('#check-in').click());
      await fresh(host); await tab(host, 'participants'); await command(host, 'admit_member', () => action(host, 'admit', `[data-person="${ACTOR(index)}"]`).click());
      await fresh(guest); await tab(guest, 'participants');
      check('Host admission unlocks People after a real refresh', !snapshotFor(guest).awaitingAdmission && await guest.locator('#event-tabs button:disabled').count() === 0);
    }
    await fresh(host); await tab(host, 'participants');
    for (const [name, ids] of [['Affirmative CI team', [1, 2, 3]], ['Negative CI team', [4, 5, 6]]]) {
      await open(host, 'team', 'Confirm team'); await field(host, 'name').fill(name);
      for (let n = 0; n < 3; n++) await field(host, 'speaker' + (n + 1)).selectOption(ACTOR(ids[n]));
      await field(host, 'captainId').selectOption(ACTOR(ids[0])); await submit(host, 'confirm_roster');
    }
    await tab(host, 'rules');
    for (let n = 1; n <= 5; n++) {
      await open(host, 'motion', 'Add private motion'); await field(host, 'title').fill('CI motion ' + n);
      await field(host, 'text').fill(`This house would expand access to community learning resources, rehearsal motion ${n}.`); await submit(host, 'add_motion');
    }
    await tab(host, 'schedule'); await open(host, 'fixtures', 'Generate pairings'); await field(host, 'format').selectOption('round_robin'); await submit(host, 'generate_fixtures');
    await textIncludes(host, '#schedule-content', 'Review draft pairings'); await screenshot(host, 'reviewed-fixture');
    await open(host, 'publish-fixtures', 'Publish reviewed pairings'); await host.locator('#dialog-fields input[type="checkbox"]').check(); await submit(host, 'publish_fixtures');
    await open(host, 'fixture-match', 'Set up scheduled match');
    check('Published fixture fixes both teams and motion in the dialog', await field(host, 'affirmative').isDisabled() && await field(host, 'negative').isDisabled() && await field(host, 'motionId').isDisabled());
    await field(host, 'title').fill('CI default complete fixture match'); await field(host, 'judge1').selectOption(ACTOR(0));
    const madeMatch = await submit(host, 'create_match'); matchId = madeMatch.receipt.result.matchId; report.matchId = matchId;
    await tab(host, 'overview'); await command(host, 'start_match', () => action(host, 'start-match').click(), { reject: 'MATCH_NOT_READY' });
    await prepareMatch(matchId); await screenshot(host, 'ready-with-explicit-accommodations');
    await command(host, 'start_match', () => action(host, 'start-match').click()); await tab(host, 'live');
    assertHostedDefaultRunOfShow(matchFor(host).runOfShow);
    check('Independent V3 oracle confirms every default stage, question pair and duration', true);
    await checkLiveMediaLayout(1365, 768); await checkLiveMediaLayout(1280, 720); await checkLiveMediaLayout(1920, 1080); await checkLiveMediaLayout(320); await host.setViewportSize({ width: 1365, height: 900 }); await checkLiveToolPanels();
    check('Default preparation loads READY for 15 minutes', matchFor(host).timer.state === 'READY' && matchFor(host).timer.durationMs === 900000);
    const first = matchFor(host), aCaptain = first.captains.affirmative, nCaptain = first.captains.negative;
    await useGuest(aCaptain); await tab(guest, 'live'); await guest.locator('[data-live-tool=conversation]').click(); await guest.locator('#channel').selectOption('team');
    await guest.locator('#message-form textarea').fill(PRIVATE_TEAM); await command(guest, 'send_message', () => guest.locator('#message-form button[type="submit"]').click());
    await textIncludes(guest, '#messages', PRIVATE_TEAM);
    const privateCutoff = trafficSequence; await useGuest(nCaptain); await tab(guest, 'live'); await guest.locator('[data-live-tool=conversation]').click(); await guest.locator('#channel').selectOption('team');
    await assertPrivateAbsent(guest, [PRIVATE_TEAM], privateCutoff);
    await guest.locator('#message-form textarea').fill('CI negative team preparation'); await command(guest, 'send_message', () => guest.locator('#message-form button[type="submit"]').click());
    await guest.locator('#live-tools-close').click(); await guest.locator('[data-live-tool=evidence]').click();
    await guest.locator('#evidence-form [name="title"]').fill('Synthetic community reference');
    await guest.locator('#evidence-form [name="sourceUrl"]').fill('https://example.test/not-fetched-ci-evidence');
    await guest.locator('#evidence-form [name="description"]').fill('Synthetic PDF and link metadata; external source fetch is forbidden in this rehearsal.');
    const evidencePdf = await PDFDocument.create(); evidencePdf.addPage([300, 200]).drawText('Synthetic hosted Debate evidence.');
    const evidenceBytes = Buffer.from(await evidencePdf.save());
    await guest.locator('#evidence-form [name="file"]').setInputFiles({ name: 'hosted-control-evidence.pdf', mimeType: 'application/pdf', buffer: evidenceBytes });
    await command(guest, 'share_evidence', () => guest.locator('#evidence-form button[type="submit"]').click(),
      { upload: { mimeType: 'application/pdf', size: evidenceBytes.length, sha256: sha(evidenceBytes) } });
    await fresh(host); await tab(host, 'live'); await host.locator('[data-live-tool=evidence]').click(); await textIncludes(host, '#evidence-list', 'Synthetic community reference'); await host.locator('#live-tools-close').click();
    const storedEvidence = matchFor(host).evidence.find(item => item.title === 'Synthetic community reference');
    check('Actual hosted upload retains a verified PDF digest', storedEvidence?.attachment?.digest === sha(evidenceBytes) && storedEvidence.attachment.size === evidenceBytes.length);
    await closeGuest();
    await command(host, 'enter_space', () => host.locator('#join-media').click(), { reject: 'MEDIA_UNCONFIGURED' });
    for (;;) {
      const current = matchFor(host); if (current.phase === 'deliberation') break;
      const stage = current.runOfShow[current.currentStageIndex];
      assert.equal(current.currentStageIndex, report.stages.length);
      assert.equal(stage.id, HOSTED_DEFAULT_TIMED_STAGES[report.stages.length].id);
      check(stage.id + ' begins READY without automatic start', current.timer.state === 'READY');
      await textIncludes(host, '#clock-status', 'READY');
      await command(host, 'claim_clock', () => action(host, 'claim-clock').click());
      await command(host, 'timer', () => action(host, 'timer', '[data-type="START"]').click()); await textIncludes(host, '#clock-status', 'RUNNING');
      if (stage.id === 'stage-01') {
        await waitReal(1234); await command(host, 'claim_clock', () => action(host, 'claim-clock').click());
        await command(host, 'timer', () => action(host, 'timer', '[data-type="PAUSE"]').click()); await textIncludes(host, '#clock-status', 'PAUSED');
        const paused = matchFor(host).timer.elapsedBeforeRunMs; await waitReal(5000);
        check('Paused browser clock preserves elapsed time', matchFor(host).timer.elapsedBeforeRunMs === paused);
        await command(host, 'claim_clock', () => action(host, 'claim-clock').click()); await command(host, 'timer', () => action(host, 'timer', '[data-type="RESUME"]').click());
      }
      await waitReal(stage.durationMs + 1100); await host.locator('#clock.overtime').waitFor();
      check(stage.id + ' runs into visible overtime without auto-advance', matchFor(host).timer.state === 'RUNNING' && matchFor(host).runOfShow[matchFor(host).currentStageIndex].id === stage.id);
      if (stage.id === 'stage-02') {
        await checkLiveMediaLayout(1365, 768, 'questioning-overtime'); await checkLiveMediaLayout(1280, 720, 'questioning-overtime');
        await host.setViewportSize({ width: 1365, height: 900 }); await screenshot(host, 'questioning-overtime');
      }
      await command(host, 'claim_clock', () => action(host, 'claim-clock').click());
      await command(host, 'timer', () => action(host, 'timer', '[data-type="FINISH"]').click()); await textIncludes(host, '#clock-status', 'FINISHED');
      const finished = matchFor(host), attempt = finished.attempts.find(item => item.id === finished.timer.stageAttemptId);
      const stageEvidence = assertHostedFinishedAttempt(attempt, report.stages.length, finished.seats);
      assert.equal(finished.timer.durationMs, stageEvidence.durationMs); assert.equal(finished.timer.elapsedBeforeRunMs, stageEvidence.elapsedMs);
      report.stages.push(stageEvidence);
      await command(host, 'next_stage', () => action(host, 'next-stage').click());
    }
    check('All fourteen speaking stages and both preparation periods completed through the DOM', report.stages.filter(s => s.id.startsWith('stage-')).length === 14 && report.stages.some(s => s.id === 'preparation') && report.stages.some(s => s.id === 'closing-break'));
    await fillScore(host); await textIncludes(host, '#score-preview', 'Affirmative 100.00 · Negative 92.00');
    await host.reload(); await textIncludes(host, '#event-title', report.eventTitle); await fresh(host); await tab(host, 'judge');
    check('Private judge draft restores after a real page reload', await host.locator('#score-form [name="notes"]').inputValue() === PRIVATE_NOTE);
    const draftCutoff = trafficSequence; await useGuest(ACTOR(9)); await tab(guest, 'judge');
    check('Observer has no private score form', await guest.locator('#score-form').count() === 0); await assertPrivateAbsent(guest, [PRIVATE_NOTE, PRIVATE_TEAM], draftCutoff);
    await fresh(host); await tab(host, 'judge'); await command(host, 'open_ballots', () => action(host, 'open-ballots').click());
    await ballot(host); await command(host, 'close_ballots', () => action(host, 'close-ballots').click());
    await open(host, 'nominate', 'Nominate Best Debater'); await field(host, 'seat').selectOption('A2'); await field(host, 'reason').fill('A2 provided the strongest responsive case across the observed synthetic speaking opportunities.'); await submit(host, 'nominate_award');
    await tab(host, 'vote'); await command(host, 'open_poll', () => action(host, 'open-poll').click());
    await fresh(guest); await tab(guest, 'vote'); await command(guest, 'vote', () => action(guest, 'vote', '[data-side="affirmative"]').click());
    await command(guest, 'withdraw_vote', () => action(guest, 'withdraw-vote').click()); await command(guest, 'vote', () => action(guest, 'vote', '[data-side="negative"]').click());
    await fresh(host); await command(host, 'close_poll', () => action(host, 'close-poll').click()); await command(host, 'publish_poll', () => action(host, 'publish-poll').click());
    await textIncludes(host, '#vote-content', '1 of 1 eligible observers');
    check('Audience Choice records one current negative vote', matchFor(host).poll.result.validVotes === 1 && matchFor(host).poll.result.winner === 'negative');
    await tab(host, 'results'); await open(host, 'publish-result', 'Publish provisional result'); await submit(host, 'publish_result');
    const originalResult = structuredClone(matchFor(host).resultVersions.at(-1));
    await command(host, 'finalize_result', () => action(host, 'finalize-result').click(), { reject: 'CORRECTION_WINDOW_OPEN' });
    await useGuest(aCaptain); await tab(guest, 'results'); await reasonAction(guest, 'protest', 'protest_result', 'CI procedural review: verify the transcription of A1 evidence before finalization.');
    await fresh(host); await reasonAction(host, 'resolve-protest', 'resolve_protest', 'Reviewed with the panel; correct the single transcribed mark through a new ballot round.');
    await reasonAction(host, 'correct-result', 'correct_result', 'Preserve the previous result and reopen the panel for the documented transcription correction.');
    check('Correction preserves a superseded published version', matchFor(host).resultVersions.some(r => r.id === originalResult.id && r.state === 'SUPERSEDED'));
    await fillScore(host, true); await command(host, 'open_ballots', () => action(host, 'open-ballots').click()); await ballot(host); await command(host, 'close_ballots', () => action(host, 'close-ballots').click());
    await tab(host, 'results'); await open(host, 'publish-result', 'Publish provisional result'); await submit(host, 'publish_result');
    await closeGuest(); await waitReal(900001); await command(host, 'finalize_result', () => action(host, 'finalize-result').click());
    const final = structuredClone(matchFor(host).resultVersions.at(-1)); report.finalResult = { id: final.id, revision: final.revision, state: final.state, winner: final.winner };
    check('Corrected final version retains independent judging and nominated award', final.state === 'FINAL' && final.id !== originalResult.id && final.winner === 'affirmative' && final.awards.bestDebater.winners.includes('A2'));
    report.finalAwards = assertHostedCorrectedAwards(final);
    check('All four corrected awards match the independent score and nomination expectations', true);
    await textIncludes(host, '#result-summary', '99.67'); await screenshot(host, 'corrected-final-result');
    await host.setViewportSize({ width: 320, height: 800 });
    // Browser layout metrics are a read-only protocol observation, requiring no
    // injected page JavaScript and no CSP bypass in this CI-owned browser.
    const layoutSession = await host.context().newCDPSession(host);
    try {
      const layout = await layoutSession.send('Page.getLayoutMetrics');
      check('Final results fit a narrow viewport without page-level overflow', layout.cssContentSize.width <= layout.cssLayoutViewport.clientWidth + 1);
    } finally { await layoutSession.detach(); }
    await screenshot(host, 'narrow-final-result'); await host.setViewportSize({ width: 1365, height: 900 });
    for (const [kind, panel] of [['rules', 'rules'], ['scorecard', 'judge'], ['result', 'results'], ['event_report', 'schedule'], ['csv', 'results'], ['certificate', 'results']]) {
      await tab(host, panel); let exported;
      if (kind === 'certificate') {
        await open(host, 'export', 'Issue certificate', '[data-kind="certificate"]'); await field(host, 'participantId').selectOption(matchFor(host).seats.A2); await field(host, 'awardKey').selectOption('bestDebater'); exported = await submit(host, 'create_export');
      } else exported = await command(host, 'create_export', () => action(host, 'export', `[data-kind="${kind}"]`).click());
      const jobId = exported.receipt.result.jobId; await tab(host, 'results');
      const [file] = await Promise.all([host.waitForEvent('download'), action(host, 'download', `[data-download="${jobId}"]`).click()]);
      assert.equal(await file.failure(), null); const suggested = file.suggestedFilename(); assert.match(suggested, /^[^/\\\r\n]+$/);
      const relative = `downloads/${kind}-${suggested}`; await file.saveAs(path.join(OUTPUT, relative)); const bytes = await readFile(path.join(OUTPUT, relative));
      const extension = kind === 'csv' ? 'csv' : 'pdf'; const stored = await lifecycle.readStoredExport({ eventId, jobId, format: extension });
      check(kind + ' browser download matches the real generated artifact', bytes.length > 0 && sha(bytes) === sha(stored));
      const pages = extension === 'pdf' ? (assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'), (await PDFDocument.load(bytes)).getPageCount()) : null;
      if (pages !== null) check(kind + ' has a parseable nonempty PDF', pages > 0); else check('CSV has actual rows', bytes.toString('utf8').split(/\r?\n/).length > 2);
      const visibleJob = snapshotFor(host).outbox.find(j => j.id === jobId); assertHostedExportVersion(kind, visibleJob, final);
      check(kind + ' export preserves its required result-version binding', true);
      report.downloads.push({ kind, jobId, file: relative, bytes: bytes.length, sha256: sha(bytes), pages, resultVersion: visibleJob.resultVersion });
    }
    const resultPrivacyCutoff = trafficSequence; await useGuest(ACTOR(9)); await tab(guest, 'results');
    check('Observer cannot download another actor’s private exports', await guest.locator('[data-action="download"]').count() === 0);
    await assertPrivateAbsent(guest, [PRIVATE_NOTE, PRIVATE_TEAM, 'CI_TEAM_A_FEEDBACK_PRIVATE', 'CI_TEAM_N_FEEDBACK_PRIVATE'], resultPrivacyCutoff);
    await fresh(host); await tab(host, 'schedule'); await textIncludes(host, '#schedule-content', 'Final'); await screenshot(host, 'final-fixture-and-standings');
    const beforeNext = await lifecycle.readEvent(eventId), savedFirst = structuredClone(beforeNext.matches[matchId]);
    assert.deepEqual(savedFirst.attempts.filter(attempt => attempt.stageId !== 'deliberation').map((attempt, index) =>
      assertHostedFinishedAttempt(attempt, index, savedFirst.seats)), report.stages);
    for (const download of report.downloads) assertHostedExportVersion(download.kind, beforeNext.jobs[download.jobId], final);
    check('Independent saved-state readback retains every stage duration and current export version', true);
    const nextMotion = Object.values(beforeNext.motions).find(motion => motion.id !== savedFirst.motionId && motion.releasedAt == null);
    assert.ok(nextMotion, 'The next match requires a separate still-private prepared motion.');
    await open(host, 'match', 'Set up match'); await field(host, 'title').fill('CI next formal three-judge match');
    await field(host, 'motionId').selectOption(nextMotion.id);
    for (const [name, id] of [['judge1', ACTOR(0)], ['judge2', ACTOR(7)], ['judge3', ACTOR(8)]]) await field(host, name).selectOption(id);
    const nextCreated = await submit(host, 'create_match'), nextId = nextCreated.receipt.result.matchId; report.nextMatchId = nextId;
    const createdNext = await lifecycle.readEvent(eventId);
    assertHostedNextMatchState(createdNext.matches[nextId], savedFirst, nextMotion.id);
    assertHostedPriorMatchPreserved(savedFirst, createdNext.matches[matchId]);
    assert.equal(createdNext.motions[nextMotion.id].releasedAt, null);
    const privateNextCutoff = trafficSequence; await useGuest(ACTOR(9), { selectedMatch: nextId });
    check('Next motion remains absent from an admitted observer before its own release', !snapshotFor(guest).motions.some(motion => motion.id === nextMotion.id));
    await assertPrivateAbsent(guest, [nextMotion.text], privateNextCutoff);
    await action(host, 'select-match', `[data-match="${nextId}"]`).click(); await host.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('match') === nextId);
    await prepareMatch(nextId); await tab(host, 'schedule'); await command(host, 'advance_match', () => action(host, 'advance-match', `[data-match="${nextId}"]`).click());
    await tab(host, 'overview'); await command(host, 'start_match', () => action(host, 'start-match').click());
    const afterNext = await lifecycle.readEvent(eventId);
    assertHostedPriorMatchPreserved(savedFirst, afterNext.matches[matchId]);
    assertHostedNextMatchState(afterNext.matches[nextId], savedFirst, nextMotion.id, { started: true });
    assert.deepEqual(afterNext.motions[savedFirst.motionId], beforeNext.motions[savedFirst.motionId]);
    assert.equal(afterNext.motions[nextMotion.id].releasedAt, afterNext.matches[nextId].motionReleasedAt);
    check('Next three-judge match starts cleanly on its own motion without changing any prior match record', afterNext.activeMatchId === nextId && afterNext.matches[nextId].judgeIds.length === 3);
    report.nextMatchIsolation = { priorMatchId: matchId, nextMatchId: nextId, priorMotionId: savedFirst.motionId,
      nextMotionId: nextMotion.id, nextMotionReleasedAt: afterNext.matches[nextId].motionReleasedAt,
      entirePriorMatchPreserved: true, newMatchRecordsClean: true };
    await tab(host, 'live'); await textIncludes(host, '#clock-status', 'READY'); await screenshot(host, 'next-match-ready');
    check('Actual saved first match has all fourteen finished speaking attempts', afterNext.matches[matchId].attempts.filter(a => a.stageId.startsWith('stage-') && a.state === 'FINISHED').length === 14);
    check('Fixture finalization recorded its exact saved winner', afterNext.fixtures.some(f => f.matchId === matchId && f.status === 'FINAL' && f.resultId === final.id));
    await Promise.all([...pendingObservation]);
    check('No unexpected application network destinations', report.unexpectedNetwork.length === 0);
    check('No uncaught browser JavaScript errors', report.pageErrors.length === 0);
    check('Every command rejection has an exact expected request and error code', report.commandRejections.every(rejection => report.expectedRejections.some(expected => expected.requestId === rejection.requestId && expected.code === rejection.code && expected.status === rejection.status)));
    check('Every timer claim came from an explicit DOM action and committed receipt', report.clockClaims.length > 0 && report.clockClaims.every(claim => claim.manualClaimId && claim.receiptId));
    for (const error of report.consoleErrors) error.expectedResourceRejection = /^Failed to load resource: the server responded with a status of \d+/i.test(error.message)
      && report.expectedRejections.some(rejection => rejection.actorId === error.actorId && rejection.url === error.location && Math.abs(error.at - rejection.at) <= 1500 && error.message.includes(String(rejection.status)));
    check('No unexpected browser console errors', report.consoleErrors.every(error => error.expectedResourceRejection === true));
    check('At most two pages are open', [...contexts.keys()].reduce((n, context) => n + context.pages().length, 0) <= 2);
    check('Actual main Worker JSON bootstrap includes events and discover', [...BOOTSTRAP_PATHS].every(route => report.bootstrap.some(item => item.path === route && item.status === 200 && item.ok === true && item.contentType === 'application/json')));
    check('Every hosted bootstrap request succeeds', report.bootstrap.every(item => item.status === 200 && item.ok === true));
    check('The unchanged default timetable totals 78 minutes before judging', report.stages.reduce((sum, stage) => sum + stage.durationMs, 0) === report.defaultFlowDurationMs);
    check('Real hosted control rehearsal spans at least 93 minutes', Date.now() - started >= 5580000);
    report.claims.controlEndurance90Minutes = true;
    report.status = 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY';
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.code || '') ? error.code : 'HOSTED_BROWSER_JOURNEY_FAILED',
      messageSha256: sha(String(error?.message || 'ERROR')) };
  } finally {
    for (const context of [...contexts.keys()]) {
      try { for (const page of context.pages()) await closePage(page); }
      catch { report.status = 'FAIL'; report.sessionCloseFailure = true; }
    }
    await browser?.close().catch(() => { report.status = 'FAIL'; report.browserCloseFailure = true; });
    await Promise.allSettled([...pendingObservation]);
    finalizeHostedBrowserShutdown(report);
    report.finishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started;
    await writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (report.status !== 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY') throw Object.assign(new Error('HOSTED_BROWSER_JOURNEY_FAILED'), { code: 'HOSTED_BROWSER_JOURNEY_FAILED' });
  return report;
}
