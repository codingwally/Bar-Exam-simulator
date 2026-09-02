-- Repair the Forecast entitlement helper without invoking the mutating access
-- snapshot from a read-only PostgREST RPC.

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
  v_now timestamptz := statement_timestamp();
begin
  if p_actor_user_id is null then
    return false;
  end if;
  if public.dd2026_is_admin(p_actor_user_id) then
    return true;
  end if;

  -- This function is intentionally STABLE. phase4_access_snapshot is
  -- VOLATILE because it may lazily create introductory-token ledger rows;
  -- invoking it here makes PostgREST reject the Forecast status RPC with 405.
  if exists (
    select 1
    from public.free_beta_access beta_access
    where beta_access.user_id = p_actor_user_id
      and beta_access.enabled
      and beta_access.access_program = 'founding_beta_2026'
      and (
        beta_access.expires_at is null
        or beta_access.expires_at > v_now
      )
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.subscriptions subscription_row
    where subscription_row.user_id = p_actor_user_id
      and subscription_row.status = 'active'
      and subscription_row.source in ('manual_payment', 'admin_adjustment', 'migration')
      and subscription_row.starts_at is not null
      and subscription_row.starts_at <= v_now
      and (
        subscription_row.expires_at is null
        or subscription_row.expires_at > v_now
      )
  ) then
    return true;
  end if;

  -- A payment with an active provisional window is unlimited while the owner
  -- reviews the proof. The Worker enforces terms/profile setup before it calls
  -- any Forecast RPC.
  return exists (
    select 1
    from public.payment_requests payment_request
    where payment_request.user_id = p_actor_user_id
      and payment_request.status in ('pending', 'needs_information')
      and payment_request.provisional_access_started_at is not null
      and payment_request.provisional_access_expires_at > v_now
      and payment_request.provisional_access_revoked_at is null
  );
end;
$$;

revoke all on function public.dd2026_bar_forecast_access_allowed(uuid)
  from public, anon, authenticated;
grant execute on function public.dd2026_bar_forecast_access_allowed(uuid)
  to service_role;

comment on function public.dd2026_bar_forecast_access_allowed(uuid)
is 'Worker-only Forecast entitlement boundary: administrators and every current paid, Founding Beta, or provisional unlimited account.';

commit;
