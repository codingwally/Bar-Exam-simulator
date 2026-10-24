import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const [baseline, runtime, reviewed, phase = 'before'] = process.argv.slice(2);
assert.ok(baseline && runtime && reviewed);
assert.ok(['before', 'after'].includes(phase));
const baseSha = '0a20a8c393931600d8ea54410255262d6cccd4c0';
const runtimeSha = '7715afb28e7f63165ca4d133f99b8f145327e916';
const allowed = ['assets/examinations.js', 'assets/feature-loader.js', 'index.html', 'service-worker.js'];
const marker = '.well-known/duediligence-release.txt';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const actualRuntimeSha = git(runtime, 'rev-parse', 'HEAD');
assert.equal(actualRuntimeSha, runtimeSha);
assert.equal(git(baseline, 'rev-parse', 'HEAD'), baseSha);
assert.equal(git(runtime, 'rev-parse', 'HEAD^'), baseSha);
assert.deepEqual(git(runtime, 'diff', '--name-only', baseSha, 'HEAD').split('\n').sort(), [...allowed].sort());
assert.equal(sha256(await readFile(path.join(runtime, 'assets/examinations.js'))),
  sha256(await readFile(path.join(reviewed, 'assets/examinations.js'))), 'Runtime renderer must equal reviewed renderer');

async function files(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink());
    return entry.isDirectory() ? files(root, name) : [name];
  }))).flat().sort();
}
const baseDir = path.join(baseline, '.pages-dist'), candidateDir = path.join(runtime, '.pages-dist');
const names = await files(baseDir);
assert.deepEqual(await files(candidateDir), names, 'No deployed file may be added or removed');
const hashes = new Map(), candidateHashes = new Map(), changed = [];
for (const name of names) {
  const oldHash = sha256(await readFile(path.join(baseDir, name)));
  const newHash = sha256(await readFile(path.join(candidateDir, name)));
  hashes.set(name, oldHash); candidateHashes.set(name, newHash);
  if (oldHash !== newHash) changed.push(name);
}
assert.deepEqual(changed.sort(), [...allowed, marker].sort(), 'Only the four reviewed runtime files and release marker may change');
for (const name of allowed) assert.equal(candidateHashes.get(name), sha256(await readFile(path.join(runtime, name))));
assert.equal((await readFile(path.join(baseDir, marker), 'utf8')).trim(), baseSha);
assert.equal((await readFile(path.join(candidateDir, marker), 'utf8')).trim(), actualRuntimeSha);

const expected = phase === 'after' ? candidateHashes : hashes;
let cursor = 0;
const errors = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < names.length) {
    const name = names[cursor++];
    // .nojekyll controls Pages processing and is not a user-facing resource.
    if (name === '.nojekyll') continue;
    try {
      const publicPath = name === 'index.html' ? '' : name;
      const response = await fetch(`https://duediligence.ph/${publicPath}?identity=${actualRuntimeSha}-${phase}`, {
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
      });
      assert.equal(response.status, 200, `${name}: HTTP status`);
      assert.equal(sha256(Buffer.from(await response.arrayBuffer())), expected.get(name), `${name}: public bytes differ`);
    } catch (error) { errors.push(error.message); }
  }
}));
assert.deepEqual(errors, [], `Public ${phase} artifact must match the exact verified source`);
console.log(`Verified ${names.length} artifact files; only ${allowed.length} runtime files and marker differ. Public ${phase} bytes match.`);
