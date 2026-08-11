-- Due Diligence Examination Room request, quotation, payment-proof, and
-- room-scoped administrator workflow.
--
-- This migration is additive. It does not alter existing rooms, exams,
-- questions, attempts, submissions, grades, or platform-administrator roles.
-- Existing Examination Rooms without a request record retain their current
-- behavior. Only rooms created from this request workflow receive the payment
-- verification gate before a student access code can be issued.

begin;

create table if not exists public.exam_room_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  professor_user_id uuid not null references auth.users(id) on delete restrict,
  professor_name text not null check (char_length(btrim(professor_name)) between 2 and 200),
  professor_email text not null check (
    professor_email = lower(btrim(professor_email))
    and professor_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  school_name text not null check (char_length(btrim(school_name)) between 2 and 300),
  course_subject text not null check (char_length(btrim(course_subject)) between 2 and 200),
  examination_title text not null check (char_length(btrim(examination_title)) between 2 and 200),
  examination_date date not null,
  start_time time without time zone not null,
  time_zone text not null default 'Asia/Manila'
    check (char_length(btrim(time_zone)) between 3 and 80),
  expected_duration_minutes integer not null check (expected_duration_minutes between 15 and 480),
  estimated_student_count integer not null check (estimated_student_count between 1 and 500),
  examination_type text not null default 'essay' check (examination_type = 'essay'),
  beadle_name text check (beadle_name is null or char_length(btrim(beadle_name)) between 2 and 200),
  beadle_email text check (
    beadle_email is null or (
      beadle_email = lower(btrim(beadle_email))
      and beadle_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    )
  ),
  quotation_recipient text not null default 'professor'
    check (quotation_recipient in ('professor', 'beadle')),
  notes text not null default '' check (char_length(notes) <= 3000),
  status text not null default 'request_submitted' check (status in (
    'request_submitted', 'quotation_prepared', 'quotation_sent',
    'awaiting_proof', 'proof_submitted', 'payment_under_review',
    'payment_verified', 'room_activated', 'cancelled', 'expired'
  )),
  assigned_administrator_user_id uuid references auth.users(id) on delete restrict,
  quotation_amount_centavos bigint check (
    quotation_amount_centavos is null
    or quotation_amount_centavos between 1 and 1000000000
  ),
  quotation_currency text not null default 'PHP' check (quotation_currency = 'PHP'),
  quotation_notes text check (quotation_notes is null or char_length(quotation_notes) <= 3000),
  quotation_prepared_at timestamptz,
  quotation_sent_at timestamptz,
  quotation_delivery_status text check (
    quotation_delivery_status is null
    or quotation_delivery_status in ('pending', 'sent', 'suppressed', 'not_configured', 'failed')
  ),
  quotation_provider_id text check (
    quotation_provider_id is null or char_length(quotation_provider_id) <= 180
  ),
  activation_id uuid references public.exam_room_professor_activations(id) on delete restrict,
  classroom_id uuid references public.exam_room_classrooms(id) on delete restrict,
  payment_verified_at timestamptz,
  payment_verified_by uuid references auth.users(id) on delete restrict,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professor_user_id, request_key),
  unique (activation_id),
  unique (classroom_id),
  constraint exam_room_request_beadle_recipient_check check (
    quotation_recipient <> 'beadle'
    or (beadle_name is not null and beadle_email is not null)
  ),
  constraint exam_room_request_payment_verification_check check (
    (payment_verified_at is null and payment_verified_by is null)
    or (payment_verified_at is not null and payment_verified_by is not null)
  )
);

create index if not exists exam_room_requests_professor_idx
  on public.exam_room_requests (professor_user_id, created_at desc);
create index if not exists exam_room_requests_administrator_idx
  on public.exam_room_requests (assigned_administrator_user_id, status, created_at desc)
  where assigned_administrator_user_id is not null;
create index if not exists exam_room_requests_status_idx
  on public.exam_room_requests (status, created_at desc);

