# Debate Room V3 backend integration contract

This implementation is local candidate work. It does not establish production deployment, provider quotas, physical media, load capacity, real recipient delivery, or the 90-minute endurance gate. No existing Study Room backend or payment code is changed by these modules.

## Modules and persistence

`debate-service.mjs` exposes `createDebateService({store, adapters, now, limits})`. `debate-store.mjs` exposes `createDebateStore({rpc})`. The injected `rpc(name,args)` must use the existing authenticated Worker server credential; it returns either the JSON RPC result or `{data,error}`. Database exceptions are converted to a safe unavailable state rather than showing SQL or row data to clients.

The new `debate-schema-draft.sql` is synchronized to the CLI-generated `supabase/migrations/20260909080139_debate_room_v3.sql`. This is an additive local candidate, not an applied remote migration. Review and apply only through the authorized release workflow.

There is one authoritative Postgres event row, updated by row lock and expected revision. The event aggregate contains separate keyed match records, rules versions, stage attempts, ballots, polls, result versions and private spaces. This deliberately serializes commands for matches within one event. Default sequential matches fit that design; concurrent-event/provider capacity still needs an approved global operating limit and measured tests.

`debate_v3_commit` atomically writes state, immutable official match-history projections, unique current ballot/vote rows, actor-command-target-payload idempotency receipts, audit and outbox work. The same idempotency key with different payload is rejected. Creation per hour and one hosted live event per owner are atomically enforced. Cancellation races are rejected once a job has been claimed. Independent native PostgreSQL-client race testing remains a release verification task; local PGlite executes the actual SQL and constraints.

All ten new tables enable RLS, revoke `PUBLIC`, `anon` and `authenticated` grants, and expose only explicitly granted `service_role` access. These include a durable maintenance cursor and pending-upload ledger. All RPC functions use `SECURITY INVOKER`; none introduces a security-definer bypass. Worker commands still perform explicit current actor, event, role, phase, revision and payload authorization. Service credentials must never reach browser code. Do not expose raw event rows through a generic endpoint.

The test-only `createMemoryDebateStoreForTests()` is explicitly marked `testOnly`. It is never a hosted fallback and does not constitute durable product storage. The localhost rehearsal may use it only when clearly labeled; the preferred rehearsal uses the real SQL in disposable PGlite.

## Public request contract

`createDebateRoutes({service, authenticate, prefix:'/debate-room'})` returns `{handle(request)}`. `authenticate(request)` is the existing trusted authentication flow and returns `{id, displayName, email?, verified?, platformOperator?}`. Browser-supplied actor/role/paid status is never used. `platformOperator` must come from existing verified administrative authorization, never user metadata.

The outer Worker retains existing origin/CORS/CSRF handling. Responses set `Cache-Control: no-store, private`, JSON content type and `Vary: Authorization, Cookie`.

| Method / path | Input | Output |
|---|---|---|
| GET `/debate-room/events` | Current authenticated actor | `{ok:true,events:[{id,title,revision,rehearsal,visibility,status,createdAt,roleNames}],serverNow}` |
| GET `/debate-room/discover?limit=20&cursor=...` | Authenticated actor; max100 | Safe public non-rehearsal event metadata, `nextCursor`, `serverNow`; no roster, contacts, motions or panel |
| GET `/debate-room/snapshot?eventId=...` | Event ID | `{ok:true,event:<viewer-filtered snapshot>,serverNow}` |
| GET `/debate-room/messages?eventId=...&matchId=...&channel=public&before=...&limit=50` | Current channel access, max100; before is a returned message ID | `{ok:true,messages:[{id,actorId,channel,text,at}],nextCursor,serverNow}`; page chronological, latest first page; unknown/inaccessible cursor rejected |
| POST `/debate-room/command` | `{eventId?,command,payload,expectedRevision,idempotencyKey}` | `{ok:true,receipt:{id,eventId,command,revision,committedAt,result},event,serverNow}` |
| POST `/debate-room/claim` | `{eventId,secret,idempotencyKey,expectedRevision?}` | Same receipt envelope; omitted revision uses a bounded internal read/CAS retry only for invitation claim |

Errors use `{ok:false,error:{code,message,details?}}`. A stale action reports the current revision without pretending to commit. Requests must be JSON and at most 256 KiB. A fresh explicit idempotency key is required for each intended action; retry the same key and exact payload after a lost response.

