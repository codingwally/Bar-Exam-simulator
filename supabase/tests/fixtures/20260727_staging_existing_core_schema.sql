-- STAGING-ONLY TEST FIXTURE.
--
-- Reconstructs the Phase 1B production inventory in the authorized disposable
-- staging project. This is not a production migration and must never be
-- included in a production `supabase db push`.
--
-- Production-faithful details intentionally preserved here:
--   * seven public tables and their observed columns/defaults/nullability;
--   * primary keys, foreign keys, existing RLS policies, and legacy grants;
--   * no public functions or non-internal triggers;
--   * no unobserved UNIQUE or CHECK constraints.
--
-- The broad anon/authenticated grants below are intentionally insecure. They
-- reproduce the pre-Phase-1 production baseline so the Phase 1 migration can
-- prove that it removes them.

create extension if not exists pgcrypto;
create extension if not exists pgtap with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  subscription_tier text not null default 'free',
  subscription_status text not null default 'inactive',
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  bar_year integer,
  question_no integer,
  prompt_text text not null,
  model_answer text,
  case_law text,
  rubric_points jsonb not null default '{}'::jsonb,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_text text not null,
  word_count integer,
  time_spent_seconds integer,
  submitted_at timestamptz not null default now()
);

create table if not exists public.grading_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  overall_score numeric,
  passed boolean,
  answer_score numeric,
  legal_basis_score numeric,
  application_score numeric,
  conclusion_score numeric,
  feedback_json jsonb,
  rubric_version text,
  grader_model text,
  graded_at timestamptz not null default now()
);

create table if not exists public.calibration_examples (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  example_answer_text text not null,
  expert_score numeric,
  expert_notes text,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Production-faithful pre-migration legacy table. It intentionally remains
-- empty in staging so Phase 1 can prove a data-preserving rename to
-- question_corrections; any unexpected row makes the migration fail closed.
create table if not exists public.grade_disputes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  admin_notes text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.submissions enable row level security;
alter table public.grading_results enable row level security;
alter table public.calibration_examples enable row level security;
alter table public.grade_disputes enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  using (auth.uid() = id);

create policy profiles_update_own
  on public.profiles
  for update
  using (auth.uid() = id);

create policy subjects_select_all
  on public.subjects
  for select
  using (true);

create policy questions_select_all
  on public.questions
  for select
  using (true);

create policy submissions_select_own
  on public.submissions
  for select
  using (auth.uid() = user_id);

create policy submissions_insert_own
  on public.submissions
  for insert
  with check (auth.uid() = user_id);

create policy grading_results_select_own
  on public.grading_results
  for select
  using (
    exists (
      select 1
      from public.submissions s
      where s.id = grading_results.submission_id
        and s.user_id = auth.uid()
    )
  );

create policy grade_disputes_select_own
  on public.grade_disputes
  for select
  using (auth.uid() = user_id);

create policy grade_disputes_insert_own
  on public.grade_disputes
  for insert
  with check (auth.uid() = user_id);

-- Supabase's legacy table defaults exposed broad table privileges to both API
-- roles. RLS limited rows, but UPDATE on profiles still covered protected
-- columns. Phase 1C must revoke and replace these grants.
grant all privileges on table
  public.profiles,
  public.subjects,
  public.questions,
  public.submissions,
  public.grading_results,
  public.calibration_examples,
  public.grade_disputes
to anon, authenticated, service_role;
