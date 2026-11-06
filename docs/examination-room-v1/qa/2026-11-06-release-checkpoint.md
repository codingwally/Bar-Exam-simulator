# Midterm release checkpoint — 6 November 2026

PR #419 remains a draft. This is evidence, not release approval.

## Verified database state

The direct Supabase connection reached production project `hbllomlijfznnuudpdvr`
and existing staging project `hlzqmreeoghbldnhlybr`. Both were healthy.
Production has the September submission-intent and audit-hash hotfixes, but
does not yet have the November durable-intake migration. A read-only inventory
counted 7 exams, 37 sessions, 18,370 answer revisions, 23 submissions and 23
receipts. No production schema or record was changed.

Staging lacked submission-intent support. Its student API definition was
captured before replacing it with the production definition under migration
`examination_room_staging_submission_production_baseline`. The additive
`examination_room_durable_submission` migration was then applied to staging.
The original staging definition is retained in its historical migration ledger;
the exported production API is checked in as a test fixture, without student data.

All 151 database assertions passed on hosted staging in a transaction ending
with ROLLBACK. Dummy identities, questions and answers were used. This covers
interrupted finalization, frozen intake preservation, failed backup attempts,
server recovery, one official receipt, replay, and access denial. The local
database harness also passed against the exported production student API.
The historical upgrade tests run independently against repository functions.
All 278 JavaScript tests passed.

The first hosted run exposed six outdated test assumptions: recorded-media
storage was absent from the expected table list; its deliberately revoked
service-role table grants were treated as an error; the private recovery helper
was not included in the security-definer inventory; and three key-envelope
assertions searched only scheduled activations despite immediate key opening.
The tests now recognize these deployed contracts and continue to verify no
direct API-role execution of private functions or access to private tables.

## Release remains blocked on implementation and verification

- Google-bound admission and cross-device resumption, official student receipt
  email, complete snapshot capture before per-answer reconciliation, and the
  requested timing/interface changes remain unfinished.
- The 151 assertions are database tests, not a browser-to-email end-to-end test.
  No real provider delivery has been verified.
- Production backup/rollback rehearsal, staging Worker/browser verification,
  deployment and live dummy-answer verification remain pending.
- The existing GitHub staging/production workflows reference Cloudflare
  credentials. Use those protected workflows rather than requiring a new
  cloud-browser login or copying secrets into chat.

For the current remote head, Home display, Debate V3, and soft-launch validation
passed. The promotional-media transfer workflow failed and is unrelated to the
examination changes. Recheck workflows after subsequent commits.

Do not enable `EXAMINATION_ROOM_DURABLE_INTAKE` in production yet. Keep the
feature off on rollback; retain the intake schema and preserved records and
reconcile pending jobs before switching runtimes.

## Complete snapshot before reconciliation — continuation

The route now validates and freezes pending answer writes into the intake payload
before issuing any per-answer save calls. Scheduled recovery replays those writes
in the finalization savepoint; a failed answer write or unconfirmed receipt rolls
back reconciliation while preserving the complete intake for retry. Successful
finalization removes token verifiers from both the outer payload and pending writes.
Duplicate submitted question references are rejected. Legacy feature-off behavior
remains compatible.

309 JavaScript tests and 157 database assertions passed locally, including the
exported production student function and historical upgrade checks. The new
`20261106011130_examination_room_snapshot_before_reconciliation.sql` migration
was applied to hosted staging, where a read-only check confirmed its definition
and denied anon/authenticated execution. The full hosted test call expired at
confirmation and did NOT run; do not count the local 157 as hosted evidence.

The shell has no GitHub authentication. Git push failed with missing credentials;
the connected GitHub API can preserve the branch but exposes no workflow-dispatch
operation. `gh auth status` confirms no authenticated host. Production and staging
Worker releases therefore still need a working protected workflow execution path.
No production schema, data, or deployment was changed.
