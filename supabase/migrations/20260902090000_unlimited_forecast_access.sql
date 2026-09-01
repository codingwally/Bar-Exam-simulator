-- Keep the Forecast database boundary aligned with the server-authoritative
-- unlimited-access snapshot used by the Worker and the signed-in client.

begin;

create or replace function public.dd2026_bar_forecast_access_allowed(
  p_actor_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
begin
  if p_actor_user_id is null then
    return false;
  end if;
  if public.dd2026_is_admin(p_actor_user_id) then
    return true;
  end if;

  v_access := public.phase4_access_snapshot(p_actor_user_id, false, null);
  return lower(coalesce(v_access ->> 'allowed', 'false')) = 'true'
    and lower(coalesce(v_access ->> 'unlimited', 'false')) = 'true';
end;
$$;

revoke all on function public.dd2026_bar_forecast_access_allowed(uuid)
  from public, anon, authenticated;
grant execute on function public.dd2026_bar_forecast_access_allowed(uuid)
  to service_role;

comment on function public.dd2026_bar_forecast_access_allowed(uuid)
is 'Worker-only Forecast entitlement boundary: administrators and every current server-authoritative allowed plus unlimited account.';

commit;
