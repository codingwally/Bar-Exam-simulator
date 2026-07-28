# Lex Forum social beta architecture

Status: staging-validated; production rollout requires the Lex Forum preflight
and the database → Worker → frontend release sequence.

Public label: **Lex Forum (Under Construction)**

Lex Forum is an authenticated, chronological discussion layer inside the
existing Due Diligence single-page application. It is intentionally a focused
legal-study forum, not a Facebook-style network, group system, chat product, or
replacement for the essay simulator.

## Product scope

The beta supports:

- plain-text posts with one optional `http` or `https` source URL;
- owner edit and soft-delete;
- idempotent like/unlike;
- plain-text comments with owner edit and soft-delete;
- attributed internal reposts with optional commentary;
- stable internal discussion links;
- private reports;
- founder-only moderation, temporary posting restrictions, and audit records;
- cursor pagination, loading, empty, error, offline, retry, and responsive UI
  states.

It deliberately excludes images, file uploads, direct messages, groups,
algorithmic ranking, following, anonymous posting, and rich HTML. The current
limits are a safety boundary, not a statement of final product scope.

## Trust boundaries

```text
Browser
  │ Supabase access token (never service-role key)
  ▼
Cloudflare Worker
  ├─ verifies the Supabase user
  ├─ validates and normalizes the request
  ├─ applies a privacy-safe transient IP-hash burst limit
  └─ invokes one narrow database RPC with the verified user UUID
       ▼
Supabase
  ├─ transactionally rechecks identity, ownership, visibility, limits,
  │  duplicate throttles, restrictions, and founder authorization
  ├─ stores server timestamps and authoritative interaction rows
  └─ returns safe display names/schools without auth UUIDs or emails
```

No forum table or function is directly callable by `PUBLIC`, `anon`, or
`authenticated`. RLS is enabled on every forum table, no browser-facing forum
policy exists, and only `service_role` receives storage/function privileges.
The service-role key remains an encrypted Worker secret.

## Data model

| Object | Purpose |
| --- | --- |
| `forum_posts` | Plain-text original posts, optional source URL, owner and moderation state |
| `forum_comments` | Plain-text replies attached to an original post |
| `forum_reactions` | One authoritative like state per user and post |
| `forum_reposts` | Attributed internal shares of original posts |
| `forum_reports` | Private member reports and founder review state |
| `forum_user_restrictions` | Time-bound publishing restrictions and revocation history |
| `forum_action_events` | Privacy-safe, body-free action timestamps for persistent rate limits |

User-auth foreign keys use the existing immutable Supabase Auth UUID.
Member-facing RPCs expose only the profile display name and optional law school.
They do not expose emails, reporter identity, auth UUIDs, IP addresses, access
tokens, or service credentials.

Posts, comments, and reposts are soft-deleted to preserve moderation and audit
integrity. A later retention policy must be a separately reviewed migration;
the beta does not silently hard-delete legitimate user content.

## Authorization and moderation

The Worker derives the acting UUID from the verified access token; client-sent
author or moderator IDs are ignored. Database functions independently enforce:

- signed-in membership for every read and write;
- post/comment/repost ownership;
- visible, non-deleted target records;
- current posting restrictions;
- exact founder or Super Admin authorization through
  `phase4_require_founder`;
- reason-required, request-keyed moderation;
- a conflict if the same moderation request key is reused for a different
  action or target.

Moderation supports hide, restore, remove, report dismissal, restrict, and
unrestrict. Each successful action writes the existing
`content_management_action` audit type. The moderation queue omits reporter
identity.

## Input and rendering safety

The browser renders all user-generated text with `textContent`. Admin tables
escape forum text before creating markup. URLs are parsed independently in the
browser and Worker, accept only `http:` or `https:`, reject embedded
credentials, and open with `noopener noreferrer ugc`.

Database checks enforce the same length and URL contracts. Duplicate posts,
comments, reports, and reposts are controlled at the transactional layer.
Advisory locks make concurrent duplicate checks and moderation retries
deterministic.

## Rate limits

Persistent per-user limits are enforced inside the same database transaction as
the action:

| Action | Limit |
| --- | --- |
| New posts | 5 per 10 minutes |
| Post edits | 20 per 10 minutes |
| New comments | 20 per 10 minutes |
| Comment edits | 30 per 10 minutes |
| Like state changes | 60 per 10 minutes |
| Reposts | 10 per 10 minutes |
| Reports | 10 per hour |

The Worker also applies a short transient IP-hash burst limit. The raw IP and
hash are never stored in Supabase, logs, responses, or frontend code.

## Navigation and authentication

The existing SPA tab is labelled exactly
`Lex Forum (Under Construction)`. A signed-out visitor receives the existing
Google sign-in experience with guest access disabled. The intended forum or
stable-post destination is retained in session storage and the URL, then
restored after authentication. Signing out clears rendered forum records.

## Operational limitations

- A source link is user-supplied and is not an editorial endorsement.
- The chronological feed does not provide content ranking or legal validation.
- Moderators must independently verify alleged legal misinformation.
- Account deletion needs a separately reviewed policy because authored posts
  and comments use restrictive Auth foreign keys.
- The under-construction label must remain until moderation operations and
  real-member load are observed in production.
