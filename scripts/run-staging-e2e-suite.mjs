import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStagingFailureDiagnostic } from './staging-e2e-diagnostics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'artifacts', 'staging-e2e');
const expected = Object.freeze({
  projectRef: 'hlzqmreeoghbldnhlybr',
  supabaseUrl: 'https://hlzqmreeoghbldnhlybr.supabase.co',
  workerUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
  productionProjectRef: 'hbllomlijfznnuudpdvr',
  productionWorkerHost: 'duediligence-gemini-examiner.wallyesteban1993.workers.dev',
});
const suites = Object.freeze({
  'complete-beta': 'scripts/test-complete-beta-staging.mjs',
  'duediligence-2026': 'scripts/test-duediligence-2026-staging.mjs',
  examinations: 'scripts/test-examinations-staging.mjs',
});

function stop(message) {
  console.error(`STAGING GATE STOP: ${message}`);
  process.exitCode = 1;
}

function extractQuoted(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} is missing from the approved staging configuration.`);
  return match[1];
}

async function loadStagingConfiguration() {
  const wrangler = await readFile(path.join(root, 'worker', 'wrangler.staging.toml'), 'utf8');
  const workerName = extractQuoted(wrangler, /^name\s*=\s*"([^"]+)"/m, 'Worker name');
  const configuredSupabaseUrl = extractQuoted(
    wrangler,
    /^SUPABASE_URL\s*=\s*"([^"]+)"/m,
    'Supabase URL',
  );
  const configuredOrigin = extractQuoted(
    wrangler,
    /^ALLOWED_ORIGIN\s*=\s*"([^"]+)"/m,
    'Allowed origin',
  );

  assert.equal(workerName, 'duediligence-examinations-staging');
  assert.equal(configuredSupabaseUrl, expected.supabaseUrl);
  assert.equal(configuredOrigin, expected.workerUrl);

  const response = await fetch(`${expected.workerUrl}/assets/phase2-config.js`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/javascript' },
  });
  assert.equal(response.status, 200, 'The deployed staging configuration is unavailable.');
  const publicConfiguration = await response.text();
  const deployedSupabaseUrl = extractQuoted(
    publicConfiguration,
    /\burl:\s*'([^']+)'/,
    'Deployed Supabase URL',
  );
  const publishableKey = extractQuoted(
    publicConfiguration,
    /\bpublishableKey:\s*'([^']+)'/,
    'Deployed publishable key',
  );
  const deployedWorkerUrl = extractQuoted(
    publicConfiguration,
    /\bworkerUrl:\s*'([^']+)'/,
    'Deployed Worker URL',
  );

  assert.equal(deployedSupabaseUrl, expected.supabaseUrl);
  assert.equal(deployedWorkerUrl, expected.workerUrl);
  assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);

  const joined = `${configuredSupabaseUrl}\n${configuredOrigin}\n${deployedSupabaseUrl}\n${deployedWorkerUrl}`;
  assert.equal(joined.includes(expected.productionProjectRef), false);
  assert.equal(joined.includes(expected.productionWorkerHost), false);
  assert.equal(new URL(deployedSupabaseUrl).hostname.startsWith(`${expected.projectRef}.`), true);
  assert.equal(new URL(deployedWorkerUrl).hostname.includes('-staging.'), true);

  return Object.freeze({
    supabaseUrl: deployedSupabaseUrl,
    publishableKey,
    workerUrl: deployedWorkerUrl,
    origin: configuredOrigin,
  });
}

function runChild(script, environment) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, script)], {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error) => resolve({ code: 1, output: String(error?.name || 'spawn_error') }));
    child.on('close', (code) => resolve({
      code: Number.isInteger(code) ? code : 1,
      output: Buffer.concat(chunks).toString('utf8'),
    }));
  });
}

function safeRunIds(output) {
  const values = new Set();
  for (const match of output.matchAll(/"runId"\s*:\s*"([a-z0-9-]{8,80})"/gi)) {
    values.add(match[1]);
  }
  for (const match of output.matchAll(/synthetic_cleanup=true\s+run_id=([a-z0-9-]{8,80})/gi)) {
    values.add(match[1]);
  }
  return [...values].sort();
}

function lastSafeCheckpoint(output) {
  const checkpoints = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(STAGING_GATE|DD2026_STAGING|EXAMINATIONS_STAGING): [A-Za-z0-9 ,.'()/-]+$/.test(line));
  return checkpoints.at(-1) || null;
}

async function writeEvidence(suite, result, serviceRoleKey) {
  const secretEchoed = Boolean(serviceRoleKey) && result.output.includes(serviceRoleKey);
  const cleanupComplete = /synthetic_cleanup=true/.test(result.output);
  const passed = result.code === 0 && cleanupComplete && !secretEchoed;
  const evidence = {
    schemaVersion: 2,
    suite,
    status: passed ? 'PASS' : 'FAIL',
    projectRef: expected.projectRef,
    target: 'staging-only',
    commit: String(process.env.GITHUB_SHA || '').slice(0, 40) || null,
    workflowRunId: String(process.env.GITHUB_RUN_ID || '') || null,
    syntheticRunIds: safeRunIds(result.output),
    cleanup: cleanupComplete ? 'completed' : 'not-confirmed',
    lastSafeCheckpoint: lastSafeCheckpoint(result.output),
    outputDigest: createHash('sha256').update(result.output).digest('hex'),
    secretEchoDetected: secretEchoed,
    failure: passed ? null : buildStagingFailureDiagnostic(result.output, result.code, serviceRoleKey),
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, `${suite}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  console.log(`${suite}: ${evidence.status}`);
  if (!passed) process.exitCode = 1;
}

