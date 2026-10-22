# Staging application envelope verification inputs

These are frozen, **unapproved review inputs for disposable native verification**. They are not an applied migration, a deployment, or authorization to update staging. Both SQL files reject their default binding before acquiring locks or changing definitions.

The six inputs in `manifest.json` are byte-identical to the corresponding files in the offline review packet. The subset manifest records the original review manifest hash and the four omitted review outputs; no declared input is optional. The omitted structured tool requests are not needed by, or supplied to, this runner. No migration executor is included.

The six changed function bodies and new lease function/trigger come from the independently verified `current-staging-compatibility` package. Native runs 39426693601 and 39427673315 passed that earlier package. They do not certify this new hosting envelope. The original `newEnvelopeNativeSqlExecuted: false` and SQL comments are preserved as generation-time provenance; any later execution must have its own exact-source report.

Tests may replace only the uniquely delimited approval binding with synthetic declarations inside a fresh, isolated PostgreSQL container. Such declarations are never owner approval or proof of a real ingress pause. Test-only fault injection must be reported separately and must not alter these frozen inputs. No hosted credentials, customer data, provider request, email, payment or production deployment belongs in this verification job.

Before any real application decision, the separate operational requirements remain: an enforced pause and drain, fresh metadata and deterministic row digests, verified project and executor identity, a supported execution deadline and cancellation behavior, independent authorization for the exact request, preservation readback, and the hosted browser rehearsal. The inverse is prohibited after writes resume. See the current staging compatibility verification document for the narrower database behavior results and the website audit ledger for open route coverage.
