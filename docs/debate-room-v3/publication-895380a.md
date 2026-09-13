# Public wording and Home update — 10 September 2026

Revision `895380afa2b6dbb8892e29a8c250d1923235fd00` is published at [Debate Room](https://duediligence.ph/debate-room/). [Release 34414273591](evidence/publication-34414273591.json) completed the application, public API and website publication. An independent review compared all 29 live asset hashes with the exact uploaded website archive and verified preservation of the captured production configuration. The four actual source-linked room asset URLs also passed. Access remains available to every signed-in paid or unpaid member; private event and role permissions remain enforced.

The application version is `3d7e3071-1066-4413-8c18-faedf006752a`; the public API version is `17c0abba-7698-4d57-8788-164a19e8ba20`. Production fingerprint: `0dccaf7273e00ae0686a05b35cd3cacae0e827b083edfabf9750b1b30961fb29`. No database migration was reapplied. Live media and the new sweeper remain disabled, media capacity stays zero, and invitation/results mail remains suppressed.

[Ordinary reload of the existing signed-in Chrome tab](evidence/live-browser-copy-895380a.json) loaded the revised Debate script, stylesheet and media script, each with the `debate-v3-20260910-2` version and HTTP 200 without disk or service-worker reuse. The empty lobby, create/cancel form and rules guide worked without creating production data. The network capture was truncated; the receipt makes only the listed asset observations. Home showed a separate Debate Room link beside Study Room and readable school/year labels. [Three additional source-linked Home assets](evidence/home-publication-895380a.json) matched exact Git source bytes through independent public requests.

The release removes internal terminology from application-authored error messages, roster-change notices and report text. It also repairs private-file requests that the deployed runtime could not construct. The isolated actual runtime passed 75 checks, including direct and multipart file journeys and 64 redirect cases. This is not proof of the hosted file path: that verification remains pending.

## Remaining verification

- The live desktop lobby is 1064px tall at a 1920×855 viewport and still requires outer scrolling. A follow-up is required. Previously reviewed active-match geometry does not cover this lobby finding.
- The complete 93-minute hosted rehearsal has not passed. The final controlled browser run lasted 90.416 seconds with accelerated periods.
- Real hosted file upload/download, physical audio/video, provider capacity, test inbox delivery and separate production paid/unpaid account journeys remain open.
- No production event, participant, upload, email or media connection was created for this release check.
- The whole-site audit remains in progress. No full acceptance state or original requirement-to-test mapping is upgraded by publication.

The prior `af963655` publication, its 44-second lobby observation and earlier failures retain their historical evidence. They are superseded only as the current published revision.
