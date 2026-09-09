import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createStudyDebateFixtureLifecycle } from './debate-staging-fixtures.mjs';

// Importable coordinator only: importing this file never provisions an account.
// The reviewed staging workflow supplies its exact baseline suppression check and
// a prepare/deploy/postflight/GET-only-smoke callback. Secrets stay in this process
// or its directly invoked trusted child environment; none enter workflow inputs.
export async function withStudyDebateStagingAccounts({ manifestPath, run, ...options }) {
  if (typeof run !== 'function' || typeof manifestPath !== 'string') throw new Error('FIXTURE_COORDINATOR_REQUIRED');
  let initialized = false;
  const persist = async manifest => {
    await mkdir(dirname(manifestPath), { recursive: true });
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
    if (!initialized) { await writeFile(manifestPath, bytes, { flag: 'wx', mode: 0o600 }); initialized = true; }
    else { const temporary = `${manifestPath}.tmp`; await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, manifestPath); }
  };
  const lifecycle = createStudyDebateFixtureLifecycle({ ...options, persist });
  let result, originalError, cleanup;
  try { const accounts = await lifecycle.provision(); result = await run(accounts); }
  catch (error) { originalError = error; }
  finally { cleanup = await lifecycle.cleanup(); }
  if (!cleanup.complete) { const e = new Error('FIXTURE_CLEANUP_REQUIRES_EXACT_ID_RECONCILIATION'); e.code = e.message; throw e; }
  if (originalError) throw originalError;
  return { result, cleanup, fixtures: lifecycle.snapshot() };
}
