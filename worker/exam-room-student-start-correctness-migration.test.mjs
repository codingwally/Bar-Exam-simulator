import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const correction = readFileSync(new URL(
  '../supabase/migrations/20260811003900_examination_room_student_start_correctness.sql',
  import.meta.url,
), 'utf8').replace(/\r\n/g, '\n');

const waitingRoomMigration = readFileSync(new URL(
  '../supabase/migrations/20260811003400_examination_room_waiting_room_and_code_recovery.sql',
  import.meta.url,
), 'utf8').replace(/\r\n/g, '\n');

function correctedPreflightBody() {
  const start = correction.indexOf(
    'create or replace function public.exam_room_student_waiting_room_v4',
  );
  assert.notEqual(start, -1, 'corrected waiting-room function must exist');
  const end = correction.indexOf('\ncomment on function', start);
  assert.notEqual(end, -1, 'corrected waiting-room function must be bounded');
  return correction.slice(start, end);
}

test('migration is additive, transaction bounded, and service-role only', () => {
  assert.match(correction, /^-- Examination Room authoritative student start-state correction\./);
  assert.match(correction, /\nbegin;[\s\S]*\ncommit;\s*$/);
  assert.match(correction, /create or replace function public\.exam_room_student_waiting_room_v4/);
  assert.doesNotMatch(correction, /create or replace function public\.exam_room_start_attempt_v4/);
  assert.doesNotMatch(correction, /\b(?:create|alter|drop)\s+table\b/i);
  assert.match(correction, /security definer\s+set search_path = ''/);
  assert.match(correction, /revoke all on function public\.exam_room_student_waiting_room_v4\([\s\S]*?\) from public, anon, authenticated;/);
  assert.match(correction, /grant execute on function public\.exam_room_student_waiting_room_v4\([\s\S]*?\) to service_role;/);
});

test('terminal examination state wins before resume, eligibility, and credential checks', () => {
  const body = correctedPreflightBody();
  const terminal = body.indexOf("if v_exam.status in ('closed', 'grading', 'sealed')");
  const deadline = body.indexOf("and v_attempt.status in ('in_progress', 'locked')", terminal);
  const resume = body.indexOf("and v_attempt.status in ('in_progress', 'locked')", deadline + 1);
  const eligibility = body.indexOf("elsif not coalesce((v_base ->> 'eligible')::boolean, false)");
  const credential = body.indexOf('public.exam_room_check_student_credential_preopen_v4(');

  assert.ok(terminal > -1, 'terminal examination guard must exist');
  assert.ok(deadline > terminal, 'attempt deadline guard must follow terminal exam guard');
  assert.ok(resume > deadline, 'resume-ready branch must follow deadline guard');
  assert.ok(eligibility > resume, 'existing attempt handling must remain ahead of new admission checks');
  assert.ok(credential > eligibility, 'credential validation must follow all terminal guards');
  assert.match(body.slice(terminal, deadline), /v_now >= v_effective_hard_close/);
  assert.match(body.slice(terminal, deadline), /v_blocker := 'EXAM_CLOSED'/);
  assert.match(body.slice(terminal, deadline), /v_state := 'blocked'/);
});

test('an expired active attempt is blocked instead of marked resume ready', () => {
  const body = correctedPreflightBody();
  const deadlineStart = body.indexOf(
    "elsif v_attempt.id is not null\n    and v_attempt.status in ('in_progress', 'locked')\n    and v_attempt.server_deadline is not null",
  );
  const resumeStart = body.indexOf(
    "elsif v_attempt.id is not null\n    and v_attempt.status in ('in_progress', 'locked')",
    deadlineStart + 1,
  );
  assert.ok(deadlineStart > -1, 'deadline guard must exist');
  assert.ok(resumeStart > deadlineStart, 'deadline guard must precede resume');
  const deadlineBranch = body.slice(deadlineStart, resumeStart);
  assert.match(deadlineBranch, /v_now >= v_attempt\.server_deadline/);
  assert.match(deadlineBranch, /v_blocker := 'DEADLINE_REACHED'/);
  assert.match(deadlineBranch, /v_state := 'blocked'/);
  assert.doesNotMatch(deadlineBranch, /v_can_start := true/);

  const resumeBranch = body.slice(
    resumeStart,
    body.indexOf("elsif v_attempt.id is not null\n    and v_attempt.status in ('submitted'", resumeStart),
  );
  assert.match(resumeBranch, /v_blocker := 'RESUME_READY'/);
  assert.match(resumeBranch, /v_can_start := true/);
});

test('minimal denials and the question-free waiting room remain intact', () => {
  const body = correctedPreflightBody();
  const denial = body.match(
    /if \(v_base ->> 'code'\) in \([\s\S]*?'EXAM_NOT_PUBLISHED'[\s\S]*?\) then([\s\S]*?)\n  end if;/,
  )?.[1] || '';
  assert.ok(denial, 'minimal outsider denial must remain');
  assert.match(denial, /'startBlockerCode', v_base ->> 'code'/);
  assert.doesNotMatch(
    denial,
    /title|opensAt|entryClosesAt|hardClosesAt|studentAccessReady|rules|instructions|candidateNumber|rosterIdentity/,
  );
  assert.ok(
    body.indexOf("if (v_base ->> 'code') in")
      < body.indexOf('from public.exam_room_publications publication'),
    'minimal denial must precede publication and schedule derivation',
  );
  assert.match(body, /public\.exam_room_check_student_credential_preopen_v4\(/);
  assert.match(body, /'waitingRoom', true/);
  assert.match(body, /'pollAfterMs', v_poll_after_ms/);
  assert.doesNotMatch(body, /insert into public\.exam_room_attempts/);
  assert.doesNotMatch(body, /insert into public\.exam_room_answers/);
  assert.doesNotMatch(body, /'questions'/);
});

test('start_attempt_v4 still immediately rechecks corrected preflight', () => {
  assert.doesNotMatch(correction, /create or replace function public\.exam_room_start_attempt_v4/);
  const start = waitingRoomMigration.indexOf(
    'create or replace function public.exam_room_start_attempt_v4',
  );
  assert.notEqual(start, -1, 'start_attempt_v4 must exist in its owning migration');
  const body = waitingRoomMigration.slice(start);
  assert.match(body, /v_preflight := public\.exam_room_student_waiting_room_v4\(/);
  assert.match(body, /if not coalesce\(\(v_preflight ->> 'canStart'\)::boolean, false\)/);
  assert.ok(
    body.indexOf('public.exam_room_student_waiting_room_v4(')
      < body.indexOf('return public.exam_room_start_attempt('),
    'preflight recheck must precede the attempt mutation',
  );
});
