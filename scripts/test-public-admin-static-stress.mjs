import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { approvedTarget } from './stress-public-admin-static-1000.mjs';

const source = await readFile(new URL('./stress-public-admin-static-1000.mjs', import.meta.url), 'utf8');
const previewServer = await readFile(new URL('./serve-static.mjs', import.meta.url), 'utf8');
const pagesWorkflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

test('load harness is locked to local preview and the approved staging host', () => {
  assert.equal(approvedTarget('http://127.0.0.1:4173').origin, 'http://127.0.0.1:4173');
  assert.equal(approvedTarget('http://localhost:8080').origin, 'http://localhost:8080');
  assert.equal(
    approvedTarget('https://duediligence-examinations-staging.wallyesteban1993.workers.dev').hostname,
    'duediligence-examinations-staging.wallyesteban1993.workers.dev',
  );
  for (const forbidden of [
    'https://duediligence.ph',
    'https://www.duediligence.ph',
    'https://duediligence-gemini-examiner.wallyesteban1993.workers.dev',
    'https://example.com',
  ]) {
    assert.throws(() => approvedTarget(forbidden), /Refusing load test/);
  }
});

test('load harness performs only unauthenticated static GET requests', () => {
  assert.match(source, /method: 'GET'/);
  assert.match(source, /authenticatedRequests: 0/);
  assert.match(source, /mutatingRequests: 0/);
  assert.match(source, /geminiRequests: 0/);
  assert.doesNotMatch(source, /method:\s*'POST'|authorization|apikey|gemini-api-key/i);
  assert.match(source, /const DEFAULT_USERS = 1_000/);
  assert.match(source, /STATIC_STRESS_USERS, DEFAULT_USERS[\s\S]*1, DEFAULT_USERS/);
  assert.match(source, /simulatedUsersTotal: users/);
  assert.match(source, /maximumConcurrentUsers: Math\.min\(users, concurrency\)/);
  assert.match(source, /loadProfile:/);
  assert.match(source, /contentMatched/);
  assert.match(source, /typeMatched/);
  assert.match(source, /throughputRequestsPerSecond/);
  assert.match(source, /p99LatencyMs <= maximumP99Ms/);
});

test('direct execution is portable and cannot silently skip on Linux CI', () => {
  assert.match(source, /pathToFileURL\(path\.resolve\(process\.argv\[1\]\)\)\.href === import\.meta\.url/);
  assert.doesNotMatch(source, /new URL\(`file:\/\/\//);
});

test('local preview resolves production-style directory routes', () => {
  assert.match(previewServer, /pathname\.endsWith\('\/'\)[\s\S]*?index\.html/);
  assert.match(source, /path: '\/admin\/'/);
});

test('the 1,000-user load run is reporting-only, not a production deployment gate', () => {
  assert.doesNotMatch(pagesWorkflow, /stress-public-admin-static-1000\.mjs/);
  assert.doesNotMatch(pagesWorkflow, /Run 1,000-user local artifact load regression/);
});

console.log('Public/Admin 1,000-user static stress harness contract passed.');
