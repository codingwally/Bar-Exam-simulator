'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studentSource = fs.readFileSync(path.join(__dirname, 'student.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');

test('the single privacy action records explicit recording acceptance only when recording is required', () => {
  assert.match(studentSource, /recordingRequired/);
  assert.match(studentSource, /recordingAccepted:\s*recordingRequired/);
  assert.match(studentSource, /Agree to recording and begin/);
  assert.match(apiSource, /recordingAccepted:\s*request\.acceptance\?\.recordingAccepted === true/);
});

test('a cached notice acceptance cannot be reused across a changed recording requirement', () => {
  assert.match(studentSource, /acceptance\.recordingAccepted === recordingRequired/);
});