The router counts streamed request bytes before parsing JSON, honors trusted integer HTTP error statuses, and returns sanitized service errors. It never accepts browser-supplied actor identity, operator authority, audit time, sanction IDs, or provider storage bindings as authorization.

Invitation code is a random 12-character code, hashed in state. Privileged claims are bound to the intended verified account/email or remain unprivileged until organizer approval. Invitations expire after seven days or event end, whichever is sooner, and can be revoked. Raw codes are returned only by the creating response and are removed before receipt persistence. A retry returns the original receipt with `secretShownOnce:true`; it does not recover the secret. Revoke and create another invitation if the one-time code was lost. Failed guesses are throttled per authenticated actor, not by campus IP.

## Snapshot contract and confidentiality

Top-level event fields include `id`, `revision`, `title`, `description`, `timezone`, `language`, `scheduledAt`, `visibility`, `rehearsal`, `status`, `ownerId`, `activeMatchId`, `retention`, `myId`, `members[]`, `teams[]`, released `motions[]`, `matches[]`, `fixtures`, `standings`, organizer-only `fixtureDraft` and invitation summaries, and authorized outbox summaries.

Members contain opaque `id`, `displayName`, event roles, `teamId`, `checkedIn`, `admitted`, and removal state. Public member snapshots contain no email. Conflicts are visible to organizers, current chief adjudicators and their declaring actor. Provider identities are immutable random `dd-debate-${epochId}` identities. Use each match's trusted `mediaParticipants:[{userId,identity}]` for tile mapping; it reveals only the viewer's currently authorized space, never other private rooms. Never derive identity from account ID.

Top-level `contact:{name,email,url}|null` is intentionally visible only to admitted members. `canManageRetention` is calculated from the trusted operator actor plus organizer role, and `maxMediaParticipants` is the actual validated configured limit (0 means disabled). A public `join_public_event` creates only an observer awaiting host admission. Waiting snapshots contain basic event metadata and the actor's own admission state, with empty matches/teams/motions/fixtures; joining is not access to private history.

Match fields are `id`, `title`, `motionId`, `teamIds`, `seats:{A1,...,N3}`, `captains`, `closingSeats`, `judgeIds`, `chiefId`, `moderatorId`, `timekeeperId`, `hostIds`, `rules`, `ruleVersion`, `rulesLockedAt`, `acknowledgments`, `phase`, `currentStageIndex`, `runOfShow`, `attempts`, `timer`, `readiness`, `ballotState`, `ballotRound`, `ballotCompletion`, active `poll`, `resultVersions`, authorized messages/evidence/incidents/protests, and `myMedia`.

`checkIn` contains `scheduledAt` (ISO or null), `graceMs`, `deadlineAt` (epoch milliseconds or null), `state` (`UNSCHEDULED`, `UPCOMING`, `GRACE_PERIOD`, `GRACE_ELAPSED`), `attendance:{[memberId]:{memberId,firstCheckedInAt,lastCheckedInAt,source}}`, and `findings:[{id,memberId,actorId,at,scheduledAt,deadlineAt,reason,status}]`. Finding status is `ABSENT` or `ARRIVED_AFTER_FINDING`. `sanctions` contains the public append-only issue/reversal records. Outbox `recipientLabel` is shown only to the creator or organizer; invitation addresses never enter other participants' snapshots. Lifecycle deletion jobs cannot be cancelled.

After approved official retention, a match is a tombstone `{id,title,phase:'expired',officialRecordsExpired:true}`. It deliberately omits expired rules/results/rosters instead of inventing default historical rules. Clients must exclude tombstones from active match controls and show the record-expiry notice.

Only an assigned eligible judge receives `myDraft`/`myBallot`. Other judges and organizers see submission counts rather than running team preferences. Poll running totals stay hidden until closed/published. Public results contain aggregate authorized data, with each team receiving only its released feedback. Private preparation/judging messages, evidence and downloads reauthorize current membership/channel access; hiding a panel is never the authorization mechanism.

## Working command examples

Every match-scoped payload includes `matchId`; otherwise the current `activeMatchId` is used. Send the current event revision in the command envelope. The following are payloads, not whole envelopes.

