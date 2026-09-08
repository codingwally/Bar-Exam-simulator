import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Only the reviewed forward schema changes belong in this release. The private
// customer repair is deliberately separate and is never executed by CI.
export const ASTRA_MIGRATIONS = Object.freeze([
  '20260907060650_astra_forecast_attempts.sql',
  '20260907064532_astra_forecast_result_exports.sql',
  '20260907071547_astra_payment_term_repair_journal.sql',
  '20260907120000_astra_payment_activation_terms.sql',
  '20260907120100_astra_payment_proof_evidence.sql',
  '20260907120200_astra_payment_invalidation.sql',
  '20260907130000_astra_simulator_access.sql',
  '20260907130002_astra_late_payment_review.sql',
  '20260907133129_astra_149_binding_compatibility.sql',
  '20260907143119_astra_late_149_binding_reconciliation.sql',
  '20260907172508_astra_forecast_summary_email.sql',
  '20260907173112_astra_browser_pdf_prepared_note.sql',
  '20260907181748_astra_admin_role_fail_closed.sql',
  '20260907222627_astra_forecast_analytics_browser_scopes.sql',
  '20260907223228_astra_simulator_verified_source_presentation.sql',
]);
export const normalizedSql = (source) => source.replace(/\r\n?/gu, '\n').trim() + '\n';
const digest = (source) => createHash('sha256').update(source).digest('hex');
export async function databaseManifest() {
  return Promise.all(ASTRA_MIGRATIONS.map(async (file) => ({
    file, sha256: digest(normalizedSql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))),
  })));
}
const manifest = await databaseManifest();
const attestation = `sha256:${digest(JSON.stringify(manifest))}`;
const mode = process.argv[2];
assert.equal(process.argv.length, 3, 'Choose one explicit database-contract operation.');
if (mode === '--print-attestation') console.log(attestation);
else if (mode === '--print-manifest') console.log(JSON.stringify({ attestation, migrations: manifest }, null, 2));
else if (mode === '--verify-attestation') {
  assert.equal(process.env.ASTRA_DATABASE_VERIFIED_SHA256, attestation,
    'Apply and read back this exact schema bundle and run its rollback probes on the target environment before deploying the Worker.');
  console.log('ASTRA_EXACT_DATABASE_BUNDLE_ATTESTED');
} else if (mode === '--self-test') {
  assert.equal(new Set(ASTRA_MIGRATIONS).size, 15);
  assert.deepEqual(ASTRA_MIGRATIONS, [...ASTRA_MIGRATIONS].sort());
  assert.equal(normalizedSql('begin;\r\ncommit;\r\n\r\n'), 'begin;\ncommit;\n');
  assert.match(attestation, /^sha256:[a-f0-9]{64}$/u);
  for (const row of manifest) assert.match(row.sha256, /^[a-f0-9]{64}$/u);
  console.log('ASTRA_DATABASE_CONTRACT_TEST_PASSED');
} else throw new Error('Unknown database-contract operation.');
