import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { captureCommercialDeployment, collectCommercialDeploymentEvidence,
  parseCommercialDeployOutput } from './capture-staging-commercial-deployment.mjs';
import { COMMERCIAL_STAGE, commercialDeploymentMarker,
  createCommercialSuppressionVerifier } from './staging-commercial-suppression.mjs';

const SHA = 'a'.repeat(40), RUN = '34194950298', ATTEMPT = '2';
const VERSION = '11111111-1111-4111-8111-111111111111';
const DEPLOYMENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'private-token-never-persist-or-print';
const MARKER = commercialDeploymentMarker(SHA, RUN, ATTEMPT);
const source = await readFile(new URL('../worker/commercial-entry.mjs', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const inputs = { sourceSha: SHA, workflowRunId: RUN, workflowRunAttempt: ATTEMPT };
function records() {
  return [{ type: 'wrangler-session', version: 1, wrangler_version: '4.114.0',
    command_line_args: ['deploy','--config','wrangler.staging.toml','--message',MARKER],
    log_file_path: '/private/debug-do-not-persist.log', timestamp: '2026-09-08T07:00:00Z' },
  { type: 'deploy', version: 1, worker_name: COMMERCIAL_STAGE.workerName, worker_tag: 'opaque-tag',
    version_id: VERSION, targets: [COMMERCIAL_STAGE.workerUrl, 'schedule: */2 * * * *'],
    worker_name_overridden: false, timestamp: '2026-09-08T07:01:00Z' }];
}
const ndjson = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const deployment = (changes = {}) => ({ id: DEPLOYMENT, created_on: '2026-09-08T07:00:30Z',
  versions: [{ version_id: VERSION, percentage: 100 }], annotations: { 'workers/message': MARKER },
  author_email: 'never-persist@example.invalid', ...changes });
function setup(options = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init }); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${COMMERCIAL_STAGE.accountId}/workers/scripts/${COMMERCIAL_STAGE.workerName}/deployments`);
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`); assert.ok(init.signal instanceof AbortSignal);
    if (options.throw) throw Error(TOKEN);
    return new Response(options.rawBody ?? JSON.stringify({ success: true,
      result: { deployments: options.deployments ?? [deployment()] } }), { status: options.status ?? 200 });
  };
  return { calls, request, args: { ...inputs, outputText: ndjson(options.records ?? records()),
    sourceText: source, apiToken: TOKEN, request } };
}
async function refused(args) {
  await assert.rejects(() => collectCommercialDeploymentEvidence(args), error =>
    error.message === 'STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE_REFUSED' && !error.message.includes(TOKEN));
}

test('4.114.0 ordinary deploy pairs its version with authoritative deployment ID; only safe evidence persists', async () => {
  const h = setup(); const evidence = await collectCommercialDeploymentEvidence(h.args);
  assert.equal(evidence.versionId, VERSION); assert.equal(evidence.deploymentId, DEPLOYMENT);
  assert.notEqual(evidence.versionId, evidence.deploymentId); assert.equal(h.calls.length, 1);
  assert.equal(evidence.deploymentMessage, MARKER); assert.equal(evidence.wranglerVersion, '4.114.0');
  assert.equal(evidence.wranglerOutputSha256, hash(h.args.outputText));
  assert.equal(evidence.commercialEntryLfSha256, hash(source.replaceAll('\r\n','\n')));
  assert.deepEqual(Object.keys(evidence).sort(), ['schemaVersion','kind','provenance','sourceSha','workflowRunId',
    'workflowRunAttempt','accountId','workerName','deploymentId','versionId','deploymentMessage',
    'wranglerVersion','wranglerOutputSha256','commercialEntryLfSha256'].sort());
  for (const forbidden of [TOKEN, 'never-persist@example.invalid', '/private/', 'Authorization', 'log_file_path'])
    assert.equal(JSON.stringify(evidence).includes(forbidden), false);
});

