-- Harden feature-scoped rotation before any Worker opts in.
--
-- Durable receipts make every request key replayable even after later
-- selections. Soft transition exclusions never alter the authoritative
-- candidate inventory, and hidden-item restoration requires server evidence
-- that the same user received the exact issuance during the browser's
-- seven-day resumable-workspace window. This selector is deliberately scoped
-- to Bar Question Practice. The other two features have different allocation
-- units and receive separate versioned RPCs.

begin;

create table if not exists public.feature_question_issuances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_key text not null,
  subject text not null,
  request_key text not null check (
    request_key ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  question_id text not null check (
    char_length(btrim(question_id)) between 2 and 160
  ),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  foreign key (user_id, feature_key, subject)
    references public.feature_question_rotations(user_id, feature_key, subject)
    on delete cascade,
  unique (user_id, feature_key, subject, request_key),
  check (feature_key = 'bar_question_practice'),
  check (expires_at > issued_at)
);

create index if not exists feature_question_issuances_restore_idx
  on public.feature_question_issuances (
    user_id, feature_key, subject, question_id, expires_at desc
  );

alter table public.feature_question_issuances enable row level security;
alter table public.feature_question_issuances force row level security;
revoke all on public.feature_question_issuances
  from public, anon, authenticated;
grant select, insert, update, delete on public.feature_question_issuances
  to service_role;

comment on table public.feature_question_issuances is
  'Server-only, owner-bound evidence that a Bar Question Practice item was issued for a resumable workspace.';

create table if not exists public.feature_question_rotation_receipts (
  user_id uuid not null,
  feature_key text not null,
  subject text not null,
  request_key text not null check (
    request_key ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  request_fingerprint text not null check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  issuance_id uuid references public.feature_question_issuances(id)
    on delete restrict,
  question_id text,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, feature_key, subject, request_key),
  foreign key (user_id, feature_key, subject)
    references public.feature_question_rotations(user_id, feature_key, subject)
    on delete cascade
);

create index if not exists feature_question_rotation_receipts_restore_idx
  on public.feature_question_rotation_receipts (
    user_id, feature_key, subject, question_id
  )
  where question_id is not null;

alter table public.feature_question_rotation_receipts enable row level security;
alter table public.feature_question_rotation_receipts force row level security;
revoke all on public.feature_question_rotation_receipts
  from public, anon, authenticated;
grant select, insert, update, delete on public.feature_question_rotation_receipts
  to service_role;

comment on table public.feature_question_rotation_receipts is
  'Server-only idempotency and prior-issuance evidence for feature-scoped question selection.';

