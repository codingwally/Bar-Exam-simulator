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

// Internal access snapshots may retain compatibility fields such as
// `dailyLimit`, but the production interface must not advertise or render the
// retired automatic daily-free entitlement.
assert.doesNotMatch(
  phase4,
  /five successful submissions|free allowance resets|\b\d+\/\d+ left|daily free submissions?/i,
);
assert.match(phase4, /Choose Free Trial or ₱149 Early Access/);
assert.match(phase4, /Start Free Trial/);
assert.match(phase4, /Choose ₱149 Early Access/);

assert.doesNotMatch(phase2, /Beta All Access/);
assert.doesNotMatch(phase4, /Beta All Access/);
assert.doesNotMatch(admin, /'Lifetime grades'/);

console.log('Retired lifetime and daily-free copy is absent; the required Free Trial or ₱149 Early Access choice is present.');
