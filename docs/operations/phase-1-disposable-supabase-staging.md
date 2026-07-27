# Phase 1 disposable Supabase staging procedure

Status: staging project authorized for Phase 1C validation only.

Authorized staging project: `hlzqmreeoghbldnhlybr`.

Production project `hbllomlijfznnuudpdvr` is explicitly prohibited throughout
this procedure.

## Safety gates

Before any command:

1. Confirm the linked project is exactly `hlzqmreeoghbldnhlybr`.
2. Confirm character-for-character that it is not `hbllomlijfznnuudpdvr`.
3. Stop if local link state is missing, ambiguous, or points elsewhere.
4. Confirm that no production data, OAuth secrets, service-role key, database
   password, or founder identity has been copied into the repository.
5. Record the staging project name, reference, region, owner, and planned
   deletion date in the test notes.
6. Treat `supabase/config.toml` as local-development configuration only. Do not
   push its Auth settings to staging or production as part of this procedure.

Stop immediately if any project identity is ambiguous.

## Required tooling

- Supabase CLI
- Docker Desktop for a local test stack, or an explicitly approved disposable
  remote staging database
- A schema-only baseline matching the existing production tables and policies
  for `profiles`, `subjects`, `questions`, `submissions`, `grading_results`,
  `calibration_examples`, and `grade_disputes`

Do not copy production table data. The Phase 1 migration depends on the existing
`profiles` table, so it cannot be validated correctly against a blank project.

## Recommended test sequence

### 1. Independent SQL review

Review, without executing:

- `supabase/migrations/20260727_002_auth_user_data_analytics_foundation.sql`
- `supabase/tests/20260727_002_auth_user_data_analytics_foundation_test.sql`
- `supabase/review/read_only_existing_access_inventory.sql`
- `supabase/review/phase1_production_preflight.sql` (review only; do not run
  against production without a separate approval)

Confirm that the migration contains no project URL, password, founder email,
OAuth secret, API key, or destructive table/column/schema drop.

### 2. Build a schema-only staging baseline

Load an independently reviewed schema-only baseline into the disposable project.
It must reproduce the existing table columns, keys, relationships, grants, and
RLS policies but contain no production user or answer data.

The baseline must come from
`supabase/tests/fixtures/20260727_staging_existing_core_schema.sql`. It
intentionally reproduces broad legacy grants and omits the unique/check
constraints absent from the Phase 1B production inventory. Run
`read_only_existing_access_inventory.sql` and retain the output as the
before-state artifact.

The two negative fixtures
`20260728_staging_malformed_primary_key.sql` and
`20260728_staging_malformed_foreign_key.sql` are never part of a successful
baseline. Apply each separately in a disposable reset and confirm that the
preflight rejects it before testing the valid fixture.

### 3. Local contract tests

From the repository root:

```powershell
node scripts/test-phase-1-auth-migration.mjs
```

This validates additive/idempotent syntax contracts, field-level grants,
backend-only analytics writes, role protections, approved legal-document
versions, and the five-minute heartbeat definition.

### 4. Apply only to the confirmed disposable project

Before linking, compare the proposed staging reference character-for-character
with the prohibited production reference.

```powershell
$stagingRef = 'hlzqmreeoghbldnhlybr'
if ($stagingRef -eq 'hbllomlijfznnuudpdvr') {
  throw 'Production project is prohibited.'
}
supabase link --project-ref $stagingRef
supabase db push --dry-run
```

Review the dry-run output. Only after a second explicit approval:

```powershell
supabase db push
```

Do not pass database passwords on the command line or commit generated local
link state.

Before any future production push, inspect both the CLI dry-run and
`supabase_migrations.schema_migrations`. The earlier Labor RAG migration must
not be applied implicitly while approving Phase 1.

### 5. Execute pgTAP

Run against the disposable staging database only:

```powershell
supabase test db supabase/tests/20260727_002_auth_user_data_analytics_foundation_test.sql --linked
```

The suite must pass before any production recommendation.

### 6. Repeatability test

Run a second dry run:

```powershell
supabase db push --dry-run
```

It must report no pending migration. For full SQL repeatability validation,
restore the schema-only baseline in a second disposable database, execute the
Phase 1 SQL twice manually in separate transactions, and confirm that the
second execution creates no duplicate objects or data.

### 7. Behavioral security tests

Create synthetic test users only—never founders—and verify:

- Student A can read and update only Student A's approved profile fields.
- Student A cannot update subscription fields or `profile_completed_at`.
- Student A cannot read Student B's profile, submissions, or grading results.
- Student A cannot assign a role.
- An admin cannot promote themselves or another user.
- Only a super-admin operation can manage administrator roles.
- Anonymous/authenticated clients cannot write analytics or audit rows.
- Service-role staging operations can write analytics and audit rows.
- Onboarding fails until the approved Terms and Privacy versions are accepted.
- Marketing consent defaults to false and withdrawal appends a new record.
- Active-viewer queries use an unended session seen within five minutes.
- Student A may create a dispute for Student A's submission but cannot attach a
  dispute to Student B's submission.
- Forbidden analytics/audit keys are rejected recursively inside nested objects
  and arrays.

Do not seed founder roles. Use synthetic staging UUIDs.

### 8. Capture after-state and destroy staging

Run the read-only inventory again and compare it with the before-state. Save:

- migration output;
- pgTAP output;
- behavioral-test results;
- before/after grants and policy inventories;
- any warnings or deviations.

After review, unlink the CLI and delete the disposable project according to the
owner's retention decision. Do not proceed to Phase 2.

Reverting a Git commit does not reverse database grants, policies, triggers, or
tables. Any production rollback requires a separately reviewed forward SQL
migration. The first-super-admin bootstrap must also be run once and serially;
concurrent bootstrap calls are not an approved operating procedure.
