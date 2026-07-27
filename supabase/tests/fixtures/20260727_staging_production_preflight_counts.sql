-- STAGING-ONLY PREFLIGHT CARDINALITY FIXTURE.
--
-- Supplies the audited production counts required by the read-only Phase 1
-- preflight. It contains no production content, Auth users, profiles,
-- submissions, or grading records.

insert into public.subjects (id, name, sort_order)
values
  ('81000000-0000-4000-8000-000000000001', 'Synthetic Subject 1', 1),
  ('81000000-0000-4000-8000-000000000002', 'Synthetic Subject 2', 2),
  ('81000000-0000-4000-8000-000000000003', 'Synthetic Subject 3', 3),
  ('81000000-0000-4000-8000-000000000004', 'Synthetic Subject 4', 4),
  ('81000000-0000-4000-8000-000000000005', 'Synthetic Subject 5', 5),
  ('81000000-0000-4000-8000-000000000006', 'Synthetic Subject 6', 6),
  ('81000000-0000-4000-8000-000000000007', 'Synthetic Subject 7', 7),
  ('81000000-0000-4000-8000-000000000008', 'Synthetic Subject 8', 8);

insert into public.questions (
  id,
  subject_id,
  bar_year,
  question_no,
  prompt_text
)
values
  (
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    2026,
    1,
    'Synthetic preflight question one.'
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    2026,
    2,
    'Synthetic preflight question two.'
  );