create table if not exists public.exam_room_request_payment_proofs (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  request_id uuid not null references public.exam_room_requests(id) on delete restrict,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  object_path text not null unique check (char_length(object_path) between 20 and 500),
  safe_file_name text not null check (char_length(btrim(safe_file_name)) between 1 and 180),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 8388608),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'verified', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or char_length(btrim(review_reason)) between 5 and 1000),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  unique (submitted_by, request_key),
  constraint exam_room_request_proof_review_check check (
    (status in ('submitted', 'under_review') and reviewed_by is null and reviewed_at is null)
    or (status = 'verified' and reviewed_by is not null and reviewed_at is not null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and review_reason is not null)
  )
);

create index if not exists exam_room_request_proofs_request_idx
  on public.exam_room_request_payment_proofs (request_id, submitted_at desc);

alter table public.exam_room_requests enable row level security;
alter table public.exam_room_requests force row level security;
alter table public.exam_room_request_payment_proofs enable row level security;
alter table public.exam_room_request_payment_proofs force row level security;
revoke all on table public.exam_room_requests from public, anon, authenticated;
revoke all on table public.exam_room_request_payment_proofs from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_room_requests to service_role;
grant select, insert, update, delete on table public.exam_room_request_payment_proofs to service_role;

create or replace function public.exam_room_request_actor_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = p_user_id;
$$;

create or replace function public.exam_room_request_is_manager(
  p_user_id uuid,
  p_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.exam_room_requests r
    where r.id = p_request_id
      and r.assigned_administrator_user_id = p_user_id
  );
$$;

create or replace function public.exam_room_request_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_is_platform_admin boolean;
  v_profile_name text;
  v_professor_requests jsonb;
  v_beadle_requests jsonb;
  v_administrator_requests jsonb;
  v_unassigned_requests jsonb;
