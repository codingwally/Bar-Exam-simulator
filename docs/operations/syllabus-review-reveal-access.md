# Syllabus-Based Review: Reveal Answer access and release runbook

## Policy summary

`Reveal Answer` is protected review material. It is available only when the
server confirms one of these five entitlement bases:

| Server access basis | Reveal a new answer |
| --- | --- |
| `super_admin` | Allowed |
| `founder_admin` | Allowed |
| `founding_beta` | Allowed |
| `early_access` | Allowed |
| `paid_subscription` | Allowed |

Every other basis is denied for a first release. In particular,
`provisional_payment`, introductory tokens, trials, free access, global beta
fallbacks, historical plan labels, and client-side `unlimited` flags are not
proof of eligibility.

The server is authoritative. The browser check improves the experience but
must never be treated as the security boundary.

The following invariants are release gates:

- A reveal never reserves, decrements, finalizes, or otherwise mutates an
  introductory practice token.
- A denied request returns HTTP `403` with public code
  `SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED` and no suggested answer, legal basis,
  doctrine, source, release timestamp, or other protected review field.
- A denial does not change the attempt's assisted classification or release
  timestamp.
- Payment submission, payment cancellation, payment approval, access refresh,
  focus, visibility, `pageshow`, autosave, heartbeat, and reload never reveal
  an answer automatically.
- A user must explicitly choose `Reveal Answer` after an eligible entitlement
  becomes active.
- Before authorization, the interface exposes exactly one `Reveal Answer`
  button and no protected review rows. After a successful authorized request,
  that button is replaced by the same three expandable rows: `Reveal suggested
  answer`, `Reveal controlling law and doctrine`, and `Reveal application,
  limits, and sources`.
- The first authorized release creates exactly one durable
  `subject_review_released` examination audit event for the attempt. Rapid
  clicks, concurrent tabs, reloads, and replays cannot create another release
  transition, audit event, or teaching-provider request.
- An already valid, owner-bound **post-rollout** release with the current
  trusted provenance remains recoverable after reload or a later entitlement
  change. It must not be mistaken for a new release. A legacy reveal timestamp
  by itself is not trusted provenance and must fail closed.

## Copy-ready user and Support instructions

### What happens when I choose Reveal Answer?

If ₱149 Early Access or a paid subscription is active, the approved suggested
answer and legal review open immediately. Revealing before you submit marks the
attempt as assisted; submit first if you want the attempt to remain unassisted.

`Reveal Answer` does **not** use one of your introductory practice tokens.

### Why do I see the ₱149 access screen?

The review material is part of Early Access. Your answer remains saved and
editable while the access screen is open, and the review timer continues.
You may close the screen with the upper-right Close button, `Back to my
answer`, the backdrop, the Escape key, or the browser Back button. Each path
returns you to the same Syllabus-Based Review editor; it does not submit,
erase, or reveal anything.

Submitting payment proof is not approval. While verification is pending, the
answer remains locked. You may continue answering or submit the attempt. When
your ₱149 Early Access payment or paid subscription is approved, return to the
review and choose `Reveal Answer` again. Approval never opens the answer by
itself.

### If the answer was already revealed

A valid release made under the current access rules is attached to
both the signed-in owner and the attempt. It should return after a reload or
revisit without another charge, token change, audit event, or AI request. A
historical reveal timestamp from before this policy is not sufficient by
itself; an owner with active ₱149 Early Access or a paid subscription may create
the new valid release, while an account without either remains locked. If a
current-policy release does not recover, keep the attempt open and send Support
the incident reference; do not reveal information from another account or copy
review material into a support ticket.

## Technical contract

The first-release decision must be one atomic database transaction inside
`public.subject_matter_reveal_review(uuid, uuid)`:

1. authenticate the owner-bound user and lock the attempt row;
2. recover a previously valid post-rollout release with complete trusted
   provenance before considering current entitlement; never trust or backfill
   a legacy reveal timestamp by itself;
3. for a new release, obtain the current server access snapshot and require one
   of the five exact bases above;
4. on denial, raise `SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED` before releasing or
   returning protected material;
5. on authorization, write immutable release provenance and the assisted state;
6. insert one `subject_review_released` audit event for resource type
   `examination_attempt` and the attempt UUID;
7. return an internal `firstReveal` marker and a fresh normalized access
   snapshot to the Worker;
8. let only `firstReveal: true` invoke the optional teaching provider;
9. remove internal idempotency fields from the public response while retaining
   the fresh public access snapshot.

Audit metadata is limited to `accessBasis`, `entitlementEndsAt`, and
`assisted`. It must not contain the prompt, answer, legal basis, citations,
sources, email address, bearer token, payment proof, or provider response.

The frontend gate is contextual action state, not a protected-route redirect.
It is keyed to the current attempt and question, owns its temporary history
entry, restores focus to the originating reveal control or answer editor, and
is cleared synchronously when dismissed. Background access refreshes use
non-enforcing mode. A successful refresh may update eligibility and close a
stale gate, but it must not call the reveal endpoint.

