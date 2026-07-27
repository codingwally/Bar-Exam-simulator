-- STAGING-ONLY NEGATIVE PREFLIGHT FIXTURE.
--
-- Apply after the production-faithful baseline and before the production
-- preflight. The preflight must fail with PHASE1_PREFLIGHT_PRIMARY_KEY_DRIFT.

alter table public.grade_disputes
  drop constraint grade_disputes_pkey;

alter table public.grade_disputes
  add constraint grade_disputes_pkey primary key (user_id);
