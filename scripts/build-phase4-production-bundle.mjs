import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = Object.freeze([
  {
    file: '20260730_005_phase4_access_subscriptions.sql',
    version: '20260730005',
    name: '005_phase4_access_subscriptions',
  },
  {
    file: '20260730_006_phase4_exam_reliability.sql',
    version: '20260730006',
    name: '006_phase4_exam_reliability',
  },
  {
    file: '20260730_007_phase4_timer_history.sql',
    version: '20260730007',
    name: '007_phase4_timer_history',
  },
  {
    file: '20260730_008_phase4_payments_partnerships.sql',
    version: '20260730008',
    name: '008_phase4_payments_partnerships',
  },
]);

const outputArgument = process.argv.indexOf('--output');
const rollbackOnly = process.argv.includes('--rollback');
const omitLedger = process.argv.includes('--omit-ledger');
const outputPath = outputArgument >= 0
  ? path.resolve(process.argv[outputArgument + 1] || '')
  : path.join(tmpdir(), `due-diligence-phase4-production-${process.pid}.sql`);

if (!outputPath || outputPath === root) {
  throw new Error('A safe output file path is required.');
}

const bodies = [];
const ledgerRows = [];
const sourceHashes = {};

for (const release of releases) {
  const sourcePath = path.join(root, 'supabase', 'migrations', release.file);
  const source = await readFile(sourcePath, 'utf8');
  const beginCount = (source.match(/^\s*begin;\s*$/gim) || []).length;
  const commitCount = (source.match(/^\s*commit;\s*$/gim) || []).length;
  if (beginCount !== 1 || commitCount !== 1) {
    throw new Error(`${release.file} must contain exactly one outer BEGIN and COMMIT.`);
  }
  if (!/^\s*begin;\s*$/im.test(source) || !/^\s*commit;\s*$/im.test(source)) {
    throw new Error(`${release.file} must be wrapped by its outer transaction.`);
  }

  const hash = createHash('sha256').update(source).digest('hex');
  sourceHashes[release.file] = hash;
  const body = source
    .replace(/^\s*begin;\s*$/im, '')
    .replace(/^\s*commit;\s*$/im, '')
    .trim();
  bodies.push(`-- ${release.name}\n${body}`);
  ledgerRows.push(
    `('${release.version}', array['sha256:${hash}'], '${release.name}', `
      + `'codex-phase4-reviewed-bundle', 'phase4-${release.version}-${hash.slice(0, 16)}')`,
  );
}

const ledgerBlock = omitLedger
  ? '-- Ledger insertion omitted for rollback-only staging validation.'
  : `insert into supabase_migrations.schema_migrations
  (version, statements, name, created_by, idempotency_key)
values
  ${ledgerRows.join(',\n  ')};`;

const bundle = `-- Generated from the four reviewed Phase 4 migration sources.
-- This file contains no credentials and applies all releases atomically.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

${bodies.join('\n\n')}

${ledgerBlock}

${rollbackOnly ? 'rollback' : 'commit'};
`;

await writeFile(outputPath, bundle, { encoding: 'utf8', flag: 'wx' });
const bundleHash = createHash('sha256').update(bundle).digest('hex');
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(bundle),
  sha256: bundleHash,
  mode: rollbackOnly ? 'rollback-only' : 'commit',
  ledger: omitLedger ? 'omitted' : 'included',
  sourceHashes,
}, null, 2));
