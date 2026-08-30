# Due Diligence Pulse Android TWA

This directory contains the Android wrapper for the restricted Due Diligence Pulse surface.

iPhone 13 and other supported iPhones use the same admin PWA through Safari's **Add to Home Screen** flow. No native iOS/Xcode build is required by this Android project.

## Fixed identity

- Android package: `ph.duediligence.admin`
- App name: `Due Diligence Pulse`
- Launch URL: `https://duediligence.ph/admin-pulse/`
- Bubblewrap: `1.25.0`
- Compile SDK / target SDK: Android API 36
- Notification delegation: enabled

The wrapper is a Trusted Web Activity. It does not contain or duplicate the web application. The site must be served over HTTPS and must publish a matching Digital Asset Links file before Chrome will remove browser chrome.

## Lightweight setup

Android Studio and the Android emulator are intentionally not required. Use the existing Node/npm installation and let pinned Bubblewrap download its supported JDK 17 and Android command-line SDK into the user-level `.bubblewrap` directory.

```powershell
npm ci
npm run twa:update
npm run check
npm run twa:doctor
```

The generated project uses its checked-in Gradle wrapper; do not install Gradle globally.

The Gradle profile is deliberately capped at a 768 MB heap with one worker and no persistent daemon. Bubblewrap 1.25.0 currently bootstraps a 32-bit JDK on this Windows host, so the upstream 1536 MB default can exhaust its address space even when physical RAM is available.

## Unsigned pilot build

This build is for compilation evidence only. It skips live PWA validation because the route may not yet be deployed and it does not create or use a signing identity.

```powershell
npm run build:unsigned
npm run verify:unsigned
```

Expected unsigned artifacts:

- `app-release-unsigned-aligned.apk`
- `app-release-bundle.aab`

These files are ignored by Git.

## Permanent release signing

Create the permanent release keystore once, store it outside this repository, back it up securely, and retain the same key for every update to `ph.duediligence.admin`. Losing it prevents normal updates to the installed application.

Set the required values only in the current PowerShell process or an approved secret manager. Do not save real passwords in `.env.signing.example`, source files, shell history, tickets, or chat.

```powershell
$env:TWA_SIGNING_KEY_PATH = 'C:\secure\duediligence-admin-pulse-release.jks'
$env:TWA_SIGNING_KEY_ALIAS = 'duediligence-admin-pulse'
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '<from secret manager>'
$env:BUBBLEWRAP_KEY_PASSWORD = '<from secret manager>'
npm run build:release
```

The release script refuses a keystore stored inside the repository and requires the live start URL plus the admin-specific web manifest to return HTTP 200 before signing. Digital Asset Links is intentionally not a first-build prerequisite: the permanent signing certificate does not exist until the first signed APK is produced.

Expected signed artifacts:

- `app-release-signed.apk`
- `app-release-bundle.aab`

## Digital Asset Links handoff

After the first permanent-key release build:

```powershell
npm run assetlinks
```

This verifies the signed APK, prints its release certificate SHA-256 fingerprint, and creates ignored `assetlinks.generated.json`. Review it, then copy its exact content to the website-owned `/.well-known/assetlinks.json` template in the frontend change. Never use a debug or temporary certificate fingerprint for production. The required order for the first release is: build with the permanent key, generate the fingerprint, publish Asset Links, then run the full live check.

Run `npm run check:live` after the route and asset-links file are deployed. No deployment is performed from this directory.
