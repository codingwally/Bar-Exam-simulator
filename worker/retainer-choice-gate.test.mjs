import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = [
  '20260818133000_retainer_choice_schema.sql',
  '20260818133100_retainer_choice_resolver.sql',
  '20260818133200_retainer_choice_command.sql',
  '20260818133300_retainer_choice_activate.sql',
].map((name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
  .join('\n');
const gate = readFileSync(new URL('../assets/access-choice-gate.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../assets/phase2-config.js', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../scripts/build-pages-artifact.mjs', import.meta.url), 'utf8');

test('ordinary accounts require a stored Retainer choice', () => {
  assert.match(migration, /create table if not exists public\.commercial_access_choices/);
  assert.match(migration, /'basis', 'plan_selection_required'/);
  assert.match(migration, /'choiceRequired', true/);
  assert.match(migration, /mandatory_access_choice_enabled = true/);
  assert.doesNotMatch(
    migration,
    /elsif v_remaining > 0 then\s+v_allowed := true;[\s\S]*v_basis := 'daily_free'/,
  );
});

test('Free Trial starts only through the authenticated explicit-choice command', () => {
  assert.match(migration, /create or replace function public\.phase4_choose_access/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /v_choice not in \('launch_trial', 'early_access'\)/);
  assert.match(migration, /trial_started_at = excluded\.trial_started_at/);
  assert.match(migration, /v_settings\.launch_trial_ends_at/);
  assert.match(migration, /grant execute on function public\.phase4_choose_access\(text, text\)[\s\S]*to authenticated, service_role/);
});

test('Retainer catalog exposes exactly Free Trial and Early Access choices', () => {
  const catalogStart = migration.indexOf('create or replace function public.phase4_plan_catalog');
  assert.notEqual(catalogStart, -1);
  const catalog = migration.slice(catalogStart);
  assert.match(catalog, /'planCode', 'free'/);
  assert.match(catalog, /'name', 'Free Trial'/);
  assert.match(catalog, /'planCode', 'early_access_beta'/);
  assert.match(catalog, /'priceCentavos', 14900/);
  assert.doesNotMatch(catalog, /'planCode', 'standard'/);
  assert.doesNotMatch(catalog, /'planCode', 'premium'/);
});

test('browser keeps Retainer mandatory and records both choices server-side', () => {
  assert.match(gate, /Choose Free Trial or ₱149 Early Access before continuing/);
  assert.match(gate, /data-dd2-plan-choice="launch_trial"/);
  assert.match(gate, /phase4_choose_access/);
  assert.match(gate, /p_choice: choice/);
  assert.match(gate, /setMandatoryControls\(mandatory\)/);
  assert.match(gate, /trialAvailable/);
  assert.match(gate, /Use Free Trial instead/);
});

test('choice gate is loaded and included in the sanitized Pages artifact', () => {
  assert.match(config, /access-choice-gate\.js\?v=explicit-retainer-choice-20260818-1/);
  assert.match(builder, /assets\/access-choice-gate\.js/);
});
