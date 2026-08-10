-- Examination Room five-step revision workspace.
--
-- Professors may revisit and correct Steps 1-3 until publication. Question
-- corrections append a new immutable version; they never rewrite the prior
-- reviewed version. Professors may review Steps 4-5, while the assigned Beadle
-- may safely reopen a pre-exam class list only by revoking the current student
-- code and issuing a new one after the correction.

begin;

-- A Professor may deliberately return to the exact wording of an earlier
-- reviewed version. Idempotency is enforced by request receipts, while the
-- version number preserves the human revision history. A content-hash unique
-- constraint would incorrectly reject that legitimate re-correction.
alter table public.exam_room_question_versions
  drop constraint if exists exam_room_question_versions_exam_id_snapshot_hash_key;

alter table public.exam_room_exams
  add column if not exists workspace_revision bigint not null default 1;

alter table public.exam_room_exams
  drop constraint if exists exam_room_exams_workspace_revision_check;
alter table public.exam_room_exams
  add constraint exam_room_exams_workspace_revision_check
  check (workspace_revision >= 1);

create or replace function public.exam_room_bump_workspace_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.exam_room_backup_update', true), '') = 'on' then
    new.workspace_revision := old.workspace_revision;
    return new;
  end if;
  new.workspace_revision := old.workspace_revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Bind the atomic class-handoff publication to the exact workspace revision
-- the Professor reviewed. The v3 publisher remains the single implementation
-- of scheduling/publication/invitation atomicity; this wrapper adds optimistic
-- authoring concurrency and its own replay-safe receipt.
create or replace function public.exam_room_publish_for_beadle_v4(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_revision bigint,
  p_rules jsonb,
  p_grading_key_hash text,
  p_beadle_email text,
  p_beadle_token_hash text,
  p_beadle_expires_at timestamptz,
  p_beadle_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedRevision', p_expected_revision,
    'rules', p_rules,
    'gradingCredentialHash', p_grading_key_hash,
    'beadleEmail', lower(btrim(coalesce(p_beadle_email, ''))),
    'beadleCredentialHash', p_beadle_token_hash,
    'beadleExpiresAt', p_beadle_expires_at,
    'beadleReason', p_beadle_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'publish_for_beadle_v4', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;

  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if p_expected_revision is null
    or p_expected_revision <> v_exam.workspace_revision
  then raise exception 'EXAM_ROOM_WORKSPACE_CONFLICT'; end if;

  v_response := public.exam_room_publish_for_beadle_v3(
    p_professor_user_id,
    p_exam_public_id,
    p_rules,
    p_grading_key_hash,
    p_beadle_email,
    p_beadle_token_hash,
    p_beadle_expires_at,
    p_beadle_reason,
    p_request_key
  );
  if not coalesce((v_response ->> 'ok')::boolean, false)
  then raise exception 'EXAM_ROOM_PUBLICATION_FAILED'; end if;
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'publish_for_beadle_v4', p_request_key,
    v_request, v_response
  );
end;
$$;

drop trigger if exists exam_room_workspace_revision_v1
  on public.exam_room_exams;
create trigger exam_room_workspace_revision_v1
before update on public.exam_room_exams
for each row execute function public.exam_room_bump_workspace_revision_v1();

