# Constitutional Law I examination pilot

An isolated examination service for Due Diligence and Atty. Aguila. It does not
change the public website, subscriber access, graders, Simulator or old records.
The student experience is deliberately small: open the link, enter a name and
email, acknowledge the notice, write, and submit. A server receipt confirms
submission. A browser draft or a pending request alone never does.

## Routes

The service has exactly two student routes, `/practice` and `/official`, and one
private examiner dashboard at `/admin/exams`. These are route names, **not
verified hosted URLs**. Use only the hostname actually returned by a successful
deployment. Practice contains one approved question and lasts five minutes per
student. Official starts empty, with `Test is not available`.

## Ordinary examiner setup

1. Sign in to the private examiner desk. Choose **Official Midterm**.
2. In **Questions**, upload a CSV, paste numbered text, or add questions manually.
   Preview every complete item and save the draft. Only CSV has a tested file
   parser; DOCX/XLSX must first be exported to CSV or pasted. No AI rewriting.
3. In **Exam schedule**, enter opening date/time and closing date/time or duration.
   Every input and review is explicitly Philippine time.
4. Review every question and exact dates, confirm, then **Save and Schedule**.
5. Share the unchanged official route. It counts down immediately and opens
   automatically. Every late entrant receives the remaining common time.
6. **Examinees & responses** contains complete responses, blank question slots,
   receipts, CSV downloads and readable per-student reports. **Activity** records
   observations for human review. **Backups & controls** shows delivery failures
   and retry controls. Never infer misconduct from a missed heartbeat.

Owner-only admission link controls can explicitly rotate, revoke or re-enable
new entries with a reason and confirmation. Rotation adds a new admission key;
ordinary question uploads never change the link. Existing authenticated attempts
continue saving and retrieving their original receipts after a rotation or
revocation. The dashboard clearly distinguishes new entry from existing work.

After an exam closes, **Create next official examination** preserves the old
exam in read-only history and creates a new empty exam using the same current
student route. It requires a title, reason and explicit confirmation. Normal
question upload and scheduling require no source edits or deployment.

## Preservation and recovery

| Copy | Location and recovery |
| --- | --- |
| Device drafts | IndexedDB `due-diligence-exam-drafts-v1`, `states` and `revisions`; immediate local journal when available. Reopen the same link/browser/profile. Do not clear site data. |
| Authoritative server | Isolated D1 binding `EXAM_DB`: `answers`, append-only `answer_operations`, immutable `final_answers`, `submissions`, `recovered_drafts`, `events`, `admin_audit`. |
| Independent snapshots | Private `EXAM_BACKUPS` R2 bucket, `snapshots/<exam>/<attempt>/<job>.json`; complete question/answer versions, hashes, times and receipt. |
| Google mirror | Private dedicated spreadsheet; one idempotently replaced tab per attempt, long content in numbered continuation rows. Requires service-account authorization. |
| Owner email | Complete final answers, blanks, identity, timestamps and checksums to `wallyesteban1993@gmail.com`; large copies split into numbered parts. Student receives a separate concise receipt. |
| Durable delivery | D1 `outbox`, exclusive per-attempt/target lease, exponential retry, admin failure status and retry. Provider failure never revokes a submission. |

At cutoff, server writes are rejected immediately. Scheduled maintenance and
lazy reads finalize the last accepted revisions even after a tab closes.
Recovered offline writing is saved in `recovered_drafts` with upload time and
untrusted client time; it never replaces the official timed answers. Only the
examiner decides an accommodation. There is no automatic disciplinary verdict.

For missing cookies/browser data, authorized staff verify identity and generate
a one-use, ten-minute recovery code from the selected existing attempt. Recovery
revokes the old session and preserves its original deadline. Practice reset is a
separate, explicit troubleshooting action that preserves the old attempt and
receipt; it cannot reset an official attempt.

For disaster recovery, first preserve a D1 export and the affected R2 objects.
Restore D1 into a separate recovery database. Compare attempt/question IDs,
revision, SHA-256, server times and final receipt checksums against the private
snapshots, Sheet and owner mail. Reconcile in that separate database with an
audited examiner decision; never overwrite a finalized official record in place.
Do not delete any original evidence. No automatic deletion is enabled. The owner
must establish retention/deletion rules and the privacy contact before live use.

## One-time infrastructure

