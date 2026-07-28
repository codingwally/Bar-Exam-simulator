import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const exactLabel = 'Suggest a Correction/Better Answer';

assert.ok(
  html.split(exactLabel).length - 1 >= 8,
  'The exact correction workflow label must be used consistently.',
);
assert.match(html, /<h3 class="modal-title">Suggest a Correction\/Better Answer<\/h3>/);
assert.match(html, /onclick="openSuggest\(\)">[^<]*Suggest a Correction\/Better Answer<\/button>/);
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
assert.match(html, /setSuggestStatus\('Submitting Suggest a Correction\/Better Answer…', 'loading'\)/);
assert.match(html, /setSuggestStatus\('Suggest a Correction\/Better Answer submitted successfully\.', 'success'\)/);
assert.match(html, /setSuggestStatus\(error\.message, 'error'\)/);
assert.match(html, /Suggest a Correction\/Better Answer could not be submitted/);
assert.doesNotMatch(html, /id="suggest-email"/);
assert.doesNotMatch(html, /id="suggest-mailto"/);
assert.doesNotMatch(html, /ORIGINAL MODEL ANSWER/);
assert.doesNotMatch(html, /Submitter email/);

const functionSource = html.match(
  /function openSuggest\(\) \{[\s\S]*?(?=\/\* ---------- Voice-to-text dictation \(real, with fallback\) ---------- \*\/)/,
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
  ].map((id) => [id, {
    id,
    value: '',
    textContent: '',
    className: '',
    disabled: false,
  }]));
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
    'Suggest a Correction/Better Answer submitted successfully.',
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
