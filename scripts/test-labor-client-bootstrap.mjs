import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/labor-practice.js', import.meta.url), 'utf8');
const listeners = new Map();
const elements = new Map();

function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      disabled: false,
      addEventListener() {},
      insertAdjacentHTML() {},
      scrollIntoView() {},
      closest() { return null; },
      querySelector() { return null; },
    });
  }
  return elements.get(id);
}

const local = new Map();
const context = vm.createContext({
  console,
  AbortController,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  String,
  Number,
  Array,
  Object,
  RegExp,
  localStorage: {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key),
  },
  document: {
    addEventListener: (name, listener) => listeners.set(name, listener),
    getElementById: (id) => element(id),
    querySelector: () => null,
  },
  fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.action, 'list_questions');
    return {
      ok: true,
      json: async () => ({
        questions: [{
          questionId: 'LAB-001',
          databaseVersion: '2026.07.1',
          essayQuestion: 'Fixture question.',
          topic: 'Fixture topic',
          barYear: 2024,
          questionNumber: '1',
          difficulty: 'Medium',
          sourceUrl: 'https://example.test/source',
          preview: false,
        }],
        facets: { barYears: [2024], topics: ['Fixture topic'], difficulties: ['Medium'] },
        stale: false,
      }),
    };
  },
});
context.window = context;
context.DueDiligenceLaborConfig = { endpoint: 'https://example.test/functions/v1/labor-practice' };

vm.runInContext(`
  let currentSubj = 'Civil Law';
  let currentIdx = 0;
  let questionStartTs = Date.now();
  let userAnswers = {};
  let submissionResults = {};
  let historyLog = [];
  const BAR_QUESTIONS = { 'Labor Law': [], 'Civil Law': [{ id: 'CIV-1', text: 'Legacy item.' }] };
  function renderSubjectTabs() {}
  function switchSubject(subject) { currentSubj = subject; currentIdx = 0; renderMainWrite(); }
  function renderMainWrite() { document.getElementById('main').innerHTML = 'legacy-render'; }
  function evaluateAnswer() { return 'legacy-evaluation'; }
  function handleInput(input) { userAnswers[currentSubj + '-' + currentIdx] = input.value; }
  function loadQuestion(index) { currentIdx = index; renderMainWrite(); }
  function submitAndNext() { currentIdx += 1; renderMainWrite(); }
  function rateModel() { return 'legacy-rating'; }
  function openSuggest() { return 'legacy-suggest'; }
  function submitSuggestion() { return 'legacy-submit'; }
  function renderResultHTML() { return 'legacy-result'; }
  function logAttempt() {}
  function toast() {}
  function openModal() {}
  function closeModal() {}
  function escapeHtml(value) { return String(value); }
  ${source}
`, context);

assert.match(vm.runInContext('String(switchSubject)', context), /switchSubjectWithLabor/, 'The existing global switchSubject function must be wrapped directly.');
await vm.runInContext(`(async () => { switchSubject('Labor Law'); await new Promise((resolve) => setTimeout(resolve, 0)); })()`, context);

assert.equal(vm.runInContext('currentSubj', context), 'Labor Law', 'The wrapper must update the existing lexical subject state.');
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"].length', context), 1, 'Only the secure catalog response may populate Labor Law.');
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"][0].curatedLabor', context), true, 'Loaded Labor records must be marked as curated.');
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"][0].model', context), '', 'The listing contract must not provide an answer key.');
assert.match(element('main').innerHTML, /legacy-render/, 'The existing rendering function remains the integration point.');

console.log('Labor client bootstrap passed.');
