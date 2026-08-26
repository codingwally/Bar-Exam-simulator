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

const [greenfield, owner, openAdmission, resultEmail] = prepared;
const ledgerInsert = (release) => `insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${release.version}',
  array['sha256:${release.sha256}'],
  '${release.name}'
);`;

const bundle = `-- Generated only from the four reviewed Examination Room migrations.
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
  ) as examination_room_result_email_complete
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

select coalesce(
  exists (select 1 from supabase_migrations.schema_migrations where version = '${greenfield.version}')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '${owner.version}')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '${openAdmission.version}')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '${resultEmail.version}')
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
  releases: prepared.map(({ version, file, sha256 }) => ({ version, file, sha256 })),
}, null, 2));
