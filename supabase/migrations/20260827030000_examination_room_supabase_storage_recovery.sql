begin;

-- Recovery objects are encrypted by the Worker before upload. The bucket stays
-- private and has no browser-facing policy; only the server-held service role
-- can materialize or retrieve a checkpoint.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage is unavailable; refusing to configure Examination Room recovery';
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
  'examination-room-recovery',
  'examination-room-recovery',
  false,
  10485760,
  array['application/vnd.duediligence.examination-room-recovery+json']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
