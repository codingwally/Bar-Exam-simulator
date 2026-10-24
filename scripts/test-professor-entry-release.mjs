import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  ASSETS, BASE_SHA, DASHBOARD, LIVE_ORIGIN, PREVIEW_ORIGIN, MARKER,
  deriveCandidate, entrySpans, manifest, previewConfig, sha256,
  verifyArtifacts, verifyDashboard, verifyProvenance, verifyPublic, verifyPreviewAccount,
} from './professor-entry-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = Object.fromEntries(ASSETS.map(file => [file, execFileSync('git', ['show', `${BASE_SHA}:${file}`], { cwd: root })]));
const reviewed = await readFile(path.join(root, ASSETS[0]), 'utf8');
const approved = await manifest(root);
const candidate = deriveCandidate(base, reviewed);
const sourceSha = '1234567890abcdef1234567890abcdef12345678';

test('candidate is pinned to actual live three-file hashes and reviewed entry spans', () => {
  assert.deepEqual(entrySpans(reviewed).map(sha256), approved.reviewed_entry_sha256);
  for (const file of ASSETS) {
    assert.equal(sha256(base[file]), approved.assets[file].baseline_sha256);
    assert.equal(sha256(candidate[file]), approved.assets[file].candidate_sha256);
  }
  const stripEntry = text => entrySpans(text).reduce((value, span, i) => value.replace(span, `ENTRY${i}`), text);
  assert.equal(stripEntry(candidate[ASSETS[0]].toString()), stripEntry(base[ASSETS[0]].toString()));
  assert.match(candidate['service-worker.js'].toString(), /identity=result-attempt-20261024-1/u);
  assert.doesNotMatch(candidate['service-worker.js'].toString(), /native-close-20261023-1/u);
  assert.notEqual(sha256(Buffer.from(reviewed.replaceAll('\r\n', '\n'))), sha256(candidate[ASSETS[0]]), 'The main module must not be published wholesale');
});

test('candidate door opens only the private new dashboard and never accesses the main session', () => {
  const phase2 = candidate[ASSETS[0]].toString();
  const source = phase2.slice(phase2.indexOf('  function professorDoorDestination('), phase2.indexOf('  async function recordCurrentTermsAcceptance('));
  const elements = new Map(['dd2-professor-door', 'dd2-professor-door-retry', 'dd2-examination-room-status', 'dd2-professor-door-badge'].map(id => [id, { dataset: {}, setAttribute() {} }]));
  const destinations = [];
  const context = { document: { getElementById: id => elements.get(id) }, location: { assign: target => destinations.push(target) } };
  Object.defineProperty(context, 'state', { get() { throw new Error('Main session must not be read'); } });
  vm.runInNewContext(`${source}\ncheckProfessorDoor();activateProfessorDoor();`, context);
  assert.deepEqual(destinations, [DASHBOARD]);
  assert.equal(new URL(destinations[0]).search, '');
  assert.doesNotMatch(entrySpans(phase2).join(''), /\/examination-room\/student\.html|room key|student number/iu);
});

test('missing or duplicated source anchors and changed destinations fail closed', () => {
  assert.throws(() => deriveCandidate(base, reviewed.replace('  function examinationRoomContent()', '  function missingEntry()')));
  assert.throws(() => deriveCandidate(base, `${reviewed}\n  function examinationRoomContent()`));
  assert.throws(() => deriveCandidate(base, reviewed.replace(DASHBOARD, 'https://example.invalid/admin/exams')));
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'professor-entry-release-'));
  assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselineDir = path.join(directory, 'baseline'), candidateDir = path.join(directory, 'candidate');
  for (const [folder, assets, marker] of [[baselineDir, base, BASE_SHA], [candidateDir, candidate, sourceSha]]) {
    for (const [name, bytes] of Object.entries({ ...assets, [MARKER]: `${marker}\n` })) {
      await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
      await writeFile(path.join(folder, name), bytes);
    }
    for (let index = 0; index < 102; index++) await writeFile(path.join(folder, `unchanged-${index}.bin`), Buffer.from([0, index, 255]));
  }
  return { baselineDir, candidateDir };
}

test('complete binary and text artifact comparison permits exactly three assets plus marker', async t => {
  const { baselineDir, candidateDir } = await fixture(t);
  const evidence = await verifyArtifacts(baselineDir, candidateDir, sourceSha, approved);
  assert.equal(Object.keys(evidence.baseline).length, 106);
  assert.deepEqual(evidence.changed, [...ASSETS, MARKER].sort());
});

for (const attack of ['unrelated edit', 'extra file', 'missing file', 'unreviewed entry', 'stale marker']) {
  test(`artifact release rejects ${attack}`, async t => {
    const { baselineDir, candidateDir } = await fixture(t);
    if (attack === 'unrelated edit') await writeFile(path.join(candidateDir, 'unchanged-3.bin'), 'changed');
    if (attack === 'extra file') await writeFile(path.join(candidateDir, 'private-secret.txt'), 'extra');
    if (attack === 'missing file') await rm(path.join(candidateDir, 'unchanged-3.bin'));
    if (attack === 'unreviewed entry') await writeFile(path.join(candidateDir, ASSETS[0]), Buffer.concat([candidate[ASSETS[0]], Buffer.from('\nchanged')]));
    if (attack === 'stale marker') await writeFile(path.join(candidateDir, MARKER), BASE_SHA);
    await assert.rejects(verifyArtifacts(baselineDir, candidateDir, sourceSha, approved));
  });
}

