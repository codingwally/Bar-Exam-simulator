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

assert.match(phase2, /config\.guest\?\.enabled !== true/);
assert.doesNotMatch(phase2, /three lifetime AI grades/);
assert.doesNotMatch(phase4, /three lifetime free grades are exhausted/);

assert.match(phase4, /five successful submissions each Philippine day/i);
assert.match(phase4, /Choose Free or ₱149 Early Access/);
assert.match(phase4, /body:\s*\{ choice: 'free' \}/);

assert.doesNotMatch(phase2, /Beta All Access/);
assert.doesNotMatch(phase4, /Beta All Access/);
assert.doesNotMatch(admin, /'Lifetime grades'/);

console.log('Retired lifetime copy is absent; permanent Free and ₱149 Early Access are present.');
