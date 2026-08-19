import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frontend = readFileSync(new URL('../assets/phase2-config.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/maintenance-entry.mjs', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
const workerDeploy = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const pagesDeploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

assert.match(frontend, /maintenance:\s*Object\.freeze\(\{/);
assert.match(frontend, /enabled:\s*true/);
assert.match(frontend, /\/maintenance\/unlock/);
assert.match(frontend, /\/maintenance\/status/);
assert.match(frontend, /X-DD-Maintenance-Access/);
assert.match(frontend, /duediligence\.maintenance\.access\.v1/);
assert.match(frontend, /We are improving Due Diligence\./);
assert.match(frontend, /better, stronger, and more reliable version/);
assert.match(frontend, /global\.fetch = function maintenanceAwareFetch/);
assert.match(frontend, /global\.location\.reload\(\)/);
assert.doesNotMatch(frontend, /\b0802\b/, 'The maintenance password must not be embedded in browser JavaScript.');

assert.match(worker, /import applicationWorker from '\.\/commercial-entry\.mjs'/);
assert.match(worker, /PASSWORD_HASH_FALLBACK/);
assert.match(worker, /MAINTENANCE_SIGNING_KEY/);
assert.match(worker, /pathname === '\/maintenance\/unlock'/);
assert.match(worker, /pathname === '\/maintenance\/status'/);
assert.match(worker, /if \(!payload\) return lockedResponse/);
assert.match(worker, /headers\.delete\(TOKEN_HEADER\)/);
assert.match(worker, /MAX_ATTEMPTS_PER_WINDOW = 10/);
assert.match(worker, /applicationWorker\.scheduled/);
assert.doesNotMatch(worker, /['"]0802['"]/, 'Worker source should store only the password verifier, not the plain password.');

assert.match(wrangler, /main = "maintenance-entry\.mjs"/);
assert.match(wrangler, /MAINTENANCE_MODE = "true"/);
assert.match(wrangler, /MAINTENANCE_PASSWORD_HASH = "[0-9a-f]{64}"/);
assert.match(wrangler, /MAINTENANCE_TOKEN_TTL_SECONDS = "604800"/);
assert.match(workerDeploy, /MAINTENANCE_SIGNING_KEY/);
assert.match(workerDeploy, /randomBytes\(32\)\.toString\('base64url'\)/);
assert.match(workerDeploy, /node scripts\/test-maintenance-lock\.mjs/);
assert.match(pagesDeploy, /node scripts\/test-maintenance-lock\.mjs/);

console.log('Maintenance password gate contracts passed.');
