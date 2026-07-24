-- Curated Labor Law practice service.
-- These tables are private: only the labor-practice Edge Function uses the
-- service role to cache editorial content and queue public feedback.

create table if not exists public.labor_sheet_cache (
  singleton boolean primary key default true check (singleton),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.labor_feedback_log (
  id uuid primary key default gen_random_uuid(),
  question_id text not null check (question_id ~ '^LAB-[0-9]{3}$'),
  question_version text not null,
  submission_id text,
  feedback_type text not null check (feedback_type in ('ENDORSEMENT', 'FLAG', 'SUGGESTED_CORRECTION')),
  suggested_question text,
  suggested_answer text,
  supporting_legal_basis text,
  supporting_jurisprudence text,
  source_url text,
  explanation text,
  contributor text,
  evaluation_result jsonb,
  editorial_decision text not null default 'PENDING' check (editorial_decision in ('PENDING', 'ACCEPTED', 'REJECTED')),
  loop_status text not null default 'OPEN' check (loop_status in ('OPEN', 'UNDER_REVIEW', 'CLOSED')),
  applied_version text,
  change_log_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    loop_status <> 'CLOSED'
    or (applied_version is not null and change_log_id is not null)
  )
);

create index if not exists labor_feedback_log_question_idx
  on public.labor_feedback_log (question_id, question_version, loop_status);

alter table public.labor_sheet_cache enable row level security;
alter table public.labor_feedback_log enable row level security;

-- These records contain private editorial material and public submissions.
-- The service role used by the Edge Function bypasses RLS; browser roles do not.
revoke all on table public.labor_sheet_cache from anon, authenticated;
revoke all on table public.labor_feedback_log from anon, authenticated;
