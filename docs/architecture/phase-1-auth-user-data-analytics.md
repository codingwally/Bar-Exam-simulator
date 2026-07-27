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
`calibration_examples`, and the legacy `grade_disputes` table. RLS is enabled, but legacy broad
table grants give both `anon` and `authenticated` API roles privileges beyond
their intended workflows. In particular, authenticated users have effective
UPDATE access to protected profile columns.

`supabase/tests/fixtures/20260727_staging_existing_core_schema.sql` reproduces
that audited pre-Phase-1 state for staging tests. The Phase 1D read-only
inventory reconciled six previously incorrect column signatures, three
foreign-key actions, and all nine legacy policy definitions. In particular,
the legacy policies were assigned to `PUBLIC`, the public-read policies were
named `subjects_select_all` and `questions_select_all`, and the profile UPDATE
policy had no `WITH CHECK` expression. The fixture intentionally includes those
legacy definitions and broad grants, and intentionally excludes constraints
not found by the production inventory. It creates no public function or
non-internal trigger.

The Phase 1 migration revokes every `PUBLIC`, `anon`, and `authenticated`
privilege on all seven core tables, removes the nine legacy `PUBLIC` policies,
and recreates owner/public-read policies for explicit API roles before granting
this minimum matrix:

| Core table | `anon` | `authenticated` |
| --- | --- | --- |
| `subjects` | SELECT | SELECT |
| `questions` | SELECT | SELECT |
| `profiles` | none | SELECT; UPDATE only on approved personal columns |
| `submissions` | none | SELECT, INSERT (owner RLS) |
| `grading_results` | none | SELECT (owner RLS through submission) |
| `question_corrections` | none | none; Worker/service-role only |
| `calibration_examples` | none | none |

The service role retains operational access and must remain server-side.

### Suggest a Correction/Better Answer

The public question-bank identifier (for example, `LAB-001`) is the stable key
used by the frontend and Worker. It is stored as `question_bank_id`; this
workflow does not assume that a corresponding Supabase question UUID exists.

Phase 1 converts the unused legacy `grade_disputes` table by renaming it to
`question_corrections` and replacing submission-specific fields with the
minimum editorial-review fields. The migration first verifies that the legacy
table contains no rows. If any record unexpectedly exists—or both old and new
tables exist—it stops before conversion so data is never silently deleted,
overwritten, or reinterpreted.

“Suggest a Correction/Better Answer” submissions contain the question-bank ID,
trusted subject, approved correction type, proposed correction, explanation,
up to five supporting URLs, optional authenticated user ID, review status,
timestamps, and optional administrative notes. They never contain an
examinee’s submitted answer, email address, IP address, credential, or API key.

The correction table has RLS enabled and no browser policies or grants.
`PUBLIC`, `anon`, and `authenticated` receive no SELECT, INSERT, UPDATE, or
DELETE privilege. The frontend submits to the Worker’s narrow `/corrections`
endpoint, which validates the stable question against the server-loaded public
bank and writes through the server-only Supabase service role. No Gemini call
is made for this workflow.

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
checks the reconciled table/column/default/nullability signature, absence of
unobserved unique/check constraints, exact primary- and foreign-key columns,
all nine RLS policy names/roles/modes/commands/expressions, direct grant
provenance, absence of PUBLIC grants, absence of Phase 1 functions, triggers,
and tables, and the audited row counts. Any drift blocks migration.

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

The shared `jsonb_has_forbidden_keys` constraint helper recursively traverses
objects and arrays. It rejects answer content, email, credentials, tokens, API
keys, and IP-address fields even when nested below another metadata key.

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

Because the migration changes grants and policies, reverting the Git commit does
not reverse database state. A production rollback requires a separately
reviewed forward migration that restores prior grants and policies. Until that
rollback migration exists, the safest application response is to leave the new
schema unused and disable any new authentication UI.

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
3. create seven new tables, convert the empty legacy correction table, and add
   supporting indexes and RLS policies;
4. add server-timestamped Terms, consent, onboarding, role, and role-helper RPCs;
5. add a safe Auth-user trigger that creates a profile and `student` role;
6. backfill a `student` role for every existing profile without overwriting any
   role already present;
7. leave all new analytics and entitlement tables disconnected and inactive;
8. leave questions, LAB identifiers, grading, subscriptions, guest access,
   authentication behavior, secrets, and payment behavior unchanged;
9. add only the “Suggest a Correction/Better Answer” frontend form and Worker
   submission endpoint.

## Deferred operational risks

- Before any future `supabase db push`, inspect
  `supabase_migrations.schema_migrations` and the CLI dry-run. The repository
  contains the earlier Labor RAG migration; production must not receive that
  migration accidentally when Phase 1 is approved.
- `bootstrap_first_super_admin` is restricted to `service_role`, but concurrent
  first-bootstrap calls could race. Operators must execute it once, serially. A
  later hardening migration may add a database advisory lock.
- `supabase/config.toml` describes local development. Its permissive local Auth
  settings are not approved production Auth configuration and must not be
  applied with a configuration push.

## Required operator information before production approval

1. A fresh, read-only run of
   `supabase/review/phase1_production_preflight.sql` immediately before any
   production approval; all assertions must pass without drift.
2. The four immutable Supabase Auth user UUIDs after each founder signs in with
   Google. Do not send passwords or OAuth tokens.
3. A disposable Supabase test project or local Supabase/Docker runtime for
   executing the pgTAP integration suite before any production application.
