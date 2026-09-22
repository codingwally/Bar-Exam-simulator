const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('examination-room/submission-recovery.js', 'utf8');
const html = fs.readFileSync('examination-room/submission-recovery.html', 'utf8');

test('submission recovery reads same-origin IndexedDB and submits complete local snapshot directly', () => {
  assert.match(source, /duediligence-examination-room-v1/);
  assert.match(source, /attempt\.status === 'pending_submit'/);
  assert.match(source, /downloadCopy\(attempt\)/);
  assert.match(source, /state\.api\.submitAttempt\(/);
  assert.doesNotMatch(source, /flushOperationQueue/);
  assert.match(source, /attempt\.status = 'submitted'/);
  assert.match(html, /Download copy and submit now/);
  assert.match(html, /submission-recovery\.js\?v=submission-recovery-20260922-8/);
});
