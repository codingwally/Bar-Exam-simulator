# Phase 3 Admin, Analytics, and Operations Contract

## Decision

Phase 3 extends the existing static GitHub Pages frontend, Cloudflare Worker, and
Supabase database. It does not introduce a second backend or a second analytics
source of truth.

- `usage_sessions` stores one privacy-safe browser session.
- `usage_events` stores allowlisted, versioned events.
- the Worker is the only browser-facing analytics and administration gateway;
- Supabase service-role credentials remain Worker secrets;
- administrative reads and writes are authorized in both the Worker and
  service-role-only SQL functions;
- `/admin/` is a same-domain static application and never receives privileged
  database credentials.

Collection starts when the Phase 3 Worker and frontend are both live. No guessed
history is backfilled.

## Identity and privacy

The browser creates random UUIDs for a visitor and session. They are not derived
from an email, IP address, user agent, or device fingerprint.

For signed-in sessions, aggregate unique-user calculations use the immutable
Supabase user UUID. Guest sessions use the random visitor UUID. The Worker never
stores answers, prompts, drafts, model answers, raw IP addresses, full user-agent
strings, emails, OAuth tokens, or credentials in analytics.

Stored acquisition fields are limited to:

- referral host (not the full referring URL);
- sanitized UTM source, medium, and campaign;
- landing/page area;
- coarse device category: desktop, tablet, mobile, or unknown.

Demographic aggregates suppress groups with fewer than five users.

## Time and freshness

- database timestamps: UTC;
- dashboard presentation and day boundaries: Asia/Manila;
- visible-page heartbeat: approximately 90 seconds;
- current viewer: a distinct non-ended session seen within five minutes;
- stale dashboard: last refresh older than five minutes;
- abandoned session duration cap: four hours;
- high-frequency heartbeats update sessions but do not create event rows.

## Metric definitions

| Metric | Formula and source | Exclusions / caveats |
| --- | --- | --- |
| Current viewers | Distinct `usage_sessions.id` with `ended_at IS NULL` and `last_seen_at >= now() - 5 minutes` | Service telemetry, not guaranteed uptime |
| Page views | Count of deduplicated `page_view` events | Heartbeats excluded |
| Unique visitors | Distinct signed-in user UUID, otherwise visitor UUID | No identity stitching beyond sign-in |
| Sessions | Distinct `usage_sessions.id` started in range | Synthetic test events excluded |
| Average daily views/visitors | Range total divided by every Manila calendar day in range | Zero-activity days included |
| Peak concurrent viewers | Maximum distinct active sessions in a five-minute bucket | Approximation from session/event activity |
| DAU / WAU / MAU | Distinct visitor identity active in trailing 1/7/30 days ending at filter end | Ratios unavailable when denominator is zero |
| Returning visitor | Active on more than one distinct Manila calendar date | Requires at least two observed days |
| Registrations | `auth.users.created_at` in range | Not a paid subscriber |
| Onboarding completions | `profiles.profile_completed_at` in range | Incomplete profiles excluded |
| First successful grade | First `grading_success` event per visitor identity | Failed/blocked/timed-out grades excluded |
| Grading success rate | Successes / grading starts | Unavailable when starts are zero |
| Attempt average | Mean of successful 0–5 scores | Failed/blocked/timed-out/ungraded excluded |
| Mastery average | Mean of latest successful score per visitor and question | Same exclusions; one decimal display |
| Median and distribution | Successful 0–5 score values | One-decimal buckets |
| Improvement | Latest minus first successful score for repeated visitor/question pairs | Single-attempt questions excluded |
| Session duration | `min(ended-or-last-seen - started_at, 4 hours)` | Median, not average |
| Support response | First response/resolution timestamps minus creation | No value until workflow activity exists |
| Entitlement count | Active, non-expired internal entitlements | Never described as paid |

Comparison changes are `current - previous` and percent change is
`(current - previous) / previous`. Percent change is `null` when the previous
value is zero.

## Funnel contract

The ordered funnel is:

1. eligible guest session;
2. first successful guest grade;
3. third successful guest grade;
4. guest limit reached;
5. sign-in started;
6. sign-in completed;
7. onboarding completed;
8. authenticated successful grade.

Registration conversion uses guest sessions that reached the sign-in prompt as
its denominator. Funnel counts are distinct visitor identities, not event totals.

## Retention contract

D1, D7, and D30 retention compare a user’s first observed Manila date with
activity exactly 1, 7, or 30 days later. Cohorts that have not elapsed for the
required period are marked `immature`, never failed.

## Content and reliability

The dashboard reads actual subject and question inventory; it never hardcodes
eight subjects or 320 questions. Low-sample content observations are labelled
until at least five successful attempts exist.

Worker telemetry stores sanitized categories and numeric latency only. It never
stores provider response bodies, prompts, answers, or stack traces. AI monetary
cost remains `Not configured`.

## Financial and commercial truth

Payments are not connected. The dashboard must display:

- `Paid subscribers: Not connected — payment integration pending.`
- `Manual access control — no payment provider is connected.`

MRR, ARR, ARPU, paid churn, advertising impressions/clicks/CTR, and sponsorship
income remain `Not connected`, `Not configured`, or `No verified data`.

The plan catalog and promotions are internal draft configuration. A scenario
calculator must label every result `Scenario only — not actual performance`.

## Authorization

Capabilities are:

- `analytics_viewer`
- `learner_analytics_viewer`
- `support_admin`
- `correction_admin`
- `subscription_admin`
- `account_recovery_admin`
- `advertiser_report_viewer`
- `role_admin`

The sole Super Admin implicitly has every capability. Other administrators need
an explicit active capability. Only the Super Admin may grant/revoke
capabilities or assign/remove the `admin` role. No operation may create another
Super Admin or modify the acting Super Admin’s own role/capabilities.

Exact email reveal, aggregate export, role/capability mutation, entitlement
mutation, recovery activity, support/correction decisions, discounts, and
website controls are audited.

## Account recovery limitation

Phase 3 implements case management and the identity-verification checklist.
Final Google identity transfer remains disabled unless a same-UUID identity
handoff is proven against the then-current official Supabase Admin API in
staging. Changing `auth.users.email` is not treated as a Google account transfer.

The public account text is:

> Contact Support. We respond within 24 hours.

The confirmation text is:

> This action transfers account access, subscription, progress, and history to
> the new email address. Confirm the student’s identity and ownership before
> continuing. This change must be recorded in the admin audit log.

## Retention and future rollups

No production analytics are automatically deleted in Phase 3. Raw events stay
separate from dashboard queries. Daily rollups are a documented future
optimization and must be reconciled to raw events before replacing live queries.
