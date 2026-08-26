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
