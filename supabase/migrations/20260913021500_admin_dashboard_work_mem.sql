-- Keep the setting local to the dashboard snapshot RPC. Production profiling
-- showed the default work_mem spilling dashboard aggregates to temporary disk.

begin;

alter function public.admin_dashboard_snapshot_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) set work_mem to '16MB';

commit;
