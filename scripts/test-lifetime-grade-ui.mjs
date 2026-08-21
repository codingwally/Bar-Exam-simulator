import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [phase2, phase4, admin] = await Promise.all([
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
]);

for (const source of [phase2, phase4, admin]) {
  assert.doesNotMatch(source, /five successful submissions each Philippine day/i);
  assert.doesNotMatch(source, /Allowance resets at Philippine midnight/i);
  assert.doesNotMatch(source, /Choose Free or ₱149 Early Access/i);
  assert.doesNotMatch(source, /dd2-choose-free|body:\s*\{ choice: 'free' \}/);
}

assert.match(phase2, /one lifetime allowance of five practice tokens/i);
assert.match(phase2, /used tokens do not reset/i);
assert.match(phase4, /five one-time practice tokens/i);
assert.match(phase4, /Failed grading and duplicate retries do not consume/i);
assert.match(phase4, /Final introductory token/i);
assert.doesNotMatch(phase2, /Beta All Access/);
assert.doesNotMatch(phase4, /Beta All Access/);
assert.doesNotMatch(admin, /'Lifetime grades'/);

console.log('One-time token copy is consistent and retired daily-reset copy is absent.');
