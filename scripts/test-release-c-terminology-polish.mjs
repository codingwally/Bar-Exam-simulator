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

for (const label of [
  'Moot Court',
  'The Verdict',
  'Retainer',
  'Lex Forum',
  'Recent Jurisprudence',
  'Co-Counsel',
  'Joint Venture',
  'The Docket',
  'Commence Examination',
]) {
  assert.ok(index.includes(label), `Public experience must include “${label}”.`);
}

assert.match(
  index,
  /Early Access Beta:<\/strong>\s*<span>Some features are still being refined\.<\/span>/,
);
assert.match(index, /<a class="brand" href="\/" aria-label="Due Diligence home">/);
assert.match(index, /id="btn-signin"[^>]*>The Docket · Sign In<\/button>[\s\S]*<\/nav>/);
assert.match(index, /id="page-community" class="page"/);
assert.match(index, /assets\/phase2-law-library\.jpg/);
assert.match(index, /@media\(prefers-reduced-motion:reduce\)/);
assert.doesNotMatch(index, /assets\/atmosphere\.mp4/);
assert.doesNotMatch(index, /Continue to Next Item|subject-choice:after|→|↗|⤓/);

for (const oldNavLabel of [
  '>Practice</button>',
  '>Progress</button>',
  '>Plans &amp; Access</button>',
  '>Legal Updates</button>',
  '>Support</button>',
  '>Partner With Us</button>',
]) {
  assert.ok(!index.includes(oldNavLabel), `Old navigation label remains: ${oldNavLabel}`);
}

assert.match(experience, /signedIn \? 'The Docket' : 'The Docket · Sign In'/);
assert.match(experience, /support: \['Member assistance', 'Co-Counsel'/);
assert.match(experience, /pricing: \['Access options', 'Retainer'/);
assert.match(experience, /account: \['Your chamber', 'The Docket'/);
assert.match(experience, /partnership: \['Collaborate', 'Joint Venture'/);

for (const label of [
  'Chambers',
  'Live Activity',
  'Visitors &amp; Sign-ups',
  'Students',
  'Performance',
  'Question Bank',
  'AI Grading Health',
  'Retainer Management',
  'Payment Review',
  'Refunds',
  'Co-Counsel Requests',
  'Answer Corrections',
  'Joint Ventures',
  'Website Settings',
  'Access &amp; Activity Log',
]) {
  assert.ok(adminHtml.includes(label), `Chambers navigation must include “${label}”.`);
}
assert.match(admin, /executive: 'Chambers'/);
assert.match(admin, /acquisition: 'Visitors & Sign-ups'/);
assert.match(admin, /subscriptions: 'Retainer Management'/);
assert.match(admin, /support: 'Co-Counsel Requests'/);
assert.match(admin, /partnerships: 'Joint Ventures'/);
assert.match(admin, /security: 'Access & Activity Log'/);
assert.doesNotMatch(admin, /Visitors and Sign-ups|Access and Activity Log/);
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