begin
  if p_user_id is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  v_email := public.exam_room_request_actor_email(p_user_id);
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  v_is_platform_admin := public.exam_room_is_admin(p_user_id);
  select nullif(btrim(p.display_name), '') into v_profile_name
  from public.profiles p where p.id = p_user_id;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_professor_requests
  from (
    select r.created_at, jsonb_build_object(
      'requestId', r.public_id, 'role', 'professor', 'professorName', r.professor_name,
      'professorEmail', r.professor_email, 'schoolName', r.school_name,
      'courseSubject', r.course_subject, 'examinationTitle', r.examination_title,
      'examinationDate', r.examination_date, 'startTime', r.start_time,
      'timeZone', r.time_zone, 'expectedDurationMinutes', r.expected_duration_minutes,
      'estimatedStudentCount', r.estimated_student_count, 'examinationType', r.examination_type,
      'beadleName', r.beadle_name, 'beadleEmail', r.beadle_email,
      'quotationRecipient', r.quotation_recipient, 'notes', r.notes,
      'status', r.status, 'quotationAmountCentavos', r.quotation_amount_centavos,
      'quotationCurrency', r.quotation_currency, 'quotationNotes', r.quotation_notes,
      'quotationDeliveryStatus', r.quotation_delivery_status,
      'activationIssued', r.activation_id is not null,
      'classroomId', c.public_id, 'paymentVerifiedAt', r.payment_verified_at,
      'latestProofStatus', proof.status, 'latestProofId', proof.public_id,
      'createdAt', r.created_at, 'updatedAt', r.updated_at
    ) item
    from public.exam_room_requests r
    left join public.exam_room_classrooms c on c.id = r.classroom_id
    left join lateral (
      select p.status, p.public_id
      from public.exam_room_request_payment_proofs p
      where p.request_id = r.id order by p.submitted_at desc limit 1
    ) proof on true
    where r.professor_user_id = p_user_id
  ) rows;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_beadle_requests
  from (
    select r.created_at, jsonb_build_object(
      'requestId', r.public_id, 'role', 'beadle', 'professorName', r.professor_name,
      'schoolName', r.school_name, 'courseSubject', r.course_subject,
      'examinationTitle', r.examination_title, 'examinationDate', r.examination_date,
      'startTime', r.start_time, 'timeZone', r.time_zone,
      'quotationRecipient', r.quotation_recipient, 'status', r.status,
      'quotationAmountCentavos', r.quotation_amount_centavos,
      'quotationCurrency', r.quotation_currency, 'quotationNotes', r.quotation_notes,
      'quotationDeliveryStatus', r.quotation_delivery_status,
      'paymentVerifiedAt', r.payment_verified_at,
      'latestProofStatus', proof.status, 'latestProofId', proof.public_id,
      'createdAt', r.created_at, 'updatedAt', r.updated_at
    ) item
    from public.exam_room_requests r
    left join lateral (
      select p.status, p.public_id
      from public.exam_room_request_payment_proofs p
      where p.request_id = r.id order by p.submitted_at desc limit 1
    ) proof on true
    where r.beadle_email = v_email
      and r.quotation_recipient = 'beadle'
  ) rows;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_administrator_requests
  from (
    select r.created_at, jsonb_build_object(
      'requestId', r.public_id, 'role', 'exam_administrator',
      'professorName', r.professor_name, 'professorEmail', r.professor_email,
      'schoolName', r.school_name, 'courseSubject', r.course_subject,
      'examinationTitle', r.examination_title, 'examinationDate', r.examination_date,
      'startTime', r.start_time, 'timeZone', r.time_zone,
      'expectedDurationMinutes', r.expected_duration_minutes,
      'estimatedStudentCount', r.estimated_student_count, 'examinationType', r.examination_type,
      'beadleName', r.beadle_name, 'beadleEmail', r.beadle_email,
      'quotationRecipient', r.quotation_recipient, 'notes', r.notes,
      'status', r.status, 'quotationAmountCentavos', r.quotation_amount_centavos,
      'quotationCurrency', r.quotation_currency, 'quotationNotes', r.quotation_notes,
      'quotationDeliveryStatus', r.quotation_delivery_status,
      'activationIssued', r.activation_id is not null,
      'classroomId', c.public_id, 'paymentVerifiedAt', r.payment_verified_at,
      'latestProofStatus', proof.status, 'latestProofId', proof.public_id,
      'createdAt', r.created_at, 'updatedAt', r.updated_at
    ) item
    from public.exam_room_requests r
    left join public.exam_room_classrooms c on c.id = r.classroom_id
    left join lateral (
      select p.status, p.public_id
      from public.exam_room_request_payment_proofs p
      where p.request_id = r.id order by p.submitted_at desc limit 1
    ) proof on true
    where r.assigned_administrator_user_id = p_user_id
  ) rows;

  if v_is_platform_admin then
    select coalesce(jsonb_agg(item order by created_at asc), '[]'::jsonb)
    into v_unassigned_requests
    from (
      select r.created_at, jsonb_build_object(
        'requestId', r.public_id, 'professorName', r.professor_name,
        'professorEmail', r.professor_email, 'schoolName', r.school_name,
        'courseSubject', r.course_subject, 'examinationTitle', r.examination_title,
        'examinationDate', r.examination_date, 'startTime', r.start_time,
        'timeZone', r.time_zone, 'estimatedStudentCount', r.estimated_student_count,
        'status', r.status, 'createdAt', r.created_at
      ) item
      from public.exam_room_requests r
      where r.assigned_administrator_user_id is null
        and r.status not in ('cancelled', 'expired')
    ) rows;
  else
    v_unassigned_requests := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true,
    'identity', jsonb_build_object(
      'name', coalesce(v_profile_name, split_part(v_email, '@', 1)),
      'email', v_email
    ),
    'roles', jsonb_build_object(
      'examAdministrator', jsonb_array_length(v_administrator_requests) > 0,
      'canClaimRequests', v_is_platform_admin
    ),
    'professorRequests', v_professor_requests,
    'beadleRequests', v_beadle_requests,
    'administratorRequests', v_administrator_requests,
    'unassignedRequests', v_unassigned_requests
  );
end;
$$;

