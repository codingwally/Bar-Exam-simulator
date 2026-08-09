-- Repair the administrator-as-professor ownership invariant for Examination Room.
-- Administrators are authorized by exam_room_is_professor(), but classroom and
-- examination ownership is intentionally constrained to exam_room_professors.
-- Lazily materialize only an authorized administrator's non-active owner row so
-- the FK remains intact without granting a durable professor entitlement. The
-- administrator continues to be authorized solely by the existing admin role.

begin;

create or replace function public.exam_room_create_classroom(
  p_professor_user_id uuid,
  p_title text,
  p_school_name text default null,
  p_academic_term text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);

  if public.exam_room_is_admin(p_professor_user_id) then
    insert into public.exam_room_professors (
      user_id, status, activated_by
    ) values (
      p_professor_user_id, 'revoked', p_professor_user_id
    )
    on conflict (user_id) do nothing;
  end if;

  if char_length(btrim(p_title)) not between 2 and 200
    or (p_school_name is not null and char_length(p_school_name) > 300)
    or (p_academic_term is not null and char_length(p_academic_term) > 160)
  then raise exception 'EXAM_ROOM_CLASS_INVALID'; end if;

  insert into public.exam_room_classrooms (
    owner_professor_id, title, school_name, academic_term
  ) values (
    p_professor_user_id, btrim(p_title), nullif(btrim(p_school_name), ''), nullif(btrim(p_academic_term), '')
  ) returning * into v_class;

  insert into public.exam_room_audit_log (
    actor_user_id, classroom_id, action
  ) values (p_professor_user_id, v_class.id, 'classroom_created');

  return jsonb_build_object('classroomId', v_class.public_id, 'title', v_class.title);
end;
$$;

revoke all on function public.exam_room_create_classroom(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_create_classroom(uuid, text, text, text)
  to service_role;

commit;
