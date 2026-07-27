import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260727_002_auth_user_data_analytics_foundation.sql",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");
const normalized = sql.replace(/\s+/g, " ").toLowerCase();
const fixture = await readFile(
  new URL(
    "../supabase/tests/fixtures/20260727_staging_existing_core_schema.sql",
    import.meta.url,
  ),
  "utf8",
);
const preflight = await readFile(
  new URL(
    "../supabase/review/phase1_production_preflight.sql",
    import.meta.url,
  ),
  "utf8",
);
const preflightExecutable = preflight.replace(/--.*$/gm, "");
const malformedPrimaryKeyFixture = await readFile(
  new URL(
    "../supabase/tests/fixtures/20260728_staging_malformed_primary_key.sql",
    import.meta.url,
  ),
  "utf8",
);
const malformedForeignKeyFixture = await readFile(
  new URL(
    "../supabase/tests/fixtures/20260728_staging_malformed_foreign_key.sql",
    import.meta.url,
  ),
  "utf8",
);

function has(pattern, message) {
  assert.match(sql, pattern, message);
}

function lacks(pattern, message) {
  assert.doesNotMatch(sql, pattern, message);
}

// Additive and repeatable object creation.
for (const table of [
  "terms_acceptances",
  "marketing_consents",
  "user_roles",
  "usage_sessions",
  "usage_events",
  "user_entitlements",
  "admin_audit_log",
]) {
  has(
    new RegExp(`create table if not exists public\\.${table}\\b`, "i"),
    `${table} must be created idempotently`,
  );
}
has(/add column if not exists school text/i, "school must be additive");
has(/add column if not exists enrollment_status text/i, "enrollment status must be additive");
has(/add column if not exists year_level text/i, "year level must be additive");
has(/add column if not exists profile_completed_at timestamptz/i, "completion timestamp must be additive");
has(/add column if not exists updated_at timestamptz/i, "updated timestamp must be additive");
lacks(/\bdrop\s+(table|column|schema)\b/i, "migration must not destructively drop schema objects");

// Profile ownership and field-level protection.
has(/profiles_select_own[\s\S]*auth\.uid\(\)[\s\S]*=\s*id/i, "profiles must be readable only by owner");
has(/profiles_update_own[\s\S]*auth\.uid\(\)[\s\S]*=\s*id/i, "profiles must be updateable only by owner");
for (const table of [
  "profiles",
  "subjects",
  "questions",
  "submissions",
  "grading_results",
  "calibration_examples",
  "grade_disputes",
]) {
  assert.ok(
    normalized.includes(`public.${table}`),
    `${table} must be included in core-table grant hardening`,
  );
}
has(
  /revoke all privileges on table[\s\S]*public\.profiles[\s\S]*public\.subjects[\s\S]*public\.questions[\s\S]*public\.submissions[\s\S]*public\.grading_results[\s\S]*public\.calibration_examples[\s\S]*public\.grade_disputes[\s\S]*from public, anon, authenticated/i,
  "all PUBLIC and broad client grants on the seven core tables must be revoked",
);
has(
  /grant select on table public\.subjects, public\.questions[\s\S]*to anon, authenticated/i,
  "public subjects and questions must remain read-only",
);
has(
  /grant select, insert on table public\.submissions to authenticated/i,
  "authenticated students must retain owner-scoped submission creation",
);
has(
  /grant select, insert on table public\.grade_disputes to authenticated/i,
  "authenticated students must retain owner-scoped dispute creation",
);
has(
  /grant update \(display_name, school, enrollment_status, year_level\)[\s\S]*on public\.profiles to authenticated/i,
  "only approved personal profile columns may be updated",
);
lacks(
  /grant update\s*\([^)]*(subscription_tier|subscription_status|profile_completed_at)/i,
  "subscription and administrative profile columns must never be client-updateable",
);
has(
  /grade_disputes_insert_own[\s\S]*submissions\.id = grade_disputes\.submission_id[\s\S]*submissions\.user_id = \(select auth\.uid\(\)\)/i,
  "grade disputes must reference a submission owned by the authenticated user",
);
for (const legacyPolicy of [
  "subjects_select_all",
  "questions_select_all",
]) {
  has(
    new RegExp(`drop policy if exists ${legacyPolicy}`, "i"),
    `${legacyPolicy} must be removed from the audited production baseline`,
  );
}
for (const securedPolicy of [
  "profiles_select_own",
  "profiles_update_own",
  "subjects_public_read",
  "questions_public_read",
  "submissions_select_own",
  "submissions_insert_own",
  "grading_results_select_own",
  "grade_disputes_select_own",
  "grade_disputes_insert_own",
]) {
  has(
    new RegExp(`create policy ${securedPolicy}[\\s\\S]*?to (?:authenticated|anon, authenticated)`, "i"),
    `${securedPolicy} must be recreated for explicit API roles instead of PUBLIC`,
  );
}

