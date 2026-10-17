import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCiExecution, hostedBrowserEnvironment, finalizeHostedBrowserShutdown, HOSTED_DEFAULT_TIMED_STAGES,
  assertHostedDefaultRunOfShow, assertHostedFinishedAttempt, assertHostedCorrectedAwards, assertHostedExportVersion,
  assertHostedNextMatchState, assertHostedPriorMatchPreserved, summarizeHostedBootstrap, summarizeHostedNavigation,
  summarizeHostedEvidenceUpload, submitHostedEvidenceWithUpload, waitForHostedExportReady,
  isReviewedHostedAdvertisingRequest, createHostedAdvertisingBlocker, blockHostedExternalRequest } from './test-debate-browser-hosted-organizer.mjs';
import { createRunOfShow, calculateAwards } from '../worker/debate-domain.mjs';

const seats = Object.fromEntries(['A1', 'A2', 'A3', 'N1', 'N2', 'N3'].map(seat => [seat, `inert-${seat}`]));

const advertisingUrl = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4565325992372168';
const stagingOrigin = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';
const advertisingError = 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT';
function advertisingHarness() {
  let time = 1000;
  const page = {}, report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [] };
  const blocker = createHostedAdvertisingBlocker(report, { now: () => time });
  const metadata = { url: advertisingUrl, method: 'GET', resourceType: 'script', destination: 'script',
    redirectedFrom: null, frameUrl: `${stagingOrigin}/debate-room/`, mainFrame: true };
  const make = (changes = {}, options = {}) => {
    const input = { ...metadata, ...changes };
    const request = { url: () => input.url, method: () => input.method, resourceType: () => input.resourceType,
      allHeaders: async () => ({ 'sec-fetch-dest': input.destination, authorization: 'PRIVATE_NOT_RECORDED' }),
      redirectedFrom: () => input.redirectedFrom, failure: () => ({ errorText: options.failure || 'net::ERR_BLOCKED_BY_CLIENT' }),
      frame: () => ({ url: () => input.frameUrl, parentFrame: () => input.mainFrame ? null : {}, page: () => options.page || page }) };
    const calls = [];
    const route = { request: () => request, abort: async code => {
      calls.push(code); if (options.abortError) throw new Error('PRIVATE_ABORT_FAILURE');
      if (!options.noFailure) blocker.requestFailed(request);
    }, continue: () => assert.fail('Advertising must never continue'), fetch: () => assert.fail('Advertising must never be fetched') };
    return { input, request, route, calls };
  };
  const consoleError = ({ text = advertisingError, url = advertisingUrl, onPage = page, at = time } = {}) => {
    const error = { messageSha256: 'a'.repeat(64), at };
    report.consoleErrors.push(error); blocker.console(onPage, text, url, error); return error;
  };
  const finish = () => { blocker.finalize(); finalizeHostedBrowserShutdown(report); return report.status; };
  return { page, report, blocker, metadata, make, consoleError, finish, advance: milliseconds => { time += milliseconds; },
    route: route => blockHostedExternalRequest({ route, origin: stagingOrigin, advertisingBlocker: blocker, report }) };
}

