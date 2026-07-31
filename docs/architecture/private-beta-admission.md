# Private-beta admission architecture

Status: controlled private beta; production gate enabled after recorded release gates.

## Security boundary

GitHub Pages remains a public static host. The landing page can explain and
start admission, but it is not the security boundary. Protected capabilities
are enforced by the Cloudflare Worker and service-only Supabase functions.

The effective order is:

1. public landing and complete Beta Disclosure;
2. provisional browser acknowledgements after reaching the disclosure end;
3. exact server-side access-code verification;
4. the existing Supabase Google PKCE flow;
5. final authenticated acknowledgements;
6. transactional role and entitlement resolution;
7. a user-bound, signed 12-hour access token plus a matching server session;
8. protected Worker routes.

The approved landing reference is required before the public surfaces can be
implemented. The Worker gate remains disabled until that UI, legal review, and
all release gates pass.

## Tokens and storage

- Pending admission tokens are signed, opaque, one-use, and expire after
  exactly 15 minutes.
- Completed gate tokens are signed, user-bound, disclosure-version-bound, and
  expire after exactly 12 hours with no silent extension.
- Only hashes of token identifiers are stored in Supabase.
- The access code and reversible equivalents are never stored in the browser,
  database, repository, logs, responses, or static artifact.
- Supabase PKCE session persistence uses `sessionStorage`, not `localStorage`.
- The browser gate controller stores only the opaque pending/access tokens and
  an unprivileged random flow identifier in `sessionStorage`.
- Every authenticated Worker caller forwards the opaque access token through
  `X-DD-Beta-Access`; the secure human-examiner capability-token route remains
  independent of student admission.
- Sign-out must clear the Supabase session, gate token, pending token, flow
  identifier, OAuth return state, and private in-memory caches.

Because the production Worker currently uses a `workers.dev` endpoint, it
cannot set a same-site `HttpOnly` cookie for `duediligence.ph`. The candidate
therefore uses a short-lived opaque bearer token, strict origin validation,
explicit CORS headers, TLS, POST-only routes, and `Cache-Control: no-store`.
Moving to a same-origin Worker route requires a separately reviewed DNS and
routing change.

## Durable throttling

Access-code failures are counted in Supabase using only keyed hashes:

- five failed attempts per browser flow per 15-minute window;
- twenty failed attempts per network address per 15-minute window;
- a 15-minute block after a threshold is reached.

Raw network addresses and raw browser flow identifiers are not stored. The
network counter prevents a caller from evading the lower threshold by rotating
browser flow identifiers. Counter creation and locking are concurrency-safe.

## Role and entitlement behavior

- Existing `founder_admin` and `super_admin` roles are preserved.
- Existing `admin` roles are preserved.
- An admitted ordinary user receives `beta_tester`.
- No user can invoke admission functions directly through anon or authenticated
  PostgREST access.
- An admission creates a revocable, expiring private-beta record and reuses the
  existing Free Beta and examination-beta authorization paths.
- Existing indefinite or longer beta grants are never shortened.
- No payment, subscription, Premium purchase, or permanent paid entitlement is
  created.

## Production feature flag

`PRIVATE_BETA_GATE_ENABLED` was kept `false` throughout database, Worker, and
frontend preparation. It is committed as `true` only after the recorded legal,
role, security, legal-accuracy, capacity, migration, rollback, and deployment
gates passed. While enabled:

- private-beta admission endpoints are available to the approved landing flow;
- existing protected Worker routes require a valid, user-bound admission;
- secure human-examiner capability routes remain independently available; and
- the emergency close procedure is to redeploy the verified gate-disabled
  Worker version before any broader rollback.

The implemented landing and disclosure surface remains pinned to the approved
visual reference and versioned disclosure. Any later substantive admission or
legal-copy change requires a new review cycle.

## Migration and rollback

The migration is additive except for extending the existing role check to allow
`beta_tester`. It must be applied to production only after the read-only
preflight passes against the exact production project.

A Git revert does not roll back database state. Application rollback is:

1. set the Worker gate flag to false and deploy the last known-good Worker;
2. restore the last known-good Pages artifact;
3. leave the additive tables inactive;
4. use separately reviewed forward SQL if database objects must later be
   retired.

Any partial migration failure is a stop condition. Do not deploy the Worker or
frontend after such a failure.