// Onboarding requires a matching versioned acceptance.
has(/unique \(user_id, terms_version, privacy_version\)/i, "terms acceptance must be versioned");
has(/accepted_at timestamptz not null default now\(\)/i, "terms acceptance must be timestamped");
has(
  /p_terms_version text default 'terms-beta-v1-2026-08-15'/i,
  "accepted beta Terms version must be the RPC default",
);
has(
  /p_privacy_version text default 'privacy-beta-v1-2026-08-15'/i,
  "accepted beta Privacy version must be the RPC default",
);
has(
  /raise exception 'Current Terms and Privacy versions are required'/i,
  "onboarding must reject unapproved legal-document versions",
);
has(
  /complete_profile_onboarding[\s\S]*from public\.terms_acceptances[\s\S]*terms_version = btrim\(p_terms_version\)/i,
  "onboarding completion must verify accepted terms",
);

// Marketing is optional, false by default, and append-only through an RPC.
has(/opted_in boolean not null default false/i, "marketing consent must default false");
has(/record_marketing_consent[\s\S]*insert into public\.marketing_consents/i, "consent changes must append history");
has(/coalesce\(p_opted_in, false\)/i, "null consent input must remain opted out");
has(
  /record_marketing_consent[\s\S]*clock_timestamp\(\)/i,
  "consent history must preserve call-time ordering inside one transaction",
);
has(/revoke all on public\.marketing_consents from anon, authenticated/i, "clients must not mutate consent history directly");

// Role assignment is immutable-ID based and super-admin controlled.
has(/role in \('student', 'admin', 'super_admin'\)/i, "role vocabulary must be constrained");
has(/values \(new\.id, 'student'\)/i, "ordinary users must default to student");
has(/not public\.is_super_admin\(\)/i, "role assignment must require super_admin");
has(/p_target_user_id = v_actor_user_id/i, "self-directed role changes must be rejected");
has(/from auth\.users where id = p_target_user_id/i, "target role holder must already exist in auth.users");
has(/revoke all on public\.user_roles from anon, authenticated/i, "role table writes must not be public");
has(
  /bootstrap_first_super_admin[\s\S]*where role = 'super_admin'[\s\S]*raise exception 'A super administrator already exists'/i,
  "initial super-admin bootstrap must be one-time",
);
has(
  /revoke all on function public\.bootstrap_first_super_admin\(uuid, text\)[\s\S]*from public, anon, authenticated/i,
  "initial bootstrap must not be executable by browser roles",
);

// Analytics is nullable for guests, excludes answer text/secrets, and is server-write only.
has(/user_id uuid references auth\.users\(id\) on delete set null/i, "analytics user ID must be nullable");
has(/anonymous_session_id uuid/i, "analytics must support anonymous session identifiers");
has(/last_seen_at timestamptz not null default now\(\)/i, "presence heartbeat timestamp is required");
has(
  /last_seen_at >= now\(\) - interval '5 minutes'/i,
  "active viewers must use the approved five-minute heartbeat window",
);
for (const forbiddenKey of [
  "answer",
  "answer_text",
  "student_answer",
  "email",
  "password",
  "token",
  "api_key",
  "ip",
  "ip_address",
  "raw_ip",
]) {
  assert.ok(normalized.includes(`'${forbiddenKey}'`), `${forbiddenKey} must be rejected from analytics metadata`);
}
has(
  /jsonb_has_forbidden_keys[\s\S]*jsonb_each[\s\S]*jsonb_array_elements/i,
  "analytics metadata validation must recurse through objects and arrays",
);
has(/revoke all on public\.usage_sessions from anon, authenticated/i, "session writes must be backend-only");
has(/revoke all on public\.usage_events from anon, authenticated/i, "event writes must be backend-only");

// Audit records are immutable to students/admins and readable only by super_admin.
has(/admin_audit_log_super_admin_select[\s\S]*is_super_admin\(\)/i, "audit reads must require super_admin");
has(/revoke all on public\.admin_audit_log from anon, authenticated/i, "audit writes must be backend-only");
has(/insert into public\.admin_audit_log/i, "privileged role operations must write an audit record");

// Existing production systems and identifiers are outside this migration.
lacks(/\balter table public\.(questions|submissions|grading_results)\b/i, "grading tables must remain untouched");
lacks(/\blab-\d{3}\b/i, "question identifiers must not be embedded or changed");
lacks(/gmail\.com/i, "founder Gmail addresses must not be committed");
lacks(/service_role.*=/i, "service-role secrets must not be committed");

