import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PEDRO_ACTION_LABELS, PEDRO_FIXED_RESPONSES } from '../worker/pedro-core.mjs';

const file = new URL('../supabase/migrations/20260827143000_pedro_private_study_inbox.sql', import.meta.url);
const sql = readFileSync(file, 'utf8');
const normalized = sql.replace(/\r\n/g, '\n');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function functionSql(name) {
  const startMarker = `create or replace function public.${name}(`;
  const start = normalized.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = normalized.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return normalized.slice(start, end + 4);
}

assert.match(normalized, /^-- Due Diligence Release 2:[\s\S]*\nbegin;/);
assert.equal((normalized.match(/^begin;$/gm) || []).length, 1);
assert.equal((normalized.match(/^commit;$/gm) || []).length, 1);
assert.match(normalized, /commit;\s*$/);

for (const table of ['pedro_threads', 'pedro_turns', 'pedro_actions']) {
  assert.match(normalized, new RegExp(`create table public\\.${table} \\(`));
  assert.match(normalized, new RegExp(`alter table public\\.${table} enable row level security;`));
  assert.match(normalized, new RegExp(`alter table public\\.${table} force row level security;`));
  assert.match(normalized, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
  assert.match(normalized, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role;`));
}
assert.doesNotMatch(normalized, /create policy[\s\S]*on public\.pedro_/i);
assert.doesNotMatch(normalized, /grant [^;]+ on public\.pedro_(?:threads|turns|actions) to (?:public|anon|authenticated)/i);

const functions = [
  'pedro_access_snapshot',
  'pedro_message_json',
  'pedro_reserve_turn',
  'pedro_search_published_content',
  'pedro_complete_turn',
  'pedro_fail_turn',
  'pedro_history',
  'subject_matter_target_question',
  'pedro_resolve_action',
];
for (const name of functions) {
  const body = functionSql(name);
  assert.match(body, /security definer\nset search_path = ''\nas \$\$/);
  assert.match(normalized, new RegExp(`revoke all on function public\\.${name}\\(`));
  assert.match(normalized, new RegExp(`grant execute on function public\\.${name}\\(`));
}
assert.equal((normalized.match(/security definer\nset search_path = ''/g) || []).length, functions.length);

const access = functionSql('pedro_access_snapshot');
assert.match(access, /coalesce\(authenticated_user\.is_anonymous, false\) is false/);
assert.match(access, /acceptance\.terms_version = settings\.current_terms_version/);
assert.match(access, /acceptance\.privacy_version = settings\.current_privacy_version/);
assert.match(access, /payment\.subscription_id = subscription\.id/);
assert.match(access, /payment\.user_id = subscription\.user_id/);
assert.match(access, /payment\.status = 'approved'/);
assert.match(access, /subscription\.status = 'active'/);
assert.match(access, /subscription\.source = 'manual_payment'/);
assert.match(access, /subscription\.starts_at <= v_now/);
assert.match(access, /subscription\.expires_at is null or subscription\.expires_at > v_now/);
assert.match(access, /v_role in \('founder_admin', 'super_admin'\)/);
assert.doesNotMatch(access, /phase4_access_snapshot|global_beta_all_access|complimentary|admin_adjustment|migration|trial|provisional|founding_beta|free_beta/i);

assert.match(normalized, /unique \(user_id, access_kind, request_key\)/);
assert.match(normalized, /foreign key \(thread_id, user_id, access_kind\)/);
assert.match(normalized, /status = 'reserved'[\s\S]*lease_expires_at is not null[\s\S]*failure_class is null/);
assert.match(normalized, /status = 'completed'[\s\S]*lease_expires_at is null[\s\S]*response_text is not null/);
assert.match(normalized, /status in \('failed_retryable', 'failed_terminal'\)[\s\S]*failure_class is not null/);
assert.match(normalized, /mock_question_id is not null[\s\S]*mock_subject is not null/);
assert.match(normalized, /pedro_actions_syllabus_version_question_fkey[\s\S]*examination_version_questions\(version_id, question_id\)/);
assert.match(normalized, /payment_requests_pedro_entitlement_idx[\s\S]*\(subscription_id, user_id\)[\s\S]*where status = 'approved' and subscription_id is not null/);

const reserve = functionSql('pedro_reserve_turn');
assert.match(reserve, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(/);
assert.match(reserve, /request_key = v_request_key/);
assert.match(reserve, /v_turn\.input_sha256 <> v_input_hash/);
assert.match(reserve, /interval '90 seconds'/);
assert.match(reserve, /'state', 'in_progress'[\s\S]*'turnId', v_turn\.id[\s\S]*'retryAfterSeconds', v_retry_after_seconds/);
assert.equal((reserve.match(/'state', 'in_progress'/g) || []).length, 3);
assert.match(reserve, /'state', 'completed'[\s\S]*'accessKind', v_access_kind[\s\S]*'message', public\.pedro_message_json/);
assert.match(reserve, /'state', 'reserved'[\s\S]*'turnId', v_turn\.id[\s\S]*'claimVersion', v_turn\.claim_version[\s\S]*'accessKind', v_access_kind/);
assert.match(reserve, /'state', 'failed_terminal'[\s\S]*'turnId', v_turn\.id[\s\S]*'accessKind', v_access_kind/);
assert.doesNotMatch(reserve, /'testMode'/);
assert.match(reserve, />= 30 then/);
assert.match(reserve, />= 250 then/);
assert.match(reserve, /time zone 'Asia\/Manila'/);
const expiredLeaseReconciliation = reserve.indexOf('update public.pedro_turns expired_turn');
const existingRequestLookup = reserve.indexOf('from public.pedro_turns turn_record');
const competingTurnLookup = reserve.indexOf('and active_turn.id <> v_turn.id');
const retryReservation = reserve.indexOf("set status = 'reserved'", existingRequestLookup);
assert.ok(
  expiredLeaseReconciliation !== -1 && expiredLeaseReconciliation < existingRequestLookup,
  'Expired active leases must be reconciled before an idempotent request is looked up.',
);
assert.ok(
  competingTurnLookup !== -1 && competingTurnLookup < retryReservation,
  'A competing active turn must be checked before a failed request is reserved again.',
);
assert.match(reserve, /'turnId', v_active_turn\.id[\s\S]*'retryAfterSeconds', v_retry_after_seconds/);

const search = functionSql('pedro_search_published_content');
assert.match(search, /item\.current_published_version_id/);
assert.match(search, /version\.lifecycle_state = 'published'/);
assert.match(search, /definition\.status = 'published'/);
assert.match(search, /version\.status = 'published'/);
assert.match(search, /question\.source_type = 'google_sheet'/);
assert.match(search, /question\.review_status = 'approved'/);
assert.match(search, /question\.publication_ready = true/);
assert.match(search, /history_version_question\.question_id = question\.id/);
assert.match(search, /question\.id = any\(cycle\.seen_question_ids\)/);
assert.match(search, /history_attempt\.subject_matter_skipped_at is not null/);
assert.doesNotMatch(search, /'id', stable_id|'topic', topic|'score', score/);
assert.doesNotMatch(search, /model_answer|prompt_text|legal_basis|source_urls|provider|gemini|generativelanguage/i);
for (const key of ['type', 'title', 'subject', 'contentId', 'versionId', 'questionId']) {
  assert.match(search, new RegExp(`'${key}'`));
}

const complete = functionSql('pedro_complete_turn');
assert.match(complete, /or p_claim_version is null\n\s+or v_turn\.claim_version <> p_claim_version/);
assert.doesNotMatch(complete, /p_response_text/i);
assert.match(complete, /jsonb_typeof\(v_action\) <> 'object'/);
assert.equal((complete.match(/jsonb_object_keys\(v_action\) as action_keys\(action_key\)/g) || []).length, 3);
assert.match(complete, /response_text = v_response_text/);
assert.match(complete, /item\.current_published_version_id/);
assert.match(complete, /question\.review_status = 'approved'/);
assert.match(complete, /question\.publication_ready = true/);
assert.doesNotMatch(complete, /gemini|generativelanguage|p_response_text/i);

for (const [kind, text] of Object.entries(PEDRO_FIXED_RESPONSES)) {
  const literal = escapeRegExp(sqlLiteral(text));
  if (kind === 'website_help_pedro') {
    assert.match(complete, new RegExp(`else ${literal}`));
  } else {
    assert.match(complete, new RegExp(`when '${escapeRegExp(kind)}' then ${literal}`));
  }
}
for (const label of Object.values(PEDRO_ACTION_LABELS)) {
  assert.equal((normalized.match(new RegExp(escapeRegExp(sqlLiteral(label)), 'g')) || []).length, 2);
}

const fail = functionSql('pedro_fail_turn');
for (const failureClass of ['capacity', 'timeout', 'search_unavailable', 'persistence_unavailable', 'unavailable']) {
  assert.match(fail, new RegExp(`when '${failureClass}' then`));
}
assert.match(fail, /or p_claim_version is null\n\s+or v_turn\.claim_version <> p_claim_version/);

const history = functionSql('pedro_history');
assert.match(history, /p_user_id uuid,\n\s+p_thread_id uuid,\n\s+p_limit integer,\n\s+p_before_created_at timestamptz,\n\s+p_before_turn_id uuid/);
assert.match(history, /thread_record\.id = p_thread_id[\s\S]*thread_record\.user_id = p_user_id[\s\S]*thread_record\.access_kind = v_access ->> 'accessKind'/);
assert.match(history, /turn_record\.id = p_before_turn_id[\s\S]*turn_record\.thread_id = v_thread\.id[\s\S]*turn_record\.user_id = p_user_id/);
assert.match(history, /\(turn_record\.created_at, turn_record\.id\)[\s\S]*< \(v_cursor_created_at, p_before_turn_id\)/);
assert.match(history, /limit v_message_limit/);
assert.match(normalized, /revoke all on function public\.pedro_history\(uuid, uuid, integer, timestamptz, uuid\)/);
assert.match(normalized, /grant execute on function public\.pedro_history\(uuid, uuid, integer, timestamptz, uuid\) to service_role/);

const target = functionSql('subject_matter_target_question');
assert.match(target, /v_access := public\.pedro_access_snapshot\(p_user_id\)/);
assert.match(target, /public\.examination_authorize_access\([\s\S]*'per_subject'/);
assert.match(target, /'subject-cycle:' \|\| p_user_id::text/);
assert.match(target, /for update of cycle/);
assert.match(target, /for update of attempt/);
assert.match(target, /active_attempt\.version_id <> p_version_id/);
assert.match(target, /p_question_id = any\(v_cycle\.seen_question_ids\)/);
assert.match(target, /history_version_question\.question_id = p_question_id/);
assert.match(target, /history_attempt\.subject_matter_skipped_at is not null/);

const resolve = functionSql('pedro_resolve_action');
assert.match(resolve, /action_record\.user_id = p_user_id/);
assert.match(resolve, /turn_record\.access_kind = v_access ->> 'accessKind'/);
assert.match(resolve, /item\.current_published_version_id/);
assert.match(resolve, /v_syllabus_selection := public\.subject_matter_target_question/);
assert.match(resolve, /v_target := pg_catalog\.jsonb_build_object\(\n\s+'versionId', v_syllabus_selection -> 'versionId',\n\s+'questionId', v_syllabus_selection -> 'questionId'\n\s+\)/);

assert.doesNotMatch(normalized, /alter table public\.examination_/i);
assert.doesNotMatch(normalized, /create table public\.examination_/i);
assert.doesNotMatch(normalized, /gemini|generative language|generativelanguage\.googleapis\.com/i);

console.log('Pedro migration security, entitlement, idempotency, pagination, publication, fixed-copy, and no-repeat contracts passed.');
