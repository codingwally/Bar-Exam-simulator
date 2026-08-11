import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const occurrences = Array.from(html.matchAll(new RegExp(`(?:async\\s+)?function\\s+${escapedName}\\s*\\(`, 'g')));
  assert.equal(occurrences.length, 1, `${name}() must have one active definition.`);
  const start = occurrences[0].index;
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  assert.fail(`${name}() could not be extracted.`);
}

const nextQuestionSource = extractFunction('nextQuestion');
const nextContext = {
  examStage: 'reviewing',
  gradingInProgress: false,
  reviewTransitions: 0,
  answeringTransitions: 0,
};
nextContext.proceedAfterReview = () => {
  nextContext.reviewTransitions += 1;
  nextContext.examStage = 'transitioning';
};
nextContext.transitionToProtectedRandomQuestion = () => {
  nextContext.answeringTransitions += 1;
  nextContext.examStage = 'transitioning';
};
const nextQuestion = vm.runInNewContext(`(${nextQuestionSource})`, nextContext);

nextQuestion();
nextQuestion();
assert.equal(nextContext.reviewTransitions, 1, 'Post-grade upper NEXT must advance exactly once.');
assert.equal(nextContext.answeringTransitions, 0, 'Review navigation must use the protected review transition.');

nextContext.examStage = 'answering';
nextQuestion();
assert.equal(nextContext.answeringTransitions, 1, 'Upper NEXT must continue working while answering.');

nextContext.examStage = 'reviewing';
nextContext.gradingInProgress = true;
nextQuestion();
assert.equal(nextContext.reviewTransitions, 1, 'Upper NEXT must stay guarded while grading is pending.');

const workspaceControls = [{ disabled: false }, { disabled: false }, { disabled: false }];
const toolbarControls = [{ disabled: false }, { disabled: false }, { disabled: false }];
const controlsContext = {
  examStage: 'reviewing',
  Boolean,
  document: {
    querySelectorAll(selector) {
      if (selector === '#answer-box, #submit-btn, #main .mic') return workspaceControls;
      if (selector === '#main .toolbar button') return toolbarControls;
      throw new Error(`Unexpected control selector: ${selector}`);
    },
  },
};
const setQuestionControlsDisabled = vm.runInNewContext(
  `(${extractFunction('setQuestionControlsDisabled')})`,
  controlsContext,
);

setQuestionControlsDisabled(true);
assert.ok(workspaceControls.every((control) => control.disabled), 'The submitted answer must remain immutable.');
assert.ok(toolbarControls.every((control) => !control.disabled), 'Post-grade navigation must remain available.');

controlsContext.examStage = 'answering';
setQuestionControlsDisabled(true);
assert.ok(workspaceControls.every((control) => control.disabled), 'The answer workspace must lock during access checks.');
assert.ok(toolbarControls.every((control) => control.disabled), 'Navigation must lock while an assessment is pending.');

setQuestionControlsDisabled(false);
assert.ok(workspaceControls.every((control) => !control.disabled), 'The answer workspace must recover after a failed check.');
assert.ok(toolbarControls.every((control) => !control.disabled), 'Navigation must recover after a failed check.');

controlsContext.examStage = 'evaluating';
setQuestionControlsDisabled(false);
assert.ok(workspaceControls.every((control) => control.disabled), 'The workspace must not unlock during evaluation.');
assert.ok(toolbarControls.every((control) => control.disabled), 'Navigation must not unlock during evaluation.');

const savedAnswers = { 'Civil Law-q1': 'A submitted answer.' };
const savedResults = { 'Civil Law-q1': { score: 4.2 } };
let rejectProtectedLoad;
const transitionContext = {
  examStage: 'reviewing',
  gradingInProgress: false,
  currentSubj: 'Civil Law',
  currentIdx: 0,
  currentQuestionIndex: 0,
  currentAttemptKey: 'attempt-1',
  BAR_QUESTIONS: { 'Civil Law': [{ id: 'q1', text: 'Question 1' }] },
  userAnswers: savedAnswers,
  submissionResults: savedResults,
  protectedRequests: 0,
  renders: [],
  controlsLocked: [],
  workspaceLocks: [],
  resumes: 0,
  saveDraftForCurrentQuestion() {},
  newAttemptKey: () => 'attempt-2',
  persistWorkspace() {},
  renderMainWrite() { transitionContext.renders.push(transitionContext.examStage); },
  setQuestionControlsDisabled(value) { transitionContext.controlsLocked.push(value); },
  setWorkspaceLocked(value) { transitionContext.workspaceLocks.push(value); },
  sessionController: {
    pause() {},
    resume() { transitionContext.resumes += 1; },
    startQuestion() {},
  },
  window: {
    DueDiligencePhase4: {
      loadProtectedQuestion() {
        transitionContext.protectedRequests += 1;
        return new Promise((resolve, reject) => { rejectProtectedLoad = reject; });
      },
    },
    DueDiligencePhase2: {
      handleGradeError() {
        transitionContext.examStage = 'answering';
        return true;
      },
    },
    scrollTo() {},
  },
  toast() {},
  Date,
};
const transitionToProtectedRandomQuestion = vm.runInNewContext(
  `(${extractFunction('transitionToProtectedRandomQuestion')})`,
  transitionContext,
);
const firstTransition = transitionToProtectedRandomQuestion();
const rapidSecondTransition = transitionToProtectedRandomQuestion();
assert.equal(transitionContext.protectedRequests, 1, 'Rapid NEXT clicks must create one protected request.');
rejectProtectedLoad(new Error('Temporary question load failure'));
await Promise.all([firstTransition, rapidSecondTransition]);
assert.equal(transitionContext.examStage, 'reviewing', 'A failed post-grade NEXT must restore review state.');
assert.equal(transitionContext.resumes, 0, 'A failed post-grade NEXT must not restart the stopped timer.');
assert.ok(
  transitionContext.controlsLocked.length >= 1
    && transitionContext.controlsLocked.every((value) => value === true),
  'The submitted answer must remain locked after a failed NEXT or renewed sign-in.',
);
assert.deepEqual(savedAnswers, { 'Civil Law-q1': 'A submitted answer.' }, 'The submitted answer must be preserved.');
assert.deepEqual(savedResults, { 'Civil Law-q1': { score: 4.2 } }, 'The completed assessment must be preserved.');

