import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = Object.freeze([
  Object.freeze({
    version: '20260831100000',
    file: '20260831100000_september_pricing_cutover.sql',
    name: 'september_pricing_cutover',
  }),
  Object.freeze({
    version: '20260831101000',
    file: '20260831101000_proof_only_payment_evidence.sql',
    name: 'proof_only_payment_evidence',
  }),
]);

const normalizeLf = (value) => String(value).replace(/\r\n?/gu, '\n');
const sha256 = (value) => createHash('sha256').update(normalizeLf(value)).digest('hex');
const stripOuterTransaction = (source, file) => {
  const normalized = normalizeLf(source);
  if ((normalized.match(/^\s*begin;\s*$/gimu) || []).length !== 1
      || (normalized.match(/^\s*commit;\s*$/gimu) || []).length !== 1
      || (normalized.match(/^\s*rollback;\s*$/gimu) || []).length !== 0) {
    throw new Error(`${file} must contain exactly one outer BEGIN and COMMIT.`);
  }
  return normalized
    .replace(/^\s*begin;\s*$/imu, '')
    .replace(/^\s*commit;\s*$/imu, '')
    .trim();
};

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(tmpdir(), `due-diligence-september-pricing-release-${process.pid}.sql`);
if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const prepared = [];
for (const release of releases) {
  const source = await readFile(
    path.join(root, 'supabase', 'migrations', release.file),
    'utf8',
  );
  prepared.push(Object.freeze({
    ...release,
    sha256: sha256(source),
    body: stripOuterTransaction(source, release.file),
  }));
}

const probe = normalizeLf(await readFile(
  path.join(root, 'scripts', 'probe-september-pricing-release.sql'),
  'utf8',
));
if ((probe.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*rollback;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*commit;\s*$/gimu) || []).length !== 0) {
  throw new Error('The September pricing live probe must be one rollback-only transaction.');
}
for (const release of prepared) {
  if (!probe.includes(`sha256:${release.sha256}`)) {
    throw new Error(`The live probe does not pin the current ${release.file} hash.`);
  }
}

const ledgerInsert = (release) => `insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${release.version}',
  array['sha256:${release.sha256}'],
  '${release.name}'
);`;
const exactLedger = (release) => `(version = '${release.version}'
      and name = '${release.name}'
      and 'sha256:${release.sha256}' = any(coalesce(statements, array[]::text[])))`;

const [schedule, payment] = prepared;
const bundle = `-- Generated only from the two reviewed September pricing migrations.
-- It never selects unrelated pending migrations and refuses partial, drifted,
-- or unrecorded pre-existing state before changing the database.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
select pg_advisory_xact_lock(hashtextextended('september-pricing-release-20260831', 20260831));
lock table supabase_migrations.schema_migrations in share row exclusive mode;

select
  count(*) > 0 as september_pricing_ledger_any,
  count(*) = 2 as september_pricing_ledger_complete,
  count(*) filter (where ${exactLedger(schedule)} or ${exactLedger(payment)}) = 2
    as september_pricing_ledger_exact
from supabase_migrations.schema_migrations
where version in ('${schedule.version}', '${payment.version}')
\\gset

select
  exists (
    select 1 from public.pricing_revisions
    where id in (
      'a8310000-0000-4000-8000-000000000001'::uuid,
      'a9140000-0000-4000-8000-000000000001'::uuid
    )
  )
  or to_regprocedure(
    'private.phase4_extend_founding_beta_entitlements(timestamptz)'
  ) is not null
  or exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_requests'
      and column_name in ('payment_evidence_mode', 'paid_at')
  ) as september_pricing_state_any
\\gset

\\if :september_pricing_ledger_any
  \\if :september_pricing_ledger_complete
    \\if :september_pricing_ledger_exact
      \\echo 'Both September pricing migrations already have exact reviewed names and hashes.'
    \\else
      \\echo 'September pricing ledger drift detected; refusing release.'
      rollback;
      \\quit 3
    \\endif
  \\else
    \\echo 'Partial September pricing ledger detected; refusing non-atomic repair.'
    rollback;
    \\quit 3
  \\endif
\\else
  \\if :september_pricing_state_any
    \\echo 'Unrecorded September pricing state detected; refusing unsafe adoption.'
    rollback;
    \\quit 3
  \\else
    \\echo 'Applying the exact September pricing schedule and proof-only payment contract.'
    -- BEGIN ${schedule.version}: ${schedule.name}
    ${schedule.body}
    ${ledgerInsert(schedule)}
    -- END ${schedule.version}: ${schedule.name}

    -- BEGIN ${payment.version}: ${payment.name}
    ${payment.body}
    ${ledgerInsert(payment)}
    -- END ${payment.version}: ${payment.name}
  \\endif
\\endif

select count(*) = 2 as september_pricing_postflight_exact
from supabase_migrations.schema_migrations
where ${exactLedger(schedule)} or ${exactLedger(payment)}
\\gset
\\if :september_pricing_postflight_exact
  \\echo 'Exact September pricing migration ledger postflight passed.'
\\else
  \\echo 'September pricing migration postflight failed.'
  rollback;
  \\quit 3
\\endif
commit;

-- The committed schema is now exercised with rollback-only boundary,
-- entitlement, proof-only, privacy, and replay fixtures.
${probe}`;

await writeFile(outputPath, normalizeLf(bundle), { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  migrations: prepared.map(({ version, name, sha256: hash }) => ({ version, name, sha256: hash })),
  probe: 'rollback-only',
}, null, 2));
