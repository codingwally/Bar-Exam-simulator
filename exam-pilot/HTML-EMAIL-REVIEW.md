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
1440, 390 and 320 pixels without overflow. Real HTML sample delivery and Google
relay activation must be verified independently; local mock tests do not prove
unattended provider configuration.

The owner approved the prepared Google setup on 25 October. Browser access to
the owner Google session was unstable during configuration; this is an access
condition, not missing owner authorization. Do not ask for the same approval
again. Private preview files and provider readbacks belong under ignored
`.wrangler/`; no real answers or credentials are committed.