const renderedMain = { innerHTML: '' };
const renderContext = {
  currentSubj: 'Civil Law',
  currentIdx: 0,
  examStage: 'reviewing',
  BAR_QUESTIONS: { 'Civil Law': [{ id: 'q1', text: 'Question 1' }] },
  submissionResults: { answerKey: { score: 4.2 } },
  timerRenders: 0,
  document: { getElementById: (id) => (id === 'main' ? renderedMain : null) },
  questionAnswerKey: () => 'answerKey',
  restoreDraftForKey: () => 'A submitted answer.',
  questionSourceMetadata: () => ({ yearLabel: '2025 Bar Examination', questionLabel: 'Question No. 1' }),
  renderExamControlBar() {
    renderContext.timerRenders += 1;
    return '<div id="timer-bar">Timer controls</div>';
  },
  renderLaborQuestionBankMessage() {},
  renderResultHTML: () => '<article data-completed-assessment>Assessment</article>',
  escapeHtml: (value) => String(value),
  countWords: (value) => value.trim().split(/\s+/).length,
  applyExamEnhancements() {},
  updateTimerDisplay() {},
};
const renderMainWrite = vm.runInNewContext(`(${extractFunction('renderMainWrite')})`, renderContext);
renderMainWrite();
assert.equal(renderContext.timerRenders, 0, 'Review must remove stopped timing controls from the upper screen.');
assert.match(renderedMain.innerHTML, /data-completed-assessment/, 'Review must keep the assessment visible.');
for (const action of ['nextQuestion', 'changeMockBarSubject', 'exitMockBarPractice']) {
  const button = renderedMain.innerHTML.match(new RegExp(`<button[^>]+onclick="${action}\\(\\)"[^>]*>`))?.[0] || '';
  assert.ok(button, `${action} must remain in the review toolbar.`);
  assert.doesNotMatch(button, /\bdisabled\b/, `${action} must remain enabled during review.`);
}
assert.match(renderedMain.innerHTML, /<textarea[^>]+disabled/, 'The reviewed answer must render read-only.');

renderContext.examStage = 'answering';
renderContext.submissionResults = {};
renderMainWrite();
assert.equal(renderContext.timerRenders, 1, 'Timing controls must remain available while answering.');
assert.match(renderedMain.innerHTML, /id="timer-bar"/, 'The answering screen must retain its timing controls.');
assert.doesNotMatch(
  renderedMain.innerHTML.match(/<textarea[^>]+>/)?.[0] || '',
  /\bdisabled\b/,
  'The active answer workspace must remain editable.',
);

assert.match(
  extractFunction('onTimeUp'),
  /saveDraftForCurrentQuestion\(\);[\s\S]*?persistWorkspace\(\);[\s\S]*?Your answer is safe and was not submitted/,
  'The optional 12-minute target must preserve the draft and leave submission to the student.',
);
assert.doesNotMatch(
  extractFunction('onTimeUp'),
  /evaluateAnswer|recordUnansweredAttempt|examStage = 'reviewing'/,
  'A practice timer ending must not submit or lock the answer.',
);

assert.match(
  html,
  /const timerMarkup = reviewing \? '' : renderExamControlBar\(workspaceLocked\);/,
  'Completed attempts must not leave inactive timing controls above the assessment.',
);
assert.match(
  html,
  /const navigationLocked = !\['answering', 'reviewing'\]\.includes\(examStage\);/,
  'Upper navigation must be available during post-grade review.',
);
assert.match(
  html,
  /if \(currentSubj === subjectAtSubmission && currentIdx === indexAtSubmission\) \{\s*renderMainWrite\(\);[\s\S]*?setQuestionControlsDisabled\(true\);/,
  'A successful grade must render the explicit review state before locking the submitted answer.',
);

console.log('Post-grade control regression tests passed.');
