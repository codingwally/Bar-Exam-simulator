# LEB Subject Matter and Premium ₱499 release

## Scope and authoritative source

This release adds the approved portion of the LEB Year I–II Subject Matter
catalog and completes the existing `premium` plan. The authoritative content
source is the live Google Sheet tab `LEB Y1-Y2 Exam Bank` in spreadsheet
`1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A`.

- Eleven exact Question IDs passed the publication gates and are published as
  one-question Subject Matter Practice examinations.
- Thirteen mapped Question IDs remain visible as `Review pending` categories
  because their live rows are `For Review` and `Publication Ready? = No`.
- No withheld row is inserted into `examination_questions`, and no replacement
  content is generated.
- The exact imported A:U values, row ranges, and withheld-row reasons are in
  `content/examinations/leb-y1-y2-approved-subject-matter-20260730.json`.

## Baseline and rollback

- Untouched production commit: `c3fa8b0995b1739c0dab28767264638332a428fa`
- Git rollback reference:
  `rollback/pre-leb-subject-matter-premium-499-20260730`
- Pre-release Worker version:
  `3067fec1-6b31-4de6-88dd-2c11471749f3`
- Production Supabase project: `hbllomlijfznnuudpdvr`
- Staging Supabase project: `hlzqmreeoghbldnhlybr`

The rollback Git reference does not reverse database changes. Database recovery
must use separately reviewed forward SQL. The content and plan migrations are
additive and do not truncate or delete existing user, payment, subscription,
question, examination, attempt, grading, or audit data.

## Database changes

Apply in this exact order:

1. `20260804_013_leb_subject_matter_approved_content.sql`
2. `20260804_014_premium_499_entitlements.sql`

Migration 013:

- adds the truthful `quiz` assessment kind;
- inserts only the eleven publication-ready questions;
- creates deterministic one-question Subject Matter definitions, immutable
  versions, and question associations;
- checks immutable hashes before reusing existing records;
- publishes only after the question association exists;
- is safe to repeat without creating duplicate content.

Migration 014:

- activates the existing stable plan identifier `premium` at PHP 499.00;
- leaves billing duration undefined and requires an explicit future expiry for
  paid or complimentary Premium access;
- makes the server authoritative for the PHP 499.00 payment amount;
- adds idempotent, audited Premium payment and administration RPCs;
- distinguishes `manual_payment` from `complimentary`;
- protects Bar Feels with server-side active, unexpired Premium authorization;
- preserves existing Subject Matter and Mock Bar access available to lower
  plans;
- grants execution only to the trusted service role.

## Release sequence

1. Revalidate the live Sheet and immutable content artifact.
2. Verify the rollback tag and clean release branch.
3. Run all local content, migration, Worker, repository, syntax, responsive,
   and accessibility checks.
4. Apply migrations to staging.
5. Verify staging database contracts and Premium lifecycle states.
6. Deploy the Worker to staging and verify existing grading before Premium
   paths.
7. Deploy the static frontend to staging.
8. Verify Subject Matter, Premium payment/admin controls, Bar Feels,
   cross-user isolation, responsive layouts, and keyboard access.
9. Remove staging test users and transactional records.
10. Re-run production read-only identity, row-count, and migration-ledger
    preflight.
11. Apply only migrations 013 and 014 to production, transactionally and in
    order.
12. Verify database invariants before deploying the Worker.
13. Deploy and smoke-test the Worker.
14. Merge the reviewed release branch and allow GitHub Pages to deploy.
15. Complete live desktop/mobile acceptance and remove only synthetic
    production test records.

## Stop conditions

Stop the release before the next layer if:

- the Supabase project reference is not exact;
- the live Sheet differs from the recorded validation artifact;
- an approved ID is missing, duplicated, or no longer publication-ready;
- an existing deterministic content record has a different immutable hash;
- existing question, subscription, payment, attempt, or grading counts fall;
- the server accepts a client-supplied Premium amount;
- pending, expired, suspended, or revoked Premium gains Bar Feels access;
- a non-admin can perform an administrative mutation;
- existing grading, Subject Matter, Mock Bar, or Bar Feels behavior regresses;
- a secret appears in source, logs, responses, or static assets;
- any database or Worker step partially fails.

## Recovery

- Database failure: rely on transaction rollback, stop, and preserve the exact
  error. Do not continue to Worker or frontend deployment.
- Worker regression: restore the recorded previous Worker version and leave the
  additive database foundation in place.
- Frontend regression: redeploy the untouched production commit or the rollback
  tag after confirming Worker compatibility.
- Data recovery: use reviewed forward SQL only. Never treat `git revert` as a
  database rollback.

## Post-release acceptance

Final status must remain `PARTIAL` while any of the thirteen exact Year II rows
are not approved for publication. The release may be operationally successful
for all eleven validated questions and the Premium plan without claiming that
all twenty-four questions are live.
