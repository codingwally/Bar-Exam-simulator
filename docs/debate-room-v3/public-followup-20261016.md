# Public room and navigation follow-up

This reconciles the still-unpublished PR376 changes onto the current main branch after PR411. It preserves command recovery, the current Study Room implementation, newer Examination Room work and existing entitlements. It adds no production deployment or database migration.

| Requirement | Verification | Evidence boundary |
| --- | --- | --- |
| Desktop lobby fits one window, including its Retry action | Actual browser geometry at 1100x720, 1280x720, 1365x768 and 1920x855; empty and populated catalogs | Isolated browser execution and screenshot review required |
| Growing event lists remain accessible | Named focusable regions, actual End-key scrolling and last-action reachability | Inert catalog responses use the actual client renderer; no saved events are fabricated |
| Unresolved creation keeps visible recovery and readable guidance | Real local service commits creation, browser loses its response, checks pending-error geometry and retries the same action | Accelerated local browser, not hosted endurance |
| Mobile keeps readable order and reachable controls | 320px empty/populated/retry observations | Browser execution required; desktop fit is not imposed on mobile |
| Invalid upload acknowledgements cannot lose the selected file or silently share only a link | Actual client with empty, truncated, null, false, array, missing attachment and missing upload ID responses | No automatic upload or attachment retry; same-context draft preserved |
| Closing an owned dialog cannot expose the background before Back settles | Delayed-history tests of actual navigation/focus functions, repeated Close/Back/Escape, paid-access dismissal and return navigation | Inert browser objects; shared browser verification remains separate |
| Public assessment and document copy describes the observed state accurately | Assessment error no longer asserts data was unsaved; singular vote/win/match document checks | No new grading or result arithmetic |
| Hosted rehearsal never sends an advertising request | Exact script request is intentionally blocked and separately correlated; unknown destinations/errors still fail | Credential-free Linux Chrome probe required; public HTML and build bytes remain unchanged |
| Returning browsers load all changed assets | Matching new client/CSS/navigation URLs and service-worker cache version | Actual deployed readback still required |

The existing mobile contract's obsolete professor stylesheet expectation was updated to the exact URL already present on main. The professor implementation was not changed.

[PR411's independent receipt](evidence/command-recovery-ci-38681816514.json) covers its earlier candidate, not this follow-up. [Read-only staging capture38866697278](evidence/staging-capture-38866697278.json) confirms the previous configuration remains unchanged. Newer shared Worker/database compatibility must be resolved before a hosted deployment; unchanged Debate migration hashes alone do not establish compatibility for the other current features.

All original 315 acceptance states remain unchanged. Full hosted endurance, physical media/capacity, real inbox delivery, production role journeys, live deployment readback and the overall website audit remain open.
