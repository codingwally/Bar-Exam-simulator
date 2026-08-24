-- An issuance authorizes restoration only while its question remains
-- unanswered for the same user. This closes the crash window where grading
-- succeeds on the server but stale browser workspace state survives locally.

begin;

create or replace function public.feature_question_restore_authorized_v2(
  p_user_id uuid,
  p_feature_key text,
  p_subject text,
  p_question_id text,
  p_issuance_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select lower(btrim(coalesce(p_feature_key, ''))) = 'bar_question_practice'
    and p_user_id is not null
    and p_issuance_id is not null
    and exists (
      select 1
      from public.feature_question_issuances issuance
      where issuance.id = p_issuance_id
        and issuance.user_id = p_user_id
        and issuance.feature_key = 'bar_question_practice'
        and lower(btrim(issuance.subject)) = lower(btrim(coalesce(p_subject, '')))
        and issuance.question_id = btrim(coalesce(p_question_id, ''))
        and issuance.issued_at <= now()
        and issuance.expires_at >= now()
    )
    and not exists (
      select 1
      from public.exam_attempts attempt
      where attempt.user_id = p_user_id
        and lower(btrim(attempt.subject)) = lower(btrim(coalesce(p_subject, '')))
        and attempt.question_bank_id = btrim(coalesce(p_question_id, ''))
        and nullif(btrim(attempt.answer_text), '') is not null
    );
$$;

revoke all on function public.feature_question_restore_authorized_v2(
  uuid, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.feature_question_restore_authorized_v2(
  uuid, text, text, text, uuid
) to service_role;

commit;
