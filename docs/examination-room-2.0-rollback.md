# Examination Room 2.0 rollback

Examination Room 2.0 uses an additive database migration. Rollback is a
forward-repair operation: retain examination evidence and remove access to the
new paths. Never drop answer, operation, conflict, submission, receipt, audit,
leave, incident, or backup records during a rollback.

## Immediate containment

1. Set the environment-local `EXAMINATION_ROOM_2_ENABLED` flag to `false` and
   redeploy the Worker. Use `EXAMINATION_ROOM_ENABLED=false` only when the whole
   Examination Room must be stopped.
2. Confirm that V2 API operations fail closed and that no new V2 attempt can
   begin.
3. Restore the recorded last-known-good Worker version.
4. Restore the recorded last-known-good Pages deployment. Do not clear browser
   IndexedDB or force an asset update during an active attempt.

## Evidence preservation

- Keep the additive V2 tables, private source objects, backup workbooks,
  outbox rows, receipts, audit events, and local recovery journals.
- Do not edit a submitted answer or replace a receipt. Corrections use a new,
  reviewed forward migration or the recorded dispute process.
- Reconcile active sessions, pending answer operations, and pending submission
  receipts before considering reactivation.

## Reactivation

Reactivate only after the defect has a tested forward fix, staging has repeated
the affected journey, and a new approval reference records the database,
Worker, Pages, and feature-flag versions. Enable the Worker V2 flag before the
static client entry, then repeat the four-role smoke test.
