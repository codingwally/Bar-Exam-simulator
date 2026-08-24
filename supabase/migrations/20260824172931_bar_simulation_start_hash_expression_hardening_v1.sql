-- Correct staging/early installations whose allocation snapshot expression can
-- be parsed as text ->> text because of PostgreSQL operator precedence. Fresh
-- production installs already receive the parenthesized expression in the base
-- migration. This migration is intentionally idempotent for both states.
begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

do $bar_simulation_hash_expression_hardening$
declare
  v_definition text;
  v_old_expression constant text :=
    'item.value->>''questionId'' || '':'' || item.value->>''contentHash''';
  v_fixed_expression constant text :=
    '(item.value->>''questionId'') || '':'' || (item.value->>''contentHash'')';
begin
  select pg_get_functiondef(
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  )
  into v_definition;

  if position(v_old_expression in v_definition) > 0 then
    execute replace(v_definition, v_old_expression, v_fixed_expression);
  elsif position(v_fixed_expression in v_definition) = 0 then
    raise exception 'BAR_SIMULATION_START_HASH_EXPRESSION_UNKNOWN';
  end if;
end;
$bar_simulation_hash_expression_hardening$;

revoke all on function public.bar_simulation_start_attempt_v1(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bar_simulation_start_attempt_v1(uuid, uuid, text, text, text)
  to service_role;

commit;
