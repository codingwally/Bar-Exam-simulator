-- Private payment-verifier directory for Due Diligence.
--
-- The authorized recipient addresses are operational configuration and are
-- intentionally not committed to this public repository. Production rows are
-- inserted separately through an owner-authorized, service-role operation.

begin;

create table if not exists public.payment_verification_recipients (
  email text primary key,
  enabled boolean not null default true,
  display_order smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_verification_recipients_email_check check (
    email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint payment_verification_recipients_order_check check (
    display_order between 1 and 100
  )
);

create unique index if not exists payment_verification_recipients_order_uidx
  on public.payment_verification_recipients (display_order)
  where enabled;

alter table public.payment_verification_recipients enable row level security;
alter table public.payment_verification_recipients force row level security;

revoke all on table public.payment_verification_recipients
  from public, anon, authenticated;
grant select on table public.payment_verification_recipients to service_role;

comment on table public.payment_verification_recipients
  is 'Private service-role-only directory of owner-approved recipients for payment-proof verification notifications.';
comment on column public.payment_verification_recipients.email
  is 'Normalized authorized verifier address. Values are configured privately and are not committed to the public repository.';
comment on column public.payment_verification_recipients.display_order
  is 'Deterministic notification order. The first enabled row is the visible To recipient; remaining rows receive BCC.';

commit;
