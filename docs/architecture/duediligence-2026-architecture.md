# DueDiligence 2026 feature architecture

Date: 2026-08-04
Branch: `agent/duediligence-2026-features`
Baseline: `3e5004eb71dd3322a8237aa5dc7778ac47175601`

## Existing production architecture

- Static, framework-free HTML/CSS/JavaScript deployed by GitHub Pages at `https://duediligence.ph`.
- Supabase Auth and PostgreSQL are the identity and authoritative data systems.
- A Cloudflare Worker (`duediligence-gemini-examiner`) mediates privileged database operations, Gemini grading, email, uploads, and administrative operations.
- Resend is the existing transactional email provider.
- The existing design system is navy, cream, restrained gold, editorial serif headings, and compact pill navigation. The 2026 work reuses those conventions and does not replace the application shell.
- Existing Mock Bar, Subject Matter, Bar Feels, Quorum, account, subscription, payment, and administration behavior remains unchanged.

## Additive 2026 architecture

### Curated legal content

Prepared Google Sheet rows are captured as versioned repository JSON and imported idempotently into a normalized, Worker-only Supabase content store. The Sheet remains the editorial source; the database is the publication and access-control boundary. Content carries its source fields, checksum, beta status, version, lifecycle state, and editorial audit identity.

The lifecycle is `draft -> in_review -> approved -> published -> archived`. `CONTENT_HUMAN_REVIEW_REQUIRED=false` permits validated `AI_PREPARED_BETA` rows to publish now. When enabled later, an unapproved or materially changed row cannot publish.

### Non-retentive practice

Bar Easy and Doctrine grading run only in the Worker. The Worker sends the submitted answer to Gemini as untrusted data, validates a strict response schema, returns transient feedback, and never sends answer text or model rationale to Supabase, analytics, logs, Sheets, browser storage, or telemetry. Supabase receives only an idempotent completion counter for Bar Easy and `{user_id, doctrine_id, result, timestamp}` for Doctrine mastery.

### Examination Room

The Examination Room uses a separate `exam_room_*` data model instead of changing the existing Subject Matter/Bar Feels examination engine, whose historical 20-question constraints remain an unrelated production contract. The new model supports any professor-confirmed positive question count and applies only operational upload and class-size limits.

All Examination Room data is Worker-mediated. Browser roles receive no direct table or function privileges. PostgreSQL constraints and transactional RPCs enforce ownership, roster membership, uniqueness, server time, one attempt, immutable confirmed questions, answer revision checks, hard close, sealing, credential revocation, grade history, dispute review, and outbox idempotency. RLS is enabled and forced as defense in depth.

### Google backup

PostgreSQL remains authoritative. Every backup-worthy state change inserts a sequenced, hashed outbox event in the same database transaction. A Worker processor writes RAW values to a per-exam Google workbook, verifies the write, and marks the event synced. Failures retry with bounded exponential backoff and do not block exam operations. Strings beginning with `=`, `+`, `-`, or `@` are explicitly written as text.

### Verdict PDF

The Worker reads the result from Supabase after ownership and entitlement checks, renders only authorized whole/section/question selections, and returns a private, no-store PDF. The renderer owns the suggested answer and coaching fields; browser-supplied legal content is ignored. The premium requirement is controlled by `VERDICT_PDF_PREMIUM_REQUIRED`.

## Security boundaries

1. The browser holds only the public Supabase key and a user access token.
2. Gemini, service-role, Google, Resend, and deployment credentials remain encrypted Worker or deployment secrets.
3. The Worker validates origin, authenticated identity, payload limits, role, ownership, state, and idempotency before invoking Worker-only RPCs.
4. Uploaded and model-generated content is untrusted and escaped before rendering.
5. Exam credentials are random, scoped, rate-limited, and stored only as hashes.
6. Released records are sealed; dispute review creates a new expiring authorization and never reactivates an old credential.

## Rollback model

Application rollback means restoring the previous GitHub Pages deployment and Worker version while disabling affected 2026 feature flags. Database rollback is forward recovery: additive tables and immutable evidence are not deleted. A reviewed forward migration may deactivate or repair new objects while preserving answers, grades, incidents, releases, disputes, audit records, and outbox events.
