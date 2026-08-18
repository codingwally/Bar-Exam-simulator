import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [phase2, phase4, admin] = await Promise.all([
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
]);

for (const source of [phase2, phase4, admin]) {
  assert.doesNotMatch(source, /lifetime(?: AI)? grades? remaining/i);
}
assert.match(phase2, /guest grades left/);
assert.doesNotMatch(phase2, /three lifetime AI grades/);
assert.doesNotMatch(phase4, /three lifetime free grades are exhausted/);
assert.match(phase4, /Early Access is required/);
assert.match(phase4, /Subscribe — ₱149 Early Access/);
assert.doesNotMatch(phase4, /five successful submissions for today/i);
assert.doesNotMatch(phase2, /Beta All Access/);
assert.doesNotMatch(phase4, /Beta All Access/);
assert.doesNotMatch(admin, /'Lifetime grades'/);

console.log('Lifetime-grade counters and automatic daily-free access are retired while mandatory Early Access copy remains intact.');
