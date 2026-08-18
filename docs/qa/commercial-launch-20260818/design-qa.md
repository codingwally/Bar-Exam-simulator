# Commercial Launch Design QA — 2026-08-18

## Scope

This review covers the commercial-launch sign-in experience and the owner-supplied BPI InstaPay QR used for the ₱149 Early Access offer. The current Due Diligence navy, gold, alabaster, Fraunces, and Inter design system remains controlling.

## Source evidence

- Owner-supplied QR source: `C:\Users\wally\AppData\Local\Temp\codex-clipboard-d28cb4b3-2a1a-427d-a780-68e690d021b3.png`
- Repository asset: `assets/payments/bpi-instapay-149.png`
- Source and repository asset dimensions: 1290 × 1471 pixels.
- Source and repository asset size: 432,000 bytes.
- Source and repository asset SHA-256: `599DED503B037139002F6A4BCF1B3EF9B8013F9E0254C02E8F86AFEA2D3F1F7B`.
- Result: byte-for-byte identity confirmed; the payment artwork was not recreated, retouched, or approximated.

## Staging evidence

- Google-only sign-in at 1280 × 720: `docs/qa/commercial-launch-20260818/staging-google-signin-1280x720.png`
- Served BPI QR at 1280 × 720: `docs/qa/commercial-launch-20260818/staging-bpi-qr-1280x720.png`
- Staging Worker version: `fb5d7ab8-9b85-452a-9cc1-2c08b9972e78`.

## Comparison and corrections

1. The staged sign-in modal preserves the approved split image/form composition, coaching photograph, crest, navy/gold palette, serif display typography, Google-only action, visible close control, and lower-right Back action.
2. The staged QR is the exact supplied BPI artwork and remains fully legible against a neutral background.
3. Initial markup declared 1218 × 1468 while the source is 1290 × 1471. That mismatch could have introduced subtle stretching. The intrinsic HTML dimensions were corrected to 1290 × 1471; responsive CSS continues to scale proportionally.
4. No new framework, public route, decorative style language, payment account detail, or alternate QR was introduced.

## Accessibility and responsive checks

- Controls use native buttons/links with visible focus treatment from the existing design system.
- The sign-in modal provides keyboard-operable Close, Continue with Google, Terms, Privacy, and Back controls.
- The QR image includes descriptive alternative text identifying it as the BPI InstaPay payment QR for the ₱149 Early Access offer.
- Existing reduced-motion and responsive rules remain in force.
- Automated contract, responsive, accessibility, Pages-artifact, and staging checks are part of the release gate; production is blocked if a required gate fails.

## Decision history

- Selected: exact owner-supplied QR; no generated or approximated payment asset.
- Selected: existing Due Diligence split sign-in pattern translated into the static application.
- Rejected: redesigning the site or introducing React/Next/Tailwind.
- Corrected: QR intrinsic-size mismatch before release.

## Status

Visual staging review passes for the captured states. Final production acceptance still depends on all automated staging, security, data-integrity, and deployment gates passing.
