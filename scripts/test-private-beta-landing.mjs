import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const [html, css, script, config, build] = await Promise.all([
  read('index.html'),
  read('assets/private-beta-landing.css'),
  read('assets/private-beta-landing.js'),
  read('assets/phase2-config.js'),
  read('scripts/build-pages-artifact.mjs'),
]);

assert.match(html, /<title>Due Diligence — A Friend on Your Journey Through the Study of Law<\/title>/);
assert.match(html, /id="private-beta-landing"/);
assert.match(html, /id="authenticated-app-shell" hidden inert aria-hidden="true"/);
assert.match(html, /EARLY ACCESS BETA/i);
assert.match(
  html,
  /A platform to express<br>\s*your perspective, sharpen<br>\s*your legal reasoning, and<br>\s*strengthen your performance<br>\s*throughout law school\./,
);
assert.match(html, /Practice the reasoning\. Refine the writing\./);
assert.match(html, /Enter the Beta/i);
assert.match(html, /Learn How It Works/i);
assert.match(html, /A trusted companion throughout the study of law\./);
assert.match(html, /Make disciplined essay practice accessible, repeatable, and measurable\./);
assert.match(html, /Help students strengthen legal reasoning and writing—not replace independent study or authoritative sources\./);

for (const label of [
  'Private beta access code',
  'I Agree — Continue to Access Code',
  'Continue to Google Sign-In',
  'Sign In with Google',
  'I Agree — Enter Private Beta',
  'Pause motion',
]) {
  assert.match(html, new RegExp(label, 'i'), `missing admission label: ${label}`);
}

for (const statement of [
  'I have read the entire Beta Disclosure and understand the limitations of AI-generated feedback, scores, citations, and suggested answers.',
  'I understand that Due Diligence is an educational practice platform, does not provide legal advice, and does not guarantee academic, Bar examination, or professional outcomes.',
  'I agree to the Beta Terms and Privacy Notice, including the uses of my submissions, account activity, feedback, and reports described in those documents.',
]) {
  assert.equal(html.split(statement).length - 1, 2, 'each required acknowledgment must appear provisionally and after authentication');
}

assert.doesNotMatch(`${html}\n${css}\n${script}\n${config}\n${build}`, /ARTICLE[0-9]+NCC/i);
assert.match(script, /That access code isn’t recognized\. Review the hint and try again\./);
assert.match(script, /privateBetaGate === true/);
assert.match(config, /privateBetaGate: true/);
assert.match(script, /IntersectionObserver/);
assert.match(script, /document\.hidden/);
assert.match(script, /prefers-reduced-motion: reduce/);
assert.match(script, /completeAdmission/);
assert.match(script, /api\.status/);
assert.match(script, /globalBetaEnabled/);
assert.match(script, /privateBetaApi\(\)\?\.policy/);
assert.match(script, /Google sign-in succeeded, but this browser could not restore the private-beta admission checkpoint/);
assert.match(script, /global\.syncModalIsolation\?\.\(\)/);
assert.match(html, /#private-beta-dialog\[open\]/);
assert.match(html, /assets\/private-beta-landing\.js\?v=beta-all-access-20260802-1/);
assert.match(css, /animation: pb-slide-left/);
assert.match(css, /animation: pb-slide-right/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

const imageStems = [
  'campus-students',
  'library-community',
  'library-student',
  'writing-exam',
  'writing-notes',
];
for (const stem of imageStems) {
  for (const width of [720, 1440]) {
    for (const extension of ['avif', 'webp', 'jpg']) {
      const relative = `assets/private-beta/${stem}-${width}.${extension}`;
      const details = await stat(path.join(root, relative));
      assert.ok(details.isFile() && details.size > 5_000, `${relative} must be a non-empty optimized image`);
      assert.ok(build.includes(`assets/private-beta/`), 'the Pages allowlist must ship private-beta images');
    }
  }
}

const officialLogoPath = 'assets/brand/logo1-master.png';
const officialLogo = await readFile(path.join(root, officialLogoPath));
assert.ok((await stat(path.join(root, officialLogoPath))).isFile(), 'official logo must be a file');
assert.equal(
  createHash('sha256').update(officialLogo).digest('hex').toUpperCase(),
  '6D284C91CE34D208252F5311A4CD3397FC00251E6968BFA620182138A1206CF5',
  'official logo checksum changed',
);
assert.ok(build.includes(`'${officialLogoPath}'`), 'the Pages allowlist must ship the official logo');

const approvedReference = await readFile(path.join(
  root,
  'docs/visual-references/private-beta/Due_Diligence_Private_Beta_Landing_Approved_Reference.png',
));
assert.equal(
  createHash('sha256').update(approvedReference).digest('hex').toUpperCase(),
  'DD56E1526845086D11EF0F9FA1FB6819EFDBEA2941CA5D029237BC37C6A7BE4C',
  'approved landing reference checksum changed',
);

const sessionPosition = html.indexOf('assets/private-beta-session.js');
const phase2Position = html.indexOf('assets/phase2-experience.js');
const landingPosition = html.indexOf('assets/private-beta-landing.js');
assert.ok(sessionPosition > -1 && phase2Position > sessionPosition && landingPosition > phase2Position);

console.log('Private-beta landing contract checks passed.');
