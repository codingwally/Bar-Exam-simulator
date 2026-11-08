# Practice platform rebuild review

> Historical rebuild snapshot. The initial hosting/provider statements below
> describe that setup stage. Google authorization and automatic hosted
> Sheet/HTML-email delivery were subsequently verified on 25 October 2026 PHT;
> see [HTML-EMAIL-REVIEW.md](HTML-EMAIL-REVIEW.md) for the dated activation evidence.

The owner superseded the first pilot UI on 2026-10-24. The current implementation provides a Due Diligence examination workspace based on Examplify's structure and a professor workflow of document upload, question review, unique link, and collected responses. This report supersedes the presentation claims in the initial release review.

## Five review passes

| Pass | Scope | Evidence and current result |
| --- | --- | --- |
| 1 | Data, authorization and preservation | Independent backend review and real SQLite regressions cover immutable published questions, unique opaque exam URLs, bounded server-created browser cookies, scoped recovery, idempotent creation/saving/submission, final answer snapshots and private source text. Final deterministic suite: 164 of 164 passed. |
| 2 | Failure and recovery | Draft-store regressions cover browser storage failures, continuous saves, offline restoration, editor ownership and deadline authority. A real browser reload restored the two full synthetic answers, first-question flag and original deadline. Clean multi-engine execution is pending below. |
| 3 | Desktop design and professor usability | Actual Word/PDF reads, corrected private module routing, upload/review/create-link views and the complete student workspace were visually inspected. Technical details are inside support disclosures. [Design verification](design-qa.md) records source/implementation comparison and corrected findings. |
| 4 | Narrow devices and accessibility | Fresh shell v7 captured at 390 × 844 and 320 × 740. Document scroll widths exactly matched viewport widths. Timer, answer area and navigation remained visible. Phone Instructions drawer and post-submit heading focus were exercised. Six-width automated checks and browser engines are pending below. Physical devices have not been rehearsed. |
| 5 | End-to-end collection and external copies | A real browser uploaded DOCX, created a 30-minute two-question practice, admitted Demo Student — Simulation, saved both full answers, reloaded and submitted. The professor saw both complete finalized answers. The private local backup packet exactly records receipt `22b0ca7f-1c9b-4637-ae85-1ef5e7f7bac5`, 2 of 2 answers, and checksum `49d78dd1657732e50c57553f8552bc8d1989b7436776887e4f36fb590364338a`. A private native Google Sheet was created in the owner's account with one clearly named student tab. Native connector readback and exported rendering confirmed both exact full questions/answers and receipt. Actual Gmail send and subsequent full-body readback confirmed both exact answers and receipt, with INBOX and SENT labels. |

## Rehearsal provenance

All records described here are synthetic. The development server binds only to loopback and injects a synthetic administrator. Its in-memory SQLite and local snapshot files are test fixtures, not the hosted service. The selected free practice deployment uses isolated Cloudflare D1 with durable independently retried Google and owner-email jobs. It creates no R2 subscription. Adding a private R2 binding is optional for practice; scheduled official admission remains disabled without it. A temporary development URL must not be distributed to real students.

The final source packet for the browser simulation is `.wrangler/simulation-packet.json`. Student and professor captures are committed under `review-evidence/rebuild/`. The packet, generated document readers, local credentials, provider configuration and large generated browser artifacts remain outside source control.

## Current checks

- Pinned DOCX/PDF browser reader build: passed.
- Runtime production dependencies: zero known vulnerabilities in the recorded `npm audit --omit=dev` result.
- Existing runtime isolation guard: passed, including Simulator boundaries.
- Browser student/professor console error and warning capture: empty during the demonstrated flow.
- Deterministic tests: 164 of 164 passed. The 100-disconnected-student cron regression finishes ten attempts per tick and stays below 35 SQL queries per invocation, leaving headroom within the Free D1 query budget. Delivery work progresses two jobs per tick. This is a bounded correctness rehearsal, not a hosted capacity benchmark.
- Free Worker deployment dry run: passed with D1 and static assets, without R2.
- Native Google Sheet and actual owner email: completed and verified through the connected Google account. Hosted unattended provider credentials remain separate.
- Clean multi-engine CI: pending at this report revision.

## Hosting and delivery setup

The Cloudflare setup prompt was fetched and its applicable commands executed: Cloudflare skills installed and the management MCP server registered. The owner completed the browser consent, but Codex CLI 0.145.0 rejected the callback for a missing required issuer. This is a connection failure, not proof of a usable management session. No validation was disabled to conceal it.

A user-approved 90-day credential was created with isolated Workers/D1/Access permissions and saved privately, with a separate encrypted GitHub deployment secret. The real Zero Trust activation screen still required billing details and charge consent, so activation was not completed. The no-card deployment now supports built-in professor sign-in instead: a random 256-bit passphrase, D1-backed one-hour opaque sessions, host-only Secure/HttpOnly/Strict cookies, logout revocation, secret rotation, exact-origin writes, bounded failed-attempt counters and private asset gates. An independent review found no blocking bypass; fourteen real-SQL authentication tests passed. Actual browser checks confirmed wrong-key rejection, successful private-desk access and sign-out. The complete deterministic suite at this revision passed 190 tests.

The isolated free D1 database was created and verified. R2 and Zero Trust subscriptions are excluded. No public Worker deployment is claimed at this report revision.

The owner explicitly requires the Google Sheet to be accessible only by them. Live Drive permission readback confirmed `shared:false` and exactly one permission: owner `wallyesteban1993@gmail.com`; no service account, group, domain or public permission exists. Sending the first rehearsal through connected Gmail/Drive proves those particular copies. A separate owner-run Google Apps Script relay is being prepared for unattended copies without sharing the Sheet or using a paid email provider. Its Google authorization and real hosted delivery must be verified before automatic delivery is claimed. Connected chat tools do not supply portable server credentials.

## Material limits

DOCX and text-based PDF extraction are implemented and reviewed, with editable question boundaries and complete retained source text. Scanned/image-only PDFs and old `.doc` files require readable text or DOCX export/manual paste. OCR is not claimed. The browser cannot reproduce Examplify's operating-system lockdown. Hosted load, actual private access, provider delivery/retry and real iOS/Android devices remain live-release checks. None of the synthetic tests certifies an official examination.

Baseline: `a375f3eb2d8d914948a38e1ba195098849aed10d`. Rebuild checkpoint: `checkpoint/exam-pilot-before-examplify-20261024` at `9ff5834aeb6d71a1f9ade1ea432777252a6fd543`. Changes remain isolated to this new service and its verification workflow.