| Command | Payload / behavior |
|---|---|
| `create_event` | `{title,description?,timezone?,language?,scheduledAt?,visibility?,rehearsal?}`; empty real roster, no invented identities |
| `update_event` | Editable title/description/language/schedule/visibility/contact; timezone before rules lock, rehearsal before any match starts; invalid edits explicitly rejected |
| `join_public_event` | `{}`; freshly checked public/non-rehearsal/non-ended event, optional expectedRevision with bounded CAS retry |
| `create_invite` | `{role,teamId?,boundAccountId?,boundEmail?}`; one-time code response |
| `revoke_invite` | `{inviteId}` |
| `preview_invitation_mail` | `{inviteId,recipientEmail}`; current organizer, email/account binding and rehearsal allowlist checked |
| `send_invitation` | `{inviteId,recipientEmail,secret,previewConfirmed:true,confirmed:true}`; original secret verified, AES-GCM sealed job,20/minute and100/hour actor allowance; no plaintext secret persisted |
| `claim_invite` | `{secret}`; actor verified externally |
| `check_in` | `{matchId?,checkedIn?,displayName?,conflictDeclarations?}` for current actor; match check-in permanently records prior attendance before conclusion, even after checkout |
| `admit_member` | `{memberId,admitted?,approveRequestedRole?}` |
| `assign_role` | `{memberId,roles:[...],teamId?}`; organizer-only |
| `remove_member`, `reinstate_member` | `{memberId}`; removal revokes media and relevant votes |
| `propose_roster` | `{teamId,speakerIds:[3],captainId}` by captain |
| `confirm_roster` | `{teamId?,name,school?,speakerIds:[3],captainId}`; distinct real members |
| `add_motion` | `{title?,text}`; private until release |
| `create_match` | `{title?,motionId,teamIds:{affirmative,negative},seats?,captains?,closingSeats?,judgeIds,chiefId?,moderatorId?,timekeeperId?,hostIds?,rules?,evenPanelAccepted?,scheduledCheckInAt?}`; closing defaults to each actual captain seat; check-in schedule defaults to event schedule |
| `update_match_schedule` | `{scheduledCheckInAt:ISO|null}` before start and before any no-show finding |
| `record_no_show` | `{memberId,reason,confirmed:true}`; assigned absent participant after scheduled deadline plus default ten-minute grace, before start; creates a finding, never a winner |
| `update_rules` | `{rules?,closingSeats?,motionId?,evenPanelAccepted?}` before lock; invalidates captain acknowledgments |
| `amend_rules` | `{rules,reason}` after explicit pause; preserves previous rules/timer/attempts and requires new captain acknowledgments; judging mode, rubric, case labels, award/sanction policy and no-show grace stay immutable |
| `draw_sides` | `{random:true}` or `{swap:true|false}`; records actor/time/outcome/reroll history |
| `acknowledge_rules` | `{ruleVersion}` by assigned captain |
| `record_device_check` | `{memberId?,microphone,camera?,accommodation?}`; accommodation requires official |
| `readiness`, `release_motion`, `start_match` | Validate readiness; freeze accepted rules; initialize first stage READY |
| `claim_clock` | `{timerVersion,takeover?,reason?}`; explicit current controller lease |
| `renew_clock` | `{timerVersion}`; current controller |
| `timer` | `{type:'START'|'PAUSE'|'RESUME'|'RESET'|'SET_DURATION'|'TECHNICAL_PAUSE',timerVersion,durationMs?,reason?,confirmed?}` |
| `finish_stage`, `next_stage` | Finish uses `timerVersion`; Next requires prior finished and loads READY |
| `return_stage` | `{stageIndex,reason}` after pause/finish; preserves old attempt and actual speaker attribution |
| `request_help` | `{type:'technical'|'ruling'|'accommodation',reason}` |
| `resolve_incident` | `{incidentId,resolution,acknowledgeOnly?}` |
| `substitute_speaker` | `{seat,memberId,captainId?,reason}`; ready admitted same-team reserve at paused boundary, captain defaults to replacement if the captain departed, old attributed drafts/attempts preserved, both captains must acknowledge renewed rules, score opportunity review |
| `conclude_match` | `{kind:'normal'|'forfeit'|'double_forfeit'|'cancelled'|'withdrawn'|'postponed',reason?,winner?,confirmed?,noShowFindingIds?}`; explicit human outcome; stale findings reject if the participant has arrived |
| `record_sanction` | `{action:'issue',sanctionId,target:{side}|{seat},reason,confirmed:true}` or `{action:'reverse',recordId,reason,confirmed:true}`; started active match, current acknowledgment and moderator/chief/organizer authority; published outcomes require correction first |
| `save_draft` | `{scorecard?,winner?,reason?,notes?,feedback?}`; simple mode requires no numeric card |
| `open_ballots`, `close_ballots` | Current captains' rules acknowledgments and assigned panel completion required |
| `submit_ballot` | `{scorecard?,winner?,reason?,feedback?,confirmed:true}`; full-mode winner recomputed server-side |
| `reconsider_ballots` | `{reason}`; one same-panel round for unresolved tally |
| `change_panel` | `{judgeIds,reason,observedJudgeIds?}`; eligible observed substitutes and captain notice |
| `open_poll`, `close_poll`, `publish_poll` | Independent post-speaking audience lifecycle |
| `vote` / `withdraw_vote` | `{pollId?,side}` / `{pollId?}`; one current vote per snapshot-eligible account |
| `publish_result` | `{releaseFeedback?}` after required closed ballots or documented exceptional conclusion |
| `protest_result` / `resolve_protest` | `{reason,type}` / `{protestId,disposition}` |
| `nominate_award` | `{nomineeId:'A1'|...|'N3',reason,runoff?}` by current judge |
| `finalize_result`, `correct_result` | Explicit deadline/protest checks; correction `{reason}` supersedes and opens a new judging round |
| `send_message` | `{channel:'public'|'technical'|'judges'|'team:affirmative'|'team:negative',text}`; phase/channel restrictions server-side |
| `quiet_observers` | `{quiet:boolean,reason}`; assigned official only; quiet public observer chat preserves technical-help channel |
| `share_evidence` | `{title,description?,sourceUrl?,channel?,attachment?,previousId?,ruling?}`; validated upload descriptor only |
| `generate_fixtures`, `publish_fixtures` | `{method:'round_robin'|'elimination',teamIds?,motionIds?,motionReusePolicy?,seedOrder?,random?}` then `{confirmed:true}` |
| `advance_match` | `{fixtureId?,nextMatchId?}` after finalized resolved winner; prior IDs/data retained |
| `create_export` | `{kind:'rules'|'scorecard'|'result'|'event_report'|'csv'|'certificate',format?,resultId?,participantId?,awardKey?}` |
| `send_results` | `{recipientIds,resultId?,previewConfirmed:true,confirmed:true}`; approved test recipients only during rehearsal |
| `cancel_job`, `retry_job` | `{jobId}`; authorization and current durable job state required |
| `set_retention`, `cleanup_records` | Authorized platform operator plus event organizer; approved limits, end time and hold checks |
| `end_event` | Explicit actual event end after active speaking phase concludes |

