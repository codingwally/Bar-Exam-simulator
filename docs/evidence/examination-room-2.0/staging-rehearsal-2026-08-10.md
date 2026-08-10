# Examination Room 2.0 staging rehearsal — 2026-08-10

## Scope

- Environment: isolated `duediligence-staging` Supabase project and
  `duediligence-examinations-staging` Cloudflare Worker.
- Production database, Worker, Pages deployment, and production V2 flags were
  not changed.
- Email remained suppressed in staging.

## Database result

- Applied the exact reviewed contents of
  `20260811003100_examination_room_2_beta.sql` to staging as
  `examination_room_2_beta_staging_rehearsal`.
- Supabase recorded staging migration version `20260810021549`.
- PostgreSQL compiled and committed the complete 321,725-character migration.
- All 24 additive V2 tables exist, have RLS enabled and forced, and expose no
  direct `anon` or `authenticated` table grants.
- All 58 V2 RPCs are `SECURITY DEFINER`, use an empty `search_path`, and expose
  no direct browser execution grants.
- Supabase Security Advisor reported no Examination Room warning or error.
- A redundant rehearsal index was removed. The Performance Advisor then
  reported no warning or error.

The staging migration ledger predates the canonical production migration
sequence. The rehearsal was therefore applied through the reviewed Supabase
migration API instead of a blind CLI push. Production must use its separately
reviewed canonical ledger path.

## Application result

- Worker release suite: 290 of 290 tests passed.
- Examination Room migration, store, frontend, Admin, preview, and 500-student
  offline load checks passed.
- The complete private-beta, content, artifact, and migration regression suite
  passed.
- Staging Worker and static assets deployed successfully as Cloudflare Worker
  version `d0df331a-84f6-4590-8aa9-5177bc3bec19`.
- Staging home returned HTTP 200.
- The staging client V2 gate is enabled and the Examination Room entry is
  present and visible.
- Signed-out feature and Examination Room requests returned HTTP 401, preserving
  the Student sign-in wall.

## Remaining production gates

This rehearsal does not authorize production activation. Authenticated
Professor, Beadle, Student, grading/release, two-device recovery, Google backup,
real email delivery, screen-reader, and rollback/restore journeys still require
recorded staging evidence. GitHub production environments and branch protection
also require owner verification before a production dispatch.
