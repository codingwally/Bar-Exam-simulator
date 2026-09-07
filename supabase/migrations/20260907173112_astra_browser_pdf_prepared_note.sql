-- Client-reported browser preparation only; never server PDF/storage/download proof.
-- Existing saved answers, canonical results, export journals and email state stay unchanged.
begin;

create unique index dd2026_forecast_browser_pdf_prepared_once
on public.dd2026_forecast_attempt_events(attempt_id, (details->>'resultRevision'))
where event_type='browser_pdf_prepared_client_reported';

create function public.dd2026_forecast_browser_pdf_prepared(
  p_actor_user_id uuid, p_attempt_id uuid, p_result_revision integer,
  p_pdf_version text, p_byte_count integer default null, p_page_count integer default null
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_attempt public.dd2026_forecast_attempts%rowtype;
  v_event public.dd2026_forecast_attempt_events%rowtype;
  v_inserted integer;
begin
  select * into v_attempt from public.dd2026_forecast_attempts
    where id=p_attempt_id and owner_id=p_actor_user_id for key share;
  if not found then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ATTEMPT_NOT_FOUND','That saved Forecast is unavailable.',404);
  end if;
  if public.dd2026_bar_forecast_access_allowed(p_actor_user_id) is distinct from true then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403);
  end if;
  if not exists(select 1 from public.dd2026_bar_forecast_consents
      where user_id=p_actor_user_id and consent_version='2026-09-01') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_CONSENT_REQUIRED','Accept the current Forecast consent before continuing.',409);
  end if;
  if p_result_revision is distinct from 1 or p_pdf_version is distinct from 'forecast-pdf-v1'
      or (p_byte_count is not null and p_byte_count not between 1 and 10485760)
      or (p_page_count is not null and p_page_count not between 1 and 1000) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_PREPARED_NOTE_INVALID','The client-reported PDF preparation metadata is invalid.',400);
  end if;
  -- Complete results are immutable and written by the existing checkpoint-bound
  -- finalizer. Recheck that exact canonical identity, not browser-supplied content.
  if v_attempt.status is distinct from 'complete' or v_attempt.result_revision is distinct from p_result_revision
      or v_attempt.completed_at is null
      or v_attempt.result->>'schemaVersion' is distinct from 'forecast-attempt-v1'
      or v_attempt.result->'complete' is distinct from 'true'::jsonb
      or v_attempt.result->>'attemptId' is distinct from p_attempt_id::text
      or v_attempt.result->>'ownerId' is distinct from p_actor_user_id::text
      or v_attempt.result->'resultRevision' is distinct from to_jsonb(p_result_revision)
      or v_attempt.result->>'setId' is distinct from v_attempt.set_id
      or v_attempt.result->>'subject' is distinct from v_attempt.subject
      or v_attempt.result->'questionCount' is distinct from '20'::jsonb
      or v_attempt.result->'completedQuestionCount' is distinct from '20'::jsonb
      or jsonb_typeof(v_attempt.result->'results') is distinct from 'array' then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved Forecast can be recorded.',409);
  end if;
  if jsonb_array_length(v_attempt.result->'results')<>20
      or (select count(*) from public.dd2026_forecast_batches where attempt_id=p_attempt_id and status='complete')<>5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved Forecast can be recorded.',409);
  end if;
  insert into public.dd2026_forecast_attempt_events(attempt_id,event_type,details)
    values(p_attempt_id,'browser_pdf_prepared_client_reported',jsonb_build_object(
      'evidence','client_reported','serverVerifiedPdf',false,'resultRevision',p_result_revision,
      'pdfVersion',p_pdf_version,'byteCount',p_byte_count,'pageCount',p_page_count))
    on conflict (attempt_id,(details->>'resultRevision'))
      where event_type='browser_pdf_prepared_client_reported' do nothing;
  get diagnostics v_inserted=row_count;
  select * into strict v_event from public.dd2026_forecast_attempt_events
    where attempt_id=p_attempt_id and event_type='browser_pdf_prepared_client_reported'
      and details->>'resultRevision'=p_result_revision::text;
  return jsonb_build_object('ok',true,'preparedNote',v_event.details||jsonb_build_object(
    'attemptId',p_attempt_id,'recordedAt',v_event.happened_at,'replayed',v_inserted=0));
end;
$$;
revoke all on function public.dd2026_forecast_browser_pdf_prepared(uuid,uuid,integer,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.dd2026_forecast_browser_pdf_prepared(uuid,uuid,integer,text,integer,integer)
  to service_role;
commit;
