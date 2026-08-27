begin;

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage must be installed before recorded-media support';
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'examination-room-media',
  'examination-room-media',
  false,
  67108864,
  array['application/octet-stream']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table examination_room_v1.media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references examination_room_v1.student_sessions(id) on delete restrict,
  client_artifact_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  artifact_kind text not null check (
    artifact_kind in ('camera_chunk', 'microphone_chunk', 'screen_chunk', 'still_image')
  ),
  source_mime_type text not null check (length(btrim(source_mime_type)) between 3 and 160),
  encrypted_size_bytes bigint not null check (encrypted_size_bytes between 1 and 67108864),
  object_sha256 text not null check (object_sha256 ~ '^[0-9a-f]{64}$'),
  captured_from timestamptz not null,
  captured_to timestamptz not null,
  retention_until timestamptz not null,
  provider text not null check (provider in ('google_drive', 'supabase_storage', 'local_queue')),
  provider_object_reference text not null check (
    length(btrim(provider_object_reference)) between 8 and 1024
    and provider_object_reference !~* '(token|secret|authorization|credential|password)='
    and provider_object_reference !~* '^https?://'
  ),
  wrapped_key_algorithm text not null check (wrapped_key_algorithm = 'aes-256-gcm-v1'),
  wrapped_key_version smallint not null check (wrapped_key_version = 1),
  wrapped_key_ciphertext text not null check (
    length(wrapped_key_ciphertext) between 43 and 128
    and wrapped_key_ciphertext ~ '^[A-Za-z0-9_-]+$'
  ),
  wrapped_key_iv text not null check (
    length(wrapped_key_iv) between 16 and 32
    and wrapped_key_iv ~ '^[A-Za-z0-9_-]+$'
  ),
  wrapped_key_aad_sha256 text not null check (wrapped_key_aad_sha256 ~ '^[0-9a-f]{64}$'),
  intent_status text not null default 'prepared' check (
    intent_status in ('prepared', 'local_queue', 'completed')
  ),
  completion_request_hash text check (
    completion_request_hash is null or completion_request_hash ~ '^[0-9a-f]{64}$'
  ),
  provider_result jsonb not null default '{}'::jsonb check (
    jsonb_typeof(provider_result) = 'object'
    and provider_result::text !~* '"(url|token|secret|authorization|credential|password|accessToken|refreshToken|signedUrl)"[[:space:]]*:'
  ),
  artifact_id uuid references examination_room_v1.proctoring_artifacts(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_upload_intents_session_artifact_key unique (session_id, client_artifact_id),
  constraint media_upload_intents_session_request_key unique (session_id, request_hash),
  constraint media_upload_intents_capture_window_check check (
    captured_to >= captured_from
    and captured_to <= captured_from + interval '15 minutes'
    and retention_until > captured_to
  ),
  constraint media_upload_intents_status_check check (
    (intent_status = 'completed' and artifact_id is not null and completion_request_hash is not null and completed_at is not null)
    or (intent_status <> 'completed' and artifact_id is null and completed_at is null)
  )
);

comment on table examination_room_v1.media_upload_intents is
  'Service-only metadata for direct browser uploads. No media bytes, raw session token, raw derived key, OAuth credential, signed URL, or storage authorization token is persisted.';

comment on column examination_room_v1.media_upload_intents.wrapped_key_ciphertext is
  'A 32-byte per-artifact derived key wrapped with EXAMINATION_ROOM_MEDIA_MASTER_KEY_V1 using AES-256-GCM. The plaintext key is never persisted.';

create index media_upload_intents_session_status_idx
  on examination_room_v1.media_upload_intents (session_id, intent_status, prepared_at desc);

create index media_upload_intents_pending_idx
  on examination_room_v1.media_upload_intents (intent_status, updated_at)
  where intent_status in ('prepared', 'local_queue');

alter table examination_room_v1.media_upload_intents enable row level security;
alter table examination_room_v1.media_upload_intents force row level security;

revoke all on examination_room_v1.media_upload_intents from public, anon, authenticated, service_role;

create trigger media_upload_intents_touch_updated_at
before update on examination_room_v1.media_upload_intents
for each row execute function examination_room_v1.touch_updated_at();

