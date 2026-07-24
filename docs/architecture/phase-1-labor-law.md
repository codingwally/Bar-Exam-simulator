# Phase 1 architecture review — Labor Law

## Current system

Due Diligence is a static GitHub Pages application. Its visual UI, legacy question
bank, timers, answer draft state, and score display live in one `index.html` file.
The pre-existing essay evaluator is a client-side heuristic based on structure and
keywords. It is retained for legacy subjects to avoid a breaking change, but it is not
legally reliable and is not used for curated Labor Law items.

The repository already contains an additive Supabase schema for a future curated corpus.
Phase 1 treats the private editorial Google Sheet as the operational source of truth
because it is maintainable by the legal editorial team without code changes.

## Target architecture

```text
Student browser
  └─ public Labor endpoint (no secret keys)
       └─ Supabase Edge Function
            ├─ private Google Sheet: Q&A Bank
            ├─ private Supabase cache: last validated catalog
            ├─ OpenAI Responses API: constrained concept comparison only
            └─ private Supabase feedback queue
```

The `contracts.mjs` module is the shared gate for the spreadsheet record shape and
evaluator response. It rejects incomplete, duplicate, unapproved, or non-HTTPS records.
Production serves only `Approved`/`Published` records explicitly marked
`Publication Ready? = Yes`. The preview flag is server-only and defaults to false.

## OpenAI migration

The old GitHub Pages deployment contained a redundant Gemini-secret injection step even
though the current static page does not have a safe server-side Gemini pipeline. That
step has been removed. The Labor service uses OpenAI only from the Edge Function, where
the API key is stored as a Supabase secret.

The provider call is isolated in `evaluateWithOpenAI`. To replace it later, preserve the
input record and output contract, then implement a provider adapter that produces the
same strictly validated response. No client component depends on an OpenAI API shape.

## Legal-accuracy safeguards

- The evaluator sees the selected approved record only; it is instructed not to add law.
- It scores conceptual coverage, not matching phrases, answer length, or grammar.
- Components are explicitly bounded and numerically summed: 20/30/30/20.
- Question ID and canonical version are verified before a score can appear.
- Grammar is a separate American English review with `affectedScore: false`.
- Invalid AI output, missing Sheet configuration, or a failed source refresh yields no
  score. Drafts are retained locally; there is no heuristic fallback.
- Community feedback is private and cannot alter a published answer without a reviewer,
  a new canonical version, and a Change Log reference.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Google Sheet service account is not yet shared to the private Sheet | The app shows a safe configuration state; setup steps are documented. |
| Editorial rows may be incomplete or unpublished | The server excludes them before they reach learners. |
| Model output is malformed or contradicts record version | Strict JSON/schema and contract validation reject it with no score. |
| Public feedback endpoint can attract abuse | No canonical data can be changed. Add server-verified Turnstile and rate limiting before broad launch. |
| Legacy evaluator remains weak for other subjects | Labor does not call it. Future subjects should migrate one curated corpus at a time. |
| The current static monolith is hard to evolve | The new feature is modular external CSS/JS and server code, avoiding a high-risk rewrite. |

## Implementation roadmap

1. **Complete secure configuration:** share the Sheet with its service account, apply the
   migration, set Edge Function secrets, and deploy the function in a non-production
   Supabase project.
2. **Editorial release:** validate the approved Labor rows against primary sources, mark
   publication readiness, and verify exact Question ID/version discipline.
3. **Controlled launch:** enable the production endpoint with preview disabled; run the
   documented manual acceptance cases and monitor feedback queue quality.
4. **Scale deliberately:** import the reviewed Sheet into the structured Supabase corpus
   if reporting/search needs exceed Sheets, without changing the client contract.
5. **Migrate other subjects:** repeat the same review, source validation, test fixtures,
   and release gates rather than copying the legacy evaluator.
