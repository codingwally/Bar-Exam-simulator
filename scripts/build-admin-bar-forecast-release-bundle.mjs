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
const releases = Object.freeze([
  Object.freeze({
    version: '20260831170000',
    file: '20260831170000_admin_bar_forecast.sql',
    name: 'admin_bar_forecast',
    stateKey: 'forecast',
  }),
  Object.freeze({
    version: '20260901010837',
    file: '20260901010837_admin_bar_forecast_consent_version.sql',
    name: 'admin_bar_forecast_consent_version',
    stateKey: 'forecast_consent',
  }),
  Object.freeze({
    version: '20260901014500',
    file: '20260901014500_admin_bar_forecast_runtime_integrity.sql',
    name: 'admin_bar_forecast_runtime_integrity',
    stateKey: 'forecast_runtime_integrity',
  }),
  Object.freeze({
    version: '20260901030000',
    file: '20260901030000_bar_forecast_member_access.sql',
    name: 'bar_forecast_member_access',
    stateKey: 'forecast_member_access',
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
const preparedReleases = [];
for (const release of releases) {
  const source = await readFile(
    path.join(root, 'supabase', 'migrations', release.file),
    'utf8',
  );
  preparedReleases.push(Object.freeze({
    ...release,
    sha256: sha256(source),
    body: stripOuterTransaction(source, release.file),
  }));
}
const orderedVersions = [...preparedPrerequisites, ...preparedReleases].map(({ version }) => version);
if (new Set(orderedVersions).size !== orderedVersions.length
    || orderedVersions.some((version, index) => index > 0 && version <= orderedVersions[index - 1])) {
  throw new Error('Forecast migrations must follow both September pricing migrations in exact order.');
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
for (const item of [...preparedPrerequisites, ...preparedReleases]) {
  if (!probe.includes(`sha256:${item.sha256}`)) {
    throw new Error(`The live probe does not pin the current ${item.file} hash.`);
  }
}

const exactLedger = (item) => `(version = '${item.version}'
      and name = '${item.name}'
      and 'sha256:${item.sha256}' = any(coalesce(statements, array[]::text[])))`;
const [schedule, payment] = preparedPrerequisites;
const ledgerInsert = (item) => `insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${item.version}',
  array['sha256:${item.sha256}'],
  '${item.name}'
);`;

const releaseStateProbe = (item) => {
  if (item.stateKey === 'forecast') {
    return `select exists (
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
       ) as ${item.stateKey}_state_any
\\gset`;
  }
  if (item.stateKey === 'forecast_consent') {
    return `select exists (
         select 1
         from pg_catalog.pg_constraint constraint_row
         where constraint_row.conrelid = to_regclass('public.dd2026_bar_forecast_consents')
           and position('2026-09-01' in pg_get_constraintdef(constraint_row.oid)) > 0
       )
       or exists (
         select 1
         from (
           values
             (to_regprocedure('public.dd2026_bar_forecast_consent_status(uuid,text)')),
             (to_regprocedure('public.dd2026_bar_forecast_accept_consent(uuid,text)')),
             (to_regprocedure('public.dd2026_bar_forecast_admin_list(uuid,text,text)'))
         ) candidate(rpc)
         where candidate.rpc is not null
           and position('2026-09-01' in pg_get_functiondef(candidate.rpc::oid)) > 0
       ) as ${item.stateKey}_state_any
\\gset`;
  }
  if (item.stateKey === 'forecast_runtime_integrity') {
    return `select exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         where procedure_row.oid = to_regprocedure(
           'public.dd2026_bar_forecast_admin_list(uuid,text,text)'
         )
           and position(
             'DD2026_BAR_FORECAST_INTEGRITY_INVALID'
             in pg_get_functiondef(procedure_row.oid)
           ) > 0
           and position('v_checksum_count' in pg_get_functiondef(procedure_row.oid)) > 0
           and position('v_editorial_count' in pg_get_functiondef(procedure_row.oid)) > 0
           and position(
             'v.payload ->> ''id'' = i.id'
             in pg_get_functiondef(procedure_row.oid)
           ) > 0
       ) as ${item.stateKey}_state_any
\\gset`;
  }
  if (item.stateKey === 'forecast_member_access') {
    return `select to_regprocedure(
           'public.dd2026_bar_forecast_access_allowed(uuid)'
         ) is not null
         or exists (
           select 1
           from public.dd2026_feature_flags flag_row
           where (flag_row.flag_key = 'BAR_FORECAST_ENABLED' and flag_row.enabled)
              or (flag_row.flag_key = 'BAR_FORECAST_ADMIN_ONLY' and not flag_row.enabled)
         )
         or exists (
           select 1
           from (
             values
               (to_regprocedure('public.dd2026_bar_forecast_consent_status(uuid,text)')),
               (to_regprocedure('public.dd2026_bar_forecast_accept_consent(uuid,text)')),
               (to_regprocedure('public.dd2026_bar_forecast_admin_list(uuid,text,text)'))
           ) candidate(rpc)
           where candidate.rpc is not null
             and position(
               'dd2026_bar_forecast_access_allowed'
               in pg_get_functiondef(candidate.rpc::oid)
             ) > 0
         ) as ${item.stateKey}_state_any
\\gset`;
  }
  throw new Error(`Unsupported Forecast release state key: ${item.stateKey}`);
};

const releaseBlock = (item) => `select count(*) > 0 as ${item.stateKey}_ledger_any,
       count(*) = 1 and count(*) filter (where ${exactLedger(item)}) = 1
         as ${item.stateKey}_ledger_exact
from supabase_migrations.schema_migrations
where version = '${item.version}'
\\gset

${releaseStateProbe(item)}

\\if :${item.stateKey}_ledger_any
  \\if :${item.stateKey}_ledger_exact
    \\echo 'The ${item.name} migration already has the exact reviewed name and hash.'
  \\else
    \\echo '${item.name} migration ledger drift detected; refusing release.'
    rollback;
    \\quit 3
  \\endif
\\else
  \\if :${item.stateKey}_state_any
    \\echo 'Unrecorded ${item.name} state detected; refusing unsafe adoption.'
    rollback;
    \\quit 3
  \\else
    \\echo 'Applying only the exact ${item.name} migration.'
    -- BEGIN ${item.version}: ${item.name}
    ${item.body}
    ${ledgerInsert(item)}
    -- END ${item.version}: ${item.name}
  \\endif
\\endif`;

const releaseBlocks = preparedReleases.map(releaseBlock).join('\n\n');
const releaseVersions = preparedReleases.map(({ version }) => `'${version}'`).join(', ');
const exactReleaseLedger = preparedReleases.map(exactLedger).join(' or ');

const bundle = `-- Generated only from the reviewed protected Bar Forecast migrations.
-- The two September pricing migrations are immutable prerequisites: this bundle
-- verifies their exact ledger names and source hashes but never reapplies them.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
select pg_advisory_xact_lock(hashtextextended('admin-bar-forecast-release-20260901', 20260901));
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

${releaseBlocks}

select count(*) = ${preparedReleases.length}
       and count(*) filter (where ${exactReleaseLedger}) = ${preparedReleases.length}
  as forecast_postflight_exact
from supabase_migrations.schema_migrations
where version in (${releaseVersions})
\\gset
\\if :forecast_postflight_exact
  \\echo 'Exact Bar Forecast migration ledger postflight passed for all four migrations.'
\\else
  \\echo 'Admin Bar Forecast migration ledger postflight failed.'
  rollback;
  \\quit 3
\\endif
commit;

-- The committed schema is now exercised with a rollback-only schema,
-- privilege, feature-flag, and entitlement authorization probe.
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
  migrations: preparedReleases.map(({ version, name, sha256: hash }) => ({
    version,
    name,
    sha256: hash,
  })),
  probe: 'rollback-only',
}, null, 2));
