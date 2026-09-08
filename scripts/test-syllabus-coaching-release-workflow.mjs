import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

const workflow = readFileSync(new URL('../.github/workflows/release-syllabus-coaching.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const baseline = '448b76d53682951f7188f477924a4a9dd7b48354';
const product = 'a'.repeat(40), head = 'b'.repeat(40);
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const env = {
  PRODUCT_SHA: product, GITHUB_SHA: product, REVIEWED_BASELINE_SHA: baseline,
  EXPECTED_CURRENT_PAGES_SHA: baseline, GITHUB_REPOSITORY: 'codingwally/Bar-Exam-simulator',
  GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'reviewed-owner', CONFIRM_RELEASE: 'true',
  VALIDATION_RUN_ID: '123', APPROVAL_REFERENCE: 'Reviewed candidate and private independent cleanup record',
  RELEASE_TARGET: 'staging', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1',
  STAGING_ARTIFACT_ID: '789', STAGING_MARKER_ENVIRONMENT: 'syllabus-coaching-staging-approved',
  STAGING_MARKER_TASK: 'syllabus-coaching-staging-gate', RUNNER_TEMP: '/runner-temp',
  INDEPENDENT_CLEANUP_CONFIRMED: 'true', INDEPENDENT_CLEANUP_EVIDENCE_SHA256: `sha256:${'d'.repeat(64)}`,
};

function block(name) {
  const matches = [...workflow.matchAll(new RegExp(`// BEGIN ${name}\\n([\\s\\S]*?)\\s*// END ${name}`, 'gu'))];
  assert.equal(matches.length, 1, `Exactly one executable ${name} gate`);
  return matches[0][1].replace(/^\s*import [^\n]+;\n/gmu, '');
}

async function execute(name, dependencies = {}, source = block(name)) {
  const deny = (...args) => { throw new Error(`Unexpected tool call: ${args[0]}`); };
  const values = {
    assert, createHash, isDeepStrictEqual, Buffer, process: { env: clone(env) }, execFileSync: deny,
    readFileSync: deny, writeFileSync: deny, mkdirSync: deny, fetch: deny, ...dependencies,
  };
  return new AsyncFunction(...Object.keys(values), source)(...Object.values(values));
}

const ciAdditions = [
  "- 'worker/syllabus-results-policy.test.mjs'", "- 'worker/syllabus-results-route-policy.test.mjs'",
  "- 'scripts/test-syllabus-submission-reliability.mjs'",
  'node --test scripts/test-syllabus-submission-reliability.mjs',
];

function sourceFixture(overrides = {}) {
  const state = {
    env: clone(env), main: product, checkedOut: product, tree: product,
    changes: 'M\tworker/examiner-core.mjs\nA\tscripts/test-syllabus-coaching-layout.mjs',
    ciPatch: ciAdditions.map(line => `+${line}`).join('\n'),
    run: { event: 'pull_request', path: '.github/workflows/validate-mandatory-early-access.yml',
      status: 'completed', conclusion: 'success', head_sha: head, pull_requests: [{ number: 42 }] },
    pr: { number: 42, merged: true, base: { ref: 'main', repo: { full_name: env.GITHUB_REPOSITORY } },
      head: { sha: head, repo: { full_name: env.GITHUB_REPOSITORY } } },
    calls: [], ...overrides,
  };
  state.dependencies = {
    process: { env: state.env },
    execFileSync(command, args) {
      state.calls.push([command, ...args]);
      if (command === 'gh') {
        const route = args[1].split(`repos/${env.GITHUB_REPOSITORY}/`)[1];
        const result = route === 'git/ref/heads/main' ? { object: { sha: state.main } }
          : route.startsWith('actions/runs/') ? state.run
            : route.startsWith('commits/') ? [state.pr] : state.pr;
        return JSON.stringify(result);
      }
      assert.equal(command, 'git');
      if (args[0] === 'rev-parse') {
        if (args[1] === 'HEAD') return state.checkedOut;
        if (args[1] === 'refs/remotes/origin/syllabus-validation-head') return head;
        return args[1] === `${product}^{tree}` ? product : state.tree;
      }
      if (args.includes('--name-status')) return state.changes;
      if (args.includes('--unified=0')) return state.ciPatch;
      if (args.includes('--is-ancestor') && state.unrelatedBaseline) throw new Error('Not an ancestor');
      if (args.includes('worker') && state.immutableDelta) throw new Error('Immutable source changed');
      return '';
    },
  };
  return state;
}

test('the real source gate accepts only an exact validated main tree with additive CI', async () => {
  const state = sourceFixture();
  await execute('source-gate', state.dependencies);
  assert.ok(state.calls.some(call => call.includes('worker') && call.includes('supabase')
    && call.includes('content') && call.includes('study-room') && call.includes('assets/study-room*')
    && call.includes(':(exclude)worker/examiner-core.mjs')));
  state.run.pull_requests = [];
  await execute('source-gate', state.dependencies);
});

test('the real source gate fails closed on bad authorization, source, PR, or CI', async () => {
  const cases = [
    state => { state.env.CONFIRM_RELEASE = 'false'; },
    state => { state.env.APPROVAL_REFERENCE = ' '; },
    state => { state.env.GITHUB_REPOSITORY = 'fork/repository'; },
    state => { state.env.GITHUB_REF = 'refs/heads/feature'; },
    state => { state.env.RELEASE_TARGET = 'preview'; },
    state => { state.env.EXPECTED_CURRENT_PAGES_SHA = head; },
    state => { state.env.PRODUCT_SHA = 'main'; },
    state => { state.env.VALIDATION_RUN_ID = '123; anything'; },
    state => { state.main = head; }, state => { state.checkedOut = head; },
    state => { state.tree = head; }, state => { state.unrelatedBaseline = true; },
    state => { state.run.event = 'push'; }, state => { state.run.path = '.github/workflows/other.yml'; },
    state => { state.run.status = 'in_progress'; }, state => { state.run.conclusion = 'failure'; },
    state => { state.pr.merged = false; }, state => { state.pr.head.repo.full_name = 'fork/repository'; },
    state => { state.pr.base.ref = 'other'; }, state => { state.immutableDelta = true; },
    state => { state.ciPatch += '\n-          node scripts/existing-gate.mjs'; },
    state => { state.ciPatch += '\n+          true'; },
  ];
  for (const change of cases) {
    const state = sourceFixture(); change(state);
    await assert.rejects(execute('source-gate', state.dependencies), String(change));
  }
});

test('the actual scope gate rejects deletion, rename, and every unrelated runtime surface', async () => {
  for (const changes of [
    '', 'D\tassets/examinations.js', 'R100\tassets/examinations.js\tassets/other.js',
    ...['worker/wrangler.toml', 'worker/wrangler.staging.toml',
      'worker/wrangler.public-api.toml', 'worker/package.json', 'worker/package-lock.json',
      'worker/commercial-entry.mjs', 'worker/subject-matter-review.mjs', 'worker/public-api-alias.mjs',
      'assets/phase2-config.js', 'assets/study-room-live.js', 'study-room/index.html',
      'content/duediligence-2026/syllabus-units.json', 'supabase/migrations/new.sql',
      '.github/workflows/release-unlimited-feature-access.yml',
      'scripts/astra-release-database-contract.mjs'].map(file => `M\t${file}`),
  ]) {
    const state = sourceFixture({ changes });
    await assert.rejects(execute('source-gate', state.dependencies), changes);
  }
});

function proofFixture() {
  const lifecyclePath = 'artifacts/staging-e2e/examinations-api-syllabus-run-cleanup-manifest.json';
  const lifecycle = Buffer.from(JSON.stringify({ runId: 'syllabus-run', sourceSha: product,
    projectRef: 'hlzqmreeoghbldnhlybr', cleanupComplete: true, independentDatabaseReadbackRequired: true,
    fixtures: ['admin', 'student-a'].map(label => ({ label, creationState: 'recorded', cleanupState: 'deleted', auditCaptureState: 'captured-before-auth-delete' })),
  }));
  const provenance = { schemaVersion: 1, runId: 'syllabus-run', releaseSha: product, githubRunId: '456', githubRunAttempt: '1', repository: env.GITHUB_REPOSITORY };
  const cleanup = { ...provenance, lifecycleManifestPath: lifecyclePath, lifecycleManifestSha256: hash(lifecycle),
    supportedApiComplete: true, independentDatabaseReadbackRequired: true, cleanupFailures: [] };
  const cleanupBytes = Buffer.from(JSON.stringify(cleanup));
  const summary = { ...provenance, purpose: 'syllabus-coaching-staging', passed: true, boundedItems: 1,
    coachingBeforeReveal: true, explicitReveal: true, assistedBeforeReveal: false, assistedAfterReveal: false,
    cleanup: { supportedApiComplete: true, independentDatabaseReadbackRequired: true },
    cleanupManifestSha256: hash(cleanupBytes) };
  const summaryBytes = Buffer.from(JSON.stringify(summary));
  const files = new Map([
    ['artifacts/syllabus-coaching/summary.json', summaryBytes],
    ['artifacts/syllabus-coaching/cleanup-manifest.json', cleanupBytes], [lifecyclePath, lifecycle],
  ]);
  const proof = { kind: 'syllabus-coaching-staging-v1', product_sha: product, run_id: '456', run_attempt: '1',
    artifact_id: '789', summary_sha256: hash(summaryBytes), cleanup_sha256: hash(cleanupBytes),
    lifecycle_path: lifecyclePath, lifecycle_sha256: hash(lifecycle) };
  const marker = { id: 77, sha: product, environment: env.STAGING_MARKER_ENVIRONMENT,
    task: env.STAGING_MARKER_TASK, payload: proof };
  const state = { files, proof, marker, summary, cleanup, env: clone(env), calls: [],
    markerState: 'success', artifact: { expired: false, name: 'syllabus-coaching-456-1', workflow_run: { id: 456, head_sha: product } },
    run: { path: '.github/workflows/release-syllabus-coaching.yml', event: 'workflow_dispatch',
      head_branch: 'main', head_sha: product, run_attempt: 1, status: 'completed', conclusion: 'success' },
  };
  state.dependencies = {
    process: { env: state.env },
    readFileSync(file) {
      const canonical = file.replace('/runner-temp/syllabus-staging-proof/', 'artifacts/');
      assert.ok(files.has(canonical), `Missing proof ${canonical}`); return files.get(canonical);
    },
    writeFileSync() {}, mkdirSync() {},
    execFileSync(command, args, options) {
      state.calls.push([command, ...args]);
      if (command === 'unzip') {
        return args[0] === '-Z1' ? [...files.keys()].map(file => file.replace('artifacts/', '')).join('\n') : '';
      }
      assert.equal(command, 'gh');
      const route = args[1].replace(`repos/${env.GITHUB_REPOSITORY}/`, '');
      if (args.includes('--input')) {
        state.written = JSON.parse(options.input);
        return JSON.stringify({ sha: product, id: 77 });
      }
      if (route.startsWith('deployments?')) return JSON.stringify(state.noMarkers ? [] : [state.marker]);
      if (route.includes('/statuses?')) return JSON.stringify([{ state: state.markerState }]);
      if (route.startsWith('actions/runs/')) return JSON.stringify(state.run);
      if (route.endsWith('/zip')) return Buffer.from('mock artifact archive');
      if (route.startsWith('actions/artifacts/')) return JSON.stringify(state.artifact);
      throw new Error(`Unmocked route ${route}`);
    },
  };
  return state;
}

test('the marker requires actual passing smoke and native cleanup evidence before any write', async () => {
  await execute('staging-marker', proofFixture().dependencies);
  for (const change of [
    state => { state.summary.passed = false; }, state => { state.summary.releaseSha = head; },
    state => { state.summary.githubRunId = '999'; }, state => { state.summary.boundedItems = 2; },
    state => { state.summary.coachingBeforeReveal = false; }, state => { state.summary.explicitReveal = false; },
    state => { state.summary.assistedBeforeReveal = true; }, state => { state.summary.assistedAfterReveal = true; },
    state => { state.summary.cleanup.supportedApiComplete = false; },
    state => { state.summary.cleanup.independentDatabaseReadbackRequired = false; },
    state => { state.summary.cleanupManifestSha256 = '0'.repeat(64); },
    state => { state.files.delete(state.cleanup.lifecycleManifestPath); },
    state => { state.files.set(state.cleanup.lifecycleManifestPath, Buffer.from('altered native manifest')); },
  ]) {
    const state = proofFixture(); change(state);
    state.files.set('artifacts/syllabus-coaching/summary.json', Buffer.from(JSON.stringify(state.summary)));
    await assert.rejects(execute('staging-marker', state.dependencies), String(change));
    assert.ok(state.calls.every(call => !call.includes('--input')), 'No marker write on failed smoke or cleanup proof');
  }
});

test('production accepts only an exact successful staging run with retained matching artifacts', async () => {
  await execute('production-proof', proofFixture().dependencies);
  for (const change of [
    state => { state.env.INDEPENDENT_CLEANUP_CONFIRMED = 'false'; },
    state => { state.env.INDEPENDENT_CLEANUP_EVIDENCE_SHA256 = ''; },
    state => { state.env.INDEPENDENT_CLEANUP_EVIDENCE_SHA256 = `sha256:${'0'.repeat(64)}`; },
    state => { state.env.APPROVAL_REFERENCE = ' '; }, state => { state.noMarkers = true; },
    state => { state.marker.sha = head; }, state => { state.marker.task = 'other-task'; },
    state => { state.markerState = 'failure'; }, state => { state.proof.kind = 'other-proof'; },
    state => { state.proof.product_sha = head; }, state => { state.run.head_sha = head; },
    state => { state.run.path = '.github/workflows/release-study-room-admin-beta.yml'; },
    state => { state.run.event = 'push'; }, state => { state.run.head_branch = 'feature'; },
    state => { state.run.run_attempt = 2; }, state => { state.run.status = 'in_progress'; },
    state => { state.run.conclusion = 'failure'; }, state => { state.artifact.expired = true; },
    state => { state.artifact.workflow_run.id = 888; }, state => { state.artifact.workflow_run.head_sha = head; },
    state => { state.proof.summary_sha256 = '0'.repeat(64); },
    state => { state.proof.cleanup_sha256 = '0'.repeat(64); },
    state => { state.proof.lifecycle_sha256 = '0'.repeat(64); },
    state => { state.files.delete(state.cleanup.lifecycleManifestPath); },
    state => { state.files.set('artifacts/../../unexpected.json', Buffer.from('{}')); },
  ]) {
    const state = proofFixture(); change(state);
    await assert.rejects(execute('production-proof', state.dependencies), String(change));
  }
});

test('matching file hashes cannot bless an unfinished or unrelated native cleanup manifest', async () => {
  for (const change of [
    native => { native.sourceSha = head; }, native => { native.runId = 'other-run'; },
    native => { native.projectRef = 'production-project'; }, native => { native.cleanupComplete = false; },
    native => { native.independentDatabaseReadbackRequired = false; },
    native => { native.fixtures.pop(); }, native => { native.fixtures[0].cleanupState = 'delete_requested'; },
    native => { native.fixtures[0].auditCaptureState = 'not_requested'; },
  ]) {
    const state = proofFixture();
    const native = JSON.parse(state.files.get(state.cleanup.lifecycleManifestPath)); change(native);
    const nativeBytes = Buffer.from(JSON.stringify(native));
    state.files.set(state.cleanup.lifecycleManifestPath, nativeBytes);
    state.cleanup.lifecycleManifestSha256 = hash(nativeBytes);
    const cleanupBytes = Buffer.from(JSON.stringify(state.cleanup));
    state.files.set('artifacts/syllabus-coaching/cleanup-manifest.json', cleanupBytes);
    state.summary.cleanupManifestSha256 = hash(cleanupBytes);
    state.files.set('artifacts/syllabus-coaching/summary.json', Buffer.from(JSON.stringify(state.summary)));
    await assert.rejects(execute('staging-marker', state.dependencies), String(change));
    assert.ok(state.calls.every(call => !call.includes('--input')));
  }
});

function baselineFixture(records, overrides = {}) {
  return {
    process: { env: { ...env, ...overrides } },
    execFileSync(command, args) {
      assert.equal(command, 'gh');
      if (args[1].endsWith('git/ref/heads/main')) return JSON.stringify({ object: { sha: product } });
      if (args[1].includes('deployments?')) return JSON.stringify(records);
      const id = Number(args[1].match(/deployments\/(\d+)\//u)[1]);
      const record = records.find(item => item.id === id);
      return JSON.stringify(record.state ? [{ state: record.state }] : []);
    },
    fetch: async () => ({ status: 200, text: async () => `${baseline}\n` }),
  };
}

test('Pages baseline ignores only terminal failures and its own queued Pages job inside the lock', async () => {
  await execute('pages-baseline', baselineFixture([{ id: 1, sha: baseline, state: 'success' }]));
  await execute('pages-baseline', baselineFixture([
    { id: 3, sha: head, state: 'inactive' }, { id: 2, sha: head, state: 'failure' },
    { id: 1, sha: baseline, state: 'success' },
  ]));
  const own = [{ id: 2, sha: product, state: 'in_progress' }, { id: 1, sha: baseline, state: 'success' }];
  await execute('pages-baseline', baselineFixture(own, { PAGES_LOCK: 'true' }));
  await assert.rejects(execute('pages-baseline', baselineFixture(own)));
  for (const state of ['queued', 'pending', 'in_progress', 'success', undefined]) {
    await assert.rejects(execute('pages-baseline', baselineFixture([
      { id: 2, sha: head, state }, { id: 1, sha: baseline, state: 'success' },
    ], { PAGES_LOCK: 'true' })));
  }
  const wrongLive = baselineFixture([{ id: 1, sha: baseline, state: 'success' }]);
  wrongLive.fetch = async () => ({ status: 200, text: async () => head });
  await assert.rejects(execute('pages-baseline', wrongLive));
  await assert.rejects(execute('pages-baseline', baselineFixture([])));
});

function historicalBaselineFixture(change = () => {}) {
  const state = {
    records: [{ id: 6335563699, sha: baseline, state: 'failure' }],
    run: { head_sha: baseline, path: '.github/workflows/release-syllabus-coaching.yml',
      event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'failure' },
    jobs: [
      { name: 'deploy_production_worker', conclusion: 'success' },
      { name: 'deploy_production_pages', conclusion: 'failure', steps: [
        { name: 'Publish Pages after both Worker gates', conclusion: 'success' },
        { name: 'Verify exact live Pages bytes and preserved Study Room markers', conclusion: 'failure' },
      ] },
    ],
    pagesStatus: 'succeed', assetDrift: false, markerDrift: false, env: clone(env), reads: [],
  };
  change(state);
  state.dependencies = {
    process: { env: state.env },
    execFileSync(command, args) {
      state.reads.push([command, ...args]);
      if (command === 'git') {
        assert.equal(args[0], 'show'); assert.ok(args[1].startsWith(`${baseline}:`));
        return Buffer.from(args[1]);
      }
      assert.equal(command, 'gh');
      const route = args[1].replace(`repos/${env.GITHUB_REPOSITORY}/`, '');
      if (route === 'git/ref/heads/main') return JSON.stringify({ object: { sha: product } });
      if (route.startsWith('deployments?')) return JSON.stringify(state.records);
      if (route.startsWith('deployments/')) {
        const id = Number(route.split('/')[1]);
        return JSON.stringify([{ state: state.records.find(record => record.id === id)?.state }]);
      }
      if (route === 'actions/runs/34269676417') return JSON.stringify(state.run);
      if (route === 'actions/runs/34269676417/jobs') return JSON.stringify({ jobs: state.jobs });
      if (route === `pages/deployments/${baseline}`) return JSON.stringify({ status: state.pagesStatus });
      throw new Error(`Unreviewed historical route: ${route}`);
    },
    fetch: async url => {
      const path = new URL(url).pathname.slice(1);
      return { status: 200, text: async () => state.markerDrift ? head : `${baseline}\n`,
        arrayBuffer: async () => Buffer.from(state.assetDrift ? 'changed' : `${baseline}:${path}`) };
    },
  };
  return state;
}

test('only the pinned historical verifier failure may be proven by actual publication and exact live bytes', async () => {
  const good = historicalBaselineFixture();
  await execute('pages-baseline', good.dependencies);
  assert.equal(good.reads.filter(call => call[0] === 'git').length, 5);
  assert.ok(good.reads.every(call => !call.includes('--input')), 'Baseline proof is read-only');
  const locked = historicalBaselineFixture(state => {
    state.env.PAGES_LOCK = 'true'; state.records.unshift({ id: 2, sha: product, state: 'in_progress' });
  });
  await execute('pages-baseline', locked.dependencies);
  for (const change of [
    state => { state.records[0].id = 6335563700; },
    state => { state.records[0].sha = head; },
    state => { state.run.head_sha = head; },
    state => { state.run.path = '.github/workflows/other.yml'; },
    state => { state.run.event = 'push'; },
    state => { state.run.head_branch = 'other'; },
    state => { state.run.status = 'in_progress'; },
    state => { state.run.conclusion = 'cancelled'; },
    state => { state.jobs[0].conclusion = 'failure'; },
    state => { state.jobs[1].steps[0].conclusion = 'failure'; },
    state => { state.jobs[1].steps[1].name = 'Different failure'; },
    state => { state.jobs[1].steps.push({ name: 'Other failure', conclusion: 'failure' }); },
    state => { state.pagesStatus = 'queued'; },
    state => { state.assetDrift = true; },
    state => { state.markerDrift = true; },
    ...['queued', 'pending', 'in_progress', 'success', 'unknown'].map(status => state => {
      state.env.PAGES_LOCK = 'true'; state.records.unshift({ id: 2, sha: head, state: status });
    }),
  ]) {
    const bad = historicalBaselineFixture(change);
    await assert.rejects(execute('pages-baseline', bad.dependencies), String(change));
  }
});

function workerFixture(options = {}) {
  const baselines = { 'wrangler.toml': '596c3bf7-1e60-4d39-b99d-3cedca897a54',
    'wrangler.public-api.toml': 'ae73867c-8fc1-4169-8588-8d32d73d0aef' };
  const changed = new Set(), mutations = [], reads = [];
  return {
    mutations, reads,
    execFileSync(command, args) {
      assert.equal(command, 'npx'); assert.deepEqual(args.slice(0, 2), ['--yes', 'wrangler@4.114.0']);
      const config = args[args.indexOf('--config') + 1];
      if (args[2] === 'deployments') {
        reads.push(config);
        return JSON.stringify({ versions: options.split ? [{ version_id: baselines[config], percentage: 50 }]
          : [{ version_id: changed.has(config) ? 'c'.repeat(36) : options.wrongVersion || baselines[config], percentage: 100 }] });
      }
      if (args[2] === 'versions') return JSON.stringify({ resources: { bindings: [
        { name: 'existing-variable', type: 'plain_text', text: changed.has(config) && options.bindingChange ? 'changed' : 'retained' },
        { name: 'GEMINI_API_KEY', type: 'secret_text' },
      ] } });
      assert.equal(args[2], 'deploy'); assert.ok(args.includes('--keep-vars'));
      if (!args.includes('--dry-run')) { changed.add(config); mutations.push(config); }
      return '';
    },
  };
}

test('actual Worker cutover checks both fixed versions, preserves bindings, and deploys application before alias', async () => {
  const state = workerFixture(); await execute('worker-cutover', state);
  assert.deepEqual(state.mutations, ['wrangler.toml', 'wrangler.public-api.toml']);
  assert.deepEqual(state.reads.slice(0, 2), ['wrangler.toml', 'wrangler.public-api.toml']);
  for (const options of [{ split: true }, { wrongVersion: 'wrong' }]) {
    const failed = workerFixture(options);
    await assert.rejects(execute('worker-cutover', failed)); assert.deepEqual(failed.mutations, []);
  }
  const altered = workerFixture({ bindingChange: true });
  await assert.rejects(execute('worker-cutover', altered), error => {
    assert.equal(error.actual, false);
    assert.doesNotMatch(String(error), /existing-variable|retained|GEMINI_API_KEY/u);
    return true;
  });
  assert.deepEqual(altered.mutations, ['wrangler.toml'], 'Binding drift prevents alias and Pages deployment');
});

test('public probes exercise real Syllabus catalog and Study Room signed-out boundaries on both Workers', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/examinations/query')) assert.deepEqual(JSON.parse(options.body), { operation: 'subject_catalog' });
    return { status: 401, headers: new Headers({ 'access-control-allow-origin': 'https://duediligence.ph' }), json: async () => ({ ok: false }) };
  };
  await execute('public-boundaries', { fetch }); assert.equal(calls.length, 8);
  await assert.rejects(execute('public-boundaries', { fetch: async () => ({ status: 200 }) }));
});

test('live verification runs after the Pages environment job completes and cannot own or mutate it', () => {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  const job = name => {
    const match = jobs.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, 'mu'));
    assert.ok(match, `Missing ${name} job`); return match[1];
  };
  const publish = job('deploy_production_pages'), verify = job('verify_production');
  assert.match(publish, /^    environment:\n      name: github-pages$/mu);
  assert.ok(publish.trimEnd().endsWith('uses: actions/deploy-pages@v4'), 'The publishing job must end with deployment so its environment can complete.');
  assert.doesNotMatch(publish, /BEGIN live-pages|Verify exact live Pages bytes/u);
  assert.match(verify, /^    needs: deploy_production_pages$/mu);
  assert.doesNotMatch(verify, /^    environment:|^    if:|continue-on-error:|\b(?:pages|id-token):\s*write|actions\/deploy-pages|wrangler@/mu);
  assert.match(verify, /^    permissions:\n      contents: read\n      deployments: read$/mu);
  assert.match(verify, /ref: \$\{\{ inputs\.product_sha \}\}/u);
  assert.match(verify, /npm ci --prefix worker --ignore-scripts --no-audit --no-fund/u);
  assert.match(verify, /node scripts\/build-pages-artifact\.mjs/u);
  assert.match(verify, /BEGIN live-pages/u);
  assert.match(verify, /BEGIN public-boundaries/u, 'The independent verifier must retain post-publish API checks.');
});

