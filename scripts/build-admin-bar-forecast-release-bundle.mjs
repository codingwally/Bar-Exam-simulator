import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prerequisites = Object.freeze([
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
const release = Object.freeze({
  version: '20260831170000',
  file: '20260831170000_admin_bar_forecast.sql',
  name: 'admin_bar_forecast',
});

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
  : path.join(tmpdir(), `due-diligence-admin-bar-forecast-release-${process.pid}.sql`);
if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const preparedPrerequisites = [];
for (const prerequisite of prerequisites) {
  const source = await readFile(
    path.join(root, 'supabase', 'migrations', prerequisite.file),
    'utf8',
  );
  preparedPrerequisites.push(Object.freeze({ ...prerequisite, sha256: sha256(source) }));
}
const releaseSource = await readFile(
  path.join(root, 'supabase', 'migrations', release.file),
  'utf8',
);
const preparedRelease = Object.freeze({
  ...release,
  sha256: sha256(releaseSource),
  body: stripOuterTransaction(releaseSource, release.file),
});
if (!preparedPrerequisites.every((item) => item.version < preparedRelease.version)) {
  throw new Error('The Forecast migration must follow both September pricing migrations.');
}

const probe = normalizeLf(await readFile(
  path.join(root, 'scripts', 'probe-admin-bar-forecast-release.sql'),
  'utf8',
));
if ((probe.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*rollback;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*commit;\s*$/gimu) || []).length !== 0) {
  throw new Error('The Admin Bar Forecast live probe must be one rollback-only transaction.');
}
for (const item of [...preparedPrerequisites, preparedRelease]) {
  if (!probe.includes(`sha256:${item.sha256}`)) {
    throw new Error(`The live probe does not pin the current ${item.file} hash.`);
  }
}

const exactLedger = (item) => `(version = '${item.version}'
      and name = '${item.name}'
      and 'sha256:${item.sha256}' = any(coalesce(statements, array[]::text[])))`;
const [schedule, payment] = preparedPrerequisites;
const ledgerInsert = `insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${preparedRelease.version}',
  array['sha256:${preparedRelease.sha256}'],
  '${preparedRelease.name}'
);`;

const bundle = `-- Generated only from the reviewed administrator-only Bar Forecast migration.
-- The two September pricing migrations are immutable prerequisites: this bundle
-- verifies their exact ledger names and source hashes but never reapplies them.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
select pg_advisory_xact_lock(hashtextextended('admin-bar-forecast-release-20260831', 20260831));
lock table supabase_migrations.schema_migrations in share row exclusive mode;

select count(*) = 2
       and count(*) filter (where ${exactLedger(schedule)} or ${exactLedger(payment)}) = 2
  as forecast_prerequisite_ledger_exact
from supabase_migrations.schema_migrations
where version in ('${schedule.version}', '${payment.version}')
\\gset

\\if :forecast_prerequisite_ledger_exact
  \\echo 'Both September pricing prerequisite ledger names and source hashes are exact.'
\\else
  \\echo 'The exact September pricing prerequisites are missing or drifted; refusing Forecast release.'
  rollback;
  \\quit 3
\\endif

select count(*) > 0 as forecast_ledger_any,
       count(*) = 1 and count(*) filter (where ${exactLedger(preparedRelease)}) = 1
         as forecast_ledger_exact
from supabase_migrations.schema_migrations
where version = '${preparedRelease.version}'
\\gset

select exists (
         select 1 from public.dd2026_feature_flags
         where flag_key in ('BAR_FORECAST_ENABLED', 'BAR_FORECAST_ADMIN_ONLY')
       )
       or to_regclass('public.dd2026_bar_forecast_consents') is not null
       or to_regprocedure('public.dd2026_bar_forecast_consent_status(uuid,text)') is not null
       or to_regprocedure('public.dd2026_bar_forecast_accept_consent(uuid,text)') is not null
       or to_regprocedure('public.dd2026_bar_forecast_admin_list(uuid,text,text)') is not null
       or exists (
         select 1
         from pg_catalog.pg_constraint constraint_row
         where constraint_row.conrelid in (
           'public.dd2026_content_items'::regclass,
           'public.dd2026_content_versions'::regclass
         )
           and (
             pg_get_constraintdef(constraint_row.oid) like '%bar_forecast_question%'
             or pg_get_constraintdef(constraint_row.oid) like '%2026.3%'
           )
       ) as forecast_state_any
\\gset

\\if :forecast_ledger_any
  \\if :forecast_ledger_exact
    \\echo 'The Admin Bar Forecast migration already has the exact reviewed name and hash.'
  \\else
    \\echo 'Admin Bar Forecast migration ledger drift detected; refusing release.'
    rollback;
    \\quit 3
  \\endif
\\else
  \\if :forecast_state_any
    \\echo 'Unrecorded Admin Bar Forecast state detected; refusing unsafe adoption.'
    rollback;
    \\quit 3
  \\else
    \\echo 'Applying only the exact administrator-only Bar Forecast migration.'
    -- BEGIN ${preparedRelease.version}: ${preparedRelease.name}
    ${preparedRelease.body}
    ${ledgerInsert}
    -- END ${preparedRelease.version}: ${preparedRelease.name}
  \\endif
\\endif

select count(*) = 1 and count(*) filter (where ${exactLedger(preparedRelease)}) = 1
  as forecast_postflight_exact
from supabase_migrations.schema_migrations
where version = '${preparedRelease.version}'
\\gset
\\if :forecast_postflight_exact
  \\echo 'Exact Admin Bar Forecast migration ledger postflight passed.'
\\else
  \\echo 'Admin Bar Forecast migration ledger postflight failed.'
  rollback;
  \\quit 3
\\endif
commit;

-- The committed schema is now exercised with a rollback-only schema,
-- privilege, feature-flag, and non-admin authorization probe.
${probe}`;

await writeFile(outputPath, normalizeLf(bundle), { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  prerequisites: preparedPrerequisites.map(({ version, name, sha256: hash }) => ({
    version,
    name,
    sha256: hash,
  })),
  migration: {
    version: preparedRelease.version,
    name: preparedRelease.name,
    sha256: preparedRelease.sha256,
  },
  probe: 'rollback-only',
}, null, 2));
