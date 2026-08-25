# Proposed `AGENTS.md` Rules

Status: **draft only — do not install in this planning phase**
Proposed scope: repository root, with narrower nested rules permitted only when they do not weaken these safeguards

## Purpose

These rules prevent future Examination Room work from skipping the approved journey, coupling state to supporting jobs, or declaring readiness after shallow checks. They apply to humans and agents changing Examination Room frontend, Worker, database, storage, email, Gemini/Assistant Proctor, files, tests, or deployment behavior.

## Draft text

```markdown
# Examination Room engineering rules

## Authority

For Examination Room work, follow the latest owner-approved requirements and decision log, then approved flow diagrams/data contracts, then verified repository behavior. Existing code or documentation does not override a newer approved decision. If they conflict, stop and record the conflict before editing.

## Before coding

1. Plan before coding. State the single workflow, user intent, current trace, target state transition, invariant, risks, tests, rollback, and approval boundary.
2. Work one workflow at a time. Do not mix unrelated cleanup, visual redesign, schema change, delivery work, or deployment.
3. Trace Browser → local store → Worker route → authorization → RPC/database → response → visible UI state. Name exact files/functions/routes/RPCs/tables/migrations/tests. Mark anything unproven `UNVERIFIED — REQUIRES IMPLEMENTATION-PHASE CONFIRMATION`.
4. Complete the approved downstream-impact record for the action, including refresh, offline, concurrency, cross-device, email/file/AI failure, audit, rollback, automated test, and human test.
5. Follow the approved numbered flowchart and decision IDs. If implementation needs a different flow, update the decision log and obtain owner approval before code.

## State safety

6. Add or update tests before changing state logic. Demonstrate the current test fails for the defect/invariant and the corrected test passes.
7. Add a permanent regression test for every human-reported defect. A screenshot or source-string assertion is not a regression for a browser/state/file/email failure.
8. Use server-authorized, revisioned, idempotent commands with receipts. Never infer success from a timeout; query the command receipt before retry.
9. Preserve local and server evidence. Never silently overwrite a newer answer, flag, grade, submission, release, or amendment. Never clear IndexedDB or delete history to resolve a conflict.
10. Enforce one active writer per attempt/grade draft. Other tabs/devices are read-only until a deliberate, audited transfer/reconciliation.
11. Publication versions, submission generations/receipts, final grade versions, candidate releases, and amendments are immutable. Corrections create linked new versions.

## Decoupled supporting systems

12. Downloads and exports are read-only. They may write only job/artifact/audit records and must never remove, hide, disable, lock, finalize, release, archive, or otherwise alter online examination or grading state.
13. Email is secondary to the portal. Queue/send/retry/provider events may never create, reverse, or gate publication, submission, grade, or release.
14. AI is optional and untrusted. Gemini/Assistant Proctor cannot directly access service-role/database authority, bypass permission checks, publish, grade, finalize, release, amend, admit, pause, extend, reopen, or delete.
15. Every Assistant Proctor action has an ordinary UI equivalent. Closed allowlists, server-derived actor/scope, bounded schemas, current revision, and confirmation apply; model prose is never mutation evidence.
16. Keep secrets server-side and minimum scoped. Never put Gemini/service-role credentials, private source URLs, or other users' data in browser bundles, prompts, logs, fixtures, or review output.

## UX, accessibility, and privacy

17. Use plain user outcomes, one obvious primary action, accurate local/server save states, and recovery that preserves work. Do not expose internal enums, leases, RPCs, hashes, or queue mechanics in normal UI.
18. Times New Roman is mandatory for legal/examination content across Student workspace, Professor preview/grading/results, PDF, and print. Interface controls use the approved visual/typography system.
19. Preserve WCAG 2.2 AA, keyboard/screen-reader/reflow/high-contrast/touch operation. Do not disable copy, paste, context menu, or assistive editor behavior without approved necessity, lawfulness, exception, and equivalent access.
20. Monitoring and support default to metadata; do not include active answer text. Beadle, Admin, Gemini, and Assistant Proctor boundaries remain least-privileged and audited.

## Required verification

21. Test success, failure, response-loss, refresh, offline/reconnect, duplicate tab/device, authorization, shared NAT, burst load, supporting-job failure, and rollback as applicable.
22. Open real PDFs/workbooks in standard applications and use controlled real inboxes for delivery. Mocks, regex/source checks, screenshots, or visual animation alone cannot pass those gates.
23. Run uncoached human tests for the affected Professor/Student journey, at least five relevant repetitions and failure conditions. Convert every new observation into a regression.
24. Preserve unrelated Due Diligence behavior and run the defined regression suite.

## Release governance

25. Never self-certify a release. The implementer/agent may report evidence but cannot declare production readiness.
26. Require a fresh independent audit of the exact commit, assets, Worker, migrations, provider/configuration, and evidence manifest.
27. Require explicit dated owner approval before any production deployment or activation. Approval of a plan or pull request is not deployment approval.
28. Stop immediately after any failed release-blocking test, missing evidence, plan divergence, lost acknowledged work, authorization/privacy defect, corrupt/blank file, state mutation from export/email/AI, or failed rollback rehearsal. Do not deploy around the failure.
29. During an active exam window, do not run incompatible migrations, force reload/service-worker activation, clear browser storage, rotate required protocol without compatibility, or remove the last-known-good release.
30. Completion language must name what was tested and what remains unproven. Never claim a feature complete from superficial checks.
```

## Required workflow record template

Future changes should attach this completed record to the plan/issue/PR:

```markdown
Workflow / decision / diagram IDs:
User intent and actor:
Current browser/store/Worker/auth/RPC/table trace:
Target legal transition and invariant:
State read / state written:
Downstream consumers and prohibited side effects:
Idempotency / revision / concurrency:
Network, refresh, offline, cross-device behavior:
Email / download / AI isolation:
Audit and visible receipt/status:
Failure and recovery:
Migration compatibility and rollback:
Regression written first (failure proof):
Automated suites and real integration evidence:
Human test and results:
Independent reviewer:
Owner approval required / obtained:
Remaining unverified items:
```

## Proposed enforcement hooks

These are planning recommendations only:

- PR template requires workflow/decision/diagram IDs and the completed record.
- CI blocks missing human-defect regression IDs, missing state-invariant suite, or changed state paths without updated trace/evidence.
- Release manifest checks exact commit/assets/Worker/migrations/config and all acceptance IDs.
- CODEOWNERS or equivalent requires an independent reviewer for Examination Room state, auth, delivery, AI, or deployment changes.
- Production deployment remains a separate owner-approved operation after merge and independent audit.

## Adoption approval

Wally should review wording, repository scope, independent reviewer role, active-exam freeze policy, and enforcement mechanism. If approved later, install through a separate documentation-only change with no application code or deployment, then verify rule precedence. This file itself does not alter repository instructions.
