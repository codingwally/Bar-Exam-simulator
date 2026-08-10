# Examination Room professional classroom flow — 2026-08-10

## Approved beta journey

1. Admin creates one Professor room key for one Examination Room.
2. Professor redeems the room key, creates the exam, checks every question, and publishes.
3. Publication shows the one-time Beadle key and the separate Professor grading key.
4. Beadle redeems the Beadle key, uploads and validates the class list, then creates the separate student exam code.
5. Student signs in, matches the saved class list, enters the student exam code, completes the preflight, answers, reviews, and submits.
6. Professor monitors and grades submissions, then either sends all final results to the class or downloads one candidate PDF in one of three exact formats.

Student sign-in is mandatory. The Beadle key, student exam code, and Professor grading key are separate and cannot be used in place of one another.

## Visual evidence

- `01-live-role-entry-profile-gate.png` — reported live entry state.
- `02-reported-publish-stuck.png` — reported Professor publish state.
- `03-role-entry.png` — revised four-role entry and six-stage classroom overview.
- `04-professor-published-beadle-key.png` — successful publication and one-time Professor-to-Beadle handoff.
- `05-beadle-student-code.png` — saved class list and Beadle-created student code.
- `06-student-signed-in-preflight.png` — signed-in, list-bound Student preflight.
- `07-professor-results-overview.png` — deliberate class release and private candidate download separation.
- `08-professor-pdf-options.png` — exact private PDF choices.
- `09-publish-before-after.png` — reported and revised Professor publish states reviewed side by side.

The preview uses synthetic data and is visual evidence only. Runtime, database authorization, migration, Worker, and artifact tests are recorded separately; this document makes no accessibility-conformance claim.
