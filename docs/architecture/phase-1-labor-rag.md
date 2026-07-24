# Phase 1 — Curated Labor Law RAG Architecture

## Decision

Due Diligence will treat curated legal content—not an AI model's memory—as the
authoritative source for Labor Law feedback. The Phase 1 corpus contains exactly
30 approved Labor Law and Social Legislation essay questions.

## Trust boundaries

1. **Google Sheets is editorial input only.** It is private and contains no student data.
2. **Supabase is the versioned serving store.** Only approved corpus rows are imported.
3. **The client never receives an OpenAI key or the full answer-key corpus.**
4. **A server-side grading function retrieves only the selected question's approved context.**
5. **OpenAI may explain and score against that context but may not supply new authorities.**
6. **The response is rejected if an authority identifier is not in the retrieved context.**

## Request flow

```text
Student answer
  → authenticated server-side grade endpoint
  → fetch one approved Labor question, answer, rubric, doctrine, authority set
  → compose constrained grading request
  → OpenAI structured response
  → validate cited authority IDs against retrieved IDs
  → persist submission, corpus version, model/prompt version, and grade result
  → return educational feedback to student
```

## Provider-neutral contract

The UI depends on one server contract, not a provider SDK:

```text
gradeLaborEssay({ questionId, answerText }) → {
  rubricVersion,
  corpusVersion,
  overallScore,
  components: { answer, legalBasis, application, conclusion },
  feedback,
  citedAuthorityIds,
  requiresEditorialReview
}
```

The initial provider can be OpenAI. A future provider must implement the same
contract, structured output schema, authority allow-list, and refusal behavior.

## Non-negotiable model rules

- Do not invent or infer a case citation, statutory section, quote, date, or doctrine.
- Cite only authority IDs supplied in the retrieved context.
- If the context does not support an answer, return `requiresEditorialReview: true`.
- Clearly distinguish a wrong legal position from incomplete analysis.
- Award credit only for propositions actually stated by the student.
- Store corpus and rubric versions with every grade for auditability.

## Import gate

`scripts/validate-labor-cms.mjs --mode=release` is the first gate. A question
cannot be imported unless it has an approved prompt, answer, source, authority,
doctrine, four-component ALAC rubric totalling 100, reviewer, and version date.

## Rollout

1. Validate the CMS structure.
2. Complete legal/editorial review of 30 questions.
3. Apply the Supabase migration in a non-production project.
4. Build and test the authenticated server-side retrieval/grading endpoint.
5. Run a blind human-versus-system grading calibration set.
6. Release Labor Law beta only after legal sign-off.
