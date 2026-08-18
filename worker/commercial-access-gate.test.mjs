import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  REQUIRED_PAYMENT_VERIFIER_COUNT,
  bytesToBase64,
  normalizePaymentVerificationRecipients,
  sendPaymentVerificationEmail,
} from './commercial-entry.mjs';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260818123000_require_early_access.sql',
  import.meta.url,
), 'utf8');
const verifierMigration = readFileSync(new URL(
  '../supabase/migrations/20260818123100_private_payment_verifiers.sql',
  import.meta.url,
), 'utf8');
const frontend = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const productionWrangler = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');

test('commercial access no longer grants automatic daily-free access', () => {
  assert.match(migration, /v_basis := 'payment_required'/);
  assert.match(migration, /v_allowed := false;[\s\S]*v_access_mode := 'locked'/);
  assert.match(migration, /'paymentRequired', v_basis = 'payment_required'/);
  assert.doesNotMatch(
    migration,
    /elsif v_remaining > 0 then\s+v_allowed := true;\s+v_unlimited := false;\s+v_basis := 'daily_free'/,
  );
});

test('public catalog exposes only the approved Early Access offer', () => {
  const catalogStart = migration.indexOf('create or replace function public.phase4_plan_catalog');
  assert.notEqual(catalogStart, -1);
  const catalog = migration.slice(catalogStart);
  assert.match(catalog, /'planCode', 'early_access_beta'/);
  assert.match(catalog, /'priceCentavos', 14900/);
  assert.doesNotMatch(catalog, /'planCode', 'free'/);
});

test('browser opens and preserves the mandatory payment gate', () => {
  assert.match(frontend, /basis === 'payment_required'/);
  assert.match(frontend, /legacy\.openView\?\.\('pricing'\)/);
  assert.match(frontend, /Early Access required · ₱149/);
  assert.match(frontend, /data-dd2-early-access-card/);
  assert.match(frontend, /dd2-native-close, #dd2-native-back/);
  assert.doesNotMatch(frontend, /five successful submissions for today/i);
});

test('payment verifier directory is private and contains no committed addresses', () => {
  assert.match(verifierMigration, /create table if not exists public\.payment_verification_recipients/);
  assert.match(verifierMigration, /force row level security/);
  assert.match(
    verifierMigration,
    /revoke all on table public\.payment_verification_recipients[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    verifierMigration,
    /grant select on table public\.payment_verification_recipients to service_role/,
  );
  assert.doesNotMatch(verifierMigration, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('payment verifier rows are ordered, normalized, deduplicated, and complete', () => {
  const recipients = normalizePaymentVerificationRecipients([
    { email: 'third@example.test', display_order: 3 },
    { email: ' FIRST@EXAMPLE.TEST ', display_order: 1 },
    { email: 'second@example.test', display_order: 2 },
    { email: 'fourth@example.test', display_order: 4 },
    { email: 'fifth@example.test', display_order: 5 },
    { email: 'first@example.test', display_order: 6 },
    { email: 'not-an-email', display_order: 7 },
  ]);
  assert.deepEqual(recipients, [
    'first@example.test',
    'second@example.test',
    'third@example.test',
    'fourth@example.test',
    'fifth@example.test',
  ]);
  assert.equal(recipients.length, REQUIRED_PAYMENT_VERIFIER_COUNT);
});

test('binary proof attachment encoding is stable', () => {
  assert.equal(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255])), 'AAEC/f7/');
});

test('payment email remains suppressed unless its dedicated mode is enabled', async () => {
  const result = await sendPaymentVerificationEmail(
    { PAYMENT_NOTIFICATION_EMAIL_MODE: 'suppressed' },
    {},
  );
  assert.deepEqual(result, {
    status: 'suppressed',
    providerId: null,
    recipientCount: 0,
  });
});

test('production worker uses the secure notification wrapper', () => {
  assert.match(productionWrangler, /^main = "commercial-entry\.mjs"$/m);
  assert.match(productionWrangler, /^PAYMENT_NOTIFICATION_EMAIL_MODE = "enabled"$/m);
  assert.match(
    productionWrangler,
    /^PAYMENT_NOTIFICATION_EMAIL_FROM = "Due Diligence Payments <support@duediligence\.ph>"$/m,
  );
});
