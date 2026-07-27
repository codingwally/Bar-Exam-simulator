-- STAGING-ONLY NEGATIVE PREFLIGHT FIXTURE.
--
-- Apply after the production-faithful baseline and before the production
-- preflight. The constraint keeps its audited name but points at the wrong
-- table, so the preflight must fail with PHASE1_PREFLIGHT_FOREIGN_KEY_DRIFT.

alter table public.submissions
  drop constraint submissions_question_id_fkey;

alter table public.submissions
  add constraint submissions_question_id_fkey
  foreign key (question_id)
  references public.subjects(id);