create or replace function public.exam_room_submit_request(
  p_user_id uuid,
  p_professor_name text,
  p_school_name text,
  p_course_subject text,
  p_examination_title text,
  p_examination_date date,
  p_start_time time without time zone,
  p_time_zone text,
  p_expected_duration_minutes integer,
  p_estimated_student_count integer,
  p_examination_type text,
  p_beadle_name text,
  p_beadle_email text,
  p_quotation_recipient text,
  p_notes text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_beadle_email text := nullif(lower(btrim(coalesce(p_beadle_email, ''))), '');
  v_request public.exam_room_requests%rowtype;
  v_created boolean := false;
begin
  v_email := public.exam_room_request_actor_email(p_user_id);
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or char_length(btrim(coalesce(p_professor_name, ''))) not between 2 and 200
    or char_length(btrim(coalesce(p_school_name, ''))) not between 2 and 300
    or char_length(btrim(coalesce(p_course_subject, ''))) not between 2 and 200
    or char_length(btrim(coalesce(p_examination_title, ''))) not between 2 and 200
    or p_examination_date is null
    or p_examination_date < current_date
    or p_examination_date > current_date + 730
    or p_start_time is null
    or char_length(btrim(coalesce(p_time_zone, ''))) not between 3 and 80
    or p_expected_duration_minutes not between 15 and 480
    or p_estimated_student_count not between 1 and 500
    or p_examination_type <> 'essay'
    or p_quotation_recipient not in ('professor', 'beadle')
    or char_length(coalesce(p_notes, '')) > 3000
    or (
      p_quotation_recipient = 'beadle'
      and (
        char_length(btrim(coalesce(p_beadle_name, ''))) not between 2 and 200
        or v_beadle_email is null
        or v_beadle_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
      )
    )
  then raise exception 'EXAM_ROOM_REQUEST_INVALID'; end if;

  insert into public.exam_room_requests (
    professor_user_id, professor_name, professor_email, school_name,
    course_subject, examination_title, examination_date, start_time,
    time_zone, expected_duration_minutes, estimated_student_count,
    examination_type, beadle_name, beadle_email, quotation_recipient,
    notes, request_key
  ) values (
    p_user_id, btrim(p_professor_name), v_email, btrim(p_school_name),
    btrim(p_course_subject), btrim(p_examination_title), p_examination_date,
    p_start_time, btrim(p_time_zone), p_expected_duration_minutes,
    p_estimated_student_count, p_examination_type,
    nullif(btrim(coalesce(p_beadle_name, '')), ''), v_beadle_email,
    p_quotation_recipient, coalesce(p_notes, ''), p_request_key
  )
  on conflict (professor_user_id, request_key) do nothing
  returning * into v_request;

  if found then
    v_created := true;
  else
    select * into v_request
    from public.exam_room_requests r
    where r.professor_user_id = p_user_id
      and r.request_key = p_request_key;
    if not found
      or v_request.professor_name <> btrim(p_professor_name)
      or v_request.school_name <> btrim(p_school_name)
      or v_request.course_subject <> btrim(p_course_subject)
      or v_request.examination_title <> btrim(p_examination_title)
      or v_request.examination_date <> p_examination_date
      or v_request.start_time <> p_start_time
      or v_request.time_zone <> btrim(p_time_zone)
      or v_request.expected_duration_minutes <> p_expected_duration_minutes
      or v_request.estimated_student_count <> p_estimated_student_count
      or v_request.examination_type <> p_examination_type
      or v_request.beadle_name is distinct from nullif(btrim(coalesce(p_beadle_name, '')), '')
      or v_request.beadle_email is distinct from v_beadle_email
      or v_request.quotation_recipient <> p_quotation_recipient
      or v_request.notes <> coalesce(p_notes, '')
    then raise exception 'EXAM_ROOM_REQUEST_IDEMPOTENCY_CONFLICT'; end if;
  end if;

  if v_created then
    insert into public.exam_room_audit_log (actor_user_id, action, metadata)
    values (
      p_user_id, 'room_request_submitted',
      jsonb_build_object('requestId', v_request.public_id, 'examinationType', v_request.examination_type)
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'status', v_request.status, 'createdAt', v_request.created_at,
    'replayed', not v_created
  );
end;
$$;

create or replace function public.exam_room_claim_request(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
begin
  perform public.exam_room_require_admin(p_actor_user_id);
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'EXAM_ROOM_REQUEST_INVALID';
  end if;
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id for update;
  if not found or v_request.status in ('cancelled', 'expired') then
    raise exception 'EXAM_ROOM_REQUEST_NOT_AVAILABLE';
  end if;
  if v_request.assigned_administrator_user_id is not null
    and v_request.assigned_administrator_user_id <> p_actor_user_id
  then raise exception 'EXAM_ROOM_REQUEST_ALREADY_ASSIGNED'; end if;
  update public.exam_room_requests
  set assigned_administrator_user_id = p_actor_user_id, updated_at = now()
  where id = v_request.id;
  insert into public.exam_room_audit_log (actor_user_id, action, metadata)
  values (p_actor_user_id, 'room_request_claimed', jsonb_build_object('requestId', v_request.public_id));
  return jsonb_build_object('ok', true, 'requestId', v_request.public_id, 'assigned', true);
end;
$$;

create or replace function public.exam_room_prepare_quotation(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_amount_centavos bigint,
  p_notes text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_recipient_email text;
begin
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id for update;
  if not found or not public.exam_room_request_is_manager(p_actor_user_id, v_request.id)
    or v_request.status in ('cancelled', 'expired')
    or p_amount_centavos not between 1 and 1000000000
    or char_length(coalesce(p_notes, '')) > 3000
    or p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_QUOTATION_INVALID'; end if;
  v_recipient_email := case when v_request.quotation_recipient = 'beadle'
    then v_request.beadle_email else v_request.professor_email end;
  update public.exam_room_requests
  set quotation_amount_centavos = p_amount_centavos,
      quotation_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      quotation_prepared_at = now(), quotation_delivery_status = 'pending',
      status = 'quotation_prepared', updated_at = now()
  where id = v_request.id;
  insert into public.exam_room_audit_log (actor_user_id, action, metadata)
  values (p_actor_user_id, 'room_quotation_prepared', jsonb_build_object(
    'requestId', v_request.public_id, 'amountCentavos', p_amount_centavos,
    'currency', 'PHP', 'recipientRole', v_request.quotation_recipient
  ));
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id, 'status', 'quotation_prepared',
    'recipientEmail', v_recipient_email, 'recipientRole', v_request.quotation_recipient,
    'professorName', v_request.professor_name, 'examinationTitle', v_request.examination_title,
    'schoolName', v_request.school_name, 'courseSubject', v_request.course_subject,
    'amountCentavos', p_amount_centavos, 'currency', 'PHP',
    'quotationNotes', nullif(btrim(coalesce(p_notes, '')), '')
  );
end;
$$;

create or replace function public.exam_room_record_quotation_delivery(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_delivery_status text,
  p_provider_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
begin
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id for update;
  if not found or not public.exam_room_request_is_manager(p_actor_user_id, v_request.id)
    or p_delivery_status not in ('sent', 'suppressed', 'not_configured', 'failed')
    or char_length(coalesce(p_provider_id, '')) > 180
  then raise exception 'EXAM_ROOM_QUOTATION_DELIVERY_INVALID'; end if;
  update public.exam_room_requests
  set quotation_delivery_status = p_delivery_status,
      quotation_provider_id = nullif(p_provider_id, ''),
      quotation_sent_at = case when p_delivery_status = 'sent' then now() else quotation_sent_at end,
      status = case when p_delivery_status = 'sent' then 'quotation_sent' else 'quotation_prepared' end,
      updated_at = now()
  where id = v_request.id;
  insert into public.exam_room_audit_log (actor_user_id, action, metadata)
  values (p_actor_user_id, 'room_quotation_delivery_recorded', jsonb_build_object(
    'requestId', v_request.public_id, 'deliveryStatus', p_delivery_status
  ));
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'status', case when p_delivery_status = 'sent' then 'quotation_sent' else 'quotation_prepared' end,
    'deliveryStatus', p_delivery_status
  );
end;
$$;

create or replace function public.exam_room_quotation_delivery_context(
  p_actor_user_id uuid,
  p_request_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_recipient_email text;
declare v_recipient_name text;
begin
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id;
  if not found or not public.exam_room_request_is_manager(p_actor_user_id, v_request.id)
    or v_request.quotation_amount_centavos is null
    or v_request.status in ('request_submitted', 'cancelled', 'expired')
  then raise exception 'EXAM_ROOM_QUOTATION_NOT_READY'; end if;
  v_recipient_email := case when v_request.quotation_recipient = 'beadle'
    then v_request.beadle_email else v_request.professor_email end;
  v_recipient_name := case when v_request.quotation_recipient = 'beadle'
    then v_request.beadle_name else v_request.professor_name end;
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'recipientEmail', v_recipient_email, 'recipientName', v_recipient_name,
    'recipientRole', v_request.quotation_recipient,
    'professorName', v_request.professor_name,
    'schoolName', v_request.school_name, 'courseSubject', v_request.course_subject,
    'examinationTitle', v_request.examination_title,
    'examinationDate', v_request.examination_date, 'startTime', v_request.start_time,
    'timeZone', v_request.time_zone,
    'amountCentavos', v_request.quotation_amount_centavos,
    'currency', v_request.quotation_currency,
    'quotationNotes', v_request.quotation_notes
  );
end;
$$;

create or replace function public.exam_room_generate_provisional_key(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_activation public.exam_room_professor_activations%rowtype;
begin
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id for update;
  if not found or not public.exam_room_request_is_manager(p_actor_user_id, v_request.id)
    or v_request.quotation_amount_centavos is null
    or v_request.status in ('request_submitted', 'cancelled', 'expired')
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '7 days'
    or p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_PROVISIONAL_KEY_INVALID'; end if;
  if v_request.activation_id is not null and exists (
    select 1 from public.exam_room_professor_activations a
    where a.id = v_request.activation_id and a.status in ('issued', 'locked', 'redeemed')
  ) then raise exception 'EXAM_ROOM_PROVISIONAL_KEY_EXISTS'; end if;

  insert into public.exam_room_professor_activations (
    target_email, token_hash, status, expires_at, issued_by,
    room_policy, room_title, school_name, academic_term
  ) values (
    v_request.professor_email, p_token_hash, 'issued', p_expires_at, p_actor_user_id,
    'one_key_one_room', v_request.examination_title, v_request.school_name,
    v_request.course_subject
  ) returning * into v_activation;

  update public.exam_room_requests
  set activation_id = v_activation.id,
      status = case when payment_verified_at is not null then 'payment_verified' else 'awaiting_proof' end,
      updated_at = now()
  where id = v_request.id;
  insert into public.exam_room_audit_log (actor_user_id, action, metadata)
  values (p_actor_user_id, 'room_provisional_key_issued', jsonb_build_object(
    'requestId', v_request.public_id, 'activationId', v_activation.id,
    'expiresAt', v_activation.expires_at
  ));
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'activationId', v_activation.id, 'expiresAt', v_activation.expires_at,
    'targetEmail', v_request.professor_email, 'oneTimeOnly', true,
    'paymentVerified', v_request.payment_verified_at is not null
  );
end;
$$;

create or replace function public.exam_room_sync_request_after_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'redeemed' and new.classroom_id is not null
    and (old.status is distinct from new.status or old.classroom_id is distinct from new.classroom_id)
  then
    update public.exam_room_requests
    set classroom_id = new.classroom_id,
        status = case when payment_verified_at is not null then 'room_activated' else status end,
        updated_at = now()
    where activation_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists exam_room_request_activation_sync
  on public.exam_room_professor_activations;
create trigger exam_room_request_activation_sync
after update on public.exam_room_professor_activations
for each row execute function public.exam_room_sync_request_after_activation();

create or replace function public.exam_room_payment_proof_upload_context(
  p_user_id uuid,
  p_request_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_email text;
begin
  v_email := public.exam_room_request_actor_email(p_user_id);
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id;
  if not found or not (
      v_request.professor_user_id = p_user_id
      or (v_request.quotation_recipient = 'beadle' and v_request.beadle_email = v_email)
    )
    or v_request.quotation_amount_centavos is null
    or v_request.status in ('request_submitted', 'cancelled', 'expired', 'room_activated')
  then raise exception 'EXAM_ROOM_PAYMENT_PROOF_NOT_ALLOWED'; end if;
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'objectPrefix', 'exam-room/' || v_request.public_id::text || '/' || p_user_id::text || '/',
    'maximumBytes', 8388608,
    'mimeTypes', jsonb_build_array('image/png', 'image/jpeg', 'application/pdf')
  );
end;
$$;

create or replace function public.exam_room_register_payment_proof(
  p_user_id uuid,
  p_request_public_id uuid,
  p_object_path text,
  p_safe_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_content_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_context jsonb;
declare v_proof public.exam_room_request_payment_proofs%rowtype;
declare v_created boolean := false;
begin
  v_context := public.exam_room_payment_proof_upload_context(p_user_id, p_request_public_id);
  select * into v_request from public.exam_room_requests where public_id = p_request_public_id for update;
  if p_object_path is null or not starts_with(p_object_path, v_context->>'objectPrefix')
    or p_object_path like '%..%'
    or char_length(p_object_path) > 500
    or char_length(btrim(coalesce(p_safe_file_name, ''))) not between 1 and 180
    or p_mime_type not in ('image/png', 'image/jpeg', 'application/pdf')
    or p_size_bytes not between 1 and 8388608
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_PAYMENT_PROOF_INVALID'; end if;
  insert into public.exam_room_request_payment_proofs (
    request_id, submitted_by, object_path, safe_file_name,
    mime_type, size_bytes, content_hash, request_key
  ) values (
    v_request.id, p_user_id, p_object_path, btrim(p_safe_file_name),
    p_mime_type, p_size_bytes, p_content_hash, p_request_key
  )
  on conflict (submitted_by, request_key) do nothing
  returning * into v_proof;

  if found then
    v_created := true;
  else
    select * into v_proof
    from public.exam_room_request_payment_proofs p
    where p.submitted_by = p_user_id
      and p.request_key = p_request_key;
    if not found
      or v_proof.request_id <> v_request.id
      or v_proof.object_path <> p_object_path
      or v_proof.safe_file_name <> btrim(p_safe_file_name)
      or v_proof.mime_type <> p_mime_type
      or v_proof.size_bytes <> p_size_bytes
      or v_proof.content_hash <> p_content_hash
    then raise exception 'EXAM_ROOM_PAYMENT_PROOF_IDEMPOTENCY_CONFLICT'; end if;
  end if;

  if v_created then
    update public.exam_room_requests
    set status = 'proof_submitted', updated_at = now()
    where id = v_request.id;
    insert into public.exam_room_audit_log (actor_user_id, action, metadata)
    values (p_user_id, 'room_payment_proof_submitted', jsonb_build_object(
      'requestId', v_request.public_id, 'proofId', v_proof.public_id,
      'mimeType', v_proof.mime_type, 'sizeBytes', v_proof.size_bytes
    ));
  end if;
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'proofId', v_proof.public_id, 'status', v_proof.status,
    'submittedAt', v_proof.submitted_at, 'replayed', not v_created
  );
end;
$$;

create or replace function public.exam_room_payment_proof_review_context(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_proof_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_proof public.exam_room_request_payment_proofs%rowtype;
begin
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id;
  if not found or not public.exam_room_request_is_manager(p_actor_user_id, v_request.id)
  then raise exception 'EXAM_ROOM_ADMINISTRATOR_REQUIRED'; end if;
  select * into v_proof from public.exam_room_request_payment_proofs p
  where p.request_id = v_request.id
    and (p_proof_public_id is null or p.public_id = p_proof_public_id)
  order by p.submitted_at desc limit 1;
  if not found then raise exception 'EXAM_ROOM_PAYMENT_PROOF_NOT_FOUND'; end if;
  if v_proof.status = 'submitted' then
    update public.exam_room_request_payment_proofs
    set status = 'under_review' where id = v_proof.id;
    update public.exam_room_requests set status = 'payment_under_review', updated_at = now()
    where id = v_request.id;
    v_proof.status := 'under_review';
  end if;
  insert into public.exam_room_audit_log (actor_user_id, action, metadata)
  values (p_actor_user_id, 'room_payment_proof_opened', jsonb_build_object(
    'requestId', v_request.public_id, 'proofId', v_proof.public_id
  ));
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id, 'proofId', v_proof.public_id,
    'objectPath', v_proof.object_path, 'fileName', v_proof.safe_file_name,
    'mimeType', v_proof.mime_type, 'sizeBytes', v_proof.size_bytes,
    'status', v_proof.status, 'submittedAt', v_proof.submitted_at
  );
end;
$$;

create or replace function public.exam_room_review_payment_proof(
  p_actor_user_id uuid,
  p_request_public_id uuid,
  p_proof_public_id uuid,
  p_decision text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
declare v_proof public.exam_room_request_payment_proofs%rowtype;
declare v_status text;
begin
  select * into v_request from public.exam_room_requests
  where public_id = p_request_public_id for update;
  if not found or not public.exam_room_request_is_manager(p_actor_user_id, v_request.id)
    or p_decision not in ('verified', 'rejected')
    or (p_decision = 'rejected' and char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000)
    or p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_PAYMENT_REVIEW_INVALID'; end if;
  select * into v_proof from public.exam_room_request_payment_proofs p
  where p.request_id = v_request.id and p.public_id = p_proof_public_id for update;
  if not found or v_proof.status not in ('submitted', 'under_review')
  then raise exception 'EXAM_ROOM_PAYMENT_PROOF_NOT_REVIEWABLE'; end if;
  update public.exam_room_request_payment_proofs
  set status = p_decision, reviewed_by = p_actor_user_id, reviewed_at = now(),
      review_reason = case when p_decision = 'rejected' then btrim(p_reason) else null end
  where id = v_proof.id;
  if p_decision = 'verified' then
    v_status := case when v_request.classroom_id is not null then 'room_activated' else 'payment_verified' end;
    update public.exam_room_requests
    set status = v_status, payment_verified_at = now(), payment_verified_by = p_actor_user_id,
        updated_at = now()
    where id = v_request.id;
  else
    v_status := 'awaiting_proof';
    update public.exam_room_requests
    set status = v_status, updated_at = now()
    where id = v_request.id;
  end if;
  insert into public.exam_room_audit_log (actor_user_id, action, reason, metadata)
  values (
    p_actor_user_id,
    case when p_decision = 'verified' then 'room_payment_verified' else 'room_payment_rejected' end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('requestId', v_request.public_id, 'proofId', v_proof.public_id)
  );
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'proofId', v_proof.public_id, 'decision', p_decision, 'status', v_status
  );
end;
$$;

create or replace function public.exam_room_require_verified_request_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.exam_room_requests%rowtype;
begin
  select r.* into v_request
  from public.exam_room_requests r
  join public.exam_room_exams e on e.classroom_id = r.classroom_id
  where e.id = new.exam_id;
  if found and v_request.payment_verified_at is null then
    raise exception 'EXAM_ROOM_PAYMENT_VERIFICATION_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists exam_room_student_access_payment_gate
  on public.exam_room_student_access_issuances;
create trigger exam_room_student_access_payment_gate
before insert or update on public.exam_room_student_access_issuances
for each row execute function public.exam_room_require_verified_request_payment();

revoke all on function public.exam_room_request_actor_email(uuid) from public, anon, authenticated;
revoke all on function public.exam_room_request_is_manager(uuid, uuid) from public, anon, authenticated;
revoke all on function public.exam_room_request_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.exam_room_submit_request(uuid, text, text, text, text, date, time without time zone, text, integer, integer, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.exam_room_claim_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.exam_room_prepare_quotation(uuid, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.exam_room_record_quotation_delivery(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.exam_room_quotation_delivery_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.exam_room_generate_provisional_key(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.exam_room_payment_proof_upload_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.exam_room_register_payment_proof(uuid, uuid, text, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.exam_room_payment_proof_review_context(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.exam_room_review_payment_proof(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.exam_room_sync_request_after_activation() from public, anon, authenticated;
revoke all on function public.exam_room_require_verified_request_payment() from public, anon, authenticated;

grant execute on function public.exam_room_request_actor_email(uuid) to service_role;
grant execute on function public.exam_room_request_is_manager(uuid, uuid) to service_role;
grant execute on function public.exam_room_request_snapshot(uuid) to service_role;
grant execute on function public.exam_room_submit_request(uuid, text, text, text, text, date, time without time zone, text, integer, integer, text, text, text, text, text, text) to service_role;
grant execute on function public.exam_room_claim_request(uuid, uuid, text) to service_role;
grant execute on function public.exam_room_prepare_quotation(uuid, uuid, bigint, text, text) to service_role;
grant execute on function public.exam_room_record_quotation_delivery(uuid, uuid, text, text) to service_role;
grant execute on function public.exam_room_quotation_delivery_context(uuid, uuid) to service_role;
grant execute on function public.exam_room_generate_provisional_key(uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.exam_room_payment_proof_upload_context(uuid, uuid) to service_role;
grant execute on function public.exam_room_register_payment_proof(uuid, uuid, text, text, text, integer, text, text) to service_role;
grant execute on function public.exam_room_payment_proof_review_context(uuid, uuid, uuid) to service_role;
grant execute on function public.exam_room_review_payment_proof(uuid, uuid, uuid, text, text, text) to service_role;

commit;
