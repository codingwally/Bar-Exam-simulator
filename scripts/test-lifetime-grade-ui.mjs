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
assert.match(phase2, /five successful question submissions per Philippine calendar day/);
assert.match(phase4, /five successful submissions for today/);
assert.doesNotMatch(phase2, /Beta All Access/);
assert.doesNotMatch(phase4, /Beta All Access/);
assert.doesNotMatch(admin, /'Lifetime grades'/);

console.log('Lifetime-grade counters are retired while commercial daily-access copy remains intact.');