create trigger media_upload_intents_no_delete
before delete on examination_room_v1.media_upload_intents
for each row execute function examination_room_v1.prevent_delete();

create function public.examination_room_v1_media(
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  session_id uuid;
  session_token_hash text;
  client_artifact_id uuid;
  request_hash text;
  institution_id uuid;
  exam_id uuid;
  session_status text;
  artifact_kind text;
  source_mime_type text;
  encrypted_size_bytes bigint;
  object_sha256 text;
  captured_from timestamptz;
  captured_to timestamptz;
  retention_until timestamptz;
  requested_provider text;
  requested_object_reference text;
  key_envelope jsonb;
  safe_provider_result jsonb;
  requested_completed_at timestamptz;
  existing examination_room_v1.media_upload_intents%rowtype;
  intent_id uuid;
  registered_artifact_id uuid;
  audit_request_hash text;
  response jsonb;
begin
  if coalesce(p_operation, '') not in ('reserve', 'complete')
     or jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'MEDIA_REQUEST_INVALID',
      'The recording control request is invalid.',
      400,
      'Keep the encrypted recording on this device, refresh the examination, and retry the upload.'
    );
  end if;

  if safe_payload ?| array[
    'sessionToken', 'derivedKey', 'rawKey', 'masterKey', 'authorization',
    'accessToken', 'refreshToken', 'clientSecret', 'signedUrl', 'uploadUrl'
  ] then
    return examination_room_v1.api_error(
      'MEDIA_RAW_SECRET_REJECTED',
      'Raw recording or provider credentials cannot be persisted.',
      400,
      'Keep the encrypted recording on this device and request a fresh upload destination.'
    );
  end if;

  if p_operation = 'reserve'
     and safe_payload - array[
       'sessionId', 'sessionTokenHash', 'clientArtifactId', 'requestHash',
       'artifactKind', 'sourceMimeType', 'encryptedSizeBytes', 'objectSha256',
       'capturedFrom', 'capturedTo', 'retentionUntil', 'provider',
       'providerObjectReference', 'keyEnvelope'
     ] <> '{}'::jsonb then
    return examination_room_v1.api_error(
      'MEDIA_REQUEST_INVALID',
      'The recording preparation request contains unsupported fields.',
      400,
      'Keep the encrypted recording on this device, refresh the examination, and retry.'
    );
  end if;

  if p_operation = 'complete'
     and safe_payload - array[
       'sessionId', 'sessionTokenHash', 'clientArtifactId', 'requestHash',
       'provider', 'providerObjectReference', 'objectSha256',
       'encryptedSizeBytes', 'providerVerified', 'providerResult', 'completedAt'
     ] <> '{}'::jsonb then
    return examination_room_v1.api_error(
      'MEDIA_REQUEST_INVALID',
      'The recording completion request contains unsupported fields.',
      400,
      'Keep the encrypted recording on this device, refresh the examination, and retry.'
    );
  end if;

  if coalesce(safe_payload ->> 'sessionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(safe_payload ->> 'clientArtifactId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(safe_payload ->> 'sessionTokenHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(safe_payload ->> 'requestHash', '') !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'SESSION_INVALID',
      'The examination session could not be verified.',
      401,
      'Return to the examination with the same session. Encrypted recordings remain queued on this device.'
    );
  end if;

  session_id := (safe_payload ->> 'sessionId')::uuid;
  client_artifact_id := (safe_payload ->> 'clientArtifactId')::uuid;
  session_token_hash := safe_payload ->> 'sessionTokenHash';
  request_hash := safe_payload ->> 'requestHash';

  select s.institution_id, s.exam_id, s.session_status
  into institution_id, exam_id, session_status
  from examination_room_v1.student_sessions s
  where s.id = session_id
    and s.session_token_hash = session_token_hash
  for update;

  if institution_id is null then
    return examination_room_v1.api_error(
      'SESSION_INVALID',
      'The examination session could not be verified.',
      401,
      'Return to the examination with the same session. Encrypted recordings remain queued on this device.'
    );
  end if;

  if session_status = 'revoked' then
    return examination_room_v1.api_error(
      'SESSION_REVOKED',
      'This examination session has been revoked.',
      401,
      'Keep the encrypted recording on this device and ask the examination administrator to review the session.'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('examination-room-v1:media:' || session_id::text || ':' || client_artifact_id::text, 20260828)
  );

  if p_operation = 'reserve' then
    artifact_kind := safe_payload ->> 'artifactKind';
    source_mime_type := btrim(safe_payload ->> 'sourceMimeType');
    object_sha256 := safe_payload ->> 'objectSha256';
    requested_provider := safe_payload ->> 'provider';
    requested_object_reference := btrim(safe_payload ->> 'providerObjectReference');
    key_envelope := safe_payload -> 'keyEnvelope';

    if coalesce(artifact_kind, '') not in ('camera_chunk', 'microphone_chunk', 'screen_chunk', 'still_image')
       or coalesce(length(source_mime_type), 0) not between 3 and 160
       or coalesce(object_sha256, '') !~ '^[0-9a-f]{64}$'
       or coalesce(requested_provider, '') not in ('google_drive', 'supabase_storage', 'local_queue')
       or coalesce(length(requested_object_reference), 0) not between 8 and 1024
       or requested_object_reference ~* '(token|secret|authorization|credential|password)='
       or requested_object_reference ~* '^https?://'
       or jsonb_typeof(key_envelope) <> 'object'
       or key_envelope - array['algorithm', 'keyVersion', 'ciphertext', 'iv', 'aadSha256', 'keyReference'] <> '{}'::jsonb
       or key_envelope ->> 'algorithm' <> 'aes-256-gcm-v1'
       or key_envelope ->> 'keyVersion' <> '1'
       or coalesce(key_envelope ->> 'ciphertext', '') !~ '^[A-Za-z0-9_-]{43,128}$'
       or coalesce(key_envelope ->> 'iv', '') !~ '^[A-Za-z0-9_-]{16,32}$'
       or coalesce(key_envelope ->> 'aadSha256', '') !~ '^[0-9a-f]{64}$' then
      return examination_room_v1.api_error(
        'MEDIA_METADATA_INVALID',
        'The encrypted recording metadata is invalid.',
        400,
        'Keep the encrypted recording on this device and create a new upload request.'
      );
    end if;

    begin
      encrypted_size_bytes := (safe_payload ->> 'encryptedSizeBytes')::bigint;
      captured_from := (safe_payload ->> 'capturedFrom')::timestamptz;
      captured_to := (safe_payload ->> 'capturedTo')::timestamptz;
      retention_until := (safe_payload ->> 'retentionUntil')::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
        return examination_room_v1.api_error(
          'MEDIA_METADATA_INVALID',
          'The encrypted recording metadata is invalid.',
          400,
          'Keep the encrypted recording on this device and create a new upload request.'
        );
    end;

    if encrypted_size_bytes not between 1 and 67108864
       or captured_to < captured_from
       or captured_to > captured_from + interval '15 minutes'
       or retention_until <= captured_to then
      return examination_room_v1.api_error(
        'MEDIA_METADATA_INVALID',
        'The encrypted recording size or capture window is invalid.',
        400,
        'Keep the recording on this device and retry with a segment no larger than 64 MB or 15 minutes.'
      );
    end if;

    select i.*
    into existing
    from examination_room_v1.media_upload_intents i
    where i.session_id = session_id
      and i.client_artifact_id = client_artifact_id
    for update;

    if existing.id is not null then
      if existing.artifact_kind <> artifact_kind
         or existing.source_mime_type <> source_mime_type
         or existing.encrypted_size_bytes <> encrypted_size_bytes
         or existing.object_sha256 <> object_sha256
         or existing.captured_from <> captured_from
         or existing.captured_to <> captured_to
         or existing.retention_until <> retention_until then
        return examination_room_v1.api_error(
          'MEDIA_IDEMPOTENCY_CONFLICT',
          'That recording identifier is already bound to different encrypted media.',
          409,
          'Keep both encrypted segments on this device and retry the newer segment with a new recording identifier.'
        );
      end if;

      if existing.intent_status = 'completed' then
        return jsonb_build_object(
          'ok', true,
          'intentId', existing.id,
          'artifactId', existing.artifact_id,
          'status', existing.intent_status,
          'provider', existing.provider,
          'duplicate', true
        );
      end if;

      update examination_room_v1.media_upload_intents i
      set provider = requested_provider,
          provider_object_reference = requested_object_reference,
          intent_status = case when requested_provider = 'local_queue' then 'local_queue' else 'prepared' end
      where i.id = existing.id;

      return jsonb_build_object(
        'ok', true,
        'intentId', existing.id,
        'status', case when requested_provider = 'local_queue' then 'local_queue' else 'prepared' end,
        'provider', requested_provider,
        'duplicate', true
      );
    end if;

    insert into examination_room_v1.media_upload_intents (
      session_id,
      client_artifact_id,
      request_hash,
      artifact_kind,
      source_mime_type,
      encrypted_size_bytes,
      object_sha256,
      captured_from,
      captured_to,
      retention_until,
      provider,
      provider_object_reference,
      wrapped_key_algorithm,
      wrapped_key_version,
      wrapped_key_ciphertext,
      wrapped_key_iv,
      wrapped_key_aad_sha256,
      intent_status
    ) values (
      session_id,
      client_artifact_id,
      request_hash,
      artifact_kind,
      source_mime_type,
      encrypted_size_bytes,
      object_sha256,
      captured_from,
      captured_to,
      retention_until,
      requested_provider,
      requested_object_reference,
      key_envelope ->> 'algorithm',
      (key_envelope ->> 'keyVersion')::smallint,
      key_envelope ->> 'ciphertext',
      key_envelope ->> 'iv',
      key_envelope ->> 'aadSha256',
      case when requested_provider = 'local_queue' then 'local_queue' else 'prepared' end
    ) returning id into intent_id;

    response := jsonb_build_object(
      'ok', true,
      'intentId', intent_id,
      'status', case when requested_provider = 'local_queue' then 'local_queue' else 'prepared' end,
      'provider', requested_provider,
      'duplicate', false
    );
    audit_request_hash := encode(sha256(convert_to('media-reserve:' || request_hash, 'UTF8')), 'hex');
    perform examination_room_v1.api_record_audit(
      institution_id,
      exam_id,
      session_id,
      null,
      'student',
      'student.media.reserve',
      'media_upload_intent',
      intent_id,
      audit_request_hash,
      clock_timestamp(),
      response,
      client_artifact_id
    );
    return response;
  end if;

  requested_provider := safe_payload ->> 'provider';
  requested_object_reference := btrim(safe_payload ->> 'providerObjectReference');
  object_sha256 := safe_payload ->> 'objectSha256';
  safe_provider_result := coalesce(safe_payload -> 'providerResult', '{}'::jsonb);

  if coalesce(safe_payload ->> 'providerVerified', '') <> 'true'
     or coalesce(requested_provider, '') not in ('google_drive', 'supabase_storage')
     or coalesce(length(requested_object_reference), 0) not between 8 and 1024
     or requested_object_reference ~* '(token|secret|authorization|credential|password)='
     or requested_object_reference ~* '^https?://'
     or coalesce(object_sha256, '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(safe_provider_result) <> 'object'
     or safe_provider_result::text ~* '"(url|token|secret|authorization|credential|password|accessToken|refreshToken|signedUrl)"[[:space:]]*:' then
    return examination_room_v1.api_error(
      'MEDIA_COMPLETION_INVALID',
      'The encrypted recording could not be verified for registration.',
      400,
      'Keep the encrypted recording on this device and retry upload verification.'
    );
  end if;

  begin
    encrypted_size_bytes := (safe_payload ->> 'encryptedSizeBytes')::bigint;
    requested_completed_at := (safe_payload ->> 'completedAt')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      return examination_room_v1.api_error(
        'MEDIA_COMPLETION_INVALID',
        'The encrypted recording completion metadata is invalid.',
        400,
        'Keep the encrypted recording on this device and retry upload verification.'
      );
  end;

  select i.*
  into existing
  from examination_room_v1.media_upload_intents i
  where i.session_id = session_id
    and i.client_artifact_id = client_artifact_id
  for update;

  if existing.id is null then
    return examination_room_v1.api_error(
      'MEDIA_INTENT_NOT_FOUND',
      'The recording upload request could not be found.',
      409,
      'Keep the encrypted recording on this device and request a new upload destination before completing it.'
    );
  end if;

  if existing.provider <> requested_provider
     or existing.object_sha256 <> object_sha256
     or existing.encrypted_size_bytes <> encrypted_size_bytes
     or (
       requested_provider = 'supabase_storage'
       and existing.provider_object_reference <> requested_object_reference
     ) then
    return examination_room_v1.api_error(
      'MEDIA_IDEMPOTENCY_CONFLICT',
      'The uploaded recording does not match its prepared metadata.',
      409,
      'Keep the encrypted recording on this device and retry using the upload destination issued for this segment.'
    );
  end if;

  if existing.intent_status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'intentId', existing.id,
      'artifactId', existing.artifact_id,
      'status', 'completed',
      'provider', existing.provider,
      'duplicate', true
    );
  end if;

  insert into examination_room_v1.proctoring_artifacts (
    session_id,
    artifact_kind,
    encrypted_object_reference,
    object_sha256,
    encryption_key_reference,
    captured_from,
    captured_to,
    retention_until,
    artifact_status
  ) values (
    existing.session_id,
    existing.artifact_kind,
    requested_object_reference,
    existing.object_sha256,
    'media-intent-v1:' || existing.id::text,
    existing.captured_from,
    existing.captured_to,
    existing.retention_until,
    'available'
  )
  on conflict (encrypted_object_reference) do nothing
  returning id into registered_artifact_id;

  if registered_artifact_id is null then
    select a.id
    into registered_artifact_id
    from examination_room_v1.proctoring_artifacts a
    where a.encrypted_object_reference = requested_object_reference
      and a.session_id = existing.session_id
      and a.artifact_kind = existing.artifact_kind
      and a.object_sha256 = existing.object_sha256
      and a.encryption_key_reference = 'media-intent-v1:' || existing.id::text;
  end if;

  if registered_artifact_id is null then
    return examination_room_v1.api_error(
      'MEDIA_OBJECT_CONFLICT',
      'That stored recording reference is already bound to different evidence.',
      409,
      'Keep the encrypted recording on this device and request a new upload destination.'
    );
  end if;

  update examination_room_v1.media_upload_intents i
  set provider_object_reference = requested_object_reference,
      intent_status = 'completed',
      completion_request_hash = request_hash,
      provider_result = safe_provider_result,
      artifact_id = registered_artifact_id,
      completed_at = requested_completed_at
  where i.id = existing.id;

  response := jsonb_build_object(
    'ok', true,
    'intentId', existing.id,
    'artifactId', registered_artifact_id,
    'status', 'completed',
    'provider', requested_provider,
    'duplicate', false
  );
  audit_request_hash := encode(sha256(convert_to('media-complete:' || request_hash, 'UTF8')), 'hex');
  perform examination_room_v1.api_record_audit(
    institution_id,
    exam_id,
    session_id,
    null,
    'student',
    'student.media.complete',
    'proctoring_artifact',
    registered_artifact_id,
    audit_request_hash,
    requested_completed_at,
    response,
    client_artifact_id
  );
  return response;
exception
  when unique_violation then
    return examination_room_v1.api_error(
      'MEDIA_IDEMPOTENCY_CONFLICT',
      'That recording request is already bound to another encrypted segment.',
      409,
      'Keep the encrypted recording on this device and retry it with a new recording identifier.'
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      'MEDIA_PERSISTENCE_INVALID',
      'The encrypted recording metadata did not match the protected examination state.',
      409,
      'Keep the encrypted recording on this device, refresh the examination, and retry.'
    );
  when others then
    return examination_room_v1.api_error(
      'MEDIA_CONTROL_UNAVAILABLE',
      'Recording upload control is temporarily unavailable.',
      503,
      'Keep the encrypted recording on this device and continue the examination or submit normally. Retry upload later.'
    );
end;
$$;

comment on function public.examination_room_v1_media(text, jsonb) is
  'Service-role-only control plane for idempotent direct encrypted media uploads. It authenticates an existing student session token hash and never accepts media bytes.';

revoke all on function public.examination_room_v1_media(text, jsonb) from public, anon, authenticated;
grant execute on function public.examination_room_v1_media(text, jsonb) to service_role;

commit;
