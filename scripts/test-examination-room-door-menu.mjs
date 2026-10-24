import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// This test covers the current public ENTRY only. The isolated exam service
// has its own authentication, questions, submissions and collection tests.
const root = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const [html, experience, serviceWorker, css] = await Promise.all([
  'index.html', 'assets/phase2-experience.js', 'service-worker.js', 'assets/phase2.css',
].map(file => readFile(path.join(root, file), 'utf8')));
assert.match(html, /id="spa-examination-room"[^>]*data-dd2-view="examination-room"/u);
assert.equal((html.match(/id="spa-examination-room"/gu) || []).length, 1);
const content = experience.slice(experience.indexOf('  function examinationRoomContent()'), experience.indexOf('  function partnershipContent()'));
assert.match(content, /aria-labelledby="dd2-professor-door-title"/u);
assert.match(content, /id="dd2-professor-door"[^>]*type="button"/u);
assert.match(content, /role="status" aria-live="polite"/u);
assert.match(content, /Upload your question paper/u);
assert.match(content, /Enter your name and email/u);
assert.doesNotMatch(content, /room key|student number|institution|\/examination-room\//iu);
assert.doesNotMatch(content, /state\.(?:session|user|profile)|access_token/u);
const source = experience.slice(experience.indexOf('  function professorDoorDestination('), experience.indexOf('  async function recordCurrentTermsAcceptance('));
const elements = new Map(['dd2-professor-door', 'dd2-professor-door-retry', 'dd2-examination-room-status', 'dd2-professor-door-badge'].map(id => [id, { dataset: {}, setAttribute() {} }]));
const navigations = [];
const sandbox = { document: { getElementById: id => elements.get(id) }, location: { assign: url => navigations.push(url) } };
Object.defineProperty(sandbox, 'state', { get() { throw new Error('The current public entry must never read the main-site session.'); } });
vm.runInNewContext(`${source}\ncheckProfessorDoor(); activateProfessorDoor();`, sandbox);
assert.equal(navigations.length, 1);
const destination = new URL(navigations[0]);
assert.equal(destination.protocol, 'https:');
assert.equal(destination.hostname, 'duediligence-constitutional-exam.wallyesteban1993.workers.dev');
assert.equal(destination.pathname, '/admin/exams');
assert.equal(destination.search, ''); assert.equal(destination.hash, '');
assert.equal(destination.username, ''); assert.equal(destination.password, '');
assert.equal(elements.get('dd2-professor-door').disabled, false);
elements.get('dd2-professor-door').disabled = true;
vm.runInNewContext('activateProfessorDoor()', sandbox);
assert.equal(navigations.length, 1, 'Disabled controls must not navigate');
assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.dd2-examination-door-grid \{ grid-template-columns: 1fr; \}/u);
const documentReference = html.match(/src="(assets\/phase2-experience\.js\?[^"\r\n]+)"/u)?.[1].replaceAll('&amp;', '&');
assert.ok(documentReference);
assert.ok(serviceWorker.includes(`'/${documentReference}'`), 'Document and service worker must load the same updated entry module');
assert.match(serviceWorker, /professor-desk-20261024-1/u);
console.log('Current professor entry, student directions, private destination and cache references passed.');