function livePagesFixture({ state = 'success', sha = product, changedAsset } = {}) {
  const calls = { api: 0, fetch: 0, waits: 0 };
  const bytes = path => Buffer.from(path === '.well-known/duediligence-release.txt' ? `${product}\n`
    : path === 'study-room/index.html' ? 'layout=stable-pins-20260908-1 join=free-join-20260909-1' : path);
  return {
    calls,
    execFileSync(command, args) {
      assert.equal(command, 'gh'); calls.api++;
      return JSON.stringify(args[1].includes('deployments?') ? [{ id: 1, sha }] : state ? [{ state }] : []);
    },
    readFileSync(path) { assert.ok(path.startsWith('.pages-dist/')); return bytes(path.slice('.pages-dist/'.length)); },
    fetch: async url => {
      calls.fetch++;
      const parsed = new URL(url), path = parsed.pathname.slice(1);
      assert.equal(parsed.origin, 'https://duediligence.ph');
      assert.equal(parsed.searchParams.get('release'), product);
      return { status: 200, arrayBuffer: async () => path === changedAsset ? Buffer.from('unexpected live bytes') : bytes(path) };
    },
    setTimeout(callback) { calls.waits++; callback(); },
  };
}

test('actual live Pages verifier accepts completed publication and rejects incomplete status or mismatched bytes', async () => {
  // Execute the shipped Pages status/byte checks; the following API probe is
  // executed independently above, avoiding real dynamic-import network calls.
  const source = block('live-pages').split('// Recheck both API boundaries')[0];
  const completed = livePagesFixture();
  await execute('live-pages', completed, source);
  assert.equal(completed.calls.fetch, 14);
  assert.equal(completed.calls.waits, 0);
  for (const state of ['in_progress', 'queued', 'pending', 'failure', 'error', null]) {
    const fixture = livePagesFixture({ state });
    await assert.rejects(execute('live-pages', fixture, source), `State ${state} must not be claimed as verified publication.`);
    assert.equal(fixture.calls.fetch, 0, 'Incomplete deployment metadata must fail before asset reads.');
    assert.equal(fixture.calls.waits, 11, 'Only the existing bounded retries are permitted.');
  }
  await assert.rejects(execute('live-pages', livePagesFixture({ sha: baseline }), source));
  await assert.rejects(execute('live-pages', livePagesFixture({ changedAsset: 'assets/examinations.js' }), source));
});

