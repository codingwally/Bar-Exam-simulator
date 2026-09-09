/** Actual pinned workerd + unmodified delivery adapter; fake Storage only.
 * Linux execution requires an independent network namespace containing loopback
 * only. --harness-only checks the fake service's fail-closed boundary in Node.
 * This is neither hosted Storage evidence nor a full application/Auth rehearsal.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createFakeStorage, INERT_KEY } from './fixtures/debate-delivery-workerd-storage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'artifacts/debate-local-rehearsal/delivery-workerd');
const TOOLING = path.join(ROOT, 'artifacts/debate-local-rehearsal/staging-tooling/node_modules');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile);
const sources = ['scripts/test-debate-delivery-workerd.mjs', 'scripts/fixtures/debate-delivery-workerd-entry.mjs', 'scripts/fixtures/debate-delivery-workerd-storage.mjs', '.github/workflows/debate-v3-validation.yml', 'worker/debate-delivery.mjs', 'worker/debate-documents.mjs', 'worker/debate-domain.mjs', 'worker/debate-sanctions.mjs', 'worker/noto-sans-latin-ext.mjs', 'worker/outbound-email-policy.mjs', 'worker/package.json', 'worker/package-lock.json', 'worker/wrangler.staging.toml'];
const report = { schemaVersion: 1, kind: 'INERT_STORAGE_WORKERD_DELIVERY', status: 'RUNNING', startedAt: new Date().toISOString(), checks: [], sourceHashes: {}, cases: [], runtimeStarted: false, productSourceModified: false, realCredentialsUsed: false, realStorageUsed: false, realMailSent: false, fullAcceptance: false, limitations: ['The unchanged delivery adapter and its dependencies run in local pinned workerd with an inert Storage service binding.', 'No production/staging endpoint, Auth, database, bucket or provider credential is used; all network egress is blocked by a separate kernel namespace.', 'Pinned workerd may differ from the deployed Cloudflare runtime; the configured compatibility date is recorded as requested, not proof of an identical hosted runtime.', 'These checks cannot explain a hosted failure without corresponding actual hosted stage evidence.'] };
let active = 'harness boundary', mf;
function runtimeDiagnostic(source, message) {
  report.runtimeDiagnostics ??= [];
  const safe = String(message).replaceAll(INERT_KEY, '[inert-key]').slice(0, 1000);
  if (report.runtimeDiagnostics.length < 40) report.runtimeDiagnostics.push({ source, message: safe });
  else report.runtimeDiagnosticsTruncated = true;
  if (/compatib|future|falling back|clamp/i.test(safe)) {
    report.compatibilityWarnings ??= [];
    if (report.compatibilityWarnings.length < 10) report.compatibilityWarnings.push(safe);
  }
}
async function check(name, fn) { active = name; await fn(); report.checks.push({ name, status: 'PASS' }); }
async function harnessChecks() {
  const storage = createFakeStorage();
  await check('fake Storage refuses an external host before any request handling', async () => { await assert.rejects(storage.fetch(new Request('https://example.invalid/storage/v1/bucket/debate-private-v3')), /INERT_STORAGE_TARGET_REJECTED/); });
  await check('fake Storage refuses credentials other than its fixed inert value', async () => { await assert.rejects(storage.fetch(new Request('https://storage.fixture.invalid/storage/v1/bucket/debate-private-v3')), /INERT_STORAGE_HEADERS_REJECTED/); });
  await check('fake Storage rejects other buckets and methods', async () => { await assert.rejects(storage.fetch(new Request('https://storage.fixture.invalid/storage/v1/bucket/other', { headers: { apikey: INERT_KEY, Authorization: 'Bearer ' + INERT_KEY } })), /INERT_STORAGE_ROUTE_REJECTED/); await assert.rejects(storage.fetch(new Request('https://storage.fixture.invalid/__report', { method: 'POST' })), /INERT_REPORT_METHOD/); });
  await check('rejected fake requests create no object or accepted call', async () => { assert.deepEqual(await (await storage.fetch(new Request('https://storage.fixture.invalid/__report'))).json(), { calls: [], objectsRemaining: 0 }); });
}
function blankPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>'];
  let pdf = '%PDF-1.4\n% Inert blank page; no personal data.\n'; const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  return Buffer.from(pdf + `xref\n0 4\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
try {
  await harnessChecks();
  if (process.argv.includes('--harness-only')) {
    report.status = 'PASS_INERT_STORAGE_HARNESS_ONLY';
  } else {
    await check('fresh Linux network namespace exposes only loopback', async () => {
      assert.equal(process.platform, 'linux', 'Use isolated Linux CI; there is no local or network-enabled fallback.');
      assert.match(process.env.DEBATE_HOST_NETWORK_NAMESPACE || '', /^net:\[\d+\]$/);
      const current = await readlink('/proc/self/ns/net'); assert.notEqual(current, process.env.DEBATE_HOST_NETWORK_NAMESPACE);
      const interfaces = networkInterfaces(); assert.deepEqual(Object.keys(interfaces), ['lo']);
      for (const item of interfaces.lo) { assert.equal(item.internal, true); assert.ok(['127.0.0.1', '::1'].includes(item.address)); }
      report.network = { isolated: true, loopbackOnly: true, hostNamespace: process.env.DEBATE_HOST_NETWORK_NAMESPACE, currentNamespace: current };
    });
    await check('runtime process has no inherited credential or execution-hook environment', () => { assert.deepEqual(Object.keys(process.env).sort(), ['DEBATE_HOST_NETWORK_NAMESPACE', 'PATH']); });
    for (const source of sources) report.sourceHashes[source] = hash(await readFile(path.join(ROOT, source)));
    const gitEnv = { PATH: process.env.PATH };
    report.checkoutSha = (await run('git', ['-c', 'safe.directory=' + ROOT, 'rev-parse', 'HEAD'], { cwd: ROOT, env: gitEnv })).stdout.trim();
    report.checkoutTree = (await run('git', ['-c', 'safe.directory=' + ROOT, 'rev-parse', 'HEAD^{tree}'], { cwd: ROOT, env: gitEnv })).stdout.trim();
    const packages = {};
    for (const name of ['wrangler', 'miniflare', 'workerd']) packages[name] = JSON.parse(await readFile(path.join(TOOLING, name, 'package.json'), 'utf8'));
    await check('runtime comes from the existing exact pinned Wrangler installation', () => { assert.equal(packages.wrangler.version, '4.114.0'); assert.equal(packages.miniflare.version, packages.wrangler.dependencies.miniflare); assert.equal(packages.workerd.version, packages.miniflare.dependencies.workerd); });
    report.tooling = Object.fromEntries(Object.entries(packages).map(([name, pkg]) => [name, pkg.version]));
    const { Miniflare, Log, LogLevel } = await import(pathToFileURL(path.join(TOOLING, 'miniflare/dist/src/index.js')));
    class ReceiptLog extends Log { warn(message) { runtimeDiagnostic('miniflare.warn', message); super.warn(message); } }
    const esbuild = await import(pathToFileURL(path.join(ROOT, 'worker/node_modules/esbuild/lib/main.js')));
    active = 'bundle unchanged adapter and dependencies';
    const bundle = await esbuild.build({ absWorkingDir: ROOT, entryPoints: ['scripts/fixtures/debate-delivery-workerd-entry.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true, logLevel: 'silent' });
    assert.ok(Object.keys(bundle.metafile.inputs).includes('worker/debate-delivery.mjs'));
    report.bundleSha256 = hash(bundle.outputFiles[0].contents);
    const config = await readFile(path.join(ROOT, 'worker/wrangler.staging.toml'), 'utf8');
    const compatibilityDate = config.match(/^compatibility_date\s*=\s*"([0-9-]+)"/m)?.[1]; assert.match(compatibilityDate || '', /^\d{4}-\d{2}-\d{2}$/);
    assert.match(config, /^compatibility_flags\s*=\s*\["nodejs_compat"\]/m);
    report.requestedCompatibilityDate = compatibilityDate; report.compatibilityFlags = ['nodejs_compat'];
    report.effectiveCompatibilityDate = null; // Only the requested setting and actual emitted warnings are evidence here.
    active = 'workerd startup';
    mf = new Miniflare({ host: '127.0.0.1', port: 0, log: new ReceiptLog(LogLevel.WARN), handleRuntimeStdio(stdout, stderr) {
      for (const [source, stream] of [['workerd.stdout', stdout], ['workerd.stderr', stderr]]) createInterface(stream).on('line', line => runtimeDiagnostic(source, line));
    }, workers: [
      { name: 'delivery-repro', modules: true, script: bundle.outputFiles[0].text, compatibilityDate, compatibilityFlags: ['nodejs_compat'], bindings: { SUPABASE_URL: 'https://storage.fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: INERT_KEY, DEBATE_STORAGE_BUCKET: 'debate-private-v3', OUTBOUND_EMAIL_MODE: 'suppressed' }, outboundService: 'fake-storage' },
      { name: 'fake-storage', modules: true, script: await readFile(path.join(ROOT, 'scripts/fixtures/debate-delivery-workerd-storage.mjs'), 'utf8'), compatibilityDate, outboundService: { network: { allow: [], deny: ['public', 'private'] } } },
    ] });
    await mf.ready; report.runtimeStarted = true;
    const pdf = blankPdf(); assert.ok(pdf.length < 1024); report.inertFile = { size: pdf.length, sha256: hash(pdf) };
    for (const mode of ['direct', 'multipart']) await check('actual workerd ' + mode + ' upload, validation, download, foreign denial and deletion', async () => {
      let body = pdf, headers = { 'Content-Type': 'application/pdf' };
      if (mode === 'multipart') { body = new FormData(); body.set('file', new File([pdf], 'inert.pdf', { type: 'application/pdf' })); headers = {}; }
      const response = await mf.dispatchFetch('https://repro.fixture.invalid/' + mode, { method: 'POST', body, headers });
      const result = await response.json(); report.cases.push({ mode, status: response.status, result });
      assert.equal(response.status, 200); assert.equal(result.ok, true); assert.equal(result.size, pdf.length); assert.equal(result.downloadSha256, hash(pdf)); assert.equal(result.foreignReceiptDenied, true); assert.equal(result.deleted, true);
    });
    await check('fake Storage contains only the bounded expected operations and no residual objects', async () => {
      const fake = await mf.getWorker('fake-storage'); const observed = await (await fake.fetch('https://storage.fixture.invalid/__report')).json(); report.fakeStorage = observed;
      assert.equal(observed.objectsRemaining, 0);
      assert.deepEqual(observed.calls.map(call => call.operation), Array(2).fill(['private_bucket', 'private_write', 'private_bucket', 'private_read', 'private_bucket', 'private_read', 'private_bucket', 'private_delete']).flat());
    });
    await check('tested source files remain unchanged throughout the runtime run', async () => { for (const source of sources) assert.equal(hash(await readFile(path.join(ROOT, source))), report.sourceHashes[source], source); });
    report.status = 'PASS_WORKERD_INERT_STORAGE_DELIVERY';
  }
} catch (error) {
  report.status = 'FAIL'; report.failedCheck = active;
  report.error = { name: String(error.name).slice(0, 80), code: typeof error.code === 'string' ? error.code.slice(0, 100) : null, message: String(error.message).replaceAll(INERT_KEY, '[inert-key]').slice(0, 1000) };
  process.exitCode = 1;
} finally {
  try { await mf?.dispose(); } catch (error) { report.disposeError = { name: error.name, code: error.code || null }; report.status = 'FAIL'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await mkdir(OUTPUT, { recursive: true });
  const name = process.argv.includes('--harness-only') ? 'harness.json' : 'report.json';
  await writeFile(path.join(OUTPUT, name), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failedCheck: report.failedCheck, runtimeStarted: report.runtimeStarted, report: path.relative(ROOT, path.join(OUTPUT, name)) }));
}
