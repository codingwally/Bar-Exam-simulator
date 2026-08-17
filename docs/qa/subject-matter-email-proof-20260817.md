# Subject Matter and outbound-email proof — 2026-08-17

## Status

This record covers the pending release. Local tests and protected staging
database verification are complete. Production publication is not claimed until
the final addendum records the merged commit and successful deployment runs.

## Subject Matter UI proof

The production renderer was inspected in the cloud browser at desktop and 390px mobile widths.

| Check | Observed result |
| --- | --- |
| Desktop pane order | Question, Writing Approach, answer editor, and actions on the left; protected review on the right |
| Result pane order | Submitted question, answer, and assessment on the left; review on the right |
| Mobile order | Writing pane stacks before review pane |
| Review controls | Three native disclosures, all initially closed |
| Retired wording | No “one focused question” or “One-question review session” |
| Redundant explanations | Duplicate autosave, placeholder reveal text, assurance text, and selected-course tagline removed |
| Required warning | Assisted / Open-book consequence, unchanged score, and exclusion from unassisted mastery metrics remain visible before reveal |
| Mobile overflow | None at the verified 390px frame |
| Minimum action target | No visible Subject Matter action under 44px in the verified mobile state |

The same browser observations and exact geometry are recorded in `design-qa.md`. The browser displayed the current desktop and mobile screenshots inline during review, but its shared screenshot directory was read-only, so no downloadable screenshot file is claimed here.

### Inline browser-capture fingerprints

The final inline captures shown to the owner were hashed from the exact JPEG bytes displayed by the browser:

- Desktop, Suggested Answer open and standardized actions visible: `101,214` bytes; SHA-256 `3ffe7dcb1eb54a0962a2d097a5f7a7dee9bff606e08c1bec03e0aac78aee24fa`.
- Mobile, 390px responsive frame: `62,266` bytes; SHA-256 `9969b6a311e4d6b762d4d63ac7e559b2c2a9689a3a27244dde6d8938e71948dd`.

## Email proof: what the pending change actually does

Practice Exam email is removed at the call sites and hard-disabled at the shared
transport boundary. This is stronger than relying on a configuration pause: a
Practice Exam cannot call Resend even if every email mode and provider credential
is deliberately present. Examination Room delivery remains a separate,
explicitly controlled transactional system.

| Control | Verified behavior |
| --- | --- |
| General non-Room default | Missing, blank, invalid, or `suppressed` `OUTBOUND_EMAIL_MODE` fails closed to suppression |
| Practice Exam transport | Every non-Examination-Room call to `sendExaminationEmail` returns `suppressed`; no practice caller remains |
| Subject Matter and Bar Feels release | Both tracks record the in-app release and make zero provider calls |
| Human Examiner handoff | Creates an expiring secure link for manual copying; no invitation email is sent |
| Production | General outbound mode is suppressed; `EXAMINATION_ROOM_EMAIL_MODE = "enabled"` remains independent |
| Staging | General outbound mode and Examination Room mode are suppressed |
| Examination Room | Its explicit mode alone controls direct and queued delivery; the general non-Room pause cannot override it |
| Marketing preference collection | Product-update checkboxes, reads, and writes are removed; the legacy RPC is a no-op and historical rows remain dormant audit records |
| Web3Forms notifications | Covered by the same global pause |
| Partnership confirmation | Truthfully says the inquiry was saved for founder review; it does not claim that an email was sent |

### Provider-traffic assertions

- Subject Matter completion with all modes enabled: **0 Resend calls**.
- Bar Feels completion with all modes enabled: **0 Resend calls**.
- Human Examiner assignment with all modes enabled: **0 Resend calls**, with a
  manual `assignmentUrl` returned.
- Generic Practice Exam transport: always `suppressed`.
- With general non-Room mode suppressed and Examination Room explicitly enabled,
  direct Room delivery still reaches the provider exactly once.
- Under the same separation, the Room queue still claims and completes its job.
- All eleven supported Examination Room message types still render and deliver
  under the explicit Room-enabled test configuration.

## Verification results

- Focused practice/Room email boundary suite: **91 passed, 0 failed**.
- Full Worker suite: **447 passed, 0 failed**.
- GitHub Pages frontend/content verification block: **31/31 passed**.
- Production Pages frontend contract sequence: **all passed**.
- Sanitized Pages artifact: **89 files, passed**.
- Subject Matter canonical review audit: **1,490 records; 0 exact and 0 near Suggested Answer / Controlling Law duplicates**.
- `git diff --check`: **passed**.
- Protected staging Skip/Flag migration `20260817121616`: behavioral pgTAP
  **27/27 passed**.
- Protected staging marketing-retirement migration `20260817121625`: no-write
  compatibility pgTAP **6/6 passed**.

## Approval boundary

This evidence establishes the local code path, hostile-configuration provider
assertions, and protected staging database behavior. It is not production proof
until the merged build is deployed. The remaining publication evidence is:

1. the authenticated staging Subject Matter browser journey;
2. a zero-provider-traffic check for all Practice Exam routes even under hostile enabled configuration;
3. a controlled Examination Room delivery check, if Room delivery is part of the release verification;
4. production application and structural/no-write verification of both reviewed
   migrations; and
5. confirmation in the merged tree that the two new production-critical files are included:
   `assets/due-diligence-controls.css` and `worker/outbound-email-policy.mjs`.

The staging database gate is complete: the Skip/Flag suite passed **27/27** and
the retired-consent suite passed **6/6**. These tests run in transactions and end
with `ROLLBACK`, so their synthetic rows were not retained.
