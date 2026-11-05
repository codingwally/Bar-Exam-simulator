# Submission email separation — 25 October 2026

The owner receives a Due Diligence HTML archive email with the private Google
Sheet link and complete numbered submission packet. The Sheet remains accessible
only to the owner. The link and Sheet delivery references are also withheld
from non-owner examiner API responses.

Exam takers receive a separate Due Diligence HTML confirmation headed "You
successfully submitted your answers." It shows their exam, name, PHT submission
time, complete numbered frozen answers and a small submission reference. It
includes no collection link, original question paper, private imported source,
other students or backup details. The plain-text MIME alternative is retained
for compatibility; the visible default is designed HTML.

Every finalized practice and official attempt queues exactly one confirmation.
Retries and cron reconciliation keep the same immutable receipt and frozen
answers, including blanks. Separate owner/student mail journals remain distinct
even when the owner takes the practice exam using the owner's email address.

HTML escapes untrusted content and preserves exact Unicode text. Large answer
sets use clearly numbered parts under the provider body limit. The signed
relay authenticates recipients and HTML/text hashes, checks quota before each
new part, and retains the existing ambiguous-send review requirement. The
student path can send before the independent Sheet copy completes.

Validation: 245 deterministic tests passed, including actual SQLite finalization,
reconciliation and failure/retry tests; provider/relay routing; owner-only Sheet
references; HTML escaping, private-data exclusion, full Unicode/multipart text,
separate journals and idempotency. HTML samples were visually inspected at
1440, 390 and 320 pixels without overflow. This pre-activation validation did
not itself prove unattended provider configuration; the independent live checks
are recorded below.

The owner approved the prepared Google setup on 25 October. Browser access was
initially unstable, but that connection problem was resolved and the approved
authorization was completed. Private preview files and provider readbacks belong
under ignored `.wrangler/`; no real answers or credentials are committed.

## Live activation — 25 October 2026 PHT

The owner-run Google Apps Script relay was published as Version 1. The isolated
Worker was activated at version `6ea85de6-0fbf-44b3-8e5a-de8c0e2bd52f`, using
implementation revision `fd96af6`. Email delivery is enabled in the live Worker
and the GitHub deployment variable, with the configured private relay secrets.

A fresh hosted synthetic submission produced its immutable final receipt and
completed both Sheet jobs, the owner HTML email and the exam-taker HTML email.
Each job was confirmed sent once. Both real Gmail messages were independently
read back and matched their exact expected HTML: the owner copy includes the
private collection link, while the exam-taker copy contains only its submission
proof and numbered answers. Separate owner/student journals were verified even
when both copies went to the same test account. Drive permission readback still
showed only the owner, with no public or additional-user access.

The complete visible Sheet range matched all 20 expected rows, and the owner's
raw archive attachment matched the frozen submission exactly. Both plain MIME
alternatives matched after transport line wrapping. The delivered exam-taker
email was also visually checked in Gmail, including its numbered answers.

This is proof of automatic hosted delivery for that fresh rehearsal, superseding
the earlier browser-connection blocker and manual-only sample evidence. It does
not assert that earlier manually populated tabs were overwritten or that all
historical failed jobs were replayed. Private rehearsal state and verification
remain in `.wrangler/evidence/automatic-delivery-rehearsal-*.json` and
`.wrangler/evidence/automatic-delivery-external-readback.json`. Physical-device
coverage, hosted capacity and official-examination readiness retain their
separate release gates.
