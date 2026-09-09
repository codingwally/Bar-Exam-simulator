# Staging rollback probe: review and local verification only

This package has **not run against hosted Supabase**. The SQL is a concrete rollback-only compatibility probe for the existing staging project `hlzqmreeoghbldnhlybr`. It is not a migration application or deployment approval. It creates no Auth accounts, calls no providers, and returns no business records.

The supported hosted execution transport remains an open gate. The Supabase connector's `execute_sql` instruction directs DDL to `apply_migration`; this probe must not be sent through `execute_sql`, and `apply_migration` must not be used as a pretend rollback transport because it manages the migration ledger. A separately approved transport must preserve one database connection and the complete transaction, propagate errors, and support the final rollback/readback. No hosted command is prescribed here while that gate is unresolved.

## Exact inputs

The reviewed feature candidate is `7be9f9d17831ef430a355589fa47e8b76421375a` (draft PR 356). Source identity must be rechecked if that candidate changes.

| Input | SHA-256 |
| --- | --- |
| `staging-rollback-probe.sql` | `ce653a3902b58c038c4fc44ff24d136a05fa1723699288bbf436d6111b6e6a9b` |
| Debate draft and matching migration | `89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c` |
| Study admission draft and matching migration | `5ca7d139bb925b00c82d391aab4f566446d5d1bdd25e0b1b271fde614cb11637` |

The artifact embeds the exact candidate bodies between labeled markers. Only each verified outer `begin;` and final `commit;` line was removed. All other candidate bytes are preserved. The probe has one outer `BEGIN`, one `ROLLBACK`, and no `COMMIT`. It sets transaction-local lock, statement, and idle-in-transaction timeouts to 5, 30, and 10 seconds respectively. PostgreSQL cannot prove the Supabase project identity from this SQL; the execution transport must independently enforce the exact staging target.

## What the probe checks

Before candidate DDL, the probe requires the observed PostgreSQL 17 administrative role and schema permissions. It rejects any candidate relation, type, function overload, or migration version already present. It checks the existing Study catalog migration record, exact prerequisite column and constraint descriptors, five existing function fingerprints and execution privileges, existing Study RLS/ownership, and the observed default ACLs, including PostgreSQL 17 `MAINTAIN`. A mismatch aborts before candidate DDL. The existing hosted Study catalog migration version differs from the repository's older catalog filename; the probe preserves that ledger record and never replays the catalog migration.

The probe records hashes of all existing Study catalog rows, catalog audit rows, and migration version/name records without returning those rows. After installing both candidates inside the transaction it checks all ten Debate tables for RLS, table and column privileges, and the expected sixteen service-only functions. It checks the two Study admission tables and six added Study functions. In particular, service-role access must not inherit unintended `UPDATE` on the Debate audit table or `TRUNCATE`, `REFERENCES`, `TRIGGER`, or `MAINTAIN` privileges. This covers the hosted default-ACL incompatibility found in the earlier read-only review and fixed in the current Debate candidate.

Actual `SET LOCAL ROLE` assertions verify anonymous and authenticated denial and service-role access. Two embedded command envelopes were captured from the real `createDebateService` command path: creation and update of a clearly synthetic rehearsal event. They exercise create/read/update/delete, identical-command idempotency, conflicting idempotency payloads, stale revision rejection, immutable ownership, and append-only audit receipts. The synthetic actor is a text identifier; no Auth row or account is inserted. Direct audit `UPDATE` and `TRUNCATE` must raise SQLSTATE `42501` and leave audit contents unchanged. Synthetic event/receipt/audit records are explicitly removed and then the entire transaction is rolled back.

Study verification compares the v1 and v2 catalog responses without returning their contents, checks rejected invalid admission/configuration calls, and preserves all five pre-existing function fingerprints. It does not create or reconfigure a Study room. The existing catalog, catalog audit, and migration ledger hashes must remain unchanged before rollback. After rollback, candidate object/version absence and restoration of the original Study audience default/constraint are asserted. The final response returns only status and hashes so they can be compared with the first checkpoint.

## Local evidence and limits

The disposable local run passed with status `PASS_LOCAL_VERSION_ADAPTED_ROLLBACK_AND_NEGATIVE_GATES`. Its report is saved under the ignored path `artifacts/debate-local-rehearsal/rollback-probe/local-report.json`. The local fixture reproduces the permissive hosted public default ACLs and uses the existing repository Study catalog SQL.

Two **in-memory test-only deviations** were required; neither changes the reviewed artifact:

1. Bundled PGlite 0.5.7 uses PostgreSQL 18.3, so the test variant changes the PG17 version guard to PG18. The unmodified artifact correctly rejects that local runtime.
2. The repository's local `admin_authorization_context` model has fingerprint `81198e9114a40c1126ba1e0b18c7625b`, while hosted metadata reports `51ea270969dd6283a3e29b8fbff10561`. The local variant substitutes only that expected fingerprint. All four existing Study v1 function fingerprints match the hosted metadata exactly. The version-only variant correctly rejects the helper drift.

The adapted SQL hash is `e7d0573eeb23fb26e4b110d8962ccde1b58add1698b832724f6a54ce92e36a6f`. The full transaction and rollback passed with identical before/after catalog, audit, and migration hashes. Five negative cases passed: wrong PostgreSQL version, helper fingerprint drift, a pre-existing candidate-name collision, prerequisite column/default drift, and removal of the service-role default-ACL fix. The last case failed at the explicit Debate privilege check and left no candidate objects after rollback.

This is meaningful local SQL evidence, not exact hosted execution evidence. It does not prove the hosted authorization helper's body, real account admission, multiple-connection contention, a physical-media or 90-minute rehearsal, mail delivery, deployment, or public-launch readiness.

## Required review and later readback

Before any authorized hosted attempt, independently verify the transport, exact project, complete SQL hash, source hashes, current collision/privilege/function metadata, and unchanged migration state. Capture a sanitized baseline and avoid concurrent Study administration during the short probe. A detected drift is a stop condition, not permission to overwrite or terminate another task's work.

If any statement fails, the transaction is aborted: ensure rollback on the same connection; never commit a partial probe. Regardless of the reported outcome, root must perform independent read-only checks for absence of every candidate object and migration version, unchanged Study column defaults/constraints, original function fingerprints and grants, and equality of the before/after catalog, audit, and ledger hashes. A lost connection or missing final response is an unresolved verification gap until that independent readback succeeds. No deployment or migration application is authorized by a successful rollback probe.
