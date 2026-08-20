import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const experience = read('assets/phase2-experience.js');
const adminHtml = read('admin/index.html');
const admin = read('admin/admin.js');
const publicLanding = index.slice(
  index.indexOf('<div class="pb-landing" id="private-beta-landing">'),
  index.indexOf('<dialog class="pb-dialog" id="private-beta-dialog"'),
);

for (const label of [
  'Mock Bar',
  'The Verdict',
  'Plans &amp; Pricing',
  'Quorum',
  'Recent Jurisprudence',
  'Support',
  'Quid Pro Quo',
  'Partnerships',
  'The Docket',
  'Examination Room',
]) {
  assert.ok(index.includes(label), `Public experience must include “${label}”.`);
}

assert.match(
  publicLanding,
  /<h1 id="pb-pillars-title">Choose how you want to prepare\.<\/h1>/,
);
for (const chamberId of ['chamber-academy', 'chamber-commons', 'chamber-barbound', 'spa-examination-room']) {
  assert.match(index, new RegExp(`id="${chamberId}"`));
}
assert.doesNotMatch(publicLanding, /class="pb-hero"|class="pb-summary"|class="pb-rail"/);
assert.doesNotMatch(publicLanding, /Early Access Beta|Enter the Beta|Beta Access Active/i);
assert.match(
  index,
  /<a class="brand pb-brand" href="\/" data-public-home aria-label="Due Diligence homepage" aria-describedby="brand-subtitle-meaning">/,
);
assert.match(index, /id="btn-signin"[^>]*>The Docket<\/button>[\s\S]*<\/nav>/);
assert.match(index, /id="page-community" class="page"/);
assert.doesNotMatch(index, /assets\/phase2-law-library\.jpg|assets\/private-beta\/.+\.(?:avif|webp|jpe?g)/i);
assert.match(index, /@media\(prefers-reduced-motion:reduce\)/);
assert.doesNotMatch(index, /assets\/atmosphere\.mp4/);
assert.doesNotMatch(index, /Continue to Next Item|subject-choice:after|→|↗|⤓/);

for (const oldNavLabel of [
  '>Practice</button>',
  '>Progress</button>',
  '>Plans &amp; Access</button>',
  '>Legal Updates</button>',
  '>Partner With Us</button>',
]) {
  assert.ok(!index.includes(oldNavLabel), `Old navigation label remains: ${oldNavLabel}`);
}

assert.match(experience, /signInButton\.textContent = 'The Docket';/);
assert.match(experience, /support: \['Member assistance', 'Support'/);
assert.match(experience, /pricing: \['Access options', 'Plans & Pricing'/);
assert.match(experience, /account: \['Your chamber', 'The Docket'/);
assert.match(experience, /partnership: \['Collaborate', 'Partnerships'/);

for (const label of [
  'Overview',
  'Live Activity',
  'Sign-ups',
  'Users',
  'Answers',
  'Learning Performance',
  'Question Bank',
  'Grading Health',
  'Access',
  'Payments',
  'Refunds',
  'Support',
  'Answer Corrections',
  'Partnerships',
  'Website Settings',
  'Security &amp; Activity Log',
]) {
  assert.ok(adminHtml.includes(label), `Admin navigation must include “${label}”.`);
}
assert.match(admin, /executive: 'Overview'/);
assert.match(admin, /acquisition: 'Sign-ups'/);
assert.match(admin, /learning: 'Learning Performance'/);
assert.match(admin, /subscriptions: 'Access'/);
assert.match(admin, /support: 'Support'/);
assert.match(admin, /partnerships: 'Partnerships'/);
assert.match(admin, /security: 'Security & Activity Log'/);
assert.doesNotMatch(admin, /Retainer Management|Visitors and Sign-ups|Access and Activity Log/);
assert.match(admin, /function maskOperationalIdentifier/);
assert.match(admin, /\['Time', 'Action', 'Actor', 'Record type', 'Record', 'Reason'\]/);
assert.doesNotMatch(admin, /Actor UUID|Auth UUIDs/);
assert.doesNotMatch(
  admin,
  /table\(\['Student', 'User UUID', 'Role'|table\(\['Student', 'User UUID', 'Plan'/,
  'Primary retainer and payment tables must not expose raw user UUIDs.',
);

for (const fabricatedConceptNumber of ['1,248', '1,245,230', '98.7%', '10,000+', '4.9/5']) {
  assert.ok(
    !index.includes(fabricatedConceptNumber) && !adminHtml.includes(fabricatedConceptNumber),
    `Concept-only figure must not be shipped: ${fabricatedConceptNumber}`,
  );
}

console.log('Release C terminology, ambient polish, and truthful-shell contracts passed.');
