import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const frontend = await readFile(new URL('assets/duediligence-2026.js', root), 'utf8');

function between(start, end) {
  const startIndex = frontend.indexOf(start);
  const endIndex = frontend.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return frontend.slice(startIndex, endIndex);
}

const gradingBlock = between('function openGrading', 'async function requestFullscreen');
const renderBlock = between('function renderGrading', 'async function loadGradingModelAnswer');
const saveBlock = between('async function saveGrade', 'function nextGrade');
const moveBlock = between('function moveGrade', 'function nextGrade');
const nextBlock = between('function nextGrade', 'async function unlockAttempt');
const releaseBlock = between('async function releaseResults', 'function resultPdfFileName');
const downloadBlock = between('async function downloadCandidateResult', 'async function requestFullscreen');

// A missing score must fail before numeric conversion can silently turn it into zero.
assert.match(saveBlock, /const rawScore = String\(scoreInput\?\.value \|\| ''\)\.trim\(\)/);
assert.ok(saveBlock.indexOf("if (!rawScore)") < saveBlock.indexOf("const result = await command"),
  'blank-score validation must happen before save_grade');
assert.match(saveBlock, /A blank score is never saved as zero/);
assert.match(saveBlock, /score < 0 \|\| score > maximumPoints/);
assert.doesNotMatch(saveBlock, /score:\s*Number\(value\('dd26-grade-score'\)\)/,
  'save_grade must not coerce an empty input with Number("")');

// Every editable grade field exposes an unsaved state, and all navigation paths ask first.
assert.match(renderBlock, /id="dd26-grading-unsaved" role="status" \$\{draft \? '' : 'hidden'\}/);
assert.match(renderBlock, /Draft restored\./,
  'A locally preserved grading draft must be identified when restored.');
assert.match(renderBlock, /if \(!filteredEntries\.length\)[\s\S]*No answers match the \$\{escapeHtml\(state\.exam\.gradingFilter\)\} filter\./,
  'An empty grading filter must not display an unrelated student answer.');
assert.match(frontend, /visibilitychange[\s\S]*persistCurrentGradingDraft\(\)/,
  'Backgrounding the browser must preserve the current grading draft.');
for (const id of ['dd26-grade-score', 'dd26-grade-state', 'dd26-grade-comment', 'dd26-grade-reason']) {
  assert.match(renderBlock, new RegExp(`'${id}'`));
}
assert.match(renderBlock, /if \(!mayLeaveCurrentGrade\(\)\)[\s\S]*event\.target\.value = String\(state\.exam\.gradingCandidate\)/);
assert.match(renderBlock, /if \(!mayLeaveCurrentGrade\(\)\)[\s\S]*event\.target\.value = String\(state\.exam\.gradingQuestion\)/);
assert.match(moveBlock, /!skipUnsavedCheck && !mayLeaveCurrentGrade\(\)/);
assert.match(nextBlock, /function nextGrade\(\) \{ moveGrade\(1\); \}/);
assert.match(gradingBlock, /This grade has unsaved changes\. Leave without saving them\?/);
assert.match(renderBlock, /getElementById\('dd26-exam-role-home'\)[\s\S]*stopImmediatePropagation\(\)[\s\S]*clearGradingWorkspace\(\)/,
  'the Examination Room back button must not retain the grading key or silently discard changes');

// Sending is class-wide, visibly separate from one-student PDF download, and locked until all grades are final.
assert.match(renderBlock, /Download this student’s result/);
assert.match(renderBlock, /Downloading does not send results or change the examination/);
assert.match(renderBlock, /Send final results/);
assert.match(renderBlock, /separate class-wide action/);
assert.match(renderBlock, /absent or no-show do not receive a result/);
assert.match(renderBlock, /id="dd26-release-results" type="button" \$\{allGradesFinal \? '' : 'disabled'\}/);
assert.match(releaseBlock, /gradingQuestions\(grading\)\.filter\(\(question\) => question\.gradeState !== 'final'\)/);
assert.match(releaseBlock, /operation: 'release_results'/);
assert.match(releaseBlock, /Include the examination questions/);
assert.match(releaseBlock, /Student answers are not included/);

// Candidate PDFs use the exact private route contract and the only three approved scopes.
const scopes = [...renderBlock.matchAll(/name="dd26-result-pdf-scope" value="([a-z_]+)"/g)].map((match) => match[1]);
assert.deepEqual(scopes, ['questions_answers', 'answers_only', 'grades_comments']);
assert.match(downloadBlock, /fetch\(`\$\{config\.workerUrl\}\/exam-room\/results\/pdf`/);
assert.match(downloadBlock, /credentials: 'same-origin'/);
assert.match(downloadBlock, /Authorization: `Bearer \$\{session\.access_token\}`/);
assert.match(downloadBlock, /body: JSON\.stringify\(\{ examId: grading\.examId, attemptId: candidate\.attemptId, scope, gradingKey: grading\.gradingKey, requestKey: randomKey\('exam_result'\) \}\)/);
assert.match(downloadBlock, /contentType\.toLowerCase\(\)\.startsWith\('application\/pdf'\)/);
assert.match(downloadBlock, /blob\.size > 5 \* 1024 \* 1024/);
assert.doesNotMatch(downloadBlock, /release_results|confirmReleaseResults|includeQuestionnaire/,
  'downloading a candidate PDF must never send, release, or seal results');

// Explicit exits and class release clear the retained grading secret. Page
// lifecycle changes preserve the workspace and its durable local draft.
assert.match(gradingBlock, /function clearGradingWorkspace\(\)[\s\S]*grading\.gradingKey = ''/);
const pagehideBlock = frontend.slice(frontend.indexOf("addEventListener?.('pagehide'"), frontend.indexOf("document.addEventListener?.('visibilitychange'"));
assert.match(pagehideBlock, /persistCurrentGradingDraft\(\)/);
assert.doesNotMatch(pagehideBlock, /clearGradingWorkspace|gradingKey = ''/,
  'Alt-Tab, mobile backgrounding, and file pickers must not destroy grading state.');
assert.match(gradingBlock, /function leaveGradingWorkspace\(\)[\s\S]*clearGradingWorkspace\(\)/);
assert.match(releaseBlock, /clearGradingWorkspace\(\)[\s\S]*Graded results sent/);

console.log('Examination Room grading and private-result frontend checks passed.');
