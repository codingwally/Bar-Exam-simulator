import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const phase2 = read('assets/phase2-experience.js');
const config = read('assets/phase2-config.js');
const migration = read(
  'supabase/migrations/20260817123000_retire_email_marketing_collection.sql',
);

for (const removedSurface of [
  'record_marketing_consent',
  'dd2-marketing-consent',
  'dd2-account-marketing',
]) {
  assert.doesNotMatch(
    phase2,
    new RegExp(removedSurface),
    `active Phase 2 code must not retain ${removedSurface}`,
  );
}
assert.doesNotMatch(config, /marketingConsentVersion/);

const retiredFunction = migration.slice(
  migration.indexOf('create or replace function public.record_marketing_consent'),
  migration.indexOf('comment on function public.record_marketing_consent'),
);
assert.match(retiredFunction, /v_user_id uuid := auth\.uid\(\)/);
assert.match(retiredFunction, /if v_user_id is null then/);
assert.match(retiredFunction, /security invoker/);
assert.match(retiredFunction, /Compatibility no-op/);
assert.match(retiredFunction, /return;/);
assert.doesNotMatch(retiredFunction, /insert\s+into|update\s+public\.|enqueue|sendExaminationEmail/i);
assert.match(
  migration,
  /revoke all on function public\.record_marketing_consent\(boolean, text, text\)[\s\S]*from public, anon, authenticated/,
);
assert.match(
  migration,
  /grant execute on function public\.record_marketing_consent\(boolean, text, text\)[\s\S]*to authenticated/,
);

console.log('Email-marketing collection retirement contract passed.');
