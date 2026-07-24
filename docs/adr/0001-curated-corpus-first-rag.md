# ADR 0001 — Curated corpus before generative explanation

**Status:** Accepted for Phase 1

## Context

The legacy application stores questions, short model answers, and case labels in
browser-delivered JavaScript. Its score is a keyword heuristic. This cannot
provide traceable legal accuracy or a defensible educational feedback process.

## Decision

Labor Law will be sourced from an editorial Google Sheets CMS, validated in the
repository, imported into private Supabase corpus tables, and retrieved by a
server-side grade endpoint. The AI provider is constrained to the retrieved
answer, doctrine, authority, and rubric context.

## Consequences

### Positive

- Every legal proposition can be traced to a source and reviewer.
- Content corrections are versioned and can be regraded or explained later.
- The provider can be replaced without changing the student-facing contract.
- The Phase 1 model can scale to other Bar subjects without another data redesign.

### Trade-offs

- Editorial work is required before content can be released.
- The server-side grading endpoint requires a secure runtime; GitHub Pages alone
  is not enough.
- AI feedback must sometimes decline to answer when the curated corpus is silent.
