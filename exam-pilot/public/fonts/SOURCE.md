# Self-hosted Due Diligence brand fonts

The pilot ships two unmodified Latin WOFF2 binaries from the repository's existing general brand assets: Fraunces v38 and Inter v20. They are renamed fraunces.woff2 and inter.woff2 for the isolated service; their binary contents are unchanged. Both are variable fonts. The examination makes no runtime request to Google Fonts or a font CDN.

The manifest records each original filename, exact source URL, version, byte length, supported weights and SHA-256. Its retrieval record and the retained google-fonts-source.css.txt are original acquisition evidence from the existing repository assets, not a claim of a new download. The upstream CSS describes other subsets; only the two Latin binaries listed in this manifest are shipped in this pilot. Other glyphs use the browser's readable fallback.

Fraunces and Inter are distributed under SIL Open Font License 1.1. The complete unmodified Fraunces.OFL.txt and Inter.OFL.txt travel with the binaries. License source URLs are pinned to the Google Fonts repository commit recorded in the manifest. Font delivery failure is covered by the local browser readability review; hosted font delivery is not yet verified.

The PDF exporter also ships static TrueType instances `inter-pdf.ttf` (weight 400)
and `fraunces-pdf.ttf` (weight 500), generated from these same WOFF2 sources with
FontTools 4.67.0. Other variation axes are held at their source defaults. These
retain the same typeface design and OFL notices. The static format avoids PDF
reader incompatibilities with variable WOFF2 embedding. Regenerate them only
with `test/create-pdf-fonts.py`; deployment does not require Python. Characters
outside the Latin subsets use the browser's font fallback, rendered within the
PDF, and the exact complete UTF-8 record is retained as an embedded attachment.
