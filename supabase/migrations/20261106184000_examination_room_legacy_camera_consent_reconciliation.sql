-- Narrow, audited compatibility for already-preserved submissions created by
-- the 2026-11-06 standard/focus-tier camera consent normalizer bug.
-- New submissions retain the original strict immutable-consent comparison.
begin;

create table if not exists examination_room_v1.submission_consent_reconciliation (
  session_id uuid primary key references examination_room_v1.student_sessions(id),
  original_manifest_hash text not null check (original_manifest_hash ~ '^[0-9a-f]{64}$'),
  reason text not null default 'legacy_camera_consent_normalizer_20261106',
  recorded_at timestamptz not null default clock_timestamp()
);

alter table examination_room_v1.submission_consent_reconciliation enable row level security;
alter table examination_room_v1.submission_consent_reconciliation force row level security;
revoke all on examination_room_v1.submission_consent_reconciliation from public, anon, authenticated;

do $hotfix$
declare
  definition text := pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure);
  start_marker text := E'    if submission_manifest -> ''privacyConsent'' is distinct from jsonb_build_object(';
  next_marker text := E'    if not exists (\n      select 1\n      from examination_room_v1.privacy_acceptances pa';
  start_at integer;
  relative_end integer;
  old_block text;
  replacement text;
begin
  if position('legacy_camera_consent_normalizer_20261106' in definition) > 0 then
    return;
  end if;
  start_at := strpos(definition, start_marker);
  if start_at < 1 then raise exception 'Original immutable consent comparison not found'; end if;
  relative_end := strpos(substr(definition, start_at), next_marker);
  if relative_end < 1 then raise exception 'Original consent comparison boundary not found'; end if;
  old_block := substr(definition, start_at, relative_end - 1);
  if position('SUBMISSION_CONSENT_MISMATCH' in old_block) < 1 then
    raise exception 'Unexpected consent comparison; refusing mutation';
  end if;

  replacement := $before$
    -- One-time compatibility: a camera-enabled standard/focus-tier intake
    -- created before the fix may contain the client-normalized false flag,
    -- even though the immutable server acceptance has true. All other
    -- consent fields must match byte-for-byte by JSONB comparison.
    if not (
      coalesce((accepted_features ->> 'recordingAccepted')::boolean, false)
      and (coalesce((accepted_features ->> 'cameraRequired')::boolean, false)
        or coalesce((accepted_features ->> 'microphoneRequired')::boolean, false))
      and coalesce(accepted_features ->> 'integrityTier', '') <> 'recorded_proctoring'
      and coalesce((submission_manifest #>> '{privacyConsent,recordingAccepted}')::boolean, false) = false
      and (submission_manifest -> 'privacyConsent') - 'recordingAccepted' =
        jsonb_build_object(
          'noticeVersion', notice_code,
          'accepted', true,
          'acceptedAt', to_char(accepted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      and exists (
        select 1 from examination_room_v1.submission_intake i
        where i.session_id = session_id
          and i.official_result is null
          and i.last_error_code = 'SUBMISSION_CONSENT_MISMATCH'
          and i.accepted_at < '2026-11-06T10:15:00Z'::timestamptz
      )
    ) then
$before$ || old_block || $after$
    else
      insert into examination_room_v1.submission_consent_reconciliation(
        session_id, original_manifest_hash, reason
      ) values (
        session_id, p_payload ->> 'manifestHash', 'legacy_camera_consent_normalizer_20261106'
      ) on conflict (session_id) do nothing;
    end if;

$after$;

  execute substr(definition, 1, start_at - 1) || replacement ||
    substr(definition, start_at + relative_end - 1);
end;
$hotfix$;
commit;
