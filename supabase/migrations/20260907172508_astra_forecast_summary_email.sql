-- Explicit saved-summary/link email, never a fabricated PDF or automatic send.
-- Extend the same journal: existing PDF mail, quota, leases and provider keys survive.
begin;
alter table public.dd2026_forecast_result_exports
  add column delivery_kind text not null default 'pdf_attachment',
  add column canonical_result_hash text,
  add column email_template_version text,
  add column email_payload_hash text,
  alter column pdf_hash drop not null,
  alter column file_name drop not null,
  alter column byte_count drop not null,
  add constraint dd2026_forecast_export_delivery_kind check (delivery_kind in ('pdf_attachment','summary_link')),
  add constraint dd2026_forecast_export_pdf_metadata check (
    (pdf_hash is not null and file_name is not null and byte_count is not null)
    or (delivery_kind='summary_link' and pdf_hash is null and file_name is null and byte_count is null)),
  add constraint dd2026_forecast_export_summary_metadata check (
    (delivery_kind='pdf_attachment' and canonical_result_hash is null and email_template_version is null and email_payload_hash is null)
    or (delivery_kind='summary_link' and canonical_result_hash is not null and canonical_result_hash ~ '^[0-9a-f]{64}$'
      and email_template_version is not null and email_template_version='forecast-summary-link-v1'
      and email_payload_hash is not null and email_payload_hash ~ '^[0-9a-f]{64}$'));

create or replace function public.dd2026_forecast_result_export_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.attempt_id,new.result_revision,new.owner_id,new.created_at)
    is distinct from (old.attempt_id,old.result_revision,old.owner_id,old.created_at)
    -- A summary may later acquire its first real downloaded PDF fingerprint.
    -- Every previously recorded nonnull fingerprint is still immutable.
    or ((new.pdf_hash,new.file_name,new.byte_count) is distinct from (old.pdf_hash,old.file_name,old.byte_count)
      and not (old.delivery_kind='summary_link' and old.pdf_hash is null and old.file_name is null and old.byte_count is null
        and new.pdf_hash is not null and new.file_name is not null and new.byte_count is not null))
    or (old.recipient_hash is not null and new.recipient_hash is distinct from old.recipient_hash)
    or (old.email_requested_at is not null and new.email_requested_at is distinct from old.email_requested_at)
    or (old.email_status='provider_accepted' and (new.email_status,new.provider_id) is distinct from (old.email_status,old.provider_id)) then
    raise exception 'Saved export and accepted email identity are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;

-- Independent table guard remains effective if the later Analytics migration
-- replaces the legacy claim RPC to share its daily quota. No old Worker has this
-- transaction-local marker. This is service-internal fencing, not browser auth.
create function public.dd2026_forecast_result_summary_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_expected text:=new.owner_id::text||'/'||new.attempt_id::text||'/r'||new.result_revision::text;
begin
  if tg_op='UPDATE' then
    if (old.delivery_kind='summary_link' or old.email_requested_at is not null)
      and (new.delivery_kind,new.canonical_result_hash,new.email_template_version,new.email_payload_hash)
        is distinct from (old.delivery_kind,old.canonical_result_hash,old.email_template_version,old.email_payload_hash) then
      raise exception 'Saved email format and canonical payload are immutable' using errcode='23514';
    end if;
  end if;
  if new.delivery_kind='summary_link' and (
    tg_op='INSERT' or old.delivery_kind is distinct from new.delivery_kind
    or (new.email_status='processing' and new.email_lease is distinct from old.email_lease))
    and current_setting('astra.forecast_summary_claim',true) is distinct from v_expected then
    raise exception 'Summary email requires its exact atomic claim' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger dd2026_forecast_result_summary_guard before insert or update on public.dd2026_forecast_result_exports
for each row execute function public.dd2026_forecast_result_summary_guard();

-- Patch only exact known anchors, retaining whichever existing quota engine is
-- installed. This preserves both the original and later Analytics shared quota.
do $patch_existing$
declare v_definition text; v_anchor text; v_replacement text;
begin
  v_definition:=replace(pg_get_functiondef('public.dd2026_forecast_result_email_claim(uuid,uuid,integer,text,text)'::regprocedure),chr(13),'');
  v_anchor:='  if v_export.pdf_hash is distinct from p_pdf_hash then';
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
    raise exception 'Unknown saved-email claim definition; review required';
  end if;
  v_replacement:=$guard$  if v_export.delivery_kind='summary_link'
    and current_setting('astra.forecast_summary_claim',true) is distinct from
      (p_actor_user_id::text||'/'||p_attempt_id::text||'/r'||p_result_revision::text) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_FORMAT_CONFLICT','This report uses summary email. Reload before retrying.',409);
  end if;
