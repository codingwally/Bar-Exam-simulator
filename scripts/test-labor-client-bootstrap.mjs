import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/labor-practice.js', import.meta.url), 'utf8');

function makeHarness({ remoteCatalogEnabled = false } = {}) {
  const listeners = new Map();
  const elements = new Map();
  const local = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        hidden: false,
        disabled: false,
        focus() {},
        addEventListener() {},
        insertAdjacentHTML() {},
        scrollIntoView() {},
        closest() { return null; },
        querySelector() { return null; },
      });
    }
    return elements.get(id);
  }

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
            questionId: 'LAB-REMOTE-001',
            databaseVersion: '2026.07.1',
            essayQuestion: 'Remote fixture question.',
            topic: 'Fixture topic',
            barYear: 2024,
            questionNumber: '1',
            subpart: 'A',
            difficulty: 'Medium',
            sourceAttribution: 'Fixture source',
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
  context.DueDiligenceLaborConfig = { endpoint: 'https://example.test/functions/v1/labor-practice', remoteCatalogEnabled };
  vm.runInContext(`
    let currentSubj = 'Civil Law';
    let currentIdx = 0;
    let questionStartTs = Date.now();
    let userAnswers = {};
    let submissionResults = {};
    let historyLog = [];
    let legacyEvaluations = 0;
    const BAR_QUESTIONS = {
      'Labor Law': [{ id: 'LAB-LOCAL-001', text: 'Local fixture question.', model: 'Local fixture suggested answer.', caseLaw: 'Fixture case.' }],
      'Civil Law': [{ id: 'CIV-1', text: 'Legacy item.' }],
    };
    function renderSubjectTabs() {}
    function switchSubject(subject) { currentSubj = subject; currentIdx = 0; renderMainWrite(); }
    function renderMainWrite() { document.getElementById('main').innerHTML = 'legacy-render'; }
    function evaluateAnswer() { legacyEvaluations += 1; return 'legacy-evaluation'; }
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
  return { context, elements, local, legacyEvaluations: () => vm.runInContext('legacyEvaluations', context) };
}

assert.doesNotMatch(source, /closed-loop|secure catalog|practice is protected|retry secure catalog/i, 'Internal architecture wording must not appear in the student-facing Labor client.');
assert.match(source, /if \(isCuratedLaborQuestion\(\)\) return evaluateLaborAnswer\(\);/, 'Curated Labor questions must be intercepted before the legacy evaluator.');

const outage = makeHarness();
assert.match(vm.runInContext('String(switchSubject)', outage.context), /switchSubjectWithLabor/, 'The existing global switchSubject function must be wrapped directly.');
await vm.runInContext(`(async () => { switchSubject('Labor Law'); await Promise.resolve(); })()`, outage.context);
assert.equal(vm.runInContext('currentSubj', outage.context), 'Labor Law', 'The wrapper must update the existing lexical subject state.');
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"].length', outage.context), 1, 'A missing service must keep the last available Labor question catalog.');
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"][0].curatedLabor', outage.context), true, 'Available Labor records must be routed away from the legacy evaluator.');
assert.match(outage.elements.get('main').innerHTML, /legacy-render/, 'The existing rendering function remains the integration point.');

await vm.runInContext(`(async () => {
  userAnswers['Labor Law-0'] = 'This is a substantive fixture answer with enough words to be stored and reviewed.';
  await evaluateAnswer();
})()`, outage.context);
assert.equal(outage.legacyEvaluations(), 0, 'Labor Law never invokes the legacy keyword evaluator during an availability fallback.');
assert.ok(outage.local.size > 0, 'Labor Law drafts are persisted before a submission is attempted.');
const outageResult = vm.runInContext(`renderResultHTML('Labor Law-0')`, outage.context);
assert.match(outageResult, /Automated feedback is temporarily unavailable/, 'An evaluation outage leaves a recoverable student-facing result.');
assert.match(outageResult, /Local fixture suggested answer/, 'The matching local suggested answer remains available after a failed evaluation.');
assert.match(outageResult, /Try Again/, 'Students can retry feedback without creating a duplicate submission.');

const remote = makeHarness({ remoteCatalogEnabled: true });
await vm.runInContext(`(async () => { switchSubject('Labor Law'); await new Promise((resolve) => setTimeout(resolve, 0)); })()`, remote.context);
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"][0].questionId', remote.context), 'LAB-REMOTE-001', 'A ready remote catalog replaces the fallback only after it returns valid questions.');
assert.equal(vm.runInContext('BAR_QUESTIONS["Labor Law"][0].model', remote.context), '', 'Listing responses do not expose remote answer keys before submission.');

console.log('Labor client bootstrap passed.');
