# Lex Forum production release runbook

This runbook is additive and zero-downtime. It does not authorize unrelated
database, grading, question-bank, timer, payment, subscription, or design
changes.

## Immutable identities

- Production Supabase project: `hbllomlijfznnuudpdvr`
- Staging Supabase project: `hlzqmreeoghbldnhlybr`
- Worker: `duediligence-gemini-examiner`
- Website: `https://duediligence.ph`

Stop immediately if any identity differs.

## Release order

1. **Database**
   - Record production counts for subjects, questions, profiles, submissions,
     grading results, and existing migrations.
   - Run `supabase/review/lex_forum_production_preflight.sql` read-only.
   - Stop on any assertion or inventory drift.
   - Apply only
     `supabase/migrations/20260802_011_lex_forum_social_beta.sql` through the
     reviewed single-migration path. Do not use an unrestricted `db push`.
   - Verify seven forum tables, 17 forum functions, RLS, grants, indexes, and
     zero initial forum rows.
   - Verify existing counts and public subject/question reads are unchanged.

2. **Worker**
   - Confirm the existing encrypted Supabase and Gemini secret names are
     present; never print their values.
   - Deploy the Worker from the reviewed branch.
   - Verify existing grading first.
   - Verify signed-out forum reads return controlled authentication JSON.
   - Verify authenticated forum operations and founder-only moderation.
   - Roll the Worker back to its prior version if grading or forum routing
     regresses.

3. **Frontend**
   - Merge only after database and Worker checks pass.
   - Let the existing GitHub Pages workflow publish the sanitized artifact.
   - Verify the deployment commit and custom domain before acceptance testing.

## Staging gates

Required before production:

- structural pgTAP: 50/50;
- behavioral transaction passes and rolls back;
- migration reapplies cleanly;
- all forum tables and synthetic Auth rows return to zero;
- Worker unit/security tests pass;
- Lex Forum static integration contract passes;
- every existing repository regression passes;
- Pages artifact includes only allowlisted forum assets;
- secret scan and `git diff --check` pass.

## Live acceptance

Use clearly marked synthetic content and record each generated UUID.

1. Signed out:
   - open `Lex Forum (Under Construction)`;
   - confirm the existing sign-in prompt opens with no guest forum option;
   - confirm no feed content is rendered.
2. Signed in as member A:
   - publish a plain-text post with an approved `https` source;
   - edit the post;
   - open and copy its stable link.
3. Signed in as member B:
   - see the post;
   - like, unlike, and like again; confirm truthful count;
   - comment and edit the comment;
   - repost with commentary;
   - report the post; confirm no reporter identity is disclosed.
4. Signed in as founder:
   - open Lex Forum Moderation;
   - hide and restore the reported content;
   - restrict and unrestrict publishing;
   - dismiss or action the report;
   - confirm each action is in `admin_audit_log`.
5. Verify pagination, empty/error/offline/retry states, desktop, narrow mobile,
   keyboard focus, and relevant browser console/network output.
6. Re-run an existing essay grade and verify the 0–5 result is unchanged.

## Exact synthetic cleanup

Delete or soft-delete only UUIDs recorded during acceptance. Never use a broad
predicate, wildcard, date range, or guessed identifier. In dependency order:

1. reports for the recorded report UUIDs;
2. reactions for the recorded `(post_id, user_id)` pairs;
3. reposts for the recorded repost UUIDs;
4. comments for the recorded comment UUIDs;
5. restrictions for the recorded restriction UUIDs;
6. action events for the recorded synthetic user UUIDs and test window;
7. posts for the recorded post UUIDs;
8. synthetic Auth users only if they were created solely for this test.

Confirm every recorded UUID is absent and all legitimate rows remain.

## Stop conditions

Stop without advancing when:

- project, Worker, branch, commit, or domain identity differs;
- preflight, migration, tests, or row-count preservation fails;
- any unrelated migration could be applied;
- a secret appears in output, logs, repository, response, or frontend;
- existing grading, question browsing, authentication, timer, subscriptions,
  payments, or admin access regresses;
- a test cannot be cleaned up by exact UUID;
- production confidence falls below the mission’s approved threshold.

## Recovery reality

Git revert does not roll back database objects or privileges. The migration is
additive and can remain dormant if application rollout is stopped. Application
recovery is:

1. restore the previous Worker version;
2. restore the previous GitHub Pages deployment/commit;
3. leave forum tables unused;
4. prepare a separately reviewed forward database recovery migration if object
   removal is ever required.

Never improvise destructive rollback SQL in production.
