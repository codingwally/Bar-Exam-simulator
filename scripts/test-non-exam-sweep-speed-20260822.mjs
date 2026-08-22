import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, loader, phase2, phase4, landing, forum] = await Promise.all([
  read('index.html'),
  read('assets/feature-loader.js'),
  read('assets/phase2-experience.js'),
  read('assets/phase4-experience.js'),
  read('assets/private-beta-landing.js'),
  read('assets/lex-forum.js'),
]);

assert.doesNotMatch(html, /<img src="assets\/brand\/logo1-master\.png"/,
  'Signed-in Home must not eagerly download the 2.4 MB signed-out artwork.');
assert.match(html, /<img data-src="assets\/brand\/logo1-master\.png"/);
assert.match(landing, /stillImage\.setAttribute\('src'/);

assert.match(loader, /scheduleSignedInPrefetch\(\)/);
assert.match(loader, /prefetchGroup\('content'\)/);
assert.match(loader, /prefetchGroup\('examinations'\)/);
assert.doesNotMatch(
  loader.match(/function scheduleSignedInPrefetch\(\)[\s\S]*?\n  }/)?.[0] || '',
  /prefetchGroup\('examinationRoom'\)/,
  'The optimization sweep must not preload or modify Examination Room.',
);

assert.match(phase2, /const adminSession = accessToken[\s\S]*Promise\.all\(\[[\s\S]*adminSession/,
  'Admin/session detection must run in parallel with profile and Terms reads.');
assert.match(phase2, /syncNativeViewWithHash\(\);[\s\S]*if \(!state\.user\) syncAuthUi\(\)/,
  'Direct native routes must be restored during initialization.');
assert.match(phase4, /if \(state\.accessPromise\) \{[\s\S]{0,180}await state\.accessPromise[\s\S]{0,180}return access/,
  'Concurrent access refreshes, including forced refreshes, must share the active request.');
assert.doesNotMatch(phase4, /if \(state\.accessPromise && options\.force === true\)[\s\S]{0,120}await state\.accessPromise/,
  'A forced refresh must not serialize a duplicate access request behind the active request.');

assert.match(forum, /view === 'my-posts'[\s\S]{0,180}await refreshFeed\(\)/);
assert.match(forum, /payload\.authorMemberId = state\.bootstrap\.profile\.memberId/);
const startPracticeSource = html.slice(
  html.indexOf('function startPractice()'),
  html.indexOf('function acceptTerms()'),
);
assert.doesNotMatch(startPracticeSource, /TERMS_ACCEPTANCE_KEY/);
assert.doesNotMatch(html, /onclick="loadLaborFromSheet\(\)"/);

console.log('Non-Examination Room sweep and startup performance contracts passed.');
