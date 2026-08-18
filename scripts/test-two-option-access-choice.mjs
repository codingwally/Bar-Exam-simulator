import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const phase4 = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const dailyCopy = readFileSync(new URL('../assets/free-trial-five-daily.js', import.meta.url), 'utf8');
const featureLoader = readFileSync(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/commercial-entry.mjs', import.meta.url), 'utf8');
const accessCore = readFileSync(new URL('../worker/access-core.mjs', import.meta.url), 'utf8');
const choiceMigration = readFileSync(
  new URL('../supabase/migrations/20260818133000_restore_two_option_access_choice.sql', import.meta.url),
  'utf8',
);
const dailyMigration = readFileSync(
  new URL('../supabase/migrations/20260818143000_free_trial_five_daily_choice.sql', import.meta.url),
  'utf8',
);

assert.match(phase4, /Choose Free Trial or ₱149 Early Access/);
assert.match(phase4, /dd2-start-free-trial/);
assert.match(phase4, /access\/choose/);
assert.match(phase4, /plan_selection_required/);
assert.match(phase4, /MutationObserver/);
assert.match(phase4, /ensureProtectedAccess/);
assert.match(phase4, /subject-matter/);
assert.match(phase4, /mock-bar/);
assert.match(dailyCopy, /5 protected question submissions per Philippine day/);
assert.match(dailyCopy, /Free Trial · \$\{remaining\} of \$\{limit\} remaining today/);
assert.match(dailyCopy, /Philippine midnight/);
assert.match(featureLoader, /installPageRouterGuard/);
assert.match(featureLoader, /mock:\s*'#mock-bar'/);
assert.match(featureLoader, /midterms:\s*'#subject-matter'/);
assert.match(featureLoader, /loadForFeature\('subject-matter'\)/);
assert.match(featureLoader, /options\?\.accessVerified/);
assert.match(featureLoader, /free-trial-five-daily\.js/);
assert.match(worker, /phase4_choose_launch_trial/);
assert.match(worker, /FREE_TRIAL_ALREADY_USED/);
assert.match(accessCore, /ACCESS_CHOICE_REQUIRED/);
assert.match(choiceMigration, /mandatory_access_choice_enabled = false/);
assert.match(choiceMigration, /create or replace function public\.phase4_choose_launch_trial/);
assert.match(dailyMigration, /'name', 'Free Trial'/);
assert.match(dailyMigration, /'billing', 'daily_free_trial'/);
assert.match(dailyMigration, /when v_remaining > 0 then 'daily_free'/);
assert.match(dailyMigration, /else 'daily_limit_reached'/);
assert.match(dailyMigration, /'basis', 'plan_selection_required'/);
assert.match(dailyMigration, /free_daily_grade_limit = 5/);
assert.doesNotMatch(
  dailyMigration,
  /if v_trial_active then[\s\S]*'unlimited', true/,
);

console.log('Two-option five-daily access-choice and protected-route contracts passed.');
