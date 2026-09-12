# Shared media capacity foundation — not activated

Source base: `7cf505dea809fbb8f35d6c88171fba7b62bf52cd`. This change adds isolated primitives, tests and a dedicated credential-free PR validation workflow. It does not modify any Study or Debate issuer, room, route, existing workflow, provider setting, credential, existing table, paid plan or deployed database. F01/F02 acceptance is not established.

## Files and interfaces

- `worker/media-capacity.mjs`: dependency-free server adapter and physical-epoch counter. `createMediaCapacityStore({rpc, projectId, coordinatorId})` uses the existing server RPC transport. Methods: `reserve`, `read`, `markIssued`, `markConnected`, `markUncertain`, `requestRelease`, `confirmReleased`, `unresolvedCommands`.
- `supabase/migrations/20260909193705_shared_media_capacity_foundation.sql`: generated with cached offline Supabase CLI 2.117.0 `supabase migration new shared_media_capacity_foundation`; implementation has not executed against any local or hosted database. Creates four private tables, one private definer function and one public invoker wrapper. Only service-role execution is granted; direct service-role table access is revoked. No policy or scope rows are inserted. Policy and scope `enabled` fields default false; budgets default zero; default external project occupancy is 100.
- `worker/media-capacity.test.mjs`: inert transport, input, response, single-flight, unknown-outcome, physical-count and proof-binding checks.
- `scripts/test-media-capacity-sql.mjs`: exact migration in a dedicated native PostgreSQL17 CI database, with real independent connections contending for the shared last seat.
- `.github/workflows/media-capacity-foundation.yml`: narrowly scoped PR validation, inert adapter checks and a disposable PostgreSQL17.6 container. It receives no provider/environment secrets and cannot deploy or enable the feature.

`rpc` receives `('media_capacity_command', {p_command})`. Authentication, product admission, role/floor authorization, actual provider evidence, and binding the canonical database are future coordinator responsibilities. The pinned project/coordinator UUID pair stops accidental cross-project calls; it is not cryptographic proof of the provider project or database identity. Never deploy independent counters for staging and production if they share a LiveKit project.

## Admission and accounting contract

One project-policy row lock precedes all capacity mutations. Configured scopes pin product, room, event, session and their caps. Clients cannot choose those caps through the RPC. Scope limits are administrator-owned configuration; future configuration changes must hold the same project lock and increment its revision. There is deliberately no policy-enabling API in this foundation.

Every `reserved`, `issued`, `connected`, `uncertain` or `revoking` epoch consumes one seat. Only `released` is excluded. Tokens, disconnect notices, elapsed TTL and missing client heartbeats never decrement occupancy. External occupancy is included in project and mapped room/session/event checks; inconsistent totals fail closed. Freshness timestamps and external counts are supplied by a future trusted inventory process, not discovered by this module.

Default capability ceiling is 100, with 10 proposed reconnect slots reserved from normal admissions. These defaults are not measured capacity. A replacement can use project headroom only when the same actor has exactly one prior issued/connected/uncertain/revoking epoch. Both epochs count until the previous one is fenced. A second parallel replacement is denied. Room/session/event caps still apply: this foundation does not override a full 12-seat Study room. A future coordinator must implement orderly release-before-replacement or queueing when a room has no overlap space. Same-epoch token renewal retains its seat and does not debit a second allocation.

Each new physical epoch debits requested seconds (10–21,600, further bounded by scope policy) and bytes from an explicit allocation. Budgets never automatically refund on release, expiry or retry. Admissions fail when inventory/allocation expires, totals exceed the allocation, or an unreleased epoch outlives its reserved duration. There is no automatic termination of an ongoing scored debate. These are conservative **admission allocations**, not measured invoices, enforced bandwidth limits, or a guarantee against unbounded overtime spending. Provider metering, existing Study commitments and the no-spend boundary must be verified before any media activation.

## Token and release contract

The foundation issues no JWT. `markIssued` records a mint intention with at most a 30-second initial-token deadline inside the allocated duration. Future token code must validate room authorization and reservation immediately before and after asynchronous signing and before returning a token; a concurrent release must prevent that token from being delivered. The generic `mc-<epoch UUID>` identity is not silently compatible with the current Study or Debate identity validators; integration must explicitly migrate those bindings.

`requestRelease` persists a revoking state, command ID and timestamp before provider removal. `confirmReleased` requires that exact binding, an acknowledged revocation cutoff later than the recorded mint/release second, and subsequent positive absence observed within 15 seconds. Proof must identify the same project, room and epoch identity. Policy disablement does not prevent release. Replayed commands return the current reservation, not a stale usable state.

The service coordinator must produce this proof from validated LiveKit responses. SQL checks its structure, time ordering and binding; SQL cannot independently verify a caller's provider observation. Tests use explicitly inert provider observations and never imply live fencing. Official LiveKit documentation states that connected clients receive refreshed tokens and that initial expiry does not remove reconnect rights; Cloud removal supports explicit revocation cutoffs. Webhook delivery is not guaranteed, so future reconciliation needs read repair as well as signed webhook handling:

- https://docs.livekit.io/frontends/reference/tokens-grants/
- https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/
- https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/

Unknown mutating responses remain held in the adapter; it does not automatically retry. The database still counts the physical epoch and persists accepted command receipts. `read` remains available for explicit reconciliation. The future coordinator must persist its operation manifest across process restarts; recreating an adapter does not resolve a previously unknown provider outcome.

## Tests and remaining integration

Lightweight local command:

```text
node --test worker/media-capacity.test.mjs scripts/test-media-capacity-sql.mjs
```

Native runner requires all of: Linux, `GITHUB_ACTIONS=true`, `MEDIA_CAPACITY_SQL_CI=1`, PostgreSQL17, `PGHOST=127.0.0.1`, `PGPORT=5432`, `PGUSER=postgres`, `PGDATABASE=media_capacity_ci`, and an inert disposable `PGPASSWORD`. It refuses another database or a preexisting capacity schema, inherits only narrow system/PostgreSQL variables, and never receives Supabase/LiveKit/Cloudflare credentials. Run the command above in that dedicated job. Output: `artifacts/debate-local-rehearsal/media-capacity-native-ci/report.json`; it records exact LF source hashes and whether actual concurrent connections were reached. SQL function timeouts are configured; hosted PostgREST timeout hoisting remains unverified.

Future required touchpoints: `worker/debate-service.mjs`, `debate-store.mjs`, `debate-media.mjs`, `debate-integration.mjs`, `study-room-core.mjs`, `study-room-routes.mjs`, `study-room-admission.mjs`, the existing scheduled handler in `worker/index.mjs`, and Study/Debate client join/leave recovery. Debate admission must call the reservation helper inside the same eventual authoritative transaction as its event commit, preserving lock order and rollback. Study must adopt the same coordinator. Existing live participants and old room generations need a nondisruptive inventory/bootstrap and old-token transition before new Debate admission opens. Add these new sources and native checks to existing release manifests/workflows only after review; no existing release workflow or activation path is changed here.
