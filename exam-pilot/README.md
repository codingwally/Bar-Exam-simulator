# Due Diligence examination platform

An isolated examination service with a small professor workflow and a simple
student experience. The professor uploads a question paper, checks the complete
questions, creates a link and reads the responses. Students open that link,
enter their name and email, write and submit. Only a server receipt confirms a
final submission.

This service has its own Worker and database, with configured private copies. It does not
replace the public DueDiligence website, subscriber access, graders, Simulator
or existing student records.

## Professor workflow

1. Open the private `/admin/exams` page and sign in with the professor
   passphrase. The free deployment does not require Zero Trust activation or a
   Cloudflare payment method. An existing Access organization remains supported
   as an alternative deployment mode.
2. From **My exams**, choose **Create exam**. Upload a Word `.docx`, a PDF with
   selectable text, or a plain text file. Pasting and manual question entry are
   also available.
3. Read every complete question and subquestion. The reader separates numbered
   questions, keeps lettered subparts with their parent, and numbers the reviewed
   questions consecutively. Edit, move, split, combine or remove items as needed.
   Compare with the original extracted text when the document layout is unclear.
4. Check the instructions, title and **Time allowed for each student**. Source
   instructions are preserved, with short platform directions added. No legal
   questions, answer keys or substantive examination rules are generated.
5. Confirm the review and choose **Create exam link**. Each created examination
   has its own `/exam/<slug>` link and immutable reviewed question set. Copy and
   share the actual link shown in the page.
6. Choose **Responses** to search students, read every numbered answer including
   blank slots, and download one student's answers or the complete CSV. Receipts,
   observed activity, recovered writing, independent-copy status and authorized
   recovery controls are inside **Support & preservation details**.

Newly created examinations are immediately available timed practice examinations.
Their duration is 1–360 minutes from each student's first start. Returning to the
same attempt never restarts its timer. Creating a new exam does not overwrite
older questions, attempts or receipts. An unfinished professor draft is kept in
that browser when storage is available; it is not a published examination.

The public `/` page is the student workspace. A browser can remember its own
examinations and return to an existing attempt. The seeded `/practice` route is
five minutes. The legacy `/official` route and common-cutoff backend remain, but
fixed opening/closing scheduling is not exposed by the rebuilt professor creation
screen. Do not describe a practice link as a scheduled official examination.

These are application routes, not verified hosted addresses. Use only a hostname
confirmed by an actual deployment and HTTPS smoke test.

## Document reading and limits

Word is read by pinned Mammoth; PDFs by pinned Mozilla PDF.js and its matching
worker. The readers run locally in the professor's browser, using self-hosted
assets. Question files are not sent to an AI service or conversion website.
The reviewed questions, instructions and private original extracted text are
stored when the professor creates the examination. The original text is not
returned in the student examination API.

- Supported: `.docx`, text PDFs, `.txt` and `.md`; pasted or manual questions.
- Scanned or textless PDF pages are detected and the whole import is refused.
  OCR is not included. Export readable text or paste the paper instead.
- Older binary `.doc` must be saved as `.docx` first. Password-protected,
  malformed and unsupported files receive an explicit fallback.
- Files are limited to 20 MB, PDFs to 100 pages, and unpacked Word archives to
  40 MB and 2,000 entries. Reading PDFs shows page progress and can be cancelled.
- Ambiguous numbering needs professor review. Repeated main question numbers,
  empty items, duplicate questions and apparent answer-key material are refused.
  PDF reading order can differ from the printed page. Always read the preview.
- Questions may contain at most 80,000 characters each; instructions at most
  10,000. The private original text limit is 1,000,000 characters. The complete
  creation request also has a 1.5 MB UTF-8 limit. Oversized work is rejected with
  its draft retained; it is never silently shortened.
- A failed, cancelled, incomplete or questionless import does not replace an
  existing reviewed question draft. The original extracted copy remains
  separate from subsequent boundary edits.

See [DOCUMENT-READERS.md](DOCUMENT-READERS.md) for parser versions, preserved
licences and reproducible real-document fixtures. DOCX/PDF layout extraction is
deterministic; it does not replace the professor's final review.

