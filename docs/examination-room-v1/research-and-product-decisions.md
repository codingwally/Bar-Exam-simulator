# Examination Room v1 — Research and Product Decisions

## Product position

The professor experience deliberately starts from the interaction model professors already know from Google Forms: add or import questions, assign points, preview, publish, review one student at a time, leave feedback, and release selected results. The student experience deliberately borrows the calmer exam-taking concepts documented for Examplify: a persistent timer, numbered question navigation, flags, previous/next controls, a final submission confirmation, and a receipt.

Official references:

- [Google Forms: create and grade quizzes](https://support.google.com/docs/answer/7032287?hl=en)
- [Examplify: exam-taking features and options](https://support.examsoft.com/hc/en-us/articles/11167472754445-Examplify-Exam-Taking-Features-and-Options-Windows-Mac-iPad)

## Comparison

| Capability | Google Forms baseline | Examplify baseline | Examination Room v1 decision |
|---|---|---|---|
| Professor creation | Familiar question editor, points, answer keys, feedback | Exam-maker tooling is separate from the student client | One long, forgiving creator page with upload/import, automatic numbering, review items, preview, autosave, and side-by-side AI help |
| Identity | Email collection can be enabled | Institution-managed exam taker identity | Real name and student number are the default professor view; anonymous grading is optional and professor-controlled |
| Grade and release | Individual grading, feedback, immediate or later release | Submission upload is confirmed | Per-question durable grade revisions, incomplete-release blocking, selected release, and a student result page |
| Student navigation | Form pages and validation | Question list, previous/next, flagging, timer, submit confirmation | Examplify-style numbered rail, flags, timer, review summary, signed receipt, and released feedback |
| Connection loss | Browser form behavior varies | Installed application supports controlled exam operation | Service-worker-cached exam shell, local-first revisions, disconnected-refresh restoration, reconnect sync, idempotent submission, and professor/admin recovery snapshots |
| Integrity controls | Not a core quiz feature | Depends on institution configuration and installed client | Professor-selectable standard or focus-monitoring modes; every browser signal requires human review |

## Browser security boundary

A website can request fullscreen only from a user gesture, and the user/browser can exit it. A website can detect when its document becomes hidden or loses focus, including when another tab becomes active, but it cannot honestly guarantee that operating-system or browser tab switching is impossible. Camera and microphone access also requires a browser permission decision.

Official platform references:

- [WHATWG Fullscreen API](https://fullscreen.spec.whatwg.org/)
- [W3C Page Visibility Level 2](https://www.w3.org/TR/page-visibility-2/)
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)

Accordingly, the web product records fullscreen, visibility, focus, connection, and device signals for professor review. It never labels a signal as cheating and never changes a grade automatically. A true operating-system lockdown comparable to a native secure-exam client requires a separately installed and managed application; it must not be marketed as a capability of the web room.

## Philippine privacy boundary

Republic Act No. 10173 requires transparency, legitimate purpose, and proportionality. NPC Circular No. 2023-04 describes valid consent as freely given, specific, and informed, and requires withdrawal to be as easy as giving consent when consent is the actual lawful basis.

Official references:

- [National Privacy Commission: Data Privacy Act of 2012](https://privacy.gov.ph/data-privacy-act/)
- [NPC Circular No. 2023-04: Guidelines on Consent](https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf)

Product consequences:

1. Questions remain sealed until the student sees the exact versioned notice and performs the single required acknowledgement action.
2. Core academic processing must use the lawful basis selected by the participating school and its Data Protection Officer; the interface must not disguise a mandatory academic process as freely optional consent.
3. Any camera or microphone recording needs separate, explicit recording authorization, a visible indicator, a short stated retention period, tightly limited access, an accommodation/alternative route, and an actual encrypted media pipeline.
4. Real names are available to the professor by default because the professor controls the roster and result release. Anonymous grading hides identity only inside the grading view and must not be reversible from grading payloads.
5. Integrity events are contextual evidence only. They are never an automatic misconduct finding.

## Go-state gates

- **Standard mode:** eligible after database migration, Worker secrets, authenticated staging, backup/restore drill, and school privacy/legal approval.
- **Focus monitoring:** eligible under the same gates after browser compatibility and accommodation testing; wording must remain “detects/records,” never “prevents tab switching.”
- **Recorded proctoring:** not eligible merely because a camera/microphone checkbox exists. It must fail closed until the server advertises a configured encrypted media-upload, retention, access, deletion, and review capability and the school approves its notice and alternative arrangement.
- **Native lockdown:** a separate future product, not a claim of this web release.
