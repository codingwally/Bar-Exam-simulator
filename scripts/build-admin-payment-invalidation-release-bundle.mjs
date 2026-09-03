import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = Object.freeze({
  version: '20260901120000',
  file: '20260901120000_admin_payment_invalidation.sql',
  name: 'admin_payment_invalidation',
});
const normalizeLf = (value) => String(value).replace(/\r\n?/gu, '\n');
const hash = (value) => createHash('sha256').update(normalizeLf(value)).digest('hex');

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(tmpdir(), `due-diligence-admin-payment-invalidation-${process.pid}.sql`);
if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const source = normalizeLf(await readFile(
  path.join(root, 'supabase', 'migrations', release.file),
  'utf8',
));
if ((source.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (source.match(/^\s*commit;\s*$/gimu) || []).length !== 1
    || (source.match(/^\s*rollback;\s*$/gimu) || []).length !== 0) {
  throw new Error(`${release.file} must contain exactly one outer BEGIN and COMMIT.`);
}
const body = source
  .replace(/^\s*begin;\s*$/imu, '')
  .replace(/^\s*commit;\s*$/imu, '')
  .trim();
const sourceHash = hash(source);
const probe = normalizeLf(await readFile(
  path.join(root, 'scripts', 'probe-admin-payment-invalidation.sql'),
  'utf8',
));
if ((probe.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*rollback;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*commit;\s*$/gimu) || []).length !== 0
    || !/^\\set ON_ERROR_STOP on\s*$/imu.test(probe)) {
  throw new Error('The Admin payment invalidation probe must be one rollback-only psql transaction.');
}

const exactLedger = `(version = '${release.version}'
      and name = '${release.name}'
      and 'sha256:${sourceHash}' = any(coalesce(statements, array[]::text[])))`;
const bundle = `-- Exact reviewed Admin payment invalidation migration and rollback-only probe.
-- No unrelated pending Supabase migration is selected.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
select pg_advisory_xact_lock(hashtextextended('admin-payment-invalidation-20260901', 20260901));
lock table supabase_migrations.schema_migrations in share row exclusive mode;

select
  count(*) > 0 as payment_invalidation_ledger_any,
  count(*) filter (where ${exactLedger}) = 1 as payment_invalidation_ledger_exact
from supabase_migrations.schema_migrations
where version = '${release.version}'
\\gset

\\if :payment_invalidation_ledger_any
  \\if :payment_invalidation_ledger_exact
    \\echo 'Admin payment invalidation ledger matches the reviewed source hash; reapplying exact definitions.'
  \\else
    \\echo 'Admin payment invalidation ledger drift detected; refusing release.'
    rollback;
    \\quit 3
  \\endif
\\else
  \\echo 'Applying the exact Admin payment invalidation migration.'
\\endif

-- BEGIN reviewed migration ${release.version}: ${release.name}
${body}
\\if :payment_invalidation_ledger_any
\\else
  insert into supabase_migrations.schema_migrations (version, statements, name)
  values ('${release.version}', array['sha256:${sourceHash}'], '${release.name}');
\\endif
-- END reviewed migration ${release.version}: ${release.name}

select coalesce(
  exists (
    select 1 from supabase_migrations.schema_migrations
    where ${exactLedger}
  )
  and exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.oid = 'public.phase4_admin_invalidate_payment(uuid,uuid,text,text)'::regprocedure
      and not function_row.prosecdef
      and function_row.provolatile = 'v'
      and function_row.proconfig = array['search_path=""']::text[]
  )
  and not has_function_privilege(
    'anon', 'public.phase4_admin_invalidate_payment(uuid,uuid,text,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.phase4_admin_invalidate_payment(uuid,uuid,text,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.phase4_admin_invalidate_payment(uuid,uuid,text,text)', 'EXECUTE'
  )
  and exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.subscriptions'::regclass
      and constraint_row.conname = 'subscriptions_invalidated_payment_cancelled_check'
      and position(
        'invalidated_payment' in pg_get_constraintdef(constraint_row.oid)
      ) > 0
  ),
  false
) as payment_invalidation_postflight_ok
\\gset

\\if :payment_invalidation_postflight_ok
  \\echo 'Admin payment invalidation schema, guard, and privileges verified.'
\\else
  \\echo 'Admin payment invalidation postflight failed; rolling back.'
  rollback;
  \\quit 3
\\endif
commit;

-- The committed RPC is now exercised only with rollback-only synthetic data.
${probe}`;

await writeFile(outputPath, bundle, { encoding: 'utf8', flag: 'wx' });
const bundleHash = createHash('sha256').update(bundle).digest('hex');
console.log(JSON.stringify({
  ok: true,
  release: { ...release, sha256: sourceHash },
  liveProbe: 'scripts/probe-admin-payment-invalidation.sql',
  output: outputPath,
  sha256: bundleHash,
}));
