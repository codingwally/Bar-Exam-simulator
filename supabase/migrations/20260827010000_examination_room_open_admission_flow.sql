begin;

-- This release intentionally separates examination creation from institution
-- staff roles. Every verified auth account receives the shared community
-- workspace, while the immutable exam owner remains the data boundary.

create or replace function examination_room_v1.valid_allowed_emails(p_emails text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_emails is not null
    and cardinality(p_emails) <= 5000
    and array_position(p_emails, null) is null
    and not exists (
      select 1
      from unnest(p_emails) email_value
      where email_value <> lower(btrim(email_value))
        or length(email_value) not between 3 and 320
        or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
    and cardinality(p_emails) = (
      select count(distinct email_value)::integer from unnest(p_emails) email_value
    );
$$;

create or replace function examination_room_v1.normalized_allowed_emails(p_value jsonb)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value is null then '{}'::text[]
    when jsonb_typeof(p_value) <> 'array' then null::text[]
    else coalesce((
      select array_agg(email_value order by email_value)
      from (
        select distinct lower(btrim(item.value)) as email_value
        from jsonb_array_elements_text(p_value) item(value)
        where btrim(item.value) <> ''
      ) normalized
    ), '{}'::text[])
  end;
$$;

revoke all on function examination_room_v1.valid_allowed_emails(text[])
  from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.normalized_allowed_emails(jsonb)
  from public, anon, authenticated, service_role;

alter table examination_room_v1.exams
  add column if not exists admission_mode text not null default 'key_only',
  add column if not exists allowed_emails text[] not null default '{}'::text[];

alter table examination_room_v1.exams
  drop constraint if exists exams_admission_mode_check,
  drop constraint if exists exams_allowed_emails_check;

alter table examination_room_v1.exams
  add constraint exams_admission_mode_check
    check (admission_mode in ('key_only', 'email_allowlist')),
  add constraint exams_allowed_emails_check
    check (examination_room_v1.valid_allowed_emails(allowed_emails));

comment on column examination_room_v1.exams.admission_mode is
  'Creator-controlled entry policy. key_only is the default and requires no pre-uploaded roster.';
comment on column examination_room_v1.exams.allowed_emails is
  'Normalized optional email allowlist; ignored for key_only admission and never returned to students.';

alter table examination_room_v1.exam_versions
  add column if not exists admission_mode_snapshot text not null default 'key_only',
  add column if not exists allowed_emails_snapshot text[] not null default '{}'::text[];

alter table examination_room_v1.exam_versions
  drop constraint if exists exam_versions_admission_mode_check,
  drop constraint if exists exam_versions_allowed_emails_check;

alter table examination_room_v1.exam_versions
  add constraint exam_versions_admission_mode_check
    check (admission_mode_snapshot in ('key_only', 'email_allowlist')),
  add constraint exam_versions_allowed_emails_check
    check (examination_room_v1.valid_allowed_emails(allowed_emails_snapshot));

comment on column examination_room_v1.exam_versions.admission_mode_snapshot is
  'Immutable admission policy captured with the published examination version.';
comment on column examination_room_v1.exam_versions.allowed_emails_snapshot is
  'Immutable normalized allowlist captured with the published version; never included in student preview.';

-- Key-only entry permits an optional email. Email remains mandatory only when
-- a published examination selected the email_allowlist admission mode.
alter table examination_room_v1.student_identities
  alter column email_normalized drop not null;

insert into examination_room_v1.institutions (
  id, institution_code, profile_school_id, institution_name,
  bootstrap_request_hash, created_by_user_id
) values (
  'ddc00000-0000-4000-8000-000000000001',
  'due-diligence-community',
  'due-diligence-community',
  'Due Diligence Community',
  'ddc0000000000000000000000000000000000000000000000000000000000000',
  'ddc00000-0000-4000-8000-000000000001'
)
on conflict do nothing;

insert into examination_room_v1.privacy_notice_versions (
  institution_id, notice_code, version_number, title, notice_body, body_sha256,
  processing_purposes, effective_at, created_by_user_id
)
select
  institution.id,
  'exam-room-v1',
  1,
  'Student privacy warning',
  'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.',
  encode(sha256(convert_to(
    'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.',
    'UTF8'
  )), 'hex'),
  '["examination_administration","answer_persistence","grading","integrity_review"]'::jsonb,
  clock_timestamp(),
  institution.created_by_user_id
from examination_room_v1.institutions institution
where institution.institution_code = 'due-diligence-community'
  and not exists (
    select 1
    from examination_room_v1.privacy_notice_versions notice
    where notice.institution_id = institution.id
      and notice.notice_code = 'exam-room-v1'
  );

-- Every verified account can create in the shared Community workspace. A
-- separate law-school workspace is available only when the account profile
-- matches that school or the account has an active membership there. Neither
-- path requires the Professor profile category or a license declaration.
create or replace function examination_room_v1.creator_authorized(
  p_actor_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select p_actor_user_id is not null
    and p_institution_id is not null
    and exists (
      select 1 from auth.users auth_user where auth_user.id = p_actor_user_id
    )
    and exists (
      select 1
      from examination_room_v1.institutions institution
      left join public.profiles profile on profile.id = p_actor_user_id
      where institution.id = p_institution_id
        and institution.institution_status = 'active'
        and (
          institution.institution_code = 'due-diligence-community'
          or institution.profile_school_id = lower(btrim(coalesce(profile.law_school_id, '')))
          or lower(institution.institution_name) = lower(btrim(coalesce(
            nullif(profile.law_school_other, ''), profile.school, ''
          )))
          or exists (
            select 1
            from examination_room_v1.staff_memberships membership
            where membership.institution_id = institution.id
              and membership.user_id = p_actor_user_id
              and membership.membership_status = 'active'
          )
        )
    );
$$;

comment on function examination_room_v1.creator_authorized(uuid, uuid) is
  'Verified creators always receive the Community workspace. Other active schools require a profile match or active membership; no Professor role or license declaration is required.';

revoke all on function examination_room_v1.creator_authorized(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.examination_room_v1_staff_context(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with actor as (
    select
      auth_user.id,
      lower(auth_user.email) as email,
      profile.commercial_category as profile_role,
      lower(btrim(coalesce(profile.law_school_id, ''))) as law_school_id,
      lower(btrim(coalesce(nullif(profile.law_school_other, ''), profile.school, ''))) as school_name,
      exists (
        select 1 from public.professor_license_declarations declaration
        where declaration.user_id = auth_user.id
      ) as professor_declared
    from auth.users auth_user
    left join public.profiles profile on profile.id = auth_user.id
    where auth_user.id = p_user_id
  ),
  workspaces as (
    select
      institution.id as institution_id,
      institution.institution_name,
      institution.institution_code,
      institution.institution_status,
      true as active,
      institution.institution_code = 'due-diligence-community' as community_default,
      (
        institution.profile_school_id = actor.law_school_id
        or lower(institution.institution_name) = actor.school_name
      ) as profile_match
    from examination_room_v1.institutions institution
    cross join actor
    where institution.institution_status = 'active'
      and (
        institution.institution_code = 'due-diligence-community'
        or institution.profile_school_id = actor.law_school_id
        or lower(institution.institution_name) = actor.school_name
        or exists (
          select 1
          from examination_room_v1.staff_memberships creator_membership
          where creator_membership.institution_id = institution.id
            and creator_membership.user_id = actor.id
            and creator_membership.membership_status = 'active'
        )
      )
  ),
  memberships as (
    select
      membership.institution_id,
      membership.staff_role,
      institution.institution_name,
      institution.institution_code,
      institution.institution_status,
      bool_or(
        membership.membership_status = 'active'
        and institution.institution_status = 'active'
      ) as active
    from examination_room_v1.staff_memberships membership
    join examination_room_v1.institutions institution on institution.id = membership.institution_id
    where membership.user_id = p_user_id
    group by membership.institution_id, membership.staff_role,
      institution.institution_name, institution.institution_code, institution.institution_status
  ),
  active_membership_institutions as (
    select distinct membership.institution_id from memberships membership where membership.active
  ),
  preferred as (
    select case
      when (select count(*) from active_membership_institutions) = 1
        then (select institution_id from active_membership_institutions limit 1)
      when (select count(*) from workspaces where profile_match) = 1
        then (select institution_id from workspaces where profile_match limit 1)
      when exists (select 1 from workspaces where community_default)
        then (select institution_id from workspaces where community_default limit 1)
      when (select count(*) from workspaces) = 1
        then (select institution_id from workspaces limit 1)
      else null
    end as institution_id
  )
  select jsonb_build_object(
    'authenticated', exists (select 1 from actor),
    'authorized', exists (select 1 from actor) and exists (select 1 from workspaces),
    'creatorAuthorized', exists (select 1 from actor) and exists (select 1 from workspaces),
    'profileRole', (select profile_role from actor),
    'professorRoleSelected', coalesce((
      select profile_role = 'professor' and professor_declared from actor
    ), false),
    'institutionId', (select institution_id from preferred),
    'creatorWorkspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'institutionId', workspace.institution_id,
        'institutionName', workspace.institution_name,
        'institutionCode', workspace.institution_code,
        'institutionStatus', workspace.institution_status,
        'active', workspace.active,
        'profileMatch', workspace.profile_match,
        'communityDefault', workspace.community_default
      ) order by workspace.community_default desc, workspace.profile_match desc,
        workspace.institution_name, workspace.institution_id)
      from workspaces workspace
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'institutionId', membership.institution_id,
        'institutionName', membership.institution_name,
        'institutionCode', membership.institution_code,
        'institutionStatus', membership.institution_status,
        'staffRole', membership.staff_role,
        'active', membership.active
      ) order by membership.active desc, (membership.staff_role = 'admin') desc,
        membership.institution_name, membership.institution_id)
      from memberships membership
    ), '[]'::jsonb)
  );