## Local start and verification

Node 24 is required for the real SQLite test adapter. Run these commands from
the repository root:

```powershell
npm ci --prefix exam-pilot --ignore-scripts --no-audit --no-fund
npm run build:documents --prefix exam-pilot
node exam-pilot/dev-server.mjs
```

Open `http://localhost:8797/admin/exams` for the professor desk and
`http://localhost:8797/` for the student workspace. The server binds loopback,
uses disposable in-memory SQLite and injects a synthetic examiner identity.
Set `EXAM_QA_ADMIN_SECRET` to a disposable 64-character hexadecimal secret to
exercise the actual built-in professor authentication instead of that bypass.
Restarting it clears that synthetic database. Its `__qa` controls and
administrator bypass are never imported by the deployed Worker. Local practice
does not prove production authentication or provider delivery and sends no real
email or Google data.

Build the private readers before starting an upload rehearsal; their generated
`public/document-vendor/` files are ignored and intentionally absent from Git.
`build:documents` uses pinned package versions, preserves dependency notices and
fails if a required licence is missing. No external CDN is required at runtime.

```powershell
node exam-pilot/run-tests.mjs
npm run test:documents --prefix exam-pilot
```

The first command discovers the complete isolated deterministic suite, including
real SQLite, provider adapters, source preservation and real DOCX/PDF fixtures.
The second runs only the document-reader subset. Fixture regeneration is
available through `node exam-pilot/test/create-document-fixtures.mjs`.

The isolated CI workflow builds the readers, runs deterministic tests, and
rehearses the workspace and real-file upload/review/link journey in Chromium,
Firefox and WebKit. Browser runners use a disposable local server and synthetic
data. `test/document-workflows-browser.mjs` calls the upload helper in
`test/document-browser.mjs`; `test/workspace-browser.mjs` checks the student
workspace. Browser evidence is written under ignored `.wrangler/evidence/`.
Playwright is a review dependency, not a public application dependency.

For the synthetic HTTPS fixture, configure `EXAM_QA_TLS_KEY` and
`EXAM_QA_TLS_CERT`. `DD_ALLOW_SELF_SIGNED=true` belongs only in that local test
runner. Production must retain normal TLS verification. The service worker
installs the public shell atomically; its cache version must be bumped whenever
that shell changes.

## Persistence and recovery

| Record | Purpose |
| --- | --- |
| Local IndexedDB draft journal | Saves writing on the device when browser storage works; reopen the same link in the same browser/profile. Never clear site data during an examination. |
| Isolated D1 `EXAM_DB` | Authoritative question versions, accepted answer revisions, append-only operations, immutable final answers, receipts, recovered writing and audit records. |
| Optional private R2 `EXAM_BACKUPS` | Additional complete question/answer snapshots with identity, hashes, timestamps and final receipt when a bucket is configured. Practice does not require an R2 subscription; new official examinations do require this extra copy. |
| Private Google collection | The owner-run signed Google relay maintains one readable student tab per attempt, with full numbered answers and continuation rows for long text. It refuses copies unless the Sheet has only the owner's permission; no service-account sharing is needed. |
| Owner answer email | Complete final packet to `wallyesteban1993@gmail.com`, including blank slots and checksums; large content uses numbered parts. Official attempts additionally queue a concise student receipt. |
| Durable delivery outbox | Independent targets retry with leases and backoff; failures remain inspectable and retryable. A provider failure never invalidates a saved answer or final receipt. |

Provider adapters are implemented, but a local/mock success or manually imported
simulation workbook does not prove the automatic production adapters are
configured. Verify each actual provider separately before using the service for
a real examination.

The default practice deployment uses Workers and D1 without adding R2 or asking
for a Cloudflare payment method. Its durable queue retains Google snapshot/final
copy jobs and owner final-answer email jobs. Those providers still need their
own configuration. Binding `EXAM_BACKUPS` enables additional R2 snapshots for
practice. Existing R2 jobs and evidence are never deleted when that binding is
absent. New official scheduling or registration fails closed without R2;
existing official attempts can still save to D1 and retrieve their receipt.