// Production-faithful staging baseline: broad legacy grants and no invented
// UNIQUE/CHECK constraints.
assert.match(
  fixture,
  /grant all privileges on table[\s\S]*public\.profiles[\s\S]*public\.grade_disputes[\s\S]*to anon, authenticated, service_role/i,
  "fixture must reproduce broad legacy grants",
);
assert.doesNotMatch(
  fixture,
  /\bname text not null unique\b/i,
  "fixture must not invent a subjects.name UNIQUE constraint",
);
assert.doesNotMatch(
  fixture,
  /\bsubmission_id uuid not null unique\b/i,
  "fixture must not invent a grading_results.submission_id UNIQUE constraint",
);
assert.doesNotMatch(
  fixture,
  /\bcheck\s*\(\s*(word_count|time_spent_seconds)/i,
  "fixture must not invent submission non-negative CHECK constraints",
);
assert.match(
  fixture,
  /sort_order integer not null default 0/i,
  "fixture must preserve the production subjects.sort_order default",
);
assert.match(
  fixture,
  /question_no integer/i,
  "fixture must preserve the production integer question number",
);
assert.match(
  fixture,
  /word_count integer,\s*[\r\n]+\s*time_spent_seconds integer,/i,
  "fixture must preserve nullable submission metrics without defaults",
);
assert.match(
  fixture,
  /feedback_json jsonb,/i,
  "fixture must preserve nullable grading feedback without a default",
);
assert.match(
  fixture,
  /status text not null default 'open'/i,
  "fixture must preserve the production dispute status default",
);
assert.match(
  fixture,
  /create policy subjects_select_all[\s\S]*create policy questions_select_all/i,
  "fixture must preserve the audited legacy public-read policy names",
);
assert.doesNotMatch(
  fixture,
  /create policy profiles_select_own[\s\S]*?to authenticated/i,
  "fixture must preserve the audited PUBLIC profile policy role",
);

// Production preflight must remain read-only and fail-fast on drift.
assert.match(
  preflight,
  /PHASE1_PREFLIGHT_TABLE_DRIFT/,
  "preflight must fail on table drift",
);
assert.match(
  preflight,
  /PHASE1_PREFLIGHT_COLUMN_DRIFT/,
  "preflight must fail on column drift",
);
assert.match(
  preflight,
  /PHASE1_PREFLIGHT_RLS_DRIFT/,
  "preflight must fail on RLS drift",
);
assert.match(
  preflight,
  /PHASE1_PREFLIGHT_FOREIGN_KEY_DRIFT/,
  "preflight must fail on foreign-key drift",
);
assert.match(
  preflight,
  /source_columns[\s\S]*referenced_columns[\s\S]*unnest\(con\.conkey\)[\s\S]*unnest\(con\.confkey\)/i,
  "preflight must compare exact foreign-key source and referenced columns",
);
assert.match(
  preflight,
  /with expected\(table_name, constraint_name, key_columns\)[\s\S]*PHASE1_PREFLIGHT_PRIMARY_KEY_DRIFT/i,
  "preflight must compare exact primary-key constraints and columns",
);
assert.match(
  malformedPrimaryKeyFixture,
  /grade_disputes_pkey primary key \(user_id\)/i,
  "negative staging fixture must preserve the PK name while changing its constrained column",
);
assert.match(
  malformedForeignKeyFixture,
  /submissions_question_id_fkey[\s\S]*references public\.subjects\(id\)/i,
  "negative staging fixture must preserve the FK name while changing its referenced table",
);
assert.match(
  preflight,
  /policy_roles[\s\S]*permissive_mode[\s\S]*using_expression[\s\S]*check_expression/i,
  "preflight must compare complete RLS policy signatures",
);
assert.match(
  preflight,
  /aclexplode[\s\S]*acl\.grantee = 0[\s\S]*unexpected PUBLIC grant/i,
  "preflight must validate direct grant provenance and reject PUBLIC grants",
);
assert.match(
  preflight,
  /PHASE1_PREFLIGHT_GRANT_DRIFT/,
  "preflight must fail on grant drift",
);
assert.match(
  preflight,
  /\('questions', 'question_no', 'int4', 'YES', null::text\)/i,
  "preflight must preserve the production integer question number",
);
assert.match(
  preflight,
  /\('profiles', 'profiles_update_own', 'permissive', array\['public'\]::text\[\], 'UPDATE', 'auth\.uid=id', ''\)/i,
  "preflight must preserve the audited legacy PUBLIC profile policy signature",
);
assert.match(
  preflight,
  /\('questions', 'questions_subject_id_fkey'[\s\S]*'CASCADE'\)/i,
  "preflight must preserve the audited questions-to-subject cascade",
);
assert.match(
  preflight,
  /expected 0 auth\.users rows/i,
  "preflight must guard the audited zero-user assumption",
);
assert.doesNotMatch(
  preflightExecutable,
  /\b(create|alter|drop|insert|update|delete|truncate|grant|revoke)\s+(table|schema|function|policy|trigger|into|on|from)\b/i,
  "preflight must not mutate schema, data, policies, or grants",
);

console.log("Phase 1 authentication migration contract tests passed.");
