import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const phase2 = readFileSync(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const phase4 = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const featureLoader = readFileSync(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/commercial-entry.mjs', import.meta.url), 'utf8');
const accessCore = readFileSync(new URL('../worker/access-core.mjs', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260821120000_soft_launch_five_token_trial.sql', import.meta.url),
  'utf8',
);

assert.match(phase2, /one lifetime allowance of five practice tokens/i);
assert.match(phase2, /Early Access/);
assert.match(phase2, /₱149/);
assert.match(phase2, /₱199/);
assert.match(phase4, /five one-time practice tokens/i);
assert.match(phase4, /ensureProtectedAccess/);
assert.match(phase4, /subject-matter/);
assert.match(phase4, /mock-bar/);
assert.doesNotMatch(phase4, /dd2-choose-free/);
assert.doesNotMatch(phase4, /access\/choose/);
assert.doesNotMatch(phase4, /plan_selection_required/);
assert.doesNotMatch(phase4, /MutationObserver/);

assert.match(featureLoader, /installPageRouterGuard/);
assert.match(featureLoader, /mock:\s*'#mock-bar'/);
assert.match(featureLoader, /midterms:\s*'#subject-matter'/);
assert.match(featureLoader, /loadForFeature\('subject-matter'\)/);
assert.match(featureLoader, /options\?\.accessVerified/);
assert.doesNotMatch(featureLoader, /free-trial-five-daily\.js/);

assert.doesNotMatch(worker, /phase4_choose_launch_trial/);
assert.doesNotMatch(worker, /pathname === '\/access\/choose'/);
assert.match(accessCore, /INTRODUCTORY_TOKENS_EXHAUSTED/);
assert.match(accessCore, /five one-time practice tokens/i);

assert.match(migration, /create table if not exists public\.introductory_token_grants/);
assert.match(migration, /create table if not exists public\.introductory_token_ledger/);
assert.match(migration, /token_limit integer not null default 5 check \(token_limit = 5\)/);
assert.match(migration, /v_basis := 'introductory_tokens'/);
assert.match(migration, /mandatory_access_choice_enabled = false/);
assert.match(migration, /global_beta_all_access_enabled = false/);
assert.match(migration, /'planCode', 'early_access_beta'/);
assert.match(migration, /'priceCentavos', 14900/);
assert.match(migration, /'regularPriceCentavos'/);
assert.match(migration, /'manualRenewal', true/);
assert.match(migration, /'automaticRenewal', false/);
assert.doesNotMatch(migration, /'planCode',\s*'free'/);
assert.match(
  migration,
  /grant execute on function public\.phase4_reserve_grade_v2\(uuid,text,text,text\)[\s\S]*to service_role/,
);

console.log('One-time five-token access and single Early Access contracts passed.');