At the server deadline, further official answer writes stop. Maintenance and
lazy reads finalize the last accepted revisions, even after the student closes
the tab. Offline writing uploaded later is preserved separately as recovered
writing with upload time and untrusted client time; it never silently replaces
the final timed answers. Any accommodation requires a human decision.

For lost browser credentials, authorized staff must verify the student before
issuing a one-use, ten-minute recovery link for the existing attempt. Recovery
revokes the previous session and preserves the original deadline. An explicit
practice reset preserves the old attempt and receipt; it is a troubleshooting
operation, not a student timer reset. Read-only examiner identities cannot make
these changes.

Admission-link rotation/revocation applies to new registration. Existing
authenticated attempts can continue saving and retrieving their receipts.
Observed focus, connection or storage events are evidence for human review;
they cannot establish misconduct by themselves.

For disaster recovery, preserve a D1 export and the relevant private R2 objects
first. Restore into a separate recovery database and reconcile question/attempt
identity, revision, SHA-256, server times and receipt checksums. Never overwrite
an immutable final record or delete original evidence to repair a display.
No automatic retention deletion is enabled.

## Cloudflare setup and database upgrades

`wrangler.example.jsonc` is a template with an intentionally invalid placeholder
D1 identifier. It is not a deployable configuration. Use the pinned local
Wrangler dependency. Keep production infrastructure entirely separate from the
main site's resources.

1. Supply the scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the
   existing account. For the no-card deployment set `ADMIN_AUTH_MODE=password`.
   `infrastructure.mjs check` then checks only Workers and D1. Create a random
   32-byte professor passphrase and store it only as the Worker secret
   `ADMIN_LOGIN_SECRET` and in the owner's private credential store. Never put it
   in the deployment JSON, source, URL or browser storage. The built-in session
   uses a one-hour, host-only, Secure, HttpOnly, SameSite=Strict cookie backed by
   D1; logout revokes it and secret rotation invalidates existing sessions.
   Incorrect guesses have bounded per-address and global counters. The Worker
   fails closed when the secret or owner configuration is missing.

   Alternatively choose `ADMIN_AUTH_MODE=access` when an Access organization is
   already activated. `access-setup.mjs check` and `infrastructure.mjs check`
   inspect authorization without creating resources. The deployment-only
   `access-setup.mjs setup` uses the already enabled Zero Trust organization to
   create or verify a new isolated owner-only Access application. It records
   the verified team domain and audience in ignored `.wrangler/access-env.json`.
   This uses the existing Access login.
2. `infrastructure.mjs provision` in password mode provisions without requesting
   an Access organization or R2 subscription. In Access mode it reads the
   verified Access file, or explicit
   `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` environment values, and writes ignored
   `.wrangler/deploy.json` for the isolated service. The default configuration
   provisions only the isolated D1 database, with `EXAM_DB`, static `ASSETS` and
   minute maintenance. It does not subscribe to R2 or add a bucket. If R2 is
   explicitly configured later, keep it private with no public domain.
3. For a **fresh examination database**, apply complete `schema.sql` once.
   For a database created **before the multi-exam rebuild**, back it up and apply
   `migrations/0002_practice_library.sql` once instead of assuming the schema
   file upgrades it. That migration adds exam duration/instructions/private
   source fields and browser-to-exam sessions. Inspect the actual schema and
   migration record before running it: it must not run twice or against a fresh
   database that already has these columns. `CREATE TABLE IF NOT EXISTS` alone
   does not add missing columns. Never apply either file to the main site DB.
   The added built-in authentication tables can be created safely with
   `migrations/0003_admin_login.sql` on an existing rebuilt database; it contains
   only `CREATE TABLE/INDEX IF NOT EXISTS` statements.
