import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const loader = read('assets/feature-loader.js');
const workspace = read('assets/private-workspace.js');
const study = read('assets/study-workspace.js');
const serviceWorker = read('service-worker.js');
const offline = read('offline.html');
const migration = read('supabase/migrations/20260813151040_master_experience_privacy_offline_foundation_20260813.sql');

assert.match(index, /<h1 id="pb-pillars-title">Prepare with purpose\.<\/h1>/);
assert.match(index, /data-public-home/);
assert.match(index, /id="spa-community"[^>]*data-public-feature="quorum"/);
assert.match(index, /<summary>Practice Exam<\/summary>/);
assert.match(index, /id="site-menu-toggle"[^>]*aria-controls="spa-nav"/);
assert.match(index, /assets\/private-workspace\.js\?v=master-experience-20260813-1/);
assert.match(index, /assets\/feature-loader\.js\?v=non-exam-sweep-20260822-1/);
assert.doesNotMatch(index, /<script[^>]+src="assets\/(?:lex-forum|examinations|duediligence-2026)\.js/);
assert.doesNotMatch(index, /<link[^>]+href="assets\/(?:lex-forum|examinations|duediligence-2026)\.css/);

for (const group of ['quorum', 'examinations', 'content', 'examinationRoom']) {
  assert.match(loader, new RegExp(`${group}: Object\\.freeze`));
}
assert.match(loader, /await Promise\.all\(manifests\[group\]\.styles\.map\(loadStyle\)\)/);
assert.match(loader, /for \(const script of manifests\[group\]\.scripts\) await loadScript\(script\)/);

assert.match(workspace, /duediligence\.private/);
assert.match(workspace, /legacy-quarantine-marker/);
assert.match(workspace, /duediligence:workspace-identity/);
assert.match(workspace, /event\.persisted/);
assert.match(workspace, /duediligence\.answer\.drafts\.v1/);

assert.match(study, /indexedDB\.open/);
assert.match(study, /DueDiligencePrivateWorkspace/);
assert.match(study, /study\/annotations\/query/);
assert.match(study, /study\/annotations\/command/);
assert.match(study, /conflict/i);
assert.doesNotMatch(study, /localStorage\.setItem\([^\n]*note/i);

assert.match(serviceWorker, /request\.method !== 'GET'/);
assert.match(serviceWorker, /request\.headers\.has\('authorization'\)/);
assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
assert.doesNotMatch(serviceWorker, /['"]\/(?:grading|examinations|quorum|study)(?:\/|['"])/i);
assert.doesNotMatch(serviceWorker, /skipWaiting|clients\.claim/);
assert.match(offline, /offline\.owner-hint\.v1/);
assert.match(offline, /indexedDB\.open/);

for (const contract of [
  'forum_ensure_anonymous_alias',
  'forum_anonymous_profile',
  'forum_lock_published_identity_mode',
  'forum_resolve_anonymous_identity_v2',
  'forum_quorum_admin_safe',
  'study_annotations',
  'study_annotation_query',
  'study_annotation_command',
]) {
  assert.ok(migration.includes(contract), `Migration must include ${contract}.`);
}
assert.match(migration, /alter table public\.study_annotations enable row level security/);
assert.match(migration, /alter table public\.study_annotations force row level security/);
assert.match(migration, /revoke all on public\.study_annotations from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on public\.study_annotations to service_role/);
assert.match(migration, /revoke all on function public\.forum_ensure_anonymous_alias\(uuid,uuid\) from public, anon, authenticated/);
assert.match(migration, /revoke all on function public\.forum_anonymous_profile\(uuid,uuid\) from public, anon, authenticated/);
assert.match(migration, /raise exception 'FORUM_IDENTITY_MODE_IMMUTABLE'/);
assert.match(migration, /comment_id uuid references public\.forum_comments\(id\) on delete cascade/);

console.log('Master experience release contract checks passed.');
