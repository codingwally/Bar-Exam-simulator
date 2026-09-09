# Public publication requirements — 10 September 2026

The owner explicitly requested publication while coding continues, then corrected the access scope to public, paying and non-paying users. These direct instructions supersede the prior admin-only preview interpretation. Existing sign-in and event-specific private permissions remain in force. No new spending or real mail is authorized by this change.

| ID | Direct requirement | Implementation / test | Current evidence |
| --- | --- | --- | --- |
| OWNER-05 | Publish public access for paid and unpaid members; separate button beside Study Room | `assets/debate-entry.js`, `worker/debate-integration.mjs`, `scripts/test-debate-entry.mjs`, dedicated public release workflow | Source adjacency and actual integration under inert transport tested; live deployed proof pending |
| OWNER-06 | Professional public copy without development jargon | `assets/debate-room.js`, `debate-room/index.html`, copy checks in `scripts/test-debate-entry.mjs` | Practice debate, pairings, downloads and readable status text; browser review pending |
| OWNER-07 | One desktop window without page scrolling; apply supplied PowerPoint | `C:/Users/wally/Downloads/DEBATE ROOM.pptx`, extracted three-slide source reviewed | Pending after urgent publication; current layout does not meet this requirement |
| OWNER-08 | Audit and debug the whole website after Debate publication, preserving design and functions | Later full-site route/action/evidence audit | Not started; publication takes priority |

## Release facts

Production database project is `hbllomlijfznnuudpdvr`. Both reviewed migrations were applied once through the migration connector. Stored hashes match the source; the existing Study catalog and audit fingerprints are unchanged. The complete rollback-only transaction passed all 64 assertions after adapting the existing catalog migration version and the LF-only production admin function fingerprint; the complete admin function definitions match staging after line-ending normalization. Independent readback found the test event absent. Six real permission-denial probes passed. The private evidence/export bucket is configured with the existing 10 MB limit and PDF/JPEG/PNG/CSV types; Storage API upload/download is a separate pending check.

The dedicated workflow deploys the application Worker, its public API alias, then Pages. It preserves the captured existing production configuration and requires the exact staged revision and completed source checks. The public flag is enabled for all signed-in members. Provider media, automatic sweeping and mail remain disabled while actual allowance, full-duration rehearsal and delivery checks remain unresolved. No complete-product or full-acceptance claim follows merely from publishing the entry.

## Remaining checks

No successful full-duration hosted rehearsal exists. The prior hosted journey stopped at file upload; its records were independently cleaned. Real camera/audio/screen share, provider capacity, physical browser/device behavior, actual mail, the supplied presentation layout and whole-site audit remain open. Each must receive actual evidence before it is marked complete.
