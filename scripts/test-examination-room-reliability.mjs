import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sessions = read('supabase/migrations/20260813190000_examination_room_queue_and_multidevice_reliability.sql');
const releases = read('supabase/migrations/20260813191000_examination_room_candidate_results_and_lifecycle.sql');
const frontend = read('assets/duediligence-2026.js');
const routes = read('worker/duediligence-2026-routes.mjs');
const delivery = read('worker/exam-room-delivery.mjs');

for (const sql of [sessions, releases]) {
  assert.match(sql, /^--/);
  assert.match(sql, /\bbegin;[\s\S]*\bcommit;\s*$/i, 'migration must be transactional');
}

assert.match(sessions, /drop index if exists public\.exam_room_one_active_session_idx/i);
assert.match(sessions, /create unique index if not exists exam_room_one_active_device_session_idx/i);
assert.match(sessions, /create or replace function public\.exam_room_open_session_v3/i);
assert.match(sessions, /v_active_count >= 3/i, 'student sessions must be bounded to three active devices');
assert.match(sessions, /for update skip locked/i, 'queue workers must claim rows without blocking one another');
assert.match(sessions, /claim_token/i);
assert.match(sessions, /lease_until/i);
assert.match(sessions, /exam_room_record_email_delivery_event_v1/i);

assert.match(releases, /create table if not exists public\.exam_room_result_release_batches/i);
assert.match(releases, /create table if not exists public\.exam_room_candidate_releases/i);
assert.match(releases, /enable row level security/i);
assert.match(releases, /force row level security/i);
assert.match(releases, /revoke all on table public\.exam_room_candidate_releases from public, anon, authenticated/i);
assert.match(releases, /create or replace function public\.exam_room_release_candidate_results_v1/i);
assert.match(releases, /create or replace function public\.exam_room_prepare_class_result_export_v2/i);
assert.match(releases, /create or replace function public\.exam_room_update_lifecycle_v1/i);
assert.match(releases, /p_selected_attempt_public_ids/i);

const candidateRelease = releases.match(/create or replace function public\.exam_room_release_candidate_results_v1[\s\S]*?\n\$\$;/i)?.[0] || '';
assert.ok(candidateRelease, 'candidate release function missing');
assert.doesNotMatch(candidateRelease, /status\s*=\s*'sealed'/i, 'candidate release must not seal the class examination');
assert.doesNotMatch(candidateRelease, /release_id\s*=/i, 'candidate release must not revoke the class examination');

assert.match(routes, /exam_room_open_session_v3/);
assert.match(routes, /release_candidate_results/);
assert.match(routes, /exam_room_prepare_class_result_export_v2/);
assert.match(routes, /exam_room_update_lifecycle_v1/);
assert.match(delivery, /exam_room_claim_email_batch_v2/);
assert.match(delivery, /exam_room_complete_email_v2/);
assert.match(delivery, /claim_token/);
assert.doesNotMatch(delivery, /Sending seals the examination record/);

assert.match(frontend, /id="dd26-attempt-review"[^>]*>Review All Answers<[\s\S]*id="dd26-attempt-submit"[^>]*>Submit</);
assert.match(frontend, /Review every question and answer/);
assert.match(frontend, /release_candidate_results/);
assert.match(frontend, /End student access/);
assert.match(frontend, /Mark exam complete/);
assert.match(frontend, /Archive exam/);
assert.doesNotMatch(frontend, /Final sending remains a separate class-wide action that seals the examination/);
assert.doesNotMatch(frontend, /Sending is class-wide/);
assert.match(frontend, /!excludedLocalWork/);

console.log('Examination Room reliability, candidate release, queue, lifecycle, and recovery contracts passed.');
