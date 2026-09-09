# Prepared staging DML rollback probe

This is a **prepared, not SQL-executed** probe for the already-installed, reviewed Debate and Study migrations on staging project `hlzqmreeoghbldnhlybr`. It is separate from the earlier local schema-installation rollback rehearsal. It does not replace that evidence or claim that hosted schema installation was rolled back.

The V3 acceptance clause F05 calls for retention/deletion, account isolation, backup/recovery, migration rollback, and audit restrictions to be tested on controlled data. These are distinct claims. The existing local installation-and-rollback test covers its stated local scope. This new batch can add actual hosted transaction, privilege, and rollback evidence after the exact additive migration bodies have been applied through the supported migration tool. Neither proves backup restoration or the complete F05 clause alone.

## Files and reproducibility

- `staging-dml-rollback-probe.sql`: one transaction with 64 assertions, followed by read-only rollback checks; 98 statements total. Its current SHA-256 is recorded in `staging-dml-rollback-probe.manifest.json`.
- `staging-dml-rollback-probe.readback.sql`: independently runnable read-only post-rollback checks and sanitized hashes.
- `staging-dml-rollback-probe.fixtures.json`: two frozen envelopes emitted by the actual current `createDebateService` through a disposable in-memory store. The create and update inputs, payload hashes, full event state, receipts, and audit records are preserved. Only random receipt IDs are normalized when checking regenerated equivalence; hosted execution uses the frozen envelopes unchanged.
- `staging-dml-rollback-probe.denials.json`: six separately runnable expected-error probes. These have not run. They are intentionally outside the main successful transaction because a PostgreSQL error aborts the transaction and this artifact creates no error-catching function or anonymous block.
- `scripts/debate-staging-dml-probe.mjs`: generates the artifact locally and has no hosted connection or execution path.
- `scripts/test-debate-staging-dml-probe.mjs`: three lightweight tests of reproducibility, service-envelope equivalence, transaction boundaries, rejected DDL/commit/out-of-scope writes, and readback scope; a fourth test executes the installed SQL and six expected-error probes only on an isolated Linux GitHub Actions runner.

Run `node scripts/debate-staging-dml-probe.mjs` to reproduce the SQL and manifest from the frozen fixtures. `--capture-fixtures` deliberately replaces the frozen synthetic envelopes and therefore changes their reviewed hashes; it is not needed for ordinary verification. Run `node --test scripts/test-debate-staging-dml-probe.mjs` for verification. Three checks passed locally on September 9; the actual SQL test explicitly skipped because the workstation is not an isolated Linux CI runner. JavaScript syntax and artifact shape were checked; PostgreSQL parsing/execution was not performed locally because of the workstation's memory constraint.

The fourth test uses locked PGlite 0.5.7, the existing repository's hardened local administrator helper, the exact original Study migration, and both exact candidate migration files. Only its in-memory probe variant changes the PostgreSQL version guard from 17 to 18 and substitutes the local helper's definition fingerprint for the hosted fingerprint. It leaves the reviewed hosted artifact unchanged and records both hashes, all assertion results, rollback checkpoints, independent readback, and actual expected SQLSTATE values in `artifacts/debate-local-rehearsal/staging-dml-probe-ci/report.json`. Its result remains pending until CI executes it. This variant is not native multi-connection PostgreSQL or proof of the actual hosted helper body.

## Preconditions and protected scope

The release coordinator must independently pin the connector call to staging project `hlzqmreeoghbldnhlybr`, verify current deployment ownership, and record the exact migration application receipts. SQL cannot identify a Supabase project by itself. No query in this package targets production, creates an Auth identity, changes account roles, calls a mail/media provider, or writes Study tables.

The artifact binds the already-reviewed migration bytes: Debate SHA-256 `89d4f46b1e1b2991202880114387a1356b5eedfcf562129079de83d55a94b53c` and Study SHA-256 `5ca7d139bb925b00c82d391aab4f566446d5d1bdd25e0b1b271fde614cb11637`. The caller must separately bind each applied migration's actual hosted name/version to these bytes and retain the tool receipt. `apply_migration` may assign a hosted timestamp different from the local filename. This batch neither invents that version nor changes migration history. The existing September 8 Study catalog migration identity and five original function fingerprints remain strict drift guards.

