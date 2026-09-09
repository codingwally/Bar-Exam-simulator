# Operations and controlled release

Controlled staging work has occurred in Supabase project `hlzqmreeoghbldnhlybr` and Worker `duediligence-examinations-staging`. The [two additive migrations, hosted rollback and permission checks](evidence/staging-database-20260909.json) are recorded. The [staging-only cleanup helper](evidence/staging-hosted-cleanup-helper-20260909.json) was also installed after native PostgreSQL CI; its migration-ledger bytes and both function bodies match the reviewed source, and actual unprivileged database calls are denied. The helper remains outside production migration discovery.

The [first restricted Worker deployment](evidence/staging-deploy-34352333268.json) passed configuration preservation but failed its authenticated smoke step; its temporary accounts were cleaned. That receipt does not establish the complete hosted organizer rehearsal. Valid-fixture cleanup through the hosted REST API, immediate logout fencing, the full rehearsal and physical-media verification remain separate evidence gates. PostgREST timeout hoisting remains unverified. No production deployment, public launch, quota purchase or real Debate email/media session is authorized by this document.

The [first hosted preparation](evidence/staging-prepare-hosted-34358904483.json) failed after one real sign-in because the fixture runner rejected the server's valid opaque 12-character refresh token and REST session metadata. No deployment or Debate event was requested. The private bucket was created and verified, and retained. A [separate exact-account reconciliation](evidence/staging-prepare-hosted-34358904483-reconciliation.json) removed the held session, refresh credential and synthetic account after guarded ownership/reference checks; an independent readback confirmed absence. The failed attempt remains failed, and its old-bearer denial and immediate logout fencing remain unverified. The revised runner retains received credentials only in memory, qualifies cleanup access with the fixed Auth server, and normalizes expiry from the authenticated JWT. Fresh CI and a new successful preparation are required before the long rehearsal. The [scoped database advisor readback](evidence/staging-helper-security-advisors-20260909.json) records the existing unrelated warnings separately.

## Configuration

The later [successful eleven-account preparation](evidence/staging-prepare-hosted-34362629625.json) verified real immediate Auth/Worker logout denial, the empty-scope cleanup RPC and exact account absence. [Hosted run 34363892777](evidence/staging-hosted-rehearsal-34363892777.json) subsequently deployed `c03d122334fbf1da1373c7008b282f53bc5fceac` as Worker version `a2fcbb39-2203-48d7-9ca9-224e4c798492`; preservation, exact assets and authenticated allow/exclude smoke passed. Its current baseline fingerprint is `6d8026d840bc88e74cc8f0efdfa6f66f3bf389fb5c7c03f51aa31e6717e77c73`. The browser failed after creating its first event because fixture validation expected a UUID instead of the service's generated `de-` identifier. All eleven sessions were fenced; ten accounts were deleted and the host plus its event were held. This is a failed rehearsal, with no timed stage completed. Review the staging-only exact-definition helper upgrade and its native CI before applying it; reconcile the held data separately and obtain fresh preparation evidence before retrying. The older preparation cannot authorize a changed candidate or baseline.

Existing Supabase, LiveKit, origin validation and approved outgoing-mail infrastructure remain the integration points. Never put service-role keys, mail keys, invitation secrets or media tokens in the static artifact, audit output or screenshots.

| Setting | Safe initial state and purpose |
|---|---|
| `DEBATE_ROOM_ENABLED` | Omitted/false. Set true only for approved public release. Public release must then permit ordinary signed-in accounts independently of payment. |
| `DEBATE_PREVIEW_ACTOR_IDS` | Explicit test account UUIDs only for protected preview. Empty denies preview access. |
| `DEBATE_MEDIA_ENABLED` | Omitted/false until the provider and actual operating limits are verified. |
| `DEBATE_SWEEPER_ENABLED` | Omitted/false until migrations and the dedicated minutely scheduler are deployed and observed. Media also requires this flag. |
| `DEBATE_APPROVED_MAX_PARTICIPANTS` | No assumed value. A verified integer 1–100; all roles count. A value below100 leaves the 100-person target unverified. |
| `DEBATE_PLATFORM_OPERATOR_IDS` | Exact authenticated platform operator UUIDs, server configuration only. Default none. Does not grant ordinary users retention authority. |
| `DEBATE_RESULTS_EMAIL_MODE` / `OUTBOUND_EMAIL_MODE` | Both must explicitly permit delivery. Default suppressed. Test recipient approvals remain mandatory. |
| `DEBATE_APPROVED_REHEARSAL_RECIPIENT_IDS` | Exact approved account UUIDs for results mail; never all site users. |
| `DEBATE_INVITATION_EMAIL_MODE` | Omitted/suppressed. Explicitly enabled only for authorized invitation sends, alongside the global mail gate. |
| `DEBATE_APPROVED_REHEARSAL_RECIPIENT_EMAILS` | Exact approved email addresses for rehearsal invitations to people who may not yet be event members. |
| `DEBATE_RESULTS_EMAIL_FROM` / `DEBATE_INVITATION_EMAIL_FROM` | Verified approved sender. Invitation sender falls back to the results sender. |
| `RESEND_API_KEY` | Existing approved server-only mail credential; never in static assets or evidence. |
| `DEBATE_STORAGE_BUCKET` | Optional override of the dedicated private bucket; default `debate-private-v3`. Verify privacy on every write. |
| Private evidence/export bucket | Dedicated `debate-private-v3`; verify its private setting before writes. No public object URLs. |

