-- Retire active email-marketing preference collection while preserving the
-- historical append-only records for audit. This compatibility tombstone lets
-- a stale cached client finish saving its profile without creating a new
-- consent record. A future marketing program must use a new, purpose-specific
-- consent contract and must not treat historical rows as current permission.

begin;

create or replace function public.record_marketing_consent(
  p_opted_in boolean default false,
  p_consent_version text default '1',
  p_source text default 'web_onboarding'
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Compatibility no-op. Deliberately do not store data or trigger delivery.
  return;
end;
$$;

comment on function public.record_marketing_consent(boolean, text, text) is
  'Retired compatibility no-op. It accepts authenticated legacy calls but never stores marketing consent or triggers delivery.';

revoke all on function public.record_marketing_consent(boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.record_marketing_consent(boolean, text, text)
  to authenticated;

commit;
