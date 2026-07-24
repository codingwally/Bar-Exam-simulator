# Labor Law closed-loop practice service

This production path keeps the Labor Law editorial corpus private. The browser calls
only the `labor-practice` Supabase Edge Function. That function reads the private Google
Sheet, caches its last valid response, calls OpenAI only to compare a student answer to
the selected curated record, and writes editorial feedback to a private queue.

```text
Browser → Supabase Edge Function → private Google Sheet (read-only)
                                   → OpenAI Responses API (concept comparison)
                                   → private Supabase cache / feedback queue
```

The browser must never receive a Google service-account credential, an OpenAI key, a
Supabase service-role key, or an unpublished answer key.

## Editorial spreadsheet contract

Use the private spreadsheet ID `1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A` with these tabs:

- **Q&A Bank** — the server-read canonical catalog. It must have every column declared
  in `supabase/functions/labor-practice/contracts.mjs`.
- **Feedback Log** — editorial team workspace; public submissions are persisted in
  `labor_feedback_log` until a deliberate reviewed export process is established.
- **Change Log** — records each approved canonical version and its reviewer.
- **Lists & Guide** — controlled vocabularies, editorial rules, and reviewer guidance.

Production exposes only rows where `Editorial Status` is `Approved` or `Published` and
`Publication Ready?` is `Yes`. `ENABLE_REVIEW_CONTENT_PREVIEW` must remain `false` in
production. A preview environment may set it to `true` to show clearly labelled `For
Review` rows. Incomplete records are rejected in every environment.

The adapter does not impose a fixed question count: it can safely serve the current
Labor Law set and future approved additions without a code redesign. This avoids a
conflict between the original 30-item Phase 1 template and the larger editorial bank.

## One-time secure configuration

1. Create a dedicated Google Cloud service account with the Google Sheets API enabled.
2. Share the **private** spreadsheet with that service account as Viewer. Do not publish
   it to the web, and do not add learner data to it.
3. Apply migrations and deploy the Edge Function to the Due Diligence Supabase project.
4. Set the following secrets only in the Supabase project; use `.env.example` as names,
   never as a place for real values:

   ```text
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   GOOGLE_SHEETS_SPREADSHEET_ID
   GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL
   GOOGLE_SHEETS_PRIVATE_KEY
   OPENAI_API_KEY
   OPENAI_EVALUATION_MODEL
   ENABLE_REVIEW_CONTENT_PREVIEW=false
   ALLOWED_ORIGINS=https://duediligence.ph,https://www.duediligence.ph
   ```

5. Deploy with a current Supabase CLI from a secure administrator machine:

   ```text
   supabase db push --project-ref hbllomlijfznnuudpdvr
   supabase secrets set --project-ref hbllomlijfznnuudpdvr --env-file .env.production
   supabase functions deploy labor-practice --project-ref hbllomlijfznnuudpdvr
   ```

The function’s CORS allow-list protects normal browser use, but CORS is not a substitute
for abuse protection. Before opening feedback at scale, enable a Cloudflare Turnstile or
equivalent server-verified challenge and add a rate-limit policy for the Edge endpoint.

## Evaluation and review guarantees

- The evaluator receives exactly one question’s approved answer, legal basis, doctrine,
  jurisprudence, and citation. Its instructions prohibit new legal authorities,
  quotations, facts, and doctrines.
- Four components are bounded and explicitly summed with `Number()`: issue recognition
  (20), governing rule (30), factual application (30), and conclusion (20).
- The model’s `Question ID` and `Version` must match the selected canonical record.
  Invalid JSON, an invalid total, or version mismatch yields no score.
- American English grammar guidance is returned separately with `affectedScore: false`.
- A failed source refresh uses the last valid server cache. If neither source nor cache
  is available, the user sees a safe no-score state and their local answer draft remains.
- Public feedback cannot change a canonical answer. A queue item can be marked closed
  only after it records both an applied canonical version and a Change Log ID.

## Verification before a release

```text
node scripts/validate-labor-cms.mjs --mode=template
node scripts/test-labor-cms.mjs
node scripts/test-labor-practice-contract.mjs
node scripts/test-labor-client-bootstrap.mjs
```

After secure configuration, manually verify these cases against a non-production
project: approved questions list, unpublished questions remain hidden, a stale cache
remains usable, a failed evaluator issues no score, a version mismatch is rejected, and
a feedback item reaches the private queue without exposing its contents publicly.
