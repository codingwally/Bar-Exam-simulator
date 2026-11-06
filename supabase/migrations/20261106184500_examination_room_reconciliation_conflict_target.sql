-- Correct a PostgreSQL PL/pgSQL #variable_conflict use_variable trap:
-- ON CONFLICT (session_id) was resolved as a local variable rather than
-- the session_id column and caused error 42P10 during finalization.
-- Preserve the immutable consent checks and use the real named primary key.
begin;
do $hotfix$
declare
  definition text := pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure);
  previous text := 'on conflict (session_id) do nothing;';
  corrected text := 'on conflict on constraint submission_consent_reconciliation_pkey do nothing;';
begin
  if strpos(definition,corrected)>0 then return; end if;
  if strpos(definition,'legacy_camera_consent_normalizer_20261106')=0 or
     strpos(definition,previous)=0 then
    raise exception 'Expected audited legacy recovery block not found; aborting';
  end if;
  execute replace(definition,previous,corrected);
end;
$hotfix$;
commit;
