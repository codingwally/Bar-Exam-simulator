-- Due Diligence Phase 1: curated Labor Law corpus foundation.
-- This migration is additive. It does not modify the legacy `questions`,
-- `submissions`, or `grading_results` tables until the approved importer exists.

create extension if not exists pgcrypto;

create table if not exists public.curated_content_sources (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('OFFICIAL_BAR', 'OFFICIAL_CASE', 'STATUTE', 'RULE', 'EDITORIAL', 'OTHER')),
  canonical_url text not null unique,
  title text not null,
  rights_note text not null,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curated_labor_questions (
  id uuid primary key default gen_random_uuid(),
  stable_id text not null unique check (stable_id ~ '^LABOR-[0-9]{3}$'),
  subject text not null default 'Labor Law and Social Legislation' check (subject = 'Labor Law and Social Legislation'),
  topic text not null,
  source_type text not null check (source_type in ('OFFICIAL_BAR', 'ADAPTED')),
  source_id uuid not null references public.curated_content_sources(id),
  bar_year integer,
  bar_item_no text,
  prompt_text text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  release_status text not null default 'DRAFT' check (release_status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED')),
  corpus_version integer not null default 1 check (corpus_version > 0),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curated_labor_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.curated_labor_questions(id) on delete cascade,
  answer_text text not null,
  answer_source_id uuid references public.curated_content_sources(id),
  rights_note text not null,
  release_status text not null default 'DRAFT' check (release_status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED')),
  corpus_version integer not null default 1 check (corpus_version > 0),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curated_legal_authorities (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.curated_content_sources(id),
  authority_type text not null check (authority_type in ('CONSTITUTION', 'STATUTE', 'RULE', 'JURISPRUDENCE', 'REGULATION')),
  citation text not null,
  decision_date date,
  pinpoint text not null,
  authority_text text not null,
  verification_status text not null default 'DRAFT' check (verification_status in ('DRAFT', 'VERIFIED', 'RETIRED')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, citation, pinpoint)
);

create table if not exists public.curated_doctrines (
  id uuid primary key default gen_random_uuid(),
  authority_id uuid not null references public.curated_legal_authorities(id) on delete cascade,
  doctrine_text text not null,
  source_pinpoint text not null,
  verification_status text not null default 'DRAFT' check (verification_status in ('DRAFT', 'VERIFIED', 'RETIRED')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curated_question_authorities (
  question_id uuid not null references public.curated_labor_questions(id) on delete cascade,
  authority_id uuid not null references public.curated_legal_authorities(id) on delete cascade,
  relationship text not null check (relationship in ('CONTROLLING', 'SUPPORTING', 'DISTINGUISHING')),
  notes text,
  primary key (question_id, authority_id)
);

create table if not exists public.curated_labor_rubrics (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.curated_labor_questions(id) on delete cascade,
  alac_component text not null check (alac_component in ('ANSWER', 'LEGAL_BASIS', 'APPLICATION', 'CONCLUSION')),
  criterion_id text not null,
  criterion_text text not null,
  authority_id uuid references public.curated_legal_authorities(id),
  maximum_points integer not null check (maximum_points > 0 and maximum_points <= 100),
  expected_proposition text not null,
  release_status text not null default 'DRAFT' check (release_status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, alac_component, criterion_id)
);

create table if not exists public.curated_content_reviews (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('QUESTION', 'ANSWER', 'AUTHORITY', 'DOCTRINE', 'RUBRIC')),
  entity_id uuid not null,
  status text not null check (status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists curated_labor_questions_release_idx
  on public.curated_labor_questions (release_status, stable_id);
create index if not exists curated_legal_authorities_status_idx
  on public.curated_legal_authorities (verification_status);
create index if not exists curated_labor_rubrics_question_idx
  on public.curated_labor_rubrics (question_id, release_status);

-- Legal content is private by default. Only server-side functions using the
-- service role may retrieve answer keys, authorities, doctrines, and rubrics.
alter table public.curated_content_sources enable row level security;
alter table public.curated_labor_questions enable row level security;
alter table public.curated_labor_answers enable row level security;
alter table public.curated_legal_authorities enable row level security;
alter table public.curated_doctrines enable row level security;
alter table public.curated_question_authorities enable row level security;
alter table public.curated_labor_rubrics enable row level security;
alter table public.curated_content_reviews enable row level security;
