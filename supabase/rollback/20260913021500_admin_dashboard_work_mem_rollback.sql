begin;

alter function public.admin_dashboard_snapshot_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) reset work_mem;

commit;
