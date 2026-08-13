import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, frontend, routes, core, index, delivery, wrangler] = await Promise.all([
  readFile(new URL('supabase/migrations/20260812044233_student_grade_email_delivery_confirmation.sql', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('worker/duediligence-2026-routes.mjs', root), 'utf8'),
  readFile(new URL('worker/exam-room-2026-core.mjs', root), 'utf8'),
  readFile(new URL('worker/index.mjs', root), 'utf8'),
  readFile(new URL('worker/exam-room-delivery.mjs', root), 'utf8'),
  readFile(new URL('worker/wrangler.toml', root), 'utf8'),
]);

assert.match(migration, /delivery_status in \([\s\S]*'accepted'[\s\S]*'delivered'[\s\S]*'bounced'/);
assert.match(migration, /create table if not exists public\.exam_room_email_delivery_events/);
assert.match(migration, /enable row level security/);
assert.match(migration, /force row level security/);
assert.match(migration, /revoke all on table public\.exam_room_email_delivery_events from public, anon, authenticated/);
assert.match(migration, /exam_room_record_email_delivery_event_v1/);
assert.match(migration, /on conflict \(provider_event_id\) do nothing/);
assert.match(migration, /p_provider_event_at >= provider_event_at/);
assert.match(migration, /exam_room_result_delivery_report_v1/);
assert.match(migration, /exam\.owner_professor_id = p_professor_user_id/);
assert.match(migration, /'retryable'[\s\S]*total_jobs between 1 and 3[\s\S]*<> 'delivered'/);
assert.match(migration, /exam_room_retry_student_result_email_v1/);
assert.match(migration, /v_existing_count >= 4/);
assert.match(migration, /'student_result', v_source\.payload/,
  'a retry must reuse the already released student-specific payload');
assert.match(migration, /'student_result_email_retried'/);
assert.doesNotMatch(migration, /(?:delete|truncate)\s+(?:from\s+)?public\.exam_room_(?:grades|submissions|attempts)/i);
assert.doesNotMatch(migration, /update\s+public\.exam_room_grades/i);
assert.doesNotMatch(migration, /providerId|provider_id'[),]/,
  'Professor-facing JSON must not expose provider identifiers');

assert.match(core, /'result_delivery_report'/);
assert.match(core, /'retry_student_result_email'/);
assert.match(routes, /exam_room_result_delivery_report_v2/);
assert.match(routes, /exam_room_retry_student_result_email_v2/);
assert.match(index, /pathname === '\/webhooks\/resend\/email'/);
assert.ok(index.indexOf("pathname === '/webhooks/resend/email'") < index.indexOf('const origin = assertOrigin'),
  'the signed server webhook must be routed before browser Origin enforcement');
assert.match(delivery, /verifyResendWebhookRequest/);
assert.match(delivery, /Math\.abs\(nowSeconds - numericTimestamp\) > 5 \* 60/);
assert.match(delivery, /crypto\.subtle\.sign/);
assert.match(wrangler, /RESEND_WEBHOOK_SECRET must remain an encrypted Worker secret/);

assert.match(frontend, /Provider-confirmed result delivery/);
assert.match(frontend, /Accepted by email provider; delivery not yet confirmed/);
assert.match(frontend, /data-dd26-retry-result-email/);
assert.match(frontend, /operation: 'retry_student_result_email'/);
assert.match(frontend, /Your saved grades remain in the official examination record/);
assert.match(frontend, /function preferredGradingFilter/);
assert.doesNotMatch(frontend, /RESEND_WEBHOOK_SECRET|RESEND_API_KEY/);

console.log('Student grade persistence, provider-confirmed delivery, and bounded retry checks passed.');
