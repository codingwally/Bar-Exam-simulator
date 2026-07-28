# Admin subscription-actions hotfix

## Confirmed root cause

`actionButton()` returns a table-cell descriptor shaped as
`{ html: true, value: "<button …>" }`. The general table renderer understands
that descriptor. The Access & Subscriptions renderer instead interpolated two
descriptor objects directly inside a template literal. JavaScript therefore
coerced each object with its default `toString()` implementation and emitted
`[object Object]`. Because no button markup reached the DOM, the existing
dynamic event-binding pass had nothing to bind.

The deployed GitHub Pages bundle matched the repository source, so this was not
a stale-release or role-assignment defect.

## Resolution

- Subscription actions are described as data and mounted with
  `document.createElement()`, `textContent`, and explicit click listeners.
- Controls are selected from the current subscription state and are exposed
  only to signed-in `super_admin` and `founder_admin` sessions.
- The native action dialog shows the target, current access, proposed change,
  required reason, and required confirmation.
- The Worker strips presentation fields and client-provided prices, rejects
  Premium and cross-user payloads, and routes access changes to a dedicated
  founder-only RPC.
- The RPC serializes changes per user, uses idempotency keys, writes immutable
  history and audit rows in the same transaction, and rejects invalid state
  transitions.
- A database trigger prevents any live subscription from using a disabled plan,
  including calls through the legacy RPC.

The migration is additive. It does not alter Gemini grading, question content,
answers, timers, payment verification, authentication, or analytics behavior.
