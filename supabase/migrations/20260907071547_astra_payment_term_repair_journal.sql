-- Generic private evidence journal only. No customer identifiers or row repairs.
begin;
create table if not exists public.payment_term_repair_journal (
  repair_key text not null,
  payment_request_id uuid not null,
  subscription_id uuid not null,
  user_id uuid not null,
  actor_user_id uuid not null,
  reason text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  before_sha256 text not null check (before_sha256 ~ '^[a-f0-9]{64}$'),
  after_sha256 text not null check (after_sha256 ~ '^[a-f0-9]{64}$'),
  before_state jsonb not null,
  after_state jsonb not null,
  original_activation_at timestamptz not null,
  purchased_ends_at timestamptz not null,
  original_overall_ends_at timestamptz not null,
  corrected_overall_ends_at timestamptz not null,
  direction text not null check (direction in ('extend','preserve_longer')),
  applied_at timestamptz not null,
  primary key (repair_key,payment_request_id),
  unique (repair_key,subscription_id),
  check (purchased_ends_at = original_activation_at + interval '720 hours'),
  check (corrected_overall_ends_at >= original_overall_ends_at)
);
alter table public.payment_term_repair_journal enable row level security;
revoke all on table public.payment_term_repair_journal from public,anon,authenticated,service_role;
grant select,insert on table public.payment_term_repair_journal to service_role;
comment on table public.payment_term_repair_journal is
  'Astra payment term repair journal v1. Private operator evidence; no public API or policies; before/after hashes and causal recovery guards.';
commit;
