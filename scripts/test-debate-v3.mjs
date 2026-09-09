/** Serial, local-only verification to fit the owner's8GB workstation. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITICAL_SOURCES } from './debate-staging-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/debate-local-rehearsal', 'suite-' + new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const node = process.execPath;
async function run(executable, args) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd: root, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.once('error', error => resolve({ exitCode: -1, stdout, stderr: stderr + error.message }));
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}
const head = await run('git', ['rev-parse', 'HEAD']);
const status = await run('git', ['status', '--short']);
const sourceFiles = [];
for (const directory of ['assets', 'debate-room', 'worker', 'scripts', 'supabase/migrations']) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = entry.name;
    if (file.includes('debate') || directory === 'debate-room' || /study-room/.test(file) && !file.includes('staging-positive-smoke')) sourceFiles.push(directory + '/' + file);
  }
}
sourceFiles.push(...CRITICAL_SOURCES, 'worker/index.mjs', 'worker/wrangler.toml', 'index.html', 'study-room/index.html', 'scripts/build-pages-artifact.mjs', 'scripts/test-worker-cpu-limit-contract.mjs');
const sourceHashes = {};
for (const file of [...new Set(sourceFiles)].sort()) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const workerTests = (await readdir(path.join(root, 'worker'))).filter(file => /^(debate-.*|study-room(?:-.*)?)\.test\.mjs$/.test(file)).map(file => 'worker/' + file);
const groups = [
  ['server-domain-database', ['--test', '--test-concurrency=1', ...workerTests]],
  ['client-state-media-dates', ['--test', 'scripts/test-debate-client-state.mjs', 'scripts/test-debate-desktop-layout.mjs', 'scripts/test-debate-media.mjs', 'scripts/test-debate-dates.mjs', 'scripts/test-debate-entry.mjs']],
  ['study-admission-sql', ['scripts/test-study-room-admission-sql.mjs']],
  ...['always-open', 'backgrounds', 'background-picker', 'hotfix-behavior', 'live'].map(name => ['study-' + name, ['scripts/test-study-room-' + name + '.mjs']]),
  ['local-http-boundaries', ['--test', 'scripts/test-debate-rehearsal-server.mjs']],
  ['accelerated-organizer', ['scripts/test-debate-organizer-rehearsal.mjs']],
  ['eligible-tournament-exports', ['scripts/test-debate-tournament-export.mjs']],
  ['staging-preflight-gates', ['--test', 'scripts/test-debate-staging-release.mjs', 'scripts/test-debate-staging-fixtures.mjs', 'scripts/test-debate-staging-dml-probe.mjs',
    'scripts/test-debate-hosted-cleanup.mjs', 'scripts/test-debate-hosted-fixtures.mjs', 'scripts/test-debate-hosted-driver.mjs', 'scripts/test-debate-hosted-upload-diagnostic.mjs',
    'scripts/test-debate-hosted-browser-safety.mjs', 'scripts/test-debate-hosted-preparation.mjs', 'scripts/test-debate-production-preview.mjs']],
  ['worker-configuration-contract', ['--test', 'scripts/test-worker-cpu-limit-contract.mjs']],
];
const report = { startedAt: new Date().toISOString(), environment: 'Local Node / disposable PGlite / inert media; no provider or real mail', head: head.stdout.trim(), gitStatus: status.stdout.trim(), sourceHashes, groups: [], limitations: ['Not a physical camera/audio test', 'Not a90-minute endurance run', 'Not native multi-connection PostgreSQL load', 'No hosted migration, approved capacity ramp, real mail delivery or deployment proof'] };
for (const [name, args] of groups) {
  console.log('Running ' + name);
  const startedAt = new Date().toISOString();
  const result = await run(node, args);
  const log = name + '.txt';
  await writeFile(path.join(output, log), result.stdout + result.stderr);
  report.groups.push({ name, command: ['node', ...args], startedAt, finishedAt: new Date().toISOString(), status: result.exitCode === 0 ? 'PASS' : 'FAIL', exitCode: result.exitCode, log });
  console.log(name + ': ' + (result.exitCode === 0 ? 'PASS' : 'FAIL'));
}
report.finishedAt = new Date().toISOString();
report.status = report.groups.every(group => group.status === 'PASS') ? 'PASS_LOCAL_SUITE' : 'FAIL';
report.changedDuringRun = [];
for (const [file, before] of Object.entries(sourceHashes)) {
  const after = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
  if (before !== after) report.changedDuringRun.push(file);
}
if (report.changedDuringRun.length) report.status = 'SOURCE_CHANGED_DURING_RUN';
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, report: path.join(output, 'report.json') }));
if (report.status !== 'PASS_LOCAL_SUITE') process.exitCode = 1;
