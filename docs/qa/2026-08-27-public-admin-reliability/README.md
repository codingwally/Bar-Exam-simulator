# DueDiligence.ph Release 1 QA record

Date: 2026-08-27 (Asia/Manila)

## Scope

- Public navigation, buttons, modal close/back behavior, Syllabus recovery, Study Circles, Quick Drill, Doctrine Review, feedback states, typography, and menu presentation.
- Admin navigation, request races, truthful loading/empty/error states, date range, Refresh, Export, visible data/actions, responsive presentation, and retry behavior.
- The Examination Room, Professor/Student flows, related admin exam work, legal content, profile photo, and Pedro were not audited or changed in this release.

## Live reference capture

The signed-in production reference was captured before implementation at desktop and phone widths for Home, Home menu, Quick Drills, and Doctrine Review. These captures are `01` through `07` in this directory.

## Local visual audit

The sanitized Pages artifact was reviewed at 1440, 1024, 768, 390, 375, and 320 CSS pixels, plus a 720-pixel reflow proxy for 200% browser zoom on a 1440-pixel display.

- No horizontal document overflow at the tested widths.
- Public sign-in CTA is 48px high; legal links are 28px high with 13px text.
- Admin non-exam navigation controls are 44px high on phone layouts.
- Date range, Refresh, Export, freshness, page error, and Retry remain visible on phone layouts.
- Desktop admin retains the complete sidebar, expanded Additional Tools, page title, date range, Refresh, Export, and page status.
- Admin failure states show no substituted zero cards or earlier page values.

Two defects were found during the visual preflight and corrected before approval:

1. At 320-390px, the Lady Justice artwork overlapped the landing eyebrow/headline. The phone visual now uses a taller panel and separates the artwork from the copy. See `24-public-phone-before-after.png`.
2. At 320-390px, the admin Date Range, Refresh, and Export controls inherited conflicting grid rows and collided. Their mobile grid rows are now explicit and non-overlapping. See `25-admin-phone-before-after.png`.

## Local functional audit

- Terms of Use and Privacy Policy links each opened the correct modal and both Close and Back returned to `/`.
- Continue with Google initiated the configured authentication redirect.
- All 23 non-exam admin navigation buttons were exercised again against the final rebuilt artifact. Every button produced its own unique hash, title, page-specific failure/Retry message, and disabled Export state when the local artifact could not load authenticated data.
- Admin date range changed from 30 to 7 days and retained the selected range after a failed refresh.
- Admin Refresh retried the current page.
- Export remained visibly disabled when the current page had not loaded successfully, preventing an empty or stale download.
- The local admin error state explicitly said that no earlier values were shown and exposed a page-specific Retry button.
- The final rebuilt public and admin previews logged no new browser errors; all eight public subject controls rendered at startup.

## Automated regression

- Changed JavaScript syntax: 35/35 passed.
- Pages deployment pre-build commands: 48/48 passed.
- Worker tests: 421/421 passed; remaining Worker syntax/contracts: 13/13 passed.
- Direct race simulations passed for public navigation, Quick Drill, Doctrine Review, Syllabus performance, subject selection, Community feeds, and Study Circles.
- Admin truthful-state, cache/commit, chart, export, responsive, and action contracts passed.
- Sanitized Pages artifact: 99 files; artifact contract passed after the final blocker fixes.
- Staging historical-access pgTAP: 11/11 behavioral cases passed.
- `git diff --check`: passed.
- Independent release-blocker re-review found no remaining P1 or P2 issue and recommended release.

## 1,000-user static load regression

Target: local sanitized artifact only. Production is rejected by the harness.

- 1,000 complete simulated user journeys
- Up to 50 journeys active concurrently
- 6 unauthenticated static GET requests per user
- 6,000 total requests in 7.511 seconds
- 798.83 requests/second
- 0 request failures
- 0 MIME/content-marker mismatches
- `/` p95 165ms, p99 305ms
- `/admin/` p95 123ms, p99 192ms
- All other tested static assets stayed at or below 120ms p95 and 135ms p99

This is a static-delivery regression, not a claim that 1,000 authenticated users concurrently completed database, Gemini, or mutation journeys.

## Production gate

Production deployment and post-deployment authenticated smoke tests remain pending owner approval of the local preview. Release order is Worker, reviewed database migrations with verification, then Pages.
