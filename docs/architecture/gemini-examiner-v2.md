# Gemini Per-Question Examiner

## Decision

The static GitHub Pages frontend calls the existing Cloudflare Worker at
`https://duediligence-gemini-examiner.wallyesteban1993.workers.dev`. Only the
Worker can access `GEMINI_API_KEY`; the frontend and Pages workflow never
receive it.

The examiner uses the Supreme Court-inspired qualitative scale from 0.0 to 5.0
in 0.5 increments. Each result is an independent assessment worth at most five
percentage points. Results are not combined, averaged, converted to a 100-point
score, or presented as an official/predicted Bar grade.

## Trust boundary

1. The browser sends a question reference, the student's answer, and the
   minimum current question context.
2. For `LAB-###` items, the Worker independently loads the published question
   bank and gives the server-resolved record priority.
3. Other subjects currently use the existing static question context as a
   transitional, unverified input until those banks are migrated to the shared
   Sheet. Missing answer keys or legal bases force provisional, review-required
   behavior.
4. Questions, student answers, answer keys, and source fields are isolated as
   untrusted prompt data.
5. Only stored source URLs and URLs returned in Gemini grounding metadata can
   reach the browser. Model-authored URLs are discarded.
6. The Worker validates the structured result and enforces the score, ALAC,
   source, review, and rubric contracts before responding.

## Reliability controls

- Exact-origin CORS using `ALLOWED_ORIGIN`
- POST-only JSON API
- Blank and 12,000-character input limits
- Best-effort per-IP rate limiting and short duplicate suppression
- 45-second Gemini timeout
- Model fallback: 3.6 Flash, 3.5 Flash, 3.1 Flash-Lite, then legacy
  2.5/1.5 compatibility attempts
- Grounding fallback when a model rejects Google Search tooling
- Controlled errors without stack traces or secret values
- Versioned local history that preserves legacy records on their original scale

## Worker configuration

Required Cloudflare bindings:

- `GEMINI_API_KEY` — encrypted secret
- `GEMINI_MODEL` — defaults to `gemini-3.6-flash`
- `GEMINI_GROUNDING_ENABLED` — `true` to request Google Search grounding
- `ALLOWED_ORIGIN` — `https://duediligence.ph`

No secret belongs in `wrangler.toml`, GitHub Actions, `index.html`, or any other
committed file.

## Release order

1. Run all repository validation scripts.
2. Deploy `worker/` to the existing Worker and verify CORS plus a controlled
   grading request.
3. Publish the GitHub Pages frontend only after the Worker is healthy.
4. Verify one question-bank assessment, one provisional assessment, history
   persistence, and mobile result-card layout in production.

Deploying the frontend before the Worker would expose users to the controlled
"examiner unavailable" state because the current production Worker is still
the default placeholder handler.
