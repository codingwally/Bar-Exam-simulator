/** Actual public frontend, isolated loopback only. No credentials, accounts or hosted operations. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(runnerPath), '..');
const output = path.join(root, 'artifacts/debate-local-rehearsal/native-view-browser');
const digest = value => createHash('sha256').update(value).digest('hex');
const views = ['terms', 'privacy', 'support', 'partnership'];
const viewports = [{ width: 1280, height: 720 }, { width: 390, height: 844 }];
const controls = ['close', 'back', 'escape'];
const policy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; manifest-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4' };
const declaredInputs = ['scripts/test-native-view-browser.mjs', '.github/workflows/validate-home-display.yml', 'index.html', 'manifest.webmanifest', 'assets/phase2-experience.js', 'assets/phase2.css', 'assets/phase2-config.js', 'assets/private-beta-landing.js', 'assets/private-beta-landing.css', 'assets/private-beta-session.js', 'assets/quorum-first-shell.css', 'assets/quorum-first-shell.js', 'service-worker.js'];

function safeError(error) {
  return { name: String(error?.name || 'Error').slice(0, 80), messageSha256: digest(String(error?.message || error)) };
}

export async function runNativeViewBrowser() {
  assert.equal(process.platform, 'linux', 'Run only in isolated Linux verification.');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'GitHub verification is required.');
  assert.equal(process.env.NATIVE_VIEW_BROWSER_CI, '1', 'Explicit local-browser verification mode is required.');
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(path.join(tmpdir(), 'native-view-browser-'));
  const browserHome = path.join(temporary, 'home');
  await mkdir(browserHome);
  const childEnv = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: browserHome, TMPDIR: temporary, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: childEnv, encoding: 'utf8', timeout: 5_000 }).trim();
  assert.match(sourceSha, /^[0-9a-f]{40}$/);
  const report = {
    schemaVersion: 1, status: 'RUNNING', phase: 'input-capture', startedAt: new Date().toISOString(), sourceSha,
    scope: 'ACTUAL_SIGNED_OUT_FRONTEND_DIRECT_NATIVE_ROUTES_AND_ENTRY_LEGAL_HISTORY_ON_LOOPBACK',
    testSha256: digest(await readFile(runnerPath)), inputHashes: {}, servedInputHashes: {}, cases: [], screenshots: [],
    isolation: { actualIndexAndAssets: true, applicationSourceModified: false, freshContextPerCase: true, authenticatedSessionInjected: false, browserEnvironmentAllowlist: Object.keys(childEnv), csp: policy, serviceWorkers: 'block', hostedTargetAllowed: false },
    network: { localGetRequests: 0, externalRequestsBlocked: 0, localNonGetRequestsBlocked: 0, navigationRequestsBlocked: 0, websocketRequestsBlocked: 0, serverNonGetRequestsRejected: 0, serverMissingPaths: [], serverErrors: 0 },
    pageErrors: [], consoleErrors: [], fullWebsiteAcceptance: false, actualHostedAuth: false,
    customerDataStored: false, deploymentPerformed: false, emailsSent: false, paymentsInitiated: false,
    limitations: ['External fonts, advertising, services, connections and forms are intentionally blocked.', 'Signed-in, paid-access, backend, inbox, payment and production behavior are outside this check.', 'Screenshots document the local blocked-network presentation, not production visual acceptance.', 'No ineffective action is retried; the first action must produce the asserted result.'],
  };
  for (const relative of declaredInputs) report.inputHashes[relative] = digest(await readFile(path.join(root, relative)));
  const bytes = new Map();
  const absoluteRoot = await realpath(root);
  let server, browser, origin, expired = false, deadline;
  const check = (item, name, condition) => {
    item.checks.push({ name, passed: Boolean(condition) });
    assert.ok(condition, `${item.id}: ${name}`);
  };
  const snapshot = page => page.evaluate(() => {
    const native = document.getElementById('dd2-native-view');
    return {
      pathname: location.pathname, search: location.search, hash: location.hash,
      historyLength: history.length, dd2View: history.state?.dd2View || null,
      sentinel: history.state?.nativeViewBrowserSentinel || null,
      nativeOpen: native?.classList.contains('is-open') === true,
      nativeAriaHidden: native?.getAttribute('aria-hidden') || null,
      nativeView: native?.dataset.nativeView || null,
      signInOpen: Boolean(document.querySelector('#dd2-entry-overlay.is-open, #signin-prompt-modal.open')),
      signedIn: Boolean(window.DueDiligencePhase2?.getSession?.()?.access_token),
      focusedId: document.activeElement?.id || null,
      focusedLegalView: document.activeElement?.getAttribute('data-pb-legal') || null,
      focusInert: Boolean(document.activeElement?.closest?.('[inert]')),
    };
  });
  const settledFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const ready = async page => {
    await page.waitForFunction(() => document.readyState === 'complete' && typeof window.DueDiligencePhase2?.whenAuthReady === 'function', null, { timeout: 10_000 });
    await page.evaluate(() => Promise.race([
      window.DueDiligencePhase2.whenAuthReady(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Public frontend auth readiness deadline exceeded')), 8_000)),
    ]));
    await settledFrames(page);
  };
  const waitOpen = (page, view) => page.waitForFunction(expected => {
    const element = document.getElementById('dd2-native-view');
    return element?.classList.contains('is-open') && element.dataset.nativeView === expected && element.getAttribute('aria-hidden') === 'false';
  }, view, { timeout: 5_000 });
  const waitClosed = page => page.waitForFunction(() => {
    const element = document.getElementById('dd2-native-view');
    return element?.getAttribute('aria-hidden') === 'true' && !element.classList.contains('is-open');
  }, null, { timeout: 5_000 });
  const screenshot = async (page, item, stage, selector) => {
    const previousStage = item.stage;
    item.stage = `screenshot-${stage}`;
    const filename = `${item.id}-${stage}.png`;
    const attempt = { stage: item.stage, previousStage, selector: selector || null, file: filename, status: 'RUNNING' };
    (item.screenshotAttempts ||= []).push(attempt);
    try {
      if (selector) await page.locator(selector).screenshot({ path: path.join(output, filename), timeout: 4_000, animations: 'disabled' });
      else await page.screenshot({ path: path.join(output, filename), fullPage: false, timeout: 4_000, animations: 'disabled' });
      report.screenshots.push({ caseId: item.id, stage, file: filename, sha256: digest(await readFile(path.join(output, filename))) });
      attempt.status = 'PASS';
      item.stage = previousStage;
    } catch (error) {
      attempt.status = 'FAIL'; attempt.failure = safeError(error);
      throw error;
    }
  };
  const withCase = async (item, work) => {
    assert.equal(expired, false, 'Suite deadline exceeded.');
    report.cases.push(item);
    item.status = 'RUNNING'; item.stage = 'fresh-context'; item.checks = []; item.actions = []; item.startedAt = new Date().toISOString();
    const context = await browser.newContext({ viewport: item.viewport, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
    const csp = new Map(), blocked = new Map();
    const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    const address = value => { try { const url = new URL(value); return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url.origin : url.protocol; } catch { return String(value).slice(0, 30); } };
    await context.exposeBinding('__nativeBrowserPolicyViolation', (_source, value) => {
      increment(csp, `${String(value.directive).slice(0, 80)}|${address(value.blockedURI)}`);
    });
    await context.addInitScript(() => {
      window.__nativeBrowserActions = [];
      document.addEventListener('securitypolicyviolation', event => {
        void window.__nativeBrowserPolicyViolation({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
      });
      document.addEventListener('click', event => {
        const control = event.target?.closest?.('#dd2-native-close, #dd2-native-back, .quorum-entry-legal [data-pb-legal]');
        if (control) window.__nativeBrowserActions.push({ type: 'click', id: control.id || null, legal: control.getAttribute('data-pb-legal'), trusted: event.isTrusted });
      }, true);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') window.__nativeBrowserActions.push({ type: 'escape', trusted: event.isTrusted });
      }, true);
    });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET') return route.continue();
      if (url.origin !== origin) report.network.externalRequestsBlocked++;
      else report.network.localNonGetRequestsBlocked++;
      if (request.isNavigationRequest()) report.network.navigationRequestsBlocked++;
      increment(blocked, `${request.method()}|${url.origin}|${request.resourceType()}`);
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => {
      report.network.websocketRequestsBlocked++;
      socket.close({ code: 1008, reason: 'Local frontend verification only' });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000); page.setDefaultNavigationTimeout(12_000);
    page.on('pageerror', error => report.pageErrors.push({ caseId: item.id, ...safeError(error) }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const value = message.text();
      const category = /Content Security Policy|Content-Security-Policy|violates the following.*directive|Refused to .* (?:load|connect|execute)|Refused to (?:load|connect|execute)/i.test(value) ? 'EXPECTED_CSP_BLOCK'
        : /net::ERR_BLOCKED_BY_CLIENT|Failed to fetch|NetworkError|Failed to load resource/i.test(value) ? 'BLOCKED_NETWORK_OR_RESOURCE_ERROR' : 'OTHER_CONSOLE_ERROR';
      report.consoleErrors.push({ caseId: item.id, category, messageSha256: digest(value) });
    });
    const errorsBefore = report.pageErrors.length, navigationsBefore = report.network.navigationRequestsBlocked;
    try {
      await work(page, item);
      check(item, 'No uncaught page error in this case', report.pageErrors.length === errorsBefore);
      check(item, 'No off-origin or non-GET navigation attempted', report.network.navigationRequestsBlocked === navigationsBefore);
      item.status = 'PASS';
    } catch (error) {
      item.status = 'FAIL'; item.failedStage = item.stage; item.failure = safeError(error);
      item.lastSnapshot = await snapshot(page).catch(() => null);
      item.observedActionsAtFailure = await page.evaluate(() => window.__nativeBrowserActions || []).catch(() => []);
      await screenshot(page, item, 'failure').catch(() => { item.failureScreenshotUnavailable = true; });
      throw error;
    } finally {
      item.finishedAt = new Date().toISOString();
      item.cspViolations = [...csp].map(([key, count]) => ({ key, count }));
      item.requestsBlockedBeforeNetwork = [...blocked].map(([key, count]) => ({ key, count }));
      await context.close();
    }
  };
  const execute = async () => {
    report.phase = 'browser-launch';
    const { chromium } = createRequire(import.meta.url)('playwright');
    const playwrightVersion = createRequire(import.meta.url)('playwright/package.json').version;
    assert.equal(playwrightVersion, '1.54.2', 'Use the existing exact pinned Playwright.');
    browser = await chromium.launch({ headless: true, channel: 'chrome', env: childEnv, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    report.browser = { playwrightVersion, version: browser.version(), channel: 'chrome' };
    report.phase = 'public-browser-cases';
    for (const viewport of viewports) {
      for (const view of views) for (const control of controls) {
        await withCase({ id: `direct-${view}-${control}-${viewport.width}x${viewport.height}`, kind: 'direct', view, control, viewport }, async (page, item) => {
          item.stage = 'initial-load-and-readiness';
          await page.goto(`${origin}/#${view}`, { waitUntil: 'load' });
          await ready(page); await waitOpen(page, view);
          await page.evaluate(id => history.replaceState({ ...(history.state || {}), nativeViewBrowserSentinel: id }, '', location.href), item.id);
          item.before = await snapshot(page);
          check(item, 'Direct public route is signed out and has no owned dialog entry', !item.before.signedIn && item.before.dd2View === null && !item.before.signInOpen);
          if (control === 'close') await screenshot(page, item, 'open', '#dd2-native-view .dd2-native-card');
          item.stage = 'first-dismissal-action';
          item.actions.push({ action: control, attempts: 1 });
          if (control === 'escape') await page.keyboard.press('Escape');
          else await page.locator(`#dd2-native-${control}`).click();
          // No second click, forced click, scripted close or alternate control is allowed.
          await waitClosed(page); await settledFrames(page);
          item.afterAction = await snapshot(page);
          check(item, 'First dismissal returns to canonical public Home', page.url() === `${origin}/` && item.afterAction.hash === '');
          check(item, 'Dismissal preserves unrelated state without a new history entry', item.afterAction.sentinel === item.id && item.afterAction.historyLength === item.before.historyLength && item.afterAction.dd2View === null);
          check(item, 'Dismissal does not open a sign-in overlay', !item.afterAction.signInOpen);
          item.observedActions = await page.evaluate(() => window.__nativeBrowserActions);
          check(item, 'Exactly one trusted dismissal action was delivered', item.observedActions.length === 1 && item.observedActions[0].trusted === true && (control === 'escape' ? item.observedActions[0].type === 'escape' : item.observedActions[0].id === `dd2-native-${control}`));
          item.stage = 'real-reload';
          await page.reload({ waitUntil: 'load' }); await ready(page); await waitClosed(page);
          item.afterReload = await snapshot(page);
          check(item, 'Real reload remains on public Home with the dialog closed', page.url() === `${origin}/` && !item.afterReload.nativeOpen && item.afterReload.nativeAriaHidden === 'true' && !item.afterReload.signInOpen && !item.afterReload.signedIn);
          check(item, 'Real reload retains unrelated history state', item.afterReload.sentinel === item.id);
          if (control === 'close') await screenshot(page, item, 'after-reload', '.quorum-entry-legal');
        });
      }
      for (const view of ['terms', 'privacy']) {
        await withCase({ id: `entry-legal-${view}-${viewport.width}x${viewport.height}`, kind: 'entry-legal-history', view, viewport }, async (page, item) => {
          item.stage = 'initial-load-and-readiness';
          await page.goto(`${origin}/`, { waitUntil: 'load' }); await ready(page); await waitClosed(page);
          await page.evaluate(id => history.replaceState({ ...(history.state || {}), nativeViewBrowserSentinel: id }, '', location.href), item.id);
          item.before = await snapshot(page);
          const selector = `.quorum-entry-legal [data-pb-legal="${view}"]`, link = page.locator(selector);
          check(item, 'Entry legal links start signed out without sign-in overlay', !item.before.signedIn && !item.before.signInOpen);
          item.stage = 'first-entry-legal-click';
          item.actions.push({ action: `entry-legal-${view}`, attempts: 1 }); await link.click(); await waitOpen(page, view);
          item.afterOpen = await snapshot(page);
          check(item, 'Entry legal link creates one owned native-view history entry', item.afterOpen.dd2View === view && item.afterOpen.hash === `#${view}` && item.afterOpen.historyLength === item.before.historyLength + 1);
          item.stage = 'first-escape-and-focus-return';
          item.actions.push({ action: 'escape', attempts: 1 }); await page.keyboard.press('Escape'); await waitClosed(page);
          await page.waitForFunction(expected => document.activeElement?.matches(expected), selector, { timeout: 5_000 });
          item.afterEscape = await snapshot(page);
          check(item, 'Escape restores public origin, focus and unrelated state without sign-in', page.url() === `${origin}/` && item.afterEscape.sentinel === item.id && item.afterEscape.focusedLegalView === view && !item.afterEscape.focusInert && !item.afterEscape.signInOpen);
          item.stage = 'browser-forward';
          item.actions.push({ action: 'browser-forward', attempts: 1 }); await page.goForward(); await waitOpen(page, view);
          item.afterForward = await snapshot(page);
          check(item, 'Browser Forward restores the owned legal dialog', item.afterForward.dd2View === view && item.afterForward.hash === `#${view}` && !item.afterForward.signInOpen);
          item.stage = 'browser-back-and-focus-return';
          item.actions.push({ action: 'browser-back', attempts: 1 }); await page.goBack(); await waitClosed(page);
          await page.waitForFunction(expected => document.activeElement?.matches(expected), selector, { timeout: 5_000 });
          item.afterBack = await snapshot(page);
          check(item, 'Browser Back restores public origin and legal-link focus', page.url() === `${origin}/` && item.afterBack.sentinel === item.id && item.afterBack.focusedLegalView === view && !item.afterBack.focusInert && !item.afterBack.signInOpen);
          item.observedActions = await page.evaluate(() => window.__nativeBrowserActions);
          check(item, 'One trusted entry legal click and one Escape were delivered without retries', item.observedActions.length === 2 && item.observedActions.every(action => action.trusted === true) && item.observedActions[0].legal === view && item.observedActions[1].type === 'escape');
        });
      }
    }
    assert.equal(report.cases.length, 28);
    assert.ok(report.cases.every(item => item.status === 'PASS'));
    assert.equal(report.network.serverErrors, 0);
    assert.equal(report.network.serverNonGetRequestsRejected, 0);
    assert.equal(report.pageErrors.length, 0);
    for (const [relative, sha256] of Object.entries(report.servedInputHashes)) {
      if (report.inputHashes[relative]) assert.equal(sha256, report.inputHashes[relative], 'Declared input changed while serving');
    }
    report.phase = 'complete';
    report.status = 'PASS_LOCAL_PUBLIC_NATIVE_BROWSER';
  };
  try {
    report.phase = 'loopback-server-start';
    server = createServer(async (request, response) => {
      try {
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Security-Policy', policy);
        response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
        if (request.method !== 'GET') { report.network.serverNonGetRequestsRejected++; response.writeHead(405); response.end(); return; }
        const url = new URL(request.url, origin || 'http://127.0.0.1');
        const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
        if ((!relative.startsWith('assets/') && !['index.html', 'manifest.webmanifest'].includes(relative)) || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '.') || relative.includes('\0') || !mimeTypes[path.extname(relative)]) {
          response.writeHead(404); response.end(); return;
        }
        const absolute = path.join(root, relative), actual = await realpath(absolute).catch(() => null);
        if (!actual || !actual.startsWith(absoluteRoot + path.sep)) {
          if (report.network.serverMissingPaths.length < 50) report.network.serverMissingPaths.push(relative);
          response.writeHead(404); response.end(); return;
        }
        if (!bytes.has(relative)) {
          const info = await stat(actual); assert.ok(info.isFile() && info.size <= 40 * 1024 * 1024, 'Static input size/type bound');
          const content = await readFile(actual); bytes.set(relative, content);
          report.servedInputHashes[relative] = digest(content);
        }
        report.network.localGetRequests++; assert.ok(report.network.localGetRequests <= 20_000, 'Static request bound');
        response.setHeader('Content-Type', mimeTypes[path.extname(relative)]); response.end(bytes.get(relative));
      } catch { report.network.serverErrors++; response.writeHead(500); response.end(); }
    });
    server.requestTimeout = 10_000; server.headersTimeout = 10_000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    report.isolation.origin = origin;
    await Promise.race([execute(), new Promise((_, reject) => {
      deadline = setTimeout(() => { expired = true; reject(new Error('Native browser suite exceeded 180 seconds')); }, 180_000);
    })]);
  } catch (error) {
    report.status = 'FAIL_LOCAL_PUBLIC_NATIVE_BROWSER'; report.failedPhase = report.phase; report.failure = safeError(error);
    throw new Error('Native public frontend browser verification failed; inspect the sanitized report and first-action evidence.');
  } finally {
    clearTimeout(deadline);
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    report.finishedAt = new Date().toISOString();
    report.summary = { expectedCases: 28, cases: report.cases.length, passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL').length, checks: report.cases.reduce((sum, item) => sum + item.checks.length, 0), servedFiles: Object.keys(report.servedInputHashes).length };
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === runnerPath) {
  runNativeViewBrowser().catch(error => { console.error(error.message); process.exitCode = 1; });
}
