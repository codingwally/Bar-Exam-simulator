import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');

const expectedSubjects = new Map([
  ['support@duediligence.ph', 'Due Diligence Support Request'],
  ['premium@duediligence.ph', 'Premium Plan Inquiry'],
  ['advertise@duediligence.ph', 'Advertising and Partnership Inquiry'],
  ['invest@duediligence.ph', 'Investment Inquiry'],
]);

assert.doesNotMatch(html, /gmail\.com/i, 'Personal Gmail addresses must not be exposed.');
assert.doesNotMatch(html, /web3forms/i, 'Contact actions must remain mailto-only in this phase.');

const mailtoAnchors = Array.from(html.matchAll(/<a\b[^>]*\bhref="(mailto:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
assert.ok(mailtoAnchors.length >= expectedSubjects.size, 'Expected accessible mailto anchors were not found.');

const seenDestinations = new Set();
for (const [, href, labelHtml] of mailtoAnchors) {
  const mailto = new URL(href);
  const destination = decodeURIComponent(mailto.pathname).toLowerCase();
  const expectedSubject = expectedSubjects.get(destination);
  assert.ok(expectedSubject, `Unexpected mailto destination: ${destination}`);
  assert.equal(mailto.searchParams.get('subject'), expectedSubject, `${destination} must use its approved subject.`);
  assert.ok(labelHtml.replace(/<[^>]+>/g, '').trim(), `${destination} requires a readable link label.`);
  seenDestinations.add(destination);
}

assert.deepEqual(seenDestinations, new Set(expectedSubjects.keys()), 'Every approved contact destination must be represented.');

console.log('Contact route tests passed.');
