import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const phase2 = await fs.readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const phase4 = await fs.readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');

assert.match(html, /id="welcome-state"/);
assert.match(html, /Prepare with purpose\./);
assert.match(html, /id="start-practice"/);
assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, 'Mobile layouts require an explicit viewport declaration.');
assert.match(html, /let currentSubj = null;/, 'A new visitor must not silently start in Civil Law.');
assert.doesNotMatch(html, /requestAnimationFrame\(showInvestorWelcome\)/, 'Patron modal must not auto-open.');
assert.match(html, /duediligence\.terms\.accepted\.v1/);
assert.match(html, /id="terms-modal"[\s\S]*aria-modal="true"/);
assert.match(html, /id="signin-prompt-modal"[\s\S]*Enter the Mock Bar/);
assert.match(
  html,
  /function continueAfterTerms\(\) \{\s*if \(window\.DueDiligencePhase4\?\.getSession\?\.\(\)\?\.access_token\) \{\s*showSubjectSelection\(\);\s*return;/,
  'An authenticated user must bypass the obsolete guest sign-in prompt.',
);
assert.match(html, /id="subject-choice-grid"/);
assert.match(
  html,
  /id="subject-selection-close"[\s\S]*aria-label="Close subject selection and return to Mock Bar"[\s\S]*onclick="exitSubjectSelection\(\)"/,
  'The subject chooser must expose an accessible close control.',
);
assert.match(
  html,
  /id="subject-selection-back"[\s\S]*onclick="exitSubjectSelection\(\)"[\s\S]*>Back<\/button>/,
  'The subject chooser must expose a visible Back action.',
);
assert.match(
  html,
  /function exitSubjectSelection\(\) \{[\s\S]*pendingSubjectSelection = null;[\s\S]*showWelcome\(\);[\s\S]*\}/,
  'Both exit controls must return to the existing Mock Bar welcome state.',
);
assert.match(
  html,
  /function showSubjectSelection\(\) \{[\s\S]*window\.scrollTo\(\{ top: 0, behavior: 'auto' \}\);[\s\S]*close\?\.focus\(\{ preventScroll: true \}\);[\s\S]*\}/,
  'Opening subject selection must keep the close control visible and place keyboard focus on it without scrolling it away.',
);
assert.match(
  html,
  /e\.key === 'Escape' && onboardingStage === 'subjectSelection'[\s\S]*exitSubjectSelection\(\)/,
  'Escape must close the subject chooser for keyboard users.',
);
assert.match(html, /id="session-choice-modal"[\s\S]*Would you like to begin your session\?/);
assert.match(html, /Strict Scrutiny[\s\S]*12 minutes per question/);
assert.match(html, /Quantum Meruit[\s\S]*Track your writing time/);
assert.match(html, /Summary Judgment[\s\S]*without a visible timer/);
assert.match(html, /const PER_Q_SECONDS = 720;/);
assert.doesNotMatch(html, /Recommended:\s*35[–-]45 mins per essay/);
assert.doesNotMatch(html, /setInterval\(tickSession/);
assert.match(html, /sessionController\.beginSession/);
assert.match(html, /sessionController\.pause\(\)/);
assert.match(html, /sessionController\.startQuestion/);
assert.match(html, /markAutomaticAdvanceHandled/);
assert.match(html, /selectedSessionMode !== 'none'/);
assert.match(html, /function questionAnswerKey\(subject = currentSubj, index = currentIdx\)/);
assert.doesNotMatch(
  html,
  /userAnswers\[`?\$\{currentSubj\}-\$\{currentIdx\}`?\]/,
  'Answer drafts must use stable question IDs rather than list indexes.',
);
assert.match(phase2, /dispatchEvent\(new CustomEvent\('duediligence:session'/);
assert.match(phase4, /addEventListener\('duediligence:session'/);
assert.match(phase4, /refreshAccess\(\)\.catch/);
assert.match(html, /setQuestionControlsDisabled\(true\)/, 'The submitted question must lock while its assessment is under review.');

const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
  .filter((match) => !/\ssrc=/.test(match[0]) && !/type="application\/ld\+json"/i.test(match[0]))
  .map((match) => match[1]);
for (const [index, source] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));
}

console.log('Onboarding and session-flow static tests passed.');
