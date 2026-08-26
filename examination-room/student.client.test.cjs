'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studentSource = fs.readFileSync(path.join(__dirname, 'student.js'), 'utf8');
const studentHtml = fs.readFileSync(path.join(__dirname, 'student.html'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');

test('the student sees one short general warning and one understand-and-begin action', () => {
  assert.match(studentHtml, /<h2 id="privacyTitle">Privacy warning<\/h2>/);
  assert.match(studentHtml, /This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor\./);
  assert.match(studentHtml, /These records can be viewed by your Professor and the platform owner\./);
  assert.match(studentHtml, /<span>I understand — begin exam<\/span>/);
  assert.doesNotMatch(studentHtml, /Retention and access/);
  assert.doesNotMatch(studentHtml, /Questions or accommodations/);
  assert.doesNotMatch(studentHtml, /noticeVersion/);
});

test('technical attempt binding remains versioned while recorded proctoring fails closed', () => {
  assert.match(studentSource, /recordingRequired/);
  assert.match(studentSource, /recordingAccepted:\s*recordingRequired/);
  assert.match(studentSource, /Recorded proctoring is unavailable/);
  assert.match(studentSource, /elements\.agreeButton\.disabled = recordingRequired/);
  assert.doesNotMatch(studentSource, /Agree to recording and begin/);
  assert.match(apiSource, /recordingAccepted:\s*request\.acceptance\?\.recordingAccepted === true/);
});

test('a cached notice acceptance cannot be reused across a changed recording requirement', () => {
  assert.match(studentSource, /acceptance\.recordingAccepted === recordingRequired/);
});

test('student email is optional for the default key-only room and sent only when entered', () => {
  assert.match(studentHtml, /id="email"[^>]*type="email"/);
  assert.doesNotMatch(studentHtml, /id="email"[^>]*required/);
  assert.match(studentHtml, /Leave this blank for the default key-only room/);
  assert.match(studentSource, /email: normaliseEmail\(elements\.email\.value\)/);
  assert.match(studentSource, /student: \{[\s\S]*fullName: state\.entry\.fullName,[\s\S]*email: state\.entry\.email,[\s\S]*studentNumber:/);
  assert.match(studentSource, /metadata\.admissionMode === 'email_allowlist'/);
});

test('email-limited rooms give a self-resolving missing or unlisted email message', () => {
  assert.match(studentSource, /EMAIL_REQUIRED:[\s\S]*Enter the same email address/);
  assert.match(studentSource, /EMAIL_NOT_ALLOWED:[\s\S]*ask the examination creator to add the correct address/);
  assert.match(studentSource, /SESSION_REVOKED:[\s\S]*latest saved work remains attached/);
  assert.match(studentSource, /STUDENT_BLOCKED:[\s\S]*Contact the examination creator or Admin/);
});

test('the final-question action remains enabled and opens review instead of trapping the student', () => {
  assert.match(studentSource, /elements\.nextButton\.disabled = false/);
  assert.match(studentSource, /state\.currentIndex === state\.questions\.length - 1 \? 'Review and submit'/);
  assert.match(studentSource, /navigateToQuestion\(state\.currentIndex \+ 1\)/);
  assert.match(studentSource, /if \(index >= state\.questions\.length\) \{[\s\S]*openSubmitDialog\(\)/);
  assert.match(studentHtml, /student\.js\?v=greenfield-v1-20260827-7/);
});
