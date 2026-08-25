# Subject Matter and outbound-email proof — 2026-08-17

## Status

This record covers the published production release. Local tests, protected
staging database verification, production migrations, and both deployment
workflows are complete. The exact publication evidence is recorded below.

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

## Email proof: what the published change actually does

Practice Exam email is removed at the call sites and hard-disabled at the shared
transport boundary. This is stronger than relying on a configuration pause: a
Practice Exam cannot call Resend even if every email mode and provider credential
is deliberately present.

| Control | Verified behavior |
| --- | --- |
| General default | Missing, blank, invalid, or `suppressed` `OUTBOUND_EMAIL_MODE` fails closed to suppression |
| Practice Exam transport | Practice flows have no automated email caller |
| Subject Matter and Bar Feels release | Both tracks record the in-app release and make zero provider calls |
| Human Examiner handoff | Creates an expiring secure link for manual copying; no invitation email is sent |
| Production | General outbound mode is suppressed |
| Staging | General outbound mode is suppressed |
| Marketing preference collection | Product-update checkboxes, reads, and writes are removed; the legacy RPC is a no-op and historical rows remain dormant audit records |
| Web3Forms notifications | Covered by the same global pause |
| Partnership confirmation | Truthfully says the inquiry was saved for founder review; it does not claim that an email was sent |

### Provider-traffic assertions

- Subject Matter completion with all modes enabled: **0 Resend calls**.
- Bar Feels completion with all modes enabled: **0 Resend calls**.
- Human Examiner assignment with all modes enabled: **0 Resend calls**, with a
  manual `assignmentUrl` returned.
- Generic Practice Exam transport: always `suppressed`.

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

## Production publication evidence

| Evidence | Verified value |
| --- | --- |
| Production commit | `e1928235292e4b7704912436b92112f428caa076` |
| Worker workflow | Run `32033258390`, job `95397834075`, **success** |
| Worker version | `e0a885e5-7323-478d-a2da-7a78bb43d2c5` |
| Pages workflow | Run `32033494107`, job `95398561692`, **success** |
| Production Skip/Flag migration | `20260817123037` |
| Production retired-marketing migration | `20260817123050` |

The production marketing compatibility RPC is `SECURITY INVOKER`, remains
callable only as intended for signed-in legacy clients, and contains no insert
or update. A transactional production call left the existing row set unchanged
and was rolled back. The Worker release contains both
`worker/outbound-email-policy.mjs` and the permanent Practice Exam transport
deny. The Pages release contains `assets/due-diligence-controls.css` and the
manual Human Examiner handoff interface.

No Practice Exam email was sent in production as a release test. That is
intentional: the required published behavior is **zero provider traffic** from
Subject Matter, Bar Feels/model release, and Human Examiner assignment, even
under hostile enabled configuration. The earlier Gmail self-send proves only
the connected Gmail account; it is not presented as application-delivery proof.

The staging database gate remains part of the evidence: Skip/Flag passed
**27/27** and retired consent passed **6/6**. These tests ran in transactions and
ended with `ROLLBACK`, so their synthetic rows were not retained.

The cloud browser did not share the owner's signed-in Due Diligence session.
Live public loading, the Subject Matter sign-in boundary, cache-busted asset
URLs, and exact live/local asset hashes were verified. Authenticated production
Subject Matter screenshots are therefore not claimed in this record.