create table if not exists public.exam_room_authoring_drafts (
  exam_id uuid primary key references public.exam_room_exams(id) on delete cascade,
  rules_draft jsonb not null check (
    jsonb_typeof(rules_draft) = 'object'
    and octet_length(rules_draft::text) <= 65536
  ),
  beadle_email text not null check (
    beadle_email = lower(btrim(beadle_email))
    and beadle_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  workspace_revision bigint not null check (workspace_revision >= 1),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.exam_room_authoring_drafts enable row level security;
alter table public.exam_room_authoring_drafts force row level security;
revoke all privileges on table public.exam_room_authoring_drafts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_room_authoring_drafts
  to service_role;

-- Authoring changes are backed up independently from publication and attempt
-- evidence. The outbox remains append-only and formula-neutralized downstream.
alter table public.exam_room_backup_outbox
  drop constraint if exists exam_room_backup_outbox_event_type_check;
alter table public.exam_room_backup_outbox
  add constraint exam_room_backup_outbox_event_type_check
  check (event_type in (
    'exam_confirmed', 'roster_imported', 'attempt_submitted', 'grades_released',
    'dispute_opened', 'dispute_closed', 'admin_correction', 'exam_erratum',
    'publication_replaced', 'submission_reopened', 'admin_break_glass',
    'exam_details_revised', 'exam_questions_revised',
    'exam_rules_draft_saved', 'exam_roster_reopened'
  ));

create or replace function public.exam_room_professor_authoring_snapshot_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_version public.exam_room_question_versions%rowtype;
  v_source public.exam_room_question_sources%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_draft public.exam_room_authoring_drafts%rowtype;
  v_questions jsonb := '[]'::jsonb;
  v_attempts_exist boolean := false;
  v_editable boolean := false;
  v_roster_count integer := 0;
  v_beadle_assigned boolean := false;
  v_beadle_invited boolean := false;
  v_student_access_ready boolean := false;
  v_student_access_issued_at timestamptz;
  v_can_reopen_roster boolean := false;
  v_blocker text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select exists (
    select 1 from public.exam_room_attempts attempt
    where attempt.exam_id = v_exam.id
  ) into v_attempts_exist;
  v_editable := v_exam.current_publication_id is null
    and not v_attempts_exist
    and v_exam.status in ('draft', 'confirmed', 'scheduled');

  if v_exam.active_question_version_id is not null then
    select * into v_version
    from public.exam_room_question_versions version
    where version.id = v_exam.active_question_version_id
      and version.exam_id = v_exam.id;
    if found then
      select * into v_source
      from public.exam_room_question_sources source
      where source.id = v_version.source_id;
      select coalesce(jsonb_agg(jsonb_build_object(
        'questionId', question.id,
        'ordinal', question.ordinal,
        'prompt', question.prompt_text,
        'maximumPoints', question.maximum_points
      ) order by question.ordinal), '[]'::jsonb)
      into v_questions
      from public.exam_room_questions question
      where question.question_version_id = v_version.id;
    end if;
  end if;

  if v_exam.current_publication_id is not null then
    select * into v_publication
    from public.exam_room_publications publication
    where publication.id = v_exam.current_publication_id
      and publication.exam_id = v_exam.id;
  end if;

  select * into v_draft
  from public.exam_room_authoring_drafts draft
  where draft.exam_id = v_exam.id;

  select count(*)::integer into v_roster_count
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active';
  select exists (
    select 1 from public.exam_room_beadle_assignments assignment
    where assignment.exam_id = v_exam.id
      and assignment.status = 'active'
      and assignment.expires_at > clock_timestamp()
  ) into v_beadle_assigned;
  select exists (
    select 1 from public.exam_room_beadle_invitations invitation
    where invitation.exam_id = v_exam.id
      and invitation.status = 'issued'
      and invitation.expires_at > clock_timestamp()
  ) into v_beadle_invited;
  select exists (
    select 1
    from public.exam_room_student_access_issuances issuance
    join public.exam_room_credentials credential on credential.id = issuance.credential_id
    where issuance.exam_id = v_exam.id
      and issuance.status = 'active'
      and credential.status = 'active'
      and credential.credential_type = 'student_exam'
      and credential.expires_at > clock_timestamp()
  ), max(issuance.issued_at) filter (where issuance.status = 'active')
  into v_student_access_ready, v_student_access_issued_at
  from public.exam_room_student_access_issuances issuance
  where issuance.exam_id = v_exam.id;

  v_can_reopen_roster := v_exam.current_publication_id is not null
    and v_exam.status = 'scheduled'
    and v_exam.opens_at is not null
    and clock_timestamp() < v_exam.opens_at
    and not v_attempts_exist
    and v_student_access_ready;

  v_blocker := case
    when v_attempts_exist then 'CANDIDATE_ATTEMPTS_EXIST'
    when v_exam.current_publication_id is not null then 'ALREADY_PUBLISHED'
    when v_exam.status not in ('draft', 'confirmed', 'scheduled') then 'EXAM_STATE_BLOCKED'
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'workspaceRevision', v_exam.workspace_revision,
    'status', v_exam.status,
    'published', v_exam.current_publication_id is not null,
    'serverNow', clock_timestamp(),
    'details', jsonb_build_object(
      'title', v_exam.title,
      'instructions', v_exam.instructions,
      'questionCount', v_exam.requested_question_count,
      'integrityPreset', v_exam.integrity_preset,
      'includeQuestionnaire', v_exam.include_questionnaire,
      'updatedAt', v_exam.updated_at
    ),
    'questions', jsonb_build_object(
      'questionVersionId', v_version.id,
      'versionNumber', v_version.version_number,
      'questionCount', v_version.question_count,
      'sourceFileName', v_source.safe_file_name,
      'confirmedAt', v_version.confirmed_at,
      'rows', v_questions
    ),
    'rulesDraft', case when v_draft.exam_id is null then null else jsonb_build_object(
      'rules', v_draft.rules_draft,
      'beadleEmail', v_draft.beadle_email,
      'updatedAt', v_draft.updated_at
    ) end,
    'capabilities', jsonb_build_object(
      'canEditDetails', v_editable,
      'canEditQuestions', v_editable,
      'canEditRules', v_editable and v_exam.status in ('confirmed', 'scheduled')
        and v_version.question_count = v_exam.requested_question_count,
      'canReviewRoster', v_exam.current_publication_id is not null,
      'canReviewHandout', v_exam.current_publication_id is not null,
      'canReopenRoster', v_can_reopen_roster
    ),
    'blockers', jsonb_build_object(
      'details', v_blocker,
      'questions', case
        when v_exam.active_question_version_id is null then 'QUESTIONS_NOT_READY'
        else v_blocker
      end,
      'rules', case
        when v_exam.active_question_version_id is null
          or v_version.question_count is distinct from v_exam.requested_question_count
          then 'QUESTIONS_NOT_READY'
        else v_blocker
      end,
      'roster', case when v_exam.current_publication_id is null then 'NOT_PUBLISHED' else null end,
      'handout', case when not v_student_access_ready then 'STUDENT_ACCESS_NOT_READY' else null end,
      'reopenRoster', case
        when v_can_reopen_roster then null
        when v_attempts_exist then 'CANDIDATE_ATTEMPTS_EXIST'
        when v_exam.opens_at is not null and clock_timestamp() >= v_exam.opens_at then 'EXAM_ALREADY_OPEN'
        else 'STUDENT_ACCESS_NOT_READY'
      end
    ),
    'publication', case when v_publication.id is null then null else jsonb_build_object(
      'publicationId', v_publication.public_id,
      'publicationNumber', v_publication.publication_number,
      'title', v_publication.title_snapshot,
      'instructions', v_publication.instructions_snapshot,
      'questionCount', v_publication.question_count,
      'publishedAt', v_publication.published_at,
      'opensAt', v_publication.rules_snapshot ->> 'opensAt',
      'hardClosesAt', v_publication.rules_snapshot ->> 'hardClosesAt',
      'rules', v_publication.rules_snapshot
    ) end,
    'handoff', jsonb_build_object(
      'rosterCount', v_roster_count,
      'beadleAssigned', v_beadle_assigned,
      'beadleInvitationIssued', v_beadle_invited,
      'studentAccessReady', v_student_access_ready,
      'studentAccessIssuedAt', v_student_access_issued_at,
      'examPath', '#examination-room?exam=' || v_exam.public_id::text,
      'canReopenRoster', v_can_reopen_roster,
      'reopenRosterBlocker', case when v_can_reopen_roster then null else 'EXAM_ROOM_ROSTER_REOPEN_NOT_ALLOWED' end
    )
  );
end;
$$;

create or replace function public.exam_room_update_details_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_instructions text,
  p_requested_question_count integer,
  p_integrity_preset text,
  p_include_questionnaire boolean,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_active_count integer;
  v_questions_require_review boolean;
  v_request jsonb;
  v_response jsonb;
  v_outbox_id uuid;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedRevision', p_expected_revision,
    'title', p_title,
    'instructions', p_instructions,
    'questionCount', p_requested_question_count,
    'integrityPreset', p_integrity_preset,
    'includeQuestionnaire', p_include_questionnaire
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'update_exam_details_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is not null
    or v_exam.status not in ('draft', 'confirmed', 'scheduled')
    or exists (select 1 from public.exam_room_attempts attempt where attempt.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_AUTHORING_LOCKED'; end if;
  if p_expected_revision is null or p_expected_revision <> v_exam.workspace_revision
  then raise exception 'EXAM_ROOM_WORKSPACE_CONFLICT'; end if;
  if p_title is null
    or char_length(btrim(p_title)) not between 1 and 200
    or char_length(coalesce(p_instructions, '')) > 10000
    or p_requested_question_count not between 1 and 200
    or p_integrity_preset not in ('open_book', 'standard', 'strict')
    or p_include_questionnaire is null
  then raise exception 'EXAM_ROOM_EXAM_INVALID'; end if;

  select version.question_count into v_active_count
  from public.exam_room_question_versions version
  where version.id = v_exam.active_question_version_id
    and version.exam_id = v_exam.id;
  v_questions_require_review := v_exam.active_question_version_id is null
    or v_active_count is distinct from p_requested_question_count;

  update public.exam_room_exams exam
  set title = btrim(p_title),
      instructions = coalesce(p_instructions, ''),
      requested_question_count = p_requested_question_count,
      integrity_preset = p_integrity_preset,
      include_questionnaire = p_include_questionnaire,
      status = case
        when v_questions_require_review then 'draft'
        when exam.status = 'draft' and exam.active_question_version_id is not null then 'confirmed'
        else exam.status
      end
  where exam.id = v_exam.id
  returning * into v_exam;

  v_outbox_id := public.exam_room_queue_backup(
    v_exam.id,
    'exam_details_revised',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'workspaceRevision', v_exam.workspace_revision,
      'title', v_exam.title,
      'instructions', v_exam.instructions,
      'questionCount', v_exam.requested_question_count,
      'integrityPreset', v_exam.integrity_preset,
      'includeQuestionnaire', v_exam.include_questionnaire,
      'questionsRequireReview', v_questions_require_review
    )
  );
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null,
    'exam_authoring', v_exam.id, 'exam_details_revised', p_request_key,
    jsonb_build_object(
      'workspaceRevision', v_exam.workspace_revision,
      'questionCount', v_exam.requested_question_count,
      'questionsRequireReview', v_questions_require_review,
      'backupOutboxId', v_outbox_id
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'workspaceRevision', v_exam.workspace_revision,
    'questionsRequireReview', v_questions_require_review,
    'questionVersionId', (
      select version.id from public.exam_room_question_versions version
      where version.id = v_exam.active_question_version_id
    )
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'update_exam_details_v1', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_revise_draft_questions_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_revision bigint,
  p_expected_question_version_id uuid,
  p_questions jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_current public.exam_room_question_versions%rowtype;
  v_new public.exam_room_question_versions%rowtype;
  v_row jsonb;
  v_ordinal integer;
  v_expected_ordinal integer := 1;
  v_prompt text;
  v_points numeric;
  v_count integer;
  v_snapshot_hash text;
  v_request jsonb;
  v_response jsonb;
  v_outbox_id uuid;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedRevision', p_expected_revision,
    'expectedQuestionVersionId', p_expected_question_version_id,
    'questions', p_questions
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'revise_draft_questions_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is not null
    or v_exam.status not in ('draft', 'confirmed', 'scheduled')
    or exists (select 1 from public.exam_room_attempts attempt where attempt.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_AUTHORING_LOCKED'; end if;
  if p_expected_revision is null or p_expected_revision <> v_exam.workspace_revision
  then raise exception 'EXAM_ROOM_WORKSPACE_CONFLICT'; end if;
  select * into v_current
  from public.exam_room_question_versions version
  where version.id = p_expected_question_version_id
    and version.id = v_exam.active_question_version_id
    and version.exam_id = v_exam.id
  for update;
  if not found then raise exception 'EXAM_ROOM_QUESTION_VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_questions) <> 'array'
  then raise exception 'EXAM_ROOM_QUESTIONS_INVALID'; end if;
  v_count := jsonb_array_length(p_questions);
  if v_count < 1 or v_count > 200 or v_count <> v_exam.requested_question_count
  then raise exception 'EXAM_ROOM_QUESTION_COUNT_MISMATCH'; end if;

  for v_row in select value from jsonb_array_elements(p_questions)
  loop
    if jsonb_typeof(v_row) <> 'object'
      or not (v_row ?& array['ordinal', 'prompt', 'maximumPoints'])
    then raise exception 'EXAM_ROOM_QUESTIONS_INVALID'; end if;
    begin
      v_ordinal := (v_row ->> 'ordinal')::integer;
      v_points := (v_row ->> 'maximumPoints')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'EXAM_ROOM_QUESTIONS_INVALID';
    end;
    v_prompt := v_row ->> 'prompt';
    if v_ordinal <> v_expected_ordinal
      or char_length(btrim(coalesce(v_prompt, ''))) not between 1 and 50000
      or v_points <= 0 or v_points > 1000
    then raise exception 'EXAM_ROOM_QUESTIONS_INVALID'; end if;
    v_expected_ordinal := v_expected_ordinal + 1;
  end loop;

  v_snapshot_hash := public.exam_room_hash_json(p_questions);
  if v_snapshot_hash = v_current.snapshot_hash then
    -- A count correction can intentionally bring Step 1 back into agreement
    -- with this already-reviewed version. Restore Step 2 readiness instead of
    -- leaving the Professor trapped in draft status.
    if v_exam.status = 'draft' then
      update public.exam_room_exams exam
      set status = 'confirmed'
      where exam.id = v_exam.id
      returning * into v_exam;
    end if;
    v_response := jsonb_build_object(
      'ok', true, 'examId', v_exam.public_id,
      'status', v_exam.status,
      'workspaceRevision', v_exam.workspace_revision,
      'questionVersionId', v_current.id,
      'versionNumber', v_current.version_number,
      'questionCount', v_current.question_count,
      'noChange', true
    );
    return public.exam_room_command_complete_v2(
      p_professor_user_id, 'revise_draft_questions_v1', p_request_key, v_request, v_response
    );
  end if;

  insert into public.exam_room_question_versions (
    exam_id, source_id, version_number, question_count,
    snapshot_hash, status, confirmed_by
  ) values (
    v_exam.id, v_current.source_id,
    (select coalesce(max(version.version_number), 0) + 1
      from public.exam_room_question_versions version where version.exam_id = v_exam.id),
    v_count, v_snapshot_hash, 'confirmed', p_professor_user_id
  ) returning * into v_new;

  for v_row in select value from jsonb_array_elements(p_questions)
  loop
    insert into public.exam_room_questions (
      question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
    ) values (
      v_new.id,
      (v_row ->> 'ordinal')::integer,
      v_row ->> 'prompt',
      (v_row ->> 'maximumPoints')::numeric,
      encode(extensions.digest(
        pg_catalog.convert_to(v_row ->> 'prompt', 'UTF8'), 'sha256'
      ), 'hex')
    );
  end loop;

  update public.exam_room_question_versions version
  set status = 'retired'
  where version.id = v_current.id;
  update public.exam_room_exams exam
  set active_question_version_id = v_new.id,
      status = 'confirmed'
  where exam.id = v_exam.id
  returning * into v_exam;

  v_outbox_id := public.exam_room_queue_backup(
    v_exam.id,
    'exam_questions_revised',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'workspaceRevision', v_exam.workspace_revision,
      'questionVersionId', v_new.id,
      'versionNumber', v_new.version_number,
      'questionCount', v_count,
      'questions', p_questions
    )
  );
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null,
    'exam_questions', v_new.id, 'exam_questions_revised', p_request_key,
    jsonb_build_object(
      'workspaceRevision', v_exam.workspace_revision,
      'previousVersionNumber', v_current.version_number,
      'versionNumber', v_new.version_number,
      'questionCount', v_count,
      'backupOutboxId', v_outbox_id
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'workspaceRevision', v_exam.workspace_revision,
    'questionVersionId', v_new.id,
    'versionNumber', v_new.version_number,
    'questionCount', v_count,
    'noChange', false
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'revise_draft_questions_v1', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_save_rules_draft_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_revision bigint,
  p_rules jsonb,
  p_beadle_email text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_unknown_key text;
  v_outbox_id uuid;
  v_updated_at timestamptz;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedRevision', p_expected_revision,
    'rules', p_rules,
    'beadleEmail', lower(btrim(coalesce(p_beadle_email, '')))
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'save_rules_draft_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is not null
    or v_exam.status not in ('confirmed', 'scheduled')
    or exists (select 1 from public.exam_room_attempts attempt where attempt.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_AUTHORING_LOCKED'; end if;
  if p_expected_revision is null or p_expected_revision <> v_exam.workspace_revision
  then raise exception 'EXAM_ROOM_WORKSPACE_CONFLICT'; end if;
  if p_beadle_email is null
    or lower(btrim(p_beadle_email)) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or char_length(p_beadle_email) > 254
    or jsonb_typeof(p_rules) <> 'object'
    or octet_length(p_rules::text) > 65536
    or public.exam_room_json_has_forbidden_key(p_rules)
  then raise exception 'EXAM_ROOM_RULES_INVALID'; end if;
  select key into v_unknown_key
  from jsonb_object_keys(p_rules) key
  where key not in (
    'opensAt', 'hardClosesAt', 'durationMinutes', 'lateAdmissionMinutes',
    'submissionGraceMinutes', 'allowedMaterials', 'navigationMode',
    'integrityMode', 'fullscreenPolicy', 'admissionMode',
    'temporaryLeaveAcknowledgment', 'suggestedAnswerMode',
    'suggestedAnswer', 'suggestedAnswerObjectPath', 'aiGradingEnabled',
    'studentAccessCodeRequired'
  ) limit 1;
  if v_unknown_key is not null then raise exception 'EXAM_ROOM_RULE_UNKNOWN'; end if;
  begin
    if not (p_rules ?& array[
        'opensAt', 'hardClosesAt', 'durationMinutes', 'lateAdmissionMinutes',
        'submissionGraceMinutes', 'allowedMaterials', 'navigationMode',
        'integrityMode', 'fullscreenPolicy', 'admissionMode',
        'temporaryLeaveAcknowledgment', 'suggestedAnswerMode',
        'aiGradingEnabled', 'studentAccessCodeRequired'
      ])
      or (p_rules ->> 'opensAt')::timestamptz >= (p_rules ->> 'hardClosesAt')::timestamptz
      or (
        jsonb_typeof(p_rules -> 'durationMinutes') <> 'null'
        and (p_rules ->> 'durationMinutes')::integer not between 1 and 480
      )
      or (p_rules ->> 'lateAdmissionMinutes')::integer not between 0 and 480
      or (p_rules ->> 'submissionGraceMinutes')::integer not between 0 and 120
      or jsonb_typeof(p_rules -> 'allowedMaterials') <> 'string'
      or char_length(p_rules ->> 'allowedMaterials') > 2000
      or (p_rules ->> 'navigationMode') <> 'free'
      or (p_rules ->> 'integrityMode') not in ('off', 'record_only', 'warn_and_record')
      or (p_rules ->> 'fullscreenPolicy') not in ('off', 'requested', 'required_with_exemptions')
      or (p_rules ->> 'admissionMode') not in ('automatic', 'beadle_approval')
      or jsonb_typeof(p_rules -> 'temporaryLeaveAcknowledgment') <> 'boolean'
      or (p_rules ->> 'suggestedAnswerMode') not in ('none', 'paste')
      or coalesce((p_rules ->> 'studentAccessCodeRequired')::boolean, false) is not true
      or coalesce((p_rules ->> 'aiGradingEnabled')::boolean, true)
      or (
        (p_rules ->> 'suggestedAnswerMode') = 'paste'
        and char_length(btrim(coalesce(p_rules ->> 'suggestedAnswer', ''))) not between 1 and 100000
      )
      or (
        (p_rules ->> 'suggestedAnswerMode') = 'none'
        and nullif(btrim(coalesce(p_rules ->> 'suggestedAnswer', '')), '') is not null
      )
    then raise exception 'EXAM_ROOM_RULES_INVALID'; end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_RULES_INVALID';
  end;

  update public.exam_room_exams exam
  set updated_at = clock_timestamp()
  where exam.id = v_exam.id
  returning * into v_exam;
  insert into public.exam_room_authoring_drafts (
    exam_id, rules_draft, beadle_email,
    workspace_revision, updated_by, updated_at
  ) values (
    v_exam.id, p_rules, lower(btrim(p_beadle_email)),
    v_exam.workspace_revision, p_professor_user_id, clock_timestamp()
  )
  on conflict (exam_id) do update
  set rules_draft = excluded.rules_draft,
      beadle_email = excluded.beadle_email,
      workspace_revision = excluded.workspace_revision,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning updated_at into v_updated_at;

  v_outbox_id := public.exam_room_queue_backup(
    v_exam.id,
    'exam_rules_draft_saved',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'workspaceRevision', v_exam.workspace_revision,
      'rules', p_rules,
      'beadleEmail', lower(btrim(p_beadle_email)),
      'updatedAt', v_updated_at
    )
  );
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null,
    'exam_authoring', v_exam.id, 'exam_rules_draft_saved', p_request_key,
    jsonb_build_object(
      'workspaceRevision', v_exam.workspace_revision,
      'backupOutboxId', v_outbox_id
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'workspaceRevision', v_exam.workspace_revision,
    'rulesDraftUpdatedAt', v_updated_at
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'save_rules_draft_v1', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_reopen_roster_v1(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_issuance public.exam_room_student_access_issuances%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_outbox_id uuid;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'reopen_exam_roster_v1', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not (
    v_exam.owner_professor_id = p_actor_user_id
    or public.exam_room_has_active_beadle_assignment_v2(p_actor_user_id, v_exam.id)
  ) then raise exception 'EXAM_ROOM_OPERATOR_REQUIRED'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_REASON_REQUIRED'; end if;
  if v_exam.current_publication_id is null
    or v_exam.status <> 'scheduled'
    or v_exam.opens_at is null
    or clock_timestamp() >= v_exam.opens_at
    or exists (select 1 from public.exam_room_attempts attempt where attempt.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_ROSTER_REOPEN_NOT_ALLOWED'; end if;
  select * into v_issuance
  from public.exam_room_student_access_issuances issuance
  where issuance.exam_id = v_exam.id
    and issuance.status = 'active'
  for update;
  if not found then raise exception 'EXAM_ROOM_ROSTER_REOPEN_NOT_ALLOWED'; end if;

  update public.exam_room_credentials credential
  set status = 'revoked',
      revoked_by = p_actor_user_id,
      revoked_at = clock_timestamp(),
      revoke_reason = btrim(p_reason)
  where credential.id = v_issuance.credential_id
    and credential.status = 'active';
  update public.exam_room_student_access_issuances issuance
  set status = 'revoked',
      revoked_by = p_actor_user_id,
      revoked_at = clock_timestamp(),
      revoke_reason = btrim(p_reason),
      code_ciphertext = null,
      code_nonce = null,
      code_key_id = null,
      code_algorithm = null,
      code_encrypted_at = null
  where issuance.id = v_issuance.id;
  update public.exam_room_exams exam
  set updated_at = clock_timestamp()
  where exam.id = v_exam.id
  returning * into v_exam;

  v_outbox_id := public.exam_room_queue_backup(
    v_exam.id,
    'exam_roster_reopened',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'workspaceRevision', v_exam.workspace_revision,
      'studentAccessRevoked', true,
      'reason', btrim(p_reason)
    )
  );
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null,
    'exam_roster', v_exam.id, 'exam_roster_reopened', p_request_key,
    jsonb_build_object(
      'workspaceRevision', v_exam.workspace_revision,
      'studentAccessRevoked', true,
      'backupOutboxId', v_outbox_id
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'workspaceRevision', v_exam.workspace_revision,
    'studentAccessReady', false,
    'rosterLocked', false,
    'codeRevoked', true
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'reopen_exam_roster_v1', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_beadle_portal_v5(
  p_user_id uuid,
  p_exam_public_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_can_reopen boolean := false;
begin
  v_base := public.exam_room_beadle_portal_v4(p_user_id, p_exam_public_id);
  if p_exam_public_id is null then return v_base; end if;
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_can_reopen := (
    v_exam.owner_professor_id = p_user_id
    or public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id)
  )
    and v_exam.current_publication_id is not null
    and v_exam.status = 'scheduled'
    and v_exam.opens_at is not null
    and clock_timestamp() < v_exam.opens_at
    and not exists (
      select 1 from public.exam_room_attempts attempt where attempt.exam_id = v_exam.id
    )
    and exists (
      select 1 from public.exam_room_student_access_issuances issuance
      where issuance.exam_id = v_exam.id and issuance.status = 'active'
    );
  return v_base || jsonb_build_object(
    'canReopenRoster', v_can_reopen,
    'reopenRosterBlocker', case when v_can_reopen then null else 'EXAM_ROOM_ROSTER_REOPEN_NOT_ALLOWED' end
  );
end;
$$;

revoke all on function public.exam_room_bump_workspace_revision_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.exam_room_professor_authoring_snapshot_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_professor_authoring_snapshot_v1(uuid, uuid)
  to service_role;
revoke all on function public.exam_room_update_details_v1(
  uuid, uuid, bigint, text, text, integer, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.exam_room_update_details_v1(
  uuid, uuid, bigint, text, text, integer, text, boolean, text
) to service_role;
revoke all on function public.exam_room_revise_draft_questions_v1(
  uuid, uuid, bigint, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.exam_room_revise_draft_questions_v1(
  uuid, uuid, bigint, uuid, jsonb, text
) to service_role;
revoke all on function public.exam_room_save_rules_draft_v1(
  uuid, uuid, bigint, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_save_rules_draft_v1(
  uuid, uuid, bigint, jsonb, text, text
) to service_role;
revoke all on function public.exam_room_reopen_roster_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_reopen_roster_v1(uuid, uuid, text, text)
  to service_role;
revoke all on function public.exam_room_publish_for_beadle_v4(
  uuid, uuid, bigint, jsonb, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_publish_for_beadle_v4(
  uuid, uuid, bigint, jsonb, text, text, text, timestamptz, text, text
) to service_role;
revoke all on function public.exam_room_beadle_portal_v5(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_beadle_portal_v5(uuid, uuid)
  to service_role;

comment on table public.exam_room_authoring_drafts is
  'Private, owner-only draft of Step 3 examination rules before immutable publication.';
comment on column public.exam_room_exams.workspace_revision is
  'Monotonic optimistic-concurrency revision for the Professor authoring workspace.';

commit;
