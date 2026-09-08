import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [source, css] = await Promise.all([
  readFile(new URL('../assets/examinations.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/examinations.css', import.meta.url), 'utf8'),
]);

// A small inert tree for the renderer's HTML, including real parent/sibling
// replacement. It does not claim browser layout, computed CSS or scrolling QA.
class Element {
  constructor(tagName, attributes = {}, text = '') {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = [];
    this.parentElement = null;
    this.text = text;
    this.scrollTop = 0;
    this.dataset = Object.fromEntries(Object.entries(attributes)
      .filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase()), value]));
    this.classList = { toggle: (name, enabled) => {
      const classes = new Set((this.attributes.class || '').split(/\s+/).filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.attributes.class = [...classes].join(' ');
    } };
  }
  append(node) { node.parentElement = this; this.children.push(node); }
  get textContent() { return this.text + this.children.map((node) => node.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get isConnected() { return this.tagName === '#document' || Boolean(this.parentElement?.isConnected); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
    if (tag && this.tagName !== tag) return false;
    for (const [, name] of selector.matchAll(/\.([a-z0-9_-]+)/gi)) {
      if (!(this.attributes.class || '').split(/\s+/).includes(name)) return false;
    }
    for (const [, key, value] of selector.matchAll(/\[([a-z0-9_-]+)(?:="([^"]*)")?\]/gi)) {
      if (!(key in this.attributes) || (value !== undefined && this.attributes[key] !== value)) return false;
    }
    return this.tagName !== '#text';
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(markup) {
    const parsed = parse(markup);
    this.children = parsed.children;
    this.children.forEach((child) => { child.parentElement = this; });
  }
  set outerHTML(markup) {
    assert.ok(this.parentElement, 'A replaced review panel must be attached.');
    const parent = this.parentElement;
    const replacement = parse(markup).children;
    replacement.forEach((child) => { child.parentElement = parent; });
    parent.children.splice(parent.children.indexOf(this), 1, ...replacement);
    this.parentElement = null;
  }
}

function parse(markup) {
  const root = new Element('#document');
  const stack = [root];
  for (const token of String(markup).match(/<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('</')) {
      const tag = token.slice(2, -1).trim();
      assert.equal(stack.at(-1).tagName, tag, 'Renderer HTML must close its own element: ' + tag);
      stack.pop();
    } else if (token.startsWith('<')) {
      const tag = token.match(/^<([a-z0-9-]+)/i)?.[1];
      assert.ok(tag, 'Only expected renderer elements belong in this inert tree.');
      const attributes = Object.fromEntries([...token.slice(tag.length + 1, -1)
        .matchAll(/([a-z0-9_-]+)(?:="([^"]*)")?/gi)].map(([, key, value]) => [key, value ?? '']));
      const node = new Element(tag, attributes);
      stack.at(-1).append(node);
      if (!['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)) stack.push(node);
    } else stack.at(-1).append(new Element('#text', {}, token));
  }
  assert.equal(stack.length, 1, 'Renderer HTML must be balanced.');
  return root;
}

const attemptId = '10000000-0000-4000-8000-000000000001';
const questionId = '20000000-0000-4000-8000-000000000002';
function fixture() {
  return {
    attemptId, questionId, subject: 'Civil Law', prompt: 'Define the required legal concept.',
    answerText: 'My exact saved response <script>never executable</script>.', aiScore: 3.5,
    modelAnswer: 'PRIVATE_CANONICAL_ANSWER', legalBasis: 'PRIVATE_CANONICAL_AUTHORITY',
    sources: [{ url: 'https://lawphil.net/private-canonical-source', title: 'PRIVATE_CANONICAL_SOURCE' }],
    aiAssessment: {
      rationale: 'The definition was direct but omitted one limitation.',
      performanceLabel: 'Developing', strengths: ['You identified the central concept.'],
      errors: ['The required qualification was missing.'], improvements: ['State the qualification precisely.'],
      rubricBreakdown: { questionType: 'definition', applicationRequired: false,
        responsiveness: 1, legalBasis: 1, application: 0.5, conclusion: 1 },
      modelAnswerALAC: { answer: 'PRIVATE_MODEL_DISCUSSION', application: 'PRIVATE_MODEL_APPLICATION' },
    },
  };
}

function harness({ assisted = false, eligible = true } = {}) {
  const document = new Element('#document');
  document.readyState = 'loading';
  document.addEventListener = () => {};
  const calls = [];
  const window = {
    DueDiligencePhase2Config: { workerUrl: 'https://worker.inert' },
    DueDiligencePhase4: {
      getSession: () => ({ user: { id: 'inert-owner' }, access_token: 'inert-token' }),
      getAccess: () => ({ eligible }), canRevealSubjectReview: () => eligible,
      request: () => { calls.push('request'); throw new Error('NO_REQUESTS_IN_RENDER_TEST'); },
    },
  };
  const marker = 'global.DueDiligenceExaminations = Object.freeze({';
  assert.ok(source.includes(marker));
  vm.runInNewContext(source.replace(marker, `global.__coachingTest = {
    state, subjectMatterResultMarkup, subjectPracticeRoomMarkup, assessmentCard,
    updateCompleteSubjectReviewPanels, subjectReviewMaterialKey
  };\n${marker}`), { window, document, URL, console });
  const hooks = window.__coachingTest;
  hooks.state.active = { examination: { track: 'per_subject', subject: 'Civil Law' },
    attempt: { attemptId, assisted, submittedAt: '2026-09-09T00:00:00Z' }, questions: [] };
  return { document, calls, hooks };
}

for (const assisted of [false, true]) for (const eligible of [false, true]) {
  test(`unrevealed submitted coaching is on the right: assisted=${assisted}, eligible=${eligible}`, () => {
    const h = harness({ assisted, eligible });
    const result = fixture();
    const original = JSON.stringify(result);
    h.document.innerHTML = h.hooks.subjectMatterResultMarkup(result, attemptId);
    const left = h.document.querySelector('main.is-writing');
    const right = h.document.querySelector('aside.is-review-panel');
    const coaching = right.querySelector('[data-subject-result-coaching]');
    const review = right.querySelector('[data-subject-review-panel]');
    assert.ok(left && right && coaching && review);
    assert.equal(coaching.parentElement, review.parentElement, 'Coaching is a sibling, not replaceable review content.');
    assert.equal(left.querySelector('.assessment-card'), null);
    assert.equal(h.document.querySelectorAll('.assessment-card').length, 1);
    assert.match(left.textContent, /My exact saved response &lt;script&gt;/);
    assert.equal(h.document.querySelector('script'), null);
    for (const text of ['3.5 / 5', result.aiAssessment.rationale, ...result.aiAssessment.strengths,
      ...result.aiAssessment.errors, ...result.aiAssessment.improvements, 'Task performance']) {
      assert.ok(coaching.textContent.includes(text), text);
    }
    assert.doesNotMatch(coaching.textContent, /PRIVATE_|Suggested discussion|Supporting legal sources/);
    assert.equal(coaching.textContent.includes(result.prompt), false, 'Compact coaching must not duplicate the question.');
    assert.ok(review.querySelector('[data-subject-review-reveal]'));
    assert.equal(review.dataset.submitted, 'true');
    assert.equal(review.dataset.subjectReviewAccess, eligible ? 'eligible' : 'locked');
    assert.equal(h.document.querySelector('[data-subject-attempt-classification]').textContent,
      assisted ? 'Assisted / Open-book' : 'Unassisted');
    const scroll = coaching.querySelector('.dd-subject-coaching-scroll');
    assert.equal(scroll.getAttribute('role'), 'region');
    assert.equal(scroll.getAttribute('tabindex'), '0');
    assert.ok(coaching.querySelector(`[id="${scroll.getAttribute('aria-labelledby')}"]`));
    assert.ok(coaching.querySelector(`[id="${scroll.getAttribute('aria-describedby')}"]`));
    assert.equal(JSON.stringify(result), original, 'Moving feedback must not change saved result fields.');
    assert.deepEqual(h.calls, [], 'Showing coaching does not fetch/reveal anything.');
  });
}

function material(assisted = false) {
  return { attemptId, questionId, assisted, suggestedAnswer: 'AUTHORIZED_CANONICAL_REVIEW',
    legalBasis: 'The approved governing rule.', sources: [], reviewMaterialRevealedAt: '2026-09-09T00:01:00Z' };
}

for (const assisted of [false, true]) test(`existing Reveal replacement preserves coaching node and scroll: ${assisted}`, () => {
  const h = harness({ assisted });
  h.document.innerHTML = h.hooks.subjectMatterResultMarkup(fixture(), attemptId);
  const coaching = h.document.querySelector('[data-subject-result-coaching]');
  const scroll = coaching.querySelector('.dd-subject-coaching-scroll');
  const previousText = coaching.textContent;
  scroll.scrollTop = 240;
  h.hooks.updateCompleteSubjectReviewPanels(attemptId, questionId, material(assisted));
  assert.equal(h.document.querySelector('[data-subject-result-coaching]'), coaching);
  assert.equal(coaching.textContent, previousText);
  assert.equal(scroll.scrollTop, 240);
  assert.equal(h.document.querySelector('[data-subject-review-panel]'), null);
  const revealed = h.document.querySelector('[data-subject-review-content]');
  assert.equal(revealed.parentElement, coaching.parentElement);
  assert.equal(h.document.querySelectorAll('.assessment-card').length, 1);
  assert.equal(h.document.textContent.split('AUTHORIZED_CANONICAL_REVIEW').length - 1, 1);
  assert.doesNotMatch(coaching.textContent, /AUTHORIZED_CANONICAL_REVIEW/);
  assert.equal(h.hooks.state.active.attempt.assisted, assisted);
  assert.deepEqual(h.calls, []);
});

test('cached authorized review and assessment render as separate siblings', () => {
  const h = harness();
  h.hooks.state.reviewMaterialCache.set(h.hooks.subjectReviewMaterialKey(attemptId), material());
  h.document.innerHTML = h.hooks.subjectMatterResultMarkup(fixture(), attemptId);
  const coaching = h.document.querySelector('[data-subject-result-coaching]');
  const revealed = h.document.querySelector('[data-subject-review-content]');
  assert.equal(coaching.parentElement, revealed.parentElement);
  assert.equal(h.document.querySelectorAll('.assessment-card').length, 1);
  assert.doesNotMatch(coaching.textContent, /AUTHORIZED_CANONICAL_REVIEW|PRIVATE_/);
  assert.deepEqual(h.calls, []);
});

test('pre-submission editor and Reveal layout do not receive a coaching scroll region', () => {
  const h = harness();
  h.hooks.state.active.attempt.submittedAt = null;
  h.document.innerHTML = h.hooks.subjectPracticeRoomMarkup({ question: fixture(), timerMode: 'none' });
  assert.equal(h.document.querySelector('[data-subject-result-coaching]'), null);
  assert.equal(h.document.querySelector('.dd-subject-coaching-scroll'), null);
  assert.equal(h.document.querySelector('textarea').getAttribute('maxlength'), '20000');
  assert.equal(h.document.querySelector('[data-subject-review-panel]').dataset.submitted, 'false');
  assert.ok(h.document.querySelector('[data-submit-current]'));
  assert.deepEqual(h.calls, []);
});

test('result-only scroll CSS keeps the writer/Reveal panes in document flow and mobile stacking', () => {
  assert.match(css, /\.dd-subject-editorial\.is-result \.dd-subject-coaching-scroll\s*\{[^}]*max-height:\s*42rem;[^}]*max-height:\s*min\(62vh, 42rem\);[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/);
  assert.match(css, /\.dd-subject-editorial\.is-result \.dd-subject-coaching-scroll:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(css, /\.dd-subject-editorial-pane\s*\{\s*overflow:\s*visible;/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.dd-subject-editorial-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test('dark Syllabus discussion paragraphs inherit the readable panel color, not the shared light-card ink', () => {
  assert.match(css, /\.dd-subject-editorial \.alac-part p\s*\{[^}]*color:\s*inherit;/);
  assert.match(css, /\.dd-subject-editorial \.source-link\s*\{[^}]*color:\s*#e5ebf2;/);
  const luminance = (hex) => {
    const channels = hex.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16) / 255)
      .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels.reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  assert.ok(contrast('24364d', '041d3b') < 4.5, 'Reproduce the original unreadable palette.');
  assert.ok(contrast('e5ebf2', '041d3b') >= 4.5, 'Normal discussion text must meet the contrast threshold.');
  assert.doesNotMatch(css, /^\.alac-part p\s*\{/m, 'Do not change unrelated light assessment cards.');
});
