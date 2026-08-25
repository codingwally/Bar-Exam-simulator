# Live Experience Release â€” 2026-08-11

## Immutable baseline

- Base commit: `edbd2771c06623d063cafb7f6c4e12366f588334`
- Implementation branch: `agent/live-experience-improvements-20260811`
- Production project: `hbllomlijfznnuudpdvr`
- Staging project: `hlzqmreeoghbldnhlybr`
- Worker: `duediligence-gemini-examiner`
- Production Worker version before this release: `e4f2ccfb-0ea0-4b04-84d1-c1195cf22dc7`
- Production Pages run before this release: `31457673970`

The verified Subject Matter release is an immutable content baseline for this
work: 42 courses, 1,890 placements, and 1,490 canonical questions. This release
must not change the approved question content, coaching prompts, Gemini rubric,
or 0â€“5 grading behavior.

## Live-audit evidence

The fresh production screenshots are stored outside the repository in:

`C:\Users\wally\OneDrive\Desktop\DUEDILLEGENCE PROGRAM\live-audit-20260811`

The audit covered the signed-out landing and admission flow, signed-in product
home, Mock Bar timer choice, Subject Matter, The Verdict, Quorum, and Bar Feels.
Exact synthetic attempts created by the audit were removed and verified absent.

## Release order and stop conditions

1. Validate all local unit, contract, migration, security, content, and browser
   checks.
2. Apply additive migrations to staging only and run behavioral RLS tests.
3. Deploy and verify the staging Worker.
4. Verify the staging frontend, responsive states, accessibility, autosave,
   authorization, and synthetic cleanup.
5. Re-run production read-only identity, ledger, schema, and row-count gates.
6. Apply only reviewed production database changes transactionally.
7. Deploy and verify the Worker without exposing secret values.
8. Deploy the frontend last through the existing GitHub Pages workflow.
9. Run live production smoke tests and remove exact synthetic records.

Stop before production if project identity, migration history, core row counts,
RLS behavior, grading regression tests, or rollback evidence differs from the
approved baseline. A Git revert is not a database rollback; database recovery
requires reviewed forward SQL.
