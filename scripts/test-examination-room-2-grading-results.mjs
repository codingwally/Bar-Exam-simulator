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
const classResultsBlock = between('function classResultCandidates', 'function resultPdfFileName');
const downloadBlock = between('async function downloadCandidateResult', 'async function requestFullscreen');

assert.match(saveBlock, /const rawScore = String\(scoreInput\?\.value \|\| ''\)\.trim\(\)/);
assert.ok(saveBlock.indexOf("if (!rawScore)") < saveBlock.indexOf('const result = await command'));
assert.match(saveBlock, /A blank score is never saved as zero/);
assert.match(saveBlock, /score < 0 \|\| score > maximumPoints/);
assert.doesNotMatch(saveBlock, /score:\s*Number\(value\('dd26-grade-score'\)\)/);

assert.match(renderBlock, /id="dd26-grading-unsaved" role="status" \$\{draft \? '' : 'hidden'\}/);
assert.match(renderBlock, /Draft restored\./);
assert.match(renderBlock, /if \(!filteredEntries\.length\)[\s\S]*No answers match the \$\{escapeHtml\(state\.exam\.gradingFilter\)\} filter\./,
  'an empty grading filter must not display an unrelated student answer');
assert.match(frontend, /visibilitychange[\s\S]*persistCurrentGradingDraft\(\)/);
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

assert.match(renderBlock, /Download this student(?:â€™|’)s result/);
assert.match(renderBlock, /Downloading does not send results or change the examination/);
assert.match(renderBlock, /Class results and offline grading/);
assert.match(renderBlock, /exact questions, submitted answers, roster details, timing, current scores, comments, and analysis/);
assert.match(renderBlock, /id="dd26-review-class-results"/);

assert.match(classResultsBlock, /operation: 'results_dashboard'/);
assert.match(classResultsBlock, /data-dd26-class-result-candidate/);
assert.match(classResultsBlock, /Download selected workbook/);
assert.match(classResultsBlock, /Send grades \+ download all/);
assert.match(classResultsBlock, /offline_grading/);
assert.match(classResultsBlock, /class_results/);
assert.match(classResultsBlock, /\/exam-room\/results\/workbook/);
assert.match(classResultsBlock, /bytes\[0\] !== 0x50 \|\| bytes\[1\] !== 0x4b/);
assert.match(classResultsBlock, /operation: 'release_results'/);
assert.match(classResultsBlock, /gradingQuestions\(grading\)\.filter\(\(question\) => question\.gradeState !== 'final'\)/);
assert.match(classResultsBlock, /Include examination questions in student result emails/);
assert.match(classResultsBlock, /The downloaded Professor workbook always includes questions and submitted answers/);
assert.match(frontend, /Class grading queue/);
assert.match(frontend, /data-dd26-open-grading-candidate/);
assert.match(frontend, /dd26-grading-queue" open/);
assert.match(frontend, /Save and Next continues through the selected grading filter/);
assert.match(classResultsBlock, /await downloadClassWorkbook\(report, attemptIds, 'class_results'/);
assert.match(classResultsBlock, /clearGradingWorkspace\(\)[\s\S]*Graded results were queued for delivery/);
assert.match(classResultsBlock, /renderProfessorResultsDashboard\(report\)/);
for (const metric of ['Participation', 'Class average', 'Median score', 'Absent / no-show', 'Late entry or submission', 'Strongest item', 'Lowest-performing item']) {
  assert.match(classResultsBlock, new RegExp(metric));
}
assert.doesNotMatch(classResultsBlock, /setInterval|setTimeout\([^)]*renderProfessorResultsDashboard/,
  'the results dashboard must not create a render loop');

const scopes = [...renderBlock.matchAll(/name="dd26-result-pdf-scope" value="([a-z_]+)"/g)].map((match) => match[1]);
assert.deepEqual(scopes, ['questions_answers', 'answers_only', 'grades_comments']);
assert.match(downloadBlock, /fetch\(`\$\{config\.workerUrl\}\/exam-room\/results\/pdf`/);
assert.match(downloadBlock, /credentials: 'same-origin'/);
assert.match(downloadBlock, /Authorization: `Bearer \$\{session\.access_token\}`/);
assert.match(downloadBlock, /body: JSON\.stringify\(\{ examId: grading\.examId, attemptId: candidate\.attemptId, scope, gradingKey: grading\.gradingKey, requestKey: randomKey\('exam_result'\) \}\)/);
assert.match(downloadBlock, /contentType\.toLowerCase\(\)\.startsWith\('application\/pdf'\)/);
assert.match(downloadBlock, /blob\.size > 5 \* 1024 \* 1024/);
assert.doesNotMatch(downloadBlock, /release_results|confirmReleaseResults|includeQuestionnaire/);

assert.match(gradingBlock, /function clearGradingWorkspace\(\)[\s\S]*grading\.gradingKey = ''/);
const pagehideBlock = frontend.slice(frontend.indexOf("addEventListener?.('pagehide'"), frontend.indexOf("document.addEventListener?.('visibilitychange'"));
assert.match(pagehideBlock, /persistCurrentGradingDraft\(\)/);
assert.doesNotMatch(pagehideBlock, /clearGradingWorkspace|gradingKey = ''/,
  'Alt-Tab, mobile backgrounding, and file pickers must not destroy grading state');
assert.match(gradingBlock, /function leaveGradingWorkspace\(\)[\s\S]*clearGradingWorkspace\(\)/);

console.log('Examination Room grading, class workbook, and Professor dashboard frontend checks passed.');
