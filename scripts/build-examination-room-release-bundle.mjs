import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = Object.freeze([
  {
    version: '20260825183055',
    file: '20260825183055_examination_room_v1_greenfield.sql',
    name: 'examination_room_v1_greenfield',
  },
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
  {
    version: '20260827190036',
    file: '20260827190036_examination_room_key_delivery_nullable_creator.sql',
    name: 'examination_room_key_delivery_nullable_creator',
  },
  {
    version: '20260827193000',
    file: '20260827193000_examination_room_lifecycle_controls.sql',
    name: 'examination_room_lifecycle_controls',
  },
  {
    version: '20260828123000',
    file: '20260828123000_examination_room_recorded_media.sql',
    name: 'examination_room_recorded_media',
  },
  {
    version: '20260828124000',
    file: '20260828124000_examination_room_immediate_key_access.sql',
    name: 'examination_room_immediate_key_access',
  },
]);

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(tmpdir(), `due-diligence-examination-room-release-${process.pid}.sql`);
if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const prepared = [];
for (const release of releases) {
  const source = await readFile(path.join(root, 'supabase', 'migrations', release.file), 'utf8');
  if ((source.match(/^\s*begin;\s*$/gimu) || []).length !== 1
      || (source.match(/^\s*commit;\s*$/gimu) || []).length !== 1) {
    throw new Error(`${release.file} must contain exactly one outer BEGIN and COMMIT.`);
  }
  prepared.push({
    ...release,
    sha256: createHash('sha256').update(source).digest('hex'),
    body: source
      .replace(/^\s*begin;\s*$/imu, '')
      .replace(/^\s*commit;\s*$/imu, '')
      .trim(),
  });
}

const [
  greenfield,
  owner,
  openAdmission,
  resultEmail,
  recoveryStorage,
  keyReliability,
  lifecycleControls,
  recordedMedia,
  immediateKeyAccess,
] = prepared;
const ledgerInsert = (release) => `insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${release.version}',
  array['sha256:${release.sha256}'],
  '${release.name}'
);`;

