import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const [forum, account] = await Promise.all([
  readFile(new URL('../assets/lex-forum.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
]);
const functionSource = (source, name) => {
  const match = source.replace(/\r\n/g, '\n').match(new RegExp(`  function ${name}\\([\\s\\S]*?\\n  }\\n`));
  assert.ok(match, `Actual function ${name} exists`);
  return match[0];
};

function runtime() {
  const schoolList = account.match(/  const lawSchools = Object\.freeze\(\[[\s\S]*?\n  \]\);/)[0];
  const fakeElement = tag => ({
    tagName: tag, children: [], attributes: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  });
  const context = vm.createContext({
    global: {}, document: { createElement: fakeElement },
    state: { profile: { school: 'PRIVATE_VIEWER_SCHOOL' } },
    showMemberProfile() { throw Error('No profile request expected'); },
  });
  vm.runInContext([
    schoolList, functionSource(account, 'schoolDisplayName'), functionSource(account, 'formatSchoolName'),
    functionSource(forum, 'academicDetails'), functionSource(forum, 'authorBlock'),
    functionSource(forum, 'textElement'), functionSource(forum, 'initials'),
  ].join('\n'), context);
  context.global.DueDiligencePhase2 = { formatSchoolName: context.formatSchoolName };
  return context;
}

test('Home author metadata resolves the existing school directory and readable year labels', () => {
  const r = runtime();
  for (const [school, yearLevel, expected] of [
    ['san-beda-college-alabang', 'first_year', 'San Beda College Alabang · First Year'],
    ['liceo-de-cagayan-university', 'third_year', 'Liceo de Cagayan University · Third Year'],
    ['kalinga-state-university', 'review', 'Kalinga State University · Review / Bar Candidate'],
    ['bit-international-college', 'professor', 'BIT International College · Professor'],
    ['san-sebastian-college-recoletos', '2', 'San Sebastian College-Recoletos · Second Year'],
  ]) assert.equal(r.academicDetails({ school, yearLevel }), expected);
  const author = r.authorBlock({ displayName: 'Sample Member', school: 'san-beda-college-alabang', yearLevel: 'first_year' });
  assert.equal(author.children[1].children[1].textContent, 'San Beda College Alabang · First Year');
});

test('Readable profile labels preserve custom names, punctuation, acronyms and unknown categories', () => {
  const r = runtime();
  assert.equal(r.academicDetails({ school: 'UP — BGC / JD Program', yearLevel: 'Alumni Fellow' }), 'UP — BGC / JD Program · Alumni Fellow');
  assert.equal(r.academicDetails({ school: 'Ateneo de Manila University', yearLevel: 'FIFTH_YEAR' }), 'Ateneo de Manila University · Fifth Year');
  assert.equal(r.academicDetails({ school: 'custom-unlisted-school', yearLevel: 'external_category' }), 'custom-unlisted-school · external_category');
  assert.equal(r.academicDetails({ yearLevel: 'constructor' }), 'constructor');
});

test('Missing public academic fields never fall back to the signed-in viewer profile', () => {
  const r = runtime();
  assert.equal(r.formatSchoolName(), ''); assert.equal(r.academicDetails({}), '');
  assert.equal(r.academicDetails({ school: null, yearLevel: null }), '');
  assert.equal(r.authorBlock({ displayName: 'Sample Member' }).children[1].children[1].textContent, 'Due Diligence member');
});

test('Anonymous author metadata remains anonymous even when an input includes academic fields', () => {
  const r = runtime();
  r.global.DueDiligencePhase2.formatSchoolName = () => { throw Error('Anonymous metadata must not be formatted'); };
  const input = { displayName: 'Sample Alias', anonymous: true, school: 'PRIVATE_SCHOOL', yearLevel: 'PRIVATE_YEAR' };
  assert.equal(r.authorBlock(input, false).children[1].children[1].textContent, 'Anonymous');
  assert.equal(r.authorBlock(input, true).children[1].children[1].textContent, 'Anonymous · You');
});

test('Public academic labels remain text and do not reinterpret untrusted school markup', () => {
  const r = runtime();
  const author = r.authorBlock({ displayName: 'Sample Member', school: '<img src=x onerror=alert(1)>', yearLevel: 'first_year' });
  const label = author.children[1].children[1];
  assert.equal(label.textContent, '<img src=x onerror=alert(1)> · First Year');
  assert.equal(label.children.length, 0);
});

test('Partial frontend bootstrap retains supplied public details without fetching or inventing a school', () => {
  const r = runtime(); delete r.global.DueDiligencePhase2;
  assert.equal(r.academicDetails({ school: 'Custom Law School', yearLevel: 'fourth_year' }), 'Custom Law School · Fourth Year');
});
