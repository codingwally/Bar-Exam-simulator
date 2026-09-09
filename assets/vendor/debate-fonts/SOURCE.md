# Debate Room fonts

These are unmodified Google Fonts WOFF2 files for Fraunces and Inter, bundled so Debate Room typography loads from the same origin as the application. There is no runtime request to Google Fonts.

The acquisition request used the exact family, weight and display settings of the previous stylesheet import:

[Official Google Fonts CSS](https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap)

The original response is retained verbatim in `google-fonts-source.css.txt`. Its request user agent, retrieval time, source URL and SHA-256 are recorded in `manifest.json`. Each font entry records its exact versioned `fonts.gstatic.com` URL, byte length and SHA-256. The binaries have not been converted, subset again or edited.

`assets/debate-room.css` preserves all fourteen original normal-style declarations for Latin and Latin Extended, including their individual weights, `font-display: swap` and Unicode ranges. Only their source URLs change. Fraunces uses weights 400, 500 and 600; Inter uses 400, 500, 600 and 700. The four binary files are shared across their respective weight declarations because the official response supplies variable fonts. Unrequested scripts retain the existing system-font fallback.

Both families are redistributed under the SIL Open Font License 1.1. The full, unmodified official licenses are included:

- [Fraunces license source](https://raw.githubusercontent.com/google/fonts/0cf764bb712367b6079cbb4fd2353e6f54ec6850/ofl/fraunces/OFL.txt) → `Fraunces.OFL.txt`
- [Inter license source](https://raw.githubusercontent.com/google/fonts/0cf764bb712367b6079cbb4fd2353e6f54ec6850/ofl/inter/OFL.txt) → `Inter.OFL.txt`

The license URLs are fixed to the Google Fonts repository commit `0cf764bb712367b6079cbb4fd2353e6f54ec6850`. Font source hashes and license hashes are separate in the manifest.

Local acquisition checks verified the `wOF2` signature and WOFF2 header length against the actual bytes. The existing `@pdf-lib/fontkit` dependency decoded all four files, confirmed the Fraunces/Inter family names and their weight axes, and confirmed coverage of the requested weights. Runtime CSS contains no external import or font URL. Hosted font loading and visual layout still require CI verification; the manifest does not claim they have passed.

Ship the font binaries and both OFL license files together. Include this source note, the source CSS text and manifest in the same directory for review and reproducibility.
