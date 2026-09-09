# Hosted Debate entry: source review, 2026-09-09

**Source review only. No live browser, deployed endpoint, Auth exchange, database mutation, provider call or deployment was executed for this review.** No concrete entry-path source defect was found. This document does not establish a passing hosted journey or full product acceptance.

The inspected runtime matched Git HEAD `3597b221f1f39bbac8c257fd99ea8b9fd215cbe7`. `git diff --name-only HEAD -- <reviewed runtime paths>` returned no differences. The identifiers below are Git blob SHA-1 values from `git ls-files -s`; they are not deployment IDs or SHA-256 artifact digests. Line numbers refer to these exact blobs.

| Path | Relevant lines | Git blob |
| --- | --- | --- |
| `worker/commercial-entry.mjs` | 576–603 | `8e6a30363f08d12b9b83b8c8476fcde7f14e80b9` |
| `worker/index.mjs` | 320–384, 755–802, 4458–4543, 5400–5443, 10473–10516 | `8871f1eb3600a9a58df2c60e15ade6cf4c523063` |
| `worker/debate-integration.mjs` | 21–38, 55–111 | `702d13ebc7fb1a14340aeed77c61a07a867abf84` |
| `worker/debate-routes.mjs` | 20–52 | `8c50712fce24d6e7862cbea944c4b74ae871f6b6` |
| `worker/debate-store.mjs` | 6–32 | `bcb7f5a316f0ef8b039a430c07664027b2cd1f8f` |
| `worker/debate-service.mjs` | 308–326, 970–1010, 1165–1172 | `f8457c10a3e75ba656269e33dff7bc819d036c42` |
| `supabase/migrations/20260909080139_debate_room_v3.sql` | 7–104, 124–274, 364–373 | `a580b104e73caf0500adec52a31ae2796b11aecf` |
| `worker/wrangler.staging.toml` | 1–13, 61–74 | `fe89861ae91050b93ce9db5b1c56512615c74d83` |
| `scripts/build-pages-artifact.mjs` | 111–116, 138–145, 513–514 | `76978b2ea99624e51145f8e918b90cd002b859d0` |
| `scripts/build-staging-artifact.mjs` | 15–28, 53–85 | `5bca8a307926340feee25b515c1cfb364628b79d` |
| `debate-room/index.html` | 4–7, 52–56 | `2d7fc04070c2e7832ca8093bb0a94801c8fe1401` |
| `assets/debate-room.js` | 10–13, 39–50, 97–102, 325–350 | `22ecc84deb4ea7f46662333e7710628e1b4285ad` |
| `assets/debate-entry.js` | 3–30 | `4f85264f650274c41d28b0108fa292a2d35ac9c0` |
| `assets/auth-session-storage.js` | 14–20, 72–82 | `157b930bd8dcee877fd952e3c7e33966a5acedd1` |
| `assets/phase2-config.js` | 4–13 | `9b4e8b7c976d48cebe6da09201fcbc2bb204077f` |
| `assets/phase2-experience.js` | 191–218, 3594–3638 | `e0d205340526feec59eb913cd7dac445cfef6c4d` |
| `index.html` | 1048, 1108, 5059–5071 | `7bab02c5590eeb78a54b285965ef772e246fb2b2` |
| `service-worker.js` | 58–85 | `f20d16489c1c6a50959ebc8d94711481b44d9b29` |

## Entry and routing findings

The commercial wrapper delegates nonpayment traffic to the core Worker. The staging asset configuration specifies a directory without `run_worker_first` or an SPA fallback. The builder emits `debate-room/index.html` and no files at the Debate API paths. This agrees with Cloudflare's documented [asset-first routing](https://developers.cloudflare.com/workers/static-assets/): matching files are served statically and unmatched requests reach the Worker. The exact hosted routing and MIME headers still require an actual request.

The builder explicitly emits browser `.js` copies of the domain and sanctions modules and rewrites their relative import. The standalone HTML loads the local Supabase UMD file, then configuration and shared session storage, before the Debate module. The staging builder replaces the backend, project, publishable key and OAuth return origin, and rejects remaining production backend identifiers. Inspecting source markers is not proof of uploaded asset bytes.

The real boot uses Supabase `getSession()` and `onAuthStateChange()` with PKCE and the same persistent project-key storage helper as the main page. The synthetic browser path requires both localhost and `DEBATE_LOCAL_REHEARSAL === true`; it is not a hosted fallback. The main-page return handler accepts only a fresh same-origin `/debate-room/` path after an authenticated callback. A storage-seeded fixture session does not test Google OAuth or its callback.

The browser sends Bearer authorization, uses JSON for commands and omits cookies in its general request helper. The core Worker's narrow GET exception supports ordinary same-origin browser fetches with no `Origin`: it requires an enumerated read path, matching URL origin, `Sec-Fetch-Site: same-origin` and no conflicting supplied referrer. POST and OPTIONS still require the exact configured Origin. Identity verification then calls the configured Supabase Auth service before the server-side preview allowlist and service-role RPC adapter. This branch does not query billing or activate introductory access.

The store's named RPC parameters and JSON return handling match the new migration's read/list/commit contracts. A hosted browser command must still demonstrate that those pieces work together on the deployed version. With the reviewed media capacity at zero, media admission intentionally fails before provider entry.

Neither the examined Debate HTML nor these static-artifact build sources adds a Content-Security-Policy header or meta policy. The local harness's response policy is not evidence of live CSP. The service worker does not intercept requests containing Authorization and uses network navigation for the standalone page; it does not create an authenticated API cache.

## Hosted journey and cleanup implications

A bounded real-browser check should load the actual standalone page and vendor/module dependencies; verify response MIME types and absence of unexpected page errors; restore a genuine authorized fixture session; read events and discovery; create a draft rehearsal event; update it through the UI; reload and verify its saved revision; and prove an excluded account is denied. Exact deployed asset/version evidence and cleanup belong to that run, not this source review.

**Discovery GET is not database-write-free.** `loadEvents()` invokes discovery automatically; `service.discover()` increments the owned fixture's `debate_v3_rate_limits` rows under action `discover_events`. A browser boot therefore needs scoped data cleanup even before an event is created. Existing Auth-only fixture cleanup intentionally rejects outstanding Debate rows.

No `delete_event` RPC exists in the examined migration or runtime. The migration grants service-role DELETE on `debate_v3_audit`, while denying UPDATE and TRUNCATE. Its retention cleanup deletes older audit records only under the configured retention conditions; it is not an immediate fixture-event deletion API. An authorized cleanup must bind exact synthetic run identities, event IDs, revisions, state and expected child rows, reconcile discovery rate-limit rows, and verify absence before Auth cleanup. Any unexpected member, match, job, upload, receipt or revision must stop that cleanup. No cleanup implementation or execution is supplied by this review.