$$;

comment on function public.examination_room_v1_staff_context(uuid) is
  'Service-only creator context. Every verified auth user has an active Due Diligence Community workspace; no Professor profile or staff membership is required.';

revoke all on function public.examination_room_v1_staff_context(uuid)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_staff_context(uuid) to service_role;

-- Patch the established append-only Professor state machine in place. This
-- preserves the already-audited grading/release logic while changing only the
-- admission and activation gates requested by the product owner.
do $open_admission_professor_patch$
declare
  source_definition text;
  patched_definition text;
  old_declaration text := $old$  event_time timestamptz;
begin$old$;
  new_declaration text := $new$  event_time timestamptz;
  room_activation_status text;
begin$new$;
  old_session_item text := $old$          'currentVersionId', e.current_published_version_id,
          'updatedAt', e.updated_at$old$;
  new_session_item text := $new$          'currentVersionId', e.current_published_version_id,
          'admissionMode', e.admission_mode,
          'allowedEmails', to_jsonb(e.allowed_emails),
          'activation', (
            select jsonb_build_object(
              'id', activation.id,
              'status', activation.activation_status,
              'opensAt', activation.opens_at,
              'closesAt', activation.closes_at,
              'expiresAt', activation.closes_at,
              'maxSessions', activation.max_sessions,
              'createdAt', activation.created_at
            )
            from examination_room_v1.room_activations activation
            where activation.exam_id = e.id
            order by activation.created_at desc, activation.id desc
            limit 1
          ),
          'updatedAt', e.updated_at$new$;
  old_exam_item text := $old$        'anonymousGrading', e.anonymous_grading,
        'currentPublishedVersionId', e.current_published_version_id,$old$;
  new_exam_item text := $new$        'anonymousGrading', e.anonymous_grading,
        'admissionMode', e.admission_mode,
        'allowedEmails', to_jsonb(e.allowed_emails),
        'currentPublishedVersionId', e.current_published_version_id,$new$;
  old_publish_gate text := $old$    if p_operation = 'publish'
       and (
         jsonb_array_length(coalesce(exam_payload -> 'questions', '[]'::jsonb)) = 0
         or jsonb_array_length(coalesce(exam_payload -> 'roster', '[]'::jsonb)) = 0
       ) then
      return examination_room_v1.api_error(
        'PUBLICATION_NOT_READY', 'Publishing requires at least one question and one eligible student.', 409,
        'Complete the questions and roster, then publish again.'
      );
    end if;$old$;
  new_publish_gate text := $new$    if p_operation = 'publish'
       and jsonb_array_length(coalesce(exam_payload -> 'questions', '[]'::jsonb)) = 0 then
      return examination_room_v1.api_error(
        'PUBLICATION_NOT_READY', 'Publishing requires at least one question.', 409,
        'Add at least one complete question, then publish again.'
      );
    end if;
    if p_operation = 'publish'
       and coalesce(exam_payload ->> 'admissionMode', 'key_only') = 'email_allowlist'
       and cardinality(examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')) = 0 then
      return examination_room_v1.api_error(
        'ALLOWED_EMAIL_REQUIRED', 'Add at least one email or use key-only admission.', 409,
        'Add one email per line, or choose Anyone with the key, then publish again.'
      );
    end if;$new$;
  old_controls_tail text := $old$      'sourceFileName', exam_payload -> 'sourceFileName',
      'sourceFileSize', exam_payload -> 'sourceFileSize'
    );$old$;
  new_controls_tail text := $new$      'sourceFileName', exam_payload -> 'sourceFileName',
      'sourceFileSize', exam_payload -> 'sourceFileSize',
      'admissionMode', coalesce(exam_payload ->> 'admissionMode', 'key_only')
    );$new$;
  old_exam_insert text := $old$      insert into examination_room_v1.exams (
        id, institution_id, owner_user_id, title, description, status, anonymous_grading
      ) values (
        exam_id,
        p_institution_id,
        p_actor_user_id,
        exam_payload ->> 'title',
        nullif(exam_payload ->> 'instructions', ''),
        'draft',
        use_anonymous_grading
      );$old$;
  new_exam_insert text := $new$      insert into examination_room_v1.exams (
        id, institution_id, owner_user_id, title, description, status, anonymous_grading,
        admission_mode, allowed_emails
      ) values (
        exam_id,
        p_institution_id,
        p_actor_user_id,
        exam_payload ->> 'title',
        nullif(exam_payload ->> 'instructions', ''),
        'draft',
        use_anonymous_grading,
        coalesce(exam_payload ->> 'admissionMode', 'key_only'),
        examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      );$new$;
  old_exam_update text := $old$      update examination_room_v1.exams e
      set title = exam_payload ->> 'title',
          description = nullif(exam_payload ->> 'instructions', '')
      where e.id = exam_id;$old$;
  new_exam_update text := $new$      update examination_room_v1.exams e
      set title = exam_payload ->> 'title',
          description = nullif(exam_payload ->> 'instructions', ''),
          admission_mode = coalesce(exam_payload ->> 'admissionMode', 'key_only'),
          allowed_emails = examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      where e.id = exam_id;$new$;
  old_version_insert text := $old$        controls, content_sha256
      ) values ($old$;
  new_version_insert text := $new$        controls, content_sha256, admission_mode_snapshot, allowed_emails_snapshot
      ) values ($new$;
  old_version_values text := $old$        controls_payload,
        examination_room_v1.jsonb_sha256(draft_payload)
      );$old$;
  new_version_values text := $new$        controls_payload,
        examination_room_v1.jsonb_sha256(draft_payload),
        coalesce(exam_payload ->> 'admissionMode', 'key_only'),
        examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      );$new$;
  old_version_update text := $old$          controls = controls_payload,
          content_sha256 = examination_room_v1.jsonb_sha256(draft_payload)
      where v.id = version_id;$old$;
  new_version_update text := $new$          controls = controls_payload,
          content_sha256 = examination_room_v1.jsonb_sha256(draft_payload),
          admission_mode_snapshot = coalesce(exam_payload ->> 'admissionMode', 'key_only'),
          allowed_emails_snapshot = examination_room_v1.normalized_allowed_emails(exam_payload -> 'allowedEmails')
      where v.id = version_id;$new$;
  old_count_gate text := $old$      if question_count = 0 or roster_count = 0 then
        return examination_room_v1.api_error(
          'PUBLICATION_NOT_READY', 'Publishing requires at least one question and one eligible student.', 409,
          'Complete the questions and roster, then publish again.'
        );
      end if;$old$;
  new_count_gate text := $new$      if question_count = 0 then
        return examination_room_v1.api_error(
          'PUBLICATION_NOT_READY', 'Publishing requires at least one question.', 409,
          'Add at least one complete question, then publish again.'
        );
      end if;$new$;
  old_open text := $old$    if p_operation = 'open_room' then
      update examination_room_v1.room_activations a
      set activation_status = 'open',
          opens_at = least(a.opens_at, event_time, clock_timestamp()),
          deactivated_at = null,
          deactivated_by_user_id = null,
          deactivation_reason = null
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.key_hash = p_payload ->> 'roomKeyHash'
        and a.activation_status = 'scheduled'
        and a.closes_at > event_time
      returning a.id into version_id;

      if version_id is null then
        select a.id into version_id
        from examination_room_v1.room_activations a
        where a.exam_id = exam_id
          and a.institution_id = p_institution_id
          and a.key_hash = p_payload ->> 'roomKeyHash'
          and a.activation_status = 'open';
      end if;

      if version_id is null then
        return examination_room_v1.api_error(
          'ROOM_ACTIVATION_NOT_FOUND', 'No current room activation matches that key.', 409,
          'Ask the administrator to issue the current key, then open the room again.'
        );
      end if;
      response := jsonb_build_object('ok', true, 'examId', exam_id, 'activationId', version_id, 'status', 'open');$old$;
  new_open text := $new$    if p_operation = 'open_room' then
      select a.id, a.activation_status
      into version_id, room_activation_status
      from examination_room_v1.room_activations a
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open')
        and a.closes_at > event_time
      order by (a.activation_status = 'scheduled') desc, a.created_at desc, a.id desc
      limit 1
      for update;

      if version_id is null then
        return examination_room_v1.api_error(
          'ROOM_ACTIVATION_NOT_FOUND', 'The administrator has not approved and generated a student key yet.', 409,
          'Request a key, then wait for the administrator to approve this examination.'
        );
      end if;

      if room_activation_status = 'scheduled' then
        update examination_room_v1.room_activations a
        set activation_status = 'open',
            opens_at = least(a.opens_at, event_time, clock_timestamp()),
            deactivated_at = null,
            deactivated_by_user_id = null,
            deactivation_reason = null
        where a.id = version_id;
      end if;
      response := jsonb_build_object(
        'ok', true,
        'examId', exam_id,
        'activationId', version_id,
        'activation', jsonb_build_object('id', version_id, 'status', 'open'),
        'status', 'open'
      );$new$;
