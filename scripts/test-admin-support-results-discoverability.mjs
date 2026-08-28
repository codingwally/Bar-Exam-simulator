import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260828152931_admin_support_requester_identity.sql');
const historyMigration = read('supabase/migrations/20260828154159_bar_simulation_result_history.sql');
const worker = read('worker/index.mjs');
const adminCore = read('worker/admin-core.mjs');
const examinationsCore = read('worker/examinations-core.mjs');
const admin = read('admin/admin.js');
const adminIndex = read('admin/index.html');
const examinations = read('assets/examinations.js');
const examinationsCss = read('assets/examinations.css');
const featureLoader = read('assets/feature-loader.js');
const index = read('index.html');

assert.match(migration, /create or replace function public\.admin_support_queue_v1/);
assert.match(migration, /perform public\.admin_authorization_context\(p_actor_user_id\)/);
assert.match(migration, /admin_has_capability\(p_actor_user_id, 'support_admin'\)/);
for (const identityField of ['s.user_id', 'display_name', 'account_claimed_name', 'account_email', 's.reply_email', 'contact_email']) {
  assert.ok(migration.includes(identityField), `${identityField} must be returned to authorized Support administrators`);
}
assert.match(migration, /left join public\.profiles p on p\.id = s\.user_id/);
assert.match(migration, /left join auth\.users u on u\.id = s\.user_id/);
assert.match(migration, /target_resource_type = 'admin_support_queue_v1'/);
assert.match(migration, /'sensitive_data_viewed'/);
assert.match(migration, /'requestFingerprint'/);
assert.match(migration, /'searchFingerprint'/);
assert.match(migration, /revoke all on function public\.admin_support_queue_v1[\s\S]*from public, anon, authenticated, service_role/);
assert.match(migration, /grant execute on function public\.admin_support_queue_v1[\s\S]*to service_role/);

assert.match(worker, /query\.section === 'support'[\s\S]{0,220}admin_support_queue_v1/);
assert.match(worker, /admin_support_queue_v1'[\s\S]{0,260}p_actor_user_id: user\.id/);
assert.match(worker, /p_request_key: normalizeRequestKey\(request\.headers\.get\('X-Request-ID'\)\)/);
assert.match(adminCore, /const ADMIN_OPERATIONAL_MAX_OFFSET = 1_000_000/);
assert.match(adminCore, /Number\.isFinite\(requestedOffset\) \? Math\.trunc\(requestedOffset\) : 0/);
assert.match(adminCore, /Admin search exceeds 180 characters/);
assert.doesNotMatch(admin, /row\.display_name \|\| row\.account_claimed_name/);
assert.match(admin, /row\.display_name \|\| 'Not provided'/);
assert.match(admin, /row\.account_claimed_name \|\| 'Not provided'/);
assert.match(admin, /row\.account_email \|\| 'Not linked to an account'/);
assert.match(admin, /row\.reply_email \|\| 'Not provided'/);
assert.match(admin, /\['Profile name', 'Account-provided name', 'Account email', 'Reply email', 'Category', 'Message'/);
assert.match(admin, /function loadSupportQueue\(/);
assert.match(admin, /id="support-search"[\s\S]{0,400}id="support-search-button"/);
assert.match(admin, /id="support-progress"[\s\S]{0,180}matching support case\(s\)/);
assert.match(admin, /id="support-previous"[\s\S]{0,220}id="support-next"/);
assert.match(adminIndex, /support=requester-identity-20260828-1/);

assert.match(examinations, /function barSimulationHistoryMarkup\(\)/);
assert.match(examinations, /state\.history\.filter\(\(item\) => item\?\.track === 'bar_feels'\)/);
assert.match(examinations, /View score and feedback/);
assert.doesNotMatch(examinations, /View current feedback/);
assert.match(examinations, /data-history-request-ai/);
assert.match(examinations, /function requestAiAssessmentForAttempt\(button, attemptId, questionCount\)/);
assert.match(examinations, /function requestHistoricalAiAssessment\(button\)/);
assert.match(examinations, /requestHistoricalAiAssessment\(historicalAi\)/);
assert.match(examinations, /operation: 'history',[\s\S]{0,80}track: 'bar_feels'/);
assert.match(
  examinationsCore,
  /operation === 'history'[\s\S]{0,600}normalized\.track = trackProvided \? historyTrack : null/,
);
assert.match(examinationsCore, /INVALID_EXAMINATION_TRACK/);
assert.match(worker, /query\.operation === 'history'[\s\S]{0,180}track: query\.track,[\s\S]{0,80}allowHistorical: true/);
assert.match(historyMigration, /create or replace function public\.examination_history_by_track_v1/);
assert.match(historyMigration, /where a\.user_id = p_user_id[\s\S]{0,80}and d\.track = v_track/);
assert.match(historyMigration, /'total', v_total/);
assert.match(historyMigration, /'hasMore', v_offset \+ jsonb_array_length\(v_items\) < v_total/);
assert.match(historyMigration, /set search_path = ''/);
assert.match(historyMigration, /revoke all on function public\.examination_history_by_track_v1[\s\S]*from public, anon, authenticated, service_role/);
assert.match(historyMigration, /grant execute on function public\.examination_history_by_track_v1[\s\S]*to service_role/);
assert.match(worker, /query\.operation === 'history' && query\.track[\s\S]{0,120}examination_history_by_track_v1/);
assert.match(examinations, /data-history-load-more/);
assert.match(examinations, /function loadMoreBarSimulationHistory\(button\)/);
assert.match(examinations, /state\.historyOffset = offset \+ incoming\.length/);
assert.match(examinations, /state\.track !== 'bar_feels' \|\| state\.screen !== 'catalog' \|\| !button\.isConnected/);
assert.match(examinationsCss, /\.dd-bar-history-row/);
assert.match(examinationsCss, /\.dd-bar-history-pagination/);
assert.match(examinationsCss, /@media \(max-width: 720px\)/);
assert.match(featureLoader, /results=history-20260828-1/);
assert.match(index, /results=history-20260828-1/);

console.log('Admin Support identity and Bar Simulation result-discoverability contract passed.');
