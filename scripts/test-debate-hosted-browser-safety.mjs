import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCiExecution, hostedBrowserEnvironment, finalizeHostedBrowserShutdown } from './test-debate-browser-hosted-organizer.mjs';

test('hosted browser cannot launch on the desktop or without the dedicated CI opt-in', () => {
  for (const configuration of [
    { platform: 'win32', env: { GITHUB_ACTIONS: 'true', DEBATE_HOSTED_BROWSER_CI: '1' } },
    { platform: 'linux', env: { DEBATE_HOSTED_BROWSER_CI: '1' } },
    { platform: 'linux', env: { GITHUB_ACTIONS: 'true' } },
    { platform: 'linux', env: { GITHUB_ACTIONS: 'true', DEBATE_SYNTHETIC_BROWSER_CI: '1' } }
  ]) assert.throws(() => assertCiExecution(configuration));
  assert.doesNotThrow(() => assertCiExecution({ platform: 'linux', env: { GITHUB_ACTIONS: 'true', DEBATE_HOSTED_BROWSER_CI: '1' } }));
});

test('late session observation and browser errors change a provisional PASS to FAIL after shutdown', () => {
  for (const kind of ['pageErrors', 'unexpectedNetwork', 'consoleErrors']) {
    const report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [] };
    report[kind].push({ messageSha256: 'a'.repeat(64) }); finalizeHostedBrowserShutdown(report);
    assert.equal(report.status, 'FAIL'); assert.equal(report.shutdownObservationsVerified, false);
  }
  const report = { status: 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', pageErrors: [], unexpectedNetwork: [], consoleErrors: [{ expectedResourceRejection: true }] };
  finalizeHostedBrowserShutdown(report); assert.equal(report.status, 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
  assert.equal(report.shutdownObservationsVerified, true);
});
test('browser and read-only git subprocesses receive no account, cloud or Supabase secrets', () => {
  const env = { PATH: '/inert/bin', HOME: '/inert/home', TMPDIR: '/inert/tmp', LANG: 'C.UTF-8',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'secret-service', CLOUDFLARE_API_TOKEN: 'secret-cloud', GITHUB_TOKEN: 'secret-github',
    DEBATE_STAGING_ALLOWED_BEARER: 'secret-bearer', NODE_OPTIONS: '--require=untrusted', HTTPS_PROXY: 'https://untrusted.invalid' };
  assert.deepEqual(hostedBrowserEnvironment(env), { PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: env.LANG });
  assert.ok(!JSON.stringify(hostedBrowserEnvironment(env)).includes('secret'));
});
