import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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

const scoreContext = vm.createContext({ Number, String, Array });
vm.runInContext(`
  function escapeHtml(value) { return String(value); }
  ${between('function classResultCandidateTotals', 'function classResultsAnalytics')}
  ${between('function candidateScoreDisclosure', 'function renderProfessorResultsDashboard')}
  globalThis.scoreDisclosure = candidateScoreDisclosure;
`, scoreContext);

const pendingScore = scoreContext.scoreDisclosure({
  studentName: 'Pending Student',
  allGradesFinal: false,
  questions: [{ ordinal: 1, score: null, maximumPoints: 5, gradeState: 'ungraded' }],
});
assert.match(pendingScore, /Recorded subtotal: 0\.00/);
assert.match(pendingScore, /Pending \/ 5\.00/);
assert.match(pendingScore, /0 of 1 questions graded/);
assert.doesNotMatch(pendingScore, />0\.00 \/ 5\.00</,
  'a pending grade must not be displayed as a scored zero');

const partialScore = scoreContext.scoreDisclosure({
  studentName: 'Partial Student',
  allGradesFinal: false,
  questions: [
    { ordinal: 1, score: 2.5, maximumPoints: 5, gradeState: 'draft' },
    { ordinal: 2, score: 1.7, maximumPoints: 5, gradeState: 'final' },
    { ordinal: 3, score: '', maximumPoints: 5, gradeState: 'ungraded' },
  ],
});
assert.match(partialScore, /Recorded subtotal: 4\.20/);
assert.match(partialScore, /2 of 3 questions graded/);
assert.match(partialScore, /Not final/);
assert.match(partialScore, /2\.50 \/ 5\.00/);
assert.match(partialScore, /1\.70 \/ 5\.00/);
assert.match(partialScore, /Pending \/ 5\.00/);

const finalScore = scoreContext.scoreDisclosure({
  studentName: 'Final Student',
  allGradesFinal: true,
  questions: [
    { ordinal: 1, score: 2.5, maximumPoints: 5, gradeState: 'final' },
    { ordinal: 2, score: 1.7, maximumPoints: 5, gradeState: 'final' },
  ],
});
assert.match(finalScore, /4\.20 \/ 10\.00/);
assert.match(finalScore, /42\.0%/);
assert.match(finalScore, /Final total/);
assert.doesNotMatch(finalScore, /Not final|Pending/);

assert.match(saveBlock, /const rawScore = String\(scoreInput\?\.value \|\| ''\)\.trim\(\)/);
assert.ok(saveBlock.indexOf("if (!rawScore)") < saveBlock.indexOf('const result = await command'));
assert.match(saveBlock, /A blank score is never saved as zero/);
assert.match(saveBlock, /score < 0 \|\| score > maximumPoints/);
assert.doesNotMatch(saveBlock, /score:\s*Number\(value\('dd26-grade-score'\)\)/);

assert.match(renderBlock, /id="dd26-grading-unsaved" role="status" \$\{draft \? '' : 'hidden'\}/);
assert.match(renderBlock, /Draft restored\./);
assert.match(renderBlock, /if \(!filteredEntries\.length\)[\s\S]*No answers match the \$\{escapeHtml\(state\.exam\.gradingFilter\)\} filter\./,
  'an empty grading filter must not display an unrelated student answer');
assert.match(gradingBlock, /function preferredGradingFilter[\s\S]*gradingEntries\(grading, 'ungraded'\)[\s\S]*gradingEntries\(grading, 'draft'\)[\s\S]*gradingEntries\(grading, 'graded'\)/,
  'reopening a fully graded examination must show its saved server grades instead of an empty ungraded view');
assert.match(gradingBlock, /state\.exam\.gradingFilter = preferredGradingFilter\(state\.exam\.grading\)/,
  'the initial grading filter must be selected from the actual saved records');
assert.match(renderBlock, /Your saved grades remain in the official examination record/);
assert.match(renderBlock, /id="dd26-open-saved-grades"[\s\S]*id="dd26-open-saved-class-results"/,
  'an intentionally empty filter must provide direct recovery paths to saved grades and class results');
assert.match(saveBlock, /!gradingEntries\(grading\)\.length[\s\S]*preferredGradingFilter\(grading\)/,
  'saving the last ungraded item must transition to a visible saved-grade record');
