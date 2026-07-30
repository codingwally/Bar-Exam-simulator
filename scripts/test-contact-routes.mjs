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

for (const id of ['dd2-support-form', 'dd2-partnership-form']) {
  assert.match(experience, new RegExp(`id="${id}"`), `${id} must remain available.`);
}
for (const route of ['/support', '/partnerships']) {
  assert.match(experience, new RegExp(route.replace('/', '\\/')), `${route} must be submitted through the Worker.`);
  assert.match(worker, new RegExp(`pathname === '${route.replace('/', '\\/')}'`), `${route} must be handled by the Worker.`);
}
assert.doesNotMatch(experience, /id="dd2-payment-form"|\/payments\/submit/);
assert.match(experience, /Pricing will be announced after beta testing\./);
assert.match(experience, /Beta access active/);

for (const mailbox of [
  'plansandpricing@duediligence.ph',
  'founders@duediligence.ph',
  'support@duediligence.ph',
]) {
  assert.match(migration, new RegExp(mailbox.replace('.', '\\.')), `${mailbox} must be used for operational routing.`);
}

assert.match(experience, /mailto:invest@duediligence\.ph\?subject=Investment%20Inquiry/);
assert.match(html, /href="#support">Open Support</);
assert.doesNotMatch(html, /mailto:support@duediligence\.ph/);

console.log('Native support, concealed beta pricing, and partnership route tests passed.');
