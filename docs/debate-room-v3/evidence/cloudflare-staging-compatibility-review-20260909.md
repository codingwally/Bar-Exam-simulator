# Cloudflare staging metadata compatibility review — 2026-09-09

This is a read-only compatibility review and capture correction. It does not authorize or record a deployment. The existing release validator still rejects the captured placement and additional observability fields.

## Actual evidence

CI run `34347380898` captured active Worker version `b134ccc7-0c7f-4d00-89e0-d7314e0f1dd9` at 100% traffic for `duediligence-examinations-staging`. The original artifact is `artifacts/debate-local-rehearsal/staging-capture-34347380898/baseline.json`, schema 1, fingerprint `44965b039164bd173a5768b354d5703e2f9d97f2fad8ecebd66be2a841383544`. It records placement `{ "mode": "targeted", "target": [10] }`, cache `null`, and the observability values below.

The reviewed base `worker/wrangler.staging.toml` specifies placement region `gcp:us-east4` and has no `[cache]` section. The old capture read `settings.cache.enabled`, which is not the documented global field. Therefore its `null` did not prove caching disabled.

## Corrected capture

The capture now reads documented `settings.cache_options`, including the independent `cross_version_cache` preference, plus each named entrypoint's cache override. A default entrypoint override takes precedence over the global enabled flag; every source is retained separately for conflict review. Missing flags remain unknown. See the [official settings response](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/).

One additional GET reads only the fixed existing service. The same endpoint is used by [locked Wrangler deployment code](https://github.com/cloudflare/workers-sdk/blob/16b3d5a48005c7d92112470119ba96019071e59e/packages/deploy-helpers/src/deploy/deploy.ts). Only its default environment name and whitelisted script placement/cache/export metadata survive sanitization. Runtime field names and the same relevant runtime metadata are retained; raw service objects, author details, binding values and unknown nested values are not copied. Unknown field names remain visible for review. There is no environment follow-up request, resource listing, secret read, or provider mutation.

The resulting baseline is schema 2. Its `state.captureSources` schema 1 is part of the canonical state fingerprint. An old snapshot hash cannot approve the richer snapshot. This change requires a new real capture; the passing mocked-response tests do not supply remote metadata.

## Placement remains unresolved

The observed numeric target `10` is preserved verbatim. No verified source maps it to `gcp:us-east4`. Wrangler's [exact placement parser](https://github.com/cloudflare/workers-sdk/blob/16b3d5a48005c7d92112470119ba96019071e59e/packages/deploy-helpers/src/deploy/helpers/placement.ts) sends `{ mode: "targeted", region: "gcp:us-east4" }` for that TOML setting; it contains no numeric target mapping. Cloudflare's [placement documentation](https://developers.cloudflare.com/workers/configuration/placement/) describes provider-region inputs and dynamic placement. It does not establish numeric equivalence. The new service metadata may resolve the difference; until reviewed, the gate must remain closed.

## Observability can be represented without upgrading Wrangler

The actual values require this complete configuration if subsequent deployment review approves preservation:

```toml
[observability]
enabled = true
head_sampling_rate = 1
redact_query_string = false

[observability.logs]
enabled = true
head_sampling_rate = 1
persist = true
invocation_logs = true

[observability.traces]
enabled = false
head_sampling_rate = 1
persist = true
```

Locked Wrangler `4.114.0` accepts the sampling, persistence, logs and traces fields. Its [validation source](https://github.com/cloudflare/workers-sdk/blob/16b3d5a48005c7d92112470119ba96019071e59e/packages/workers-utils/src/config/validation.ts) does not list `redact_query_string`; that extra key produces a warning. The [inheritance helper](https://github.com/cloudflare/workers-sdk/blob/16b3d5a48005c7d92112470119ba96019071e59e/packages/workers-utils/src/config/validation-helpers.ts) retains the original object. The [upload builder](https://github.com/cloudflare/workers-sdk/blob/16b3d5a48005c7d92112470119ba96019071e59e/packages/deploy-helpers/src/deploy/helpers/create-worker-upload-form.ts) passes the observability object through, and the deployment code also passes it to the separate nonversioned script-settings update. This supports explicit preservation, with an expected warning; it is not evidence that an actual upload has preserved the values.

The official `wrangler@4.114.0` tag resolves to immutable commit `16b3d5a48005c7d92112470119ba96019071e59e`. The installed package was inspected without installation or upgrade. SHA-256: `wrangler-dist/cli.js` = `386ce186b5a2583dadd20dd9ca1221d3dbcbbf24c020244bd447e337c8099159`; `config-schema.json` = `744875c9cc85d878a434f95423fb70fe4713b6a920ebba41623f8b6527a8788b`.

## Verification and next release work

All 16 focused release tests pass locally, including the expanded GET-only capture, secret omission, numeric-target retention, explicit cache override precedence, unknown cache state and snapshot hashing. A lightweight extraction of the installed inheritance and placement functions confirmed the two behaviors described above. That check did not invoke Wrangler CLI, bundle code, call Cloudflare, or deploy.

The next real capture must establish placement and cache settings. A subsequent reviewed overlay must preserve all observed settings, including cache preference/overrides and observability. Run the exact locked Wrangler configuration through isolated CI and inspect its generated metadata before authorizing a deployment. After any authorized deployment, obtain fresh actual metadata and compare preservation. No broader product acceptance, media rehearsal, public launch, or production result follows from this review.
