# Existing staging inventory — read only

Observed on 9 September 2026. No deployment, setting change, secret disclosure, migration, bucket creation, provider connection, or mail send occurred during this inventory.

The superior recovery task confirmed no active staging claim or freeze. It requires preservation and review of the existing staging configuration and bindings before a change. The recovery targets `duediligence-asset-recovery-preview` and `duediligence-site-recovery` remain excluded.

## Verified target

- Supabase connector lists `hlzqmreeoghbldnhlybr`, named `duediligence-staging`, as ACTIVE_HEALTHY, PostgreSQL17.6, region `ap-south-1`. The separate production project is `hbllomlijfznnuudpdvr`; it is not the target of this package.
- Read-only catalog queries found the existing private Study catalog and audit tables. The new Debate tables and Study admission tables are not applied. No Debate storage bucket is present.
- The Cloudflare dashboard shows the existing Worker `duediligence-examinations-staging`, served at `https://duediligence-examinations-staging.wallyesteban1993.workers.dev`. Its current100% version has the displayed prefix `b134ccc7`. A prefix is insufficient for deployment comparison; capture the full version/deployment IDs before release.
- The dashboard shows no additional resource bindings, one existing cron trigger, no queue consumers, compatibility date `2026-07-26`, `nodejs_compat`, placement GCP `us-east4`, cache disabled, and logs enabled. No setting was edited.
- The visible `SUPABASE_URL` and `ALLOWED_ORIGIN` match this staging database and Worker. `OUTBOUND_EMAIL_MODE` and the existing staging delivery modes are suppressed. Study Room is enabled with name `dd-study-room-admin-beta-staging-v1`.
- Existing encrypted Supabase service-role and LiveKit credentials are present. Secret values were neither revealed nor copied. A Resend key was not listed in this staging Worker; real mail is therefore an unresolved configuration and authorization gate.
- The existing GitHub `staging-e2e` environment has a staging Supabase service-role secret by name. This is not proof of its value, current privilege, or a protected approval mechanism: the environment listing reports no protection rules.

The read-only public configuration request returned HTTP200 and contains the staging project rather than the production project. An unauthenticated request to `/debate-room/access` returned HTTP403 from the existing Worker; that response does **not** establish that Debate Room is implemented or deployed there. Exact response hashes and timestamps are in the local ignored artifact `artifacts/debate-local-rehearsal/staging-inventory/public-readonly.json`.

## Before a staging mutation

Capture the full current deployment ID and sanitized remote settings/binding inventory through the release package, retain the deployable previous version for rollback, and compare its hash immediately before deployment. Preserve every unrelated binding and setting. A text inventory or dashboard prefix does not replace that baseline gate.

Review the exact candidate source, additive migrations and their hashes; apply only to this staging database. Keep public entry disabled, use explicit preview account UUIDs, and keep media, results mail and invitation mail disabled. Verify actual authenticated API and browser behavior after any authorized deployment. No approval for public launch, new spending, capacity load, or real recipients follows from this inventory.
