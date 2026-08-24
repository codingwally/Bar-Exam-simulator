import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const phase2 = await fs.readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const phase4 = await fs.readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');

assert.match(html, /id="private-beta-landing"/);
assert.match(html, /id="pb-pillars-title">Prepare with purpose\.<\/h1>/);
assert.match(html, /id="site-header"[\s\S]*class="spa-nav quorum-primary-nav"[\s\S]*Home[\s\S]*Study Features[\s\S]*Profile[\s\S]*Plans &amp; Pricing[\s\S]*Examination Room/);
assert.equal((html.match(/id="site-header"/g) || []).length, 1);
assert.doesNotMatch(html, /id="welcome-state"|id="start-practice"/,
  'The retired authenticated landing must be removed.');
assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, 'Mobile layouts require an explicit viewport declaration.');
assert.match(html, /let currentSubj = null;/, 'A new visitor must not silently start in Civil Law.');
assert.doesNotMatch(html, /requestAnimationFrame\(showInvestorWelcome\)/, 'Patron modal must not auto-open.');
assert.match(html, /duediligence\.terms\.accepted\.v1/);
const startPracticeSource = html.slice(
  html.indexOf('function startPractice()'),
  html.indexOf('function acceptTerms()'),
);
assert.doesNotMatch(
  startPracticeSource,
  /TERMS_ACCEPTANCE_KEY/,
  'Bar Question Practice must rely on the current server-versioned policy gate instead of repeating a stale local Terms prompt.',
);
assert.match(html, /id="terms-modal"[\s\S]*aria-modal="true"/);
assert.match(html, /id="signin-prompt-modal"[\s\S]*Open Bar Question Practice/);
assert.match(
  html,
  /function continueAfterTerms\(\) \{\s*if \(window\.DueDiligencePhase4\?\.getSession\?\.\(\)\?\.access_token\) \{\s*showSubjectSelection\(\);\s*return;/,
  'An authenticated user must bypass the obsolete guest sign-in prompt.',
);
assert.match(html, /id="subject-choice-grid"/);
assert.match(
  html,
  /id="subject-selection-close"[\s\S]*aria-label="Close subject selection and return to Bar Question Practice"[\s\S]*onclick="exitSubjectSelection\(\)"/,
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
  'Both exit controls must return through the homepage routing function.',
);
assert.match(
  html,
  /function showWelcome\(options = \{\}\)[\s\S]*setOnboardingView\('home'\)[\s\S]*DueDiligencePublicHome\?\.show/,
  'The compatibility home function must display the new public homepage rather than a retired internal state.',
);
assert.match(
  html,
  /page === 'mock' && examStage === 'idle'[\s\S]*startPractice\(\)/,
  'Opening Bar Question Practice from the application menu must go directly to the existing subject-selection flow.',
);
assert.match(phase2, /\['mock-bar', 'subject-matter', 'bar-feels', 'quorum', 'examination-room'\]/,
  'The canonical Bar Question Practice route must remain protected before sign-in.');
assert.match(phase2, /function restoreAuthDestination\(\)[\s\S]*if \(!state\.authReturnPending\) return;[\s\S]*history\.replaceState\([\s\S]*dueDiligenceRoute:\s*'quorum'[\s\S]*#quorum[\s\S]*PopStateEvent\('popstate'/,
  'OAuth return must open Quorum once while routine session recovery preserves the active route.');
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
assert.match(html, /id="session-choice-modal"[\s\S]*Bar Question Practice timer settings/);
assert.match(html, /12-minute question[\s\S]*focused 12-minute target/);
assert.match(html, /Stopwatch[\s\S]*See how much time you spend/);
assert.match(html, /Untimed question[\s\S]*without a clock or time limit/);
assert.match(html, /function preferredMockTimerMode\(\)[\s\S]*\? saved : 'selfPaced'/,
  'Bar Question Practice must default to Stopwatch.');
assert.match(html, /function selectSubjectForSession\(subject\)[\s\S]*chooseSessionMode\(selectedSessionMode\)/,
  'Selecting a subject must start with the saved/default timing mode without forcing the settings dialog.');
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
assert.match(
  phase4,
  /refreshAccess\(\{\s*enforce:\s*true,\s*force:\s*true\s*\}\)\.catch/,
  'Authenticated session recovery must enforce the access choice instead of silently granting access.',
);
assert.match(
  phase4,
  /addEventListener\('duediligence:profile-completed'[\s\S]*refreshAccess\(\{[\s\S]*enforce:\s*true,[\s\S]*force:\s*true,[\s\S]*routeHash:\s*'#quorum'/,
  'Completing profile onboarding must immediately re-check access and direct an unselected account to the mandatory plan gate.',
);
assert.match(
  phase4,
  /PROTECTED_ROUTES[\s\S]*'subject-matter'[\s\S]*ensureProtectedAccess/,
  'Subject Matter must pass through the same server-authoritative access gate before its feature loader opens.',
);
assert.match(html, /setQuestionControlsDisabled\(true\)/, 'The submitted question must lock while its assessment is under review.');
assert.doesNotMatch(html, /onclick="loadLaborFromSheet\(\)"/,
  'The Labor Law retry button must not call the retired Google Sheet loader.');

const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
  .filter((match) => !/\ssrc=/.test(match[0]) && !/type="application\/ld\+json"/i.test(match[0]))
  .map((match) => match[1]);
for (const [index, source] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));
}

console.log('Onboarding and session-flow static tests passed.');