Use `wrangler.example.jsonc` as a template, not a deployable configuration: its
D1 identifier is an explicit placeholder. `infrastructure.mjs provision` verifies
or creates only the isolated D1 database and private R2 bucket, rejects public
bucket domains, and writes ignored `.wrangler/deploy.json`. It neither changes
the existing Worker nor grants admin access.

- Cloudflare account credentials with permissions for the new Worker, D1 and R2.
- Bind `EXAM_DB`, private `EXAM_BACKUPS` and static `ASSETS`; apply `schema.sql`
  to the new database only. Keep its minute maintenance trigger enabled.
- A Cloudflare Access application protecting `/admin*` and `/api/admin/*` on
  the verified exam hostname. Configure the same application's issuer and
  audience as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. The Worker verifies the
  RS256 signature, issuer, audience, expiry and staff email. The owner email is
  the initial `ADMIN_EMAILS` entry. Unknown instructor email is never invented.
  Configure `EXAMINER_EMAILS` separately for authenticated read-only reports;
  examiner accounts cannot schedule, recover, reset, rotate links or modify data.
- Authenticated mail provider secrets `RESEND_API_KEY`, verified
  `EXAM_EMAIL_FROM`; explicitly enable `EMAIL_DELIVERY_ENABLED=true` only after
  an authorized synthetic delivery rehearsal. This implementation does not
  send live mail merely because tests ran.
- `GOOGLE_SERVICE_ACCOUNT_JSON` secret and `GOOGLE_SPREADSHEET_ID`; share the
  private spreadsheet only with the service account and authorized staff. Set
  up no public link. Google credentials never enter browser files.
- Actual official questions, opening/closing times, authorized examiner identity,
  support/privacy contact, retention policy, and live independent delivery proof.

The workflow `.github/workflows/exam-pilot.yml` runs isolated unit/SQL tests and
can check available infrastructure. The manual `deploy-isolated` action applies
only the new schema and publishes only the new Worker. A successful deployment
must still be followed by actual HTTPS student and authenticated admin smoke
tests and verified independent backup deliveries before official use.

Current platform references: [Worker assets and routing](https://developers.cloudflare.com/workers/static-assets/binding/),
[Access token verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[atomic Sheets updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request).

## Local synthetic rehearsal

Node 24 is required for the real SQLite test adapter.

```powershell
node exam-pilot/run-tests.mjs
node exam-pilot/dev-server.mjs
node exam-pilot/test/student-browser.mjs http://localhost:8797
node exam-pilot/test/visual-browser.mjs
```

Playwright is needed only for browser reviews. The local server binds loopback,
uses synthetic memory SQLite, and injects a fake examiner for rehearsal. Its
`/__qa/*` controls exist only in `dev-server.mjs`. Neither that module nor
`test-support.mjs` is imported by the deployed Worker. No test sends actual mail
or writes Google data. Browser screenshots/results go into ignored
`exam-pilot/.wrangler/evidence/`.

`test/browser-compatibility.mjs` checks Chromium, Firefox and WebKit. Set
`DD_PLAYWRIGHT_MODULE` to select an installed Playwright module. WebKit needs
HTTPS for the production-strength secure cookie. For a local self-signed HTTPS
fixture, supply `EXAM_QA_TLS_KEY` and `EXAM_QA_TLS_CERT` to the local server and
set `DD_ALLOW_SELF_SIGNED=true` only for the test runner. Never disable TLS
verification in the deployed application. The CI workflow provisions its own
synthetic local certificate and browsers and publishes review evidence without
access to production credentials. `test/firefox-reload-diagnostic.mjs` separately
tests generic service-worker reloads without starting an examination.

The public shell is installed atomically and versioned in `public/exam-sw.mjs`.
Bump its cache version with every public shell release. Existing examination
tabs keep their consistent shell until they close; APIs and authoritative
questions, deadlines and receipts always use the server.

Local concurrency results are evidence of completeness and race handling, not a
claim about hosted throughput or every physical device. Real mobile Safari,
Android, school networks and live D1/provider capacity require a deployment
rehearsal. Browsers cannot guarantee work survives cleared storage, hardware
failure or simultaneous total loss of device storage and network access.

## Rollback

The pre-change repository baseline is `a375f3eb2d8d914948a38e1ba195098849aed10d`.
An isolated service release never replaces the existing application or Pages
artifact. To roll back this service, pause admission, preserve D1/R2 first, then
roll back only this Worker's verified deployment version. Keep its database and
bucket intact. A code rollback must never delete exam evidence. Never apply this
schema to the website's database or roll back unrelated website deployments.
