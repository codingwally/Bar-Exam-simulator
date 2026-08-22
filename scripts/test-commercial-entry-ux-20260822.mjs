import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, content, contentCss, phase2, phase4, landing, shellCss] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/phase4-experience.js', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/quorum-first-shell.css', root), 'utf8'),
]);

for (const legacy of ['A Friend on Your Journey', 'Amicus in Itinere Iuris']) {
  assert.doesNotMatch(html, new RegExp(legacy, 'i'), `${legacy} must not ship in public metadata or UI.`);
}
assert.match(html, /<title>Due Diligence — Philippine Bar Exam Simulator<\/title>/);
assert.match(html, /data-pb-open-admission>Continue with Google<\/button>/);
assert.match(html, /By continuing, you acknowledge the <a href="#terms"[^>]*>Terms of Use<\/a> and <a href="#privacy"[^>]*>Privacy Policy<\/a>\./);
assert.match(landing, /typeof beginGoogleSignIn === 'function'[\s\S]*await beginGoogleSignIn\(\)/,
  'The landing CTA must start Google OAuth directly without a second sign-in dialog.');
assert.match(html, /id="quorum-entry-status" role="status" aria-live="polite"/,
  'Direct Google entry must provide a visible inline status and retry path.');
assert.match(phase2, /duediligence:google-signin-status/);
assert.match(landing, /kind === 'error'[\s\S]*button\.disabled = false/,
  'OAuth failure must re-enable the public landing action.');
assert.doesNotMatch(phase2, /id="dd2-legal-acceptance"/,
  'Onboarding must not repeat the already acknowledged legal checkbox.');
assert.match(phase2, /await recordCurrentTermsAcceptance\(\)/,
  'The authenticated account must still receive a versioned server-side acceptance record.');

assert.doesNotMatch(content, /<h1>Bar Easy<\/h1>|Question \$\{index \+ 1\} of \$\{items\.length\}/);
assert.match(content, /bar_easy:\s*\{[^}]*title:\s*'Guided Practice'/);
assert.match(content, /function subjectSelector\(items\)[\s\S]*id="dd26-subject-select"/);
assert.equal((content.match(/\$\{subjectSelector\(items\)\}/g) || []).length, 2,
  'Guided Practice and Doctrine Review must each use the single subject selector.');
assert.match(content, /const RANDOMIZED_STUDY_VIEWS = new Set\(\['bar_easy', 'doctrine'\]\)/);
assert.match(content, /crypto\.getRandomValues\(sample\)/,
  'Question selection must use the browser cryptographic random source.');
assert.match(content, /authenticatedUserId\(\) \|\| 'signed-out'/,
  'The persisted no-repeat rotation must be partitioned per signed-in user.');
assert.match(content, /rotation\.remaining\.shift\(\)/);
assert.match(contentCss, /\.dd26-subject-picker/);

for (const label of ['Admin', 'Founding Beta', 'Paid Access', 'tokens remaining']) {
  assert.match(phase4, new RegExp(label));
}
assert.match(html, /id="dd2-guest-badge"[\s\S]*data-public-action="docket"/);
assert.match(shellCss, /\.dd2-guest-badge\.is-visible:not\(\[hidden\]\)/);
assert.doesNotMatch(shellCss, /\.dd2-guest-badge,\s*\n#site-header\.qfs-shell #session-clock/);

console.log('Commercial entry, guided randomization, and access-badge contract checks passed.');
