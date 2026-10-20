# Current staging compatibility verification

This is a frozen, metadata-only reconstruction of the currently approved replacement Examination Room, captured from staging on 18–19 October 2026. It contains no customer rows, passwords or hosted credentials. It is test material, not a migration or a deployment package.

The separate Debate rehearsal is blocked because the current Worker expects submission and recovery contracts missing from the captured shared staging database. These tests prepare a bounded repair without replaying historical migrations or changing the working site.

Native execution passed on 20 October in run39426693601. [The permanent verification record](../../../docs/debate-room-v3/staging-compatibility-verification-20261020.md) binds the exact source, report, independent review, failed attempts and fresh read-only staging comparison. This does not change the package's disposable-only scope or its hosted verification gaps.

## Run and scope

Run the dedicated `Current staging database compatibility` workflow. It provisions PostgreSQL 17.6 with a fixed disposable database, no provider credentials, and loopback-only access. Its native runner is `scripts/verify-current-staging-compatibility.mjs`. Local package integrity can be checked without SQL:

```sh
node scripts/verify-current-staging-compatibility.mjs scripts/fixtures/current-staging-compatibility artifacts/debate-local-rehearsal/native-compatibility-static --validate-only
```

Every executable input is bound by `manifest.json`. `current-schema.sql` imports 28 tables, 403 columns, 347 constraints, 122 indexes, 53 real triggers and 48 real functions. `verify-current-schema.sql` compares the resulting catalog before synthetic rows or proposed changes are added. Actual behavior runs as the captured non-superuser `postgres` role with its recorded bypass-RLS flag. The setup role is used only for provisioning and read-only lock observation. Anonymous, authenticated and service-role entrypoint checks are separate.

`forward.sql` changes six exact function definitions and adds one lease function and trigger. Its global guard accepts only the complete captured preimage or complete postimage; unknown or partially changed state aborts. It protects all 42 other captured functions and preserves metadata and all synthetic table hashes. `inverse.sql` is tested before concurrency cases can commit behavior-dependent writes. Both refuse any database except the disposable fixture, and neither is an approved hosted update.

Professor cases cover partial draft arithmetic against the submitted publication, strict final release, actor isolation, replay, batch atomicity, immutable evidence, latest-activation monitoring, email scope and heartbeat presence. Student cases cover intent and expiry continuation, revocation, no answer revisions after accepted submission, receipt bindings, recovery, email admission, and overlapping real connections. Inspect the phase SQL and runner report for actual executed assertions; authored tests do not establish passing results.

## Provenance and preservation

`fixture-manifest.json`, `baseline.json` and `postimage.json` record captured and proposed hashes. `professor-manifest.json` records the precisely scoped grading/monitor edits. `hardening-manifest.json` and `hardening-patches.json` distinguish source composition from the reviewed revocation, concurrency and SQL delimiter corrections. The original malformed offline draft remains a failed local artifact, never an applied migration.

The original generators, exact read-only capture queries and source blobs remain in this task's ignored `artifacts/debate-local-rehearsal/` evidence. This frozen package is independently hash-checked and does not run those generators during verification.

Whitespace inside captured function bodies is intentionally preserved because definition hashes cover those bytes. The four trailing-blank lines reported by a whole-diff whitespace check occur inside these captured/generated SQL strings; changing them would change the evidence or proposed definition hashes.

## Limits

The three external account/profile/role tables are empty synthetic projections with captured column types. They do not reproduce Supabase authentication, external RLS/triggers, email delivery, storage, Worker routing or browsers. Supporting platform roles are inert placeholders for schema permissions. No paid provider, mail consumer or real user is attached.

The normal Worker submission path obtains context and intent before final submission. SQL-only replay of an already accepted receipt after revocation does not establish browser or Worker receipt recovery; that remains an integration check. Student display-number consistency also remains open. Passing this database suite cannot replace the full Debate hosted rehearsal, current free/paid/admin journeys, physical media, real inbox checks, release approval or production readback.

No standalone lease backfill or identity merge is included. The dated staging inventory had no sessions or rosters; current metadata, configuration and row scope must be rechecked before any future hosted application. Restoring definitions after new behavior-dependent writes is not automatically a safe rollback.
