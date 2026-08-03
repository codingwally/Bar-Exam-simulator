# DueDiligence 2026 launch checkpoint

Recorded: 2026-08-04, Asia/Manila

## Current candidate

- Branch: `agent/duediligence-2026-features`
- Baseline: `3e5004eb71dd3322a8237aa5dc7778ac47175601`
- Staging Worker version: `2d3b8f84-4695-45cb-bd59-9f5ed039e8aa`
- Staging database: `hlzqmreeoghbldnhlybr`
- Production database (untouched): `hbllomlijfznnuudpdvr`
- Production Worker (untouched): `15563805-39d0-4774-a589-3e0e3ef1b474`
- Production Pages baseline (untouched): commit `3e5004e`, deployment `5727533734`, workflow run `30820543697`

## Gate state

| Gate | State |
|---|---|
| G0 | PASS |
| G1 | PASS |
| G2 | PASS |
| G3 | PASS |
| G4 | PASS |
| G5 | PASS |
| G6 | PASS |
| G7 | PASS |
| G8 | BLOCKED |
| G9 | PASS |
| G10 | PASS |
| G11 | BLOCKED |
| G12 | BLOCKED |
| G13 | BLOCKED |
| G14 | BLOCKED |
| G15 | BLOCKED |
| G16 | NOT RUN |

Full evidence and exact blockers are in `G3-G16.md`.

## Resume requirements

1. Configure scoped Google OAuth backup credentials in staging only and run a real isolated Sheet write/verify/reconcile/permission-removal test.
2. Run the exact live staging `1`, `7`, `20`, and `35` question-count matrix.
3. Run one controlled staging email delivery and retry-without-reopen test.
4. Reconcile the 11 staging security-advisor WARN findings or document reviewed, justified remediations accepted by the specification owner.
5. Complete authenticated browser, cross-browser, and screen-reader journeys.
6. Reconcile the `025`–`029` migration ledger before proposing any production command.
7. Rerun G8 and G11–G15. Only if all pass may G16 begin in database → Worker → frontend order.

## Rollback references

- Git/frontend: restore the last known-good production commit/deployment above.
- Worker: deploy production version `15563805-39d0-4774-a589-3e0e3ef1b474` at 100% if a later application release fails.
- Database: do not delete submitted evidence. Use reviewed forward-recovery SQL and disable affected 2026 flags; Git revert is not a database rollback.
