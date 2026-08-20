import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sources = Object.freeze({
  'index.html': readFileSync(new URL('../../index.html', import.meta.url), 'utf8'),
  'assets/examinations.js': readFileSync(
    new URL('../../assets/examinations.js', import.meta.url),
    'utf8',
  ),
  'assets/duediligence-2026.js': readFileSync(
    new URL('../../assets/duediligence-2026.js', import.meta.url),
    'utf8',
  ),
});

function sectionBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing boundary ${endMarker}`);
  return source.slice(start, end);
}

function assertInOrder(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing ${marker}`);
    assert.ok(next > cursor, `${label}: ${marker} is out of order`);
    cursor = next;
  }
}

const coachingPaths = Object.freeze([
  {
    label: 'main essay evaluation',
    file: 'index.html',
    start: 'async function evaluateAnswer(options = {})',
    end: '\nfunction renderResultHTML(key)',
    order: ['await fetch(EXAMINER_WORKER_URL', 'renderMainWrite();'],
  },
  {
    label: 'Subject Matter coaching',
    file: 'assets/examinations.js',
    start: '  async function submitCurrentSubjectAnswer(button)',
    end: '\n  function showReceipt(receipt)',
    order: ["operation: 'request_ai_grading'", 'await openVerdict(state.active.attempt.attemptId);'],
  },
  {
    label: 'Bar Easy coaching',
    file: 'assets/duediligence-2026.js',
    start: '  async function gradeBarEasy()',
    end: '\n  function selectNext(items)',
    order: ["await api('/dd2026/bar-easy/grade'", "getElementById('dd26-easy-result').innerHTML"],
  },
  {
    label: 'Doctrine mastery coaching',
    file: 'assets/duediligence-2026.js',
    start: '  async function gradeDoctrine()',
    end: '\n  function renderCaseLibrary(items, chairs)',
    order: ["await api('/dd2026/doctrines/grade'", "getElementById('dd26-doctrine-result').innerHTML"],
  },
]);

const oneSecondDelayPatterns = Object.freeze([
  /\bsetTimeout\s*\([\s\S]{0,500}?(?:1_000|1000)\s*\)/i,
  /\b(?:sleep|delay|wait|pause)\w*\s*\(\s*(?:1_000|1000)\s*\)/i,
  /await\s+new\s+Promise\s*\([\s\S]{0,500}?setTimeout[\s\S]{0,500}?(?:1_000|1000)/i,
]);

for (const path of coachingPaths) {
  test(`${path.label} presents its completed result without an artificial one-second pause`, () => {
    const section = sectionBetween(
      sources[path.file],
      path.start,
      path.end,
      `${path.file} ${path.label}`,
    );

    for (const pattern of oneSecondDelayPatterns) {
      assert.doesNotMatch(
        section,
        pattern,
        `${path.label} must not delay completed coaching output by one second`,
      );
    }
    assertInOrder(section, path.order, path.label);
  });
}

test('coaching sources do not reintroduce a named one-second result-delay constant', () => {
  const namedResultDelay = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:coaching|assessment|grading|result)[\w$]*(?:delay|wait|pause)[\w$]*\s*=\s*(?:1_000|1000)\b/i;
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, namedResultDelay, `${file} must not define an artificial result delay`);
  }
});