assert.match(moveBlock, /state\.exam\.gradingFilter = preferredGradingFilter\(grading\)/,
  'Save and Next must not strand the Professor on an empty filter after completing the class');
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

assert.match(renderBlock, /Download this student&(?:rsquo|#8217);s records/);
assert.match(renderBlock, /Downloading either file does not send results or change the examination/);
assert.match(renderBlock, /id="dd26-download-answer-sheet"[\s\S]*Download student answer PDF[\s\S]*id="dd26-download-grade-report"[\s\S]*Download final grade PDF/,
  'Professor answer sheets and final grade reports must remain separate private exports');
assert.match(renderBlock, /Class results and offline grading/);
assert.match(renderBlock, /exact questions, submitted answers, roster details, timing, current scores, comments, and analysis/);
assert.match(renderBlock, /id="dd26-review-class-results"/);

assert.match(classResultsBlock, /operation: 'results_dashboard'/);
assert.match(classResultsBlock, /data-dd26-class-result-candidate/);
assert.match(classResultsBlock, /Download selected workbook/);
assert.match(classResultsBlock, /No student has submitted yet/);
assert.match(classResultsBlock, /Download current workbook/);
assert.match(classResultsBlock, /checkboxes\.length > 0 && selected\.length < 1/,
  'the roster-only workbook must remain downloadable with zero submitted attempts');
assert.match(classResultsBlock, /Send selected student result/);
assert.match(classResultsBlock, /offline_grading/);
assert.match(classResultsBlock, /class_results/);
assert.match(classResultsBlock, /\/exam-room\/results\/workbook/);
assert.match(classResultsBlock, /bytes\[0\] !== 0x50 \|\| bytes\[1\] !== 0x4b/);
assert.match(classResultsBlock, /operation: 'release_candidate_results'/);
assert.match(classResultsBlock, /selectedCandidates\.filter\(\(candidate\) => candidate\.allGradesFinal !== true\)/);
assert.match(classResultsBlock, /attemptIds: input\.attemptIds|attemptIds,/,
  'candidate releases must carry only the explicitly selected attempt IDs');
assert.match(classResultsBlock, /Include examination questions in student result emails/);
assert.match(classResultsBlock, /The downloaded Professor workbook always includes questions and submitted answers/);
assert.match(frontend, /Class grading queue/);
assert.match(frontend, /data-dd26-open-grading-candidate/);
assert.match(frontend, /dd26-grading-queue" open/);
assert.match(frontend, /Save and Next continues through the selected grading filter/);
assert.match(classResultsBlock, /await downloadClassWorkbook\(report, attemptIds, 'class_results'/);
assert.doesNotMatch(classResultsBlock, /the examination was sealed/,
  'sending selected results must not seal the examination or affect unrelated students');
assert.match(classResultsBlock, /Selected student results were queued for delivery verification/);
assert.match(classResultsBlock, /renderProfessorResultsDashboard\(report\)/);
assert.match(classResultsBlock, /function candidateScoreDisclosure/);
assert.match(classResultsBlock, /class="dd26-score-disclosure"/);
assert.match(classResultsBlock, /View breakdown/);
assert.match(classResultsBlock, /id="dd26-dashboard-refresh"/);
assert.match(classResultsBlock, /data-dd26-lifecycle="end_access"/);
assert.match(classResultsBlock, /data-dd26-lifecycle="complete"/);
assert.match(classResultsBlock, /data-dd26-lifecycle="archive"/);
assert.match(classResultsBlock, /operation: 'update_exam_lifecycle'/);
for (const metric of ['Participation', 'Class average', 'Median score', 'Absent / no-show', 'Strongest item', 'Lowest-performing item']) {
  assert.match(classResultsBlock, new RegExp(metric));
}
assert.doesNotMatch(classResultsBlock, /Late entry or submission/,
  'Professor-visible results must not classify students by timing');
assert.doesNotMatch(classResultsBlock, /setInterval|setTimeout\([^)]*renderProfessorResultsDashboard/,
  'the results dashboard must not create a render loop');

assert.match(renderBlock, /dd26-download-answer-sheet[^\n]*downloadCandidateResult\('questions_answers'\)/);
assert.match(renderBlock, /dd26-download-grade-report[^\n]*downloadCandidateResult\('grades_comments'\)/);
assert.doesNotMatch(renderBlock, /downloadCandidateResult\('answers_only'\)/,
  'the simplified Professor workflow must expose only answer-sheet and final-grade PDFs');
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