begin
  source_definition := pg_catalog.pg_get_functiondef(
    'examination_room_v1.api_professor(text,uuid,uuid,jsonb)'::regprocedure
  );
  patched_definition := replace(source_definition, old_declaration, new_declaration);
  if patched_definition = source_definition then raise exception 'open admission patch: professor declaration not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_session_item, new_session_item);
  if patched_definition = source_definition then raise exception 'open admission patch: professor session item not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_exam_item, new_exam_item);
  if patched_definition = source_definition then raise exception 'open admission patch: professor exam item not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_publish_gate, new_publish_gate);
  if patched_definition = source_definition then raise exception 'open admission patch: first publish gate not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_controls_tail, new_controls_tail);
  if patched_definition = source_definition then raise exception 'open admission patch: controls tail not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_exam_insert, new_exam_insert);
  if patched_definition = source_definition then raise exception 'open admission patch: exam insert not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_exam_update, new_exam_update);
  if patched_definition = source_definition then raise exception 'open admission patch: exam update not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_version_insert, new_version_insert);
  if patched_definition = source_definition then raise exception 'open admission patch: version insert not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_version_values, new_version_values);
  if patched_definition = source_definition then raise exception 'open admission patch: version values not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_version_update, new_version_update);
  if patched_definition = source_definition then raise exception 'open admission patch: version update not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_count_gate, new_count_gate);
  if patched_definition = source_definition then raise exception 'open admission patch: second publish gate not found'; end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_open, new_open);
  if patched_definition = source_definition then raise exception 'open admission patch: open room block not found'; end if;
  execute patched_definition;
