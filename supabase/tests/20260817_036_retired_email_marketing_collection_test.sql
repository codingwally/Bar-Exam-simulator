-- Staging-only behavioral coverage for the retired marketing-consent RPC.
-- Existing rows must remain unchanged and all test state is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_marketing_consent(boolean,text,text)',
    'EXECUTE'
  ),
  'authenticated stale clients may call the compatibility tombstone'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_marketing_consent(boolean,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the retired marketing-consent RPC'
);

create temporary table marketing_consent_before as
select
  count(*)::bigint as row_count,
  md5(coalesce(jsonb_agg(to_jsonb(mc) order by mc.id)::text, '[]')) as row_digest
from public.marketing_consents mc;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000099',
  true
);
set local role authenticated;

select lives_ok(
  $test$select public.record_marketing_consent(true, 'legacy-v1', 'cached_account')$test$,
  'a stale opt-in call is safely absorbed'
);
select lives_ok(
  $test$select public.record_marketing_consent(false, 'legacy-v1', 'cached_account')$test$,
  'a stale withdrawal call is safely absorbed'
);

reset role;

select is(
  (select count(*)::bigint from public.marketing_consents),
  (select row_count from marketing_consent_before),
  'legacy calls create no marketing-consent rows'
);
select is(
  (
    select md5(coalesce(jsonb_agg(to_jsonb(mc) order by mc.id)::text, '[]'))
    from public.marketing_consents mc
  ),
  (select row_digest from marketing_consent_before),
  'legacy calls leave all historical marketing-consent rows unchanged'
);

select * from finish();
rollback;
