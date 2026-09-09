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
    clockClaims: [], bootstrap: [], sessionRefreshes: 0,
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
  const contexts = new Map(), snapshots = new Map(), actorIds = new Map(), captured = [];
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
  const checkLiveMediaLayout = async width => {
    await host.setViewportSize({ width, height: 900 });
    const selectors = ['.media-dock', '#arena', '.judges-rail', '#affirmative-name', '#negative-name'];
    const boxes = await Promise.all(selectors.map(selector => host.locator(selector).boundingBox()));
    check(`Live room layout exposes the media controls, arena and headings at ${width}px`, boxes.every(box => box && box.width > 0 && box.height > 0));
    const [dock, arena, ...headings] = boxes;
    check(`Media controls stay above the arena without covering team or adjudicator headings at ${width}px`, dock.y + dock.height <= arena.y + 1
      && headings.every(box => dock.y + dock.height <= box.y + 1), { width, geometry: Object.fromEntries(selectors.map((selector, index) => [selector, boxes[index]])) });
    await screenshot(host, `live-media-controls-${width}px`);
  };
  const observe = page => {
    page.on('pageerror', error => report.pageErrors.push({ actorId: actorIds.get(page), messageSha256: sha(error.message) }));
    page.on('console', message => { if (message.type() === 'error') { const raw = message.text();
      report.consoleErrors.push({ actorId: actorIds.get(page), message: /^Failed to load resource: the server responded with a status of \d+/.exec(raw)?.[0] || 'REDACTED_BROWSER_ERROR',
        messageSha256: sha(raw), location: (() => { try { return new URL(message.location().url).origin + new URL(message.location().url).pathname; } catch { return 'UNKNOWN'; } })(), at: Date.now() }); } });
    page.on('request', request => {
      const observation = { requestId: ++requestSequence, actorId: actorIds.get(page), requestedAt: Date.now() };
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
        if (url.origin === origin && ['/debate-room/events', '/debate-room/discover'].includes(url.pathname) && response.ok()) {
          const body = await response.json(); assert.ok(body.ok && Array.isArray(body.events));
          report.bootstrap.push({ actorId: actorIds.get(page), path: url.pathname, status: response.status(), contentType: response.headers()['content-type'] || null }); return;
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
  const command = async (page, name, click, { reject } = {}) => {
    await notSaving(page);
    if (name === 'claim_clock') manualClaimIntents.set(page, ++manualClaimSequence);
    const waiting = page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== '/debate-room/command') return false;
      try { return response.request().postDataJSON()?.command === name; } catch { return false; }
    });
    let response;
    try { [response] = await Promise.all([waiting, click()]); } finally { if (name === 'claim_clock') manualClaimIntents.delete(page); }
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
    contexts.delete(context); snapshots.delete(page); actorIds.delete(page);
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
    const page = await context.newPage(); actorIds.set(page, session.user.id); observe(page);
    page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
    const response = await page.goto(appUrl); assert.equal(response?.status(), 200);
    await waitApp(page); return page;
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
    await host.locator('#create-event').click(); await field(host, 'title').fill(report.eventTitle); await field(host, 'rehearsal').check();
    await field(host, 'description').fill('Synthetic Linux CI hosted organizer control rehearsal; physical audio not verified. Real default timers, no live media or outbound email.');
    await field(host, 'visibility').selectOption('unlisted');
    const created = await submit(host, 'create_event'); eventId = created.event.id; report.eventId = eventId;
    await lifecycle.recordEvent({ id: eventId, title: report.eventTitle });
    await host.reload(); await textIncludes(host, '#event-title', report.eventTitle); await fresh(host);
    check('New event survives actual browser reload', snapshotFor(host).id === eventId);
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
      check('Waiting participant cannot open other workspaces', await guest.locator('#event-tabs button:disabled').count() === 8);
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
    await tab(host, 'schedule'); await open(host, 'fixtures', 'Generate fixtures'); await field(host, 'format').selectOption('round_robin'); await submit(host, 'generate_fixtures');
    await textIncludes(host, '#schedule-content', 'Review draft fixtures'); await screenshot(host, 'reviewed-fixture');
    await open(host, 'publish-fixtures', 'Publish reviewed fixtures'); await host.locator('#dialog-fields input[type="checkbox"]').check(); await submit(host, 'publish_fixtures');
    await open(host, 'fixture-match', 'Set up published fixture');
    check('Published fixture fixes both teams and motion in the dialog', await field(host, 'affirmative').isDisabled() && await field(host, 'negative').isDisabled() && await field(host, 'motionId').isDisabled());
    await field(host, 'title').fill('CI default complete fixture match'); await field(host, 'judge1').selectOption(ACTOR(0));
    const madeMatch = await submit(host, 'create_match'); matchId = madeMatch.receipt.result.matchId; report.matchId = matchId;
    await tab(host, 'overview'); await command(host, 'start_match', () => action(host, 'start-match').click(), { reject: 'MATCH_NOT_READY' });
    await prepareMatch(matchId); await screenshot(host, 'ready-with-explicit-accommodations');
    await command(host, 'start_match', () => action(host, 'start-match').click()); await tab(host, 'live');
    await checkLiveMediaLayout(1365); await checkLiveMediaLayout(320); await host.setViewportSize({ width: 1365, height: 900 });
    check('Default preparation loads READY for 15 minutes', matchFor(host).timer.state === 'READY' && matchFor(host).timer.durationMs === 900000);
    const first = matchFor(host), aCaptain = first.captains.affirmative, nCaptain = first.captains.negative;
    await useGuest(aCaptain); await tab(guest, 'live'); await guest.locator('#channel').selectOption('team');
    await guest.locator('#message-form textarea').fill(PRIVATE_TEAM); await command(guest, 'send_message', () => guest.locator('#message-form button[type="submit"]').click());
    await textIncludes(guest, '#messages', PRIVATE_TEAM);
    const privateCutoff = trafficSequence; await useGuest(nCaptain); await tab(guest, 'live'); await guest.locator('#channel').selectOption('team');
    await assertPrivateAbsent(guest, [PRIVATE_TEAM], privateCutoff);
    await guest.locator('#message-form textarea').fill('CI negative team preparation'); await command(guest, 'send_message', () => guest.locator('#message-form button[type="submit"]').click());
    await guest.locator('#evidence-form [name="title"]').fill('Synthetic community reference');
    await guest.locator('#evidence-form [name="sourceUrl"]').fill('https://example.test/not-fetched-ci-evidence');
    await guest.locator('#evidence-form [name="description"]').fill('Synthetic PDF and link metadata; external source fetch is forbidden in this rehearsal.');
    const evidencePdf = await PDFDocument.create(); evidencePdf.addPage([300, 200]).drawText('Synthetic hosted Debate evidence.');
    const evidenceBytes = Buffer.from(await evidencePdf.save());
    await guest.locator('#evidence-form [name="file"]').setInputFiles({ name: 'hosted-control-evidence.pdf', mimeType: 'application/pdf', buffer: evidenceBytes });
    await command(guest, 'share_evidence', () => guest.locator('#evidence-form button[type="submit"]').click());
    await fresh(host); await tab(host, 'live'); await textIncludes(host, '#evidence-list', 'Synthetic community reference');
    const storedEvidence = matchFor(host).evidence.find(item => item.title === 'Synthetic community reference');
    check('Actual hosted upload retains a verified PDF digest', storedEvidence?.attachment?.digest === sha(evidenceBytes) && storedEvidence.attachment.size === evidenceBytes.length);
    await closeGuest();
    await command(host, 'enter_space', () => host.locator('#join-media').click(), { reject: 'MEDIA_UNCONFIGURED' });
    for (;;) {
      const current = matchFor(host); if (current.phase === 'deliberation') break;
      const stage = current.runOfShow[current.currentStageIndex];
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
      if (stage.id === 'stage-02') await screenshot(host, 'questioning-overtime');
      await command(host, 'claim_clock', () => action(host, 'claim-clock').click());
      await command(host, 'timer', () => action(host, 'timer', '[data-type="FINISH"]').click()); await textIncludes(host, '#clock-status', 'FINISHED');
      report.stages.push({ id: stage.id, kind: stage.kind, seats: stage.speakerSeats, attemptId: matchFor(host).timer.stageAttemptId, state: 'FINISHED', durationMs: stage.durationMs });
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
      report.downloads.push({ kind, jobId, file: relative, bytes: bytes.length, sha256: sha(bytes), pages, resultVersion: snapshotFor(host).outbox.find(j => j.id === jobId)?.resultVersion });
    }
    const resultPrivacyCutoff = trafficSequence; await useGuest(ACTOR(9)); await tab(guest, 'results');
    check('Observer cannot download another actor’s private exports', await guest.locator('[data-action="download"]').count() === 0);
    await assertPrivateAbsent(guest, [PRIVATE_NOTE, PRIVATE_TEAM, 'CI_TEAM_A_FEEDBACK_PRIVATE', 'CI_TEAM_N_FEEDBACK_PRIVATE'], resultPrivacyCutoff);
    await fresh(host); await tab(host, 'schedule'); await textIncludes(host, '#schedule-content', 'Final'); await screenshot(host, 'final-fixture-and-standings');
    const beforeNext = await lifecycle.readEvent(eventId); const savedFirst = JSON.stringify({ attempts: beforeNext.matches[matchId].attempts, results: beforeNext.matches[matchId].resultVersions });
    await open(host, 'match', 'Set up match'); await field(host, 'title').fill('CI next formal three-judge match');
    for (const [name, id] of [['judge1', ACTOR(0)], ['judge2', ACTOR(7)], ['judge3', ACTOR(8)]]) await field(host, name).selectOption(id);
    const nextCreated = await submit(host, 'create_match'), nextId = nextCreated.receipt.result.matchId; report.nextMatchId = nextId;
    await action(host, 'select-match', `[data-match="${nextId}"]`).click(); await host.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('match') === nextId);
    await prepareMatch(nextId); await tab(host, 'schedule'); await command(host, 'advance_match', () => action(host, 'advance-match', `[data-match="${nextId}"]`).click());
    await tab(host, 'overview'); await command(host, 'start_match', () => action(host, 'start-match').click());
    const afterNext = await lifecycle.readEvent(eventId);
    check('Next three-judge match starts without changing prior attempts or results', afterNext.activeMatchId === nextId && afterNext.matches[nextId].judgeIds.length === 3 && savedFirst === JSON.stringify({ attempts: afterNext.matches[matchId].attempts, results: afterNext.matches[matchId].resultVersions }));
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
    check('Actual main Worker JSON bootstrap includes events and discover', ['/debate-room/events', '/debate-room/discover'].every(route => report.bootstrap.some(item => item.path === route && item.contentType.includes('application/json'))));
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
