-- TEST FIXTURE ONLY: exact two definitions from the unapplied Analytics migration
-- 20260907091138_astra_forecast_analytics_scope_exports.sql, normalized-LF SHA256
-- f7aa1b082e45aee729d7f3379afe86cd2611f16d548bef9df97146b9067f411e
-- Not a migration or evidence that Analytics is deployed. Tests supply only a
-- synthetic scope-quota table; all selected email rows use the actual journal.
create function public.dd2026_forecast_email_quota_used(p_actor_user_id uuid)
returns bigint language sql stable security invoker set search_path='' as $$
  select (select count(*) from public.dd2026_forecast_result_exports where owner_id=p_actor_user_id and email_requested_at>statement_timestamp()-interval '24 hours')
    +(select count(*) from public.dd2026_forecast_analytics_exports where owner_id=p_actor_user_id and email_requested_at>statement_timestamp()-interval '24 hours');
$$;

create or replace function public.dd2026_forecast_result_email_claim(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_recipient_email text,p_pdf_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_export public.dd2026_forecast_result_exports%rowtype; v_hash text; v_now timestamptz:=statement_timestamp();
begin
  if not private.dd2026_forecast_verified_owner_email(p_actor_user_id,p_recipient_email) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED','Verify your account email before emailing this report.',409);
  end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_email/'||p_actor_user_id::text,0));
  select * into v_export from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision and owner_id=p_actor_user_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved report can be emailed.',409); end if;
  if v_export.pdf_hash is distinct from p_pdf_hash then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_CONFLICT','The saved PDF fingerprint changed.',409); end if;
  v_hash:=encode(sha256(convert_to(p_recipient_email,'UTF8')),'hex');
  if v_export.recipient_hash is not null and v_export.recipient_hash<>v_hash then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RECIPIENT_CHANGED','This report email was already requested for a different verified address. Download the PDF instead.',409);
  end if;
  if v_export.email_status='provider_accepted' or (v_export.email_status='processing' and v_export.email_lease_expires_at>v_now) then
    return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
  end if;
  if v_export.email_requested_at is not null and (v_export.email_executions>=3 or v_export.email_requested_at<=v_now-interval '23 hours') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RETRY_LIMIT','Email recovery needs support review. The saved PDF is still available.',409);
  end if;
  if v_export.email_retry_at>v_now then return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision)); end if;
  if v_export.email_requested_at is null and public.dd2026_forecast_email_quota_used(p_actor_user_id)>=5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RATE_LIMIT','You can email five saved reports in 24 hours. Download the PDF instead.',429);
  end if;
  update public.dd2026_forecast_result_exports set email_status='processing',recipient_hash=v_hash,
    email_requested_at=coalesce(email_requested_at,v_now),email_executions=email_executions+1,
    email_lease=gen_random_uuid(),email_lease_expires_at=v_now+interval '120 seconds',email_retry_at=null
    where attempt_id=p_attempt_id and result_revision=p_result_revision returning * into v_export;
  return jsonb_build_object('ok',true,'claimed',true,'leaseToken',v_export.email_lease,
    'idempotencyKey','forecast-result/'||p_attempt_id::text||'/r'||p_result_revision::text,
    'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
end;
$$;