Completed events cannot silently restart speaking or receive fresh drafts/messages/evidence. The original `endsAt` is immutable on repeated End actions. Bound fixtures, correction review, linked rematches and private moderator invitations are implemented in the service and their companion procedure/fixture/tournament modules. Roster changes update only unstarted matches, invalidate acknowledgments and preserve historical seats for finalized matches. Event timezone/language defaults flow into newly created match rules.

A timekeeper may claim/renew the clock and control timer attempts/stage progression; that assignment does not confer match-start, roster, moderation, floor, ballot, poll or winner authority. Match start and moderation require the organizer, chief or moderator. The chief must be an assigned judge. A competitor still cannot control their own active speaking stage.

Rules PDFs before start derive the complete planned run without starting a timer. Certificates require match-specific attendance recorded before conclusion and identify actual match roles and any confirmed award. An event-level check-in alone cannot certify participation in every later match.

`rules.sanctions` defaults to `[]`. Declarations are `{id,label,description,effect:'warning'|'team_point_deduction',points?}`. Warnings are available in every mode; fixed numeric deductions require aggregate judging and are rejected in majority/simple modes. Accepted policy cannot change after start. Published results pin motion and sanction history, `rawTally`, `adjustments`, `adjustedTeamScores`, `adjustedTally`, and `awardBasis:'raw_scorecards'`; top-level winner/scores reflect the adjusted official result. Exact signed standings allow negative totals without clamping. Speech awards continue to use raw cards. Exceptional conclusions retain sanction history but report `application:'not_applied_exceptional_conclusion'`. Correction supersedes the old version instead of changing its recorded adjustments.

## Media adapter and credentials

Without an explicitly supplied, verified `limits.maxParticipants` from 1 through 100, media admission fails closed. It does not silently assume a provider plan. Atomic event-state admission counts expired sessions until provider removal confirms; an expired lease does not free a still-connected seat. Project-wide quotas, Study Room concurrency, reconnect reserve, participant-minutes and approved load spend remain external operating gates.

