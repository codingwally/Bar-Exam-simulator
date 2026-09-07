# Astra staging fixture reporting registration

This is optional staging verification infrastructure, separate from the active
Forecast/payment production migration bundle. No grading, customer entitlement,
role, browser, email, or production fixture behavior changes.

The coordinator must verify and select the staging project before separately
installing `20260907190944_astra_staging_fixture_registration.sql`. SQL does not
claim to establish project identity from an invented setting. The current
Forecast verifier remains hard-pinned to staging; the RPC recognizes only its
strict `astra-durable-<13 digits>-<8 lowercase hex>` prefix and member/other/unpaid
`@example.com` addresses, not controlled-mail or production fixtures.
The migration rejects unknown same-name function/ACL drift and unexpected
registry permissions; an exact existing implementation can be replayed.

## Sequence and authorization

Preflight requires the exact service-role RPC rejection for all-null arguments,
which is rejected before any Auth lookup/write. Missing RPC/permissions or an
unexpected response stops the verifier before account creation.

1. Existing CI service credentials create the disposable normal Auth account,
   including a versioned `app_metadata.astra_staging_fixture` marker. The
   user-editable marker remains solely part of the existing cleanup contract.
2. Persist the exact fixture cleanup manifest before registration.
3. Call the service-only registration RPC and validate its account-bound result.
4. Only after confirmed registration, perform normal password sign-in, existing
   onboarding, and the existing separately granted one-hour fixture access.

The public RPC is SECURITY INVOKER; its private SECURITY DEFINER implementation
has an empty search path and fully qualified relations. Neither anonymous nor
authenticated clients can execute either function. The existing private registry
table permissions, RLS, schema grants and API schema exposure are unchanged.
The service role needs its already-existing private-schema USAGE permission to
call the private implementation; this migration does not broaden that grant.

Registration requires the exact fresh Auth identity (created within 15 minutes),
trusted marker, verified email provider, student role and no capabilities,
payment/subscription/free-beta rows, prior sign-in, session or refresh token.
The Auth and role rows are locked while checking and inserting classification.
No row other than this fixture's registry entry is inserted or updated.
An exact retry preserves the original classification timestamp. Retries after
sign-in are deliberately rejected; this is not a retrospective reclassification
API. An existing different classification is never overwritten.

No registration error or ambiguous result falls through to sign-in. Cleanup
still has the durable fixture identity if registration fails. This change does
not retrofit active or old fixtures, relabel Pulse history, or delete anything.
Other staging helpers remain separate and must not be claimed fixed here.

## Local verification

`node --test worker/astra-staging-fixture-registration.test.mjs` runs actual local
PGlite role/identity/state/idempotency checks and the real fixture-creation source
with mocked transports to prove ordering and failure containment. It fails if
PGlite is unavailable. Mandatory CI's existing Worker wildcard runs this test;
the exact new migration path also triggers that workflow.

The tests do not claim independent concurrent PostgreSQL sessions, a hosted RPC
rehearsal, or exclusion of other existing staging fixture creators. Hosted
installation and normal Auth rehearsal require separate coordinator approval.
