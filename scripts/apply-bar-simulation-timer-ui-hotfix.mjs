import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Owner-approved P0. Apply only reviewed replacements; fail closed on source drift.
const root = path.resolve(process.argv[2] || '.');
const marker = 'simulation-timer-review-20260906-r2';
const file = path.join(root, 'assets/examinations.js');
let source = fs.readFileSync(file, 'utf8');
function replaceOne(before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one match: ${before.slice(0, 90)}`);
  source = source.replace(before, after);
}
if (!source.includes(marker)) {
  replaceOne('  const HEARTBEAT_MS = 30_000;', `  // ${marker}: the Simulation clock is advisory, never a submission gate.\n  const HEARTBEAT_MS = 30_000;`);
  replaceOne(`      if (state.clientRemaining === 0 && !practiceAttempt && !state.expiryInFlight) {
        state.expiryInFlight = true;
        flushCurrentSave()
          .then((saved) => {
            if (!saved) throw new Error('The final answer revision was not confirmed.');
            return heartbeat(false).then((confirmed) => {
              if (!confirmed) throw new Error('The server did not confirm expiration.');
            });
          })
          .catch(() => {
            state.expiryInFlight = false;
            setStatus('The server timer has expired. Reconnecting to preserve and submit the examination…', 'error');
          });
      }`, `      if (state.clientRemaining === 0 && !practiceAttempt && !state.expiryInFlight) {
        state.expiryInFlight = true;
        saveRecovery();
        setStatus('The time target has ended. You can continue answering, review all answers, and submit when ready.');
      }`);
  replaceOne(`  async function saveCurrent(options = {}) {
    const question = currentQuestion();`, `  async function saveCurrent(options = {}) {
    const question = options.question || currentQuestion();`);
  replaceOne('    if (editor) question.answerText = editor.value;', '    if (editor && question === currentQuestion()) question.answerText = editor.value;');
  replaceOne(`      const newerLocalChanges = (question.answerText || '') !== answerSnapshot`, `      // A premature-expiry receipt is not a save acknowledgement. Never erase a draft with it.
      if (!result || result.questionId !== question.questionId
          || typeof result.answerText !== 'string'
          || !Number.isInteger(result.revision) || result.revision <= revisionSnapshot) {
        const error = new Error('Your draft is retained. The server did not confirm this answer save. Resume the examination to synchronize it.');
        error.code = 'ANSWER_SAVE_NOT_CONFIRMED';
        throw error;
      }
      const newerLocalChanges = (question.answerText || '') !== answerSnapshot`);
  replaceOne(`      } else if (!options.silent) {
        setStatus(error.message, 'error');
      }
      return false;
    } finally {
      state.saveInFlight = false;`, `      } else {
        setStatus(error.message || 'Your local draft is retained. Saving could not be confirmed.', 'error');
      }
      return false;
    } finally {
      state.saveInFlight = false;`);
  replaceOne(`  async function heartbeat(takeover) {`, `  async function flushSimulationAnswers() {
    if (!await flushCurrentSave()) return false;
    const active = state.active;
    if (!active) return false;
    // Review may open while offline. Confirm every retained answer before issuing the final receipt.
    for (const question of active.questions) {
      if (state.active !== active) return false;
      if (!await saveCurrent({ question, silent: false })) return false;
    }
    return state.active === active;
  }

  async function heartbeat(takeover) {`);
  replaceOne(`  async function showReview() {
    if (!await flushCurrentSave()) return;
    state.screen = 'review';
    const root = pageRoot(state.active.examination.track);
    const summary = counts();`, `  async function showReview() {
    if (!state.active) return;
    const active = state.active;
    const simulation = active.examination.track === 'bar_feels';
    if (!simulation && !await flushCurrentSave()) return;
    const root = pageRoot(active.examination.track);
    if (!root || state.active !== active) return;
    const question = currentQuestion();
    const editor = root.querySelector('#dd-answer-editor');
    if (question && editor) question.answerText = editor.value;
    saveRecovery();
    // Open the local review immediately; network latency and an expired timer cannot block navigation.
    // Start saving before replacing the editor so its latest text is captured.
    const savePromise = simulation ? flushCurrentSave() : Promise.resolve(true);
    state.screen = 'review';
    const summary = counts();`);
  replaceOne(`    </section></div>\x60;
  }

  async function submitExamination(button) {`, `    </section></div>\x60;
    focusRendered(root, 'h1');
    void savePromise.then((saved) => {
      if (!saved && state.active === active && state.screen === 'review') {
        setStatus('Review is open from your retained draft. Saving is not yet confirmed; your answers must synchronize before final submission.', 'error');
      }
    }).catch((error) => {
      if (state.active === active && state.screen === 'review') {
        setStatus(error.message || 'Review is open. Your draft is retained; reconnect before final submission.', 'error');
      }
    });
  }

  async function submitExamination(button) {`);
  replaceOne(`  async function submitExamination(button) {
    if (!state.active) return;
    button.disabled = true;`, `  async function submitExamination(button) {
    if (!state.active || button.disabled) return;
    const controls = [...(pageRoot(state.active.examination.track)?.querySelectorAll(
      '[data-review-question], [data-return-room], [data-submit-exam]',
    ) || [])];
    controls.forEach((control) => { control.disabled = true; });
    button.disabled = true;`);
  replaceOne(`      if (!await flushCurrentSave()) {
        throw new Error('The latest answer revision could not be confirmed. Nothing was submitted.');
      }`, `      const saved = state.active.examination.track === 'bar_feels'
        ? await flushSimulationAnswers()
        : await flushCurrentSave();
      if (!saved) {
        throw new Error('Your answers remain in the retained draft. Synchronization could not be confirmed; nothing was submitted.');
      }`);
  replaceOne(`      button.textContent = 'Submit Examination';
    }
  }

  async function submitCurrentSubjectAnswer`, `      button.textContent = 'Submit Examination';
      controls.forEach((control) => { if (control.isConnected) control.disabled = false; });
    }
  }

  async function submitCurrentSubjectAnswer`);
  fs.writeFileSync(file, source);
}
// Refresh the lazy-loader URL and its entry point without changing layout or other features.
for (const relative of ['assets/feature-loader.js', 'index.html', 'service-worker.js']) {
  const filename = path.join(root, relative);
  let text = fs.readFileSync(filename, 'utf8');
  const isHtml = relative.endsWith('.html');
  text = text.replace(/assets\/(?:examinations|feature-loader)\.js(?:\?[^'"\s<>`]*)?/g, (url) => {
    if (url.includes(marker)) return url;
    return url + (url.includes('?') ? (isHtml ? '&amp;' : '&') : '?') + 'simulation=' + marker;
  });
  if (relative === 'service-worker.js') {
    text = text.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = 'duediligence-shell-${marker}';`);
  }
  fs.writeFileSync(filename, text);
}
console.log(`Applied ${marker}; no auth, entitlement, scoring, timer duration, or layout changes.`);
