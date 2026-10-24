import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_SHA = '8ed2a21d3fa33d065fdf1c3f69f631210ca08e25';
export const ASSETS = ['assets/phase2-experience.js', 'index.html', 'service-worker.js'];
export const MARKER = '.well-known/duediligence-release.txt';
export const LIVE_ORIGIN = 'https://duediligence.ph';
export const PREVIEW_ORIGIN = 'https://duediligence-professor-entry-preview.wallyesteban1993.workers.dev';
export const DASHBOARD = 'https://duediligence-constitutional-exam.wallyesteban1993.workers.dev/admin/exams';
export const VERSION = 'professor-desk-20261024-1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = 'release/professor-entry-20261024.json';
const SOURCE_FILES = [
  ...ASSETS,
  MANIFEST_PATH,
  '.github/workflows/publish-professor-entry.yml',
  '.github/workflows/validate-mandatory-early-access.yml',
  'scripts/professor-entry-release.mjs',
  'scripts/test-professor-entry-release.mjs',
  'scripts/test-onboarding-flow.mjs',
  'scripts/test-examination-room-door-menu.mjs',
  'docs/professor-entry-release-20261024.md',
];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const blob = (cwd, sha, file) => execFileSync('git', ['show', `${sha}:${file}`], { cwd, maxBuffer: 32 * 1024 * 1024 });
const validSha = value => assert.match(value, /^[a-f0-9]{40}$/u);
const unique = (source, needle) => {
  assert.equal(source.split(needle).length, 2, `Expected one exact entry anchor: ${needle}`);
  return source.indexOf(needle);
};
const SPANS = [
  ['  function examinationRoomContent()', '  function partnershipContent()'],
  ['  function professorDoorDestination(', '  function resetProfessorDoor('],
  ['  async function checkProfessorDoor(', '  async function recordCurrentTermsAcceptance('],
];
export function entrySpans(source) {
  source = source.replaceAll('\r\n', '\n');
  return SPANS.map(([start, end]) => {
    const first = unique(source, start), last = unique(source, end);
    assert.ok(last > first);
    return source.slice(first, last);
  });
}

// Copy only the approved CURRENT entry spans into the pinned live module.
// Unrelated main-source fixes, loaders, auth and retired runtime stay untouched.
export function deriveCandidate(base, reviewedPhase2) {
  const spans = entrySpans(reviewedPhase2);
  let phase2 = base[ASSETS[0]].toString('utf8');
  SPANS.forEach(([start, end], index) => {
    const first = unique(phase2, start), last = unique(phase2, end);
    phase2 = phase2.slice(0, first) + spans[index] + phase2.slice(last);
  });
  assert.ok(spans[1].includes(`return '${DASHBOARD}';`));
  assert.doesNotMatch(spans.join(''), /access_token|state\.session|showEntry\(|\/examination-room\/student\.html/u);
  const appendReference = (bytes, escaped) => {
    const text = bytes.toString('utf8');
    const matches = [...text.matchAll(/(?:src="|')((?:\/)?assets\/phase2-experience\.js\?[^"'\r\n]+)(?:"|')/gu)];
    assert.equal(matches.length, 1, 'Exactly one phase2 document/shell reference is required');
    const previous = matches[0][1];
    assert.ok(!previous.includes('examination='));
    return Buffer.from(text.replace(previous, `${previous}${escaped ? '&amp;' : '&'}examination=${VERSION}`));
  };
  let sw = appendReference(base['service-worker.js'], false).toString('utf8');
  const cache = sw.match(/^const CACHE_VERSION = '([^']+)';/u);
  assert.ok(cache);
  sw = sw.replace(cache[0], `const CACHE_VERSION = '${cache[1]}-${VERSION}';`);
  return {
    [ASSETS[0]]: Buffer.from(phase2),
    'index.html': appendReference(base['index.html'], true),
    'service-worker.js': Buffer.from(sw),
  };
}

export async function manifest(reviewed = ROOT) {
  const value = JSON.parse(await readFile(path.join(reviewed, MANIFEST_PATH), 'utf8'));
  assert.equal(value.base_sha, BASE_SHA);
  assert.equal(value.dashboard, DASHBOARD);
  assert.equal(value.version, VERSION);
  assert.deepEqual(Object.keys(value.assets).sort(), [...ASSETS].sort());
  return value;
}

