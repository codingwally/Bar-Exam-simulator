'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studentSource = fs.readFileSync(path.join(__dirname, 'student.js'), 'utf8');
const studentHtml = fs.readFileSync(path.join(__dirname, 'student.html'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
const mediaSource = fs.readFileSync(path.join(__dirname, 'media-capture.js'), 'utf8');
const studentApiRuntime = [
  apiSource.slice(apiSource.indexOf('function demoStudentPreview'), apiSource.indexOf('function demoStudentQuery')),
  apiSource.slice(apiSource.indexOf('async function studentPreview'), apiSource.indexOf('async function studentQuery')),
  apiSource.slice(apiSource.indexOf('// Compatibility surface used by the resilient student client'), apiSource.indexOf('async function loadExam')),
].join('\n');

test('the student enters directly after preview with no custom policy-gating payload or label', () => {
  assert.doesNotMatch(studentHtml, /privacyTitle|privacyDialog|I understand — begin exam/);
  assert.match(studentHtml, /id="beginButton"/);
  assert.match(studentHtml, /<span>Begin examination<\/span>/);
  assert.match(studentSource, /createAttemptBindingId/);
  assert.match(studentSource, /attemptBindingId:\s*state\.attemptBindingId/);
  assert.doesNotMatch(studentSource, /\b(?:agreed|consent|privacy|acceptance|policy)\b/i);
  assert.doesNotMatch(studentApiRuntime, /\b(?:agreed|consent|privacy|acceptance|policy)\b/i);
  assert.match(studentApiRuntime, /student\/begin/);
  assert.match(studentSource, /Available while this student key remains active/);
  assert.doesNotMatch(studentSource, /formatAvailability\(metadata\)[\s\S]{0,220}metadata\.(?:availabilityLabel|opensAt|closesAt)/);
});

test('technical attempt binding remains versioned while recorded media is non-blocking', () => {
  assert.match(studentSource, /'attempt-binding:' \+ await digestText\(\[/);
  assert.match(studentSource, /metadata\.examId,[\s\S]*metadata\.examVersion,[\s\S]*context\.roomKeyHash,[\s\S]*context\.studentHash/);
  assert.match(studentSource, /\(!attempt\.attemptBindingId \|\| attempt\.attemptBindingId === state\.attemptBindingId\)/);
  assert.doesNotMatch(studentSource, /Recorded proctoring is unavailable/);
  assert.match(studentSource, /state\.media\.start/);
  assert.match(studentSource, /Your examination remains open and answers continue saving/);
  assert.match(studentHtml, /media-capture\.js\?v=renovation-20260828-4/);
  assert.match(studentApiRuntime, /studentBegin\(\{/);
  assert.doesNotMatch(studentApiRuntime, /recordingAccepted|noticeVersion|acceptedAt/);
});

test('recorded-media upload uses the live idempotent contract and a self-contained encrypted object', () => {
  assert.match(mediaSource, /DDERMV1\\0/);
  assert.match(mediaSource, /encryptedBytes\.set\(iv, ENCRYPTED_CHUNK_MAGIC\.byteLength\)/);
  assert.match(mediaSource, /operation: 'prepare_upload'/);
  assert.match(mediaSource, /operation: 'complete_upload'/);
  assert.match(mediaSource, /idempotencyKey: 'media-prepare:' \+ chunk\.artifactId/);
  assert.match(mediaSource, /idempotencyKey: 'media-complete:' \+ chunk\.artifactId/);
  assert.match(mediaSource, /sourceMimeType: chunk\.originalMimeType/);
  assert.match(mediaSource, /encryptedSizeBytes: chunk\.encryptedBlob\.size/);
  assert.match(mediaSource, /chunk\.status = 'uploaded'/);
  assert.match(mediaSource, /chunk\.status = chunk\.provider \? 'uploaded' : 'queued'/);
  assert.doesNotMatch(mediaSource, /attemptId: context\.attemptId,\s*sessionToken:/);
  assert.doesNotMatch(mediaSource, /student\/media\/(?:upload|complete)/);
});

test('pending and submitted attempts resume only the encrypted media queue', () => {
  assert.match(mediaSource, /return Object\.freeze\(\{ start: start, resume: resume, stop: stop, flush: flush \}\)/);
  assert.match(mediaSource, /Submission remains complete/);
  assert.match(studentSource, /if \(attempt\.status === 'submitted'\) \{\s*resumeMediaUploads\(\)/);
  assert.match(studentSource, /if \(attempt\.status === 'pending_submit'\) \{\s*resumeMediaUploads\(\)/);
  assert.match(studentSource, /state\.media\.resume\(\{/);
  assert.doesNotMatch(studentSource, /await state\.media\.stop\(\)/);
});

test('camera and microphone permission starts only after entry and cannot block examination work', () => {
  assert.match(studentSource, /enterExamWorkspace\(\)[\s\S]*startMediaCapture\(\)/);
  assert.match(studentSource, /cameraRequired = metadata\.cameraRequired === true/);
  assert.match(studentSource, /microphoneRequired = metadata\.microphoneRequired === true/);
  assert.match(studentSource, /Recording could not start\. Your examination remains open and answers continue saving\./);
  assert.doesNotMatch(studentSource, /await state\.media\.start/);
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

test('inactive, unopened, archived, and blocked keys explain the exact next step', () => {
  assert.match(studentSource, /'ROOM_KEY_INVALID'/);
  assert.match(studentSource, /ROOM_KEY_INVALID:[\s\S]*ask the examination creator whether Admin has issued and opened the key/);
  assert.match(studentSource, /ROOM_NOT_OPEN:[\s\S]*try again after the examination creator announces/);
  assert.match(studentSource, /SUBJECT_MISMATCH:[\s\S]*Enter the subject exactly/);
  assert.match(studentSource, /EXAMINATION_ARCHIVED:[\s\S]*restore the room/);
  assert.match(studentSource, /EXAMINATION_BLOCKED:[\s\S]*Wait for Admin to reopen admission/);
  assert.match(studentSource, /hasSafeApiError[\s\S]*error\.message[\s\S]*error\.recovery/);
  assert.doesNotMatch(studentSource, /privacy-warning acknowledgement|privacy agreement remain saved/);
});

test('the final-question action remains enabled and opens review instead of trapping the student', () => {
  assert.match(studentSource, /elements\.nextButton\.disabled = false/);
  assert.match(studentSource, /state\.currentIndex === state\.questions\.length - 1 \? 'Review and submit'/);
  assert.match(studentSource, /navigateToQuestion\(state\.currentIndex \+ 1\)/);
  assert.match(studentSource, /if \(index >= state\.questions\.length\) \{[\s\S]*openSubmitDialog\(\)/);
  assert.match(studentHtml, /student\.js\?v=renovation-20260828-4/);
});
