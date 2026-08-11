import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagingUrl =
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';
const stagingPublishableKey = String(
  process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '',
);
assert.match(
  stagingPublishableKey,
  /^sb_publishable_[A-Za-z0-9_-]{20,}$/,
  'The authorized staging publishable key must be supplied through the environment.',
);

execFileSync(process.execPath, ['scripts/build-staging-artifact.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    STAGING_PUBLIC_URL: stagingUrl,
    STAGING_WORKER_URL: stagingUrl,
    STAGING_SUPABASE_URL: 'https://hlzqmreeoghbldnhlybr.supabase.co',
    STAGING_SUPABASE_PUBLISHABLE_KEY: stagingPublishableKey,
  },
  stdio: 'pipe',
});

const output = path.join(root, '.staging-dist');
const rootFiles = await readdir(output);
assert.equal(rootFiles.includes('CNAME'), false);

const config = await readFile(path.join(output, 'assets/phase2-config.js'), 'utf8');
const index = await readFile(path.join(output, 'index.html'), 'utf8');
assert.match(config, /hlzqmreeoghbldnhlybr/);
assert.equal(config.includes(stagingPublishableKey), true);
assert.match(config, /duediligence-examinations-staging\.wallyesteban1993\.workers\.dev/);
assert.match(index, /duediligence-examinations-staging\.wallyesteban1993\.workers\.dev/);
assert.doesNotMatch(config, /hbllomlijfznnuudpdvr/);
assert.doesNotMatch(config, /duediligence-gemini-examiner\.wallyesteban1993\.workers\.dev/);
assert.doesNotMatch(index, /duediligence-gemini-examiner\.wallyesteban1993\.workers\.dev/);

for (const required of ['assets/examinations.css', 'assets/examinations.js']) {
  await assert.doesNotReject(() => readFile(path.join(output, required)));
}

console.log('Authorized staging artifact contract checks passed.');
