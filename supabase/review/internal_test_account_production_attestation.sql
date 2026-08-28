-- READ-ONLY post-migration production attestation.
-- Run only after both 20260828 internal/test reporting migrations are applied.

begin transaction read only;

do $internal_test_attestation$
declare
  v_expected constant text[] := array[
    'wallyesteban1993@gmail.com',
    'tc.mdppa@gmail.com',
    'orientalmindorodebsoc@gmail.com',
    'gilmardecastro05@gmail.com',
    'titanpatrol6969@gmail.com',
    'support.duediligence@gmail.com',
    'perezemricoluiz@gmail.com'
  ];
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260828095004'
  ) or not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260828095534'
  ) then
    raise exception 'INTERNAL_TEST_ATTESTATION_MIGRATION_MISSING';
  end if;

  if to_regclass('private.internal_test_accounts') is null then
    raise exception 'INTERNAL_TEST_ATTESTATION_REGISTRY_MISSING';
  end if;

  if exists (
    select 1
    from unnest(v_expected) expected(email)
    left join auth.users user_row
      on lower(btrim(coalesce(user_row.email, ''))) = expected.email
    group by expected.email
    having count(user_row.id) <> 1
  ) then
    raise exception 'INTERNAL_TEST_ATTESTATION_AUTH_MATCH_NOT_EXACT';
  end if;

  if (select count(*) from private.internal_test_accounts) <> 7 then
    raise exception 'INTERNAL_TEST_ATTESTATION_REGISTRY_COUNT_NOT_SEVEN';
  end if;

  if exists (
    select 1
    from unnest(v_expected) expected(email)
    join auth.users user_row
      on lower(btrim(coalesce(user_row.email, ''))) = expected.email
    left join private.internal_test_accounts classified
      on classified.user_id = user_row.id
     and classified.email_at_classification = expected.email
     and classified.classification_source = 'owner_allowlist_20260828'
    where classified.user_id is null
  ) then
    raise exception 'INTERNAL_TEST_ATTESTATION_ID_MAPPING_MISMATCH';
  end if;
end;
$internal_test_attestation$;

select
  classified.user_id,
  classified.email_at_classification,
  classified.classification_source,
  classified.classified_at,
  coalesce(role_row.role::text, 'student') as current_role
from private.internal_test_accounts classified
left join public.user_roles role_row on role_row.user_id = classified.user_id
order by classified.email_at_classification;

rollback;