4. In Access mode, protect all private routes and assets with the same Access application:
   `/admin*`, `/api/admin/*`, `/import.mjs`, `/document-import.mjs` and
   `/document-vendor/*`. Keep student routes public. Configure matching
   `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and authorized owner `ADMIN_EMAILS`.
   Optional `EXAMINER_EMAILS` grants read-only reports. The Worker independently
   verifies the RS256 signature, issuer, audience, expiry and email for admin API
   requests and private assets, including document readers. Missing setup fails
   closed. In password mode the Worker gates those same private assets and APIs
   with the professor session; only the dedicated sign-in shell is public.
   An instructor's email must be supplied by the owner, not guessed.
5. For the free owner-only Google copies, follow
   [google-relay/README.md](google-relay/README.md). The reviewed script runs as
   the owner, checks every Sheet permission before each copy, verifies the
   complete literal text after writing, and signs acknowledgements. Store only
   its URL and private signing key as Worker secrets `EXAM_RELAY_URL` and
   `EXAM_RELAY_SECRET`. Keep the Sheet restricted to the owner. The alternative
   service-account adapter remains supported when separately configured, but
   is not used for the owner's private deployment.
6. The same owner-run relay sends complete numbered raw answers in email bodies
   and matching text attachments to the owner only. Daily quota delays retain
   journalled parts and retry later; an ambiguous send requires owner review
   before resending. It never reports complete until every part is accepted.
   The alternative mail adapter uses `RESEND_API_KEY` and verified `EXAM_EMAIL_FROM`.
   Set `EMAIL_DELIVERY_ENABLED=true` only after an authorized synthetic rehearsal.
   Mail is disabled by default. A Google/Gmail connector used for a manual demo
   is separate from these deployed Worker provider credentials.
7. Build the private readers, deploy only the isolated Worker, then perform real
   hosted HTTPS student and authenticated admin checks. Confirm access denial
   for anonymous users and all independent delivery copies by exact receipt and
   checksum. Keep production secrets out of logs, source and public files.

The manual workflow's connection check is read-only. Only `deploy-isolated`
creates the isolated database and publishes the Worker. Password mode does not
create or activate Zero Trust. Its
schema guard refuses an older unupgraded database rather than guessing whether
the one-time migration ran. A successful code deployment alone is not a database
upgrade or official-exam release approval.

## Release status and remaining gates

The rebuilt multi-exam flow has local document-reader tests and actual browser
upload/review/unique-link rehearsals. A real synthetic student submission was
reloaded and finalized. Its exact two questions, two complete answers, receipt
and checksum were verified in a private native Google collection and manually
sent owner email. The converted Sheet export was reimported and visually checked.
This verifies the simulation collection, not automatic deployed Worker provider
credentials or hosted operation.

[RELEASE-REVIEW.md](RELEASE-REVIEW.md) records the earlier five-pass reliability
review and clean CI run at revision `2e3ca325c6d6a24968197fad41483e260dbc0702`.
Its earlier two-route dashboard descriptions predate this rebuild. That historic
run must not be presented as certification of later interface/parser changes.
Use the new revision's actual test and deployment evidence for release decisions.

Before a real examination, verify hosted HTTPS and private examiner access,
working D1 (and R2 when required), automatic private Google and owner-email copies plus retry,
real iOS/Android devices and school networks, and expected hosted concurrency.
The owner must provide the actual question paper, authorized examiner identities,
privacy/support contact and retention policy. Scheduled official delivery also
requires confirmed common opening and closing times through an authorized
administration workflow. The rebuilt creation screen currently creates practice
examinations, not scheduled official papers.

Browser-engine tests and simulated phone widths do not certify every physical
device. Local concurrency checks establish record completeness and race behavior,
not hosted capacity. Cleared storage, hardware failure or simultaneous loss of
both storage and connectivity can destroy unsynchronized writing. Student save
status must continue to distinguish local drafts from server-confirmed saves.

## Rollback

The pre-change repository baseline is
`a375f3eb2d8d914948a38e1ba195098849aed10d`. To roll back this isolated service,
pause new admission, preserve D1/R2 and verify schema compatibility before
selecting a previous Worker deployment. Keep the database and bucket intact.
Never roll back the unrelated main site or delete exam evidence as part of a
code rollback.
