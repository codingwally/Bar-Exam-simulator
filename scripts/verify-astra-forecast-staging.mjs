import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { completeMandatoryCommercialProfile } from './staging-commercial-user.mjs';
import { createForecastAttemptStore, FORECAST_ATTEMPT_RPC_NAMES } from '../worker/forecast-attempt-store.mjs';

// Deliberately no production mode, configurable target, customer session, mail,
// runtime synthetic flag, direct model invocation, or automatic remote execution.
export const TARGET = Object.freeze({
  site: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
  ref: 'hlzqmreeoghbldnhlybr',
  supabase: 'https://hlzqmreeoghbldnhlybr.supabase.co',
});
const ENDPOINT = '/admin/dd2026/bar-forecast';
const SUBJECT = 'Civil Law and Land Titles and Deeds';
const CONSENT = '2026-09-01';
const RUN_PATTERN = /^astra-durable-\d{13}-[a-f0-9]{8}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runCommand = promisify(execFile);
const digest = (value) => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const meanTenths = (scores) => Math.round(scores.reduce((sum, score) => sum + Math.round(score * 10), 0) / scores.length) / 10;
const VIEWPORTS = Object.freeze([320, 375, 390, 600, 768, 820, 1024, 1280, 1440]);
const DIAGNOSTIC_OPERATIONS = Object.freeze(['status', 'start', 'submit_attempt', 'attempt', 'history', 'retry_attempt', 'result_pdf', 'email_result', 'accept']);
const DIAGNOSTIC_ERROR_CODES = Object.freeze([
  'AUTHENTICATION_REQUIRED', 'INVALID_SESSION', 'AUTH_UNRESOLVED',
  'BAR_FORECAST_ACCESS_REQUIRED', 'BAR_FORECAST_SETUP_REQUIRED', 'BAR_FORECAST_CONSENT_REQUIRED',
  'BAR_FORECAST_CONSENT_NOT_RECORDED', 'BAR_FORECAST_CONTENT_INCOMPLETE', 'BAR_FORECAST_CONTENT_INVALID',
  'BAR_FORECAST_CONTENT_MANIFEST_MISMATCH', 'BAR_FORECAST_SUBJECT_INVALID', 'BAR_FORECAST_SET_CHANGED',
  'BAR_FORECAST_GRADING_CAPACITY', 'BAR_FORECAST_GRADING_INVALID', 'BAR_FORECAST_GRADING_TIMEOUT',
  'BAR_FORECAST_GRADING_UNAVAILABLE', 'BAR_FORECAST_PERSISTENCE_UNAVAILABLE', 'BAR_FORECAST_PROCESSING_FAILED',
  'BAR_FORECAST_PROCESSING_PENDING', 'BAR_FORECAST_ATTEMPT_CONFLICT', 'BAR_FORECAST_REQUEST_TIMEOUT',
  'BAR_FORECAST_REQUEST_SHAPE_INVALID', 'INVALID_JSON', 'UNRECOGNIZED',
]);
const READY_FORECAST_LAUNCHER = '.qfs-practice-rail [data-public-feature="bar-forecast"]:not(:disabled)';
const isolatedBrowserEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|pathext|systemroot|windir|comspec|home|userprofile|localappdata|appdata|temp|tmp|tmpdir|user|logname|ci|display|xdg_runtime_dir|xdg_cache_home|lang|lc_all|ld_library_path)$/iu.test(name)));

// Project a closed schema at both browser and Node boundaries. Never persist
// arbitrary error strings, operation names, response bodies, DOM text or IDs.
export function sanitizeForecastBrowserDiagnostics(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const bool = input => typeof input === 'boolean' ? input : null;
  const count = input => Number.isInteger(input) && input >= 0 && input <= 10000 ? input : null;
  const oneOf = (input, allowed, fallback) => allowed.includes(input) ? input : fallback;
  return {
    schemaVersion: 'astra-forecast-browser-diagnostics-v1',
    probePresent: bool(value.probePresent),
    sessionPresent: bool(value.sessionPresent),
    authReady: oneOf(value.authReady, ['unobserved', 'pending', 'settled', 'rejected'], 'unobserved'),
    route: oneOf(value.route, ['forecast', 'home', 'pricing', 'other'], 'other'),
    rootVisible: bool(value.rootVisible), pickerPresent: bool(value.pickerPresent), editorPresent: bool(value.editorPresent),
    errorPresent: bool(value.errorPresent), launcherReady: bool(value.launcherReady),
    operations: Object.fromEntries(DIAGNOSTIC_OPERATIONS.map(operation => {
      const row = value.operations?.[operation] || {};
      return [operation, {
        requested: count(row.requested), responded: count(row.responded),
        httpStatus: Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599 ? row.httpStatus : null,
        errorCode: row.errorCode == null ? null : oneOf(row.errorCode, DIAGNOSTIC_ERROR_CODES, 'UNRECOGNIZED'),
        transportError: oneOf(row.transportError, ['ABORTED', 'NETWORK_ERROR'], null),
      }];
    })),
  };
}

export function forecastBrowserDiagnosticsSource() {
  return `(() => {
    const probe=window.__astraForecastProbe;
    const visible=node=>Boolean(node && !node.hidden && node.getClientRects().length && !node.closest('[inert],[aria-hidden="true"]'));
    const session=window.DueDiligencePhase2?.getSession?.();
    const raw={probePresent:Boolean(probe),sessionPresent:Boolean(session?.access_token),authReady:probe?.authReady,
      route:location.hash==='#bar-forecast-2026'?'forecast':['','#quorum'].includes(location.hash)?'home':location.hash==='#pricing'?'pricing':'other',
      rootVisible:visible(document.getElementById('bf26-root')),
      pickerPresent:visible(document.querySelector('.bf26-subject-grid')),
      editorPresent:visible(document.querySelector('#bf26-current-answer')),
      errorPresent:Boolean(document.querySelector('[data-bf26-status][data-kind="error"],.bf26-view [role="alert"]')),
      launcherReady:visible(document.querySelector(${JSON.stringify(READY_FORECAST_LAUNCHER)})),operations:probe?.operations};
    const DIAGNOSTIC_OPERATIONS=${JSON.stringify(DIAGNOSTIC_OPERATIONS)};
    const DIAGNOSTIC_ERROR_CODES=${JSON.stringify(DIAGNOSTIC_ERROR_CODES)};
    return (${sanitizeForecastBrowserDiagnostics.toString()})(raw);
  })()`;
}

export async function openForecastFromReadyLauncher({ waitReady, clickLauncher, waitPicker, readRoute, setStep = () => {} }) {
  setStep('home-ready'); await waitReady();
  setStep('launcher-click'); await clickLauncher(); // One real click; no retry or alternate opener.
  setStep('picker'); await waitPicker();
  assert.equal(await readRoute(), true, 'The public launcher must restore the actual Forecast route');
}

export async function captureForecastFailureDiagnostics({ readDiagnostics, saveDiagnostics }) {
  const safe = sanitizeForecastBrowserDiagnostics(await readDiagnostics());
  await saveDiagnostics(safe);
  return safe;
}

// Keep daemon socket identities short on Linux without weakening per-run or
// per-account isolation. The full fixture prefix remains in every data journal.
export function browserIdentity(prefix, kind) {
  assert.match(prefix, RUN_PATTERN);
  assert.ok(['member', 'other', 'unpaid', 'local'].includes(kind));
  return Object.freeze({ namespace: `ad-${digest(prefix).slice(0, 16)}`, session: kind });
}

export function assertBrowserSocketBudget(identity, environment, platform = process.platform) {
  if (platform === 'win32') return null; // Pinned CLI uses TCP on Windows.
  const base = environment.XDG_RUNTIME_DIR ? path.posix.join(environment.XDG_RUNTIME_DIR, 'agent-browser')
    : environment.HOME ? path.posix.join(environment.HOME, '.agent-browser') : path.posix.join(environment.TMPDIR || '/tmp', 'agent-browser');
  const bytes = Buffer.byteLength(path.posix.join(base, 'namespaces', identity.namespace, 'run', `${identity.session}.sock`));
  // agent-browser0.36.0 connection.rs rejects more than103bytes before spawning.
  assert.ok(bytes <= 103, 'The isolated browser socket exceeds the pinned Linux CLI path limit.');
  return bytes;
}