$guard$||v_anchor;
  execute replace(v_definition,v_anchor,v_replacement);

  v_definition:=replace(pg_get_functiondef('public.dd2026_forecast_result_pdf_record(uuid,uuid,integer,text,text,integer,boolean)'::regprocedure),chr(13),'');
  v_anchor:='  if (v_export.pdf_hash,v_export.file_name,v_export.byte_count) is distinct from (p_pdf_hash,p_file_name,p_byte_count) then';
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
    raise exception 'Unknown saved-PDF record definition; review required';
  end if;
  v_replacement:=$fill$  if v_export.delivery_kind='summary_link' and v_export.pdf_hash is null and v_export.file_name is null and v_export.byte_count is null then
    update public.dd2026_forecast_result_exports set pdf_hash=p_pdf_hash,file_name=p_file_name,byte_count=p_byte_count
      where attempt_id=p_attempt_id and result_revision=p_result_revision returning * into v_export;
  end if;
$fill$||v_anchor;
  execute replace(v_definition,v_anchor,v_replacement);
end;
$patch_existing$;

create function public.dd2026_forecast_result_summary_email_claim(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,
  p_recipient_email text,p_result jsonb,p_completed_at timestamptz,p_template_version text,p_payload_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_attempt public.dd2026_forecast_attempts%rowtype; v_export public.dd2026_forecast_result_exports%rowtype;
  v_result_hash text; v_recipient_hash text; v_claim jsonb; v_prior_marker text;
begin
  if not private.dd2026_forecast_verified_owner_email(p_actor_user_id,p_recipient_email) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED','Verify your account email before emailing this report.',409);
  end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403);
  end if;
  if p_template_version is distinct from 'forecast-summary-link-v1' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_INVALID','The saved summary metadata is invalid.',400);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_email/'||p_actor_user_id::text,0));
  select * into v_attempt from public.dd2026_forecast_attempts where id=p_attempt_id and owner_id=p_actor_user_id
    and status='complete' and result_revision=p_result_revision;
  if not found or p_result_revision is distinct from 1 or v_attempt.result is null or v_attempt.result->>'complete' is distinct from 'true'
    or v_attempt.result is distinct from p_result or v_attempt.completed_at is distinct from p_completed_at then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your exact complete saved Forecast can be emailed.',409);
  end if;
  v_result_hash:=encode(sha256(convert_to(v_attempt.result::text,'UTF8')),'hex');
  v_recipient_hash:=encode(sha256(convert_to(p_recipient_email,'UTF8')),'hex');
  select * into v_export from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision for update;
  if found then
    if v_export.owner_id is distinct from p_actor_user_id then
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved report can be emailed.',409);
    end if;
    if v_export.recipient_hash is not null and v_export.recipient_hash<>v_recipient_hash then
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RECIPIENT_CHANGED','This report email was already requested for a different verified address. Download the PDF instead.',409);
    end if;
    -- Never replace a prior attachment body/key, including an unknown outcome.
    if v_export.delivery_kind='pdf_attachment' and v_export.email_requested_at is not null then
      if v_export.email_status='provider_accepted' or (v_export.email_status='processing' and v_export.email_lease_expires_at>statement_timestamp()) then
        return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
      end if;
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_FORMAT_CONFLICT','An earlier PDF email needs recovery without changing its message. Your saved report remains available.',409);
    end if;
    if v_export.delivery_kind='summary_link' and (v_export.canonical_result_hash,v_export.email_template_version,v_export.email_payload_hash)
      is distinct from (v_result_hash,p_template_version,p_payload_hash) then
      return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_FORMAT_CONFLICT','The existing email has a different saved summary. No replacement email was sent.',409);
    end if;
  end if;
  v_prior_marker:=current_setting('astra.forecast_summary_claim',true);
  perform set_config('astra.forecast_summary_claim',p_actor_user_id::text||'/'||p_attempt_id::text||'/r'||p_result_revision::text,true);
  insert into public.dd2026_forecast_result_exports(attempt_id,result_revision,owner_id,delivery_kind,canonical_result_hash,email_template_version,email_payload_hash)
    values(p_attempt_id,p_result_revision,p_actor_user_id,'summary_link',v_result_hash,p_template_version,p_payload_hash) on conflict do nothing;
  update public.dd2026_forecast_result_exports set delivery_kind='summary_link',canonical_result_hash=v_result_hash,
    email_template_version=p_template_version,email_payload_hash=p_payload_hash
    where attempt_id=p_attempt_id and result_revision=p_result_revision returning * into v_export;
  -- Reuse current claim/quota/fencing, including N11's future shared quota.
  v_claim:=public.dd2026_forecast_result_email_claim(p_actor_user_id,p_attempt_id,p_result_revision,p_recipient_email,v_export.pdf_hash);
  perform set_config('astra.forecast_summary_claim',coalesce(v_prior_marker,''),true);
  return v_claim;
end;
$$;
revoke all on function public.dd2026_forecast_result_summary_guard() from public,anon,authenticated;
grant execute on function public.dd2026_forecast_result_summary_guard() to service_role;
revoke all on function public.dd2026_forecast_result_summary_email_claim(uuid,uuid,integer,text,jsonb,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.dd2026_forecast_result_summary_email_claim(uuid,uuid,integer,text,jsonb,timestamptz,text,text) to service_role;
commit;
