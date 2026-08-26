import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');

const baseline = Object.freeze({
  version: '20260825183055',
  file: '20260825183055_examination_room_v1_greenfield.sql',
  name: 'examination_room_v1_greenfield',
});

const releases = Object.freeze([
  {
    version: '20260826130536',
    file: '20260826130536_examination_room_owner_command_center.sql',
    name: 'examination_room_owner_command_center',
  },
  {
    version: '20260827010000',
    file: '20260827010000_examination_room_open_admission_flow.sql',
    name: 'examination_room_open_admission_flow',
  },
  {
    version: '20260827020000',
    file: '20260827020000_examination_room_result_email_delivery.sql',
    name: 'examination_room_result_email_delivery',
  },
  {
    version: '20260827030000',
    file: '20260827030000_examination_room_supabase_storage_recovery.sql',
    name: 'examination_room_supabase_storage_recovery',
  },
]);

const normalizeSource = (source) => source.replace(/\r\n?/gu, '\n');
const sha256 = (source) => createHash('sha256').update(source).digest('hex');

async function loadMigration(release, { includeBody = true } = {}) {
  const sourcePath = path.join(migrationsDirectory, release.file);
  const source = normalizeSource(await readFile(sourcePath, 'utf8'));
  const beginCount = (source.match(/^\s*begin;\s*$/gimu) || []).length;
  const commitCount = (source.match(/^\s*commit;\s*$/gimu) || []).length;

  if (beginCount !== 1 || commitCount !== 1) {
    throw new Error(`${release.file} must contain exactly one outer BEGIN and COMMIT.`);
  }
  if (/^\s*\\/mu.test(source)) {
    throw new Error(`${release.file} contains a psql meta-command and is not pure SQL.`);
  }

  return {
    ...release,
    sha256: sha256(source),
    body: includeBody
      ? source
        .replace(/^\s*begin;\s*$/imu, '')
        .replace(/^\s*commit;\s*$/imu, '')
        .trim()
      : undefined,
  };
}

const outputIndex = process.argv.indexOf('--output');
const explicitOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : '';
if (outputIndex >= 0 && !explicitOutput) {
  throw new Error('--output requires a file path.');
}

const outputPath = explicitOutput
  ? path.resolve(explicitOutput)
  : path.join(tmpdir(), `due-diligence-examination-room-pure-sql-release-${process.pid}.sql`);

if (outputPath === root
    || outputPath === migrationsDirectory
    || outputPath.startsWith(`${migrationsDirectory}${path.sep}`)) {
  throw new Error('The release output must not overwrite the repository or a source migration.');
}