export function safeBrowserFailure(error, action) {
  const source = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`;
  const category = /(?:socket|address|path|session name).{0,100}(?:too long|length)|sun_path/isu.test(source) ? 'SOCKET_PATH_LENGTH'
    : /executable.{0,80}(?:missing|does not exist|not found)|browser.{0,80}not installed/isu.test(source) ? 'BROWSER_NOT_INSTALLED'
      : /daemon.{0,80}(?:failed|start|connect)/isu.test(source) ? 'DAEMON_START_OR_CONNECTION'
        : error?.killed === true ? 'BROWSER_COMMAND_TIMEOUT' : 'BROWSER_COMMAND_FAILED';
  return Object.freeze({ action: ['open', 'close', 'eval', 'snapshot', 'click', 'find', 'set', 'screenshot', 'reload'].includes(action) ? action : 'open',
    category, exitCode: Number.isInteger(error?.code) && error.code >= 0 && error.code <= 255 ? error.code : null,
    killed: error?.killed === true, outputSha256: digest(source) });
}

export function assertPrivateEvidenceDir(directory) {
  const resolved = path.resolve(directory);
  for (const published of ['assets', 'public', 'dist', 'build']) {
    const relative = path.relative(path.join(root, published), resolved);
    assert.ok(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'Evidence must never be placed in a published directory');
  }
  return resolved;
}

export function assertPrivateTemp(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.match(path.basename(resolved), /^dd-astra-durable-[A-Za-z0-9]+$/u);
  return resolved;
}

export function assertStagingUrl(value) {
  const url = new URL(value);
  assert.ok([TARGET.site, TARGET.supabase].includes(url.origin), 'Only the pinned staging origins are allowed');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.username + url.password, '');
  return url;
}

export function parseBrowserResult(output) {
  let value = JSON.parse(output.trim());
  if (value && typeof value === 'object' && 'success' in value) {
    assert.equal(value.success, true, 'The isolated browser command failed');
    value = value.data && Object.hasOwn(value.data, 'result') ? value.data.result : value.data;
  }
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } }
  return value;
}

export function assertFixtureRecord(record, prefix) {
  assert.match(prefix, RUN_PATTERN);
  assert.match(record?.id || '', UUID);
  assert.ok(['member', 'other', 'unpaid'].includes(record.kind), 'Unknown fixture role');
  assert.equal(record.email, `${prefix}-${record.kind}@example.com`);
}

export function assertCanonical(attempt, ownerId, expectedAnswers) {
  assert.equal(attempt?.status, 'complete', 'A final report must be complete');
  assert.equal(attempt.resultRevision, 1);
  assert.equal(attempt.questionCount, 20);
  assert.equal(attempt.completedQuestionCount, 20);
  assert.equal(attempt.questions?.length, 20);
  assert.equal(attempt.answers?.length, 20);
  assert.equal(expectedAnswers.length, 20);
  assert.equal(new Set(attempt.questions.map((row) => row.id)).size, 20);
  const result = attempt.result;
  assert.equal(result?.ownerId, ownerId);
  assert.equal(result.attemptId, attempt.id);
  assert.equal(result.subject, attempt.subject);
  assert.equal(result.setId, attempt.setId);
  assert.equal(result.resultRevision, attempt.resultRevision);
  assert.equal(result.complete, true);
  assert.equal(result.results?.length, 20);
  assert.equal(result.maxScore, 100);
  assert.equal(result.percentage, result.totalScore);
  assert.equal(Number(result.results.reduce((sum, row) => sum + row.score, 0).toFixed(1)), result.totalScore);
  assert.deepEqual(result.results.map((row) => row.number), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(result.results.map((row) => row.questionId), attempt.questions.map((row) => row.id));
  assert.deepEqual(result.results.map((row) => row.userAnswer), expectedAnswers);
  assert.deepEqual(attempt.answers.map((row) => row.answer), expectedAnswers);
  assert.equal(result.analytics.grammarAverage, meanTenths(result.results.map((row) => row.grammar.score)));
  assert.equal(result.analytics.issueSpottingAverage, meanTenths(result.results.map((row) => row.issueSpotting.score)));
  for (const row of result.results) {
    assert.ok(row.question && row.suggestedAnswer && row.explanation && row.mockBarCoaching?.strength && row.mockBarCoaching?.nextStep);
    assert.equal(row.maxScore, 5);
    for (const score of [row.score, row.grammar.score, row.issueSpotting.score]) assert.ok(Number.isFinite(score) && score >= 0 && score <= 5);
  }
  return { totalScore: result.totalScore, maxScore: result.maxScore, percentage: result.percentage,
    grammar: result.analytics.grammarAverage, issueSpotting: result.analytics.issueSpottingAverage,
    resultRevision: result.resultRevision, canonicalSha256: digest(result) };
}

function fixtureAnswer(prefix, journey, number) {
  const text = `${prefix} journey ${journey} answer ${number}. The controlling rule must be applied to each material fact and every required legal element before reaching a supported conclusion.`;
  return number === 20 ? `${text} Final editor capture: ₱149, Señor Niño, café.` : text;
}

// A DOM click does not await its async request handler. Observe the real 202
// retry acknowledgement before reading the committed state; keep one strict
// timeout even if a read never resolves. This helper never retries a mutation.
export async function waitForSavedRetry({ expectedAttempt, readAcknowledgement, readAttempt,
  timeoutMs = 35000, pollMs = 250 }) {
  assert.match(expectedAttempt?.id || '', UUID);
  assert.match(expectedAttempt?.clientAttemptId || '', UUID);
  assert.equal(expectedAttempt.status, 'failed');
  assert.equal(expectedAttempt.questionCount, 20);
  assert.equal(expectedAttempt.questions?.length, 20);
  assert.equal(expectedAttempt.answers?.length, 20);
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 35000);
  assert.ok(Number.isInteger(pollMs) && pollMs > 0 && pollMs <= 1000);
  const immutableSnapshot = (attempt) => digest({ id: attempt?.id, clientAttemptId: attempt?.clientAttemptId,
    subject: attempt?.subject, setId: attempt?.setId, questionCount: attempt?.questionCount,
    questions: attempt?.questions, answers: attempt?.answers });
  const expected = immutableSnapshot(expectedAttempt);
  const activeStatuses = new Set(['pending', 'processing', 'retryable_failed', 'complete']);
  let stopped = false; let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => { stopped = true; reject(new Error('Saved retry did not commit within the bounded staging wait')); }, timeoutMs);
  });
  const observe = async () => {
    while (!stopped) {
      const acknowledgement = await readAcknowledgement();
      if (stopped) return;
      if (acknowledgement) {
        assert.equal(acknowledgement.httpStatus, 202, 'The retry must be accepted by the real API');
        assert.equal(acknowledgement.id, expectedAttempt.id, 'Retry acknowledgement changed the saved attempt');
        assert.equal(acknowledgement.clientAttemptId, expectedAttempt.clientAttemptId, 'Retry acknowledgement changed the submission identity');
        assert.ok(activeStatuses.has(acknowledgement.status), 'Retry acknowledgement must be an active or complete state');
        while (!stopped) {
          const attempt = await readAttempt();
          if (stopped) return;
          assert.equal(immutableSnapshot(attempt), expected, 'Retry must preserve the same saved identity and all 20 exact answers');
          if (activeStatuses.has(attempt.status)) return attempt;
          assert.equal(attempt.status, 'failed', 'Unexpected saved retry state');
          await delay(pollMs);
        }
      }
      await delay(pollMs);
    }
  };
  try { return await Promise.race([observe(), expired]); }
  finally { stopped = true; clearTimeout(timeout); }
}

export function assertControlledCoverage(result, { requireFailure = false, requireSlow = false } = {}) {
  assert.equal(result?.attempt?.status, 'complete', 'The controlled journey still requires a complete saved report');
  assert.ok(Number.isInteger(result.controlledBatches) && result.controlledBatches >= 0 && result.controlledBatches <= 5);
  if (requireFailure || requireSlow) assert.ok(result.controlledBatches > 0, 'The scheduler completed before the required controlled scenario ran');
  if (requireFailure) assert.equal(result.failureRetryExercised, true, 'The terminal failure and acknowledged retry must actually be exercised');
  if (requireSlow) assert.equal(result.slowProgressLossExercised, true, 'The held lease and lost progress response must actually be exercised');
  return result;
}

// Installed only in our fresh browser context. It observes real fetches and
// optionally loses one ACCEPTED response; it never supplies a successful grade.
export function probeSource() {
  return `(() => {
    const original = window.fetch.bind(window);
    const operations=${JSON.stringify(DIAGNOSTIC_OPERATIONS)};
    const errorCodes=${JSON.stringify(DIAGNOSTIC_ERROR_CODES)};
    const probe = window.__astraForecastProbe = { counts: {}, operations:Object.fromEntries(operations.map(name=>[name,{requested:0,responded:0,httpStatus:null,errorCode:null,transportError:null}])),
      authReady:'unobserved',accepted: null, acceptedResponses: 0, retry: null, dropAcceptance: false, loseNextAttempt: false };
    const observeAuth=()=>{
      if(probe.authReady!=='unobserved' || typeof window.DueDiligencePhase2?.whenAuthReady!=='function') return;
      probe.authReady='pending';
      Promise.resolve().then(()=>window.DueDiligencePhase2.whenAuthReady()).then(()=>{probe.authReady='settled';},()=>{probe.authReady='rejected';});
    };
    window.addEventListener?.('DOMContentLoaded',observeAuth,{once:true});
    observeAuth();
    window.fetch = async (...args) => {
      let input;
      try { input = JSON.parse(args[1]?.body || '{}'); } catch {}
      const forecast = String(args[0]?.url || args[0]).includes('${ENDPOINT}');
      const operation=forecast && operations.includes(input?.operation)?input.operation:null;
      const row=operation?probe.operations[operation]:null;
      if (row) { probe.counts[operation] = Math.min(10000,(probe.counts[operation] || 0) + 1); row.requested=Math.min(10000,row.requested+1); }
      if (forecast && input?.operation === 'attempt' && probe.loseNextAttempt) {
        probe.loseNextAttempt = false; throw new TypeError('Controlled staging progress-response loss');
      }
      let response;
      try { response = await original(...args); }
      catch(error) { if(row) row.transportError=error?.name==='AbortError'?'ABORTED':'NETWORK_ERROR'; throw error; }
      if(row) {
        row.responded=Math.min(10000,row.responded+1); row.httpStatus=response.status; row.errorCode=null; row.transportError=null;
        const responseOrdinal=row.responded;
        if(!response.ok) response.clone().json().then(payload=>{
          if(row.responded===responseOrdinal) row.errorCode=errorCodes.includes(payload?.error?.code)?payload.error.code:'UNRECOGNIZED';
        },()=>{if(row.responded===responseOrdinal) row.errorCode='INVALID_JSON';});
      }
      if (forecast && input?.operation === 'submit_attempt' && response.ok) {
        const accepted = await response.clone().json();
        probe.accepted = { id: accepted.attempt?.id, clientAttemptId: accepted.attempt?.clientAttemptId, status: response.status };
        probe.acceptedResponses += 1;
        if (probe.dropAcceptance) { probe.dropAcceptance = false; throw new TypeError('Controlled staging acceptance-response loss'); }
      }
      if (forecast && input?.operation === 'retry_attempt') {
        const retried = await response.clone().json();
        probe.retry = { id: retried.attempt?.id, clientAttemptId: retried.attempt?.clientAttemptId,
          status: retried.attempt?.status, httpStatus: response.status };
      }
      return response;
    };
  })();`;
}

// Reads actual layout without changing application data or clicking any control.
// CSS zoom is an explicitly labelled stress test, not native browser zoom evidence.
export function geometrySource(surface) {
  assert.ok(['editor', 'report'].includes(surface));
  return `(async () => {
    const surface=${JSON.stringify(surface)};
    const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const page=document.querySelector('.bf26-page');
    if(!page) throw new Error('Forecast surface is missing');
    const controls=surface==='editor'
      ? [['last-answer',document.querySelector('#bf26-current-answer')],['submit',[...document.querySelectorAll('.bf26-exam-footer button')].find(node=>node.textContent==='Submit all answers')]]
      : [['last-question',document.querySelector('details.bf26-result:last-of-type summary') || [...document.querySelectorAll('details.bf26-result summary')].at(-1)],
          ...['Download PDF','Email to me'].map(label=>[label,[...document.querySelectorAll('.bf26-results button')].find(node=>node.textContent===label)])];
    const rows=[];
    for(const [name,node] of controls) {
      if(!node) { rows.push({name,present:false,reachable:false}); continue; }
      node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); await nextFrame();
      const rect=node.getBoundingClientRect();
      const x=Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2));
      const y=Math.max(0,Math.min(innerHeight-1,rect.top+rect.height/2));
      const hit=document.elementFromPoint(x,y);
      rows.push({name,present:true,disabled:Boolean(node.disabled),width:Math.round(rect.width),
        left:Math.round(rect.left),right:Math.round(rect.right),
        reachable:rect.width>0 && rect.height>0 && rect.left>=-2 && rect.right<=innerWidth+2
          && rect.bottom>0 && rect.top<innerHeight && Boolean(hit&&(hit===node||node.contains(hit)))});
    }
    const overflow=Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,
      page.scrollWidth-page.clientWidth);
    return {surface,width:innerWidth,height:innerHeight,cssZoom:Number(getComputedStyle(document.documentElement).zoom)||1,
      horizontalOverflowPx:Math.round(overflow),controls:rows};
  })()`;
}

export function assertGeometry(result) {
  assert.ok(result && ['editor', 'report'].includes(result.surface));
  assert.ok(result.horizontalOverflowPx <= 2, 'Forecast has horizontal overflow at this viewport');
  assert.equal(result.controls?.length, result.surface === 'editor' ? 2 : 3);
  assert.ok(result.controls.every((control) => control.present && control.reachable && !control.disabled), 'A required Forecast control is not reachable');
}

async function browserLauncher() {
  if (process.platform !== 'win32') return { command: 'npx', prefix: ['--yes', 'agent-browser@0.36.0'] };
  const candidates = [process.env.AGENT_BROWSER_NPX_CLI,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
    path.join(path.dirname(process.execPath), '../node_modules/npm/bin/npx-cli.js')].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return { command: process.execPath, prefix: [candidate, '--yes', 'agent-browser@0.36.0'] }; } catch {}
  }
  throw new Error('Set AGENT_BROWSER_NPX_CLI to the installed npm npx-cli.js on Windows');
}

export async function verifyStaging({ preflightOnly = false, cleanupManifestPath = null } = {}) {
  const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(typeof key === 'string' && key.length > 30, 'Protected staging credentials are required');
  if (key.startsWith('eyJ')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (claims.ref) assert.equal(claims.ref, TARGET.ref, 'Service key must belong to staging');
  }
  let recovery = null;
  if (cleanupManifestPath) {
    assert.equal(path.basename(cleanupManifestPath), 'cleanup-manifest.json');
    recovery = JSON.parse(await readFile(path.resolve(cleanupManifestPath), 'utf8'));
    assert.equal(recovery.schemaVersion, 1); assert.equal(recovery.target, TARGET.ref); assert.match(recovery.prefix, RUN_PATTERN);
    assert.ok(Array.isArray(recovery.fixtures) && recovery.fixtures.length <= 3);
    assert.equal(new Set(recovery.fixtures.map((record) => record.id)).size, recovery.fixtures.length);
    for (const record of recovery.fixtures) {
      assertFixtureRecord(record, recovery.prefix);
      assert.ok(Array.isArray(record.attemptIds) && record.attemptIds.length <= 3);
      for (const id of record.attemptIds) assert.match(id, UUID);
    }
  }
  const prefix = recovery?.prefix || `astra-durable-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const evidenceDir = assertPrivateEvidenceDir(recovery ? path.dirname(path.resolve(cleanupManifestPath))
    : path.join(process.env.ASTRA_FORECAST_EVIDENCE_DIR || path.join(root, 'artifacts/astra-forecast-staging'), prefix));
  await mkdir(evidenceDir, { recursive: true });
  const privateDir = await mkdtemp(path.join(tmpdir(), 'dd-astra-durable-'));
  const statePath = path.join(privateDir, 'auth-state.json');
  const configPath = path.join(privateDir, 'browser-config.json');
  const initPath = path.join(privateDir, 'probe.js');
  const manifestPath = path.join(evidenceDir, 'cleanup-manifest.json');
  const checks = []; const fixtures = recovery?.fixtures || []; const journeys = []; const geometry = [];
  const summary = { schemaVersion: 'astra-forecast-staging-v1', sourceSha: process.env.GITHUB_SHA || null,
    target: 'staging-only', mode: recovery ? 'fixture-cleanup-recovery' : preflightOnly ? 'read-only-preflight' : 'authenticated-three-journey-verification',
    fixturePrefix: prefix, verificationComplete: false, cleanupComplete: false,
    nativeBrowserZoomVerified: false, zoomEvidence: 'CLI has no native zoom command; separately labelled CSS 200% zoom stress test only.',
    gradingEvidence: 'One scheduled real-provider journey; two explicitly controlled SQL checkpoint journeys. No mail sent.', checks, journeys, geometry };
  let stage = 'preflight'; let browserSession = null; let launcher; let member; let publishable;
  const deadline = Date.now() + 35 * 60 * 1000;
  let stopRequested = false;
  const stop = () => { stopRequested = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const checkDeadline = () => assert.ok(!stopRequested && Date.now() < deadline, 'The bounded staging verification window ended');
  const safeRequest = async (url, options = {}, statuses = [200]) => {
    const target = assertStagingUrl(url);
    const response = await fetch(target, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let body = null; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch {}
    assert.ok(statuses.includes(response.status), `Staging ${options.method || 'GET'} ${target.pathname} returned ${response.status}`);
    return { response, body, bytes };
  };
  const serviceHeaders = { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
  const service = async (route, options = {}, statuses = [200]) => (await safeRequest(`${TARGET.supabase}${route}`, { ...options, headers: { ...serviceHeaders, ...options.headers } }, statuses)).body;
  const api = (account, body, statuses = [200]) => safeRequest(`${TARGET.site}${ENDPOINT}`, {
    method: 'POST', headers: { Authorization: `Bearer ${account.session.access_token}`, Origin: TARGET.site,
      'Content-Type': 'application/json', 'X-Request-ID': randomUUID() }, body: JSON.stringify(body),
  }, statuses);
  const persistManifest = () => writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, target: TARGET.ref, prefix,
    fixtures: fixtures.map(({ id, email, kind, attemptIds = [] }) => ({ id, email, kind, attemptIds })) }, null, 2), { mode: 0o600 });
  const browserEnv = isolatedBrowserEnv();
  let collectingFailureDiagnostics = false;
  const browser = async (...args) => {
    if (args[0] !== 'close' && !collectingFailureDiagnostics) checkDeadline();
    try {
      const script = args[0] === 'eval' ? args[1] : null;
      const cliArgs = script === null ? args : ['eval', '--stdin'];
      const pending = runCommand(launcher.command, [...launcher.prefix, '--namespace', browserIdentity(prefix, 'local').namespace, '--session', browserSession,
        '--config', configPath, '--restore-save', 'never', '--json', ...cliArgs],
      { timeout: collectingFailureDiagnostics ? 10000 : 60000, maxBuffer: 1000000, windowsHide: true, env: { ...browserEnv, AGENT_BROWSER_DEFAULT_TIMEOUT: '30000' } });
      if (script !== null) {
        pending.child.stdin.on('error', () => {}); // exec's promise reports a failed command; keep fixture cleanup reachable on EPIPE.
        pending.child.stdin.end(script);
      }
      const result = await pending;
      return result.stdout;
    } catch (error) {
      const failure = new Error('An isolated staging browser command failed.');
      failure.code = 'ASTRA_BROWSER_COMMAND_FAILED';
      failure.browserDiagnostic = safeBrowserFailure(error, args[0]);
      throw failure;
    }
  };
  const evaluate = async (source) => parseBrowserResult(await browser('eval', source));
  const browserWait = async (predicate, timeout = 35000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { checkDeadline(); if (await evaluate(`Boolean(${predicate})`)) return; await delay(500); }
    throw new Error('A bounded browser state did not become available');
  };
  const browserSnapshot = async () => { await browser('snapshot', '-i'); };
  const clickText = async (name) => { await browserSnapshot(); await browser('find', 'role', 'button', 'click', '--name', name); };
  const closeForecast = async () => { await browserSnapshot(); await browser('click', '.bf26-close'); };
  const closeAndReopenForecast = async (label) => {
    const originalStage = stage;
    stage = `${label}-close`; await closeForecast();
    await openForecastFromReadyLauncher({
      setStep: step => { stage = `${label}-${step}`; },
      waitReady: () => browserWait(`(() => { const node=document.querySelector(${JSON.stringify(READY_FORECAST_LAUNCHER)}); return Boolean(node && node.getClientRects().length && !node.closest('[inert],[aria-hidden="true"]')); })()`),
      clickLauncher: async () => { await browserSnapshot(); await browser('click', READY_FORECAST_LAUNCHER); },
      waitPicker: () => browserWait('document.querySelector(".bf26-subject-grid")'),
      readRoute: () => evaluate('location.hash === "#bar-forecast-2026"'),
    });
    stage = originalStage;
  };
  const screen = (name) => browser('screenshot', path.join(evidenceDir, `${name}.png`));
  const store = createForecastAttemptStore({ rpc: async (_env, name, args) => {
    assert.ok(FORECAST_ATTEMPT_RPC_NAMES.includes(name));
    return service(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
  } });
  const ownedAttempt = async (account, id) => (await api(account, { operation: 'attempt', attemptId: id })).body.attempt;
  const batches = async (id) => service(`/rest/v1/dd2026_forecast_batches?attempt_id=eq.${id}&select=batch_index,status,executions,uncertain_outcomes&order=batch_index`);

  async function verifyGeometry(surface) {
    const originalStage = stage;
    try {
      for (const width of VIEWPORTS) {
        stage = `geometry-${surface}-${width}`;
        await browser('set', 'viewport', String(width), '900');
        if (surface === 'report') await evaluate("(() => { for(const item of document.querySelectorAll('details.bf26-result')) item.open=true; return true; })()");
        const measurement = await evaluate(geometrySource(surface));
        geometry.push({ ...measurement, test: 'actual-rendered-viewport' }); assertGeometry(measurement);
        if (width === 390 || width === 1280) await screen(`geometry-${surface}-${width}`);
      }
      stage = `geometry-${surface}-css-zoom-200`;
      await browser('set', 'viewport', '1280', '900');
      await evaluate("document.documentElement.style.zoom='2'");
      const zoomed = await evaluate(geometrySource(surface));
      geometry.push({ ...zoomed, test: 'css-zoom-200-percent-not-native-browser-zoom' });
      assert.equal(zoomed.cssZoom, 2); assertGeometry(zoomed);
      await screen(`geometry-${surface}-css-zoom-200`);
      stage = originalStage;
    } finally {
      await evaluate("document.documentElement.style.zoom=''").catch(() => {});
      await browser('set', 'viewport', '1280', '900').catch(() => {});
    }
  }

  async function createFixture(kind, entitled) {
    const email = `${prefix}-${kind}@example.com`; const password = `Dd!${randomBytes(32).toString('base64url')}`;
    const created = await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true,
      user_metadata: { full_name: 'Astra isolated staging verification', internal_test: true, astra_fixture_prefix: prefix } }) }, [200, 201]);
    const account = { id: created.id, email, kind, attemptIds: [] }; assertFixtureRecord(account, prefix); fixtures.push(account); await persistManifest();
    const signedIn = await safeRequest(`${TARGET.supabase}/auth/v1/token?grant_type=password`, { method: 'POST',
      headers: { apikey: publishable, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    account.session = signedIn.body; assert.equal(account.session.user.id, account.id);
    const [settings] = await service('/rest/v1/platform_access_settings?singleton=eq.true&select=current_terms_version,current_privacy_version');
    await safeRequest(`${TARGET.supabase}/rest/v1/rpc/accept_terms`, { method: 'POST', headers: { apikey: publishable,
      Authorization: `Bearer ${account.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      p_terms_version: settings.current_terms_version, p_privacy_version: settings.current_privacy_version, p_acceptance_source: 'astra_durable_staging_verification' }) }, [200, 204]);
    await completeMandatoryCommercialProfile({ supabaseUrl: TARGET.supabase, publishableKey: publishable, workerUrl: TARGET.site,
      token: account.session.access_token, displayName: 'Astra isolated staging verification',
      termsVersion: settings.current_terms_version, privacyVersion: settings.current_privacy_version });
    if (entitled) {
      await service('/rest/v1/free_beta_access?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({
        user_id: account.id, enabled: true, expires_at: new Date(Date.now() + 3600000).toISOString(), reason: prefix,
        created_by: account.id, updated_by: account.id, access_program: 'founding_beta_2026' }) }, [200, 201, 204]);
      await api(account, { operation: 'accept', version: CONSENT });
    }
    return account;
  }

  async function startBrowser(account) {
    stage = `browser-start-${account.kind}`;
    if (browserSession) await browser('close');
    browserSession = browserIdentity(prefix, account.kind).session;
    await writeFile(statePath, JSON.stringify({ cookies: [], origins: [{ origin: TARGET.site,
      localStorage: [{ name: `sb-${TARGET.ref}-auth-token`, value: JSON.stringify(account.session) }] }] }), { mode: 0o600 });
    await browser('--state', statePath, '--init-script', initPath, 'open', `${TARGET.site}/#bar-forecast-2026`);
  }

  async function openSaved(index = 0) {
    await clickText('Saved attempts');
    await browserWait('document.querySelectorAll(".bf26-history-row button").length>0');
    await browserSnapshot();
    await evaluate(`(() => { const button=document.querySelectorAll('.bf26-history-row button')[${index}]; if(!button) throw new Error('Saved attempt absent'); button.click(); return true; })()`);
  }

  async function acceptBrowserJourney(number, dropAcceptance = false) {
    stage = `journey-${number}-picker`;
    await browserWait('document.querySelector(".bf26-subject-grid")'); await browserSnapshot();
    assert.equal(await evaluate('location.hash === "#bar-forecast-2026"'), true);
    stage = `journey-${number}-subject-start`;
    await browser('click', `[data-subject="${SUBJECT}"]`);
    stage = `journey-${number}-editor`;
    await browserWait('document.querySelector("#bf26-current-answer")');
    await browserSnapshot();
    const answers = Array.from({ length: 20 }, (_, index) => fixtureAnswer(prefix, number, index + 1));
    const entered = await evaluate(`(() => {
      const answers=${JSON.stringify(answers)};
      for(let i=0;i<19;i++) {
        const editor=document.getElementById('bf26-current-answer'); if(!editor) throw new Error('Editor missing');
        editor.textContent=answers[i]; editor.dispatchEvent(new Event('input',{bubbles:true}));
        const next=[...document.querySelectorAll('.bf26-exam-footer button')].find(b=>b.textContent==='Next');
        if(!next || next.disabled) throw new Error('Next question unavailable'); next.click();
      }
      const editor=document.getElementById('bf26-current-answer');
      editor.textContent=answers[19].split(' Final editor capture:')[0];
      editor.dispatchEvent(new Event('input',{bubbles:true}));
      return {edited:20};
    })()`);
    assert.equal(entered.edited, 20);
    if (number === 1) await verifyGeometry('editor');
    stage = `journey-${number}-acceptance`;
    await browserSnapshot();
    // All answers already meet the minimum. Change the final editor after its
    // last input event, then immediately click the real enabled submit control.
    // This catches loss of the latest keystrokes without bypassing UI validation.
    await evaluate(`(() => {
      window.__astraForecastProbe.accepted=null;
      window.__astraForecastProbe.acceptedResponses=0;
      window.__astraForecastProbe.dropAcceptance=${dropAcceptance};
      const editor=document.getElementById('bf26-current-answer'); editor.textContent=${JSON.stringify(answers[19])};
      const submit=[...document.querySelectorAll('.bf26-exam-footer button')].find(b=>b.textContent==='Submit all answers');
      if(!submit || submit.disabled) throw new Error('Final submission is not enabled');
      const previousConfirm=window.confirm; window.confirm=()=>true;
      try { submit.click(); } finally { window.confirm=previousConfirm; }
      return true;
    })()`);
    await browserWait('window.__astraForecastProbe?.accepted?.id');
    const accepted = await evaluate('window.__astraForecastProbe.accepted');
    assert.equal(accepted.status, 202); assert.match(accepted.id, UUID); assert.match(accepted.clientAttemptId, UUID);
    member.attemptIds.push(accepted.id); await persistManifest();
    if (dropAcceptance) {
      await browserWait('document.body.textContent.includes("Submission not yet confirmed.")'); await screen(`journey-${number}-lost-acceptance-retained`);
      await clickText('Retry saved submission');
      await browserWait('window.__astraForecastProbe.acceptedResponses===2 && !document.body.textContent.includes("Submission not yet confirmed.")');
      const replay = await evaluate('window.__astraForecastProbe.accepted'); assert.equal(replay.id, accepted.id); assert.equal(replay.clientAttemptId, accepted.clientAttemptId);
      const rows = await service(`/rest/v1/dd2026_forecast_attempts?owner_id=eq.${member.id}&client_attempt_id=eq.${accepted.clientAttemptId}&select=id`);
      assert.equal(rows.length, 1); checks.push('accepted-response-loss-reuses-one-client-id');
    }
    const snapshot = await ownedAttempt(member, accepted.id);
    assert.deepEqual(snapshot.answers.map((row) => row.answer), answers, 'All20 real browser answers including final editor must persist');
    if (dropAcceptance) {
      const changed = snapshot.answers.map((row, index) => ({ ...row, answer: index === 19 ? `${row.answer} Changed resubmission.` : row.answer }));
      const denied = await api(member, { operation: 'submit_attempt', subject: snapshot.subject, setId: snapshot.setId,
        clientAttemptId: accepted.clientAttemptId, answers: changed }, [409]);
      assert.equal(denied.response.status, 409);
      assert.deepEqual((await ownedAttempt(member, accepted.id)).answers, snapshot.answers);
      checks.push('same-client-id-changed-answer-rejected-with-snapshot-unchanged');
    }
    await screen(`journey-${number}-answers-saved`);
    return { id: accepted.id, answers, clientAttemptId: accepted.clientAttemptId };
  }

  async function waitForRealReport(id) {
    let lastProgress = -1;
    while (Date.now() < deadline) {
      checkDeadline(); const attempt = await ownedAttempt(member, id);
      if (attempt.status === 'complete') return attempt;
      assert.notEqual(attempt.status, 'failed', 'Real-provider grading reached terminal failure');
      assert.equal(attempt.result, null, 'Incomplete real-provider grading must not expose a final score');
      if (attempt.completedQuestionCount !== lastProgress) {
        lastProgress = attempt.completedQuestionCount;
        process.stdout.write(`ASTRA_FORECAST_STAGING: real-provider progress ${lastProgress}/20\n`);
      }
      await delay(10000);
    }
    throw new Error('Real-provider completion exceeded the bounded staging window');
  }

  async function controlledComplete(id, failFirst = false, slow = false) {
    const requiredCoverage = { requireFailure: failFirst, requireSlow: slow };
    let controlledBatches = 0;
    let failureRetryExercised = false; let slowProgressLossExercised = false;
    const complete = (attempt) => assertControlledCoverage({ attempt, controlledBatches,
      observedWorkerBatches: 5 - controlledBatches, failureRetryExercised, slowProgressLossExercised }, requiredCoverage);
    for (let index = 0; index < 5; index++) {
      let claim;
      const until = Math.min(deadline, Date.now() + 11 * 60 * 1000);
      while (Date.now() < until) {
        checkDeadline(); claim = await store.claim({}, { attemptId: id });
        if (claim.claimed || claim.readyToFinalize) break;
        const current = await ownedAttempt(member, id);
        if (current.status === 'complete') return complete(current);
        assert.notEqual(current.status, 'failed', 'Unexpected terminal grading failure while waiting for a fixture lease');
        await delay(2000); // Never steal the scheduler's live lease.
      }
      assert.ok(claim?.claimed || claim?.readyToFinalize, 'Fixture could not safely obtain its own processing lease');
      if (claim.readyToFinalize) break;
      assert.equal(claim.attemptId, id); assert.equal(claim.ownerId, member.id); assert.equal(claim.rows.length, 4);
      if (failFirst) {
        await assert.rejects(store.checkpoint({}, claim, { results: [] }), { code: 'BAR_FORECAST_GRADING_INVALID' });
        await store.fail({}, claim, { code: 'BAR_FORECAST_GRADING_INVALID' });
        const failed = await ownedAttempt(member, id); assert.equal(failed.status, 'failed'); assert.equal(failed.result, null);
        await openSaved(); await browserWait('document.body.textContent.includes("Assessment needs attention.")');
        await screen('journey-3-controlled-failure-no-zero');
        await evaluate('window.__astraForecastProbe.retry=null');
        await clickText('Retry assessment');
        await waitForSavedRetry({ expectedAttempt: failed,
          readAcknowledgement: () => evaluate('window.__astraForecastProbe.retry'),
          readAttempt: () => ownedAttempt(member, id),
          timeoutMs: Math.max(1, Math.min(35000, deadline - Date.now())),
        });
        failureRetryExercised = true;
        failFirst = false; index -= 1; continue;
      }
      if (slow && controlledBatches === 0) {
        await evaluate('window.__astraForecastProbe.loseNextAttempt=true');
        await delay(20000);
        assert.equal(await evaluate('window.__astraForecastProbe.loseNextAttempt'), false, 'The controlled progress-response loss must actually occur');
        const pending = await ownedAttempt(member, id); assert.equal(pending.result, null);
        await screen('journey-2-controlled-slow-processing');
        await closeAndReopenForecast('journey-2-slow-reopen'); await openSaved();
        slowProgressLossExercised = true;
      }
      const scores = { results: claim.rows.map((row) => ({ questionId: row.id, score: 4,
        grammar: { score: 3, corrections: [] }, issueSpotting: { score: 4, identified: [], missed: [] } })) };
      const saved = await store.checkpoint({}, claim, scores); controlledBatches += 1;
      if (saved.readyToFinalize) break;
    }
    await store.finalize({}, id);
    const attempt = await ownedAttempt(member, id);
    return complete(attempt);
  }

  async function verifySavedSurfaces(journey, number) {
    stage = `journey-${number}-reload-report`;
    const attempt = await ownedAttempt(member, journey.id);
    const grade = assertCanonical(attempt, member.id, journey.answers);
    const executionBefore = await batches(journey.id);
    await browser('reload'); await browserWait('document.querySelector(".bf26-subject-grid")'); await openSaved();
    await browserWait('document.querySelector(".bf26-results")'); await browserSnapshot();
    assert.equal(await evaluate('document.querySelectorAll("details.bf26-result").length'), 20);
    assert.equal(await evaluate('document.querySelector(".bf26-grade strong").textContent'), `${grade.totalScore} / 100`);
    await screen(`journey-${number}-complete-report`);
    if (number === 1) await verifyGeometry('report');
    await closeAndReopenForecast(`journey-${number}-report-reopen`);
    await openSaved(); await browserWait('document.querySelector(".bf26-results")');
    const pdfs = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      const reloaded = await ownedAttempt(member, journey.id); assert.equal(digest(reloaded.result), grade.canonicalSha256);
      const history = (await api(member, { operation: 'history', limit: 1, completeOnly: true })).body;
      assert.equal(history.analytics.completedAttempts, number);
      const same = history.attempts.find((row) => row.id === journey.id); assert.ok(same); assert.equal(same.summary.percentage, grade.percentage);
      const exported = await api(member, { operation: 'result_pdf', attemptId: journey.id });
      assert.match(exported.response.headers.get('Content-Type'), /application\/pdf/u);
      assert.match(exported.response.headers.get('Cache-Control'), /no-store/u);
      assert.equal(Buffer.from(exported.bytes.slice(0, 5)).toString('ascii'), '%PDF-'); pdfs.push(digest(exported.bytes));
      if (!repeat) await writeFile(path.join(evidenceDir, `journey-${number}-saved-report.pdf`), exported.bytes, { mode: 0o600 });
    }
    assert.equal(pdfs[0], pdfs[1]); assert.deepEqual(await batches(journey.id), executionBefore);
    await clickText('Analytics'); await browserWait('document.body.textContent.includes("Your Forecast analytics")');
    await screen(`journey-${number}-saved-analytics`);
    const errors = await browser('errors'); assert.doesNotMatch(errors, /TypeError|ReferenceError|SyntaxError|Maximum call stack/u);
    checks.push(`journey-${number}-saved-result-history-pdf-reload-no-extra-grading`);
    return { ...grade, pdfSha256: pdfs[0], gradingBatchExecutions: executionBefore.reduce((sum, batch) => sum + batch.executions, 0),
      physicalProviderRequestCount: null, providerCountNote: 'Batch execution counters are verified; internal provider retries are not exposed as a physical-call count.' };
  }

  async function cleanupAccount(account) {
    assertFixtureRecord(account, prefix);
    const current = await service(`/auth/v1/admin/users/${account.id}`, {}, [200, 404]);
    if (current?.id) {
      assert.equal(current.email, account.email); assert.equal(current.user_metadata?.astra_fixture_prefix, prefix, 'Refuse cleanup of an unrecognized account');
      if (account.session?.access_token) await safeRequest(`${TARGET.supabase}/auth/v1/logout?scope=global`, { method: 'POST',
        headers: { apikey: publishable, Authorization: `Bearer ${account.session.access_token}` } }, [200, 204, 401, 403]);
      await service(`/rest/v1/free_beta_access?user_id=eq.${account.id}`, { method: 'DELETE' }, [200, 204]);
      let deleted = false;
      for (let retry = 0; retry < 2 && !deleted; retry++) {
        for (const table of ['usage_events', 'usage_sessions']) await service(`/rest/v1/${table}?user_id=eq.${account.id}`, { method: 'DELETE' }, [200, 204]);
        try { await service(`/auth/v1/admin/users/${account.id}`, { method: 'DELETE' }, [200, 204, 404]); deleted = true; }
        catch { if (retry === 1) throw new Error('The exact fixture Auth record could not be removed'); await delay(500); }
      }
    }
    await service(`/auth/v1/admin/users/${account.id}`, {}, [404]);
    for (const [table, column] of [['profiles', 'id'], ['usage_events', 'user_id'], ['usage_sessions', 'user_id'],
      ['terms_acceptances', 'user_id'], ['introductory_token_grants', 'user_id'], ['introductory_token_ledger', 'user_id'],
      ['free_beta_access', 'user_id'], ['dd2026_bar_forecast_consents', 'user_id'],
      ['dd2026_forecast_attempts', 'owner_id'], ['dd2026_forecast_result_exports', 'owner_id']]) {
      const residue = await service(`/rest/v1/${table}?${column}=eq.${account.id}&select=${column}`); assert.equal(residue.length, 0, 'Disposable account residue must be absent');
    }
    for (const id of account.attemptIds || []) {
      assert.match(id, UUID);
      for (const table of ['dd2026_forecast_batches', 'dd2026_forecast_attempt_events']) {
        const residue = await service(`/rest/v1/${table}?attempt_id=eq.${id}&select=attempt_id`);
        assert.equal(residue.length, 0, 'Disposable attempt child rows must cascade away');
      }
    }
  }

  try {
    if (recovery) { stage = 'fixture-cleanup-recovery'; return summary; }
    const config = new TextDecoder().decode((await safeRequest(`${TARGET.site}/assets/phase2-config.js`)).bytes);
    assert.ok(config.includes(TARGET.ref) && !config.includes('hbllomlijfznnuudpdvr'), 'Deployed app must point only to staging');
    publishable = config.match(/sb_publishable_[A-Za-z0-9_-]{20,}/u)?.[0]; assert.ok(publishable);
    const asset = (await safeRequest(`${TARGET.site}/assets/bar-forecast.js`)).bytes;
    assert.ok(new TextDecoder().decode(asset).includes('submit_attempt'), 'Durable frontend candidate is not deployed'); summary.forecastAssetSha256 = digest(asset);
    for (const table of ['dd2026_forecast_attempts', 'dd2026_forecast_batches', 'dd2026_forecast_result_exports']) await service(`/rest/v1/${table}?select=*&limit=0`);
    checks.push('pinned-staging-config-durable-assets-and-schema');
    if (preflightOnly) { summary.preflightComplete = true; return summary; }
    launcher = await browserLauncher();
    for (const kind of ['member', 'other', 'unpaid']) assertBrowserSocketBudget(browserIdentity(prefix, kind), browserEnv);
    await writeFile(configPath, '{"headed":false}', { mode: 0o600 }); await writeFile(initPath, probeSource(), { mode: 0o600 });
    stage = 'fixture-provisioning'; member = await createFixture('member', true);
    const other = await createFixture('other', true); const unpaid = await createFixture('unpaid', false);
    await startBrowser(member);
    for (let number = 1; number <= 3; number++) {
      if (number > 1) { await clickText('New forecast'); await browserWait('document.querySelector(".bf26-subject-grid")'); }
      const journey = await acceptBrowserJourney(number, number === 2);
      stage = `journey-${number}-grading`;
      let controlled = null;
      if (number === 1) {
        await closeAndReopenForecast('journey-1-grading-reopen'); await openSaved();
        await waitForRealReport(journey.id);
      } else controlled = await controlledComplete(journey.id, number === 3, number === 2);
      journeys.push({ number, gradingMode: number === 1 ? 'real-approved-provider-via-scheduled-worker' : 'controlled-sql-checkpoint-fixture',
        controlledBatches: controlled?.controlledBatches || 0, schedulerBatches: controlled?.observedWorkerBatches ?? 5,
        controlledFailureRetryExercised: controlled?.failureRetryExercised || false,
        controlledSlowProgressLossExercised: controlled?.slowProgressLossExercised || false,
        finalAnswerSaved: true, acceptedVia: 'authenticated-real-browser-submit_attempt',
        ...await verifySavedSurfaces(journey, number) });
    }
    stage = 'ownership-boundaries';
    const latest = (await api(member, { operation: 'history' })).body.attempts[0].id;
    for (const operation of ['attempt', 'result_pdf', 'retry_attempt']) {
      const denied = await api(other, { operation, attemptId: latest }, [404]);
      assert.equal(denied.response.status, 404);
    }
    assert.equal((await api(other, { operation: 'history' })).body.attempts.length, 0);
    for (const body of [{ operation: 'status' }, { operation: 'start', subject: SUBJECT }, { operation: 'attempt', attemptId: latest }]) {
      assert.equal((await api(unpaid, body, [403])).body.error.code, 'BAR_FORECAST_ACCESS_REQUIRED');
    }
    const exports = await service(`/rest/v1/dd2026_forecast_result_exports?owner_id=eq.${member.id}&select=email_status,email_executions`);
    assert.ok(exports.every((row) => row.email_status === 'not_requested' && row.email_executions === 0), 'QA must not send or claim email');
    await startBrowser(other); await browserWait('document.querySelector(".bf26-subject-grid")'); await clickText('Saved attempts');
    await browserWait('document.body.textContent.includes("No saved attempts yet.")'); await screen('cross-owner-empty-history');
    await startBrowser(unpaid); await browserWait('document.body.textContent.toLowerCase().includes("subscribe") || document.body.textContent.includes("Plans & Pricing")');
    assert.equal(await evaluate('document.querySelectorAll("details.bf26-result,#bf26-current-answer").length'), 0); await screen('unpaid-subscription-boundary');
    checks.push('cross-owner-denials-unpaid-denials-no-mail-no-stale-owner-view'); summary.verificationComplete = true;
  } catch (error) {
    summary.failureStage = stage; // Never emit API bodies, fixture answers, tokens, or browser stdout.
    const code = typeof error?.code === 'string' ? error.code : '';
    summary.failureCode = /^[A-Z][A-Z0-9_]{0,79}$/u.test(code) ? code : 'VERIFICATION_ASSERTION_OR_TRANSPORT';
    if (error?.browserDiagnostic) summary.browserFailure = error.browserDiagnostic;
    const location = String(error?.stack || '').match(/(?:^|[\\/])(verify-astra-forecast-staging\.mjs:[1-9][0-9]{0,5}:[1-9][0-9]{0,4})(?:\)|\s|$)/mu)?.[1];
    if (location) summary.failureLocation = location;
    if (browserSession && launcher) {
      collectingFailureDiagnostics = true;
      try {
        summary.browserState = await captureForecastFailureDiagnostics({
          readDiagnostics: () => evaluate(forecastBrowserDiagnosticsSource()),
          saveDiagnostics: safe => writeFile(path.join(evidenceDir, 'failure-browser-diagnostics.json'), JSON.stringify(safe, null, 2), { mode: 0o600 }),
        });
        summary.browserStateCapture = 'saved-before-close';
      } catch { summary.browserStateCapture = 'unavailable'; }
      finally { collectingFailureDiagnostics = false; }
    }
  } finally {
    stopRequested = false;
    summary.browserSessionClosed = !browserSession;
    if (browserSession && launcher) {
      for (let retry = 0; retry < 2 && !summary.browserSessionClosed; retry++) {
        try { await browser('close'); summary.browserSessionClosed = true; } catch {}
      }
    }
    const cleanupErrors = [];
    for (const account of [...fixtures].reverse()) {
      try { await cleanupAccount(account); } catch { cleanupErrors.push(account.kind); }
    }
    summary.cleanupComplete = cleanupErrors.length === 0 && summary.browserSessionClosed;
    summary.cleanupFailedFixtureKinds = cleanupErrors;
    try {
      const resolved = assertPrivateTemp(privateDir);
      await rm(resolved, { recursive: true, force: true }); summary.privateAuthStateRemoved = true;
    } catch { summary.privateAuthStateRemoved = false; summary.cleanupComplete = false; }
    await writeFile(path.join(evidenceDir, recovery ? 'cleanup-recovery-summary.json' : 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  return summary;
}

export async function selfTest() {
  let count = 0;
  for (const value of [TARGET.site, `${TARGET.supabase}/rest/v1/dd2026_forecast_attempts`]) { assertStagingUrl(value); count++; }
  for (const value of ['https://duediligence.ph', 'https://hbllomlijfznnuudpdvr.supabase.co', `https://secret@${new URL(TARGET.site).host}`, 'http://127.0.0.1:4179']) { assert.throws(() => assertStagingUrl(value)); count++; }
  assert.deepEqual(parseBrowserResult('{"success":true,"data":{"result":{"id":1}}}'), { id: 1 }); count++;
  assert.equal(parseBrowserResult('{"success":true,"data":{"result":"true"}}'), true); count++;
  assert.throws(() => parseBrowserResult('{"success":false,"error":"redacted"}')); count++;
  const prefix = 'astra-durable-1788750000000-deadbeef'; const record = { id: '11111111-1111-4111-8111-111111111111', email: `${prefix}-member@example.com`, kind: 'member' };
  const identity = browserIdentity(prefix, 'member');
  assert.match(identity.namespace, /^ad-[a-f0-9]{16}$/u); count++;
  assert.equal(identity.session, 'member'); count++;
  assert.notEqual(identity.namespace, browserIdentity(prefix.replace('deadbeef', 'feedbeef'), 'member').namespace); count++;
  assert.notEqual(identity.session, browserIdentity(prefix, 'other').session); count++;
  assert.equal(identity.namespace, browserIdentity(prefix, 'other').namespace); count++;
  assert.throws(() => browserIdentity('customer-name', 'member')); count++;
  assert.throws(() => browserIdentity(prefix, '../customer')); count++;
  assert.ok(assertBrowserSocketBudget(identity, { HOME: '/home/runner' }, 'linux') <= 103); count++;
  assert.ok(assertBrowserSocketBudget(identity, { XDG_RUNTIME_DIR: '/run/user/1001' }, 'linux') <= 103); count++;
  assert.ok(assertBrowserSocketBudget(identity, {}, 'linux') <= 103); count++;
  assert.throws(() => assertBrowserSocketBudget({ namespace: prefix, session: `${prefix}-member` }, { HOME: '/home/runner' }, 'linux')); count++;
  assert.equal(assertBrowserSocketBudget(identity, { HOME: '/home/runner' }, 'win32'), null); count++;
  const privateValue = 'Bearer credential@example.com /private/customer-answer.txt secret-session-value';
  for (const [message, category] of [['socket path too long', 'SOCKET_PATH_LENGTH'], ['Session name synthetic is too long. Socket path would be 128 bytes (max 103).', 'SOCKET_PATH_LENGTH'], ['browser executable does not exist', 'BROWSER_NOT_INSTALLED'], ['daemon failed to start', 'DAEMON_START_OR_CONNECTION'], ['unknown', 'BROWSER_COMMAND_FAILED']]) {
    const safe = safeBrowserFailure({ stdout: `${message} ${privateValue}`, code: 1 }, '--state');
    assert.equal(safe.category, category); assert.equal(safe.action, 'open'); assert.equal(safe.exitCode, 1);
    assert.doesNotMatch(JSON.stringify(safe), /credential|example\.com|customer-answer|secret-session-value/u); count++;
  }
  assert.equal(safeBrowserFailure({ killed: true, code: 'TOKEN_MUST_NOT_ESCAPE' }, privateValue).category, 'BROWSER_COMMAND_TIMEOUT'); count++;
  assertFixtureRecord(record, prefix); count++;
  assert.throws(() => assertFixtureRecord({ ...record, email: 'customer@example.com' }, prefix)); count++;
  assert.throws(() => assertFixtureRecord({ ...record, id: 'invalid' }, prefix)); count++;
  assert.throws(() => assertFixtureRecord(record, 'unscoped-run')); count++;
  for (const published of ['assets', 'public', 'dist', 'build']) {
    assert.throws(() => assertPrivateEvidenceDir(path.join(root, published))); count++;
    assert.throws(() => assertPrivateEvidenceDir(path.join(root, published, 'private-proof'))); count++;
  }
  assert.equal(assertPrivateEvidenceDir(path.join(root, 'artifacts/astra-forecast-staging')), path.join(root, 'artifacts/astra-forecast-staging')); count++;
  assertPrivateTemp(path.join(tmpdir(), 'dd-astra-durable-a1b2c3')); count++;
  for (const directory of [tmpdir(), root, path.join(tmpdir(), 'customer-data'), path.join(tmpdir(), 'dd-astra-durable-a1b2c3/subdir')]) {
    assert.throws(() => assertPrivateTemp(directory)); count++;
  }
  const answers = Array.from({ length: 20 }, (_, index) => fixtureAnswer(prefix, 1, index + 1));
  const questions = answers.map((_, index) => ({ id: `fixture-${index + 1}`, number: index + 1, prompt: 'Explicit local fixture question' }));
  const results = answers.map((answer, index) => ({ questionId: questions[index].id, number: index + 1, score: 1, maxScore: 5,
    question: questions[index].prompt, userAnswer: answer, suggestedAnswer: 'Explicit local fixture suggested answer', explanation: 'Explicit local fixture coaching',
    mockBarCoaching: { strength: 'Fixture strength', nextStep: 'Fixture next step' }, grammar: { score: index < 3 ? 2 : 1 }, issueSpotting: { score: 2 } }));
  const attempt = { id: randomUUID(), clientAttemptId: randomUUID(), resultRevision: 1, status: 'complete', subject: SUBJECT,
    setId: 'local-fixture', questionCount: 20, completedQuestionCount: 20, questions,
    answers: answers.map((answer, index) => ({ questionId: questions[index].id, answer })) };
  attempt.result = { ownerId: record.id, attemptId: attempt.id, subject: SUBJECT, setId: attempt.setId, resultRevision: 1,
    complete: true, results, maxScore: 100, totalScore: 20, percentage: 20, analytics: { grammarAverage: 1.2, issueSpottingAverage: 2 } };
  assert.equal(assertCanonical(attempt, record.id, answers).grammar, 1.2); count++;
  const wrongMean = structuredClone(attempt); wrongMean.result.analytics.grammarAverage = 1.1;
  assert.throws(() => assertCanonical(wrongMean, record.id, answers)); count++;
  for (const mutate of [
    (value) => { value.result.ownerId = randomUUID(); },
    (value) => { value.result.results[19].userAnswer = 'Stale final answer'; },
    (value) => { value.result.totalScore = 99; },
    (value) => { value.result.results.pop(); },
    (value) => { value.result.results[1].questionId = value.result.results[0].questionId; },
  ]) { const broken = structuredClone(attempt); mutate(broken); assert.throws(() => assertCanonical(broken, record.id, answers)); count++; }
  const goodGeometry = { surface: 'editor', horizontalOverflowPx: 0, controls: [{ present: true, reachable: true }, { present: true, reachable: true }] };
  assertGeometry(goodGeometry); count++;
  assert.throws(() => assertGeometry({ ...goodGeometry, horizontalOverflowPx: 40 })); count++;
  assert.throws(() => assertGeometry({ ...goodGeometry, controls: [{ present: true, reachable: false }, goodGeometry.controls[1]] })); count++;
  assert.throws(() => assertGeometry({ ...goodGeometry, controls: [{ present: true, reachable: true, disabled: true }, goodGeometry.controls[1]] })); count++;
  assert.throws(() => geometrySource('unrelated-admin-page')); count++;

  let fixtureTransportCalls = 0;
  const window = { fetch: async () => { fixtureTransportCalls++; return new Response(JSON.stringify({ attempt: { id: attempt.id, clientAttemptId: attempt.clientAttemptId } }), { status: 202 }); } };
  vm.runInNewContext(probeSource(), { window, TypeError });
  const submit = { body: JSON.stringify({ operation: 'submit_attempt' }) };
  window.__astraForecastProbe.dropAcceptance = true;
  await assert.rejects(window.fetch(`${TARGET.site}${ENDPOINT}`, submit), /Controlled staging acceptance-response loss/u);
  assert.equal(fixtureTransportCalls, 1); assert.equal(window.__astraForecastProbe.accepted.id, attempt.id); count++;
  const replay = await window.fetch(`${TARGET.site}${ENDPOINT}`, submit);
  assert.equal(replay.status, 202); assert.equal(window.__astraForecastProbe.acceptedResponses, 2); count++;
  window.__astraForecastProbe.loseNextAttempt = true;
  await assert.rejects(window.fetch(`${TARGET.site}${ENDPOINT}`, { body: JSON.stringify({ operation: 'attempt' }) }), /Controlled staging progress-response loss/u);
  assert.equal(fixtureTransportCalls, 2); count++;
  await window.fetch(`${TARGET.site}${ENDPOINT}`, { body: JSON.stringify({ operation: 'attempt' }) });
  assert.equal(fixtureTransportCalls, 3); assert.equal(window.__astraForecastProbe.counts.attempt, 2); count++;
  const retryWindow = { fetch: async () => new Response(JSON.stringify({ attempt: {
    id: attempt.id, clientAttemptId: attempt.clientAttemptId, status: 'pending',
  } }), { status: 202 }) };
  vm.runInNewContext(probeSource(), { window: retryWindow, TypeError });
  await retryWindow.fetch(`${TARGET.site}${ENDPOINT}`, { body: JSON.stringify({ operation: 'retry_attempt' }) });
  assert.deepEqual(JSON.parse(JSON.stringify(retryWindow.__astraForecastProbe.retry)), {
    id: attempt.id, clientAttemptId: attempt.clientAttemptId, status: 'pending', httpStatus: 202,
  }); count++;
  assert.equal(Object.hasOwn(retryWindow.__astraForecastProbe.retry, 'answers'), false); count++;

  const failedAttempt = { ...structuredClone(attempt), status: 'failed', result: null };
  const acknowledgement = { id: attempt.id, clientAttemptId: attempt.clientAttemptId, status: 'pending', httpStatus: 202 };
  const pendingAttempt = { ...structuredClone(failedAttempt), status: 'pending' };
  const retryOptions = { expectedAttempt: failedAttempt, timeoutMs: 100, pollMs: 1,
    readAcknowledgement: async () => acknowledgement, readAttempt: async () => pendingAttempt };
  let acknowledgementReads = 0; let attemptReads = 0;
  const delayedRetry = await waitForSavedRetry({ ...retryOptions,
    readAcknowledgement: async () => ++acknowledgementReads < 3 ? null : acknowledgement,
    readAttempt: async () => {
      assert.equal(acknowledgementReads, 3, 'Never read retry state before its acknowledgement');
      return ++attemptReads < 3 ? failedAttempt : pendingAttempt;
    },
  });
  assert.equal(delayedRetry.id, attempt.id); assert.equal(acknowledgementReads, 3); assert.equal(attemptReads, 3); count++;
  for (const brokenAcknowledgement of [
    { ...acknowledgement, id: randomUUID() },
    { ...acknowledgement, clientAttemptId: randomUUID() },
    { ...acknowledgement, httpStatus: 409 },
    { ...acknowledgement, status: 'failed' },
  ]) {
    await assert.rejects(waitForSavedRetry({ ...retryOptions, readAcknowledgement: async () => brokenAcknowledgement }), { code: 'ERR_ASSERTION' }); count++;
  }
  for (const mutate of [
    (value) => { value.id = randomUUID(); },
    (value) => { value.clientAttemptId = randomUUID(); },
    (value) => { value.answers[19].answer = 'Changed final answer'; },
    (value) => { value.questions[19].prompt = 'Changed question'; },
    (value) => { value.answers.pop(); },
  ]) {
    const broken = structuredClone(pendingAttempt); mutate(broken);
    await assert.rejects(waitForSavedRetry({ ...retryOptions, readAttempt: async () => broken }), { code: 'ERR_ASSERTION' }); count++;
  }
  let laterReads = 0;
  await assert.rejects(waitForSavedRetry({ ...retryOptions, timeoutMs: 15,
    readAcknowledgement: () => new Promise(() => {}), readAttempt: async () => { laterReads++; return pendingAttempt; },
  }), /bounded staging wait/u); assert.equal(laterReads, 0); count++;
  await assert.rejects(waitForSavedRetry({ ...retryOptions, timeoutMs: 15,
    readAttempt: () => new Promise(() => {}),
  }), /bounded staging wait/u); count++;
  await assert.rejects(waitForSavedRetry({ ...retryOptions, timeoutMs: 15,
    readAttempt: async () => failedAttempt,
  }), /bounded staging wait/u); count++;
  assert.equal((await waitForSavedRetry({ ...retryOptions,
    readAcknowledgement: async () => ({ ...acknowledgement, status: 'complete' }),
    readAttempt: async () => ({ ...pendingAttempt, status: 'complete' }),
  })).status, 'complete'); count++;
  const completedControlled = { attempt: { status: 'complete' }, controlledBatches: 5,
    failureRetryExercised: true, slowProgressLossExercised: true };
  const requiredCoverage = { requireFailure: true, requireSlow: true };
  assert.equal(assertControlledCoverage(completedControlled, requiredCoverage), completedControlled); count++;
  for (const broken of [
    { ...completedControlled, controlledBatches: 0 },
    { ...completedControlled, failureRetryExercised: false },
    { ...completedControlled, slowProgressLossExercised: false },
    { ...completedControlled, attempt: { status: 'failed' } },
  ]) { assert.throws(() => assertControlledCoverage(broken, requiredCoverage), { code: 'ERR_ASSERTION' }); count++; }
  assert.ok(!probeSource().includes('suggestedAnswer')); count++;
  for (let number = 1; number <= 20; number++) assert.ok(fixtureAnswer(prefix, 1, number).split(/\s/u).length >= 10); count++;
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
  assert.ok(source.includes('const ENDPOINT')); assert.ok(source.includes("--execute-staging")); count++;
  return { ok: true, checks: count, networkRequests: 0, browserSessions: 0, remoteWrites: 0 };
}

export async function selfTestBrowser() {
  // This is a loopback-only CLI/probe/layout fixture, not application or provider
  // verification. It never reads protected environment variables or auth state.
  const prefix = `astra-durable-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const privateDir = await mkdtemp(path.join(tmpdir(), 'dd-astra-durable-'));
  const config = path.join(privateDir, 'browser-config.json');
  const init = path.join(privateDir, 'probe.js');
  const state = path.join(privateDir, 'local-state.json');
  const id = randomUUID(); const clientAttemptId = randomUUID();
  let localHttpRequests = 0; let closed = false; let launched = false;
  const server = createServer((request, response) => {
    localHttpRequests++;
    if (request.url === ENDPOINT) {
      response.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ attempt: { id, clientAttemptId } })); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Explicit local runner fixture</title>
      <style>*{box-sizing:border-box}body{margin:0;padding:8px}.bf26-page{max-width:100%;padding:8px}button{min-height:44px}#bf26-current-answer{width:100%;height:150px;border:1px solid}details{padding:16px 0}</style>
      <main class="bf26-page"><h1>Local runner wiring only</h1><div id="bf26-current-answer" contenteditable="true">Local fixture final editor.</div>
      <footer class="bf26-exam-footer"><button>Submit all answers</button></footer>
      <section class="bf26-results"><details class="bf26-result"><summary>Local fixture final question</summary><p>Local content only.</p></details><button>Download PDF</button><button>Email to me</button></section></main>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  let launcher;
  const browser = async (...args) => {
    try {
      const script = args[0] === 'eval' ? args[1] : null;
      const cliArgs = script === null ? args : ['eval', '--stdin'];
      const identity = browserIdentity(prefix, 'local');
      const pending = runCommand(launcher.command, [...launcher.prefix, '--namespace', identity.namespace, '--session', identity.session,
        '--config', config, '--restore-save', 'never', '--json', ...cliArgs],
      { timeout: 60000, maxBuffer: 1000000, windowsHide: true, env: isolatedBrowserEnv() });
      if (script !== null) {
        pending.child.stdin.on('error', () => {});
        pending.child.stdin.end(script);
      }
      const output = await pending;
      return parseBrowserResult(output.stdout);
    } catch (error) {
      // This branch is exclusively the credential-free loopback fixture. Keep
      // enough local diagnostic information to fix CLI wiring before staging.
      const detail = String(error.stdout || error.message || '').slice(0, 600);
      throw new Error(`Local isolated browser wiring failed: ${args[0]} ${detail}`);
    }
  };
  try {
    launcher = await browserLauncher();
    assertBrowserSocketBudget(browserIdentity(prefix, 'local'), isolatedBrowserEnv());
    await writeFile(config, '{"headed":false}', { mode: 0o600 }); await writeFile(init, probeSource(), { mode: 0o600 });
    await writeFile(state, JSON.stringify({ cookies: [], origins: [{ origin: url, localStorage: [{ name: 'astra-local-fixture', value: 'local-only' }] }] }), { mode: 0o600 });
    let linuxOriginalIdentityRejected = null;
    if (process.platform === 'linux') {
      // Actual pinned CLI negative control: fail before daemon launch. No account,
      // credentials or remote origin is involved in this loopback-only check.
      await assert.rejects(runCommand(launcher.command, [...launcher.prefix, '--namespace', prefix, '--session', `${prefix}-member`,
        '--config', config, '--restore-save', 'never', '--json', 'open', url],
      { timeout: 60000, maxBuffer: 1000000, windowsHide: true, env: isolatedBrowserEnv() }),
      (error) => safeBrowserFailure(error, 'open').category === 'SOCKET_PATH_LENGTH');
      linuxOriginalIdentityRejected = true;
    }
    launched = true; await browser('--state', state, '--init-script', init, 'open', url);
    assert.equal(await browser('eval', "localStorage.getItem('astra-local-fixture')"), 'local-only');
    const probe = await browser('eval', `(async()=>{
      window.__astraForecastProbe.dropAcceptance=true;
      let lost=false;try{await fetch('${ENDPOINT}',{method:'POST',body:JSON.stringify({operation:'submit_attempt'})});}catch(error){lost=error.message.includes('Controlled staging');}
      await fetch('${ENDPOINT}',{method:'POST',body:JSON.stringify({operation:'submit_attempt'})});
      return {lost,id:window.__astraForecastProbe.accepted.id,acceptedResponses:window.__astraForecastProbe.acceptedResponses};
    })()`);
    assert.equal(probe.lost, true); assert.equal(probe.id, id); assert.equal(probe.acceptedResponses, 2);
    for (const width of [320, 1280]) {
      await browser('set', 'viewport', String(width), '900');
      for (const surface of ['editor', 'report']) assertGeometry(await browser('eval', geometrySource(surface)));
    }
    await browser('eval', "document.documentElement.style.zoom='2'");
    for (const surface of ['editor', 'report']) assertGeometry(await browser('eval', geometrySource(surface)));
    await browser('close'); closed = true;
    return { ok: true, test: 'loopback-only CLI wiring, not application evidence', checks: process.platform === 'linux' ? 11 : 10, localHttpRequests,
      linuxOriginalIdentityRejected,
      browserSessions: 1, externalApplicationRequests: 0, providerRequests: 0, remoteWrites: 0, privateStateRemoved: true };
  } finally {
    if (launched && !closed && launcher) { await browser('close').catch(() => {}); }
    await new Promise((resolve) => server.close(resolve));
    await rm(assertPrivateTemp(privateDir), { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') console.log(JSON.stringify(await selfTest()));
  else if (args.length === 1 && args[0] === '--self-test-browser') console.log(JSON.stringify(await selfTestBrowser()));
  else if ((args.length === 1 && ['--execute-staging', '--preflight'].includes(args[0])) || (args.length === 2 && args[0] === '--cleanup-manifest')) {
    try {
      const summary = await verifyStaging({ preflightOnly: args[0] === '--preflight', cleanupManifestPath: args[0] === '--cleanup-manifest' ? args[1] : null });
      console.log(JSON.stringify({ target: summary.target, mode: summary.mode, verificationComplete: summary.verificationComplete,
        cleanupComplete: summary.cleanupComplete, journeyCount: summary.journeys.length, failureStage: summary.failureStage || null }));
      const verified = args[0] === '--preflight' ? summary.preflightComplete : args[0] === '--cleanup-manifest' ? true : summary.verificationComplete;
      if (!verified || !summary.cleanupComplete) process.exitCode = 1;
    } catch { console.error('ASTRA_FORECAST_STAGING: safe preflight/setup failure; no sensitive details emitted'); process.exitCode = 1; }
  } else { console.error('Usage: node scripts/verify-astra-forecast-staging.mjs --self-test | --self-test-browser | --preflight | --execute-staging | --cleanup-manifest <private cleanup-manifest.json>'); process.exitCode = 2; }
}
