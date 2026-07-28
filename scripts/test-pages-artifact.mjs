import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: root,
  stdio: 'pipe',
});

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

const output = path.join(root, '.pages-dist');
const files = await walk(output);
for (const required of [
  'index.html',
  'CNAME',
  'favicon.svg',
  'admin/index.html',
  'assets/payments/gcash.png',
  'assets/payments/maribank.png',
]) {
  assert.ok(files.includes(required), `${required} must ship in the Pages artifact`);
}

assert.ok(files.includes('.nojekyll'));
assert.ok(files.every((file) => !/content|worker|supabase|scripts|docs/i.test(file)));
assert.ok(files.every((file) => !/\.(json|sql|mjs|csv)$/i.test(file)));

const index = await readFile(path.join(output, 'index.html'), 'utf8');
assert.doesNotMatch(index, /content\/question-bank|website-upload\.json|DueDiligenceWebsiteQuestionBank/i);
assert.doesNotMatch(index, /const BAR_QUESTIONS\s*=\s*\{/);
assert.match(index, /loadProtectedQuestion/);
assert.match(index, /Authentication is required before an examination question is displayed/);

console.log('Sanitized GitHub Pages artifact tests passed.');
