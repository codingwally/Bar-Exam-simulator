import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync(new URL('../assets/labor-practice-config.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../assets/labor-practice.js', import.meta.url), 'utf8');

assert.match(client, /useAvailabilityFallback\(/, 'Labor Law requires an availability fallback before release.');
assert.doesNotMatch(client, /BAR_QUESTIONS\[LABOR_SUBJECT\]\s*=\s*\[\]/, 'Labor Law must never clear its question bank before a replacement catalog is ready.');
assert.doesNotMatch(client, /closed-loop|secure catalog|practice is protected|retry secure catalog/i, 'Internal architecture terminology must not ship in the Labor Law interface.');

const endpoint = config.match(/endpoint:\s*'([^']+)'/)?.[1] || '';
const remoteEnabled = /remoteCatalogEnabled:\s*true/.test(config);
assert.ok(endpoint, 'The Labor Law endpoint must be declared when remote catalog refresh is enabled.');

if (remoteEnabled) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list_questions', filters: {} }),
  });
  assert.notEqual(response.status, 404, 'The remote Labor Law function is missing; do not publish a frontend that requires it.');
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok && Array.isArray(payload.questions) && payload.questions.length, 'The remote Labor Law catalog must return at least one published question before release.');
  console.log(`Labor release gate passed with ${payload.questions.length} remote question(s).`);
} else {
  console.log('Labor release gate passed with remote refresh disabled and the local availability path active.');
}
