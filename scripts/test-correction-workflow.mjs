import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const exactLabel = 'Submit suggestion';

assert.match(
  html,
  /<h3 class="modal-title"[^>]*>Suggest a correction<\/h3>/,
);
assert.match(html, /onclick="openSuggest\(\)">Suggest a correction<\/button>/);
assert.match(html, /id="suggest-type"/);
assert.match(html, /id="suggest-text" maxlength="6000"/);
assert.match(html, /id="suggest-explanation" maxlength="3000"/);
assert.match(html, /id="suggest-sources"/);
assert.match(html, /id="suggest-status" role="status" aria-live="polite"/);
assert.match(html, /id="suggest-submit"[^>]*onclick="submitSuggestion\(\)"/);
assert.match(html, /fetch\(`\$\{EXAMINER_WORKER_URL\}\/corrections`/);
assert.match(html, /questionId:\s*q\.id/);
assert.match(html, /subject:\s*q\.sourceSubject \|\| q\.subject \|\| currentSubj/);
assert.match(html, /correctionType:\s*document\.getElementById\('suggest-type'\)\.value/);
assert.match(html, /setSuggestStatus\('Submitting your correction suggestion…', 'loading'\)/);
assert.match(html, /setSuggestStatus\('Correction suggestion submitted successfully\.', 'success'\)/);
assert.match(html, /setSuggestStatus\(error\.message, 'error'\)/);
assert.match(html, /The correction suggestion could not be submitted/);
assert.match(html, /function suggestionQuestion\(context = null\)/,
  'Subject Matter must pass its exact question and course into the correction workflow.');
assert.doesNotMatch(html, /id="suggest-email"/);
assert.doesNotMatch(html, /id="suggest-mailto"/);
assert.doesNotMatch(html, /ORIGINAL MODEL ANSWER/);
assert.doesNotMatch(html, /Submitter email/);

const functionSource = html.match(
  /let activeSuggestionQuestion = null;[\s\S]*?(?=\/\* ---------- Voice-to-text dictation \(real, with fallback\) ---------- \*\/)/,
)?.[0];
assert.ok(functionSource, 'Correction workflow functions must be extractable for behavioral tests.');

function testContext() {
  const elements = Object.fromEntries([
    'suggest-qid',
    'suggest-type',
    'suggest-text',
    'suggest-explanation',
    'suggest-sources',
    'suggest-status',
    'suggest-submit',
  ].map((id) => {
    const classes = new Set();
    const attributes = new Map();
    return [id, {
      id,
      value: '',
      textContent: '',
      className: '',
      disabled: false,
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        contains(value) { return classes.has(value); },
      },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) || null; },
    }];
  }));
  const toasts = [];
  const context = vm.createContext({
    BAR_QUESTIONS: {
      'Labor Law': [{
        id: 'LAB-001',
        subject: 'Labor Law',
        sourceSubject: 'Labor Law',
      }],
    },
    currentSubj: 'Labor Law',
    currentIdx: 0,
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    EXAMINER_WORKER_URL: 'https://worker.example',
    URL,
    openModal() {},
    toast(message, state) {
      toasts.push({ message, state });
    },
    fetch: async () => {
      throw new Error('fetch stub not configured');
    },
  });
  vm.runInContext(functionSource, context);
  return { context, elements, toasts };
}

{
  const { context, elements } = testContext();
  vm.runInContext('openSuggest()', context);
  elements['suggest-text'].value = 'short';
  elements['suggest-explanation'].value = 'A sufficiently long explanation.';
  await vm.runInContext('submitSuggestion()', context);
  assert.equal(elements['suggest-status'].className, 'suggest-status error');
  assert.match(elements['suggest-status'].textContent, /at least 10 characters/i);
  assert.equal(elements['suggest-submit'].disabled, false);
}

{
  const { context, elements } = testContext();
  vm.runInContext('openSuggest()', context);
  elements['suggest-text'].value = 'A legally precise proposed correction.';
  elements['suggest-explanation'].value = 'The stored legal basis needs this clarification.';
  elements['suggest-sources'].value = 'https://elibrary.judiciary.gov.ph/source';
  let resolveRequest;
  context.fetch = () => new Promise((resolve) => {
    resolveRequest = resolve;
  });

  const pending = vm.runInContext('submitSuggestion()', context);
  assert.equal(elements['suggest-status'].className, 'suggest-status loading');
  assert.equal(elements['suggest-submit'].disabled, true);
  resolveRequest(Response.json({
    ok: true,
    message: 'Suggest a Correction/Better Answer submitted successfully.',
  }, { status: 201 }));
  await pending;
  assert.equal(elements['suggest-status'].className, 'suggest-status success');
  assert.equal(
    elements['suggest-status'].textContent,
    'Correction suggestion submitted successfully.',
  );
  assert.equal(elements['suggest-submit'].textContent, 'Submitted');
}

{
  const { context, elements } = testContext();
  vm.runInContext('openSuggest()', context);
  elements['suggest-text'].value = 'A legally precise proposed correction.';
  elements['suggest-explanation'].value = 'The stored legal basis needs this clarification.';
  context.fetch = async () => Response.json({
    ok: false,
    error: { message: 'Suggest a Correction/Better Answer could not be submitted.' },
  }, { status: 502 });

  await vm.runInContext('submitSuggestion()', context);
  assert.equal(elements['suggest-status'].className, 'suggest-status error');
  assert.match(elements['suggest-status'].textContent, /could not be submitted/i);
  assert.equal(elements['suggest-submit'].disabled, false);
  assert.equal(elements['suggest-submit'].textContent, exactLabel);
}

console.log('Correction workflow frontend contract and state tests passed.');
