import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [html, account, accountCss, home, homeCss] = await Promise.all([
  read('index.html'),
  read('assets/phase2-experience.js'),
  read('assets/phase2.css'),
  read('assets/lex-forum.js'),
  read('assets/lex-forum.css'),
]);

const rolePosition = html.indexOf('id="dd2-header-role-button"');
const examinationPosition = html.indexOf('id="dd2-header-exam-button"');
assert.ok(rolePosition >= 0 && examinationPosition > rolePosition,
  'The Examination Room shortcut must sit immediately after the signed-in role control.');
assert.match(html, /dd2-header-exam-button[\s\S]*data-dd2-view="examination-room"/,
  'The header Examination Room shortcut must use the routed examination door.');
assert.match(account, /function accountRoleLabel\(\)[\s\S]*Admin[\s\S]*Professor/,
  'The signed-in header must expose an understandable role label.');
assert.doesNotMatch(account, /dd2-account-examination/,
  'Examination Room access must not remain buried inside the Profile form.');

assert.match(account, /id="dd2-account-photo-button"/,
  'Profile must expose an obvious profile-photo control.');
assert.match(account, /profilePhotoToPayload[\s\S]*image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/,
  'Profile photo handling must validate supported image types.');
assert.match(account, /at least 256 pixels wide and tall/,
  'Profile photo errors must explain the recoverable minimum-size requirement.');
assert.match(account, /operation: 'set_profile_avatar'/,
  'Profile photo changes must use the existing authenticated avatar command.');
assert.match(account, /Profile photo updated across Home/,
  'Successful upload must tell the user where the new photo appears.');
assert.match(accountCss, /dd2-account-hero[\s\S]*linear-gradient/,
  'The account surface must use the established navy and gold visual system.');
assert.match(accountCss, /dd2-account-grid[\s\S]*grid-template-columns/,
  'Profile identity and access information must use a deliberate responsive layout.');

assert.match(home, /quorum-profile-hero/,
  'The Home profile view must render a dedicated identity hero.');
assert.match(home, /Profile photograph/,
  'The Home profile view must make photo upload discoverable.');
assert.match(home, /Profile visibility/,
  'The redesigned Home profile must preserve member-controlled visibility settings.');
assert.match(homeCss, /quorum-profile-panel[\s\S]*quorum-profile-hero[\s\S]*quorum-profile-portrait/,
  'The Home profile must include the premium profile visual treatment.');

console.log('Premium profile, Home photo, and role-level Examination Room shortcut checks passed.');
