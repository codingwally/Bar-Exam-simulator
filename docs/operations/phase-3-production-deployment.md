# Phase 3 Production Deployment and Recovery

## Fixed identities

- Production Supabase: `hbllomlijfznnuudpdvr`
- Staging Supabase: `hlzqmreeoghbldnhlybr`
- Worker: `duediligence-gemini-examiner`
- Website: `https://duediligence.ph`
- Pre-Phase-3 rollback tag: `pre-phase3-production-20260728`

Stop if any production identity differs.

## Zero-downtime order

1. Run the read-only Phase 3 production preflight.
2. Inspect the migration ledger.
3. Apply only the reviewed Phase 3 migration in one transaction.
4. Verify schema, RLS, grants, functions, existing row counts, and public reads.
5. Deploy the Worker through the authenticated local Wrangler installation.
6. Verify grading, guest enforcement, Support, corrections, authentication, and
   new protected endpoints.
7. Merge the reviewed PR and allow GitHub Pages to deploy `/admin/` and
   telemetry last.
8. Run live public/admin/browser/mobile verification.
9. Delete exact synthetic production records by their captured UUIDs.

Do not use blind `supabase db push` while unrelated migrations exist.

## Forward recovery

Database migrations are additive. A Git revert does not reverse database
privileges or schema changes.

If the migration fails, rely on its transaction rollback and stop. If the
Worker fails, redeploy Worker version `6bbc497d-3afb-4bbe-93a8-4c591e11c991`.
If the frontend fails, revert the Phase 3 merge and redeploy the commit tagged
`pre-phase3-production-20260728`.

Do not drop additive Phase 3 tables during an application rollback. Leave them
inaccessible and inactive until reviewed forward SQL is prepared.

## Required post-migration checks

- existing row counts are preserved;
- the sole Super Admin remains unchanged;
- no founder account is invented;
- all new tables have RLS;
- `PUBLIC`, `anon`, and `authenticated` have no direct administrative writes;
- analytics and admin RPCs are service-role-only;
- subjects/questions remain publicly readable;
- grading still returns a 0–5 ALAC result;
- the fourth guest grade remains blocked before Gemini;
- Support and correction validation/storage remain functional;
- unauthorized `/admin/` requests return no data;
- exact synthetic records are removed.

## Account recovery

Case management may deploy. Final Google identity transfer must stay disabled
until the supported same-UUID handoff has been independently proven in staging.