test('workflow ordering retains exact proof before the marker and prevents unrelated mutations', () => {
  for (const line of workflow.split('\n').filter(line => /^\s+node (?:--test )?(?:worker|scripts)\//u.test(line))) {
    for (const filename of line.trim().split(/\s+/u).filter(token => /^(?:worker|scripts)\/.*\.mjs$/u.test(token))) {
      assert.ok(existsSync(new URL(`../${filename}`, import.meta.url)), `Workflow references a missing script: ${filename}`);
    }
  }
  const index = token => { const value = workflow.indexOf(token); assert.ok(value >= 0, token); return value; };
  assert.ok(index('node scripts/verify-syllabus-coaching-staging.mjs --execute-staging') < index('id: staging_evidence'));
  assert.ok(index('id: staging_evidence') < index('// BEGIN staging-marker'));
  assert.ok(index('// BEGIN production-proof') < index('// BEGIN worker-cutover'));
  assert.ok(index('// BEGIN worker-cutover') < index('uses: actions/deploy-pages@v4'));
  assert.ok(index('PAGES_LOCK: \'true\'') < index('uses: actions/deploy-pages@v4'));
  assert.match(workflow, /deploy_production_worker:\n\s+if: inputs.target == 'production'\n\s+needs: authorize/u);
  assert.match(workflow, /deploy_staging:\n\s+if: inputs.target == 'staging'\n\s+needs: authorize/u);
  assert.match(workflow, /deploy_production_pages:\n\s+needs: deploy_production_worker/u);
  assert.match(workflow, /group: examination-room-production-cutover\n\s+cancel-in-progress: false/u);
  assert.match(workflow, /group: github-pages\n\s+cancel-in-progress: false/u);
  assert.match(workflow, /artifacts\/syllabus-coaching\/summary\.json\n\s+artifacts\/syllabus-coaching\/cleanup-manifest\.json\n\s+artifacts\/staging-e2e\/\*-cleanup-manifest\.json/u);
  assert.match(workflow, /STAGING_ARTIFACT_ID: \$\{\{ steps\.staging_evidence\.outputs\.artifact-id \}\}/u);
  assert.match(workflow, /node scripts\/test-staging-artifact\.mjs/u);
  assert.match(workflow, /node scripts\/test-study-room-hotfix-behavior\.mjs/u);
  assert.match(workflow, /layout=stable-pins-20260908-1/u);
  assert.match(workflow, /join=free-join-20260909-1/u);
  assert.match(workflow, /assert\.deepEqual\(bytes, readFileSync\(`\.pages-dist\/\$\{path\}`\)/u);
  assert.doesNotMatch(workflow, /secrets-file|secret (?:put|bulk|delete)|supabase\s+(?:db|migration)|\bpsql\b|apply_migration|GEMINI_MODEL\s*:|LIVEKIT_(?:URL|API_KEY|API_SECRET):/u);
  assert.doesNotMatch(workflow, /astra-release-database-contract\.mjs\s+--|run-staging-e2e-suite\.mjs\s+complete-beta/u,
    'This core/UI-only release must not invoke or relax the unrelated broad schema gate.');
  assert.match(block('production-proof'), /operator attestation, not a CI claim/u);
  for (const name of ['source-gate', 'staging-marker', 'production-proof', 'pages-baseline', 'worker-cutover', 'public-boundaries', 'live-pages']) {
    assert.doesNotThrow(() => new AsyncFunction(block(name)), `${name} must parse`);
  }
});