Internal editorial blocks, including rubric, scoring-guide, grader-note,
examiner-note, and similar labeled material, are never learner-facing content.
They must be removed during release ingestion and again at every Worker output
boundary that can return suggested answers, legal review, assessments,
performance, verdicts, or history. The browser applies a final defensive scrub
before caching or rendering. Question prompts and learner-authored answers are
preserved verbatim, even when the learner discusses a rubric. If a protected
answer consists only of internal editorial material, reveal fails closed as
unavailable instead of returning an empty or partial internal block.

## Local and staging verification

Use Node.js 22 or newer. Run these checks before applying the migration:

```text
node --test worker/examinations-routes.test.mjs worker/subject-matter-review.test.mjs worker/syllabus-review-reveal-policy.test.mjs
node scripts/test-syllabus-review-reveal-contract.mjs
node --check worker/index.mjs
node --check assets/phase2-experience.js
node --check assets/phase4-experience.js
node --check assets/examinations.js
```

The stress test must execute at least 100 deterministic mixed interactions and
cover reveal clicks, all five close paths, typing, autosave, heartbeat, submit,
`pageshow`, visibility, browser Back, cross-tab access invalidation, payment
cancel and approval, account and attempt changes, reload/replay, and rapid
concurrent reveal clicks.

In staging, use unique synthetic accounts and attempts. Capture their UUIDs
before testing. Verify, in this order:

1. Every approved basis can make one new release.
2. Every unapproved basis receives the canonical `403`; explicitly include
   `provisional_payment`, introductory tokens, and a legacy unlimited fallback.
3. The denial body contains only the safe error envelope and the attempt's
   release/assisted fields remain unchanged.
4. All five paywall exits return to the same editor, focus is restored, the
   route remains `#subject-matter`, the draft remains exact, and one timer
   remains active.
5. Twenty cycles of typing, save, heartbeat, focus/visibility changes, denial,
   and dismissal do not reopen the gate until another explicit reveal click.
6. Payment cancellation preserves the draft. Payment proof leaves reveal
   denied while access is provisional.
7. Approve the synthetic payment in a second tab. The original tab may refresh
   its access badge, but must not reveal. A later explicit click must release.
8. Send concurrent reveal requests for one eligible unreleased attempt. Both
   may return the owner-bound material, but only one may report a first release
   and only one provider request may occur.
9. Reload and revisit the released attempt. Material must recover with no new
   release timestamp, audit row, provider request, or token event.
10. Change accounts in the same browser. The prior account's cached material
    must disappear, and the new account must not recover the other owner's
    attempt.

Do not use a real student's answer or payment record for acceptance testing.
Do not delete shared records during verification.

## Rollout order

Record the exact project reference, release commit, Worker version, frontend
artifact hash, migration checksum, rollout timestamp, and synthetic account
UUIDs in the change record.

Use Worker-first compatibility. The new Worker rejects the old database
response because it lacks trusted `releaseAuthorized`, release-policy, and
first-release proof, so reveal safely returns `503` during that short window.
The reverse order is unsafe: an old Worker does not understand `firstReveal`
and can invoke the teaching provider again on every authorized replay after the
new database function is installed.

1. Confirm production identity and take read-only counts for attempts, release
   timestamps, examination audits, grade reservations, and introductory token
   ledger events.
2. Run the complete local suite and the staging matrix above.
3. Deploy the first-release-aware Worker to staging while the old database
   function remains in place. Confirm reveal safely returns `503`, while
   typing, save, heartbeat, and submit still work.
4. Apply the reviewed additive migration to staging in one transaction, verify
   its provenance constraints and grants, then deploy the static frontend.
5. Repeat the staging matrix and the read-only audit queries below. A database-
   first staging rehearsal is acceptable only in an isolated environment with
   no active reveal users and an immediate Worker update; Worker-first remains
   the release default.
6. Deploy the reviewed Worker to production while the old database function is
   still present. Smoke-test all unaffected routes and confirm reveal fails
   closed with `503` rather than returning unproved material.
7. Apply the migration to production immediately after the Worker check and
   verify the database contract before accepting reveal traffic.
8. Deploy the static frontend only after the Worker returns the canonical
   denial and strips internal release metadata.
9. Run one denied and one approved synthetic live check, then repeat the live
   audit queries. Preserve the captured outputs with the release evidence.

Stop before the next layer if any check fails. Never weaken ownership,
entitlement, function grants, or row security to continue a rollout.

## Live read-only audit

Replace the timestamp and UUID placeholders deliberately. Run these queries
through an authenticated administrative SQL session. They do not mutate data.

### Unauthorized or incomplete release provenance

```sql
select
  a.id as attempt_id,
  a.user_id,
  a.review_material_release_access_basis as access_basis,
  a.review_material_release_authorized_at as authorized_at
from public.examination_attempts_multi a
where a.review_material_release_authorized_at >= timestamptz '2026-08-26 12:00:00+08' -- replace with the captured rollout time
  and (
    a.review_material_release_access_basis is null
    or a.review_material_release_access_basis not in (
      'super_admin',
      'founder_admin',
      'founding_beta',
      'early_access',
      'paid_subscription'
    )
  )
order by a.review_material_release_authorized_at;
```

