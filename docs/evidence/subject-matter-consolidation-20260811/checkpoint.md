# Subject Matter two-bank consolidation release checkpoint

Date: 2026-08-11 (Asia/Manila)

## Release scope

- Branch: `agent/subject-matter-consolidation-20260811`
- Baseline: `a53eef5f7fc00c1be96f988b29cdd751282faa3a`
- Production project: `hbllomlijfznnuudpdvr`
- Staging project: `hlzqmreeoghbldnhlybr`
- Production changes at this checkpoint: none
- Gemini prompt, grading rubric, 0.0–5.0 scale, question timer, payments, and subscription rules: unchanged

## Content contract

- Subject Matter courses: 42
- Major courses: 35 × 50 questions
- Minor courses: 7 × 20 questions
- Total placements: 1,890
- Canonical question IDs represented: 1,490
- Direct placements: 1,490
- Integration placements: 400
- Reused canonical questions: 400, each reused exactly once
- Duplicate course/slot pairs: 0
- Duplicate canonical question IDs in the destination bank: 0
- Invalid placements after staging sync: 0

The source bank contributed 993 approved owner-override records. The destination `LEB Y1-Y2 Exam Bank` now contains 1,622 unique records. Existing destination rows were preserved byte-for-byte. Owner override was recorded in Notes without changing `Human Verified?` or falsifying source-review status.

## Source verification

- Automated HTTPS checks passed for 157 of 159 distinct legal-source URLs.
- The remaining two official Supreme Court sources were verified in a real browser on 2026-08-11:
  - Rule 138-A Law Student Practice page
  - En Banc G.R. No. 266331 decision PDF

## Staging evidence

- Staging migrations applied: `20260811004000` and `20260811004100`
- Staging Worker version: `bb6f8cfd-15a7-4f87-bcf8-9c1e86bc79e9`
- Previous staging Worker rollback version: `c99820f3-ebb6-497e-b11d-c196dc9cce99`
- Final staged counts: 42 courses, 1,890 placements, 1,490 canonical questions, 1,490 direct placements, 400 integration placements
- Existing Bar Feels manifest: 120 rows, unchanged
- Staging attempts, responses, submissions, and assessments: 0
- Browser-role grants on protected release tables: 0
- Staging payload residue after finalize: 0
- Repeatability: definitions 2,028; versions 2,039; version questions 2,153; placements 1,890, unchanged after the second sync

Desktop and 390 × 844 mobile browser checks passed. The landing page, official branding, modal exit controls, navigation, and staged Subject Matter presentation rendered without relevant console errors or horizontal overflow.

## Production read-only gate

The fail-fast, read-only preflight passed against production on 2026-08-11. Snapshot before any production write:

- Auth users: 128
- Profiles: 128
- Subjects: 8
- Legacy questions: 2
- Examination definitions: 623
- Subject Matter definitions: 616
- Examination versions: 634
- Version questions: 747
- Examination questions: 736
- Attempts: 51
- Responses: 450
- Submissions: 29
- Assessments: 92
- Bar Feels manifest: 120
- Subject Matter cycles: 26
- New consolidation tables/functions: absent as expected
- Core protected-table browser grants: 0
- Synthetic records: 0

The preflight file is `supabase/review/subject_matter_two_bank_production_preflight.sql`. It performs identity, schema-signature, count, grant, and migration-ledger assertions without modifying data or schema.

## Verification results

All release-critical tests passed:

- JavaScript syntax checks for the Worker, release core, and examination frontend
- Worker unit/regression suite, including the placement manifest
- Subject Matter consolidation contract
- Complete beta release contract
- Official brand assets
- Beta copy, accessibility, and SEO contract
- Sanitized GitHub Pages artifact
- Dialog exit controls
- Gemini examiner regression suite
- Website question-bank regression suite
- Exam-session controller regression suite
- Contact-route regression suite
- `git diff --check`

The full 64-script inventory produced 57 deterministic passes. Seven scripts are not release regressions: three require an intentionally unavailable staging service-role environment value, and four contain pre-existing stale assertions or module assumptions unrelated to this change. Equivalent staging database, security, routing, and content checks were completed directly and passed.

## Secret and asset integrity

- New tracked secret-value pattern hits: 0
- Untracked release-file secret-value pattern hits: 0
- Two token-like matches in `worker/index.mjs` are pre-existing baseline identifiers, not added values.
- Official logo master SHA-256: `6D284C91CE34D208252F5311A4CD3397FC00251E6968BFA620182138A1206CF5`
- The master is preserved byte-for-byte. Favicons, app icons, and the social card are padded derivatives with preserved aspect ratio.

## Rollback and recovery

- Google Sheets: restore the pre-import revisions or clear only the appended source/destination ranges recorded in the Sheet revision history.
- Database: migrations are additive. Application rollback does not remove the catalog foundation. Any database reversal requires reviewed forward-recovery SQL; Git revert is not a database rollback.
- Worker: deploy the recorded prior production Worker version if existing grading or release sync regresses.
- Frontend: redeploy the recorded pre-release GitHub Pages artifact/commit.
- Stop immediately on identity mismatch, failed preflight, row-count drift, partial migration failure, failed existing grading smoke test, failed catalog count, or detected secret exposure.

## Production sequencing

1. Reconfirm production identity, preflight, migration ledger, and protected row counts.
2. Apply only migrations `20260811004000` and `20260811004100`.
3. Verify schema, RLS/grants, backfill, and preservation counts.
4. Deploy and verify the Worker while the existing frontend remains live.
5. Run one existing grading smoke test, then synchronize the two-bank catalog.
6. Verify 42/1,890/1,490/400 invariants and zero staging residue.
7. Merge and deploy the frontend last.
8. Run desktop/mobile production smoke tests and remove any exact synthetic test records.
