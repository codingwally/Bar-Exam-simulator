# DueDiligence 2026 feature architecture

Date: 2026-08-04
Branch: `agent/duediligence-2026-features`
Baseline: `3e5004eb71dd3322a8237aa5dc7778ac47175601`

## Existing production architecture

- Static, framework-free HTML/CSS/JavaScript deployed by GitHub Pages at `https://duediligence.ph`.
- Supabase Auth and PostgreSQL are the identity and authoritative data systems.
- A Cloudflare Worker (`duediligence-gemini-examiner`) mediates privileged database operations, Gemini grading, email, uploads, and administrative operations.
- Resend is retained only for independently controlled transactional systems. Practice Exam and marketing email are disabled.
- The existing design system is navy, cream, restrained gold, editorial serif headings, and compact pill navigation. The 2026 work reuses those conventions and does not replace the application shell.
- Existing Mock Bar, Subject Matter, Bar Feels, Quorum, account, subscription, payment, and administration behavior remains unchanged.

## Additive 2026 architecture

### Curated legal content

Prepared Google Sheet rows are captured as versioned repository JSON and imported idempotently into a normalized, Worker-only Supabase content store. The Sheet remains the editorial source; the database is the publication and access-control boundary. Content carries its source fields, checksum, beta status, version, lifecycle state, and editorial audit identity.

The lifecycle is `draft -> in_review -> approved -> published -> archived`. `CONTENT_HUMAN_REVIEW_REQUIRED=false` permits validated `AI_PREPARED_BETA` rows to publish now. When enabled later, an unapproved or materially changed row cannot publish.

### Non-retentive practice

Bar Easy and Doctrine grading run only in the Worker. The Worker sends the submitted answer to Gemini as untrusted data, validates a strict response schema, returns transient feedback, and never sends answer text or model rationale to Supabase, analytics, logs, Sheets, browser storage, or telemetry. Supabase receives only an idempotent completion counter for Bar Easy and `{user_id, doctrine_id, result, timestamp}` for Doctrine mastery.

### Verdict PDF

The Worker reads the result from Supabase after ownership and entitlement checks, renders only authorized whole/section/question selections, and returns a private, no-store PDF. The renderer owns the suggested answer and coaching fields; browser-supplied legal content is ignored. The premium requirement is controlled by `VERDICT_PDF_PREMIUM_REQUIRED`.

## Security boundaries

1. The browser holds only the public Supabase key and a user access token.
2. Gemini, service-role, Google, Resend, and deployment credentials remain encrypted Worker or deployment secrets.
3. The Worker validates origin, authenticated identity, payload limits, role, ownership, state, and idempotency before invoking Worker-only RPCs.
4. Uploaded and model-generated content is untrusted and escaped before rendering.

## Rollback model

Application rollback means restoring the previous GitHub Pages deployment and Worker version while disabling affected 2026 feature flags. Database rollback is forward recovery: additive tables and immutable evidence are not deleted. A reviewed forward migration may deactivate or repair new objects while preserving unrelated product records and audit evidence.
