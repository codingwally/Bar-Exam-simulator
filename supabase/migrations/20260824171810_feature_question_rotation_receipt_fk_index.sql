-- Cover the private issuance foreign key used by durable Bar Question Practice
-- receipts. This is additive and has no runtime behavior change.

begin;

set local lock_timeout = '2s';
set local statement_timeout = '5min';

create index if not exists feature_question_rotation_receipts_issuance_idx
  on public.feature_question_rotation_receipts (issuance_id)
  where issuance_id is not null;

commit;