`enter_space({matchId,space:'main'|'affirmative'|'negative'|'judges',deviceId,handoff?})` commits a pending lease and job. `renew_media({matchId,deviceId})` renews the ready 120-second lease; call approximately every 45 seconds. `leave_media` queues removal. No command switches on a remote user's camera or microphone.

`adapters.media(job)` receives `payload:{action:'join'|'permissions'|'leave',session}`. Session contains event/match/user IDs, private space, immutable epoch identity/room, retired `revocations`, distinct allowed source names (`camera`, `microphone`, `screen_share`, `screen_share_audio`), verified max participants and safe state. Return confirmed `status:'ready'` or `'left'`. Provider tokens/credentials never enter this result, event snapshots or jobs.

The adapter never updates existing grants. Real permission/space/device changes retire the former identity and mint a new epoch; clock ticks/renewals do not. Each provider call checks the current durable job lease and epoch. The Cloud-only adapter explicitly revokes tokens with a strict-second cutoff, uses SDK requestTimeout12 seconds with failover disabled, and leaves any uncertain removal pending. Disabling new media still permits removal with valid provider keys. Credentials have at most30 seconds of initial-join lifetime and never extend the current application lease; integration rechecks actor/device/epoch/room/sources/expiry after signing. JWT expiry alone does not remove an already connected participant, so an independently operating sweeper is a launch requirement. Existing camera/effect tracks must be retained during epoch reconnect; physical interruption has not been measured.

Only after ready, call `service.authorizeMedia({actor,eventId,matchId,deviceId})`; pass its internal session to the provider credential method and return that token only to the same authenticated actor. Reauthorize each renewal/token request. Private transfers remove the previous provider session before joining the new one.

## Durable export/mail/evidence adapters

`processOutbox({eventId,limit:5,deadlineAt})` is an **internal** service method, never a generic public actor command. It claims one job immediately before delivery using atomic `FOR UPDATE SKIP LOCKED` and claim IDs. It stops new claims at the shared deadline; an already running provider call can finish later and is not detached. `sweep({limit:20,cursor,jobsPerEvent:3,deadlineAt})` uses a durable service-only SQL cursor, which wraps fairly across worker restarts and cannot be rewound by stale caller cursors. It returns `outcomes`, `nextCursor`, `deadlineReached`, `deferredEvents`. Shared provider capacity still needs measured proof that backlog is within the required revocation window.

The separate minute scheduler is disabled until configured. It reconciles expired media, approved retention and lost event-projection acknowledgments; a completed delivery receipt repairs projection state without redelivery. Media and deletion failures retry with bounded backoff; ordinary delivery attempts cap at10. Adapters must use `job.id` as their external idempotency key, especially mail, since a Worker can fail after external acceptance but before the durable receipt.

Each adapter receives `{id,eventId,matchId,actorId,type,payload,createdAt,resultVersion,claimId,attempts}`. Before rendering/sending, the service reauthorizes the current document viewer/recipient and same result version. A recused judge, removed recipient, revoked role or superseded result fails rather than receiving the old captured private document.

- `adapters.export(job)`: `payload:{matchId,document,format}`. Render actual authorized text using the root document renderer. Store privately at `exports/${eventId}/${job.id}.pdf` or `.csv`. Return `{status:'ready',downloadId:job.id,storageKey,filename,mimeType}`. No public URL.
- `adapters.mail(job)`: `payload:{matchId,recipientId,document,rehearsal}`. Resolve the verified recipient address server-side using the approved existing mail service. Each job is one recipient. Return `{status:'accepted',deliveryStatus:'accepted_not_delivery_confirmed',providerId}`. No fabricated inbox delivery.
- `adapters.validateEvidence(input)`: `{actorId,eventId,matchId,channel,uploadId,mimeType,size}`. Verify signed envelope ownership, audience, deadline, file signature/type/size/digest/private storage. Return `{verified:true,id,mimeType,size,digest,storageKey,scanStatus?}` only after verification. File signatures are not a malware scan; the UI reports that distinction.
- `adapters.delete_evidence(job)`: delete only the authorized event evidence object's private storage key; report a confirmed status and remain retryable on failure.
- `adapters.delete_export(job)`: `{sourceJobId,storageKey}` exact deterministic export path; approved retention and current no-hold state checked before deletion; return `{status:'deleted'}`.
- `adapters.sealInvitation({eventId,inviteId,recipientEmail,secret,expiresAt})` returns an opaque AES-GCM envelope. `adapters.invitation_mail(job)` receives only sealed secret plus binding metadata. `adapters.recipientEmail(accountId)` performs fresh verified Auth lookup for account-bound recipients. Accepted mail persists a safe `providerId`; acceptance is not inbox proof.