end;
$open_admission_professor_patch$;

create or replace function examination_room_v1.prepare_student_admission(p_payload jsonb)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  activation_row examination_room_v1.room_activations%rowtype;
  exam_owner_id uuid;
  student_identity_id uuid;
  roster_id uuid;
  full_name text := btrim(coalesce(p_payload #>> '{identity,realName}', ''));
  student_number text := upper(btrim(coalesce(p_payload #>> '{identity,studentNumber}', '')));
  entered_subject text := btrim(coalesce(p_payload #>> '{identity,subject}', ''));
  entered_year_level text := btrim(coalesce(p_payload #>> '{identity,yearLevel}', ''));
  student_email text := nullif(lower(btrim(coalesce(p_payload #>> '{identity,email}', ''))), '');
  canonical_subject text;
  canonical_year_level text;
  admission_mode text;
  allowed_emails text[];
  use_anonymous_grading boolean;
begin
  select activation.* into activation_row
  from examination_room_v1.room_activations activation
  where activation.key_hash = p_payload ->> 'roomKeyHash'
    and activation.activation_status in ('scheduled', 'open')
    and activation.closes_at > clock_timestamp()
  order by activation.created_at desc, activation.id desc
  limit 1;

  if activation_row.id is null then
    return examination_room_v1.api_error(
      'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
      'Copy the complete current key from the Professor message and try again.'
    );
  end if;

  if length(full_name) not between 2 and 240
     or full_name !~ '[[:alpha:]]'
     or length(student_number) not between 2 and 128
     or length(entered_subject) not between 1 and 160
     or length(entered_year_level) not between 1 and 64 then
    return examination_room_v1.api_error(
      'STUDENT_IDENTITY_INVALID', 'Complete the student name, student number, subject, and year level.', 400,
      'Correct the four student details, then try again with the same key.'
    );
  end if;
  if student_email is not null and (
    length(student_email) not between 3 and 320
    or student_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    return examination_room_v1.api_error(
      'STUDENT_EMAIL_INVALID', 'Enter a valid student email or leave it blank.', 400,
      'Correct the email, then try again.'
    );
  end if;

  select
    exam.owner_user_id,
    exam.anonymous_grading,
    version.admission_mode_snapshot,
    version.allowed_emails_snapshot,
    coalesce(version.controls ->> 'subject', ''),
    coalesce(version.controls ->> 'yearLevel', '')
  into
    exam_owner_id,
    use_anonymous_grading,
    admission_mode,
    allowed_emails,
    canonical_subject,
    canonical_year_level
  from examination_room_v1.exams exam
  join examination_room_v1.exam_versions version on version.id = activation_row.exam_version_id
  where exam.id = activation_row.exam_id
    and exam.institution_id = activation_row.institution_id;

  if admission_mode = 'email_allowlist'
     and (student_email is null or not (student_email = any(allowed_emails))) then
    return examination_room_v1.api_error(
      'STUDENT_EMAIL_NOT_ALLOWED', 'This email is not included in the examination access list.', 403,
      'Check the email spelling or ask the Professor to update the optional email list.'
    );
  end if;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    join examination_room_v1.exam_roster roster on roster.id = session.roster_id
    join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
    where session.activation_id = activation_row.id
      and session.session_status = 'revoked'
      and (
        identity.external_student_id = student_number
        or (
          student_email is not null
          and identity.email_normalized = student_email
        )
      )
  ) then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This entry was removed from the current examination room.', 403,
      'Ask the Professor before trying to enter this activation again.'
    );
  end if;

  insert into examination_room_v1.student_identities (
    institution_id, external_student_id, full_name, email_normalized,
    identity_status, verified_at, verification_method
  ) values (
    activation_row.institution_id,
    student_number,
    full_name,
    student_email,
    'active',
    null,
    null
  )
  on conflict (institution_id, external_student_id) do update
  set full_name = excluded.full_name,
      email_normalized = coalesce(excluded.email_normalized, examination_room_v1.student_identities.email_normalized),
      identity_status = 'active',
      updated_at = clock_timestamp()
  returning id into student_identity_id;

  roster_id := gen_random_uuid();
  insert into examination_room_v1.exam_roster (
    id, exam_id, institution_id, student_identity_id, grading_alias,
    roster_status, accommodations, added_by_user_id
  ) values (
    roster_id,
    activation_row.exam_id,
    activation_row.institution_id,
    student_identity_id,
    case when use_anonymous_grading
      then 'CAND-' || upper(substr(replace(roster_id::text, '-', ''), 1, 8))
      else null end,
    'eligible',
    jsonb_build_object(
      'subject', canonical_subject,
      'yearLevel', canonical_year_level,
      'enteredSubject', entered_subject,
      'enteredYearLevel', entered_year_level,
      'admissionSource', 'room_key_self_entry',
      'extraMinutes', 0
    ),
    exam_owner_id
  )
  on conflict on constraint exam_roster_exam_student_key do update
  set roster_status = case
        when examination_room_v1.exam_roster.roster_status = 'completed' then 'completed'
        else 'eligible'
      end,
      grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
      accommodations = jsonb_build_object(
        'subject', canonical_subject,
        'yearLevel', canonical_year_level,
        'enteredSubject', entered_subject,
        'enteredYearLevel', entered_year_level,
        'admissionSource', 'room_key_self_entry',
        'extraMinutes', coalesce(
          examination_room_v1.exam_roster.accommodations -> 'extraMinutes',
          '0'::jsonb
        )
      ),
      updated_at = clock_timestamp()
  returning id into roster_id;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    where session.activation_id = activation_row.id
      and session.roster_id = roster_id
      and session.session_status = 'revoked'
  ) then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This entry was removed from the current examination room.', 403,
      'Ask the Professor before trying to enter this activation again.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'identity', jsonb_strip_nulls(jsonb_build_object(
      'realName', full_name,
      'studentNumber', student_number,
      'subject', canonical_subject,
      'yearLevel', canonical_year_level,
      'email', student_email
    ))
  );
end;
$$;

revoke all on function examination_room_v1.prepare_student_admission(jsonb)
  from public, anon, authenticated, service_role;

create or replace function examination_room_v1.creator_revoke_session(
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  exam_id uuid := nullif(p_payload ->> 'examId', '')::uuid;
  session_id uuid := nullif(p_payload ->> 'sessionId', '')::uuid;
  request_hash text := p_payload ->> 'requestHash';
  reason text := btrim(coalesce(p_payload ->> 'reason', 'Removed from this examination by the creator.'));
  revoked_at timestamptz := coalesce((p_payload ->> 'revokedAt')::timestamptz, clock_timestamp());
  exam_owner_id uuid;
  current_status text;
  response jsonb;
  replay jsonb;
begin
  select exam.owner_user_id into exam_owner_id
  from examination_room_v1.exams exam
  where exam.id = exam_id
    and exam.institution_id = p_institution_id;

  if exam_owner_id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'The examination does not exist in this workspace.', 404,
      'Return to the Examination Room list and choose an available examination.'
    );
  end if;
  if exam_owner_id <> p_actor_user_id
     and not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'FORBIDDEN', 'Only the examination creator or a platform owner may remove this session.', 403,
      'Choose an examination created by your signed-in account.'
    );
  end if;
  if length(reason) not between 1 and 1000 then
    return examination_room_v1.api_error(
      'REVOCATION_REASON_INVALID', 'Enter a short reason for removing this session.', 400,
      'Enter the reason, then try again.'
    );
  end if;

  perform examination_room_v1.lock_request(p_institution_id, request_hash);
  replay := examination_room_v1.api_replay(
    p_institution_id, request_hash, 'professor.revoke_session'
  );
  if replay is not null then return replay; end if;

  select session.session_status into current_status
  from examination_room_v1.student_sessions session
  where session.id = session_id
    and session.exam_id = exam_id
    and session.institution_id = p_institution_id
  for update;

  if current_status is null then
    return examination_room_v1.api_error(
      'SESSION_NOT_FOUND', 'The student session is no longer available.', 404,
      'Refresh Monitor and choose a current student session.'
    );
  end if;
  if current_status not in ('created', 'active', 'revoked') then
    return examination_room_v1.api_error(
      'SESSION_NOT_ACTIVE', 'Only a currently active examination session can be removed.', 409,
      'Refresh Monitor and choose a student who is still taking the examination.'
    );
  end if;

  update examination_room_v1.student_sessions session
  set session_status = 'revoked',
      ended_at = coalesce(session.ended_at, revoked_at),
      last_heartbeat_at = coalesce(session.last_heartbeat_at, revoked_at),
      session_metadata = session.session_metadata || jsonb_build_object(
        'connected', false,
        'revokedReason', reason,
        'revokedByUserId', p_actor_user_id,
        'revokedAt', revoked_at
      ),
      updated_at = clock_timestamp()
  where session.id = session_id;

  response := jsonb_build_object(
    'ok', true,
    'examId', exam_id,
    'sessionId', session_id,
    'status', 'revoked',
    'alreadyRevoked', current_status = 'revoked',
    'reason', reason,
    'revokedAt', revoked_at
  );
  perform examination_room_v1.api_record_audit(
    p_institution_id, exam_id, session_id, p_actor_user_id, 'professor',
    'professor.revoke_session', 'student_session', session_id, request_hash,
    revoked_at, response, null
  );
  return response;
end;
$$;

revoke all on function examination_room_v1.creator_revoke_session(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.examination_room_v1_api(
  p_scope text,
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
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
  exam_id uuid;
  admission_result jsonb;
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> 'student' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Scope, operation, an object payload, and workspace for creator views are required.', 400,
      'Refresh Examination Room and try again.'
    );
  end if;

  if safe_payload::text ~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:' then
    return examination_room_v1.api_error(
      'RAW_SECRET_REJECTED', 'Only one-way hashes or opaque identifiers may reach examination persistence.', 400,
      'Refresh the page and repeat the action without raw credentials.'
    );
  end if;

  if not (
    (p_scope = 'professor' and p_operation in (
      'session', 'exam', 'monitor', 'grading', 'grading_context', 'release_context',
      'save_draft', 'publish', 'open_room', 'close_room', 'revoke_session',
      'save_grade', 'release_results'
    ))
    or (p_scope = 'student' and p_operation in (
      'preview', 'consent', 'resume', 'result', 'session_context', 'save_answer',
      'record_event', 'heartbeat', 'submit'
    ))
    or (p_scope = 'admin' and p_operation in (
      'overview', 'activate_exam', 'email_key', 'revoke_key', 'create_snapshot'
    ))
  ) then
    return examination_room_v1.api_error(
      'UNKNOWN_OPERATION', 'The requested Examination Room operation is not registered.', 400,
      'Refresh Examination Room and choose a listed action.'
    );
  end if;

  if p_scope = 'professor' then
    if not examination_room_v1.creator_authorized(p_actor_user_id, p_institution_id) then
      return examination_room_v1.api_error(
        'CREATOR_WORKSPACE_REQUIRED', 'A verified account and active law-school workspace are required.', 403,
        'Sign in, choose an active workspace, then retry.'
      );
    end if;
    if p_operation in ('monitor', 'grading') then
      exam_id := nullif(safe_payload ->> 'examId', '')::uuid;
      return examination_room_v1.api_professor_view(
        p_operation, p_actor_user_id, p_institution_id, exam_id
      );
    end if;
    if p_operation = 'revoke_session' then
      return examination_room_v1.creator_revoke_session(
        p_actor_user_id, p_institution_id, safe_payload
      );
    end if;
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = 'admin' then
    if not examination_room_v1.owner_authorized(p_actor_user_id)
       or not exists (
         select 1 from examination_room_v1.institutions institution
         where institution.id = p_institution_id
           and institution.institution_status = 'active'
       ) then
      return examination_room_v1.api_error(
        'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin may use examination administration.', 403,
        'Sign in with a platform-owner account.'
      );
    end if;
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  end if;

  if p_operation in ('preview', 'consent') then
    admission_result := examination_room_v1.prepare_student_admission(safe_payload);
    if admission_result ->> 'ok' = 'false' then return admission_result; end if;
    safe_payload := jsonb_set(
      safe_payload,
      '{identity}',
      admission_result -> 'identity',
      true
    );
  end if;
  return examination_room_v1.api_student(p_operation, safe_payload);
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'A supplied identifier, number, or timestamp is invalid.', 400,
      'Refresh the page, correct the highlighted value, and try again.'
    );
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A newer or duplicate record already exists for this action.', 409,
      'Refresh the current server-backed state, then repeat the action only if still needed.'
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_STATE_INVALID', 'The action does not match the current immutable examination state.', 409,
      'Refresh the examination and retry from the latest saved state.'
    );
  when object_not_in_prerequisite_state then
    return examination_room_v1.api_error(
      'IMMUTABLE_RECORD_SEALED', 'That evidence record is already sealed and cannot be changed.', 409,
      'Refresh the view and create a new revision instead of overwriting sealed evidence.'
    );
  when serialization_failure or deadlock_detected then
    return examination_room_v1.api_error(
      'RETRY_REQUIRED', 'Another examination action completed at the same time.', 409,
      'Refresh the current state and retry the action once.'
    );
  when others then
    return examination_room_v1.api_error(
      'PERSISTENCE_INTERNAL_ERROR', 'The database could not complete the examination action safely.', 500,
      'Your prior server-backed work is preserved. Try again; if it continues, contact support.'
    );
end;
$$;

comment on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb) is
  'Service-only atomic dispatcher. Any verified account may create exams in the default community workspace. Key-only entry self-enrolls valid key holders; allowlist entry checks only the normalized published email list. Exact exam ownership remains mandatory and only Founder/Super Admin may override it.';

revoke all on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb)
  to service_role;

commit;
