import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The protected 2026-09-07 deployment returned Cloudflare100328: this account's
// Free plan rejects custom CPU limits. Fix report CPU consumption, not billing.
// This is a narrow policy guard, not a replacement for Wrangler's TOML parser.
export function assertExistingPlanCompatibleCpuConfig(source) {
  assert.equal(typeof source, 'string');
  const lines = source.split(/\r?\n/u).map(line => line.replace(/#.*$/u, '').trim());
  assert.ok(!lines.some(line => /\bcpu_ms\b/u.test(line)
    || (line.startsWith('[') && /\blimits\b/u.test(line))),
  'Custom CPU settings require a separately approved supported plan; do not block deployment on an unapproved upgrade.');
}

const [staging, production, alias, mandatory, release] = await Promise.all([
  '../worker/wrangler.staging.toml', '../worker/wrangler.toml', '../worker/wrangler.public-api.toml',
  '../.github/workflows/validate-mandatory-early-access.yml', '../.github/workflows/release-unlimited-feature-access.yml',
].map(file => readFile(new URL(file, import.meta.url), 'utf8')));

test('both actual application configs remain compatible with the existing plan', () => {
  assertExistingPlanCompatibleCpuConfig(staging);
  assertExistingPlanCompatibleCpuConfig(production);
});

test('explicit custom CPU settings cannot silently require a paid-plan upgrade', () => {
  for (const source of [
    '[vars]\ncpu_ms = 30000',
    '[limits]\ncpu_ms = 2000', '[limits]\ncpu_ms = 0', '[limits]\ncpu_ms = -1',
    '[limits]\ncpu_ms = NaN', '[limits]\ncpu_ms = Infinity', '[limits]\ncpu_ms = "30000"',
    '[limits]\ncpu_ms = 300000', '[limits]\ncpu_ms = 30000.0', '[limits]\ncpu_ms = 3e4',
    '[limits]\ncpu_ms = 30000\ncpu_ms = 30000', '[limits]\ncpu_ms = 30000\nsubrequests = 1000000',
    '[limits]\ncpu_ms = 30000\n[env.production.limits]\ncpu_ms = 2000',
    '[limits]\ncpu_ms = 30000\n[limits]\ncpu_ms = 30000',
    '["limits"]\ncpu_ms = 30000', '[limits]\ncpu_ms = 3__0000',
    '[limits] # custom\ncpu_ms = 30_000 # milliseconds',
    '[env.staging.limits]\ncpu_ms = 30000',
  ]) assert.throws(() => assertExistingPlanCompatibleCpuConfig(source));
  for (const source of ['', '# [limits]\n# cpu_ms = 30000', '[vars]\nEXAMPLE = "value"']) {
    assertExistingPlanCompatibleCpuConfig(source);
  }
});

test('CPU configuration does not change grading, authorization, cron, or automatic mail controls', () => {
  for (const [name, config, expectedCrons] of [
    ['staging', staging, ['*/2 * * * *']],
    ['production', production, ['*/2 * * * *', '* * * * *']],
  ]) {
    for (const line of [
      'compatibility_date = "2026-07-26"', 'compatibility_flags = ["nodejs_compat"]',
      'GEMINI_MODEL = "gemini-3.5-flash-lite"', 'GEMINI_GROUNDING_ENABLED = "false"',
      'ALLOW_LEGACY_GUESTS = "false"', 'PHASE4_ACCESS_ENFORCEMENT = "true"',
      'PHASE4_MODEL_QUALITY_ENFORCEMENT = "true"', 'REQUIRE_AUTHENTICATED_SUBMISSIONS = "true"',
      'OUTBOUND_EMAIL_MODE = "suppressed"',
    ]) assert.ok(config.split(/\r?\n/u).includes(line), `Existing control must remain: ${line}`);
    const cronLines = config.split(/\r?\n/u).filter(line => /^\s*crons\s*=/u.test(line));
    assert.equal(cronLines.length, 1, `${name} must declare its schedule exactly once`);
    const crons = JSON.parse(cronLines[0].replace(/^\s*crons\s*=\s*/u, ''));
    assert.deepEqual(crons, expectedCrons, `${name} must retain only its approved cron triggers`);
    assert.equal(crons.filter(cron => cron === '*/2 * * * *').length, 1,
      `${name} must preserve the original two-minute trigger exactly once`);
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
  assert.ok(release.includes('            worker/forecast-result-layout.test.mjs \\'));
  assert.ok(mandatory.includes("- 'worker/forecast-*.mjs'"));
  for (const workflow of [mandatory, release]) {
    assert.ok(workflow.includes('node --test --test-concurrency=1 worker/*.test.mjs'),
      'Existing full Worker gate must execute the actual PDF parity regression.');
  }
  for (const file of ['worker/wrangler.staging.toml', 'worker/wrangler.toml']) {
    assert.ok(mandatory.includes(`- '${file}'`));
    assert.ok(release.includes(`            ${file} \\`));
  }
  assert.match(release, /wranglerVersion: "4\.114\.0"\s+command: deploy --config wrangler\.staging\.toml/u);
});