create or replace function public.select_feature_question_v2(
  p_user_id uuid,
  p_feature_key text,
  p_subject text,
  p_candidate_question_ids text[],
  p_soft_exclude_question_ids text[],
  p_request_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_feature_key text := lower(btrim(coalesce(p_feature_key, '')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_candidates text[];
  v_soft_exclusions text[];
  v_answered text[] := '{}'::text[];
  v_unanswered text[] := '{}'::text[];
  v_fresh text[] := '{}'::text[];
  v_selection_pool text[] := '{}'::text[];
  v_issued text[] := '{}'::text[];
  v_selected text;
  v_issuance_id uuid;
  v_issuance_expires_at timestamptz;
  v_cycle_number integer;
  v_fingerprint text;
  v_state public.feature_question_rotations%rowtype;
  v_receipt public.feature_question_rotation_receipts%rowtype;
  v_result jsonb;
begin
  if p_user_id is null
     or v_feature_key <> 'bar_question_practice'
     or char_length(v_subject) not between 2 and 160
     or v_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise exception 'FEATURE_QUESTION_SELECTION_INVALID';
  end if;

  if cardinality(coalesce(p_candidate_question_ids, '{}'::text[])) not between 1 and 500
     or exists (
       select 1
       from unnest(coalesce(p_candidate_question_ids, '{}'::text[])) raw_id
       where char_length(btrim(raw_id)) not between 2 and 160
     )
  then
    raise exception 'FEATURE_QUESTION_CANDIDATES_INVALID';
  end if;

  if cardinality(coalesce(p_soft_exclude_question_ids, '{}'::text[])) > 40
     or exists (
       select 1
       from unnest(coalesce(p_soft_exclude_question_ids, '{}'::text[])) raw_id
       where char_length(btrim(raw_id)) not between 2 and 160
     )
  then
    raise exception 'FEATURE_QUESTION_EXCLUSIONS_INVALID';
  end if;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_candidates
  from (
    select distinct btrim(raw_id) as candidate_id
    from unnest(p_candidate_question_ids) raw_id
  ) candidates;

  select coalesce(array_agg(question_id order by question_id), '{}'::text[])
  into v_soft_exclusions
  from (
    select distinct btrim(raw_id) as question_id
    from unnest(coalesce(p_soft_exclude_question_ids, '{}'::text[])) raw_id
  ) exclusions;

  v_fingerprint := encode(digest(
    jsonb_build_object(
      'feature', v_feature_key,
      'subject', v_subject,
      'candidates', to_jsonb(v_candidates),
      'softExclusions', to_jsonb(v_soft_exclusions)
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'feature-question-rotation:' || p_user_id::text || ':'
      || v_feature_key || ':' || lower(v_subject),
    0
  ));

  insert into public.feature_question_rotations (
    user_id, feature_key, subject
  )
  values (p_user_id, v_feature_key, v_subject)
  on conflict (user_id, feature_key, subject) do nothing;

  select * into v_receipt
  from public.feature_question_rotation_receipts
  where user_id = p_user_id
    and feature_key = v_feature_key
    and subject = v_subject
    and request_key = v_request_key;

  if v_receipt.request_key is not null then
    if v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'FEATURE_QUESTION_REQUEST_CONFLICT';
    end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_state
  from public.feature_question_rotations
  where user_id = p_user_id
    and feature_key = v_feature_key
    and subject = v_subject
  for update;

  select coalesce(array_agg(distinct a.question_bank_id), '{}'::text[])
  into v_answered
  from public.exam_attempts a
  where a.user_id = p_user_id
    and lower(btrim(a.subject)) = lower(v_subject)
    and nullif(btrim(a.answer_text), '') is not null
    and a.question_bank_id = any(v_candidates);

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_unanswered
  from unnest(v_candidates) candidate_id
  where not (candidate_id = any(v_answered));

  if cardinality(v_unanswered) = 0 then
    v_result := jsonb_build_object(
      'feature', v_feature_key,
      'subject', v_subject,
      'questionId', null,
      'questionCount', cardinality(v_candidates),
      'answeredCount', cardinality(v_answered),
      'unansweredCount', 0,
      'remainingUnissued', 0,
      'cycleNumber', v_state.cycle_number,
      'exhausted', true,
      'replayed', false
    );

    insert into public.feature_question_rotation_receipts (
      user_id, feature_key, subject, request_key,
      request_fingerprint, question_id, result
    ) values (
      p_user_id, v_feature_key, v_subject, v_request_key,
      v_fingerprint, null, v_result
    );

    update public.feature_question_rotations
    set last_question_id = null,
        last_request_key = v_request_key,
        last_result = v_result,
        updated_at = now()
    where user_id = p_user_id
      and feature_key = v_feature_key
      and subject = v_subject;
    return v_result;
  end if;

  v_issued := coalesce(v_state.issued_question_ids, '{}'::text[]);
  v_cycle_number := v_state.cycle_number;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_fresh
  from unnest(v_unanswered) candidate_id
  where not (candidate_id = any(v_issued));

  if cardinality(v_fresh) = 0 then
    v_cycle_number := v_cycle_number + 1;
    v_issued := case
      when cardinality(v_unanswered) > 1
       and v_state.last_question_id = any(v_unanswered)
      then array[v_state.last_question_id]::text[]
      else '{}'::text[]
    end;

    select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
    into v_fresh
    from unnest(v_unanswered) candidate_id
    where not (candidate_id = any(v_issued));
  end if;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_selection_pool
  from unnest(v_fresh) candidate_id
  where not (candidate_id = any(v_soft_exclusions));

  if cardinality(v_selection_pool) = 0 then
    v_selection_pool := v_fresh;
  end if;

  select candidate_id
  into v_selected
  from unnest(v_selection_pool) candidate_id
  order by gen_random_uuid()
  limit 1;

  if nullif(v_selected, '') is null then
    raise exception 'FEATURE_QUESTION_SELECTION_UNAVAILABLE';
  end if;

  v_issued := array_append(v_issued, v_selected);
  v_issuance_id := gen_random_uuid();
  v_issuance_expires_at := now() + interval '7 days';
  v_result := jsonb_build_object(
    'feature', v_feature_key,
    'subject', v_subject,
    'questionId', v_selected,
    'questionCount', cardinality(v_candidates),
    'answeredCount', cardinality(v_answered),
    'unansweredCount', cardinality(v_unanswered),
    'remainingUnissued', greatest(cardinality(v_fresh) - 1, 0),
    'cycleNumber', v_cycle_number,
    'issuanceId', v_issuance_id,
    'issuanceExpiresAt', v_issuance_expires_at,
    'exhausted', false,
    'replayed', false
  );

  update public.feature_question_rotations
  set cycle_number = v_cycle_number,
      issued_question_ids = v_issued,
      last_question_id = v_selected,
      last_request_key = v_request_key,
      last_result = v_result,
      updated_at = now()
  where user_id = p_user_id
    and feature_key = v_feature_key
      and subject = v_subject;

  insert into public.feature_question_issuances (
    id, user_id, feature_key, subject, request_key,
    question_id, issued_at, expires_at
  ) values (
    v_issuance_id, p_user_id, v_feature_key, v_subject, v_request_key,
    v_selected, now(), v_issuance_expires_at
  );

  insert into public.feature_question_rotation_receipts (
    user_id, feature_key, subject, request_key,
    request_fingerprint, issuance_id, question_id, result
  ) values (
    p_user_id, v_feature_key, v_subject, v_request_key,
    v_fingerprint, v_issuance_id, v_selected, v_result
  );

  return v_result;
end;
$$;

create or replace function public.feature_question_restore_authorized_v2(
  p_user_id uuid,
  p_feature_key text,
  p_subject text,
  p_question_id text,
  p_issuance_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select lower(btrim(coalesce(p_feature_key, ''))) = 'bar_question_practice'
    and p_user_id is not null
    and p_issuance_id is not null
    and exists (
      select 1
      from public.feature_question_issuances issuance
      where issuance.id = p_issuance_id
        and issuance.user_id = p_user_id
        and issuance.feature_key = 'bar_question_practice'
        and lower(btrim(issuance.subject)) = lower(btrim(coalesce(p_subject, '')))
        and issuance.question_id = btrim(coalesce(p_question_id, ''))
        and issuance.issued_at <= now()
        and issuance.expires_at >= now()
    );
$$;

revoke all on function public.select_feature_question_v1(
  uuid, text, text, text[], text
) from public, anon, authenticated, service_role;
drop function public.select_feature_question_v1(uuid, text, text, text[], text);

revoke all on function public.select_feature_question_v2(
  uuid, text, text, text[], text[], text
) from public, anon, authenticated;
grant execute on function public.select_feature_question_v2(
  uuid, text, text, text[], text[], text
) to service_role;

revoke all on function public.feature_question_restore_authorized_v2(
  uuid, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.feature_question_restore_authorized_v2(
  uuid, text, text, text, uuid
) to service_role;

commit;
