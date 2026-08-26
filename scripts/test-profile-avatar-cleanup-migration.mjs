import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL(
  '../supabase/migrations/20260827144000_profile_avatar_cleanup_queue.sql',
  import.meta.url,
);
const sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

assert.match(sql, /^-- Due Diligence Release 2:[\s\S]*\nbegin;/);
assert.equal((sql.match(/^begin;$/gm) || []).length, 1);
assert.equal((sql.match(/^commit;$/gm) || []).length, 1);
assert.match(sql, /commit;\s*$/);

assert.match(sql, /create table if not exists public\.forum_profile_avatar_cleanup_jobs \(/);
assert.match(sql, /object_path text primary key/);
assert.match(sql, /user_id uuid references auth\.users\(id\) on delete set null/);
assert.match(sql, /not_before timestamptz not null default now\(\)/);
assert.match(sql, /attempt_count integer not null default 0/);
assert.match(sql, /check \(object_path ~ '\^profiles\/\[a-f0-9\]\{24\}\\\.\(jpg\|png\|webp\)\$'\)/);
assert.match(sql, /forum_profile_avatar_cleanup_jobs_user_idx[\s\S]*\(user_id\)[\s\S]*where user_id is not null/);
assert.match(sql, /alter table public\.forum_profile_avatar_cleanup_jobs enable row level security;/);
assert.match(sql, /alter table public\.forum_profile_avatar_cleanup_jobs force row level security;/);
assert.match(sql, /revoke all on public\.forum_profile_avatar_cleanup_jobs from public, anon, authenticated;/);
assert.match(sql, /grant select, insert, update, delete on public\.forum_profile_avatar_cleanup_jobs to service_role;/);
assert.doesNotMatch(sql, /create policy/i);

const functionStart = sql.indexOf('create or replace function public.forum_set_profile_avatar(');
const functionEnd = sql.indexOf('\n$$;', functionStart);
assert.notEqual(functionStart, -1);
assert.notEqual(functionEnd, -1);
const body = sql.slice(functionStart, functionEnd + 4);

assert.match(body, /security definer\nset search_path = ''\nas \$\$/);
assert.match(body, /pg_catalog\.pg_advisory_xact_lock\([\s\S]*pg_catalog\.hashtextextended\(p_user_id::text, 74192\)/);
assert.match(body, /from public\.forum_profile_avatars as avatar[\s\S]*for update;/);
assert.match(body, /if v_old_path is not null and v_old_path <> v_path then[\s\S]*insert into public\.forum_profile_avatar_cleanup_jobs/);
assert.match(body, /on conflict \(object_path\) do update/);
assert.match(body, /insert into public\.forum_profile_avatars[\s\S]*on conflict \(user_id\) do update/);
assert.ok(
  body.indexOf('insert into public.forum_profile_avatar_cleanup_jobs')
    < body.indexOf('insert into public.forum_profile_avatars'),
  'the old path must be queued in the same transaction before the active pointer changes',
);
assert.match(body, /'cleanupQueued', v_old_path is not null and v_old_path <> v_path/);
assert.match(sql, /revoke all on function public\.forum_set_profile_avatar\(uuid, jsonb\)[\s\S]*from public, anon, authenticated;/);
assert.match(sql, /grant execute on function public\.forum_set_profile_avatar\(uuid, jsonb\)[\s\S]*to service_role;/);

const cleanupStart = sql.indexOf('create or replace function public.forum_profile_avatar_cleanup_state(');
const cleanupEnd = sql.indexOf('\n$$;', cleanupStart);
assert.notEqual(cleanupStart, -1);
assert.notEqual(cleanupEnd, -1);
const cleanupBody = sql.slice(cleanupStart, cleanupEnd + 4);
assert.match(cleanupBody, /security definer\nset search_path = ''\nas \$\$/);
assert.match(cleanupBody, /from public\.forum_profile_avatar_cleanup_jobs as cleanup[\s\S]*where cleanup\.object_path = v_path;/);
assert.match(cleanupBody, /pg_catalog\.pg_advisory_xact_lock\([\s\S]*pg_catalog\.hashtextextended\(v_user_id::text, 74192\)/);
assert.ok(
  cleanupBody.indexOf('pg_catalog.pg_advisory_xact_lock')
    < cleanupBody.indexOf('for update;'),
  'cleanup must take the same per-user advisory lock before locking its queue row',
);
assert.match(cleanupBody, /if v_active_path = v_path then[\s\S]*delete from public\.forum_profile_avatar_cleanup_jobs[\s\S]*'state', 'active'/);
assert.match(cleanupBody, /'state', 'safe'/);
assert.match(sql, /revoke all on function public\.forum_profile_avatar_cleanup_state\(text\)[\s\S]*from public, anon, authenticated;/);
assert.match(sql, /grant execute on function public\.forum_profile_avatar_cleanup_state\(text\)[\s\S]*to service_role;/);

const triggerStart = sql.indexOf('create or replace function public.forum_enqueue_profile_avatar_cleanup_on_delete()');
const triggerEnd = sql.indexOf('\n$$;', triggerStart);
assert.notEqual(triggerStart, -1);
assert.notEqual(triggerEnd, -1);
const triggerBody = sql.slice(triggerStart, triggerEnd + 4);
assert.match(triggerBody, /security definer\nset search_path = ''\nas \$\$/);
assert.match(triggerBody, /insert into public\.forum_profile_avatar_cleanup_jobs/);
assert.match(triggerBody, /old\.object_path/);
assert.match(triggerBody, /old\.object_path,\n\s+null,\n\s+pg_catalog\.now\(\) \+ interval '10 minutes'/);
assert.match(sql, /create trigger forum_profile_avatar_cleanup_on_delete[\s\S]*before delete on public\.forum_profile_avatars[\s\S]*execute function public\.forum_enqueue_profile_avatar_cleanup_on_delete\(\)/);
assert.match(sql, /revoke all on function public\.forum_enqueue_profile_avatar_cleanup_on_delete\(\)[\s\S]*from public, anon, authenticated;/);

const deferStart = sql.indexOf('create or replace function public.forum_defer_profile_avatar_cleanup(');
const deferEnd = sql.indexOf('\n$$;', deferStart);
assert.notEqual(deferStart, -1);
assert.notEqual(deferEnd, -1);
const deferBody = sql.slice(deferStart, deferEnd + 4);
assert.match(deferBody, /security definer\nset search_path = ''\nas \$\$/);
assert.match(deferBody, /attempt_count = cleanup\.attempt_count \+ 1/);
assert.match(deferBody, /not_before = pg_catalog\.now\(\) \+ case cleanup\.attempt_count/);
assert.match(deferBody, /else interval '1 hour'/);
assert.match(sql, /revoke all on function public\.forum_defer_profile_avatar_cleanup\(text\)[\s\S]*from public, anon, authenticated;/);
assert.match(sql, /grant execute on function public\.forum_defer_profile_avatar_cleanup\(text\)[\s\S]*to service_role;/);

assert.doesNotMatch(sql, /alter table public\.examination_/i);
assert.doesNotMatch(sql, /create table (?:if not exists )?public\.examination_/i);

console.log('Profile avatar cleanup queue security and atomic replacement contracts passed.');
