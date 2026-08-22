import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../assets/phase2-config.js', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../assets/maintenance-gate.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const publicLanding = readFileSync(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/maintenance-entry.mjs', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
const pagesBuilder = readFileSync(new URL('../scripts/build-pages-artifact.mjs', import.meta.url), 'utf8');
const workerDeploy = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const pagesDeploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

assert.match(config, /maintenance:\s*Object\.freeze\(\{/);
assert.match(config, /enabled:\s*false/);
assert.match(config, /\/maintenance\/unlock/);
assert.match(config, /\/maintenance\/status/);
assert.match(config, /X-DD-Maintenance-Access/);
assert.match(config, /duediligence\.maintenance\.access\.v1/);
assert.match(config, /\/assets\/maintenance-gate\.js\?v=maintenance-lock-20260821-3/);
assert.match(config, /global\.document\.documentElement\.dataset\.ddMaintenance = 'locked'/);
assert.match(config, /maintenanceAwareFetch/);
assert.match(config, /global\.localStorage\?\.getItem\(maintenance\.tokenStorageKey\)/);
assert.doesNotMatch(config, /\b0802\b/, 'The maintenance password must not be embedded in browser configuration.');

assert.match(frontend, /We are improving Due Diligence\./);
assert.match(frontend, /better, stronger, and more reliable version/);
assert.match(frontend, /global\.location\.reload\(\)/);
assert.match(frontend, /Verifying saved maintenance access/);
assert.match(frontend, /Authorized testing access is remembered in this browser for seven days/);
assert.match(frontend, /duediligence:maintenance-unlocked/);
assert.match(frontend, /maintenanceRequest\(maintenance\.statusPath, \{\}, payload\.token\)/);
assert.match(frontend, /saveToken\(payload\.token\);[\s\S]*unlockPage\(\);/);
assert.doesNotMatch(frontend, /\b0802\b/, 'The maintenance password must not be embedded in browser JavaScript.');
assert.match(index, /const maintenanceGate = document\.documentElement\.dataset\.ddMaintenance === 'locked'/);
assert.match(index, /const topOverlay = maintenanceGate[\s\S]*\|\| admissionDialog/);
assert.match(publicLanding, /document\.documentElement\.dataset\.ddMaintenance !== 'open'/);
assert.match(publicLanding, /global\.addEventListener\('duediligence:maintenance-unlocked', initialize, \{ once: true \}\)/);
assert.match(pagesBuilder, /assets\/maintenance-gate\.js/);

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
assert.match(wrangler, /MAINTENANCE_MODE = "false"/);
assert.match(wrangler, /MAINTENANCE_PASSWORD_HASH = "[0-9a-f]{64}"/);
assert.match(wrangler, /MAINTENANCE_TOKEN_TTL_SECONDS = "604800"/);
assert.match(workerDeploy, /MAINTENANCE_SIGNING_KEY/);
assert.match(workerDeploy, /randomBytes\(32\)\.toString\('base64url'\)/);
assert.match(workerDeploy, /node scripts\/test-maintenance-lock\.mjs/);
assert.match(pagesDeploy, /node scripts\/test-maintenance-lock\.mjs/);

console.log('Public-launch maintenance bypass and dormant gate contracts passed.');
