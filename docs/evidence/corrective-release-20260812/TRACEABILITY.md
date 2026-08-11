# Corrective release traceability

Date: 2026-08-12 (Asia/Manila)

## Untouched production baseline

- Repository: `codingwally/Bar-Exam-simulator`
- Production branch: `main`
- Production commit at release start: `4313e8a9107716ba6b8a6d5e9d7fe0fa18dcf619`
- GitHub Pages run: `31524527763`
- Production Worker deployment version: `bf49e2bd-db8b-4cd2-a5d7-565926101e18`
- Production Supabase project: `hbllomlijfznnuudpdvr`
- Rollback tag: `rollback/pre-homepage-subject-exam-corrective-20260812`

## Isolated implementation

- Branch: `agent/homepage-subject-exam-corrective-20260812`
- Worktree: `Bar-Exam-simulator-corrective-20260812`
- Baseline screenshot: `01-production-before-1440x900.png`

## Delta classification

| Stream | Baseline finding | Corrective scope |
| --- | --- | --- |
| Public homepage | Retired hero and animated rails place the four preparation choices below the first desktop viewport. | Remove the retired hero, summary, rails, counters, and motion code. Move the existing four chambers directly below the public header as image-led cards. |
| Subject Matter | Flat course list, exposed bank totals, universal ALAC presentation, and incomplete catalog-state persistence. | Add Year → Term → Subject disclosure hierarchy, accessible mobile chooser, search, state persistence, inventory-response sanitization, and question-type-aware guidance. |
| Examination Room | Classroom simplification is already live and verified; answer writes are locally durable after input and on attention changes, but no independent 30-second safety flush is present. | Add only a 30-second safety flush while an editable attempt is active. Preserve all classroom, grading, timing, email, and authorization behavior. |

## Production data baseline (read-only)

- Subjects: 8
- Subject Matter placements: 1,890
- Examination questions: 1,742
- Exam Room exams: 8
- Exam Room roster rows: 13
- Exam Room attempts: 6
- Exam Room submissions: 6
- Exam Room email jobs: 0
- Exam Room grades: 0

No production mutation was made while recording this baseline.

## Staging verification

- Staging Worker: `duediligence-examinations-staging`
- Verified Worker version: `4a12c483-8415-4239-bd93-2cf6abcc5d16`
- Full Worker suite: 371 tests passed, 0 failed.
- Local repository regression suite: 61 scripts passed, 0 failed; the four credentialed staging harnesses were run separately or superseded by the full acceptance cycle.
- Human-only synthetic API cycle: passed.
- AI-inclusive synthetic API cycle `msp5a67r-cfa9d5f2`: passed for strict human, self-paced AI, curated Bar Feels human, private-upload human, and strict server-expiration paths.
- Synthetic API fixtures: removed by the acceptance harness in its mandatory `finally` cleanup.
- Synthetic browser user: deleted through the staging Auth admin API; the issued staging session was revoked.
- In-app browser homepage check: exact first heading and four-card taxonomy rendered; retired hero absent; no horizontal overflow; expected cache-busted assets loaded; no relevant console, runtime, or network errors.
- In-app browser modal check at 340 x 838: the top-right close control and Back action were both reachable and each independently closed the sign-in dialog without leaving body scroll locked.
- Final 320 x 568 header geometry: brand right edge 161 px, utility group left edge 169 px, 8 px separation, and no horizontal document overflow.
- Authenticated UI browser coverage remains constrained by the staging build's production Google-only PKCE redirect. Authenticated staging workflows were exercised through isolated synthetic API users instead; no production identity was used.

## Examiner resilience delta

Gemini still performs scoring, rationale, issue/error identification, improvements, and source reporting under the unchanged 0-5 rubric and score caps. When both permitted Gemini attempts return incomplete coaching sections, the Worker now derives only the four ALAC model-answer sections from the already-approved stored suggested answer. This prevents a provider-format failure from discarding an otherwise valid assessment without changing question content, legal substance, scoring weights, prompts, or the rubric.

The first PR benchmark run exposed a provider-wording variant for a legally insufficient, bad-intent-only impossible-crime answer. The existing materially-wrong-rule ceiling now recognizes that semantically equivalent finding (`extremely broad` / `based liability solely on bad intent`) and deterministically limits it to 1.5. The frozen benchmark input, model prompt, 0-5 scale, rubric weights, and question content remain unchanged.
