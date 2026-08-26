-- Auxiliary diagnostic data is reachable only through owner-checking,
-- security-definer RPCs. The Worker does not need direct table privileges.

begin;

revoke all on table public.auxiliary_writing_diagnostic_jobs from service_role;
revoke all on table public.auxiliary_writing_diagnostics from service_role;

commit;
