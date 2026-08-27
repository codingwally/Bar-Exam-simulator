'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(path.join(__dirname, 'professor-runtime-fix.js'), 'utf8');
const readabilityCss = fs.readFileSync(path.join(__dirname, 'professor-readability.css'), 'utf8');
const professorHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function loadRuntimeFix() {
  const commandCalls = [];
  const originalApi = Object.freeze({
    marker: 'preserved',
    professorQuery: async () => ({
      ok: true,
      exam: {
        id: 'exam-1',
        privacyNoticeVersion: 'exam-room-privacy-v1-2026-08-26',
        controls: { privacyNoticeVersion: 'legacy-notice' },
      },
      exams: [{ id: 'exam-1', privacyNoticeVersion: 'legacy-notice' }],
    }),
    professorCommand: async (operation, payload, idempotencyKey) => {
      commandCalls.push({ operation, payload, idempotencyKey });
      return { ok: true, examId: payload?.exam?.id || null };
    },
  });
  const window = { ExaminationRoomV1Api: originalApi };
  vm.runInNewContext(runtimeSource, { window }, { filename: 'professor-runtime-fix.js' });
  return { api: window.ExaminationRoomV1Api, commandCalls, originalApi };
}

test('legacy professor drafts always use the institution-approved privacy notice without mutating the browser copy', async () => {
  const { api, commandCalls } = loadRuntimeFix();
  const input = {
    exam: {
      id: 'exam-2',
      title: 'Labor Law Midterm',
      privacyNoticeVersion: 'exam-room-privacy-v1-2026-08-26',
      controls: { privacyNoticeVersion: 'legacy-notice' },
    },
  };
  const originalSnapshot = structuredClone(input);

  const result = await api.professorCommand('save_draft', input, 'request-1');

  assert.deepEqual(input, originalSnapshot);
  assert.equal(commandCalls[0].payload.exam.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(commandCalls[0].payload.exam.controls.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(result.exam.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(result.exam.controls.privacyNoticeVersion, 'exam-room-v1');
});

test('a new blank examination is immediately server-saveable while publication still requires a real title', async () => {
  const { api, commandCalls } = loadRuntimeFix();
  const blank = { exam: { id: 'exam-new', title: '   ', privacyNoticeVersion: 'legacy' } };

  const saved = await api.professorCommand('save_draft', blank, 'request-save');
  await api.professorCommand('publish', blank, 'request-publish');

  assert.equal(commandCalls[0].payload.exam.title, 'Untitled examination');
  assert.equal(saved.exam.title, 'Untitled examination');
  assert.equal(commandCalls[1].payload.exam.title, '   ');
  assert.equal(commandCalls[1].payload.exam.privacyNoticeVersion, 'exam-room-v1');
});

test('loaded server examinations are normalized before the Professor editor can persist them again', async () => {
  const { api, originalApi } = loadRuntimeFix();
  const result = await api.professorQuery('exam', { examId: 'exam-1' });

  assert.equal(api.marker, originalApi.marker);
  assert.equal(result.exam.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(result.exam.controls.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(result.exams[0].privacyNoticeVersion, 'exam-room-v1');
  assert.equal(api.__professorDraftPolicyFixApplied, true);
  assert.equal(Object.isFrozen(api), true);
});

function rgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const [red, green, blue] = rgb(hex).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left, right) {
  const brightest = Math.max(luminance(left), luminance(right));
  const darkest = Math.min(luminance(left), luminance(right));
  return (brightest + 0.05) / (darkest + 0.05);
}

test('readability layer meets laptop, responsive type, and contrast contracts', () => {
  assert.match(readabilityCss, /body\s*\{[\s\S]*font-size:\s*clamp\(15px,/);
  assert.match(readabilityCss, /@media \(min-width: 1201px\) and \(max-width: 1500px\)/);
  assert.match(readabilityCss, /@media \(max-width: 720px\)[\s\S]*font-size:\s*16px/);
  assert.match(readabilityCss, /\.button\s*\{[\s\S]*min-height:\s*42px;[\s\S]*font-size:\s*14px;/);
  assert.ok(contrast('#111827', '#fffefb') >= 7);
  assert.ok(contrast('#4b5563', '#fffefb') >= 4.5);
  assert.ok(contrast('#6f4d0f', '#fffefb') >= 4.5);
  assert.match(professorHtml, /professor-readability\.css\?v=readability-20260827-1/);
  assert.match(professorHtml, /api\.js[^\n]*\n\s*<script src="professor-runtime-fix\.js\?v=privacy-new-exam-20260827-1"><\/script>\n\s*<script src="offline-grading-core\.js/);
});
