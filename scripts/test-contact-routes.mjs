import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html, experience, worker, migration] = await Promise.all([
  fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260730_008_phase4_payments_partnerships.sql', import.meta.url), 'utf8'),
]);

for (const source of [html, experience, worker, migration]) {
  assert.doesNotMatch(source, /gmail\.com/i, 'Personal Gmail addresses must not be exposed.');
}
assert.doesNotMatch(html, /web3forms/i, 'Third-party notification plumbing must not appear in public HTML.');
assert.doesNotMatch(experience, /web3forms/i, 'Third-party notification plumbing must not appear in public JavaScript.');

for (const id of ['dd2-support-form', 'dd2-partnership-form', 'dd2-payment-form']) {
  assert.match(experience, new RegExp(`id="${id}"`), `${id} must remain available.`);
}
for (const route of ['/support', '/partnerships', '/payments/submit']) {
  assert.match(experience, new RegExp(route.replace('/', '\\/')), `${route} must be submitted through the Worker.`);
  assert.match(worker, new RegExp(`pathname === '${route.replace('/', '\\/')}'`), `${route} must be handled by the Worker.`);
}

for (const mailbox of [
  'plansandpricing@duediligence.ph',
  'founders@duediligence.ph',
  'support@duediligence.ph',
]) {
  assert.match(migration, new RegExp(mailbox.replace('.', '\\.')), `${mailbox} must be used for operational routing.`);
}

assert.match(experience, /mailto:founders@duediligence\.ph\?subject=Partnership%20Inquiry/);
assert.match(html, /mailto:support@duediligence\.ph\?subject=Due%20Diligence%20Support%20Request/);

console.log('Native support, payment, and partnership route tests passed.');
