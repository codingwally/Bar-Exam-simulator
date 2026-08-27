'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const compatibilitySource = fs.readFileSync(path.join(__dirname, 'professor-compatibility.js'), 'utf8');
const readableCss = fs.readFileSync(path.join(__dirname, 'professor-readable.css'), 'utf8');
const professorHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function loadCompatibility() {
  const calls = [];
  const originalApi = Object.freeze({
    professorCommand: async (...args) => {
      calls.push(args);
      return { ok: true };
    },
    professorQuery: async () => ({ ok: true }),
    requestId: () => 'request-id',
  });

  const label = { textContent: 'New examination' };
  const attributes = new Map();
  const listeners = new Map();
  const shortcut = {
    dataset: {},
    disabled: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    querySelector(selector) { return selector === 'span' ? label : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
  };
  let sourceClicks = 0;
  const sourceAction = { click() { sourceClicks += 1; } };
  const timers = [];
  const document = {
    readyState: 'complete',
    getElementById(id) { return id === 'new-exam-direct' ? shortcut : null; },
    querySelector(selector) {
      return selector === '#more-actions-menu [data-action="new-exam"]' ? sourceAction : null;
    },
    contains(node) { return node === shortcut; },
  };
  const window = {
    ExaminationRoomV1Api: originalApi,
    document,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  };

  vm.runInNewContext(compatibilitySource, { window }, { filename: 'professor-compatibility.js' });
  return {
    window,
    originalApi,
    calls,
    shortcut,
    label,
    attributes,
    listeners,
    timers,
    sourceClicks: () => sourceClicks,
  };
}

test('Professor saves and publishes with the institution-approved privacy notice without mutating the draft', async () => {
  const fixture = loadCompatibility();
  const legacyDraft = {
    exam: {
      examId: '3e3112d2-d201-4a2c-9037-2c297e879497',
      title: 'Legacy local draft',
      privacyNoticeVersion: 'exam-room-privacy-v1-2026-08-26',
    },
  };

  await fixture.window.ExaminationRoomV1Api.professorCommand('save_draft', legacyDraft, 'save-request');
  await fixture.window.ExaminationRoomV1Api.professorCommand('publish', legacyDraft, 'publish-request');

  assert.notEqual(fixture.window.ExaminationRoomV1Api, fixture.originalApi);
  assert.equal(fixture.window.ExaminationRoomV1Api.__privacyNoticeGuard, 'exam-room-v1');
  assert.ok(Object.isFrozen(fixture.window.ExaminationRoomV1Api));
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0][1].exam.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(fixture.calls[1][1].exam.privacyNoticeVersion, 'exam-room-v1');
  assert.equal(fixture.calls[0][2], 'save-request');
  assert.equal(fixture.calls[1][2], 'publish-request');
  assert.equal(legacyDraft.exam.privacyNoticeVersion, 'exam-room-privacy-v1-2026-08-26');
});

test('Professor compatibility guard leaves non-writing Examination Room commands unchanged', async () => {
  const fixture = loadCompatibility();
  const payload = { examId: 'f72870a3-c2c8-44f8-8586-13cd8c40184e', roomKeyHash: 'hash' };

  await fixture.window.ExaminationRoomV1Api.professorCommand('open_room', payload, 'open-request');

  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0][1], payload);
  assert.equal(fixture.calls[0][2], 'open-request');
});

test('visible New examination control invokes the established multiple-examination action', () => {
  const fixture = loadCompatibility();
  let prevented = false;

  fixture.listeners.get('click')({ preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(fixture.sourceClicks(), 1);
  assert.equal(fixture.shortcut.disabled, true);
  assert.equal(fixture.attributes.get('aria-busy'), 'true');
  assert.equal(fixture.label.textContent, 'Creating…');
  assert.equal(fixture.timers.length, 1);
  assert.equal(fixture.timers[0].delay, 8000);

  fixture.timers[0].callback();
  assert.equal(fixture.shortcut.disabled, false);
  assert.equal(fixture.attributes.has('aria-busy'), false);
  assert.equal(fixture.label.textContent, 'New examination');
});

test('Professor shell loads the reliability guard and readable stylesheet in the correct order', () => {
  const baseCssPosition = professorHtml.indexOf('professor.css?v=');
  const readableCssPosition = professorHtml.indexOf('professor-readable.css?v=exam-room-readability-20260827-1');
  const apiPosition = professorHtml.indexOf('api.js?v=');
  const compatibilityPosition = professorHtml.indexOf('professor-compatibility.js?v=exam-room-reliability-20260827-1');
  const professorPosition = professorHtml.indexOf('professor.js?v=');

  assert.ok(baseCssPosition >= 0);
  assert.ok(readableCssPosition > baseCssPosition);
  assert.ok(apiPosition >= 0);
  assert.ok(compatibilityPosition > apiPosition);
  assert.ok(professorPosition > compatibilityPosition);
  assert.match(professorHtml, /id="new-exam-direct"[^>]*>\s*<i[^>]*><\/i><span>New examination<\/span>/);
});

test('readability layer sets a 16px base, larger controls, strong contrast, and laptop-specific reflow', () => {
  assert.match(readableCss, /body\s*\{[^}]*font-size:\s*16px;/s);
  assert.match(readableCss, /\.button\s*\{[^}]*min-height:\s*42px;[^}]*font-size:\s*14px;/s);
  assert.match(readableCss, /\.question-prompt\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.65;/s);
  assert.match(readableCss, /--muted:\s*#46515f;/);
  assert.match(readableCss, /@media \(min-width: 1200px\) and \(max-width: 1599px\)/);
  assert.match(readableCss, /@media \(min-width: 1024px\) and \(max-height: 800px\)/);
  assert.match(readableCss, /@media \(max-width: 720px\)/);
  assert.match(readableCss, /@media \(min-width: 1600px\)/);
  assert.match(readableCss, /@media \(prefers-contrast: more\)/);
});
