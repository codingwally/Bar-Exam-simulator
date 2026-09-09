/**
 * Real pinned Wrangler serialization with an inert Worker; not runtime/deployment proof.
 * Requires a fresh Linux network namespace. There is no network-enabled fallback.
 * Upstream dry-run serializes FormData to --outfile before exiting without upload:
 * https://github.com/cloudflare/workers-sdk/blob/wrangler%404.114.0/packages/deploy-helpers/src/deploy/deploy.ts
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig, parseBase, hash } from './debate-staging-release.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'artifacts/debate-local-rehearsal/wrangler-metadata');
const TOOLING = path.join(ROOT, 'artifacts/debate-local-rehearsal/staging-tooling/node_modules/wrangler');
const VERSION = '4.114.0';
const TEST_ACTOR = '00000000-0000-4000-8000-000000000091';
const INERT_WORKER = 'export default { fetch() { return new Response("metadata serialization fixture"); } };\n';
// Independent expected values from the reviewed expanded staging capture.
// Do not import the generator's object: detect any lost/defaulted field.
const EXPECTED_OBSERVABILITY = {
  enabled: true, head_sampling_rate: 1, redact_query_string: false,
  logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
  traces: { enabled: false, head_sampling_rate: 1, persist: true },
};
const report = {
  schemaVersion: 1, status: 'RUNNING', startedAt: new Date().toISOString(),
  environment: 'Linux network namespace; inert Worker/static asset; actual pinned Wrangler dry-run',
  node: process.version, checks: [], sourceHashes: {},
  limitations: [
    'The actual configuration parser and upload serializer are exercised with an inert entrypoint and one static file.',
    'The full application Worker is not bundled or executed; no Cloudflare request, account provisioning, deployment, provider, Auth, database or mail operation is performed.',
    'Upload omission is proved; server-side acceptance and preservation still require the separately authorized deployment and readback.',
  ],
};
let activeCheck = 'network isolation';
async function check(name, assertion) {
  activeCheck = name;
  await assertion();
  report.checks.push({ name, status: 'PASS' });
}
try {
  assert.equal(process.platform, 'linux', 'Requires the CI Linux network namespace.');
  const parentNamespace = process.env.DEBATE_HOST_NETWORK_NAMESPACE;
  assert.match(parentNamespace || '', /^net:\[\d+\]$/, 'Supply the host namespace captured before unshare.');
  const currentNamespace = await readlink('/proc/self/ns/net');
  await check('fresh kernel network namespace with no active IP interfaces', () => {
    assert.notEqual(currentNamespace, parentNamespace);
    assert.deepEqual(networkInterfaces(), {});
  });
  report.network = { isolated: true, hostNamespace: parentNamespace, currentNamespace, activeIpInterfaces: [] };
  await mkdir(OUTPUT, { recursive: true });
  const fixture = await mkdtemp(path.join(OUTPUT, 'fixture-'));
  for (const child of ['worker', '.staging-dist', 'home', 'tmp']) await mkdir(path.join(fixture, child));
  const basePath = 'worker/wrangler.staging.toml', policyPath = 'worker/debate-staging-policy.json';
  const source = await readFile(path.join(ROOT, basePath), 'utf8');
  const base = parseBase(source);
  const policy = JSON.parse(await readFile(path.join(ROOT, policyPath), 'utf8'));
  const config = buildConfig(base, policy, TEST_ACTOR, fixture, fixture);
  await Promise.all([
    writeFile(path.join(fixture, 'worker/commercial-entry.mjs'), INERT_WORKER),
    writeFile(path.join(fixture, '.staging-dist/index.html'), '<!doctype html><title>Metadata fixture</title>\n'),
    writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}\n'),
    writeFile(config.filename, config.text),
  ]);
  await check('real overlay uses the fixture and preserves the reviewed base', () => {
    assert.equal(config.hash, hash(config.text));
    assert.deepEqual(config.previewActorIds, [TEST_ACTOR]);
    assert.ok(config.text.includes(path.join(fixture, 'worker/commercial-entry.mjs').replaceAll('\\', '/')));
    assert.equal(base.source, source);
  });
  const pkg = JSON.parse(await readFile(path.join(TOOLING, 'package.json'), 'utf8'));
  await check('installed Wrangler is exactly the existing pinned version', () => assert.equal(pkg.version, VERSION));
  const wrapper = path.join(TOOLING, 'bin/wrangler.js');
  report.tool = { package: 'wrangler', version: pkg.version, wrapperSha256: hash(await readFile(wrapper)),
    cliSha256: hash(await readFile(path.join(TOOLING, 'wrangler-dist/cli.js'))) };
  const multipartPath = path.join(fixture, 'upload.multipart');
  const args = [wrapper, 'deploy', '--config', config.filename, '--dry-run', '--no-bundle',
    '--outdir', path.join(fixture, 'bundle'), '--outfile', multipartPath, '--no-autoconfig'];
  // The wrapper and its child inherit the isolated kernel namespace and only this
  // environment; no credentials, existing auth profile, NODE_OPTIONS or npm hooks.
  const childEnv = {
    PATH: process.env.PATH || '', HOME: path.join(fixture, 'home'),
    XDG_CONFIG_HOME: path.join(fixture, 'home'), TMPDIR: path.join(fixture, 'tmp'),
    CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_CHECK_UPDATE: 'false', LANG: 'C.UTF-8',
  };
  await check('Wrangler environment excludes credentials and inherited execution hooks', () => {
    assert.deepEqual(Object.keys(childEnv).sort(), ['CI','HOME','LANG','NO_COLOR','PATH','TMPDIR',
      'WRANGLER_CHECK_UPDATE','WRANGLER_SEND_METRICS','XDG_CONFIG_HOME'].sort());
  });
  activeCheck = 'actual Wrangler offline dry-run';
  const result = await run(process.execPath, args, { cwd: fixture, env: childEnv, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(path.join(OUTPUT, 'wrangler-output.txt'), result.stdout + result.stderr);
  await check('pinned wrapper reports dry-run exit', () => assert.match(result.stdout, /--dry-run: exiting now\./));
  const multipart = await readFile(multipartPath);
  const boundary = /^--([A-Za-z0-9_-]{16,100})\r\n/.exec(multipart.subarray(0, 150).toString())?.[1];
  assert.ok(boundary, 'Expected the serialized multipart upload, not an esbuild metafile.');
  const form = await new Response(multipart, { headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } }).formData();
  assert.equal(form.getAll('metadata').length, 1);
  const part = form.get('metadata');
  const metadata = JSON.parse(typeof part === 'string' ? part : await part.text());
  await check('serialized placement uses the exact targeted region', () => {
    assert.deepEqual(metadata.placement, { mode: 'targeted', region: 'gcp:us-east4' });
  });
  await check('serialized cache and exports remain omitted', () => {
    for (const key of ['cache','cache_options','exports']) assert.equal(Object.hasOwn(metadata, key), false, key + ' must remain omitted');
  });
  await check('all captured observability fields survive serialization', () => assert.deepEqual(metadata.observability, EXPECTED_OBSERVABILITY));
  await check('compatibility and existing variable/secret preservation survive serialization', () => {
    assert.equal(metadata.compatibility_date, policy.compatibilityDate);
    assert.deepEqual(metadata.compatibility_flags, policy.compatibilityFlags);
    assert.deepEqual([...metadata.keep_bindings].sort(), ['json','plain_text','secret_key','secret_text']);
    for (const [name, text] of Object.entries({ ...base.vars, ...policy.debateVars, DEBATE_PREVIEW_ACTOR_IDS: TEST_ACTOR })) {
      assert.deepEqual(metadata.bindings.filter(binding => binding.name === name), [{ name, type: 'plain_text', text }]);
    }
    assert.equal(metadata.bindings.some(binding => binding.type === 'secret_text'), false);
  });
  await check('serialized module is the exact inert fixture', async () => {
    assert.equal(metadata.main_module, 'commercial-entry.mjs');
    assert.equal(form.getAll(metadata.main_module).length, 1);
    assert.equal(await form.get(metadata.main_module).text(), INERT_WORKER);
  });
  await check('tracked staging base bytes remain unchanged', async () => {
    assert.equal(hash(await readFile(path.join(ROOT, basePath))), hash(source));
  });
  for (const relative of ['scripts/test-debate-wrangler-metadata.mjs','scripts/debate-staging-release.mjs',basePath,policyPath,
    '.github/workflows/debate-v3-validation.yml','.github/workflows/debate-v3-staging.yml']) {
    report.sourceHashes[relative] = hash(await readFile(path.join(ROOT, relative)));
  }
  report.checkoutSha = (await run('git', ['-c', 'safe.directory=' + ROOT, 'rev-parse', 'HEAD'], { cwd: ROOT, env: childEnv })).stdout.trim();
  report.uploadSha256 = hash(multipart);
  report.generatedConfigurationSha256 = config.hash;
  report.metadata = {
    placement: metadata.placement, observability: metadata.observability,
    cachePresent: false, cacheOptionsPresent: false, exportsPresent: false,
    compatibilityDate: metadata.compatibility_date, compatibilityFlags: metadata.compatibility_flags,
    keepBindings: metadata.keep_bindings, mainModule: metadata.main_module,
    bindings: metadata.bindings.map(({ name, type }) => ({ name, type })),
  };
  report.status = 'PASS_PINNED_WRANGLER_OFFLINE_METADATA';
} catch (error) {
  report.status = 'FAIL';
  report.failedCheck = activeCheck;
  report.error = { name: error.name, code: error.code || null, message: error.message.slice(0, 1200) };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failedCheck: report.failedCheck,
    report: path.relative(ROOT, path.join(OUTPUT, 'report.json')) }));
}
