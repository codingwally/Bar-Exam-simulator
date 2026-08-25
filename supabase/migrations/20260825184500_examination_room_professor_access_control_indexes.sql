-- Examination Room renovation: cover the three foreign-key lookup paths used
-- for roster cleanup and account deletion. No simulator objects are touched.

begin;

create index if not exists exam_room_candidate_access_roster_idx
  on public.exam_room_candidate_access_controls (roster_id);

create index if not exists exam_room_candidate_access_blocked_by_idx
  on public.exam_room_candidate_access_controls (blocked_by)
  where blocked_by is not null;

create index if not exists exam_room_candidate_access_last_kicked_by_idx
  on public.exam_room_candidate_access_controls (last_kicked_by)
  where last_kicked_by is not null;

commit;