try {
  await access(outputPath);
  throw new Error(`Refusing to overwrite existing release output: ${outputPath}`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const loadedBaseline = await loadMigration(baseline, { includeBody: false });
const loadedReleases = await Promise.all(releases.map((release) => loadMigration(release)));
const releaseVersionsSql = loadedReleases.map((release) => `'${release.version}'`).join(', ');
const migrationBodies = loadedReleases
  .map((release) => `-- BEGIN reviewed migration ${release.version}: ${release.name}\n${release.body}\n-- END reviewed migration ${release.version}: ${release.name}`)
  .join('\n\n');
const ledgerValues = loadedReleases
  .map((release) => `  ('${release.version}', array['sha256:${release.sha256}']::text[], '${release.name}')`)
  .join(',\n');
const expectedLedgerValues = loadedReleases
  .map((release) => `    ('${release.version}', '${release.name}', 'sha256:${release.sha256}')`)
  .join(',\n');

const bundle = `-- DueDiligence.ph Examination Room production release.
-- Generated from exactly four reviewed Examination Room migrations.
-- Pure PostgreSQL only: no psql meta-commands and no unrelated migrations.
-- The transaction refuses an incomplete baseline, an existing target ledger row,
-- or any partially applied target structure. Any failure rolls back the release.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

select pg_advisory_xact_lock(
  hashtextextended('duediligence:examination-room:pure-sql-release:20260827', 0)
);
lock table supabase_migrations.schema_migrations in share row exclusive mode;

do $examination_room_release_preflight$
declare
  baseline_record supabase_migrations.schema_migrations%rowtype;
  baseline_complete boolean := false;
  target_ledger_count integer := 0;
  owner_any boolean := false;
  open_admission_any boolean := false;
  result_email_any boolean := false;
  storage_recovery_any boolean := false;
begin
  select migration.*
  into baseline_record
  from supabase_migrations.schema_migrations migration
  where migration.version = '${loadedBaseline.version}';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Examination Room greenfield ledger is missing; refusing additive production release';
  end if;

  if exists (
    select 1
    from unnest(coalesce(baseline_record.statements, array[]::text[])) statement
    where statement like 'sha256:%'
  ) and not 'sha256:${loadedBaseline.sha256}' = any(
    coalesce(baseline_record.statements, array[]::text[])
  ) then
    raise exception using
      errcode = '55000',
      message = 'Examination Room greenfield checksum conflicts with the reviewed baseline';
  end if;

  baseline_complete := coalesce(
    to_regnamespace('examination_room_v1') is not null
    and to_regclass('examination_room_v1.institutions') is not null
    and to_regclass('examination_room_v1.exams') is not null
    and to_regclass('examination_room_v1.exam_versions') is not null
    and to_regclass('examination_room_v1.student_identities') is not null
    and to_regclass('examination_room_v1.room_activations') is not null
    and to_regclass('examination_room_v1.student_sessions') is not null
    and to_regclass('examination_room_v1.submissions') is not null
    and to_regclass('examination_room_v1.grade_revisions') is not null
    and to_regclass('examination_room_v1.result_releases') is not null
    and to_regclass('examination_room_v1.recovery_snapshots') is not null
    and to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_staff_context(uuid)') is not null,
    false
  );

  if not baseline_complete then
    raise exception using
      errcode = '55000',
      message = 'Examination Room greenfield baseline is structurally incomplete';
  end if;

  if to_regclass('storage.buckets') is null then
    raise exception using
      errcode = '55000',
      message = 'Supabase Storage is unavailable; refusing recovery release';
  end if;

  select count(*)::integer
  into target_ledger_count
  from supabase_migrations.schema_migrations migration
  where migration.version in (${releaseVersionsSql});

  if target_ledger_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'One or more target Examination Room ledger rows already exist';
  end if;

  owner_any := coalesce(
    to_regclass('examination_room_v1.owner_key_envelopes') is not null
    or to_regclass('examination_room_v1.email_delivery_events') is not null
    or to_regclass('examination_room_v1.owner_identity_corrections') is not null
    or to_regprocedure('public.examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)') is not null
    or to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)') is not null
    or to_regprocedure('public.examination_room_v1_grading_contexts(uuid,uuid,uuid,jsonb)') is not null
    or to_regprocedure('public.examination_room_v1_import_grades(uuid,uuid,uuid,jsonb)') is not null
    or to_regprocedure('public.examination_room_v1_claim_recovery_snapshot(integer)') is not null
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.result_releases')
        and attribute.attname = 'batch_request_hash'
        and not attribute.attisdropped
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.recovery_snapshots')
        and attribute.attname in (
          'source_kind', 'source_session_id', 'source_submission_id',
          'source_grade_revision_id', 'source_result_release_id',
          'materialization_attempts', 'lease_id', 'lease_expires_at',
          'next_retry_at', 'available_at', 'last_error_code', 'last_error_at',
          'verified_at', 'restored_record_count', 'restore_verification_sha256'
        )
        and not attribute.attisdropped
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.student_identities')
        and attribute.attname = 'email_normalized'
        and not attribute.attisdropped
        and not attribute.attnotnull
    ),
    false
  );

  open_admission_any := coalesce(
    to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') is not null
    or to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') is not null
    or to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') is not null
    or to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') is not null
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exams')
        and attribute.attname in ('admission_mode', 'allowed_emails')
        and not attribute.attisdropped
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exam_versions')
        and attribute.attname in ('admission_mode_snapshot', 'allowed_emails_snapshot')
        and not attribute.attisdropped
    )
    or exists (
      select 1
      from examination_room_v1.institutions institution
      where institution.institution_code = 'due-diligence-community'
    ),
    false
  );

  result_email_any := coalesce(
    to_regclass('examination_room_v1.result_email_delivery_events') is not null
    or to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)') is not null
    or to_regprocedure('public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb)') is not null
    or to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') is not null,
    false
  );

  select exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'examination-room-recovery'
  )
  into storage_recovery_any;

  if owner_any or open_admission_any or result_email_any or storage_recovery_any then
    raise exception using
      errcode = '55000',
      message = 'Partial or unrecorded Examination Room target state detected; refusing unsafe reapply';
  end if;
end;
$examination_room_release_preflight$;

${migrationBodies}

insert into supabase_migrations.schema_migrations (version, statements, name)
values
${ledgerValues};

do $examination_room_release_postflight$
declare
  exact_ledger_count integer := 0;
  owner_complete boolean := false;
  open_admission_complete boolean := false;
  result_email_complete boolean := false;
  storage_recovery_complete boolean := false;
begin
  with expected(version, name, checksum) as (
    values
${expectedLedgerValues}
  )
  select count(*)::integer
  into exact_ledger_count
  from expected
  join supabase_migrations.schema_migrations migration
    on migration.version = expected.version
   and migration.name = expected.name
   and expected.checksum = any(coalesce(migration.statements, array[]::text[]));

  if exact_ledger_count <> ${loadedReleases.length} then
    raise exception using
      errcode = '55000',
      message = 'Examination Room release ledger postflight failed';
  end if;

  owner_complete := coalesce(
    to_regclass('examination_room_v1.owner_key_envelopes') is not null
    and to_regclass('examination_room_v1.email_delivery_events') is not null
    and to_regclass('examination_room_v1.owner_identity_corrections') is not null
    and to_regprocedure('public.examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_owner_ensure_membership(uuid,uuid)') is not null
    and to_regprocedure('public.examination_room_v1_grading_contexts(uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_import_grades(uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_claim_recovery_snapshot(integer)') is not null
    and to_regprocedure('public.examination_room_v1_complete_recovery_snapshot(uuid,uuid,text,text,text)') is not null
    and to_regprocedure('public.examination_room_v1_verify_recovery_snapshot(uuid,text)') is not null
    and to_regprocedure('public.examination_room_v1_fail_recovery_snapshot(uuid,uuid,text,integer)') is not null
    and exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.result_releases')
        and attribute.attname = 'batch_request_hash'
        and not attribute.attisdropped
    )
    and 15 = (
      select count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.recovery_snapshots')
        and attribute.attname in (
          'source_kind', 'source_session_id', 'source_submission_id',
          'source_grade_revision_id', 'source_result_release_id',
          'materialization_attempts', 'lease_id', 'lease_expires_at',
          'next_retry_at', 'available_at', 'last_error_code', 'last_error_at',
          'verified_at', 'restored_record_count', 'restore_verification_sha256'
        )
        and not attribute.attisdropped
    )
    and 3 = (
      select count(*)
      from pg_catalog.pg_class relation
      where relation.oid in (
        to_regclass('examination_room_v1.owner_key_envelopes'),
        to_regclass('examination_room_v1.email_delivery_events'),
        to_regclass('examination_room_v1.owner_identity_corrections')
      )
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ),
    false
  );

  open_admission_complete := coalesce(
    to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') is not null
    and to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') is not null
    and to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') is not null
    and to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') is not null
    and 2 = (
      select count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exams')
        and attribute.attname in ('admission_mode', 'allowed_emails')
        and not attribute.attisdropped
    )
    and 2 = (
      select count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exam_versions')
        and attribute.attname in ('admission_mode_snapshot', 'allowed_emails_snapshot')
        and not attribute.attisdropped
    )
    and 4 = (
      select count(*)
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conname in (
        'exams_admission_mode_check', 'exams_allowed_emails_check',
        'exam_versions_admission_mode_check', 'exam_versions_allowed_emails_check'
      )
        and constraint_record.conrelid in (
          to_regclass('examination_room_v1.exams'),
          to_regclass('examination_room_v1.exam_versions')
        )
        and constraint_record.convalidated
    )
    and exists (
      select 1
      from examination_room_v1.institutions institution
      where institution.institution_code = 'due-diligence-community'
    )
    and exists (
      select 1
      from examination_room_v1.privacy_notice_versions notice
      join examination_room_v1.institutions institution
        on institution.id = notice.institution_id
      where institution.institution_code = 'due-diligence-community'
        and notice.notice_code = 'exam-room-v1'
        and notice.version_number = 1
    ),
    false
  );

  result_email_complete := coalesce(
    to_regclass('examination_room_v1.result_email_delivery_events') is not null
    and to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)') is not null
    and to_regprocedure('public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb)') is not null
    and to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') is not null
    and exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = to_regclass('examination_room_v1.result_email_delivery_events')
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    )
    and coalesce(has_function_privilege(
      'service_role',
      to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)'),
      'EXECUTE'
    ), false)
    and not coalesce(has_function_privilege(
      'anon',
      to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)'),
      'EXECUTE'
    ), true)
    and not coalesce(has_function_privilege(
      'authenticated',
      to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)'),
      'EXECUTE'
    ), true),
    false
  );

  select exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'examination-room-recovery'
      and bucket.name = 'examination-room-recovery'
      and not bucket.public
      and bucket.file_size_limit = 10485760
      and coalesce(bucket.allowed_mime_types, array[]::text[])
        = array['application/vnd.duediligence.examination-room-recovery+json']::text[]
  )
  into storage_recovery_complete;

  if not owner_complete
     or not open_admission_complete
     or not result_email_complete
     or not storage_recovery_complete then
    raise exception using
      errcode = '55000',
      message = 'Examination Room structural postflight failed; transaction will roll back';
  end if;
end;
$examination_room_release_postflight$;

commit;
`;

if (/^\s*\\/mu.test(bundle)) {
  throw new Error('Generated release unexpectedly contains a psql meta-command.');
}
if ((bundle.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (bundle.match(/^\s*commit;\s*$/gimu) || []).length !== 1) {
  throw new Error('Generated release must contain exactly one outer transaction.');
}

await writeFile(outputPath, bundle, 'utf8');

process.stdout.write(`${JSON.stringify({
  output: outputPath,
  bytes: Buffer.byteLength(bundle),
  sha256: sha256(bundle),
  baseline: {
    version: loadedBaseline.version,
    sha256: loadedBaseline.sha256,
  },
  releases: loadedReleases.map(({ version, name, sha256: checksum }) => ({
    version,
    name,
    sha256: checksum,
  })),
}, null, 2)}\n`);
