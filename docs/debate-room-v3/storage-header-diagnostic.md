# Read-only staging Storage header comparison

This diagnostic is a separate `storage-headers` operation in the existing
`Debate V3 restricted staging` workflow. It runs on the exact current main commit
inside the existing `staging-e2e` environment and shares the staging concurrency
lock. It uses the existing `STAGING_SUPABASE_SERVICE_ROLE_KEY` secret only.

After this patch is reviewed and merged, the coordinator can invoke:

```sh
gh workflow run debate-v3-staging.yml --repo codingwally/Bar-Exam-simulator --ref main -f operation=storage-headers -f candidate_sha=<exact-current-main-40-character-SHA>
```

The diagnostic makes two sequential GET requests to the fixed
`hlzqmreeoghbldnhlybr` project's `debate-private-v3` bucket: first with `apikey`
only, then with the same key duplicated as a Bearer token. It follows no
redirects, performs no retries and bounds each request to 15 seconds. No accounts,
files, database rows, configuration, email or deployments are created or changed.

The artifact `debate-v3-storage-headers-<candidate SHA>` contains only
`storage-headers.json`: source hashes, timestamps, fixed scope, HTTP statuses,
allowlisted provider error codes and fixed diagnostic classifications. Provider
messages, bodies, metadata, request/response headers and credentials are not
recorded. Unknown error codes are omitted. A completed capture is not a feature
acceptance result; HTTP denials are diagnostic evidence rather than a failed
capture. Transport failures retain the partial comparison and fail the job.

`BOTH_HTTP_200` disproves a duplicated-header-only bucket rejection for that CI
key at that time. `DUPLICATED_HEADER_HTTP_AUTH_DENIAL_ONLY` supports a header
compatibility difference. Neither proves the Worker uses that exact key or
identifies an object-write failure. Worker-secret parity, the Worker execution
environment and actual uploads/downloads remain outside this diagnostic.

Modern-key guidance recommends `apikey`; the current SDK also retains a Storage
Bearer fallback, and the documented gateway can translate that fallback. This
comparison resolves the observed staging behavior without assuming the outcome.
Sources: [API keys](https://supabase.com/docs/guides/getting-started/api-keys#known-limitations),
[SDK transport](https://github.com/supabase/supabase-js/blob/master/packages/core/supabase-js/src/SupabaseClient.ts),
[gateway translation](https://supabase.com/docs/guides/self-hosting/self-hosted-envoy#opaque-key-translation).
