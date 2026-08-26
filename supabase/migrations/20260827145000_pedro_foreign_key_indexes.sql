-- Due Diligence Release 2: cover Pedro foreign-key lookups used by cascades,
-- stale-target validation, and study-content cleanup.
begin;

create index if not exists pedro_turns_thread_owner_idx
  on public.pedro_turns (thread_id, user_id, access_kind);

create index if not exists pedro_actions_turn_owner_idx
  on public.pedro_actions (turn_id, user_id);

create index if not exists pedro_actions_doctrine_content_idx
  on public.pedro_actions (doctrine_content_id)
  where doctrine_content_id is not null;

create index if not exists pedro_actions_syllabus_target_idx
  on public.pedro_actions (syllabus_version_id, syllabus_question_id)
  where syllabus_version_id is not null and syllabus_question_id is not null;

create index if not exists pedro_actions_syllabus_question_idx
  on public.pedro_actions (syllabus_question_id)
  where syllabus_question_id is not null;

commit;
