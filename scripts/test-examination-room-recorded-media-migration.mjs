import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260828123000_examination_room_recorded_media.sql',
  import.meta.url,
);
const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

function requires(pattern, message) {
  assert.match(migration, pattern, message);
}

function forbids(pattern, message) {
  assert.doesNotMatch(migration, pattern, message);
}

requires(/insert into storage\.buckets[\s\S]+?'examination-room-media'[\s\S]+?false[\s\S]+?67108864[\s\S]+?'application\/octet-stream'/iu,
  'recorded media must use a private, 64 MB, encrypted-object-only bucket');
requires(/on conflict \(id\) do update[\s\S]+?public = false/iu,
  'an existing bucket must be corrected back to private');
forbids(/create\s+policy[\s\S]+?examination-room-media/iu,
  'the migration must not grant anonymous or signed-in clients direct bucket policies');

requires(/create table examination_room_v1\.media_upload_intents/iu,
  'service-only upload intent metadata is required');
requires(/alter table examination_room_v1\.media_upload_intents enable row level security/iu,
  'upload intents must enable RLS');
requires(/alter table examination_room_v1\.media_upload_intents force row level security/iu,
  'upload intents must force RLS');
requires(/revoke all on examination_room_v1\.media_upload_intents from public, anon, authenticated, service_role/iu,
  'even service-role callers must use the narrow RPC instead of direct table access');

requires(/wrapped_key_algorithm[\s\S]+?aes-256-gcm-v1/iu,
  'the wrapped-key algorithm must be explicit');
requires(/wrapped_key_ciphertext/iu, 'only wrapped key ciphertext may be retained');
requires(/wrapped_key_iv/iu, 'AES-GCM IV metadata is required');
requires(/wrapped_key_aad_sha256/iu, 'AES-GCM associated-data binding is required');
forbids(/^\s*(?:raw_|derived_)?key\s+(?:text|bytea)/imu,
  'no plaintext, raw, or derived key column may exist');
forbids(/^\s*(?:media_|object_)?bytes\s+(?:bytea|text)/imu,
  'media binary must never be persisted in Postgres');

requires(/constraint media_upload_intents_session_artifact_key unique \(session_id, client_artifact_id\)/iu,
  'client artifact registration must be idempotent per session');
requires(/constraint media_upload_intents_session_request_key unique \(session_id, request_hash\)/iu,
  'request fingerprints must not be reusable for a different artifact');
requires(/for update[\s\S]+?existing\.intent_status = 'completed'[\s\S]+?'duplicate', true/iu,
  'replayed completions must return the existing record');

requires(/create function public\.examination_room_v1_media\([\s\S]+?security definer/iu,
  'a narrow service RPC is required');
requires(/revoke all on function public\.examination_room_v1_media\(text, jsonb\) from public, anon, authenticated/iu,
  'public and user roles must not execute the media RPC');
requires(/grant execute on function public\.examination_room_v1_media\(text, jsonb\) to service_role/iu,
  'only the Worker service role may invoke the media RPC');

requires(/s\.id = session_id[\s\S]+?s\.session_token_hash = session_token_hash/iu,
  'media operations must reuse the existing student session-token verifier');
requires(/if session_status = 'revoked'/iu,
  'revoked sessions must be rejected');
forbids(/session_status\s+not\s+in\s*\([^)]*submitted/iu,
  'submitted sessions must remain eligible to finish an upload');
forbids(/auth\.uid\(\)|staff_memberships|professor_access|professor_role/iu,
  'media authentication must be session-token based and independent of account roles');

requires(/provider in \('google_drive', 'supabase_storage', 'local_queue'\)/iu,
  'Drive primary, private Supabase fallback, and local queue metadata must be modeled');
requires(/providerVerified[\s\S]+?<> 'true'/iu,
  'completion must be verified by the Worker before registration');
requires(/insert into examination_room_v1\.proctoring_artifacts/iu,
  'completed encrypted objects must use the existing evidence table');
requires(/on conflict \(encrypted_object_reference\) do nothing/iu,
  'artifact creation must be idempotent by encrypted object reference');
requires(/'media-intent-v1:' \|\| existing\.id::text/iu,
  'the evidence row must retain only an opaque encrypted-key reference');
requires(/provider_result::text !~\* [^\n]+(?:url|token|secret|authorization)/iu,
  'provider credentials and signed destinations must be rejected from persisted results');

requires(/student\.media\.reserve/iu, 'media reservation must be audited');
requires(/student\.media\.complete/iu, 'media completion must be audited');
requires(/No media bytes, raw session token, raw derived key, OAuth credential, signed URL/iu,
  'the table contract must document its no-binary/no-secret boundary');

console.log('Examination Room recorded-media migration contract passed.');
