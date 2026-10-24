# Professor entry publication

This release changes the current public Professor door to open the isolated
professor dashboard. Students are told to use the unique examination link their
professor shares. The public entry does not read or forward the main site's
session, credentials, student identity, or a room key.

The destination is
`https://duediligence-constitutional-exam.wallyesteban1993.workers.dev/admin/exams`.
An anonymous visitor must reach the private professor sign-in page. Publication
fails if that destination is unavailable or exposes an anonymous session.

## Preserve the actual deployed site

At preparation, the canonical release marker and the public assets matched
`8ed2a21d3fa33d065fdf1c3f69f631210ca08e25`. Current main has additional changes;
publishing its complete artifact would change unrelated product behavior.

The candidate therefore starts from that exact live commit. The release script
copies only the reviewed current entry spans from `assets/phase2-experience.js`
into the pinned live module, then updates its document/script references and
cache version. The JSON manifest pins the old and new SHA-256 of all three files
and the reviewed entry spans. The existing selected-attempt result repair stays
unchanged. The separately reviewed navigation fix in main stays in main source;
it is not silently added to this live overlay.

Only these public bytes may differ:

- `assets/phase2-experience.js`
- `index.html`
- `service-worker.js`
- `.well-known/duediligence-release.txt` (the exact reviewed source commit)

The complete file list must remain identical. Every other text and binary file
must match both the pinned baseline artifact and the canonical live site.
`exam-pilot/` and private reader assets are excluded. No main backend, database,
retired runtime, existing release workflow pins, or DNS route is changed.

## Review and preview

`publish-professor-entry.yml` runs focused guards on pull requests. The existing
mandatory pull-request workflow also runs the new adversarial release tests and
the current entry behavior test. Its historical entry test no longer reads
retired runtime/migration files or requires the retired student lobby.

After successful mandatory validation, the owner may dispatch the new workflow
with `operation=preview`, the exact open PR head SHA, and that successful
mandatory validation run ID. This operation accepts only the owner's same-repo
PR targeting main with the exact validated tree and approved file scope. It
builds two separate checkouts of the pinned live source, derives the three-file
candidate, runs existing result/submission regressions against it, and compares
every baseline file with the live site before uploading anything.

The preview is a new static-only Worker:
`https://duediligence-professor-entry-preview.wallyesteban1993.workers.dev/index.html#examination-room`.
It is public and contains the same already-public website assets. It has no
Worker script, routes, data bindings, credentials, or exam papers. The fixed
Worker name is checked, and a read-only
[Workers subdomain request](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/)
must confirm the account owns `wallyesteban1993` before deployment. The existing
asset-recovery preview is not modified. Cloudflare's existing account token and account ID repository secrets
are required for this operation. The CLI version is pinned to Wrangler 4.152.0;
its static asset fields follow the
[official configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/#assets).

Check the actual preview at desktop and mobile widths and open the Professor
door. Its only destination should be the private new dashboard. The Student
entry should give clear instructions without linking to a retired lobby.

## Publication

Publication is a separate owner dispatch, never an automatic effect of pushing
or merging. First merge the reviewed PR only after the isolated professor app
is ready. Run `operation=preview` again on the exact resulting main SHA with the
successful mandatory PR run ID. A merge/squash changes the source SHA and release
marker even when its tree matches the validated PR; the earlier head-SHA
preview is deliberately insufficient.

Then dispatch `operation=publish`, the same exact main SHA and validation run
ID, with `confirm_production=true`. The release script requires:

- Owner-triggered execution on current main, a merged same-repo PR and successful
  mandatory validation covering the exact merged tree.
- A PR containing only the explicitly listed entry/release/test files.
- The same complete pinned live baseline and only the three manifest-approved
  changed assets plus marker.
- Every staged file's exact bytes, including the merged source marker, and a
  working private professor sign-in destination.

The publisher uploads only the separate candidate artifact, under the existing
Pages environment and release concurrency lock. It then verifies every public
file against the candidate. A failed preflight stops before Pages publication.
A failed postflight is a failed release and must be investigated; it must not be
reported as successful merely because the Pages upload completed.

## Rollback evidence and limits

Every successful preparation stores the complete verified live baseline as
`professor-entry-rollback-8ed2a21` for 90 days, alongside the candidate and full
hash evidence. Keep that artifact and its baseline marker as the rollback
checkpoint. Restoring the exact artifact restores website bytes only; it does
not change the isolated exam service or any student records. This workflow does
not automatically roll back or alter existing release workflows.

The local and CI guard tests use synthetic fixtures and mocked GitHub/network
responses. They prove fail-closed scope and provenance behavior; the full public
baseline/preview/postflight checks and actual browser entry click provide the
separate deployment evidence. This document does not claim publication has
occurred. If live files or the baseline marker have changed since preparation,
the publisher stops instead of accepting a new baseline automatically.
