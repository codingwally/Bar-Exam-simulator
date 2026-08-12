# Examination Room class results and offline grading

## Outcome

The owning Professor can review the complete class result, select one or more submitted students, and download a styled `.xlsx` workbook that opens in Excel and imports into Google Sheets. The workbook is available while grades are still in progress so the Professor can grade or verify offline. The secure Examination Room remains the authoritative place to save and release official grades.

## Professor authority and data boundary

- Only the authenticated owner in `exam_room_exams.owner_professor_id` can request a class dashboard or workbook.
- The Worker supplies the verified user ID; the browser cannot nominate another Professor.
- Direct `PUBLIC`, `anon`, and `authenticated` table access is revoked. The three new RPCs execute only through the service role.
- Only terminal `submitted`, `auto_submitted`, or `sealed` attempts with an immutable submission snapshot are eligible.
- Active drafts and autosaved answer journals are never included.
- A selected export includes only the selected attempts and their matching roster identities.
- Every request and completed workbook is audited by exam, Professor, scope, selection count, size, and SHA-256 digest. Workbook contents are not stored in the audit table.
- An idempotent retry reuses the original audited generation timestamp, producing the same workbook bytes and digest instead of conflicting after a lost response.

## Workbook sheets

1. **Summary** — selected submission count, finalized count, average, attendance, late/no-show counts, strongest and lowest-performing questions, and offline-grading guidance.
2. **Class Results** — student name, email, student number, candidate number, timing, overall score, percentage, per-question scores, maxima, and Professor comments.
3. **Offline Grading** — one row per selected student/question with the exact Professor question, submitted answer, current grade state, current comment, and gold cells for offline score/comment entry.
4. **Question Analytics** — response counts, finalized-grade counts, average, maximum, percentage, high, and low by question.
5. **Attendance & Timing** — selected student identity, start/deadline/submission times, and late-entry/submission status.

All sheets use the existing Due Diligence judicial navy, gold, alabaster, and slate system, with wrapped legal text, frozen headers, filters, bounded widths, and formula-injection neutralization. Questions longer than Excel's single-cell text limit are preserved across clearly labelled Part 1 / Part 2 continuation cells.

## Send and download behavior

- **Download selected workbook** has no release, email, grading, or sealing side effect.
- If any selected grade is incomplete, the file is an `offline-grading` workbook and missing scores stay blank.
- **Send grades + download all** is class-wide and remains disabled until every submitted answer has a final Professor grade.
- Sending uses the existing transactional release function, queues one recipient-scoped result email per graded student, seals the examination, then prepares the final class workbook.
- The Professor release email is no longer a count-only receipt. The trusted Worker enriches that queued owner email with the owner-scoped results dashboard, renders all student totals and per-question scores, and attaches the same Excel/Google Sheets-compatible class workbook when it remains within the transactional provider size limit. The secure dashboard remains the fallback for an unusually large attachment.
- The grading workspace includes a class queue so a Professor can see completion and current totals for the whole submitted class and jump directly to any student while retaining Save and Next for sequential work.
- Student emails include only that recipient's candidate number, overall score, per-question scores, and Professor comments. Other students' identity or answers are never included.
- After either download or send, the modal closes and the Professor results dashboard opens without a polling or rendering loop.

## Dashboard analytics

The Professor dashboard shows expected/submitted/finalized/absent/late counts, participation, class average and median, grading completion, strongest and lowest-performing items, per-question response/finalization/performance rows, and student result status.

## Deferred by design

- Editing the downloaded workbook does not upload or overwrite official grades.
- Direct Google Drive creation is not required; `.xlsx` is the portable Google Sheets-compatible format.
- No grading rubric, Gemini prompt, question content, timer, payment, or entitlement behavior changes in this feature.