async function readEvidence() {
  const results = [];
  for (const suite of Object.keys(suites)) {
    try {
      const value = JSON.parse(await readFile(path.join(evidenceDir, `${suite}.json`), 'utf8'));
      results.push(value);
    } catch {
      results.push({ suite, status: 'FAIL', cleanup: 'not-confirmed' });
    }
  }
  return results;
}

async function main() {
  const argument = process.argv[2] || '';
  if (argument === '--preflight') {
    await loadStagingConfiguration();
    console.log('Staging-only endpoint contract: PASS');
    return;
  }
  if (argument === '--summary') {
    const results = await readEvidence();
    console.log('## Protected staging E2E gate');
    console.log('');
    console.log('| Suite | Result | Synthetic cleanup |');
    console.log('|---|---:|---:|');
    for (const result of results) {
      console.log(`| ${result.suite} | ${result.status} | ${result.cleanup} |`);
    }
    return;
  }
  if (argument === '--enforce') {
    const results = await readEvidence();
    const failures = results.filter(
      (result) => result.status !== 'PASS' || result.cleanup !== 'completed',
    );
    if (failures.length) {
      stop('one or more protected staging suites failed or did not confirm exact cleanup.');
    } else {
      console.log('All three protected staging suites: PASS');
    }
    return;
  }

  assert.ok(Object.hasOwn(suites, argument), 'Unknown staging suite.');
  const serviceRoleKey = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '');
  assert.ok(serviceRoleKey, 'The protected staging credential is unavailable.');
  assert.equal(
    serviceRoleKey.startsWith('sb_secret_'),
    false,
    'The legacy test transport must be modernized before an sb_secret key is used.',
  );
  assert.equal(serviceRoleKey.split('.').length, 3, 'The protected legacy credential is malformed.');

  const configuration = await loadStagingConfiguration();
  const result = await runChild(suites[argument], {
    ...process.env,
    STAGING_SUPABASE_URL: configuration.supabaseUrl,
    STAGING_SUPABASE_PUBLISHABLE_KEY: configuration.publishableKey,
    STAGING_EXAMINATION_WORKER_URL: configuration.workerUrl,
    STAGING_EXAMINATION_ORIGIN: configuration.origin,
    STAGING_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NO_COLOR: '1',
  });
  await writeEvidence(argument, result, serviceRoleKey);
}

main().catch(async (error) => {
  const suite = process.argv[2] || '';
  if (Object.hasOwn(suites, suite)) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, `${suite}.json`),
      `${JSON.stringify({
        schemaVersion: 2,
        suite,
        status: 'FAIL',
        projectRef: expected.projectRef,
        target: 'staging-only',
        commit: String(process.env.GITHUB_SHA || '').slice(0, 40) || null,
        workflowRunId: String(process.env.GITHUB_RUN_ID || '') || null,
        syntheticRunIds: [],
        cleanup: 'not-confirmed',
        lastSafeCheckpoint: null,
        outputDigest: createHash('sha256').update(String(error?.name || 'gate_error')).digest('hex'),
        secretEchoDetected: false,
        failure: buildStagingFailureDiagnostic(
          `${error?.name || 'Error'}: ${error?.message || 'the staging gate could not complete safely.'}\n${error?.stack || ''}`,
          1,
          String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || ''),
        ),
      }, null, 2)}\n`,
      'utf8',
    );
  }
  stop(error instanceof assert.AssertionError ? error.message : 'the staging gate could not complete safely.');
});
