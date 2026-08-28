import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  homeHtml,
  shellCss,
  professorHtml,
  professorCss,
  professorSource,
  adminHtml,
  adminCss,
  serviceWorker,
] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('assets/quorum-first-shell.css', 'utf8'),
  readFile('examination-room/index.html', 'utf8'),
  readFile('examination-room/professor.css', 'utf8'),
  readFile('examination-room/professor.js', 'utf8'),
  readFile('admin/index.html', 'utf8'),
  readFile('admin/examination-room-admin.css', 'utf8'),
  readFile('service-worker.js', 'utf8'),
]);

const shellPhoneStart = shellCss.indexOf('@media (max-width: 560px)', shellCss.indexOf('@media (max-width: 900px)'));
const shellPhoneEnd = shellCss.indexOf('@media (max-width: 900px)', shellPhoneStart);
const shellPhoneCss = shellCss.slice(shellPhoneStart, shellPhoneEnd);
assert.ok(shellPhoneStart >= 0 && shellPhoneEnd > shellPhoneStart, 'The signed-in shell must keep a bounded phone-only block.');
assert.match(shellPhoneCss, /#site-header\.qfs-shell\s*\{[^}]*min-height:\s*116px;[^}]*grid-template-rows:\s*60px 56px;/s);
assert.match(shellPhoneCss, /#site-header\.qfs-shell \.topbar-actions\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;[^}]*width:\s*100%;/s);
assert.match(shellPhoneCss, /#site-header\.qfs-shell \.brand\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;[^}]*max-width:\s*100%;/s);
assert.match(shellCss, /@media \(max-width: 560px\)\s*\{\s*\.public-navigation-status\s*\{[^}]*top:\s*128px;/s);

const professorTabletStart = professorCss.lastIndexOf('@media (max-width: 820px)');
const professorPhoneStart = professorCss.indexOf('@media (max-width: 560px)', professorTabletStart);
const professorTabletCss = professorCss.slice(professorTabletStart, professorPhoneStart);
const professorPhoneCss = professorCss.slice(professorPhoneStart, professorCss.indexOf('@media print', professorPhoneStart));
assert.match(professorTabletCss, /\.hero-title-field textarea\s*\{[^}]*min-height:\s*calc\(2\.2em \+ 2px\);[^}]*height:\s*auto;[^}]*field-sizing:\s*content;/s);
assert.doesNotMatch(professorTabletCss, /height:\s*auto !important;/);
assert.match(professorSource, /const title = safeText\(\$\('#exam-title'\)\.value, 180\);/);
assert.match(professorSource, /textarea\.style\.height = 'auto';\s*textarea\.style\.height = `\$\{Math\.max\(38, textarea\.scrollHeight\)\}px`;/);
assert.match(professorSource, /\$\('#exam-title'\)\.addEventListener\('input',[^\n]*autoResizeTitle\(\)/);
assert.match(professorPhoneCss, /\.hero-title-field textarea\s*\{[^}]*min-height:\s*calc\(3\.3em \+ 2px\);[^}]*font-size:\s*32px;/s);

const adminPhoneStart = adminCss.lastIndexOf('@media (max-width: 560px)');
const adminPhoneCss = adminCss.slice(adminPhoneStart);
assert.match(adminPhoneCss, /\.exam-admin-request-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*align-items:\s*stretch;/s);
assert.match(adminPhoneCss, /\.exam-admin-request-state\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-start;/s);
assert.match(adminPhoneCss, /\.exam-admin-request-state \.exam-admin-status\s*\{[^}]*white-space:\s*normal;/s);
assert.match(adminPhoneCss, /\.exam-admin-selected-title h2,[\s\S]*overflow-wrap:\s*anywhere;/);
assert.match(adminPhoneCss, /\.exam-admin-selected-header \.exam-admin-exam-selector select\s*\{[^}]*max-width:\s*100%;/s);
assert.match(adminPhoneCss, /\.exam-admin-section-body > \*,[\s\S]*\.exam-admin-selected-record > \*,[\s\S]*\.exam-admin-question-list \.exam-admin-raw\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
assert.match(adminPhoneCss, /\.exam-admin-section-export > span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
assert.match(adminPhoneCss, /\.exam-admin-question-list > article,[\s\S]*\.exam-admin-question-list \.exam-admin-raw\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
assert.match(adminPhoneCss, /\.exam-admin-question-list > article > header\s*\{[^}]*flex-wrap:\s*wrap;/s);
assert.match(adminPhoneCss, /\.exam-admin-question-list > article > footer > :is\(code, span\),[\s\S]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);

assert.match(homeHtml, /quorum-first-shell\.css\?v=profile-photo-release2-20260827-1&amp;baseline=public-reliability-20260827-3/);
assert.match(professorHtml, /professor\.css\?v=renovation-20260828-5/);
assert.match(adminHtml, /examination-room-admin\.css\?v=owner-command-center-20260828-7/);
assert.match(adminHtml, /examination-room-admin\.js\?v=owner-command-center-20260828-3/);
assert.match(serviceWorker, /CACHE_VERSION = 'duediligence-shell-20260827-profile-pedro-release2-1-examination-room-renovation-20260828-5'/);
assert.match(serviceWorker, /quorum-first-shell\.css\?v=profile-photo-release2-20260827-1&baseline=public-reliability-20260827-3/);

console.log('Mobile header, creator-title, and Admin Examination Room responsive hotfix contracts passed.');
