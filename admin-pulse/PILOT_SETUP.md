# Due Diligence Pulse pilot setup

This route is a read-only administrator pilot. The backend remains disabled by default and must confirm the signed-in user's current administrator role for every request.

Before building the release APK:

1. Create and safely preserve the permanent Android release-signing keystore for package `ph.duediligence.admin`.
2. Replace the placeholder in `/.well-known/assetlinks.json` with the uppercase, colon-delimited SHA-256 fingerprint of that release signing certificate.
3. Serve `/.well-known/assetlinks.json` at exactly `https://duediligence.ph/.well-known/assetlinks.json` over HTTPS, without a redirect, and with `Content-Type: application/json`.
4. In the existing Google Web OAuth client `601805240028-vgnu9dv3egpm7n6musiveujfp3c9vs5q.apps.googleusercontent.com`, keep `https://duediligence.ph` as an authorized JavaScript origin. Add the exact staging origin only while testing Google Identity Services there.
5. Keep `https://duediligence.ph/admin-pulse/?auth=callback` in the Supabase Auth redirect allowlist for the non-iOS browser fallback. For staging fallback tests, also allow `https://duediligence-examinations-staging.wallyesteban1993.workers.dev/admin-pulse/?auth=callback`.
6. Keep the server-side Administrator Pulse and Web Push flags off until the database, Worker routes, VAPID secrets, and named-admin staging tests are ready.

The browser-facing app contains only the public Google Web client ID, Supabase publishable key, and VAPID public key. The VAPID private key, Supabase service-role key, Android keystore, and keystore passwords must never be placed in this directory or the APK. Pulse does not copy Supabase access or refresh tokens into cookies.

## iPhone Home Screen pilot

An iPhone does not need an IPA, App Store listing, Apple Developer account, or APNs certificate for this standards-based Web Push pilot. On iOS 16.4 or later:

1. Open `https://duediligence.ph/admin-pulse/` in Safari.
2. Tap **Share**, choose **Add to Home Screen**, and confirm.
3. Open **DD Pulse** from the Home Screen.
4. Select the existing Due Diligence administrator Google email in the direct Google popup.
5. Tap **Enable important notifications** and allow the iOS notification prompt.

Google Identity Services returns an ID token to the installed Home Screen app, which Supabase verifies with a fresh raw/hashed nonce. This avoids depending on a Safari OAuth redirect session or copying credentials between Safari and the installed app. If Google Identity Services is blocked on iPhone, Pulse asks the administrator to reload or disable content blocking; the redirect fallback is intentionally offered only outside iOS.

Web Push is available to installed Home Screen web apps on supported iOS versions. Permission must be requested from the explicit button inside the installed app. The Worker sender must support ordinary W3C Web Push endpoints, including Apple endpoints under `*.push.apple.com`; no Apple-specific client secret belongs in this repository.
