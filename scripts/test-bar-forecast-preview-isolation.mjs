import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, '.pages-dist');
const syntheticQaPayload = /(?:SYNTHETIC-UI-(?:\d{1,3}|\$\{)|Synthetic interface-test question\s+(?:\d{1,3}|\$\{)|Mock Permit\s+(?:\d{1,3}|\$\{)|local-preview-token|Synthetic UI QA Harness|__DD_BAR_FORECAST_SYNTHETIC_QA__)/iu;
execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: root,
  env: { ...process.env, GITHUB_SHA: process.env.GITHUB_SHA || '0123456789abcdef0123456789abcdef01234567' },
  stdio: 'pipe',
});
await writeFile(
  path.join(artifactRoot, 'index.html'),
  '<!doctype html><title>Synthetic UI QA Harness</title><p>Synthetic interface-test question 1. Mock Permit 1.</p>',
  'utf8',
);

async function startPreview(script, envName, outputPattern) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, [envName]: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Preview server did not start. ${stderr}`)), 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(outputPattern);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[0]);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Preview server exited early with ${code}. ${stderr}`));
    });
  });
  return { child, url };
}

const product = await startPreview(
  'scripts/serve-bar-forecast-product-preview.mjs',
  'DD_PRODUCT_PREVIEW_PORT',
  /http:\/\/127\.0\.0\.1:\d+\//u,
);

try {
  const rootResponse = await fetch(product.url);
  assert.equal(rootResponse.status, 200);
  assert.equal(rootResponse.headers.get('x-duediligence-local-mode'), 'product-source-no-auth-proxy');
  const rootPage = await rootResponse.text();
  assert.match(rootPage, /<title>Due Diligence — Philippine Bar Exam Simulator<\/title>/u);
  assert.doesNotMatch(rootPage, /Synthetic UI QA Harness|local-preview-token|Mock Permit/u);

  const hashEquivalentResponse = await fetch(product.url);
  assert.equal(hashEquivalentResponse.status, 200, 'a URL fragment must still resolve to the product root');

  for (const denied of [
    'content/duediligence-2026/bar-forecast.json',
    'worker/bar-forecast-core.mjs',
    'scripts/build-pages-artifact.mjs',
    'docs/evidence/bar-forecast-examplify-audit-20260901/local-preview.html',
    '.git/config',
  ]) {
    const response = await fetch(new URL(denied, product.url));
    assert.equal(response.status, 404, `${denied} must not be served by the product preview`);
  }

  const forecastResponse = await fetch(new URL('assets/bar-forecast.js', product.url));
  assert.equal(forecastResponse.status, 200);
  const forecastSource = await forecastResponse.text();
  assert.doesNotMatch(
    forecastSource,
    syntheticQaPayload,
  );

  const linkPath = path.join(artifactRoot, 'qa-link');
  try {
    await symlink(
      path.join(root, 'docs', 'evidence', 'bar-forecast-examplify-audit-20260901'),
      linkPath,
      'junction',
    );
    const linkedFixture = await fetch(new URL('qa-link/local-preview.html', product.url));
    assert.equal(linkedFixture.status, 404, 'an in-artifact link cannot escape to the QA fixture');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
  } finally {
    await unlink(linkPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  await writeFile(
    path.join(artifactRoot, 'index.html'),
    '<!doctype html><title>Due Diligence — Philippine Bar Exam Simulator</title><p>Unexpected post-start mutation.</p>',
    'utf8',
  );
  const contaminatedRoot = await fetch(product.url);
  assert.equal(contaminatedRoot.status, 404, 'any post-start product artifact mutation must fail closed');

  const forecastFile = path.join(artifactRoot, 'assets', 'bar-forecast.js');
  const forecastRuntime = await readFile(forecastFile, 'utf8');
  await writeFile(
    forecastFile,
    forecastRuntime.replace('|| syntheticQaContent) {', '|| false) {'),
    'utf8',
  );
  const bypassedRuntime = await fetch(new URL('assets/bar-forecast.js', product.url));
  assert.equal(bypassedRuntime.status, 404, 'a post-start synthetic-QA runtime bypass must fail closed');
} finally {
  product.child.kill();
  execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
    cwd: root,
    env: { ...process.env, GITHUB_SHA: process.env.GITHUB_SHA || '0123456789abcdef0123456789abcdef01234567' },
    stdio: 'pipe',
  });
}

const qa = await startPreview(
  'scripts/serve-bar-forecast-synthetic-qa.mjs',
  'DD_SYNTHETIC_QA_PORT',
  /http:\/\/127\.0\.0\.1:\d+\/__qa__\/bar-forecast-synthetic\.html/u,
);

try {
  const qaUrl = new URL(qa.url);
  const qaOrigin = `${qaUrl.origin}/`;
  const rootResponse = await fetch(qaOrigin);
  assert.equal(rootResponse.status, 404, 'the synthetic QA server must fail closed at root');
  const hashEquivalentResponse = await fetch(qaOrigin);
  assert.equal(hashEquivalentResponse.status, 404, 'a normal-looking Forecast hash must not expose QA');

  const pageResponse = await fetch(qa.url);
  assert.equal(pageResponse.status, 200);
  assert.equal(pageResponse.headers.get('x-duediligence-local-mode'), 'synthetic-qa-explicit-path');
  assert.match(pageResponse.headers.get('x-robots-tag') || '', /noindex/u);
  const page = await pageResponse.text();
  assert.match(page, /Synthetic UI QA Harness — Not the 2026 Bar Forecast/u);
  assert.match(page, /Open synthetic UI test/u);
  assert.match(page, /Synthetic UI QA harness — not real Forecast questions or grading/u);
  assert.doesNotMatch(page, /window\.openBarForecast\?\.\(document\.getElementById\('open-forecast'\)\)/u);

  const qaRuntimeResponse = await fetch(new URL('/assets/bar-forecast.js', qa.url));
  assert.equal(qaRuntimeResponse.status, 200);
  const qaRuntime = await qaRuntimeResponse.text();
  assert.match(qaRuntime, /\|\| false\) \{/u, 'only the isolated QA server may disable the synthetic fixture guard');
  assert.doesNotMatch(qaRuntime, /isExplicitLoopbackQaHarness/u);

  const unknownResponse = await fetch(new URL('/anything-else', qa.url));
  assert.equal(unknownResponse.status, 404);
  const traversalResponse = await fetch(new URL('/..%2findex.html', qa.url));
  assert.equal(traversalResponse.status, 404);
} finally {
  qa.child.kill();
}

console.log('2026 Bar Forecast product and synthetic-QA preview isolation checks passed.');