Other guards cover PostgreSQL 17, expected role/RLS attributes, private-schema access, original Study column/default/constraint/helper shapes, 22 exact candidate function bodies and signatures, their owners/security modes/settings/grants, exact candidate function counts, all 12 new table column/primary-key shapes, RLS and table/column grants, validated constraints, and absence of unexpected user triggers or policies. Checks include the audit table's missing UPDATE, TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN privileges. A drift fails the batch; it is not permission to rewrite the drifted objects.

Two fixed synthetic UUIDs are used only as Debate's text actor identifiers. The batch first requires that neither exists in `auth.users` and that its event/actor/job scope has no prior records. A collision stops the probe. No real account credentials or customer emails appear in these files.

## What the transaction exercises

Under actual `SET LOCAL ROLE service_role`, the batch calls the installed RPCs with the frozen create and update envelopes. It checks the exact replay receipt, a conflicting payload hash, stale revision, immutable owner, nonmember rejection, updated state, actor list isolation, and two appended audit/receipt rows.

One explicitly inert SQL outbox fixture exercises the installed claim and completion RPCs: first claim, refusal to reclaim an active lease, reclaim after simulated expiry, refusal of the stale claim's completion, and successful completion with the current claim. This is a database lease test. The job is not service-generated, no adapter runs, and completion does not mean an email or media operation occurred.

The service role deletes only those exact synthetic rows, proving its intended cleanup grants. It then recreates the actual synthetic event, receipt, and audit rows and requires that they are present immediately before `ROLLBACK`. Their absence afterward therefore tests a real rollback, not merely prior explicit deletion. Study v1/v2 catalog read parity and hashes of the catalog, audit, admission tables, command table, and migration ledger must remain unchanged within the transaction. Only hashes are returned for existing records.

## Execution and evidence handling

Use a supported single-connection SQL transport and send the entire main file as one batch. This file contains only BEGIN, SET LOCAL, SELECT, its bounded INSERT/DELETE, and ROLLBACK statements. It contains no DDL, `DO`, function creation, manual COMMIT, or migration-ledger mutation. Do not send the older DDL installation probe through a tool whose DDL contract requires `apply_migration`.

A failed SELECT assertion raises division-by-zero and aborts the transaction. Record the named failed check and actual database error. Confirm rollback or connection closure; do not try to continue or commit an uncertain transaction. Then run the independent readback, including after timeouts or missing responses. A missing final result or lingering sentinel is an unresolved verification gap. The `idle_in_transaction_session_timeout` is an additional bound, not proof that cleanup happened.

Capture baseline and post-run readback hashes independently and compare them; the main batch's transaction-local variables disappear on rollback. Avoid simultaneous Study administration during this brief integrity probe so an unrelated change is not misclassified. Keep full tool execution output with the reviewed SQL hash. A final absence check alone does not prove that the earlier transaction ran: the successful main batch's evidence must also show that its checks ran through the pre-rollback sentinel checkpoint.

Run expected-error probes separately only when the transport's aborted-transaction cleanup behavior is known. Record each actual SQLSTATE. The audit UPDATE uses `WHERE false`, so even an unintended grant cannot change a row; success would fail that test. There is no actual TRUNCATE attempt. Table privilege metadata establishes that missing right without risking a table-wide action.

## Remaining limits

The current files contain no executed SQL claim. Even after a successful hosted run, they will not prove actual Auth sign-in, Study waiting/admission with real accounts, native multi-connection contention, hosted schema-installation rollback, backup restoration, provider capacity, camera/audio, mail delivery, the required 90-minute physical rehearsal, deployment, or public launch approval. These gaps must remain explicit in the requirement ledger.

Supabase's current transaction documentation confirms that a JavaScript query does not join other calls into a single transaction; transaction scope must be preserved by the execution transport. See the [Supabase rollback reference](https://supabase.com/docs/reference/javascript/using-modifiers-rollback) and the [single-connection transaction example](https://supabase.com/docs/guides/functions/kysely-postgres). The September 9 changelog review found no applicable change requiring this plain PostgreSQL DML probe to alter schemas or dependencies.
