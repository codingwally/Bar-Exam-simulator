# Phase 2: authentication, guest access, and premium user experience

## Scope

Phase 2 adds Google authentication, first-time onboarding, an account view,
native Support/Pricing/Terms/Privacy views, and an authoritative three-grade
guest preview. It preserves the existing static GitHub Pages architecture,
Cloudflare Gemini examiner, 0–5 ALAC rubric, question bank, timer, drafts,
history, corrections, and navigation.

The word “Premium” is used only as the name of a provisional future plan. No
payment, checkout, subscription enforcement, entitlement check, or coaching
booking is active.

## Runtime boundaries

- **GitHub Pages** serves the static application and public Supabase browser
  client. It contains only the public Supabase URL and publishable key.
- **Supabase Auth** owns Google OAuth sessions. The browser uses PKCE and an
  exact production callback.
- **Supabase Postgres** owns profiles, onboarding records, roles, and the
  authoritative guest quota. Browser roles have no direct access to guest
  counters or Support records.
- **Cloudflare Worker** verifies signed-in Supabase access tokens, hashes guest
  identifiers, reserves/finalizes/releases quota, calls Gemini, and stores
  Support requests. The service-role key and HMAC key remain encrypted Worker
  secrets.
- **Gemini** performs the existing grading operation. Phase 2 does not change
  its prompt, rubric, score scale, or deterministic caps.

## Guest quota

The configured limit is three successful grading results total across all
subjects. The database flow is:

1. Verify a Supabase Bearer token, or validate an opaque first-party device ID.
2. HMAC the device ID and a recovery signal made from Cloudflare's trusted IP
   plus a normalized browser user-agent.
3. Atomically reserve a grading slot using transaction advisory locks.
4. Call the existing question bank and Gemini only after reservation succeeds.
5. Finalize and increment the counter only after a schema-valid assessment.
6. Release the reservation after provider, validation, or Worker failure.

The browser stores the opaque device ID in both `localStorage` and a Secure,
SameSite=Lax first-party cookie. The database stores keyed hashes only. It does
not store raw IP addresses, raw user-agent strings, browser fingerprints,
answers, emails, credentials, or secrets in guest quota records.

The network-derived hash is used conservatively only when browser-local state
has disappeared and exactly one recent quota record matches. It does not impose
one shared quota on a household, school, office, or public network.

No unsigned technical measure can make guest-limit bypass impossible when a
person changes device, browser identity, network, or VPN. Requiring sign-in
before grading would be the stronger future control.

## Authentication and onboarding

The browser uses Supabase PKCE OAuth. It restores the Supabase session on load,
handles the OAuth callback in the same page, and signs out through Supabase.
Historical guest answers remain browser-local and are never uploaded after
sign-in.

First-time users accept `terms-beta-v1-2026-08-15` and
`privacy-beta-v1-2026-08-15`, then complete the approved profile fields through
the Phase 1 RPCs. The active product does not collect an email-marketing
preference and has no marketing sender; historical consent rows remain dormant
for audit only. The legacy consent RPC is an authenticated compatibility no-op,
so stale clients store no preference. Protected subscription, role,
administrative, and system fields are never directly updated by the browser.

Founder roles are not inferred from names or client claims. The first
super-admin bootstrap remains service-role-only and must be called exactly once
and serially after the verified founder Auth UUID exists. Other admin roles are
assigned only after their verified Google Auth UUIDs exist. The admin dashboard
is deferred.

## Provisional plan catalog

`assets/phase2-config.js` is the single browser configuration source:

- `early_access_beta`: PHP 149
- `standard`: PHP 249
- `premium`: PHP 499

All plans are preview-only and display “Planned pricing — subject to
finalization.” Future entitlement and coaching fields are placeholders only.

## Legal and privacy posture

The native Beta Terms and Privacy notice describe actual processing by Google,
Supabase, Cloudflare, and Gemini. They state that the product is educational,
not legal advice, and that AI grading can be inaccurate. They make no claim of
government affiliation, certification, guaranteed security, regulatory
compliance, or guaranteed Bar results. Both documents require independent legal
review before final public-policy approval.