const invalidRows = [
  ['wrong-cli', rows => { rows[0].wrangler_version = '4.125.0'; }],
  ['wrong-worker', rows => { rows[1].worker_name = 'duediligence-examinations'; }],
  ['overridden-worker', rows => { rows[1].worker_name_overridden = true; }],
  ['wrong-env', rows => { rows[1].wrangler_environment = 'production'; }],
  ['dry-run-null-version', rows => { rows[1].version_id = null; }],
  ['pages-id-is-not-worker', rows => { rows[1].type = 'pages-deploy'; rows[1].deployment_id = VERSION; }],
  ['extra-failure-record', rows => rows.push({ type: 'command-failed', version: 1, message: TOKEN })],
  ['duplicate-deploy', rows => rows.push(rows[1])],
  ['duplicate-session', rows => rows.unshift(rows[0])],
  ['failed-instead-of-deploy', rows => { rows[1] = { type: 'command-failed', version: 1, message: TOKEN }; }],
  ['old-run-marker', rows => { rows[0].command_line_args[4] = MARKER.replace(`:${ATTEMPT}:`, ':1:'); }],
  ['extra-command', rows => rows[0].command_line_args.push('--dry-run')],
  ['wrong-config', rows => { rows[0].command_line_args[2] = 'wrangler.toml'; }],
  ['wrong-output-schema', rows => { rows[1].version = 2; }],
  ['missing-session', rows => rows.shift()],
];
for (const [label, change] of invalidRows) test(`refuses ${label} before any metadata request`, async () => {
  const rows = records(); change(rows); const h = setup({ records: rows });
  await refused(h.args); assert.equal(h.calls.length, 0);
});

for (const [label, deployments] of [
  ['wrong-version', [deployment({ versions: [{ version_id: OTHER, percentage: 100 }] })]],
  ['split-traffic', [deployment({ versions: [{ version_id: VERSION, percentage: 50 }, { version_id: OTHER, percentage: 50 }] })]],
  ['wrong-message', [deployment({ annotations: { 'workers/message': 'manual' } })]],
  ['missing-message', [deployment({ annotations: undefined })]],
  ['duplicate-command-match', [deployment(), deployment({ id: OTHER })]],
  ['exact-but-not-active', [deployment({ id: OTHER, annotations: { 'workers/message': 'later' } }), deployment()]],
  ['missing-result', []],
  ['invalid-deployment-id', [deployment({ id: null })]],
]) test(`refuses ${label}; never adopts current/latest by timing`, async () => {
  const h = setup({ deployments }); await refused(h.args); assert.equal(h.calls.length, 1);
});
for (const options of [{ status: 403 }, { status: 503 }, { throw: true }, { rawBody: TOKEN },
  { rawBody: JSON.stringify({ success: false }) }, { rawBody: 'x'.repeat(1048577) }])
  test(`metadata failure is bounded and sanitized ${Object.keys(options)[0]} ${options.status ?? ''} ${options.rawBody?.length ?? ''}`, async () => {
    const h = setup(options); await refused(h.args);
  });
test('blank, truncated, huge and contradictory CLI evidence is rejected', () => {
  for (const text of ['', '{', 'x'.repeat(262145), ndjson(records()).replace('4.114.0','4.114.0\n')])
    assert.throws(() => parseCommercialDeployOutput(text, inputs));
  for (const args of [[SHA,RUN,'0'], [SHA,RUN,'2\n'], ['a'.repeat(39),RUN,ATTEMPT]])
    assert.throws(() => commercialDeploymentMarker(...args));
});

