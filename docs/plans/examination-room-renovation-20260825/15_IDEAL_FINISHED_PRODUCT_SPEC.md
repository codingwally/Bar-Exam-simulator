# Ideal Finished Product Specification

## In one sentence

Examination Room is a calm, formal, dependable place where a verified Professor can prepare, run, grade, and release a real law-school examination without technical ceremony—and where every Student's work remains clear, durable, and provable.

## What a Professor experiences

You sign in and see your examinations, not a marketing page or role puzzle. Each examination tells you its real situation in ordinary language and gives you one useful next action: Continue preparation, Open monitoring, Continue grading, Review results, or View archive. You never hunt through an old email, browser history, downloaded file, secret grading URL, or redundant key to recover your work.

Creating an examination feels familiar. Start blank, upload a prepared DOCX or safe text PDF, or eventually copy a previous exam as a new draft. The system preserves your source, structures a review draft, and shows any ambiguity. Gemini can help with numbering and fields if you choose; it cannot rewrite or publish behind your back. You approve every question and see exactly what Students will see.

Rules fit in the same flow: schedule, duration, access, accommodations, allowed materials, and Student instructions. Simple authenticated access is the default; roster-controlled access is available when needed. A Beadle can help with logistics but is never required. Publish produces a permanent portal receipt and Student route immediately. Email happens afterward and may be retried without changing the exam.

During the examination you see operational facts—who is waiting, active, reconnecting, submitted, or needs attention—without seeing active answer text. You can pause/resume, extend one or many Students, transfer a duplicate session, or reopen an accidental submission through scoped, reasoned, audited controls. A timeout never tricks you into repeating a command; you see its receipt or an honest unknown state.

Submitted Students enter your grading queue even while others keep writing. The default grading page shows one Student's complete script in one continuous view, with legal content in Times New Roman, marks/comments beside each answer, and a clear total. Question-by-question mode remains available. Every change visibly moves through device save, server sync, and confirmed time. Refresh, logout, a download, or device return cannot erase server-confirmed work; a conflict shows both versions.

Finalizing a grade is not releasing it. You choose the Student(s), choose Score only, Score + feedback, or Full marked script, and preview the exact result. Release publishes an immutable version to the authenticated Student portal first. Email is a secondary notification. If a grade is wrong, an amendment preserves the original, reason, new version, Professor identity, and delivery history.

Files are useful but never dangerous. PDFs, workbooks, receipts, and offline reference packages are generated from named saved snapshots, validated, and opened in real applications before the product is declared ready. A failed file offers web view, print, regenerate, and an incident ID. Downloading cannot hide, lock, release, complete, or otherwise change online work.

Assistant Proctor sits beside the Professor workspace. It can explain, navigate, find owner-scoped records, summarize operational metadata, and prepare a safe command. It does not possess database authority. The server checks everything again; mutations require explicit confirmation; grading and release stay with the Professor. If Gemini or the assistant disappears, every ordinary control still works.

## What a Student experiences

You follow the institutional link, sign in, enter a code if it was not prefilled, confirm minimal identity details, and complete a concise readiness check. If the exam is not open, a server-timed waiting room tells you why. There is no chain of unrelated pages, Beadle messages, or secret keys.

The workspace resembles a carefully typeset exam: a light paper surface, restrained navy/gold, Times New Roman questions and answers, an accurate timer, visible save status, and accessible circular question navigation. The circles show current, answered, flagged, pending, and needs-attention states without color alone. Flag works across navigation, refresh, reconnect, and an authorized replacement device.

Every edit is preserved on the device first and synchronized to the server in order. You can keep typing through temporary disconnection and always know whether work is only on the device or confirmed by Examination Room. A second device is read-only until a deliberate transfer reconciles evidence; the system never lets two tabs silently fight over your answers.

Final review shows the actual questions and answers, flags, unanswered items, and sync status. Submission is idempotent and ends with an authoritative server receipt containing the exact time and generation. If the response is interrupted, the system finds the same receipt instead of submitting twice. Later, your authenticated portal shows the result package and any amendment, whether or not email arrives.

## What Due Diligence operates

Wally verifies Professors and institutions, provisions a sandbox, confirms the supported class/date, records exact release versions, and applies a real readiness gate. During the first launch, Wally monitors service health and job/receipt metadata, not class answer content. Support can stop new entry, diagnose queues, retry independent jobs, and roll back compatible releases without destroying active attempts.

The launch promise is 200 simultaneous Students and 100 questions after the complete evidence program passes. 500 Students and 200 questions are stress targets until proven. Production changes freeze around live exams. Every high-impact action is versioned, authorized, idempotent, auditable, and recoverable.

## Visual character

- Paper/alabaster background, white reading surfaces, quiet borders.
- Navy for authority and primary actions; gold only for restrained emphasis; semantic success/warning/danger states use text and icon as well as color.
- Cinzel for limited brand, Playfair Display for major headings, Inter for interface/control copy, IBM Plex Mono for receipts/codes/timestamps, Times New Roman for all legal/exam content in Student, preview, grading, result, PDF, and print contexts.
- One page title, one primary action, progressive disclosure, no wall of role cards or internal enums.
- WCAG 2.2 AA, keyboard/screen-reader operation, 200% zoom/reflow, high contrast, touch targets, and ordinary accessible editor behavior.

## System guarantees

1. Acknowledged answers, flags, grading drafts, submissions, results, and amendments are never silently lost or overwritten.
2. Local pending work is preserved and disclosed until synchronized or deliberately resolved.
3. Publications, submissions, receipts, final grades, releases, and amendments are immutable versions.
4. Email, file, and AI jobs are separate and cannot drive domain state.
5. Portal state and server receipts—not spinners, emails, downloads, or model prose—are authoritative.
6. Active attempts survive a bad frontend/Worker release through pinned/compatible clients and preserved IndexedDB/DB evidence.
7. Ownership is strict; Beadle/Admin/Assistant Proctor cannot become invisible co-Professors.
8. Monitoring avoids active answer text, and Gemini sees only approved minimum data.

## Honest limitations

The first release does not provide consumer pricing changes, payments/SIS integration, scanned-PDF OCR, offline grade-file re-import, fully autonomous grading, or continuous camera/microphone recording. It does not promise guaranteed email delivery or market the 500/200 stress envelope. Browser focus events are operational signals, not proof of cheating.

## What “finished” means

Finished does not mean the screens look like the walkthrough or the unit tests pass. It means uncoached Professors and Students complete every critical journey repeatedly, real DOCX/PDF imports and PDF/Excel files work, controlled inbox failures recover, shared-NAT and burst loads pass, accessibility/security/privacy gates pass, rollback preserves active attempts, all human defects have regressions, an independent audit verifies the evidence, and Wally records GO for the exact versions and supported envelope.

Until that evidence exists, the product remains **NO-GO** regardless of implementation progress.
