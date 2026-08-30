# Due Diligence Pulse pilot

Status: local implementation and verification only. The production feature remains off until an explicitly approved release.

## What admins experience

Every approved administrator uses the same `Due Diligence Pulse` website and administrator role, with a device-appropriate installation:

### Android

1. Android asks the administrator to confirm installation of the downloaded APK.
2. The app opens `https://duediligence.ph/admin-pulse/` in a Trusted Web Activity.
3. The administrator taps **Continue with Google** and selects the Google email already registered as a Due Diligence administrator.
4. The administrator taps **Enable important notifications**. Android 13 and later asks once for notification permission.

### iPhone 13

1. The administrator opens `https://duediligence.ph/admin-pulse/` in Safari, taps **Share**, then **Add to Home Screen**.
2. The administrator opens **Due Diligence Pulse** from the new Home Screen icon.
3. The administrator taps **Continue with Google** and selects the Google email already registered as a Due Diligence administrator.
4. The administrator taps **Enable important notifications** and accepts the one iOS notification prompt.

An APK cannot be installed on an iPhone. The installed Home Screen web app supplies the equivalent app experience and standards-based Web Push on iOS 16.4 or later.

There is no app PIN, app-managed 2FA, biometric prompt, device approval, or per-device allowlist. The server still checks the existing administrator role invisibly before returning any data or registering a notification destination. A Google account may independently require a challenge under Google's own account policy; the app cannot and must not bypass that.

## Pilot signals

Only these five event types are eligible for push delivery and the chronological feed:

| Signal | Authoritative event | Dedupe boundary |
| --- | --- | --- |
| New subscriber | A user's first authoritative subscription activation | User identifier, once for the account's first activation |
| Home wall post | A new Home/Lex Forum post is committed | Post identifier |
| Support request | A support request is committed | Support-request identifier |
| User active now | A new usage session starts | Usage-session identifier |
| New sign-in | A sign-in event is committed | Existing session digest |

The live-users card is refreshed from recent usage heartbeats. It is a current-state display; heartbeats must not produce repeated push notifications.

## Owner sign-ins

Administrators do not need any of these service dashboards. They only sign in inside the app.

- [Due Diligence Pulse](https://duediligence.ph/admin-pulse/) — the admin sign-in location after release.
- [Supabase Google provider](https://supabase.com/dashboard/project/hbllomlijfznnuudpdvr/auth/providers) — confirm the existing Google provider remains enabled; the direct in-app Google selector exchanges an ID token with Supabase.
- [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) — confirm `https://duediligence.ph` is an authorized JavaScript origin for the existing public Web client ID. Add only the exact isolated staging origin used for the pilot test.
- [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/hbllomlijfznnuudpdvr/auth/url-configuration) — retain `https://duediligence.ph/admin-pulse/?auth=callback` for the non-iOS browser fallback; it is not the primary iPhone sign-in path.
- [Cloudflare dashboard](https://dash.cloudflare.com/login) — store the VAPID private key as an encrypted Worker secret and deploy the reviewed Worker only after approval.
- [Due Diligence repository](https://github.com/codingwally/Bar-Exam-simulator) — reviewed source, Actions, and the eventual APK release asset.

No Firebase project, Android OAuth client, Apple Developer Program membership, or native iOS build is required for this pilot. Google Identity Services uses the existing Supabase Google provider, while Android and iPhone use the same standards-based Web Push service.

## One-time owner preparation

1. Preserve one permanent release keystore for package `ph.duediligence.admin`. Keep the keystore and its passwords outside the repository and back them up securely.
2. Generate one VAPID key pair. Commit neither key. Configure the public key in the approved public runtime setting and store the private key only as `ADMIN_PULSE_VAPID_PRIVATE_KEY` in the Worker secret store. Configure `ADMIN_PULSE_VAPID_SUBJECT` with the approved Due Diligence contact URI.
3. Confirm the production and staging JavaScript origins in the existing Google Web client. Retain the exact Supabase redirect URLs only for the non-iOS browser fallback.
4. Apply the reviewed additive database migration to staging. Confirm the pilot feature remains disabled by default.
5. Deploy the reviewed Worker to staging, configure the staging VAPID secret, then enable the database pilot setting in staging only.
6. Deploy the isolated static Admin Pulse artifact to staging and verify Google sign-in, admin denial, feed refresh, push subscription, delivery retry, and stale-endpoint cleanup in both current Chrome on Android and the installed Home Screen app on iPhone.
7. Build the APK with the permanent keystore. Publish its exact SHA-256 certificate fingerprint in `/.well-known/assetlinks.json`, then verify the association from a physical Android phone using current Chrome.
8. After separate production approval, repeat database -> Worker -> static site -> Digital Asset Links -> APK hosting in that order.

## Release gates

Do not distribute the APK until all of the following are true:

- The APK is signed with the backed-up permanent key.
- The website route, manifest, service worker, and Digital Asset Links file return HTTPS 200 responses without redirects.
- The Digital Asset Links fingerprint matches the distributed APK exactly.
- The iPhone flow is installed from Safari to the Home Screen before notification permission is requested.
- A non-admin Google account receives no feed and cannot register a push destination.
- Each source event creates no more than one logical notification.
- Failed deliveries retry without blocking the source transaction; HTTP 404/410 endpoints are retired.
- Notification text contains only the minimum operational summary and never embeds credentials, tokens, support-message bodies, or payment evidence.
- The full existing Worker and Pages regression suites remain green.

## Recovery

Disable the database pilot setting first. That stops new Admin Pulse events and deliveries without affecting the website events that caused them. Restore the previous Worker and static artifacts if needed. Preserve the append-only event and delivery history for diagnosis; do not delete unrelated website or administrator records.
