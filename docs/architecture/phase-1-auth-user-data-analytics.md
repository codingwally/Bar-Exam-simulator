# Phase 1 authentication, user-data, analytics, and admin foundation

Status: Phase 1C staging validation in progress; unapplied to production.

Migration: `supabase/migrations/20260727_002_auth_user_data_analytics_foundation.sql`

Approved staging constants:

- Terms: `terms-beta-v1-2026-08-15`
- Privacy: `privacy-beta-v1-2026-08-15`
- Active-viewer window: five minutes

This phase adds a secure database foundation without enabling authentication in
the frontend, changing guest access, connecting analytics, activating limits, or
modifying the Worker, examiner, timer, question bank, submissions, or grading.

## Phase 1B production baseline

The read-only production review found seven public tables:
`profiles`, `subjects`, `questions`, `submissions`, `grading_results`,
`calibration_examples`, and `grade_disputes`. RLS is enabled, but legacy broad
table grants give both `anon` and `authenticated` API roles privileges beyond
their intended workflows. In particular, authenticated users have effective
UPDATE access to protected profile columns.

`supabase/tests/fixtures/20260727_staging_existing_core_schema.sql` reproduces
that audited pre-Phase-1 state for staging tests. It intentionally includes the
legacy broad grants and intentionally excludes constraints not found by the
production inventory. It creates no public function or non-internal trigger.

The Phase 1 migration revokes every `anon` and `authenticated` privilege on all
seven core tables before granting this minimum matrix:

| Core table | `anon` | `authenticated` |
| --- | --- | --- |
| `subjects` | SELECT | SELECT |
| `questions` | SELECT | SELECT |
| `profiles` | none | SELECT; UPDATE only on approved personal columns |
| `submissions` | none | SELECT, INSERT (owner RLS) |
| `grading_results` | none | SELECT (owner RLS through submission) |
| `grade_disputes` | none | SELECT, INSERT (owner RLS) |
| `calibration_examples` | none | none |

The service role retains operational access and must remain server-side.

### Deliberately unresolved production constraints

The Phase 1B inventory did not show the following desirable constraints, so the
production-faithful fixture and Phase 1 migration do not silently introduce
them:

- uniqueness of `subjects.name`;
- uniqueness of `grading_results.submission_id`;
- non-negative checks for `submissions.word_count` and
  `submissions.time_spent_seconds`.

These are reconciliation risks, not Phase 1C grant-hardening changes. Adding
them later requires a data-quality precheck and a separately reviewed forward
migration.

## Production approval preflight

`supabase/review/phase1_production_preflight.sql` is read-only and fail-fast. It
checks the exact audited table/column/default/nullability signature, absence of
unobserved unique/check constraints, expected primary-key indexes, nine
existing RLS policies, legacy broad grants, absence of Phase 1 functions,
triggers, and tables, and the audited row counts. Any drift blocks migration.

PostgreSQL cannot prove the Supabase project reference from SQL alone. A future
operator must independently confirm `hbllomlijfznnuudpdvr` before running the
preflight. A passing preflight is evidence for review, not authorization to
apply the migration.

## Table-by-table design

### `profiles` (extended)

Adds `school`, `enrollment_status`, `year_level`, `profile_completed_at`, and
`updated_at`. The existing `display_name`, `subscription_tier`, and
`subscription_status` columns remain unchanged.

Authenticated users retain access only to their own profile row. Table-level
update permission is revoked and replaced with column-level permission for
`display_name`, `school`, `enrollment_status`, and `year_level`. Consequently,
even a permissive own-row RLS policy cannot be used to change subscription or
administrative fields.

`complete_profile_onboarding` is the only authenticated path that sets
`profile_completed_at`. It verifies that the exact Terms/Privacy version was
accepted first. Enrolled students must supply school and year level; those who
are not yet enrolled may leave both empty.

### `terms_acceptances`

Stores one server-timestamped acceptance per user and Terms/Privacy version
combination. Users can read their own history but cannot insert, update, or
delete table rows directly. `accept_terms` records acceptance using `auth.uid()`
and the database clock. The beta RPC accepts only the approved Terms and Privacy
versions above; a later legal-document release requires a reviewed forward
migration.

### `marketing_consents`

Stores append-only, timestamped consent changes. `opted_in` defaults to false,
and no row is also interpreted as not opted in. `record_marketing_consent`
supports both opt-in and withdrawal. Marketing consent is never checked by
`complete_profile_onboarding`, so it remains optional and separate from Terms.

### `user_roles`

