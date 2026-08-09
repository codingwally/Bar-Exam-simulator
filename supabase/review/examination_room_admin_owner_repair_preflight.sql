-- Examination Room administrator-owner repair production preflight.
-- READ-ONLY / FAIL-FAST. A passing result is not permission to migrate.

begin transaction read only;
set local search_path = public, extensions, pg_temp;

do $exam_room_repair_preflight$
declare
  v_owner_fk text;
begin
  if to_regclass('public.exam_room_professors') is null
    or to_regclass('public.exam_room_classrooms') is null
    or to_regclass('public.exam_room_exams') is null
    or to_regclass('public.exam_room_audit_log') is null
  then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_MISSING_FOUNDATION'; end if;

  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260811003000'
       or name = 'examination_room_admin_owner_repair'
  ) then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_ALREADY_APPLIED'; end if;

  if (
    select count(*) from supabase_migrations.schema_migrations
    where version in (
      '20260811002500', '20260811002600', '20260811002700',
      '20260811002800', '20260811002900'
    )
  ) <> 5 then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_RELEASE_LEDGER_DRIFT'; end if;

  select pg_get_constraintdef(oid)
  into v_owner_fk
  from pg_constraint
  where conrelid = 'public.exam_room_classrooms'::regclass
    and conname = 'exam_room_classrooms_owner_professor_id_fkey';

  if v_owner_fk is distinct from
    'FOREIGN KEY (owner_professor_id) REFERENCES exam_room_professors(user_id) ON DELETE RESTRICT'
  then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_OWNER_FK_DRIFT: %', v_owner_fk; end if;

  if to_regprocedure('public.exam_room_create_classroom(uuid,text,text,text)') is null
    or to_regprocedure('public.exam_room_create_exam(uuid,uuid,text,text,integer,text,boolean)') is null
  then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_RPC_SIGNATURE_DRIFT'; end if;

  if exists (
    select 1
    from information_schema.role_routine_grants
    where specific_schema = 'public'
      and routine_name = 'exam_room_create_classroom'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  ) then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_BROWSER_RPC_GRANT'; end if;

  if (select count(*) from public.exam_room_classrooms) <> 0
    or (select count(*) from public.exam_room_exams) <> 0
    or (select count(*) from public.exam_room_attempts) <> 0
    or (select count(*) from public.exam_room_answers) <> 0
    or (select count(*) from public.exam_room_grades) <> 0
  then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_UNEXPECTED_LIVE_DATA'; end if;

  if exists (
    select 1 from public.exam_room_classrooms
    where title like 'DDER-20260809-%'
  ) then raise exception 'EXAM_ROOM_REPAIR_PREFLIGHT_SYNTHETIC_RESIDUE'; end if;
end
$exam_room_repair_preflight$;

select jsonb_build_object(
  'status', 'EXAM_ROOM_REPAIR_PREFLIGHT_PASSED_READ_ONLY',
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'super_admins', (select count(*) from public.user_roles where role = 'super_admin'),
  'professors', (select count(*) from public.exam_room_professors),
  'classrooms', (select count(*) from public.exam_room_classrooms),
  'exams', (select count(*) from public.exam_room_exams),
  'roster', (select count(*) from public.exam_room_roster),
  'attempts', (select count(*) from public.exam_room_attempts),
  'answers', (select count(*) from public.exam_room_answers),
  'grades', (select count(*) from public.exam_room_grades),
  'audit_rows', (select count(*) from public.exam_room_audit_log),
  'command_receipts', (select count(*) from public.exam_room_command_receipts)
) as repair_preflight;

rollback;
