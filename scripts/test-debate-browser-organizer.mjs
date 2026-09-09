/** CI-owned browser only: actual DOM -> HTTP -> service -> disposable SQL -> DOM. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'artifacts/debate-local-rehearsal/browser-organizer-ci');
const sha = value => createHash('sha256').update(value).digest('hex');
const PRIVATE_NOTE = 'CI_JUDGE_PRIVATE_NOTE_DO_NOT_DISCLOSE';
const PRIVATE_TEAM = 'CI_AFFIRMATIVE_PRIVATE_STRATEGY_DO_NOT_DISCLOSE';
const ACTOR = index => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

export function assertCiExecution({ platform = process.platform, env = process.env } = {}) {
  assert.equal(platform, 'linux', 'This test may launch a browser only on an isolated Linux CI runner, never the user desktop.');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'A GitHub Actions runner is required.');
  assert.equal(env.DEBATE_SYNTHETIC_BROWSER_CI, '1', 'Explicit DEBATE_SYNTHETIC_BROWSER_CI=1 is required.');
}

export async function runBrowserOrganizer() {
  assertCiExecution();
  // Refuse to overwrite any previous run or reuse its database/browser profile.
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await mkdir(OUTPUT);
  await mkdir(path.join(OUTPUT, 'screenshots'));
  await mkdir(path.join(OUTPUT, 'downloads'));
  const started = Date.now();
  const report = {
    kind: 'ISOLATED_CI_SYNTHETIC_BROWSER_ORGANIZER', state: 'RUNNING', startedAt: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    testSha256: sha(await readFile(fileURLToPath(import.meta.url))), checks: [], actions: [], stages: [], downloads: [], screenshots: [],
    unexpectedNetwork: [], pageErrors: [], consoleErrors: [], expectedRejections: [], commandRejections: [],
    simulatedLeaseExpiries: [], clockClaims: [],
    claims: { actualBrowserDom: true, actualLocalSql: true, syntheticIdentity: true, actualHostedAuth: false,
      mainWorkerBootstrap: false, studyRoomUi: false, physicalMedia: false, providerMedia: false,
      realEmail: false, nativePostgresConcurrency: false, endurance90Minutes: false, hostedDeployment: false },
    gaps: ['Local HTML deliberately replaces hosted auth and removes provider scripts; this is not the main Worker or real Supabase sign-in path.',
      'Study Room UI has a separate test; Debate waiting state does not prove Study admission.',
      'No microphone, camera, provider, real email, native multi-connection Postgres, 90-minute endurance or hosted deployment is exercised.',
      'The next three-judge match is started, not played to another final decision; tournament awards remain rehearsal-excluded.',
      'PDF signatures, page counts and exact downloaded bytes are checked; PDF page layout requires the separate visual export review.'],
  };
  const check = (name, condition, detail = {}) => { assert.ok(condition, name); report.checks.push({ name, status: 'PASS', ...detail }); };
  let server, browser, host, guest, origin, eventId, matchId;
  const contexts = [], snapshots = new Map(), actorIds = new Map(), captured = [];
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
    page.on('pageerror', error => report.pageErrors.push({ actorId: actorIds.get(page), message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ actorId: actorIds.get(page), message: message.text(), location: message.location().url, at: Date.now() }); });
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
      })(); pendingObservation.add(work); work.finally(() => pendingObservation.delete(work));
    });
  };
  const waitApp = async page => {
    await page.locator('#create-event').waitFor();
    await textIncludes(page, '#account', '(local rehearsal)');
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
      const expiry = report.simulatedLeaseExpiries.findLast(item => !item.manualRecovery && item.actorId === observation.actorId && item.eventId === observation.eventId && item.matchId === observation.matchId);
      if (expiry) {
        const timer = body.event.matches.find(match => match.id === expiry.matchId)?.timer;
        check('Explicit DOM claim restores control after synthetic lease expiry', expiry.verifiedExpired && observation.requestedAt >= expiry.startedAt && observation.timerVersion === expiry.timerVersion
          && timer?.controllerId === expiry.actorId && timer.version === expiry.timerVersion + 1 && timer.leaseExpiresAtServerMs > server.now(), { expiryId: expiry.id, receiptId: body.receipt.id });
        expiry.manualRecovery = { requestId: observation.requestId, requestedAt: observation.requestedAt, at: Date.now(), receiptId: body.receipt.id, timerVersion: timer.version };
      }
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
  const useGuest = async (id, { openEvent = true, selectedMatch = matchId } = {}) => {
    const lobbyNavigation = await guest.goto(server.url);
    if (!lobbyNavigation) await guest.reload();
    await waitApp(guest);
    if (await guest.locator('#local-actor').inputValue() !== id) {
      actorIds.set(guest, id); snapshots.delete(guest);
      await Promise.all([guest.waitForNavigation({ waitUntil: 'domcontentloaded' }), guest.locator('#local-actor').selectOption(id)]);
      await waitApp(guest);
    }
    actorIds.set(guest, id);
    if (openEvent && eventId) {
      const eventNavigation = await guest.goto(`${server.url}#${new URLSearchParams({ event: eventId, ...(selectedMatch ? { match: selectedMatch } : {}) })}`);
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
  const advance = async milliseconds => {
    // The sole non-DOM state adjustment is explicit elapsed test time, never a competition command.
    const before = await server.store.read(eventId), timer = before.matches[matchId]?.timer, beforeServerMs = server.now();
    let expiry;
    if (timer?.controllerId && timer.leaseExpiresAtServerMs > beforeServerMs && timer.leaseExpiresAtServerMs <= beforeServerMs + milliseconds) {
      expiry = { id: report.simulatedLeaseExpiries.length + 1, actorId: timer.controllerId, eventId, matchId,
        stageAttemptId: timer.stageAttemptId, timerVersion: timer.version, leaseExpiresAtServerMs: timer.leaseExpiresAtServerMs,
        beforeServerMs, milliseconds, startedAt: Date.now(), verifiedExpired: false };
      report.simulatedLeaseExpiries.push(expiry);
    }
    const afterServerMs = await server.advance(milliseconds); await fresh(host);
    if (expiry) {
      const saved = (await server.store.read(eventId)).matches[matchId].timer;
      check('Synthetic time jump expires the saved lease without renewing or claiming control', saved.controllerId === expiry.actorId && saved.version === expiry.timerVersion
        && saved.leaseExpiresAtServerMs === expiry.leaseExpiresAtServerMs && saved.leaseExpiresAtServerMs <= afterServerMs, { expiryId: expiry.id });
      Object.assign(expiry, { afterServerMs, verifiedExpired: true });
    }
    report.simulatedAdvanceMs = (report.simulatedAdvanceMs || 0) + milliseconds;
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
      await field(host, 'accommodation').fill('Explicit synthetic CI software rehearsal: no physical microphone or provider test; official permits this local exercise only.');
      await submit(host, 'record_device_check');
    }
    await tab(host, 'rules'); await command(host, 'release_motion', () => action(host, 'release-motion').click());
    await tab(host, 'overview'); check('Current match readiness is saved and rendered', matchFor(host, target).readiness.ready === true);
    await textIncludes(host, '#overview-content', 'All required readiness checks are confirmed.');
  };
  try {
    const require = createRequire(import.meta.url), requireWorker = createRequire(path.join(ROOT, 'worker/package.json'));
    const { chromium } = require('playwright'); const { PDFDocument } = requireWorker('pdf-lib');
    const { startLocalDebateServer } = await import('./serve-debate-rehearsal.mjs');
    server = await startLocalDebateServer({ port: 0, storeMode: 'pglite', outputDir: path.join(OUTPUT, 'runtime') });
    origin = new URL(server.url).origin; report.sourceHashes = server.manifest.sourceHashes; report.serverUrl = server.url;
    await writeFile(path.join(OUTPUT, 'manifest.json'), await readFile(path.join(server.outputDir, 'manifest.json')));
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    report.browser = { version: browser.version(), channel: 'chrome', headless: true, node: process.version, platform: process.platform };
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: 'en-GB', acceptDownloads: true, serviceWorkers: 'block' });
      contexts.push(context); await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { report.unexpectedNetwork.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); }
        return route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
      actorIds.set(page, ACTOR(0)); observe(page); if (index === 0) host = page; else guest = page;
    }
    await host.goto(server.url); await waitApp(host);
    report.eventTitle = 'CI full browser Debate ' + new Date().toISOString();
    await host.locator('#create-event').click(); await field(host, 'title').fill(report.eventTitle); await field(host, 'rehearsal').check();
    await field(host, 'description').fill('Clearly synthetic Linux browser rehearsal using actual local SQL; no media or outbound email.');
    await field(host, 'visibility').selectOption('public');
    const created = await submit(host, 'create_event'); eventId = created.event.id; report.eventId = eventId;
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
    await guest.locator('#evidence-form [name="description"]').fill('Link metadata only; external fetch is forbidden in this rehearsal.');
    await command(guest, 'share_evidence', () => guest.locator('#evidence-form button[type="submit"]').click());
    await fresh(host); await tab(host, 'live'); await textIncludes(host, '#evidence-list', 'Synthetic community reference');
    for (;;) {
      const current = matchFor(host); if (current.phase === 'deliberation') break;
      const stage = current.runOfShow[current.currentStageIndex];
      check(stage.id + ' begins READY without automatic start', current.timer.state === 'READY');
      await textIncludes(host, '#clock-status', 'READY');
      await command(host, 'claim_clock', () => action(host, 'claim-clock').click());
      await command(host, 'timer', () => action(host, 'timer', '[data-type="START"]').click()); await textIncludes(host, '#clock-status', 'RUNNING');
      if (stage.id === 'stage-01') {
        await advance(1234); await command(host, 'claim_clock', () => action(host, 'claim-clock').click());
        await command(host, 'timer', () => action(host, 'timer', '[data-type="PAUSE"]').click()); await textIncludes(host, '#clock-status', 'PAUSED');
        const paused = matchFor(host).timer.elapsedBeforeRunMs; await advance(5000);
        check('Paused browser clock preserves elapsed time', matchFor(host).timer.elapsedBeforeRunMs === paused);
        await command(host, 'claim_clock', () => action(host, 'claim-clock').click()); await command(host, 'timer', () => action(host, 'timer', '[data-type="RESUME"]').click());
      }
      await advance(stage.durationMs + 1100); await host.locator('#clock.overtime').waitFor();
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
    await advance(900001); await command(host, 'finalize_result', () => action(host, 'finalize-result').click());
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
      const extension = kind === 'csv' ? 'csv' : 'pdf'; const stored = await readFile(path.join(server.outputDir, 'exports', eventId, jobId + '.' + extension));
      check(kind + ' browser download matches the real generated artifact', bytes.length > 0 && sha(bytes) === sha(stored));
      const pages = extension === 'pdf' ? (assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'), (await PDFDocument.load(bytes)).getPageCount()) : null;
      if (pages !== null) check(kind + ' has a parseable nonempty PDF', pages > 0); else check('CSV has actual rows', bytes.toString('utf8').split(/\r?\n/).length > 2);
      report.downloads.push({ kind, jobId, file: relative, bytes: bytes.length, sha256: sha(bytes), pages, resultVersion: snapshotFor(host).outbox.find(j => j.id === jobId)?.resultVersion });
    }
    const resultPrivacyCutoff = trafficSequence; await useGuest(ACTOR(9)); await tab(guest, 'results');
    check('Observer cannot download another actor’s private exports', await guest.locator('[data-action="download"]').count() === 0);
    await assertPrivateAbsent(guest, [PRIVATE_NOTE, PRIVATE_TEAM, 'CI_TEAM_A_FEEDBACK_PRIVATE', 'CI_TEAM_N_FEEDBACK_PRIVATE'], resultPrivacyCutoff);
    await fresh(host); await tab(host, 'schedule'); await textIncludes(host, '#schedule-content', 'Final'); await screenshot(host, 'final-fixture-and-standings');
    const beforeNext = await server.store.read(eventId); const savedFirst = JSON.stringify({ attempts: beforeNext.matches[matchId].attempts, results: beforeNext.matches[matchId].resultVersions });
    await open(host, 'match', 'Set up match'); await field(host, 'title').fill('CI next formal three-judge match');
    for (const [name, id] of [['judge1', ACTOR(0)], ['judge2', ACTOR(7)], ['judge3', ACTOR(8)]]) await field(host, name).selectOption(id);
    const nextCreated = await submit(host, 'create_match'), nextId = nextCreated.receipt.result.matchId; report.nextMatchId = nextId;
    await action(host, 'select-match', `[data-match="${nextId}"]`).click(); await host.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('match') === nextId);
    await prepareMatch(nextId); await tab(host, 'schedule'); await command(host, 'advance_match', () => action(host, 'advance-match', `[data-match="${nextId}"]`).click());
    await tab(host, 'overview'); await command(host, 'start_match', () => action(host, 'start-match').click());
    const afterNext = await server.store.read(eventId);
    check('Next three-judge match starts without changing prior attempts or results', afterNext.activeMatchId === nextId && afterNext.matches[nextId].judgeIds.length === 3 && savedFirst === JSON.stringify({ attempts: afterNext.matches[matchId].attempts, results: afterNext.matches[matchId].resultVersions }));
    await tab(host, 'live'); await textIncludes(host, '#clock-status', 'READY'); await screenshot(host, 'next-match-ready');
    check('Actual saved first match has all fourteen finished speaking attempts', afterNext.matches[matchId].attempts.filter(a => a.stageId.startsWith('stage-') && a.state === 'FINISHED').length === 14);
    check('Fixture finalization recorded its exact saved winner', afterNext.fixtures.some(f => f.matchId === matchId && f.status === 'FINAL' && f.resultId === final.id));
    await Promise.all([...pendingObservation]);
    check('No unexpected application network destinations', report.unexpectedNetwork.length === 0);
    check('No uncaught browser JavaScript errors', report.pageErrors.length === 0);
    for (const rejection of report.commandRejections) {
      // A periodic renewal may race the deliberately advanced clock. Only the
      // exact expired lease, before its explicit DOM recovery, explains this 400.
      const expiry = report.simulatedLeaseExpiries.find(item => item.verifiedExpired && item.manualRecovery
        && rejection.command === 'renew_clock' && rejection.status === 400 && rejection.code === 'CONTROLLER_LEASE_REQUIRED'
        && rejection.actorId === item.actorId && rejection.eventId === item.eventId && rejection.matchId === item.matchId && rejection.timerVersion === item.timerVersion
        && rejection.requestedAt >= item.startedAt && rejection.requestedAt <= item.manualRecovery.requestedAt
        && rejection.at >= item.startedAt && rejection.at <= item.startedAt + 5000);
      if (expiry) report.expectedRejections.push({ ...rejection, reason: 'Documented synthetic jump expired this controller lease; explicit DOM claim recovered it.', expiryId: expiry.id });
    }
    check('Every command rejection has an exact expected request and error code', report.commandRejections.every(rejection => report.expectedRejections.some(expected => expected.requestId === rejection.requestId && expected.code === rejection.code && expected.status === rejection.status)));
    check('Every timer claim came from an explicit DOM action and committed receipt', report.clockClaims.length > 0 && report.clockClaims.every(claim => claim.manualClaimId && claim.receiptId));
    check('Every synthetic lease expiry recovered through an explicit DOM claim', report.simulatedLeaseExpiries.length > 0 && report.simulatedLeaseExpiries.every(expiry => expiry.verifiedExpired && expiry.manualRecovery));
    for (const error of report.consoleErrors) error.expectedResourceRejection = /^Failed to load resource: the server responded with a status of \d+/i.test(error.message)
      && report.expectedRejections.some(rejection => rejection.actorId === error.actorId && rejection.url === error.location && Math.abs(error.at - rejection.at) <= 1500 && error.message.includes(String(rejection.status)));
    check('No unexpected browser console errors', report.consoleErrors.every(error => error.expectedResourceRejection === true));
    check('At most two pages were opened', contexts.reduce((n, context) => n + context.pages().length, 0) <= 2);
    report.state = 'PASS_SYNTHETIC_BROWSER_ORGANIZER';
  } catch (error) {
    report.state = 'FAIL'; report.failure = { name: error.name, message: error.message, stack: error.stack };
    for (const [name, page] of [['host', host], ['guest', guest]]) if (page && !page.isClosed()) {
      await screenshot(page, 'failure-' + name).catch(() => {});
      await writeFile(path.join(OUTPUT, `${name}-failure-dom.html`), await page.content().catch(() => '<!-- Page unavailable -->')).catch(() => {});
    }
  } finally {
    for (let index = 0; index < contexts.length; index++) await contexts[index].tracing.stop({ path: path.join(OUTPUT, `trace-${index === 0 ? 'host' : 'guest'}.zip`) }).catch(() => {});
    await browser?.close().catch(() => {}); await server?.close().catch(error => { report.cleanupError = error.message; report.state = 'FAIL'; });
    report.finishedAt = new Date().toISOString(); report.actualDurationMs = Date.now() - started;
    await writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (server) await writeFile(path.join(OUTPUT, 'request-log.jsonl'), await readFile(path.join(server.outputDir, 'request-log.jsonl')));
  }
  console.log(JSON.stringify({ state: report.state, checks: report.checks.length, actions: report.actions.length, stages: report.stages.length, downloads: report.downloads.length, report: path.join(OUTPUT, 'report.json'), ...(report.failure ? { failure: report.failure.message } : {}) }));
  if (report.state !== 'PASS_SYNTHETIC_BROWSER_ORGANIZER') process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runBrowserOrganizer().catch(error => { console.error(error.message); process.exitCode = 1; });
