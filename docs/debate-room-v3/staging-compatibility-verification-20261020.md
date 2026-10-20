# Current staging compatibility verification — 20 October 2026

**Scoped native database checks passed. Hosted application and full acceptance remain open.** [Run 39426693601](https://github.com/codingwally/Bar-Exam-simulator/actions/runs/39426693601) executed the proposed compatibility repair in disposable PostgreSQL 17.6, using the captured current replacement Examination schema and synthetic data. No application code, staging database, deployed setting, production service, customer account or email was changed.

## Exact evidence

- Candidate `70dce183f020c6fc52d98662e99184e03d885d92` and tested merge `9928436e4293ccf9cf7bc823ceb2ccc1ca9282e8` share tree `f16a6f5d082723b99976f340d820cf580d96c843`.
- The [unaltered runner report](evidence/current-staging-native-39426693601.json) records execution from 13:00:29.361 to 13:00:32.476 UTC: 25 runner checks, seven expected outer SQL errors, 16 completed phases and four observed overlapping-connection races. These counts describe different evidence levels and must not be added together as independent tests.
- [Independent verification](evidence/current-staging-native-review-20261020.json) matched all 19 package inputs, the package manifest and the runner against exact Git blobs: 21 comparisons, zero mismatches. It checked assertion reachability, false/NULL rejection, real guards, race blocking and the equal candidate/merge trees.
- [Six fresh read-only captures](evidence/current-staging-fresh-comparison-20261020.json), taken from staging `hlzqmreeoghbldnhlybr` between 13:02:26 and 13:02:33 UTC, match the tested function, schema, runtime, external-column and aggregate snapshots exactly except capture timestamps. Sessions, rosters and active duplicate-email groups remain zero. Separate read-only transactions are not a locked cutover snapshot.

The raw report retains a generation-time limitation saying native execution is still required. It is preserved verbatim for integrity; the completed phases in that same report and independent review establish that execution now occurred. Other limitations remain applicable.

## What actually passed

The fixture imported and compared 28 tables, 403 columns, 347 constraints, 122 indexes, 53 real triggers and 48 real functions. Actual behavior ran as the captured non-superuser `postgres` role; anonymous/authenticated entrypoint denials and the service-role boundary were exercised separately.

The repair changes six exact function definitions and adds one lease function/trigger. Tests verified all 42 protected definitions and permissions; rejection of a missing fixture marker, changed protected dependency and partial update; rollback after a forced late failure; unchanged hashes for all 28 synthetic tables; repeated forward application; exact inverse and repeated inverse; and restored pre-change behavior.

Professor cases executed partial draft arithmetic against the submitted version, strict full-result release, authorization, replay, batch failure, immutable evidence, current-activation monitor scope, heartbeat presence and restricted email display. Student cases executed intent/expiry continuation, receipt bindings, old and current receipt replay, revocation, privacy withdrawal, email admission and recovery. Four real concurrent connection pairs demonstrated normalized-email serialization, one consent/session on simultaneous entry, session revocation preceding intent, and activation revocation preceding intent.

The [attempt history](evidence/current-staging-native-attempts-20261020.json) preserves the failed container, diagnostic, delimiter and fixture checkpoints. Corrections made valid synthetic publications and historical receipts; no real application guard or expected outcome was weakened.

## Remaining boundaries

The files in `scripts/fixtures/current-staging-compatibility/` reject hosted application. Passing this package does not authorize copying its fixture setup into staging. Before any staging update, prepare the separate exact target-bound definition change and inverse, refresh the full preservation scope and Worker configuration, reconcile staging ownership, and resolve the applicable staging release decision. No identity merge or lease backfill is proposed.

The normal Worker submission path calls context and intent before final submission. Direct SQL receipt replay after revocation does not prove browser or Worker receipt recovery. Entered student-number display consistency also remains open. External account tables are synthetic column projections, not a full Auth/RLS replica.

The fresh hosted Examination smoke, Study catalog/admission journeys, complete 93-minute Debate rehearsal, three-judge privacy, actual file delivery, free/paid/admin coverage, physical media, real inbox delivery, capacity and production readback remain unverified here. The unrelated promotional narration workflow still fails HTTP404; this native pass does not make that workflow green. PR413 and these results do not deploy the repairs.
