-- Repair the UTF-8 em dash that was previously decoded as Windows-1252
-- while preserving every Subject Matter subject, question, and relationship.
-- Keep this migration ASCII-only so the repair cannot be corrupted in transit.

begin;

do $repair_sync_function$
declare
  v_function regprocedure := to_regprocedure(
    'public.release_sync_subject_matter_v2(uuid,jsonb,text,text,jsonb,text)'
  );
  v_definition text;
  v_bad_dash constant text := convert_from(
    decode('c3a2e282ace2809d', 'hex'),
    'UTF8'
  );
  v_good_dash constant text := U&'\2014';
begin
  if v_function is null then
    raise exception 'SUBJECT_MATTER_SYNC_FUNCTION_NOT_FOUND';
  end if;

  select pg_get_functiondef(v_function::oid)
  into strict v_definition;

  if position(v_bad_dash in v_definition) > 0 then
    execute replace(v_definition, v_bad_dash, v_good_dash);
  elsif position(v_good_dash in v_definition) = 0 then
    raise exception 'SUBJECT_MATTER_TITLE_SEPARATOR_NOT_RECOGNIZED';
  end if;

  select pg_get_functiondef(v_function::oid)
  into strict v_definition;

  if position(v_bad_dash in v_definition) > 0
    or position(v_good_dash in v_definition) = 0
  then
    raise exception 'SUBJECT_MATTER_SYNC_FUNCTION_REPAIR_FAILED';
  end if;
end;
$repair_sync_function$;

update public.examination_definitions
set
  title = subject || U&' \2014 Subject Matter Practice',
  updated_at = clock_timestamp()
where track = 'per_subject'
  and title = subject || ' '
    || convert_from(decode('c3a2e282ace2809d', 'hex'), 'UTF8')
    || ' Subject Matter Practice';

do $verify_title_repair$
begin
  if exists (
    select 1
    from public.examination_definitions
    where track = 'per_subject'
      and title like '%'
        || convert_from(decode('c3a2e282ace2809d', 'hex'), 'UTF8')
        || '%'
  ) then
    raise exception 'SUBJECT_MATTER_TITLE_REPAIR_INCOMPLETE';
  end if;
end;
$verify_title_repair$;

commit;
