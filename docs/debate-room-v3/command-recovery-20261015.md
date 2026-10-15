# Debate command recovery

A command can be saved before its response fails. The client previously discarded its original action key on HTTP503, so a later action could replace the unresolved request. The saved timer continued running; the old rehearsal's provider failure itself remains unexplained.

The client keeps the complete original envelope after an uncertain outcome and sends it again only when the participant selects Retry last action. Other commands, draft autosave, media renewal and clock renewal cannot replace that envelope. The lobby now exposes the same recovery control as the room. A successful response must identify the saved command, event, receipt and revision before the client confirms it.

An access failure while recovering clears private event content and disconnects media. The unresolved envelope stays only in memory, bound to the original account and account generation, for a same-account retry after access returns. Explicit sign-out, account change or event navigation clears that recovery state. Background polling stops once the inaccessible event has been cleared.

| Requirement | Test | Evidence boundary |
| --- | --- | --- |
| A lost response must retain the exact original action | Actual client declarations with inert HTTP503, timeout, network and malformed-response cases in test-debate-command-recovery.mjs | Local state behavior; no hosted claim |
| No background or concurrent action may replace recovery | Client clock/media/autosave guards and concurrent retry tests | Synthetic timers and transport |
| Recovery must remain available in the lobby | Lobby create/join tests and the synthetic organizer's committed-create HTTP503 scenario | Actual browser scenario requires the isolated browser run |
| Expired access cannot silently turn an uncertain action into a new action | Same-account401/403 retry and polling integration tests; explicit teardown tests | Private view clearing and owner-bound memory only |
| A clock retry must apply at most one effect | Real service and RPC-adapter fault tests before commit, after commit and during final read in test-debate-service-recovery.mjs | Synthetic persistence; no provider root-cause claim |
| Timer history must survive recovery | Original start time, elapsed time, stage, attempt, receipt and takeover assertions | Deterministic clock tests |
| Future failures must have useful private-data-safe evidence | Clock request/response/transport diagnostic tests and both browser observers | Bounded2048-entry history; hashed action keys and receipt IDs; no raw payload or credentials |
| Returning browsers must load the repaired client | New client URL and source-linked asset verification tests | Deployment readback still required |

The command-recovery test group is required by the staging release gate, with its four new source files included in the critical manifest. Local/isolated checks do not substitute for the full hosted rehearsal, physical media, real inbox delivery, production role journeys or the overall website audit. No production deployment is made by this change.

The original failed rehearsal's residue has a separate [committed staging cleanup receipt](evidence/staging-reconciliation-34415569337-20261014.json).