These are deployment controls. Their configured values are not evidence of remaining provider capacity, functioning cron, real delivery, or approval. Inventory the actual account concurrency, participant-minutes, transfer, storage, current Study Room commitments and reconnect headroom. The planning example of100 people for63 minutes is6,300 participant-minutes before setup/preparation/judging. Do not quote it as an account allowance or peso cost.

## Additive database rollout

Review the CLI-timestamped candidates `supabase/migrations/20260909080139_debate_room_v3.sql` and `supabase/migrations/20260909080143_study_room_admission_v3.sql`. The Debate draft is the review source for its new service-only schema; the Study change retains the prior v1 RPC contracts for already-running clients. Hash the final files only after review is complete.

Apply only these reviewed migrations to the resolved disposable staging database after confirming its identity. Do not blindly push all historical migration files. Verify grants/RLS as service_role and unprivileged roles, current-token reauthorization, revision conflicts, job-claim exclusivity, current-result downloads, expired invitations, pending admission, Library permissions, cleanup/hold and orphan-file deletion. Roll back probe transactions and remove only approved synthetic fixtures and their private objects.

Take an approved backup/snapshot and record restoration instructions before production. An additive rollback first disables new Debate entry and new media joins. Keep the cleanup-capable Worker and sweeper running until every active provider session is revoked and queued lifecycle deletion is reconciled; only then restore the prior Worker/Pages releases. Retain new event/history tables for recovery and do not drop user records. Restore the old Study v1 caller when reverting its UI/backend together. Preserve the privacy of pending entrants and the Inner Chamber during rollback.

## Scheduler and monitoring

The added `* * * * *` dispatch runs only Debate maintenance. The existing two-minute scheduled operations remain on their original path. Each job keeps a durable claim and receipt; interrupted work is retried without treating a missing response as failure of the underlying competition action. Media revocation cannot be cancelled. Failed exports or email do not erase final results.

Monitor sanitized counts and ages for queued/failed jobs, overdue revocations, scheduler lag/backlog, pending uploads, storage deletions, capacity refusals, stale clocks, and provider reconnect failures. Do not log private messages, scorecard notes, email addresses or tokens. An accepted email and provider message ID establish acceptance only; inbox delivery must be separately verified. Diagnose a stalled queue before increasing concurrency or retry rate.

Lifecycle deletion jobs cannot be cancelled. A documented operator hold pauses eligible retention while keeping durable retry state. Operational/chat/evidence/official retention values are proposed preview defaults (30/30/90/365 days), requiring owner review before public launch. Cleanup needs approved policy, actual event end and no documented hold. Test deletion and retry on controlled records; do not purge unrelated site data or imply a downloaded certificate can be remotely erased.

## Staging and production sequence

1. Finish the candidate, local suite, UI walkthrough and export QA. Record the exact SHA/tree/source manifest and all unresolved ledger gates.
2. Resolve a Debate backend staging target and disposable database. The superior recovery task's `duediligence-asset-recovery-preview` and `duediligence-site-recovery` backup are excluded. Existing legacy staging workflows still reference retired Examination Room behavior and must not be used blindly or weakened to pass.
3. Prepare the target-specific reviewed configuration, apply the two additive migrations, provision/verify the private bucket within existing approved resources, then deploy the exact Worker and Pages artifact to a protected preview. Keep real mail/media suppressed until their approvals and tests are ready. Record deployment IDs, origin/config verification, exact asset hashes and authenticated positive/negative cases.
4. Complete the physical device matrix, at-least90-minute full rehearsal, actual provider revocation tests, approved capacity ramp, recipient delivery and recovery checks. Record exact limitations rather than infer them from synthetic runs.
5. Present the concrete candidate and evidence for any still-required public-launch/operating-policy approval. An email requesting Gilmar's approval is not approval.
6. After authorization and passing gates, deploy Worker first and Pages second through an approved exact-SHA workflow. Verify the actual public desktop/mobile entries, direct route, refresh/auth return, free/paid access, live assets, API authorization, Study repairs and cleanup. Keep candidate/merged/deployed/live-verified states separate in the release receipt.

Public production verification has not yet occurred. No URL in this document should be presented as a launched Debate Room.