export async function prepare(reviewed, baseline, runtime, sourceSha) {
  validSha(sourceSha);
  assert.equal(git(reviewed, 'rev-parse', 'HEAD'), sourceSha);
  assert.equal(git(reviewed, 'status', '--porcelain', '--untracked-files=all'), '', 'Reviewed checkout must be clean');
  for (const directory of [baseline, runtime]) {
    assert.equal(git(directory, 'rev-parse', 'HEAD'), BASE_SHA);
    assert.equal(git(directory, 'status', '--porcelain', '--untracked-files=all'), '', 'Pinned checkout must be clean');
  }
  assert.equal(new Set([reviewed, baseline, runtime].map(directory => path.resolve(directory))).size, 3);
  const approved = await manifest(reviewed);
  const base = Object.fromEntries(ASSETS.map(file => [file, blob(baseline, BASE_SHA, file)]));
  const reviewedPhase2 = blob(reviewed, sourceSha, ASSETS[0]).toString('utf8');
  assert.deepEqual(entrySpans(reviewedPhase2).map(sha256), approved.reviewed_entry_sha256);
  const candidate = deriveCandidate(base, reviewedPhase2);
  for (const file of ASSETS) {
    assert.equal(sha256(base[file]), approved.assets[file].baseline_sha256, `Pinned baseline differs: ${file}`);
    assert.equal(sha256(candidate[file]), approved.assets[file].candidate_sha256, `Unreviewed entry bytes: ${file}`);
    await writeFile(path.join(runtime, file), candidate[file]);
  }
  assert.deepEqual(git(runtime, 'diff', '--name-only').split('\n').sort(), [...ASSETS].sort());
  console.log(`Prepared only ${ASSETS.length} entry assets from pinned live ${BASE_SHA}; release source ${sourceSha}.`);
}

export async function files(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Artifact symlinks are forbidden');
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(entry.isDirectory() || entry.isFile());
    return entry.isDirectory() ? files(root, name) : [name];
  }))).flat().sort();
}

export async function verifyArtifacts(baselineDir, candidateDir, sourceSha, approved) {
  validSha(sourceSha);
  const names = await files(baselineDir);
  assert.ok(names.length > 100, 'The complete existing Pages artifact is required');
  assert.deepEqual(await files(candidateDir), names, 'No published file may be added or removed');
  const baseline = {}, candidate = {}, changed = [];
  for (const name of names) {
    const oldBytes = await readFile(path.join(baselineDir, name));
    const newBytes = await readFile(path.join(candidateDir, name));
    baseline[name] = sha256(oldBytes); candidate[name] = sha256(newBytes);
    if (baseline[name] !== candidate[name]) changed.push(name);
  }
  assert.deepEqual(changed.sort(), [...ASSETS, MARKER].sort(), 'Only three entry assets and the release marker may change');
  for (const file of ASSETS) {
    assert.equal(baseline[file], approved.assets[file].baseline_sha256, `Baseline asset differs: ${file}`);
    assert.equal(candidate[file], approved.assets[file].candidate_sha256, `Candidate asset differs: ${file}`);
  }
  assert.equal((await readFile(path.join(baselineDir, MARKER), 'utf8')).trim(), BASE_SHA);
  assert.equal((await readFile(path.join(candidateDir, MARKER), 'utf8')).trim(), sourceSha);
  assert.ok(!names.some(name => name.startsWith('exam-pilot/') || name.startsWith('document-vendor/')));
  return { base_sha: BASE_SHA, source_sha: sourceSha, baseline, candidate, changed };
}

export async function verifyPublic(origin, hashes, sourceSha, fetcher = fetch) {
  assert.ok([LIVE_ORIGIN, PREVIEW_ORIGIN].includes(origin), 'Only the approved live and isolated preview origins may be contacted');
  validSha(sourceSha);
  const names = Object.keys(hashes).filter(name => name !== '.nojekyll');
  let cursor = 0;
  const errors = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < names.length) {
      const name = names[cursor++];
      const publicPath = name === 'index.html' && origin === LIVE_ORIGIN ? '' : name;
      try {
        const response = await fetcher(`${origin}/${publicPath}?professor-entry=${sourceSha}`, {
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
        });
        assert.equal(response.status, 200, `${name}: HTTP status`);
        assert.equal(sha256(Buffer.from(await response.arrayBuffer())), hashes[name], `${name}: public bytes differ`);
      } catch (error) { errors.push(error.message); }
    }
  }));
  assert.deepEqual(errors, [], `Every public artifact byte at ${origin} must match the verified artifact`);
  console.log(`Verified ${names.length} exact public files at ${origin}.`);
}