test('hosted advertising block aborts the exact reviewed script before transport with only bounded diagnostics', async () => {
  const h = advertisingHarness(), request = h.make();
  assert.equal(isReviewedHostedAdvertisingRequest(request.input), true);
  assert.equal(await h.route(request.route), true); assert.deepEqual(request.calls, ['blockedbyclient']);
  const error = h.consoleError();
  assert.equal(h.finish(), 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
  assert.equal(error.blockedAdvertisingId, 1); assert.equal(error.expectedBlockedAdvertising, true);
  assert.equal(h.report.unexpectedNetwork.length, 0);
  assert.deepEqual(h.report.blockedAdvertising.records.map(record => ({ id: record.id, method: record.method,
    resourceType: record.resourceType, destination: record.destination, abortConfirmed: record.abortConfirmed,
    requestFailure: record.requestFailure, responseObserved: record.responseObserved })),
  [{ id: 1, method: 'GET', resourceType: 'script', destination: 'script', abortConfirmed: true,
    requestFailure: 'BLOCKED_BY_CLIENT', responseObserved: false }]);
  assert.ok(!JSON.stringify(h.report).includes('PRIVATE')); assert.ok(!JSON.stringify(h.report).includes(advertisingUrl));
});

test('unknown advertising origins, URL variants, methods, destinations and redirected requests stay unexpected and blocked', async () => {
  for (const changes of [
    { url: 'https://unreviewed.invalid/private?secret=PRIVATE' }, { url: advertisingUrl.replace('https:', 'http:') },
    { url: advertisingUrl.replace('pagead2.', 'pagead3.') }, { url: advertisingUrl.replace('/pagead/js/', '/other/') },
    { url: advertisingUrl.replace('4565325992372168', '4565325992372169') }, { url: advertisingUrl + '&extra=PRIVATE' },
    { url: advertisingUrl + '#PRIVATE' }, { url: advertisingUrl.replace('https://', 'https://PRIVATE@') },
    { method: 'POST' }, { method: 'HEAD' }, { resourceType: 'fetch' }, { resourceType: 'document' },
    { destination: 'empty' }, { destination: undefined }, { redirectedFrom: {} },
  ]) {
    const h = advertisingHarness(), request = h.make(changes);
    assert.equal(isReviewedHostedAdvertisingRequest(request.input), false, JSON.stringify(changes));
    assert.equal(await h.route(request.route), true); assert.deepEqual(request.calls, ['blockedbyclient']);
    assert.equal(h.report.blockedAdvertising.records.length, 0); assert.equal(h.report.unexpectedNetwork.length, 1);
    h.consoleError(); assert.equal(h.finish(), 'FAIL'); assert.ok(!JSON.stringify(h.report).includes('PRIVATE'));
  }
});

test('only the fixed staging Debate main frame may intentionally block the reviewed advertising dependency', async () => {
  const valid = advertisingHarness(), hashNavigation = valid.make({ frameUrl: `${stagingOrigin}/debate-room/#event=PRIVATE&invite=PRIVATE` });
  assert.equal(await valid.route(hashNavigation.route), true); assert.equal(valid.finish(), 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
  assert.ok(!JSON.stringify(valid.report).includes('PRIVATE'));
  for (const changes of [{ frameUrl: 'about:blank' }, { frameUrl: 'https://duediligence.ph/debate-room/' },
    { frameUrl: `${stagingOrigin}/study-room/` }, { frameUrl: `${stagingOrigin}/debate-room/?other=PRIVATE` },
    { frameUrl: `${stagingOrigin}/debate-room/index.html` }, { mainFrame: false },
    { frameUrl: `${stagingOrigin.replace('https://', 'https://PRIVATE@')}/debate-room/` }]) {
    const h = advertisingHarness(), request = h.make(changes);
    assert.equal(await h.route(request.route), true); assert.equal(h.report.unexpectedNetwork.length, 1);
    assert.equal(h.report.blockedAdvertising.records.length, 0); assert.equal(h.finish(), 'FAIL');
  }
});

test('advertising classification leaves the existing staging and exact Auth endpoint boundary unchanged', async () => {
  for (const url of [`${stagingOrigin}/debate-room/command`, 'https://hlzqmreeoghbldnhlybr.supabase.co/auth/v1/token',
    'https://hlzqmreeoghbldnhlybr.supabase.co/auth/v1/user']) {
    const h = advertisingHarness(), request = h.make({ url, method: 'POST', resourceType: 'fetch' });
    assert.equal(await h.route(request.route), false); assert.equal(request.calls.length, 0); assert.equal(h.report.unexpectedNetwork.length, 0);
  }
  for (const url of ['https://hlzqmreeoghbldnhlybr.supabase.co/rest/v1/private',
    'https://another-project.supabase.co/auth/v1/user', 'https://pagead2.googlesyndication.com/redirect']) {
    const h = advertisingHarness(), request = h.make({ url });
    assert.equal(await h.route(request.route), true); assert.equal(h.report.unexpectedNetwork.length, 1); assert.equal(h.finish(), 'FAIL');
  }
});

test('expected advertising console errors require the exact blocked request, page, message, URL and time window', async () => {
  const unbound = advertisingHarness(); unbound.consoleError(); assert.equal(unbound.finish(), 'FAIL');
  for (const changes of [{ onPage: {} }, { text: 'PRIVATE_SCRIPT_ERROR' }, { text: advertisingError + ' extra' },
    { url: advertisingUrl + '&extra=PRIVATE' }, { at: 999 }, { at: 2501 }]) {
    const h = advertisingHarness(), request = h.make(); await h.route(request.route);
    const error = h.consoleError(changes); assert.equal(h.finish(), 'FAIL'); assert.notEqual(error.expectedBlockedAdvertising, true);
  }
  const duplicate = advertisingHarness(), request = duplicate.make(); await duplicate.route(request.route);
  duplicate.consoleError(); duplicate.consoleError(); assert.equal(duplicate.finish(), 'FAIL');
  const late = advertisingHarness(), lateRequest = late.make(); await late.route(lateRequest.route); late.consoleError();
  late.advance(3000); late.blocker.requestFailed(lateRequest.request); assert.equal(late.finish(), 'FAIL');
});

test('only the exact aborted request may supply failure proof and any response or unknown failure prevents acceptance', async () => {
  for (const options of [{ noFailure: true }, { failure: 'PRIVATE_FAILURE' }]) {
    const h = advertisingHarness(), request = h.make({}, options); await h.route(request.route);
    h.blocker.requestFailed(h.make().request); h.consoleError(); assert.equal(h.finish(), 'FAIL');
    assert.ok(!JSON.stringify(h.report).includes('PRIVATE'));
  }
  const response = advertisingHarness(), request = response.make(); await response.route(request.route);
  response.blocker.response(request.request); response.consoleError(); assert.equal(response.finish(), 'FAIL');
  const abort = advertisingHarness(), failed = abort.make({}, { abortError: true });
  await assert.rejects(abort.route(failed.route), /PRIVATE_ABORT_FAILURE/); assert.equal(abort.finish(), 'FAIL');
  assert.ok(!JSON.stringify(abort.report).includes('PRIVATE'));
});

test('advertising errors may arrive before abort completion but need confirmed failure by shutdown', async () => {
  const h = advertisingHarness(), request = h.make({}, { noFailure: true });
  await h.route(request.route); const error = h.consoleError(); assert.notEqual(error.expectedBlockedAdvertising, true);
  h.advance(5); h.blocker.requestFailed(request.request);
  assert.equal(h.finish(), 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY'); assert.equal(error.expectedBlockedAdvertising, true);
  h.report.consoleErrors.push({ expectedBlockedAdvertising: true, blockedAdvertisingId: 999 });
  assert.equal(h.finish(), 'FAIL');
});

test('advertising diagnostics have a fixed bound and overflow still blocks transport while failing verification', async () => {
  const h = advertisingHarness();
  for (let index = 0; index < 257; index++) {
    const request = h.make(); assert.equal(await h.route(request.route), true); assert.deepEqual(request.calls, ['blockedbyclient']);
  }
  assert.equal(h.report.blockedAdvertising.records.length, 256); assert.equal(h.report.blockedAdvertising.overflow, true);
  assert.equal(h.finish(), 'FAIL'); assert.equal(h.report.unexpectedNetwork.length, 0);
});

test('isolated Linux browser observes and correlates the real blocked advertising request without outbound transport', {
  skip: process.env.DEBATE_HOSTED_AD_BROWSER_CI !== '1', timeout: 45000,
}, async () => {
  assert.equal(process.platform, 'linux', 'This probe must never launch a browser on the user desktop.');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.deepEqual(Object.keys(process.env).sort(), ['DEBATE_HOSTED_AD_BROWSER_CI', 'DEBATE_HOST_NETWORK_NAMESPACE', 'GITHUB_ACTIONS', 'PATH']);
  assert.match(process.env.DEBATE_HOST_NETWORK_NAMESPACE, /^net:\[\d+\]$/);
  const namespace = await readlink('/proc/self/ns/net');
  assert.notEqual(namespace, process.env.DEBATE_HOST_NETWORK_NAMESPACE);
  assert.deepEqual(networkInterfaces(), {}, 'The probe requires no active network interface, including loopback.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.join(root, 'artifacts/debate-local-rehearsal/hosted-advertising-browser-ci');
  const digest = value => createHash('sha256').update(value).digest('hex');
  // This isolated namespace runs as root while checkout belongs to the runner.
  // Trust only this exact checkout for these read-only Git operations.
  const command = args => execFileSync('git', ['-c', 'safe.directory=' + root, ...args], {
    cwd: root, encoding: 'utf8', env: hostedBrowserEnvironment(),
  }).trim();
  const sourceSha = command(['rev-parse', 'HEAD']); assert.match(sourceSha, /^[a-f0-9]{40}$/);
  const sourceTree = command(['rev-parse', 'HEAD^{tree}']); assert.match(sourceTree, /^[a-f0-9]{40}$/);
  assert.equal(command(['status', '--porcelain', '--untracked-files=all']), '');
  const sourceHashes = {};
  for (const file of ['scripts/test-debate-browser-hosted-organizer.mjs', 'scripts/test-debate-hosted-browser-safety.mjs',
    '.github/workflows/debate-v3-validation.yml', 'debate-room/index.html']) sourceHashes[file] = digest(await readFile(path.join(root, file)));
  const publicHtml = await readFile(path.join(root, 'debate-room/index.html'), 'utf8');
  const adTags = publicHtml.match(/<script\b[^>]*src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-4565325992372168"[^>]*><\/script>/g);
  assert.equal(adTags?.length, 1, 'The probe must use the exact current public advertising tag.');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
  const browserHome = path.join(output, 'empty-browser-home');
  await mkdir(browserHome);
  const report = { kind: 'ISOLATED_FULFILLED_HTML_ADVERTISING_BROWSER_PROBE', status: 'RUNNING', sourceSha, sourceTree, sourceHashes,
    startedAt: new Date().toISOString(), network: { separateNamespace: true, activeInterfaces: 0 },
    actualBrowser: true, hostedAcceptance: false, credentialsStored: false, rawOutputStored: false,
    advertisingAllowedOutbound: false, isolatedBrowserHome: true, fulfilledDocuments: 0,
    pageErrors: [], unexpectedNetwork: [], consoleErrors: [], diagnosticOverflow: false };
  const blocker = createHostedAdvertisingBlocker(report), pendingRoutes = new Set();
  let browser, context, failure;
  const boundedError = (collection, value) => {
    if (collection.length < 8) collection.push(value); else report.diagnosticOverflow = true;
  };
  try {
    const require = createRequire(import.meta.url), { chromium } = require('playwright');
    report.playwrightVersion = require('playwright/package.json').version;
    assert.equal(report.playwrightVersion, '1.54.2', 'Use the existing pinned browser tooling.');
    browser = await chromium.launch({ headless: true, channel: 'chrome', env: { PATH: process.env.PATH, HOME: browserHome } });
    report.browserVersion = browser.version();
    context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => boundedError(report.pageErrors, { messageSha256: digest(String(error.message)) }));
    page.on('requestfailed', request => blocker.requestFailed(request));
    page.on('response', response => blocker.response(response.request()));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const error = { messageSha256: digest(message.text()), at: Date.now() };
      blocker.console(page, message.text(), message.location().url, error); boundedError(report.consoleErrors, error);
    });
    await context.route('**/*', route => {
      const work = (async () => {
        try {
          const request = route.request();
          if (request.url() === `${stagingOrigin}/debate-room/` && request.method() === 'GET'
            && request.resourceType() === 'document' && request.isNavigationRequest() && request.frame().parentFrame() === null) {
            report.fulfilledDocuments++;
            return await route.fulfill({ status: 200, contentType: 'text/html',
              body: `<!doctype html><html><head><link rel="icon" href="data:,">${adTags[0]}</head><body>Isolated advertising boundary check</body></html>` });
          }
          if (await blockHostedExternalRequest({ route, origin: stagingOrigin, advertisingBlocker: blocker, report })) return;
          // The probe has no real application or Auth server. Even normally
          // permitted first-party requests must never leave this inert context.
          boundedError(report.pageErrors, { code: 'UNEXPECTED_INERT_PROBE_REQUEST' });
          await route.abort('blockedbyclient');
        } catch (error) {
          boundedError(report.pageErrors, { messageSha256: digest(String(error?.message || 'ERROR')) });
          await route.abort('blockedbyclient').catch(() => {});
        }
      })();
      pendingRoutes.add(work); void work.finally(() => pendingRoutes.delete(work)); return work;
    });
    const failed = page.waitForEvent('requestfailed', { predicate: request => request.url() === advertisingUrl, timeout: 10000 });
    const consoleError = page.waitForEvent('console', { predicate: message => message.type() === 'error'
      && message.text() === advertisingError && message.location().url === advertisingUrl, timeout: 10000 });
    await Promise.all([page.goto(`${stagingOrigin}/debate-room/`, { waitUntil: 'load', timeout: 15000 }), failed, consoleError]);
    await context.close(); context = null; await browser.close(); browser = null; await Promise.allSettled([...pendingRoutes]);
    assert.equal(report.fulfilledDocuments, 1); assert.equal(report.blockedAdvertising.records.length, 1);
    assert.equal(report.consoleErrors.length, 1); assert.equal(report.blockedAdvertising.records[0].consoleObserved, true);
    assert.equal(blocker.finalize(), true); assert.equal(report.diagnosticOverflow, false);
    report.status = 'PASS_ISOLATED_ADVERTISING_REQUEST_BLOCK'; finalizeHostedBrowserShutdown(report);
    assert.equal(report.status, 'PASS_ISOLATED_ADVERTISING_REQUEST_BLOCK');
  } catch (error) {
    failure = error; report.status = 'FAIL'; report.failureSha256 = digest(String(error?.message || 'ERROR'));
  } finally {
    await context?.close().catch(() => { report.status = 'FAIL'; });
    await browser?.close().catch(() => { report.status = 'FAIL'; });
    await Promise.allSettled([...pendingRoutes]); blocker.finalize(); finalizeHostedBrowserShutdown(report);
    report.finishedAt = new Date().toISOString();
    const bytes = JSON.stringify(report, null, 2) + '\n';
    await writeFile(path.join(output, 'report.json'), bytes);
    await writeFile(path.join(output, 'report.sha256'), digest(bytes) + '\n');
  }
  assert.equal(report.status, 'PASS_ISOLATED_ADVERTISING_REQUEST_BLOCK', failure ? 'Isolated advertising browser probe failed; inspect sanitized report.' : undefined);
});

test('export readiness allows an expired claim to recover before the independent download wait', async () => {
  const jobId = 'inert-export-result', observations = [];
  let clock = 1000, job = { id: jobId, status: 'queued' }, waits = 0;
  await waitForHostedExportReady({ kind: 'result', jobId, now: () => clock,
    snapshot: () => ({ outbox: [job] }), record: value => observations.push(value),
    control: { async waitFor(options) {
      waits++; assert.deepEqual(options, { state: 'visible', timeout: 90000 });
      // The first claim expires at 60s. A normal refresh recovers the same job
      // after that point, later than the old 30s download-event deadline.
      clock += 65000; job = { ...job, status: 'completed', downloadId: jobId };
    } } });
  assert.equal(waits, 1);
  assert.deepEqual(observations, [{ kind: 'result', jobId, timeoutMs: 90000, elapsedMs: 65000,
    outcome: 'DOWNLOAD_CONTROL_VISIBLE', jobStatus: 'completed', downloadIdMatches: true }]);
});

test('unconfirmed export readiness fails with bounded diagnostics and never stores raw browser or job data', async () => {
  const jobId = 'inert-export-result', observations = [], secret = 'PRIVATE_LINK_OR_DOCUMENT';
  let clock = 1000;
  await assert.rejects(waitForHostedExportReady({ kind: 'result', jobId, now: () => clock,
    snapshot: () => ({ outbox: [{ id: 'other-export-job', status: 'completed', downloadId: jobId },
      { id: jobId, status: 'queued', error: secret, payload: { document: secret } }] }),
    record: value => observations.push(value), control: { async waitFor({ timeout }) {
      clock += timeout; throw new Error(secret);
    } } }), error => error.code === 'HOSTED_EXPORT_READINESS_UNCONFIRMED' && !error.message.includes(secret));
  assert.deepEqual(observations, [{ kind: 'result', jobId, timeoutMs: 90000, elapsedMs: 90000,
    outcome: 'READINESS_UNCONFIRMED', jobStatus: 'queued', downloadIdMatches: false }]);
  assert.ok(!JSON.stringify(observations).includes(secret));
});

test('missing and unrecognized export states remain unknown in readiness diagnostics', async () => {
  for (const status of [undefined, 'PRIVATE_UNEXPECTED_STATE']) {
    const observations = [];
    await assert.rejects(waitForHostedExportReady({ kind: 'csv', jobId: 'inert-export-csv', now: () => 0,
      snapshot: () => status ? { outbox: [{ id: 'inert-export-csv', status }] } : undefined,
      record: value => observations.push(value), control: { async waitFor() { throw new Error('timeout'); } } }),
    { code: 'HOSTED_EXPORT_READINESS_UNCONFIRMED' });
    assert.equal(observations[0].jobStatus, null); assert.equal(observations[0].downloadIdMatches, false);
  }
});

const expectedUpload = { mimeType: 'application/pdf', size: 128, sha256: 'a'.repeat(64) };
function uploadHarness() {
  const page = new EventEmitter(), observations = [], origin = 'https://staging.invalid';
  const eventId = 'de-' + 'a'.repeat(32), matchId = 'inert-match';
  const uploadUrl = `${origin}/debate-room/evidence/upload?eventId=${eventId}&matchId=${matchId}`;
  const request = (url, input, method = 'POST') => ({ url: () => url, method: () => method, postDataJSON: () => input });
  const response = ({ url = uploadUrl, status = 200, body = { ok: true,
    attachment: { mimeType: expectedUpload.mimeType, size: expectedUpload.size, uploadId: 'PRIVATE_SEALED_RECEIPT' } },
    contentType = 'application/json', input, method } = {}) => ({ url: () => url,
    request: () => request(url, input, method), status: () => status, json: async () => body,
    headers: () => ({ 'content-type': contentType, 'set-cookie': 'PRIVATE_COOKIE' }) });
  const command = (overrides = {}) => response({ url: `${origin}/debate-room/command`, input: {
    command: 'share_evidence', eventId, payload: { matchId, private: 'PRIVATE_CONTENT' } }, ...overrides });
  const run = click => submitHostedEvidenceWithUpload({ page, origin, eventId, matchId,
    expected: expectedUpload, record: value => observations.push(value), click });
  return { page, observations, origin, eventId, matchId, uploadUrl, request, response, command, run };
}

test('upload diagnostics retain exact known error classifications and bounded byte facts without private response data', () => {
  const secret = 'PRIVATE_SENTINEL_DO_NOT_STORE';
  for (const code of ['STORAGE_UNCONFIGURED', 'PRIVATE_STORAGE_UNCONFIRMED', 'STORAGE_WRITE_UNCONFIRMED',
    'UPLOAD_INVALID', 'UPLOAD_CHANGED', 'UNSAFE_FILE', 'DEBATE_UNAVAILABLE', 'STORE_UNAVAILABLE',
    'EVIDENCE_INPUT_READ_FAILED', 'EVIDENCE_BUCKET_CHECK_FAILED', 'EVIDENCE_WRITE_FAILED', 'EVIDENCE_READBACK_FAILED', 'EVIDENCE_SEAL_FAILED', 'DELIVERY_REDIRECT_REJECTED']) {
    const summary = summarizeHostedEvidenceUpload({ status: 503, contentType: `Application/JSON; secret=${secret}`,
      expected: expectedUpload, body: { ok: false, error: { code, message: secret }, private: secret,
        attachment: { mimeType: secret, size: secret, uploadId: secret, digest: secret, storageKey: secret } } });
    assert.equal(summary.errorCode, code); assert.equal(summary.contentType, 'application/json');
    assert.equal(summary.attachmentMimeType, 'OTHER'); assert.equal(summary.attachmentSize, null);
    assert.equal(summary.uploadReceiptPresent, true); assert.ok(!JSON.stringify(summary).includes(secret));
    assert.deepEqual(summary.expected, expectedUpload);
  }
  const unknown = summarizeHostedEvidenceUpload({ status: 502, contentType: secret,
    expected: expectedUpload, body: { error: { code: secret } } });
  assert.equal(unknown.errorCode, 'OTHER_ERROR'); assert.equal(unknown.contentType, 'OTHER');
  assert.ok(!JSON.stringify(unknown).includes(secret));
  assert.equal(summarizeHostedEvidenceUpload({ status: 502, expected: expectedUpload, body: null }).ok, null);
});

test('failed upload rejects immediately and removes listeners instead of waiting for a share command', { timeout: 1000 }, async () => {
  const h = uploadHarness();
  await assert.rejects(h.run(async () => h.page.emit('response', h.response({ status: 503,
    body: { ok: false, error: { code: 'STORAGE_WRITE_UNCONFIRMED', message: 'PRIVATE_PROVIDER_DETAIL' } } }))),
  error => error.code === 'HOSTED_EVIDENCE_UPLOAD_FAILED' && error.message === error.code);
  assert.equal(h.observations.length, 1); assert.equal(h.observations[0].status, 503);
  assert.equal(h.observations[0].errorCode, 'STORAGE_WRITE_UNCONFIRMED');
  assert.equal(h.page.listenerCount('response'), 0); assert.equal(h.page.listenerCount('requestfailed'), 0);
  assert.ok(!JSON.stringify(h.observations).includes('PRIVATE'));
});

test('upload success still requires the exact size, MIME, receipt and subsequent owned command', { timeout: 1000 }, async () => {
  const h = uploadHarness(), intendedCommand = h.command(); let completed = false;
  const pending = h.run(async () => {
    h.page.emit('response', h.response({ url: 'https://foreign.invalid/debate-room/evidence/upload' }));
    h.page.emit('response', h.response({ url: h.uploadUrl.replace(h.eventId, 'another-event') }));
    h.page.emit('response', h.response({ method: 'GET' }));
    h.page.emit('response', h.command({ input: { command: 'share_evidence', eventId: 'another-event', payload: { matchId: h.matchId } } }));
  }).then(value => { completed = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false); assert.equal(h.observations.length, 0);
  h.page.emit('response', intendedCommand);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false, 'A command cannot replace the real upload proof');
  h.page.emit('response', h.response());
  assert.equal(await pending, intendedCommand); assert.equal(h.observations.length, 1);
  assert.equal(h.observations[0].attachmentSize, expectedUpload.size);
  assert.ok(!JSON.stringify(h.observations).includes('PRIVATE'));
  assert.equal(h.page.listenerCount('response'), 0); assert.equal(h.page.listenerCount('requestfailed'), 0);
});

test('malformed successful upload acknowledgement cannot bypass digest validation by returning a command', { timeout: 1000 }, async () => {
  for (const change of [
    result => { result.attachment.size++; }, result => { result.attachment.mimeType = 'image/png'; },
    result => { result.attachment.uploadId = ''; }, result => { result.error = { code: 'PRIVATE_UNKNOWN_CODE' }; },
  ]) {
    const h = uploadHarness(), body = { ok: true, attachment: { mimeType: expectedUpload.mimeType,
      size: expectedUpload.size, uploadId: 'PRIVATE_SEALED_RECEIPT' } }; change(body);
    await assert.rejects(h.run(async () => { h.page.emit('response', h.command()); h.page.emit('response', h.response({ body })); }),
      { code: 'HOSTED_EVIDENCE_UPLOAD_INVALID_RESPONSE' });
    assert.equal(h.observations.length, 1); assert.equal(h.page.listenerCount('response'), 0);
  }
});

test('upload transport failure and unreadable response fail safely without retaining exception or request details', { timeout: 1000 }, async () => {
  const h = uploadHarness();
  await assert.rejects(h.run(async () => h.page.emit('requestfailed', {
    ...h.request(h.uploadUrl), failure: () => ({ errorText: 'PRIVATE_TRANSPORT_DETAIL' }) })),
  { code: 'HOSTED_EVIDENCE_UPLOAD_TRANSPORT_FAILED' });
  assert.deepEqual(h.observations, [{ path: '/debate-room/evidence/upload', status: null, outcome: 'TRANSPORT_FAILED' }]);
  const other = uploadHarness(), response = other.response(); response.json = async () => { throw new Error('PRIVATE_RESPONSE_BODY'); };
  await assert.rejects(other.run(async () => other.page.emit('response', response)), { code: 'HOSTED_EVIDENCE_UPLOAD_FAILED' });
  assert.equal(other.observations[0].ok, null); assert.ok(!JSON.stringify(other.observations).includes('PRIVATE'));
  assert.equal(other.page.listenerCount('requestfailed'), 0);
});

test('failed bootstrap diagnostics classify 403 without retaining credentials, private bodies or foreign URLs', () => {
  const origin = 'https://staging.invalid', secret = 'PRIVATE_SENTINEL_DO_NOT_STORE';
  const value = summarizeHostedBootstrap({ pathname: '/debate-room/events', status: 403, origin,
    contentType: `application/json; private=${secret}`, body: { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED', message: secret }, private: secret },
    headers: { Authorization: `Bearer ${secret}`, Referer: `https://${secret}.invalid/#invite=${secret}`,
      Origin: `https://${secret}.invalid`, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', Cookie: secret } });
  assert.equal(value.status, 403); assert.equal(value.errorCode, 'ORIGIN_NOT_ALLOWED'); assert.equal(value.ok, false);
  assert.deepEqual(value.request, { origin: 'OTHER', fetchSite: 'same-origin', fetchMode: 'cors', fetchDest: 'empty', referer: 'OTHER', authorizationPresent: true });
  assert.equal(value.contentType, 'application/json'); assert.equal(value.eventCount, null);
  assert.ok(!JSON.stringify(value).includes(secret));
  const unknown = summarizeHostedBootstrap({ pathname: '/debate-room/events', status: 403, origin,
    contentType: secret, body: { error: { code: secret } }, headers: { 'sec-fetch-site': secret, referer: secret } });
  assert.equal(unknown.errorCode, 'OTHER_ERROR'); assert.ok(!JSON.stringify(unknown).includes(secret));
  assert.equal(unknown.request.origin, 'ABSENT'); assert.equal(unknown.request.authorizationPresent, false);
});

test('bootstrap success and malformed response retain only bounded structural facts on the two fixed routes', () => {
  const origin = 'https://staging.invalid';
  for (const pathname of ['/debate-room/events', '/debate-room/discover']) {
    const result = summarizeHostedBootstrap({ pathname, status: 200, origin, contentType: 'Application/JSON; charset=utf-8',
      body: { ok: true, events: [{ title: 'PRIVATE_TITLE' }] }, headers: { origin, referer: `${origin}/debate-room/#invite=PRIVATE_INVITE` } });
    assert.equal(result.eventCount, 1); assert.equal(result.ok, true); assert.equal(result.errorCode, null);
    assert.equal(result.request.origin, 'same-origin'); assert.equal(result.request.referer, 'same-origin');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  const malformed = summarizeHostedBootstrap({ pathname: '/debate-room/events', status: 502, origin, body: null });
  assert.equal(malformed.ok, null); assert.equal(malformed.contentType, 'ABSENT');
  assert.throws(() => summarizeHostedBootstrap({ pathname: '/auth/v1/token', status: 200, origin }));
});

test('navigation diagnostics describe owned-event reloads without recording invitation secrets or foreign paths', () => {
  const origin = 'https://staging.invalid', owned = 'de-' + 'a'.repeat(32);
  const result = summarizeHostedNavigation(`${origin}/debate-room/#event=${owned}&match=PRIVATE_MATCH&invite=PRIVATE_SECRET`, origin, owned);
  assert.deepEqual(result, { sameOrigin: true, path: '/debate-room/', hasEvent: true, matchesOwnedEvent: true, hasMatch: true, hasInvite: true });
  const other = summarizeHostedNavigation('https://PRIVATE_HOST.invalid/PRIVATE_PATH?PRIVATE_QUERY#event=PRIVATE_EVENT', origin, owned);
  assert.equal(other.path, 'OTHER'); assert.equal(other.sameOrigin, false); assert.equal(other.matchesOwnedEvent, false);
  assert.ok(!JSON.stringify([result, other]).includes('PRIVATE'));
  assert.deepEqual(summarizeHostedNavigation('not a URL', origin, owned), { validUrl: false });
});

test('independent hosted timetable rejects reordered stages, reversed question pairs and redistributed durations even with the same total', () => {
  assertHostedDefaultRunOfShow(createRunOfShow());
  assert.equal(HOSTED_DEFAULT_TIMED_STAGES.length, 16);
  assert.equal(HOSTED_DEFAULT_TIMED_STAGES.reduce((sum, stage) => sum + stage.durationMs, 0), 4680000);
  for (const change of [
    stages => { [stages[1], stages[3]] = [stages[3], stages[1]]; },
    stages => stages[2].speakerSeats.reverse(),
    stages => { stages[1].durationMs += 1000; stages[2].durationMs -= 1000; },
    stages => { [stages[14].speakerSeats, stages[15].speakerSeats] = [stages[15].speakerSeats, stages[14].speakerSeats]; },
    stages => { stages.at(-1).durationMs = 0; },
  ]) { const stages = structuredClone(createRunOfShow()); change(stages); assert.throws(() => assertHostedDefaultRunOfShow(stages)); }
});

function finishedAttempt(index) {
  const stage = HOSTED_DEFAULT_TIMED_STAGES[index], start = 1800000000000, adjustments = [{ type: 'START', at: start, durationMs: stage.durationMs }];
  if (index === 1) adjustments.push({ type: 'PAUSE', at: start + 1234, durationMs: stage.durationMs },
    { type: 'RESUME', at: start + 6234, durationMs: stage.durationMs });
  const elapsedMs = stage.durationMs + 1100, finishedAt = start + elapsedMs + (index === 1 ? 5000 : 0);
  adjustments.push({ type: 'FINISH', at: finishedAt, durationMs: stage.durationMs });
  return { id: `inert-attempt-${index}`, stageId: stage.id, stageIndex: index, number: 1, ruleVersion: 1,
    state: 'FINISHED', speakerSeats: [...stage.speakerSeats], speakerIds: stage.speakerSeats.map(seat => seats[seat]),
    createdAt: start - 10, elapsedMs, overtimeMs: 1100, finishedAt, adjustments };
}

test('hosted persisted attempt proof uses acknowledged timestamps and excludes paused time', () => {
  for (let index = 0; index < 16; index++) {
    const attempt = finishedAttempt(index), evidence = assertHostedFinishedAttempt(attempt, index, seats);
    assert.equal(evidence.elapsedMs, HOSTED_DEFAULT_TIMED_STAGES[index].durationMs + 1100);
    assert.equal(evidence.finishedAt - evidence.startedAt - evidence.elapsedMs, index === 1 ? 5000 : 0);
  }
  for (const change of [
    attempt => { attempt.elapsedMs += 5000; attempt.overtimeMs += 5000; },
    attempt => { attempt.adjustments[0].durationMs = 1; },
    attempt => { attempt.speakerIds = ['inert-N1']; },
    attempt => { attempt.adjustments[1].type = 'RESET'; },
    attempt => { attempt.finishedAt += 1; },
    attempt => { attempt.elapsedMs = 299999; },
  ]) { const attempt = finishedAttempt(1); change(attempt); assert.throws(() => assertHostedFinishedAttempt(attempt, 1, seats)); }
});

test('corrected full scorecard awards match exact independent winners and closing eligibility', () => {
  const speakers = Object.fromEntries(Object.keys(seats).map(seat => [seat,
    { evidence: seat[0] === 'N' ? 20 : seat === 'A1' ? 24 : 25, delivery: 30, questioning: 15, responding: 15 }]));
  const final = { id: 'inert-final-corrected', state: 'FINAL', winner: 'affirmative', awards: calculateAwards({
    ballots: [{ judgeId: 'inert-judge', scorecard: { speakers, closing: { affirmative: 15, negative: 12 } } }],
    activeJudgeIds: ['inert-judge'], nominations: [{ judgeId: 'inert-judge', nomineeId: 'A2', reason: 'Synthetic nomination.' }], matchStatus: 'FINAL' }) };
  assertHostedCorrectedAwards(final);
  for (const name of ['bestSpeaker', 'bestInterpellator', 'bestRebuttalSpeaker', 'bestDebater']) {
    const wrong = structuredClone(final); wrong.awards[name].winners = ['N3']; assert.throws(() => assertHostedCorrectedAwards(wrong));
  }
  const wrong = structuredClone(final); wrong.awards.bestRebuttalSpeaker.candidates.push({ id: 'A2' });
  assert.throws(() => assertHostedCorrectedAwards(wrong));
});

test('hosted exports reject the superseded result version and do not invent result linkage for rules or private scorecards', () => {
  const final = { id: 'inert-final-corrected' };
  for (const kind of ['result', 'event_report', 'csv', 'certificate']) {
    assertHostedExportVersion(kind, { type: 'export', resultVersion: final.id }, final);
    for (const resultVersion of [undefined, null, 'inert-superseded'])
      assert.throws(() => assertHostedExportVersion(kind, { type: 'export', resultVersion }, final));
  }
  for (const kind of ['rules', 'scorecard']) {
    assertHostedExportVersion(kind, { type: 'export' }, final);
    assert.throws(() => assertHostedExportVersion(kind, { type: 'export', resultVersion: final.id }, final));
  }
});

function nextMatch(started = false) {
  const next = { id: 'inert-next', motionId: 'inert-new-private-motion', phase: 'setup', rulesLockedAt: null, timer: null,
    drafts: {}, ballots: {}, polls: {}, nominations: {}, ballotHistory: [], resultVersions: [], messages: [], evidence: [],
    incidents: [], protests: [], ballotRound: 1, ballotState: 'DRAFT', activePollId: null, runOfShow: [], attempts: [], acknowledgments: {} };
  if (started) Object.assign(next, { phase: 'preparation', currentStageIndex: 0, motionReleasedAt: 2000,
    runOfShow: createRunOfShow(), attempts: [{ id: 'inert-next-attempt', stageId: 'preparation', state: 'READY', adjustments: [] }],
    timer: { matchId: next.id, stageAttemptId: 'inert-next-attempt', state: 'READY', durationMs: 900000,
      elapsedBeforeRunMs: 0, startedAtServerMs: null, controllerId: null } });
  return next;
}

test('next match must have a different private motion and empty competitive records before and after its READY start', () => {
  const prior = { id: 'inert-first', motionId: 'inert-first-motion', motionReleasedAt: 1000, attempts: [{ id: 'inert-first-attempt' }] };
  for (const started of [false, true]) {
    assertHostedNextMatchState(nextMatch(started), prior, 'inert-new-private-motion', { started });
    for (const change of [
      next => { next.motionId = prior.motionId; }, next => { next.ballots.current = { winner: 'affirmative' }; },
      next => { next.drafts.judge = { private: 'inert draft' }; }, next => { next.resultVersions.push({ id: 'inert-old' }); },
      next => { next.polls.old = { votes: 1 }; }, next => { next.messages.push({ id: 'inert-old-message' }); },
    ]) { const next = nextMatch(started); change(next); assert.throws(() => assertHostedNextMatchState(next, prior, 'inert-new-private-motion', { started })); }
  }
  const next = nextMatch(true); next.timer.elapsedBeforeRunMs = 1;
  assert.throws(() => assertHostedNextMatchState(next, prior, 'inert-new-private-motion', { started: true }));
});

test('next-match isolation compares the entire previous match including timer, ballot history, private drafts and polls', () => {
  const before = { timer: { elapsedBeforeRunMs: 301100 }, ballots: { current: { winner: 'affirmative' } },
    ballotHistory: [{ round: 1 }], drafts: { judge: { notes: 'inert-private-note' } }, polls: { first: { votes: 1 } },
    rules: { constructiveMs: 300000 }, attempts: [{ id: 'inert-attempt' }], resultVersions: [{ id: 'inert-final' }] };
  assertHostedPriorMatchPreserved(before, structuredClone(before));
  for (const key of Object.keys(before)) { const after = structuredClone(before); delete after[key]; assert.throws(() => assertHostedPriorMatchPreserved(before, after)); }
});

test('hosted browser cannot launch on the desktop or without the dedicated CI opt-in', () => {
  for (const configuration of [
    { platform: 'win32', env: { GITHUB_ACTIONS: 'true', DEBATE_HOSTED_BROWSER_CI: '1' } },
    { platform: 'linux', env: { DEBATE_HOSTED_BROWSER_CI: '1' } },
    { platform: 'linux', env: { GITHUB_ACTIONS: 'true' } },
    { platform: 'linux', env: { GITHUB_ACTIONS: 'true', DEBATE_SYNTHETIC_BROWSER_CI: '1' } }
  ]) assert.throws(() => assertCiExecution(configuration));
  assert.doesNotThrow(() => assertCiExecution({ platform: 'linux', env: { GITHUB_ACTIONS: 'true', DEBATE_HOSTED_BROWSER_CI: '1' } }));
});

test('late session observation and browser errors change a provisional PASS to FAIL after shutdown', () => {
  for (const kind of ['pageErrors', 'unexpectedNetwork', 'consoleErrors']) {
    const report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [] };
    report[kind].push({ messageSha256: 'a'.repeat(64) }); finalizeHostedBrowserShutdown(report);
    assert.equal(report.status, 'FAIL'); assert.equal(report.shutdownObservationsVerified, false);
  }
  const report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [{ expectedResourceRejection: true }] };
  finalizeHostedBrowserShutdown(report); assert.equal(report.status, 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
  assert.equal(report.shutdownObservationsVerified, true);
});
test('browser and read-only git subprocesses receive no account, cloud or Supabase secrets', () => {
  const env = { PATH: '/inert/bin', HOME: '/inert/home', TMPDIR: '/inert/tmp', LANG: 'C.UTF-8',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'secret-service', CLOUDFLARE_API_TOKEN: 'secret-cloud', GITHUB_TOKEN: 'secret-github',
    DEBATE_STAGING_ALLOWED_BEARER: 'secret-bearer', NODE_OPTIONS: '--require=untrusted', HTTPS_PROXY: 'https://untrusted.invalid' };
  assert.deepEqual(hostedBrowserEnvironment(env), { PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: env.LANG });
  assert.ok(!JSON.stringify(hostedBrowserEnvironment(env)).includes('secret'));
});
