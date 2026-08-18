import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const phase4 = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/commercial-entry.mjs', import.meta.url), 'utf8');
const accessCore = readFileSync(new URL('../worker/access-core.mjs', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260818133000_restore_two_option_access_choice.sql', import.meta.url),
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
assert.match(worker, /phase4_choose_launch_trial/);
assert.match(worker, /FREE_TRIAL_ALREADY_USED/);
assert.match(accessCore, /ACCESS_CHOICE_REQUIRED/);
assert.match(migration, /mandatory_access_choice_enabled = false/);
assert.match(migration, /create or replace function public\.phase4_choose_launch_trial/);
assert.match(migration, /'name', 'Free Trial'/);
assert.match(migration, /plan_selection_required/);
assert.doesNotMatch(migration, /five successful question submissions per Philippine calendar day/i);

console.log('Two-option access-choice contracts passed.');