function filesystemHarness(options = {}) {
  const temporaryDirectory = path.resolve('/inert-os-temp');
  const outputDir = path.join(temporaryDirectory, 'wranglerArtifacts-44444444-4444-4444-8444-444444444444');
  const runnerTemp = path.resolve('/inert-runner-temp'), root = path.resolve('/inert-checkout');
  const output = path.join(runnerTemp, `staging-commercial-deployment-${RUN}-${ATTEMPT}.json`);
  const rawName = 'wrangler-output-2026-09-08_07-00-00_000-abcdef.json', rawPath = path.join(outputDir, rawName);
  const h = setup(), writes = [], missing = () => Object.assign(Error('missing'), { code: 'ENOENT' });
  const entry = { name: rawName, isFile: () => true, isSymbolicLink: () => false };
  const io = {
    realpath: async value => value,
    readdir: async () => options.extraFile ? [entry, entry] : [entry],
    lstat: async value => {
      if (value === output) { if (options.existing) return {}; throw missing(); }
      assert.equal(value, rawPath); return { size: 1000, isFile: () => true, isSymbolicLink: () => Boolean(options.symlink) };
    },
    readFile: async value => {
      if (value === path.join(root, 'worker', 'commercial-entry.mjs')) return source;
      assert.equal(value, rawPath); return ndjson(records());
    },
    writeFile: async (value, body, flags) => {
      assert.equal(value, output); assert.deepEqual(flags, { flag: 'wx', mode: 0o600 });
      if (options.writeRace) throw Object.assign(Error(TOKEN), { code: 'EEXIST' });
      writes.push(JSON.parse(body));
    },
  };
  const git = (command, args) => {
    assert.equal(command, 'git');
    return args[0] === 'rev-parse' ? (options.wrongHead ? 'b'.repeat(40) : SHA) + '\n'
      : options.changedSource ? 'uncommitted change' : source;
  };
  const env = { GITHUB_ACTIONS: 'true', GITHUB_SHA: SHA, GITHUB_RUN_ID: RUN, GITHUB_RUN_ATTEMPT: ATTEMPT,
    RUNNER_TEMP: runnerTemp, WRANGLER_OUTPUT_FILE_DIRECTORY: outputDir,
    STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE: output, CLOUDFLARE_API_TOKEN: TOKEN, ...options.env };
  return { ...h, writes, args: { env, io, git, root, request: h.request, temporaryDirectory } };
}
test('postCommands capture reads only the action directory and writes exclusive runner-temp evidence', async () => {
  const h = filesystemHarness(); const result = await captureCommercialDeployment(h.args);
  assert.deepEqual(h.writes, [result]); assert.equal(h.calls.length, 1);
});
for (const options of [{ existing: true }, { extraFile: true }, { symlink: true }, { wrongHead: true },
  { changedSource: true }, { env: { GITHUB_ACTIONS: 'false' } }, { env: { WRANGLER_OUTPUT_FILE_PATH: '/other' } },
  { env: { WRANGLER_OUTPUT_FILE_DIRECTORY: '/other/wranglerArtifacts-44444444-4444-4444-8444-444444444444' } },
  { env: { STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE: '/other/evidence.json' } }])
  test(`invalid capture boundary stops before API/write ${JSON.stringify(options)}`, async () => {
    const h = filesystemHarness(options);
    await assert.rejects(() => captureCommercialDeployment(h.args), /STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE_REFUSED/);
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
  });
test('wx refuses a competing output creation without overwriting or leaking errors', async () => {
  const h = filesystemHarness({ writeRace: true });
  await assert.rejects(() => captureCommercialDeployment(h.args), error => error.message === 'STAGING_COMMERCIAL_DEPLOYMENT_EVIDENCE_REFUSED');
  assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0);
});
test('captured evidence is accepted by independent suppression reads; annotation drift is denied', async () => {
  const h = setup(); const evidence = await collectCommercialDeploymentEvidence(h.args);
  for (const drift of [false, true]) {
    const verify = createCommercialSuppressionVerifier({ evidence, sourceSha: SHA, sourceText: source, apiToken: TOKEN,
      request: async url => new Response(JSON.stringify({ success: true, result: url.endsWith('/deployments')
        ? { deployments: [deployment(drift ? { annotations: { 'workers/message': 'changed' } } : {})] }
        : { id: VERSION, resources: { bindings: [{ name: 'SUPABASE_URL', type: 'plain_text', text: COMMERCIAL_STAGE.supabaseUrl }] } } })) });
    if (drift) await assert.rejects(() => verify(), /suppression evidence/);
    else assert.equal((await verify()).paymentNotificationMode, 'suppressed');
  }
  for (const change of [{ provenance: 'manual' }, { workflowRunAttempt: '1' }, { deploymentMessage: 'manual' },
    { wranglerVersion: '4.125.0' }, { wranglerOutputSha256: null }])
    assert.throws(() => createCommercialSuppressionVerifier({ evidence: { ...evidence, ...change }, sourceSha: SHA, sourceText: source, apiToken: TOKEN }));
});
