# Phase 2 production deployment and recovery

## Non-negotiable order

1. Fresh production identity and read-only preflight.
2. Additive database migration in one transaction.
3. Post-migration database verification.
4. Worker secret configuration and compatibility deployment.
5. Existing grading and corrections verification.
6. Frontend deployment.
7. Strict Worker deployment with legacy compatibility disabled.
8. Live guest, authentication, onboarding, Support, mobile, and console checks.

The frontend must not expose the new guest or Support flow until the database
and Worker are healthy.

## Preflight and data preservation

Run `supabase/review/phase2_production_preflight.sql` through the authenticated
production SQL editor only after confirming project
`hbllomlijfznnuudpdvr`. Stop on any changed identity, missing Phase 1 object,
unexpected Phase 2 object, nonzero user-data table, incorrect subject count,
missing migration ledger entry, or changed question count.

Record the existing row counts before and after the transaction. Phase 2 must
not alter existing subjects, questions, submissions, grading results,
corrections, profiles, or roles.

## Migration application

Do not use `supabase db push` unless the remote migration ledger has first been
proved to contain every earlier local migration. The minimal-risk production
method is direct execution of only
`supabase/migrations/20260728_003_phase2_guest_access_support.sql` inside an
explicit transaction, followed by the reviewed `20260728` ledger entry in that
same transaction.

If any statement fails, the transaction must roll back and deployment stops.
Do not continue to Worker or frontend deployment.

## Worker rollout

Configure these names without printing their values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GUEST_USAGE_HMAC_KEY`

The first Worker deployment temporarily sets `ALLOW_LEGACY_GUESTS=true`. This
preserves the currently deployed frontend while the backend is upgraded. Verify
the existing grading and correction endpoints before merging the frontend.

After the frontend is live and sending guest request headers, deploy the Worker
again with `ALLOW_LEGACY_GUESTS=false`. Verify that the fourth guest grade is
blocked before question-bank or Gemini access.

## Application rollback

The known healthy pre-Phase-2 references are:

- Git tag: `pre-phase2-production-20260728`
- Main commit: `edf22255a43eaabee69dedfd59b4e9f382974fae`
- Worker version: `83382377-66e9-472e-90f4-cea64f63582c`

If Worker grading, corrections, authentication, navigation, or guest access
regresses, restore the known healthy Worker version and redeploy the tagged
frontend. Leave the additive Phase 2 database objects in place but inactive.

A Git revert is not a database rollback. Removing or changing database objects
requires separately reviewed forward-recovery SQL. Never improvise destructive
rollback SQL during an incident.

If the migration partially fails outside the expected transaction, stop,
preserve evidence, confirm the actual database inventory, and prepare reviewed
forward-recovery SQL before any further write.

## Synthetic verification and cleanup

Use uniquely marked synthetic identifiers. Verify:

- guest counts 0, 1, 2, and 3;
- the third request receives its complete result;
- the fourth request is rejected before Gemini;
- a failed provider call releases its reservation;
- authenticated access bypasses guest quota;
- local-state loss maps only to the intended recovery record;
- Support rejects exam answers and stores approved fields;
- Google callback, onboarding RPCs, account updates, and logout work;
- all eight subjects and 320 public questions remain available.

Delete only the exact synthetic guest usage tree, Support record, test Auth
user/profile/role/terms/consent records, and correction record by their captured
UUIDs. Never reset legitimate quota counters or truncate shared tables.

## Stop conditions

Stop without deploying further when:

- production identity or row counts differ from the approved baseline;
- the preflight or any regression test fails;
- the migration is not fully transactional;
- a required secret or Google provider credential is unavailable;
- public question reads, grading, or corrections regress;
- RLS or least-privilege access would need to be weakened;
- a secret appears in repository content, logs, or public responses;
- two repair attempts fail or confidence falls below 90%.