export async function verifyDashboard(fetcher = fetch) {
  const response = await fetcher(DASHBOARD, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 303, 'The destination must be live and require private professor sign-in');
  assert.equal(new URL(response.headers.get('location'), DASHBOARD).href, new URL('/admin/login', DASHBOARD).href);
  const login = await fetcher(new URL('/admin/login', DASHBOARD), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  assert.equal(login.status, 200);
  assert.match(await login.text(), /autocomplete="current-password"/u);
  const session = await fetcher(new URL('/api/admin/session', DASHBOARD), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  assert.equal(session.status, 401, 'An anonymous visitor must not receive a professor session');
}

export async function verifyProvenance(env = process.env, api = route => JSON.parse(execFileSync('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/${route}`], { encoding: 'utf8' }))) {
  assert.equal(env.GITHUB_REPOSITORY, 'codingwally/Bar-Exam-simulator');
  assert.equal(env.GITHUB_ACTOR, 'codingwally');
  assert.equal(env.GITHUB_TRIGGERING_ACTOR, 'codingwally');
  validSha(env.EXPECTED_SOURCE_SHA);
  assert.equal(env.EXPECTED_SOURCE_SHA, env.GITHUB_SHA);
  assert.ok(['preview', 'publish'].includes(env.RELEASE_OPERATION));
  assert.match(env.VALIDATION_RUN_ID, /^[1-9][0-9]{0,19}$/u);
  const run = api(`actions/runs/${env.VALIDATION_RUN_ID}`);
  assert.equal(run.event, 'pull_request');
  assert.equal(run.path, '.github/workflows/validate-mandatory-early-access.yml');
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  validSha(run.head_sha);
  let number = run.pull_requests?.[0]?.number;
  if (!number) {
    const candidates = api(`commits/${run.head_sha}/pulls`).filter(pr => pr.base.ref === 'main' && pr.head.sha === run.head_sha && pr.head.repo.full_name === env.GITHUB_REPOSITORY);
    assert.equal(candidates.length, 1); number = candidates[0].number;
  }
  assert.ok(Number.isSafeInteger(number) && number > 0);
  const pr = api(`pulls/${number}`);
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.base.repo.full_name, env.GITHUB_REPOSITORY);
  assert.equal(pr.head.repo.full_name, env.GITHUB_REPOSITORY);
  assert.equal(pr.head.sha, run.head_sha);
  const changed = api(`pulls/${number}/files?per_page=100`);
  assert.ok(changed.length > 0 && changed.length < 100);
  assert.ok(changed.every(file => SOURCE_FILES.includes(file.filename) && !file.previous_filename), 'PR includes a file outside the reviewed entry release boundary');
  const commit = sha => api(`git/commits/${sha}`);
  assert.equal(commit(run.head_sha).tree.sha, commit(env.GITHUB_SHA).tree.sha, 'Mandatory validation must cover the exact candidate tree');
  if (env.RELEASE_OPERATION === 'publish' || env.GITHUB_REF === 'refs/heads/main') {
    if (env.RELEASE_OPERATION === 'publish') assert.equal(env.CONFIRM_PRODUCTION, 'true');
    assert.equal(env.GITHUB_REF, 'refs/heads/main');
    assert.equal(pr.merged, true);
    assert.equal(api('git/ref/heads/main').object.sha, env.GITHUB_SHA);
  } else {
    assert.equal(env.GITHUB_REF, `refs/heads/${pr.head.ref}`);
    assert.equal(env.GITHUB_SHA, pr.head.sha);
    assert.equal(pr.state, 'open');
  }
  console.log(`Exact-source mandatory PR validation verified for #${number} (${env.RELEASE_OPERATION}).`);
}

export function previewConfig(artifactDir, accountId) {
  assert.match(accountId, /^[a-f0-9]{32}$/u);
  return {
    name: 'duediligence-professor-entry-preview', account_id: accountId,
    compatibility_date: '2026-10-24', workers_dev: true,
    assets: { directory: path.resolve(artifactDir), html_handling: 'none', not_found_handling: 'none' },
  };
}

export async function verifyPreviewAccount(accountId, token, fetcher = fetch) {
  assert.match(accountId, /^[a-f0-9]{32}$/u);
  assert.ok(typeof token === 'string' && token.trim().length > 0, 'The existing account token is required');
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
  assert.equal(response.status, 200, 'Could not verify the existing preview account');
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.result?.subdomain, 'wallyesteban1993', 'Refusing to deploy the preview to another account');
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === 'prepare') await prepare(...args);
  else if (operation === 'provenance') await verifyProvenance();
  else if (operation === 'preview-config') {
    const [artifactDir, output] = args;
    await verifyPreviewAccount(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(previewConfig(artifactDir, process.env.CLOUDFLARE_ACCOUNT_ID), null, 2)}\n`);
  } else if (['before', 'staged', 'after', 'local'].includes(operation)) {
    const [baselineDir, candidateDir, sourceSha, evidenceDir] = args;
    const result = await verifyArtifacts(baselineDir, candidateDir, sourceSha, await manifest());
    if (operation === 'before' || operation === 'staged') await verifyPublic(LIVE_ORIGIN, result.baseline, sourceSha);
    if (operation === 'staged') { await verifyPublic(PREVIEW_ORIGIN, result.candidate, sourceSha); await verifyDashboard(); }
    if (operation === 'after') await verifyPublic(LIVE_ORIGIN, result.candidate, sourceSha);
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(path.join(evidenceDir, `${operation}.json`), `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(`Verified complete artifact; only ${ASSETS.length} reviewed entry files and marker change.`);
  } else throw new Error('Expected prepare, provenance, preview-config, local, before, staged or after.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