`authorizeDownload({actor,eventId,downloadId})` binds job ID to current actor, event, result version, complete export status, deterministic private storage key and seven-day expiry. It returns internal `{storageKey,filename,mimeType,document}` for an authorized proxy download. No direct file-ID guessing or broad signed URL is needed.

`reserveEvidenceUpload({actor,eventId,matchId,channel,mimeType})` checks admitted/current participant and write-channel authority, reserves a private deterministic object key, and atomically schedules orphan cleanup before bytes arrive. Its30-minute reservation binds actor/event/match/channel/type. `completeEvidenceUpload({actor,eventId,matchId,reservationId,attachment})` checks authorization both before and after awaited byte verification. `failEvidenceUpload({actor,eventId,reservationId})` advances durable cleanup after a failed/revoked upload. `share_evidence` atomically consumes the matching completed reservation and cancels orphan cleanup; duplicate use is denied. Abandoned uploads survive process failure and retry deletion independently of removed membership.

`authorizeEvidence({actor,eventId,matchId,evidenceId})` checks current channel membership and returns internal `{storageKey,attachmentId,mimeType,size,digest,filename}`. Download checks type/size/digest again and reauthorizes after reading bytes. Browser snapshots contain safe opaque attachment IDs, MIME, size and truthful scan status, never storage bindings.

## Retention behavior

The proposed30-day operational,30-day chat/draft,90-day evidence and365-day official periods do nothing until an organizer with trusted platform-operator capability approves the policy. An explicit reason is required to set or release a hold. Scheduled cleanup uses the stored approval and fresh SQL row lock; a hold blocks queued retained-evidence/export deletion as well as record cleanup. Actor/phase authorization remains active during cleanup.

Chat cleanup removes current and archived private drafts/messages, including historical copies. Operational cleanup removes device/accommodation/incident/private-invitation data, vote identities, used invitation metadata and expired operational receipts. Official command audit remains until the event-end official deadline; the shorter operational cleanup cannot erase it. Official cleanup removes ballots, results, nominations, sanction and no-show records, current/historical rules and motions, historical roster/stage records and their SQL projections. Expired official documents cannot be generated. Evidence cleanup queues confirmed private-object deletion. Generated exports expire after seven days or the shorter applicable record period; captured mail/scorecard documents and sealed invitations are purged when due. Due completed orphan-upload metadata is discoverable even with no event end or public outbox projection. Pending provider revocation/deletion bindings remain until confirmed so cleanup cannot strand a still-connected session or file. Minimal redacted job identifiers remain for durable cleanup reconciliation.

## Verification and remaining limits

Run the root `scripts/test-debate-v3.mjs` suite and preserve its exact evidence manifest rather than treating a count in this document as a release gate. Backend tests include the accelerated default stage flow through finalized awards, actor/role privacy, invitations, CAS/receipts, download/evidence integrity, metadata discovery/waiting admission, immutable media epochs, role revocation, quiet/history, contacts, no-show grace, scoped timekeeping, captain defaults, immutable judging rules, sanctions and signed standings, approved retention/holds and deadline-aware claims. PGlite executes the actual SQL under `service_role`, tests client-role denial, unique ballots/votes, cursor fairness across 101 metadata fixtures, pending-upload transactions, durable orphan cleanup discovery, official audit deadlines and retention isolation from another event. These metadata fixtures are not a 100-person media/load test. Fixture/procedure/tournament and delivery/integration tests are also recorded in the combined runner.

These tests do not provide native PostgreSQL multi-connection load evidence, actual authenticated Supabase/cloud/provider integration, real speech or physical cameras, browser/device coverage, the 90-minute physical rehearsal, 100-person measured ramp, approved retention/operating policies, recipient inbox delivery, production migration/deployment or launched navigation evidence. The root requirement ledger must retain those gaps. The separate minute scheduler is wired in the local candidate and defaults disabled; source code alone is not evidence that scheduled jobs are operating in a hosted environment.