test('public verification checks all bytes with no credential headers and refuses stale public files', async () => {
  const bytes = { 'index.html': Buffer.from('document'), 'asset.bin': Buffer.from([0, 255]) };
  const hashes = Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, sha256(value)]));
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers, undefined); assert.equal(options.credentials, undefined);
    const name = new URL(url).pathname.slice(1) || 'index.html';
    return new Response(bytes[name]);
  };
  await verifyPublic(LIVE_ORIGIN, hashes, sourceSha, fetcher);
  await assert.rejects(verifyPublic(LIVE_ORIGIN, hashes, sourceSha, async () => new Response('stale')));
  await assert.rejects(verifyPublic('https://unapproved.invalid', hashes, sourceSha, fetcher));
});

test('production destination requires private sign-in and never treats a public dashboard as ready', async () => {
  const fetcher = async url => {
    const pathname = new URL(url).pathname;
    if (pathname === '/admin/exams') return new Response(null, { status: 303, headers: { location: '/admin/login' } });
    if (pathname === '/admin/login') return new Response('<input autocomplete="current-password">');
    return new Response('{}', { status: 401 });
  };
  await verifyDashboard(fetcher);
  await assert.rejects(verifyDashboard(async () => new Response('public')));
});

function provenanceFixture(operation = 'publish') {
  const tree = 'abcdef1234567890abcdef1234567890abcdef12';
  const env = {
    GITHUB_REPOSITORY: 'codingwally/Bar-Exam-simulator', GITHUB_ACTOR: 'codingwally', GITHUB_TRIGGERING_ACTOR: 'codingwally',
    EXPECTED_SOURCE_SHA: sourceSha, GITHUB_SHA: sourceSha, RELEASE_OPERATION: operation, VALIDATION_RUN_ID: '123',
    GITHUB_REF: operation === 'publish' ? 'refs/heads/main' : 'refs/heads/fix/professor-door-practice-20261024', CONFIRM_PRODUCTION: 'true',
  };
  const data = {
    'actions/runs/123': { event: 'pull_request', path: '.github/workflows/validate-mandatory-early-access.yml', status: 'completed', conclusion: 'success', head_sha: sourceSha, pull_requests: [{ number: 418 }] },
    'pulls/418': { base: { ref: 'main', repo: { full_name: env.GITHUB_REPOSITORY } }, head: { ref: 'fix/professor-door-practice-20261024', sha: sourceSha, repo: { full_name: env.GITHUB_REPOSITORY } }, merged: operation === 'publish', state: 'open' },
    'pulls/418/files?per_page=100': ASSETS.map(filename => ({ filename })),
    [`git/commits/${sourceSha}`]: { tree: { sha: tree } },
    'git/ref/heads/main': { object: { sha: sourceSha } },
  };
  return { env, data, api: route => { assert.ok(data[route], route); return data[route]; } };
}

test('preview permits only the exact validated open PR; publish requires merged current main', async () => {
  for (const operation of ['preview', 'publish']) {
    const { env, api } = provenanceFixture(operation);
    await verifyProvenance(env, api);
  }
  const { env, api } = provenanceFixture('publish');
  env.RELEASE_OPERATION = 'preview';
  await verifyProvenance(env, api);
});

for (const attack of ['failed validation', 'wrong workflow', 'unmerged production', 'main advanced', 'outside scope', 'another actor', 'changed tree']) {
  test(`provenance rejects ${attack}`, async () => {
    const { env, data, api } = provenanceFixture();
    if (attack === 'failed validation') data['actions/runs/123'].conclusion = 'failure';
    if (attack === 'wrong workflow') data['actions/runs/123'].path = '.github/workflows/other.yml';
    if (attack === 'unmerged production') data['pulls/418'].merged = false;
    if (attack === 'main advanced') data['git/ref/heads/main'].object.sha = 'ffffffffffffffffffffffffffffffffffffffff';
    if (attack === 'outside scope') data['pulls/418/files?per_page=100'].push({ filename: 'worker/index.mjs' });
    if (attack === 'another actor') env.GITHUB_TRIGGERING_ACTOR = 'other';
    if (attack === 'changed tree') {
      const old = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      data['actions/runs/123'].head_sha = old; data['pulls/418'].head.sha = old;
      data[`git/commits/${old}`] = { tree: { sha: old } };
    }
    await assert.rejects(verifyProvenance(env, api));
  });
}

test('preview configuration is a separate static-only Worker with no resource bindings or routes', () => {
  const value = previewConfig('/tmp/candidate', 'a'.repeat(32));
  assert.equal(value.name, new URL(PREVIEW_ORIGIN).hostname.split('.')[0]);
  assert.deepEqual(Object.keys(value).sort(), ['account_id', 'assets', 'compatibility_date', 'name', 'workers_dev']);
  assert.equal(value.assets.html_handling, 'none');
  assert.equal(value.assets.not_found_handling, 'none');
  assert.throws(() => previewConfig('/tmp/candidate', 'other'));
});

test('preview account preflight reads the existing subdomain before any deployment', async () => {
  await verifyPreviewAccount('a'.repeat(32), 'synthetic-test-token', async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/workers/subdomain`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
    return Response.json({ success: true, result: { subdomain: 'wallyesteban1993' } });
  });
  await assert.rejects(verifyPreviewAccount('a'.repeat(32), 'synthetic-test-token', async () => Response.json({ success: true, result: { subdomain: 'another-account' } })));
  await assert.rejects(verifyPreviewAccount('a'.repeat(32), 'synthetic-test-token', async () => new Response('{}', { status: 403 })));
  await assert.rejects(verifyPreviewAccount('a'.repeat(32), '', async () => { throw new Error('A missing token must not make a request'); }));
});
