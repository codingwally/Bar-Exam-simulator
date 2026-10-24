# Self-hosted Due Diligence brand fonts

The pilot ships two unmodified Latin WOFF2 binaries from the repository's existing general brand assets: Fraunces v38 and Inter v20. They are renamed fraunces.woff2 and inter.woff2 for the isolated service; their binary contents are unchanged. Both are variable fonts. The examination makes no runtime request to Google Fonts or a font CDN.

The manifest records each original filename, exact source URL, version, byte length, supported weights and SHA-256. Its retrieval record and the retained google-fonts-source.css.txt are original acquisition evidence from the existing repository assets, not a claim of a new download. The upstream CSS describes other subsets; only the two Latin binaries listed in this manifest are shipped in this pilot. Other glyphs use the browser's readable fallback.

Fraunces and Inter are distributed under SIL Open Font License 1.1. The complete unmodified Fraunces.OFL.txt and Inter.OFL.txt travel with the binaries. License source URLs are pinned to the Google Fonts repository commit recorded in the manifest. Font delivery failure is covered by the local browser readability review; hosted font delivery is not yet verified.
