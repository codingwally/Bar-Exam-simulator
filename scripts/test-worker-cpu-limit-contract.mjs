import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Deliberately narrow release-policy validator, not a replacement TOML parser.
// Wrangler's pinned deployment validates the complete configuration. This check
// fails closed if the reviewed top-level limits shape changes or disappears.
export function declaredApplicationCpuBudget(source) {
  assert.equal(typeof source, 'string');
  const lines = source.split(/\r?\n/u).map(line => line.replace(/#.*$/u, '').trim());
  const headers = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith('['));
  const limitHeaders = headers.filter(({ line }) => /\blimits\b/u.test(line));
  assert.equal(limitHeaders.length, 1, 'Exactly one explicit top-level limits table is required.');
  assert.equal(limitHeaders[0].line, '[limits]', 'Do not hide or override the application budget in an environment table.');
  const start = limitHeaders[0].index;
  const end = headers.find(({ index }) => index > start)?.index ?? lines.length;
  const entries = lines.slice(start + 1, end).filter(Boolean);
  assert.equal(entries.length, 1, 'Only the reviewed CPU limit may be configured; preserve other platform limits.');
  assert.match(entries[0], /^cpu_ms\s*=\s*(?:0|[1-9](?:_?\d)*)$/u, 'CPU budget must be an explicit integer number, not a string or expression.');
  const value = Number(entries[0].split('=')[1].trim().replaceAll('_', ''));
  assert.ok(Number.isSafeInteger(value));
  assert.equal(value, 30000, 'Saved Forecast reports require the reviewed bounded 30000ms CPU budget.');
  return value;
}

const [staging, production, alias, mandatory, release] = await Promise.all([
  '../worker/wrangler.staging.toml', '../worker/wrangler.toml', '../worker/wrangler.public-api.toml',
  '../.github/workflows/validate-mandatory-early-access.yml', '../.github/workflows/release-unlimited-feature-access.yml',
].map(file => readFile(new URL(file, import.meta.url), 'utf8')));

test('both actual application configs declare the same bounded CPU budget', () => {
  assert.equal(declaredApplicationCpuBudget(staging), 30000);
  assert.equal(declaredApplicationCpuBudget(production), 30000);
});

test('missing, stale, malformed, duplicate and broadened budgets fail closed', () => {
  for (const source of [
    '', '# [limits]\n# cpu_ms = 30000', '[vars]\ncpu_ms = 30000',
    '[limits]\ncpu_ms = 2000', '[limits]\ncpu_ms = 0', '[limits]\ncpu_ms = -1',
    '[limits]\ncpu_ms = NaN', '[limits]\ncpu_ms = Infinity', '[limits]\ncpu_ms = "30000"',
    '[limits]\ncpu_ms = 300000', '[limits]\ncpu_ms = 30000.0', '[limits]\ncpu_ms = 3e4',
    '[limits]\ncpu_ms = 30000\ncpu_ms = 30000', '[limits]\ncpu_ms = 30000\nsubrequests = 1000000',
    '[limits]\ncpu_ms = 30000\n[env.production.limits]\ncpu_ms = 2000',
    '[limits]\ncpu_ms = 30000\n[limits]\ncpu_ms = 30000',
    '["limits"]\ncpu_ms = 30000', '[limits]\ncpu_ms = 3__0000',
  ]) assert.throws(() => declaredApplicationCpuBudget(source));
  assert.equal(declaredApplicationCpuBudget('[limits] # reviewed\ncpu_ms = 30_000 # milliseconds\n[vars]\nEXAMPLE = "value"'), 30000);
});

test('CPU configuration does not change grading, authorization, cron, or automatic mail controls', () => {
  for (const config of [staging, production]) {
    for (const line of [
      'compatibility_date = "2026-07-26"', 'compatibility_flags = ["nodejs_compat"]',
      'GEMINI_MODEL = "gemini-3.5-flash-lite"', 'GEMINI_GROUNDING_ENABLED = "false"',
      'ALLOW_LEGACY_GUESTS = "false"', 'PHASE4_ACCESS_ENFORCEMENT = "true"',
      'PHASE4_MODEL_QUALITY_ENFORCEMENT = "true"', 'REQUIRE_AUTHENTICATED_SUBMISSIONS = "true"',
      'OUTBOUND_EMAIL_MODE = "suppressed"', 'crons = ["*/2 * * * *"]',
    ]) assert.ok(config.split(/\r?\n/u).includes(line), `Existing control must remain: ${line}`);
  }
  assert.match(staging, /^FORECAST_RESULTS_EMAIL_MODE = "suppressed"$/mu);
  assert.match(production, /^FORECAST_RESULTS_EMAIL_MODE = "enabled"$/mu);
  assert.doesNotMatch(alias, /^\s*\[limits\]|\bcpu_ms\s*=/mu, 'The forwarding alias is outside this CPU correction.');
  assert.match(alias, /^service = "duediligence-gemini-examiner"$/mu);
});

test('mandatory and protected release gates enforce the config contract before deployment', () => {
  const command = 'node scripts/test-worker-cpu-limit-contract.mjs';
  assert.ok(mandatory.includes("- 'scripts/test-worker-cpu-limit-contract.mjs'"));
  assert.ok(mandatory.includes(command));
  assert.ok(release.includes('            scripts/test-worker-cpu-limit-contract.mjs \\'));
  assert.ok(release.includes(command));
  assert.ok(release.indexOf(command) < release.indexOf('\n  deploy_staging:'));
  for (const file of ['worker/wrangler.staging.toml', 'worker/wrangler.toml']) {
    assert.ok(mandatory.includes(`- '${file}'`));
    assert.ok(release.includes(`            ${file} \\`));
  }
  assert.match(release, /wranglerVersion: "4\.114\.0"\s+command: deploy --config wrangler\.staging\.toml/u);
});