Expected result: zero rows.

### Exactly one audit event for each post-rollout release

```sql
select
  a.id as attempt_id,
  count(l.id) as release_audit_count
from public.examination_attempts_multi a
left join public.examination_audit_log l
  on l.action = 'subject_review_released'
 and l.resource_type = 'examination_attempt'
 and l.resource_id = a.id::text
where a.review_material_release_authorized_at >= timestamptz '2026-08-26 12:00:00+08' -- replace with the captured rollout time
group by a.id
having count(l.id) <> 1
order by a.id;
```

Expected result: zero rows.

Also check for duplicate or orphan release audits:

```sql
select l.resource_id as attempt_id, count(*) as release_audit_count
from public.examination_audit_log l
where l.action = 'subject_review_released'
  and l.created_at >= timestamptz '2026-08-26 12:00:00+08' -- replace with the captured rollout time
group by l.resource_id
having count(*) <> 1
order by l.resource_id;
```

Expected result: zero rows. Check separately for an audit whose attempt no
longer exists:

```sql
select l.id, l.resource_id, l.created_at
from public.examination_audit_log l
left join public.examination_attempts_multi a
  on a.id::text = l.resource_id
where l.action = 'subject_review_released'
  and l.resource_type = 'examination_attempt'
  and l.created_at >= timestamptz '2026-08-26 12:00:00+08' -- replace with the captured rollout time
  and a.id is null
order by l.created_at;
```

Expected result: zero rows.

### Audit metadata contains only approved keys

```sql
select l.id, l.resource_id, l.metadata
from public.examination_audit_log l
where l.action = 'subject_review_released'
  and l.created_at >= timestamptz '2026-08-26 12:00:00+08' -- replace with the captured rollout time
  and (
    jsonb_typeof(l.metadata) <> 'object'
    or (l.metadata - array['accessBasis', 'entitlementEndsAt', 'assisted']::text[]) <> '{}'::jsonb
  )
order by l.created_at;
```

Expected result: zero rows.

### Controlled token non-mutation check

Before the synthetic reveal, record both queries for the exact test user:

```sql
select event_type, token_delta, balance_after, occurred_at
from public.introductory_token_ledger
where user_id = '00000000-0000-4000-8000-000000000000'::uuid -- replace with the synthetic user
order by occurred_at, id;

select
  g.user_id,
  g.token_limit,
  count(l.id) filter (where l.event_type = 'consumed') as tokens_consumed,
  g.token_limit - count(l.id) filter (where l.event_type = 'consumed') as tokens_remaining
from public.introductory_token_grants g
left join public.introductory_token_ledger l on l.grant_id = g.id
where g.user_id = '00000000-0000-4000-8000-000000000000'::uuid -- replace with the synthetic user
group by g.user_id, g.token_limit;
```

Repeat the same two queries after one denied reveal, one authorized reveal, and
several replays. The ledger rows and token balance must be byte-for-byte
unchanged. Do not perform grading between the before and after snapshots.

## Rollback and incident response

Database migrations are an immutable ledger. Do not drop provenance columns,
delete audit rows, erase valid release timestamps, or improvise reverse SQL.

- Frontend-only defect: restore the reviewed prior static artifact. The server
  entitlement check remains authoritative; users may receive a less-specific
  error while the corrected frontend is prepared.
- Worker defect: do not restore a version that treats every replay as a first
  release or calls the provider repeatedly. If no compatible known-good Worker
  exists, deploy a reviewed emergency Worker that returns a safe `503` only for
  `subject_reveal_review`, while leaving typing, save, heartbeat, and submit
  routes available.
- Database defect before commit: rely on transaction rollback and stop.
- Database defect after commit: leave evidence intact and prepare separately
  reviewed forward-recovery SQL. Preserve valid historical releases.
- Suspected content leak: disable new reveal responses at the Worker boundary,
  preserve request IDs and audit records, verify ownership and entitlement,
  rotate credentials only if exposure is confirmed, and follow the incident
  process before re-enabling.

Rollback is complete only after save/submit still work, the paywall does not
loop, denied responses contain no protected fields, released attempts remain
recoverable or fail safely, and the token ledger remains unchanged.

## Release stop conditions

Stop and preserve evidence if any of these occurs:

- a basis outside the exact five-value allowlist can make a new release;
- `provisional_payment` reveals material;
- a denial returns anything other than the canonical safe `403` envelope;
- a modal close changes the route, clears the draft, or restarts the timer;
- a background event opens the gate after dismissal;
- payment or access refresh reveals without another explicit click;
- denial changes assisted or release state;
- one attempt gains duplicate release audits or provider requests;
- `firstReveal`, private entitlement diagnostics, or protected review material
  appears in an error or public metadata field;
- an internal rubric, scoring guide, grader note, examiner note, or other
  editorial instruction appears in a reveal, assessment, performance, verdict,
  or history response;
- an introductory token balance or ledger changes because of reveal;
- ownership changes or account switching expose another user's review;
- the migration is not transactional, least-privilege grants change, or any
  existing examination, grade, payment, subscription, or audit record is lost.