Maps the immutable `auth.users.id` to exactly one of `student`, `admin`, or
`super_admin`. New and existing profile holders default to `student`. Founder
emails are not stored or committed. After each founder has authenticated, a
trusted operator must map the resulting Auth UUID to the approved role.

Only `super_admin` may call `assign_user_role`; self-directed role changes are
rejected. Direct client writes are revoked. The initial super-admin bootstrap
must be performed once through `bootstrap_first_super_admin` using the Supabase
SQL editor or another service-role operation after that founder's Auth user
exists. The function refuses to run if any super-admin already exists and writes
the bootstrap event to the audit log.

### `usage_sessions`

Supports signed-in and anonymous sessions. Guest activity requires a random UUID
and signed-in activity requires a user UUID. `last_seen_at` plus its descending
index supports a short current-viewer heartbeat window. No raw IP field exists.
Metadata rejects answer text, credentials, tokens, keys, and IP-address keys.
An active viewer is an unended session whose `last_seen_at` is no more than five
minutes old.

### `usage_events`

Stores timestamped product events such as registrations, returning sessions,
subject opens, exam starts, question views, answer submissions, session
completion, and marketing-consent changes. `user_id` is nullable for guests,
while `anonymous_session_id` preserves unique-session analysis. It stores
question identifiers but never answer text.

There are no client write policies. A future Worker/service-role integration
will validate and write events. Administrators receive read-only access for
operational reporting.

### `user_entitlements`

Inactive future configuration for plan entitlements and an optional
per-subject daily question limit. No rows are required and no application code
consults the table in Phase 1. Existing subscription columns remain the source
fields already present on `profiles`.

### `admin_audit_log`

Append-only record of administrator role changes, account status changes,
subscription changes, content operations, and security-setting changes. Direct
client writes are revoked. Only super-admins can read the table. The role
assignment RPC records its own audit entry atomically.

## RLS policies

| Table | Policy | Permission | Rule |
| --- | --- | --- | --- |
| `profiles` | `profiles_select_own` | SELECT | `auth.uid() = id` |
| `profiles` | `profiles_update_own` | UPDATE | `auth.uid() = id` for existing and new row |
| `terms_acceptances` | `terms_acceptances_select_own` | SELECT | `auth.uid() = user_id` |
| `marketing_consents` | `marketing_consents_select_own` | SELECT | `auth.uid() = user_id` |
| `user_roles` | `user_roles_select_own` | SELECT | `auth.uid() = user_id` |
| `usage_sessions` | `usage_sessions_admin_select` | SELECT | role is admin or super-admin |
| `usage_events` | `usage_events_admin_select` | SELECT | role is admin or super-admin |
| `user_entitlements` | `user_entitlements_select_own` | SELECT | `auth.uid() = user_id` |
| `admin_audit_log` | `admin_audit_log_super_admin_select` | SELECT | role is super-admin |

No INSERT/UPDATE/DELETE policy exists for roles, analytics, entitlements, or
audit records. Trusted server operations use the service role and keep that key
outside the repository and browser.

## Rollback

Because the migration is additive, the safest rollback is application-level:
leave the new schema unused and revert the migration commit. Existing
production behavior will continue because Phase 1 does not connect any client
code to these objects.

If database-object removal is later required, create a separately reviewed
forward migration that:

1. revokes execute access to the Phase 1 RPCs;
2. disables the `on_auth_user_created_due_diligence` trigger;
3. archives any consent/audit data required by policy;
4. removes Phase 1 policies, functions, tables, constraints, and profile columns
   in dependency order;
5. restores the prior profile grants only after a security review.

The proposed migration intentionally contains no destructive rollback SQL.

## Production changes if approved later

Applying this migration would:

1. add five nullable/defaulted profile fields and two onboarding constraints;
2. enforce column-level profile update permissions;
3. create seven new tables, supporting indexes, and RLS policies;
4. add server-timestamped Terms, consent, onboarding, role, and role-helper RPCs;
5. add a safe Auth-user trigger that creates a profile and `student` role;
6. backfill a `student` role for every existing profile without overwriting any
   role already present;
7. leave all new analytics and entitlement tables disconnected and inactive;
8. leave questions, LAB identifiers, grading, subscriptions, guest access,
   frontend code, Worker code, secrets, and payment behavior unchanged.

## Required operator information before production approval

1. A fresh, read-only run of
   `supabase/review/phase1_production_preflight.sql` immediately before any
   production approval; all assertions must pass without drift.
2. The four immutable Supabase Auth user UUIDs after each founder signs in with
   Google. Do not send passwords or OAuth tokens.
3. A disposable Supabase test project or local Supabase/Docker runtime for
   executing the pgTAP integration suite before any production application.