const bundle = `-- Generated only from the nine reviewed Examination Room migrations.
-- psql conditionals safely handle an already-applied or ledger-repair state;
-- no other pending Supabase migration can be selected by this release gate.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

select
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${greenfield.version}'
  ) as examination_room_greenfield_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${greenfield.version}'
      and 'sha256:${greenfield.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_greenfield_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${owner.version}'
  ) as examination_room_owner_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${owner.version}'
      and 'sha256:${owner.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_owner_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${openAdmission.version}'
  ) as examination_room_open_admission_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${openAdmission.version}'
      and 'sha256:${openAdmission.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_open_admission_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${resultEmail.version}'
  ) as examination_room_result_email_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${resultEmail.version}'
      and 'sha256:${resultEmail.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_result_email_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${recoveryStorage.version}'
  ) as examination_room_recovery_storage_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${recoveryStorage.version}'
      and 'sha256:${recoveryStorage.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_recovery_storage_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${keyReliability.version}'
  ) as examination_room_key_reliability_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${keyReliability.version}'
      and name = '${keyReliability.name}'
      and 'sha256:${keyReliability.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_key_reliability_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${lifecycleControls.version}'
  ) as examination_room_lifecycle_controls_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${lifecycleControls.version}'
      and name = '${lifecycleControls.name}'
      and 'sha256:${lifecycleControls.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_lifecycle_controls_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${recordedMedia.version}'
  ) as examination_room_recorded_media_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${recordedMedia.version}'
      and name = '${recordedMedia.name}'
      and 'sha256:${recordedMedia.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_recorded_media_ledger_exact,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${immediateKeyAccess.version}'
  ) as examination_room_immediate_key_access_ledger,
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${immediateKeyAccess.version}'
      and name = '${immediateKeyAccess.name}'
      and 'sha256:${immediateKeyAccess.sha256}' = any(coalesce(statements, array[]::text[]))
  ) as examination_room_immediate_key_access_ledger_exact,
  to_regnamespace('examination_room_v1') is not null as examination_room_greenfield_any,
  coalesce(
    to_regclass('examination_room_v1.institutions') is not null
    and to_regclass('examination_room_v1.exams') is not null
    and to_regclass('examination_room_v1.recovery_snapshots') is not null
    and to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_staff_context(uuid)') is not null,
    false
  ) as examination_room_greenfield_complete,
  coalesce(
    to_regclass('examination_room_v1.owner_key_envelopes') is not null
    or to_regclass('examination_room_v1.owner_identity_corrections') is not null
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.result_releases')
        and attribute.attname = 'batch_request_hash'
        and not attribute.attisdropped
    ),
    false
  ) as examination_room_owner_any,
  coalesce(
    to_regclass('examination_room_v1.owner_key_envelopes') is not null
    and to_regclass('examination_room_v1.owner_identity_corrections') is not null
    and to_regprocedure('public.examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_grading_contexts(uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_import_grades(uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.examination_room_v1_verify_recovery_snapshot(uuid,text)') is not null,
    false
  ) as examination_room_owner_complete,
  coalesce(
    exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exams')
        and attribute.attname = 'admission_mode'
        and not attribute.attisdropped
    )
    or to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') is not null
    or to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') is not null,
    false
  ) as examination_room_open_admission_any,
  coalesce(
    exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exams')
        and attribute.attname = 'admission_mode'
        and not attribute.attisdropped
    )
    and exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exam_versions')
        and attribute.attname = 'admission_mode_snapshot'
        and not attribute.attisdropped
    )
    and to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') is not null
    and to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') is not null,
    false
  ) as examination_room_open_admission_complete,
  coalesce(
    to_regclass('examination_room_v1.result_email_delivery_events') is not null
    or to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)') is not null
    or to_regprocedure('public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb)') is not null,
    false
  ) as examination_room_result_email_any,
  coalesce(
    to_regclass('examination_room_v1.result_email_delivery_events') is not null
    and to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)') is not null
    and to_regprocedure('public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb)') is not null,
    false
  ) as examination_room_result_email_complete,
  coalesce(
    exists (select 1 from storage.buckets where id = 'examination-room-recovery'),
    false
  ) as examination_room_recovery_storage_any,
  coalesce(
    exists (
      select 1
      from storage.buckets
      where id = 'examination-room-recovery'
        and name = 'examination-room-recovery'
        and public is false
        and file_size_limit >= 10485760
        and 'application/vnd.duediligence.examination-room-recovery+json' = any(
          coalesce(allowed_mime_types, array[]::text[])
        )
    ),
    false
  ) as examination_room_recovery_storage_complete,
  coalesce(
    exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.email_delivery_events')
        and attribute.attname = 'professor_recipient'
        and not attribute.attisdropped
        and not attribute.attnotnull
    )
    or exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = to_regclass('examination_room_v1.email_delivery_events')
        and constraint_record.conname = 'email_delivery_events_professor_recipient_check'
        and position(
          'professor_recipient is null'
          in lower(pg_get_constraintdef(constraint_record.oid))
        ) > 0
    )
    or (
      to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)') is not null
      and position(
        'professor_contact_required'
        in lower(pg_get_functiondef(to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')))
      ) = 0
    )
    or position(
      'the prior room-key request is already bound to a different key.'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) > 0
    or position(
      'persisted.professor_recipient is not distinct from excluded.professor_recipient'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)')
      ), ''))
    ) > 0,
    false
  ) as examination_room_key_reliability_any,
  coalesce(
    exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.email_delivery_events')
        and attribute.attname = 'professor_recipient'
        and not attribute.attisdropped
        and not attribute.attnotnull
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = to_regclass('examination_room_v1.email_delivery_events')
        and constraint_record.conname = 'email_delivery_events_professor_recipient_check'
        and constraint_record.convalidated
        and position(
          'professor_recipient is null'
          in lower(pg_get_constraintdef(constraint_record.oid))
        ) > 0
    )
    and position(
      'professor_contact_required'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) = 0
    and position(
      'the prior room-key request is already bound to a different key.'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) > 0
    and position(
      'set key_hash = p_payload ->> ''roomkeyhash'''
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) = 0
    and position(
      'persisted.professor_recipient is not distinct from excluded.professor_recipient'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)')
      ), ''))
    ) > 0,
    false
  ) as examination_room_key_reliability_complete,
  coalesce(
    exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exams')
        and attribute.attname in (
          'blocked_at', 'blocked_by_user_id', 'block_reason',
          'deleted_at', 'deleted_by_user_id', 'delete_reason',
          'lifecycle_prior_status'
        )
        and not attribute.attisdropped
    )
    or to_regprocedure('public.examination_room_v1_lifecycle_query(uuid,uuid,uuid)') is not null
    or to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') is not null
    or to_regprocedure('public.examination_room_v1_lifecycle_command(text,uuid,uuid,uuid,jsonb)') is not null,
    false
  ) as examination_room_lifecycle_controls_any,
  coalesce(
    7 = (
      select count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('examination_room_v1.exams')
        and attribute.attname in (
          'blocked_at', 'blocked_by_user_id', 'block_reason',
          'deleted_at', 'deleted_by_user_id', 'delete_reason',
          'lifecycle_prior_status'
        )
        and not attribute.attisdropped
    )
    and 3 = (
      select count(*)
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = to_regclass('examination_room_v1.exams')
        and constraint_record.conname in (
          'exams_block_state_check',
          'exams_delete_state_check',
          'exams_lifecycle_prior_status_check'
        )
        and constraint_record.convalidated
    )
    and to_regclass('examination_room_v1.exams_owner_active_lifecycle_idx') is not null
    and to_regclass('examination_room_v1.exams_admin_lifecycle_idx') is not null
    and to_regprocedure('public.examination_room_v1_lifecycle_query(uuid,uuid,uuid)') is not null
    and to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') is not null
    and to_regprocedure('public.examination_room_v1_lifecycle_command(text,uuid,uuid,uuid,jsonb)') is not null,
    false
  ) as examination_room_lifecycle_controls_complete,
  coalesce(
    exists (select 1 from storage.buckets where id = 'examination-room-media')
    or to_regclass('examination_room_v1.media_upload_intents') is not null
    or to_regprocedure('public.examination_room_v1_media(text,jsonb)') is not null,
    false
  ) as examination_room_recorded_media_any,
  coalesce(
    exists (
      select 1
      from storage.buckets bucket
      where bucket.id = 'examination-room-media'
        and bucket.name = 'examination-room-media'
        and bucket.public is false
        and bucket.file_size_limit = 67108864
        and coalesce(bucket.allowed_mime_types, array[]::text[])
          = array['application/octet-stream']::text[]
    )
    and to_regclass('examination_room_v1.media_upload_intents') is not null
    and to_regclass('examination_room_v1.media_upload_intents_session_status_idx') is not null
    and to_regclass('examination_room_v1.media_upload_intents_pending_idx') is not null
    and exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = to_regclass('examination_room_v1.media_upload_intents')
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    )
    and 4 = (
      select count(*)
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = to_regclass('examination_room_v1.media_upload_intents')
        and constraint_record.conname in (
          'media_upload_intents_session_artifact_key',
          'media_upload_intents_session_request_key',
          'media_upload_intents_capture_window_check',
          'media_upload_intents_status_check'
        )
        and constraint_record.convalidated
    )
    and 2 = (
      select count(*)
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid = to_regclass('examination_room_v1.media_upload_intents')
        and trigger_record.tgname in (
          'media_upload_intents_touch_updated_at',
          'media_upload_intents_no_delete'
        )
        and not trigger_record.tgisinternal
    )
    and to_regprocedure('public.examination_room_v1_media(text,jsonb)') is not null,
    false
  ) as examination_room_recorded_media_complete,
  coalesce(
    position(
      'activation_expires_at'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) > 0
    or position(
      'public.examination_room_v1_lifecycle_guard(activation_row.exam_id)'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)')
      ), ''))
    ) > 0,
    false
  ) as examination_room_immediate_key_access_any,
  coalesce(
    position(
      'activation_expires_at'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) > 0
    and position(
      '''status'', ''open'''
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) > 0
    and position(
      'p_payload ->> ''opensat'''
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
      ), ''))
    ) = 0
    and position(
      'public.examination_room_v1_lifecycle_guard(activation_row.exam_id)'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)')
      ), ''))
    ) > 0
    and position(
      'activation_row.activation_status not in (''scheduled'', ''open'')'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)')
      ), ''))
    ) > 0
    and position(
      'public.examination_room_v1_lifecycle_guard(exam_id)'
      in lower(coalesce(pg_get_functiondef(
        to_regprocedure('examination_room_v1.api_student(text,jsonb)')
      ), ''))
    ) > 0,
    false
  ) as examination_room_immediate_key_access_complete
\\gset

\\if :examination_room_greenfield_ledger
  \\if :examination_room_greenfield_ledger_exact
    \\if :examination_room_greenfield_complete
      \\echo 'Examination Room greenfield migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact greenfield ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Greenfield migration version exists without this release exact checksum; use a separately reviewed legacy upgrade before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_greenfield_complete
    \\echo 'Unrecorded pre-existing greenfield objects cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_greenfield_any
      \\echo 'Partial Examination Room greenfield state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room greenfield migration.'
      ${greenfield.body}
      ${ledgerInsert(greenfield)}
    \\endif
  \\endif
\\endif

\\if :examination_room_owner_ledger
  \\if :examination_room_owner_ledger_exact
    \\if :examination_room_owner_complete
      \\echo 'Examination Room owner migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact owner ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Owner migration version exists without this release exact checksum; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_owner_complete
    \\echo 'Unrecorded pre-existing owner objects cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_owner_any
      \\echo 'Partial Examination Room owner state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room owner command-center migration.'
      ${owner.body}
      ${ledgerInsert(owner)}
    \\endif
  \\endif
\\endif

\\if :examination_room_open_admission_ledger
  \\if :examination_room_open_admission_ledger_exact
    \\if :examination_room_open_admission_complete
      \\echo 'Examination Room open-admission migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact open-admission ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Open-admission migration version exists without this release exact checksum; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_open_admission_complete
    \\echo 'Unrecorded pre-existing open-admission objects cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_open_admission_any
      \\echo 'Partial Examination Room open-admission state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room open-admission migration.'
      ${openAdmission.body}
      ${ledgerInsert(openAdmission)}
    \\endif
  \\endif
\\endif

\\if :examination_room_result_email_ledger
  \\if :examination_room_result_email_ledger_exact
    \\if :examination_room_result_email_complete
      \\echo 'Examination Room result-email migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact result-email ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Result-email migration version exists without this release exact checksum; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_result_email_complete
    \\echo 'Unrecorded pre-existing result-email objects cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_result_email_any
      \\echo 'Partial Examination Room result-email state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room result-email delivery migration.'
      ${resultEmail.body}
      ${ledgerInsert(resultEmail)}
    \\endif
  \\endif
\\endif

\\if :examination_room_recovery_storage_ledger
  \\if :examination_room_recovery_storage_ledger_exact
    \\if :examination_room_recovery_storage_complete
      \\echo 'Examination Room Supabase Storage recovery migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact recovery-storage ledger checksum exists but the bucket is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Recovery-storage migration version exists without this release exact checksum; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_recovery_storage_complete
    \\echo 'Unrecorded pre-existing recovery storage cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_recovery_storage_any
      \\echo 'Partial Examination Room recovery storage state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Creating the reviewed private Supabase Storage recovery bucket.'
      ${recoveryStorage.body}
      ${ledgerInsert(recoveryStorage)}
    \\endif
  \\endif
\\endif

\\if :examination_room_key_reliability_ledger
  \\if :examination_room_key_reliability_ledger_exact
    \\if :examination_room_key_reliability_complete
      \\echo 'Examination Room key-reliability migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact key-reliability ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Key-reliability migration version exists without this release exact checksum and name; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_key_reliability_complete
    \\echo 'Unrecorded pre-existing key-reliability state cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_key_reliability_any
      \\echo 'Partial Examination Room key-reliability state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room nullable-creator and key-reliability migration.'
      ${keyReliability.body}
      ${ledgerInsert(keyReliability)}
    \\endif
  \\endif
\\endif

\\if :examination_room_lifecycle_controls_ledger
  \\if :examination_room_lifecycle_controls_ledger_exact
    \\if :examination_room_lifecycle_controls_complete
      \\echo 'Examination Room lifecycle-controls migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact lifecycle-controls ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Lifecycle-controls migration version exists without this release exact checksum and name; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_lifecycle_controls_complete
    \\echo 'Unrecorded pre-existing lifecycle-controls state cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_lifecycle_controls_any
      \\echo 'Partial Examination Room lifecycle-controls state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room lifecycle-controls migration.'
      ${lifecycleControls.body}
      ${ledgerInsert(lifecycleControls)}
    \\endif
  \\endif
\\endif

\\if :examination_room_recorded_media_ledger
  \\if :examination_room_recorded_media_ledger_exact
    \\if :examination_room_recorded_media_complete
      \\echo 'Examination Room recorded-media migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact recorded-media ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Recorded-media migration version exists without this release exact checksum and name; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_recorded_media_complete
    \\echo 'Unrecorded pre-existing recorded-media state cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_recorded_media_any
      \\echo 'Partial Examination Room recorded-media state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room recorded-media migration.'
      ${recordedMedia.body}
      ${ledgerInsert(recordedMedia)}
    \\endif
  \\endif
\\endif

\\if :examination_room_immediate_key_access_ledger
  \\if :examination_room_immediate_key_access_ledger_exact
    \\if :examination_room_immediate_key_access_complete
      \\echo 'Examination Room immediate-key-access migration has the exact reviewed checksum and is complete.'
    \\else
      \\echo 'Exact immediate-key-access ledger checksum exists but the database is structurally incomplete; refusing cutover.'
      \\quit 3
    \\endif
  \\else
    \\echo 'Immediate-key-access migration version exists without this release exact checksum and name; use a new additive migration before cutover.'
    \\quit 3
  \\endif
\\else
  \\if :examination_room_immediate_key_access_complete
    \\echo 'Unrecorded pre-existing immediate-key-access state cannot be adopted from existence probes; refusing cutover.'
    \\quit 3
  \\else
    \\if :examination_room_immediate_key_access_any
      \\echo 'Partial Examination Room immediate-key-access state detected; refusing an unsafe reapply.'
      \\quit 3
    \\else
      \\echo 'Applying the reviewed Examination Room immediate-key-access migration.'
      ${immediateKeyAccess.body}
      ${ledgerInsert(immediateKeyAccess)}
    \\endif
  \\endif
\\endif

select coalesce(
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${greenfield.version}'
      and name = '${greenfield.name}'
      and 'sha256:${greenfield.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${owner.version}'
      and name = '${owner.name}'
      and 'sha256:${owner.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${openAdmission.version}'
      and name = '${openAdmission.name}'
      and 'sha256:${openAdmission.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${resultEmail.version}'
      and name = '${resultEmail.name}'
      and 'sha256:${resultEmail.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${recoveryStorage.version}'
      and name = '${recoveryStorage.name}'
      and 'sha256:${recoveryStorage.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${keyReliability.version}'
      and name = '${keyReliability.name}'
      and 'sha256:${keyReliability.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${lifecycleControls.version}'
      and name = '${lifecycleControls.name}'
      and 'sha256:${lifecycleControls.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${recordedMedia.version}'
      and name = '${recordedMedia.name}'
      and 'sha256:${recordedMedia.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${immediateKeyAccess.version}'
      and name = '${immediateKeyAccess.name}'
      and 'sha256:${immediateKeyAccess.sha256}' = any(coalesce(statements, array[]::text[]))
  )
  and to_regclass('examination_room_v1.owner_key_envelopes') is not null
  and to_regclass('examination_room_v1.owner_identity_corrections') is not null
  and exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass('examination_room_v1.exams')
      and attribute.attname = 'admission_mode'
      and not attribute.attisdropped
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass('examination_room_v1.exam_versions')
      and attribute.attname = 'admission_mode_snapshot'
      and not attribute.attisdropped
  )
  and to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.examination_room_v1_grading_contexts(uuid,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.examination_room_v1_import_grades(uuid,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.examination_room_v1_verify_recovery_snapshot(uuid,text)') is not null
  and to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') is not null
  and to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') is not null
  and to_regclass('examination_room_v1.result_email_delivery_events') is not null
  and to_regprocedure('public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer)') is not null
  and to_regprocedure('public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb)') is not null
  and exists (
    select 1
    from storage.buckets
    where id = 'examination-room-recovery'
      and public is false
      and file_size_limit >= 10485760
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass('examination_room_v1.email_delivery_events')
      and attribute.attname = 'professor_recipient'
      and not attribute.attisdropped
      and not attribute.attnotnull
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = to_regclass('examination_room_v1.email_delivery_events')
      and constraint_record.conname = 'email_delivery_events_professor_recipient_check'
      and constraint_record.convalidated
      and position(
        'professor_recipient is null'
        in lower(pg_get_constraintdef(constraint_record.oid))
      ) > 0
  )
  and position(
    'professor_contact_required'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
    ), ''))
  ) = 0
  and position(
    'the prior room-key request is already bound to a different key.'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
    ), ''))
  ) > 0
  and position(
    'persisted.professor_recipient is not distinct from excluded.professor_recipient'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)')
    ), ''))
  ) > 0
  and position(
    'activation_expires_at'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
    ), ''))
  ) > 0
  and position(
    'p_payload ->> ''opensat'''
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)')
    ), ''))
  ) = 0
  and position(
    'public.examination_room_v1_lifecycle_guard(activation_row.exam_id)'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)')
    ), ''))
  ) > 0
  and position(
    'activation_row.activation_status not in (''scheduled'', ''open'')'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)')
    ), ''))
  ) > 0
  and position(
    'public.examination_room_v1_lifecycle_guard(exam_id)'
    in lower(coalesce(pg_get_functiondef(
      to_regprocedure('examination_room_v1.api_student(text,jsonb)')
    ), ''))
  ) > 0
  and 7 = (
    select count(*)
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass('examination_room_v1.exams')
      and attribute.attname in (
        'blocked_at', 'blocked_by_user_id', 'block_reason',
        'deleted_at', 'deleted_by_user_id', 'delete_reason',
        'lifecycle_prior_status'
      )
      and not attribute.attisdropped
  )
  and 3 = (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = to_regclass('examination_room_v1.exams')
      and constraint_record.conname in (
        'exams_block_state_check',
        'exams_delete_state_check',
        'exams_lifecycle_prior_status_check'
      )
      and constraint_record.convalidated
  )
  and to_regclass('examination_room_v1.exams_owner_active_lifecycle_idx') is not null
  and to_regclass('examination_room_v1.exams_admin_lifecycle_idx') is not null
  and to_regprocedure('public.examination_room_v1_lifecycle_query(uuid,uuid,uuid)') is not null
  and to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') is not null
  and to_regprocedure('public.examination_room_v1_lifecycle_command(text,uuid,uuid,uuid,jsonb)') is not null
  and not has_function_privilege(
    'authenticated',
    'public.examination_room_v1_lifecycle_command(text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.examination_room_v1_lifecycle_command(text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'examination-room-media'
      and bucket.name = 'examination-room-media'
      and bucket.public is false
      and bucket.file_size_limit = 67108864
      and coalesce(bucket.allowed_mime_types, array[]::text[])
        = array['application/octet-stream']::text[]
  )
  and to_regclass('examination_room_v1.media_upload_intents') is not null
  and to_regclass('examination_room_v1.media_upload_intents_session_status_idx') is not null
  and to_regclass('examination_room_v1.media_upload_intents_pending_idx') is not null
  and exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = to_regclass('examination_room_v1.media_upload_intents')
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  )
  and 4 = (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = to_regclass('examination_room_v1.media_upload_intents')
      and constraint_record.conname in (
        'media_upload_intents_session_artifact_key',
        'media_upload_intents_session_request_key',
        'media_upload_intents_capture_window_check',
        'media_upload_intents_status_check'
      )
      and constraint_record.convalidated
  )
  and 2 = (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = to_regclass('examination_room_v1.media_upload_intents')
      and trigger_record.tgname in (
        'media_upload_intents_touch_updated_at',
        'media_upload_intents_no_delete'
      )
      and not trigger_record.tgisinternal
  )
  and to_regprocedure('public.examination_room_v1_media(text,jsonb)') is not null
  and not has_function_privilege(
    'anon',
    'public.examination_room_v1_media(text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.examination_room_v1_media(text,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.examination_room_v1_media(text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.examination_room_v1_owner_query(text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  false
) as examination_room_release_ready
\\gset

\\if :examination_room_release_ready
  \\echo 'Exact Examination Room migration order and protected RPC probes passed.'
\\else
  \\echo 'Examination Room post-migration probes failed; rolling back and refusing cutover.'
  \\quit 3
\\endif

commit;
`;

await writeFile(outputPath, bundle, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(bundle),
  sha256: createHash('sha256').update(bundle).digest('hex'),
  releases: prepared.map(({ version, file, name, sha256 }) => ({ version, file, name, sha256 })),
}, null, 2));
