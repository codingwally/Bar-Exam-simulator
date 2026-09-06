import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Owner-approved display-only fix. Preserve all stored scores, answers and submission behavior.
const root = path.resolve(process.argv[2] || '.');
const marker = 'simulation-submitted-answer-20260906-r1';
const filename = path.join(root, 'assets/examinations.js');
let source = fs.readFileSync(filename, 'utf8');
const helper = `  // ${marker}: display the saved answer from this result, never the active editor or AI text.
  function simulationSubmittedAnswerMarkup(result = {}) {
    const answer = result.answerText;
    const available = typeof answer === 'string';
    const text = available && answer.trim()
      ? answer
      : available
        ? 'No answer was submitted for this question.'
        : 'The saved answer is unavailable for this question.';
    return \`<section class="assessment-section dd-simulation-submitted-response" aria-label="Your submitted answer" data-submitted-answer-section>
      <h4>Your answer</h4>
      <div class="dd-model-answer dd-simulation-submitted-answer" data-submitted-answer>\${escapeHtml(text)}</div>
    </section>\`;
  }

`;
const oldAnswer = '${options.answerText && !(isSubjectMatter && options.compactSubject) ?';
const newAnswer = "${track === 'bar_feels' ? simulationSubmittedAnswerMarkup(result) : options.answerText && !(isSubjectMatter && options.compactSubject) ?";
if (!source.includes(marker)) {
  assert.equal(source.split('  function assessmentCard(result, options = {}) {').length - 1, 1);
  assert.equal(source.split(oldAnswer).length - 1, 1);
  source = source.replace('  function assessmentCard(result, options = {}) {', helper + '  function assessmentCard(result, options = {}) {');
  source = source.replace(oldAnswer, newAnswer);
  fs.writeFileSync(filename, source);
}
assert.ok(source.includes(helper) && source.includes(newAnswer), 'Unexpected submitted-answer implementation');
const cssFile = path.join(root, 'assets/examinations.css');
let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes(marker)) {
  css += `\n/* ${marker}: reuse the existing cream-and-gold answer panel. */
.dd-simulation-submitted-response {
  margin-bottom: 24px;
}
.dd-simulation-submitted-answer {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: normal;
  user-select: text;
}\n`;
  fs.writeFileSync(cssFile, css);
}
// Version the lazy-loaded JS/CSS and loader entry point without touching stored browser drafts.
for (const relative of ['assets/feature-loader.js', 'index.html', 'service-worker.js']) {
  const file = path.join(root, relative);
  let text = fs.readFileSync(file, 'utf8');
  const isHtml = relative.endsWith('.html');
  text = text.replace(/assets\/(?:examinations\.(?:js|css)|feature-loader\.js)(?:\?[^'"\s<>`]*)?/g, (url) => {
    if (url.includes(marker)) return url;
    return url + (url.includes('?') ? (isHtml ? '&amp;' : '&') : '?') + 'answers=' + marker;
  });
  if (relative === 'service-worker.js') {
    text = text.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = 'duediligence-shell-${marker}';`);
  }
  fs.writeFileSync(file, text);
}
console.log(`Applied ${marker}. Display only; no database, AI, grading, access or timer changes.`);
