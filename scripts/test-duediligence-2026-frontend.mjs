import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name}() to exist in the production source.`);
  const start = match.index;
  const parameterStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  assert.ok(parameterEnd > parameterStart, `Could not extract the ${name}() parameters.`);
  const openingBrace = source.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not extract the complete ${name}() function body.`);
}

const root = new URL('../', import.meta.url);
const [html, js, css, build, examinations, featureLoader, publicLanding] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
  readFile(new URL('assets/examinations.js', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
]);

assert.doesNotMatch(html, /<link[^>]+assets\/duediligence-2026\.css/);
assert.doesNotMatch(html, /<script[^>]+assets\/duediligence-2026\.js/);
assert.match(html, /assets\/feature-loader\.js\?v=syllabus-reveal-p0-20260826-2/);
assert.match(featureLoader, /assets\/duediligence-2026\.css\?v=guided-random-access-20260822-1/);
assert.match(featureLoader, /assets\/duediligence-2026\.js\?v=content-runtime-20260826-1/);
assert.match(build, /assets\/duediligence-2026\.css/);
assert.match(build, /assets\/duediligence-2026\.js/);

// Capped Simulator assessments keep the authoritative final score and omit the
// provider's pre-cap component display, which can contradict that final score.
const assessmentScoreWasCapped = vm.runInNewContext(
  `(${extractNamedFunction(examinations, 'assessmentScoreWasCapped')})`,
);
assert.equal(assessmentScoreWasCapped({
  score: 2.5,
  appliedScoreCeiling: { code: 'rule_without_application', maximum: 2.5, changedScore: true },
  rubricBreakdown: { conclusion: 5, legalBasis: 5, application: 5, responsiveness: 5 },
}), true);
assert.equal(assessmentScoreWasCapped({
  score: 3.5,
  scoreCeilingCode: 'major_central_gap',
}), true, 'Stored semantic score ceilings must hide the component breakdown.');
assert.equal(assessmentScoreWasCapped({
  score: 2.5,
  errors: ['Score capped because the answer lacks meaningful factual application.'],
}), true, 'Legacy capped assessments must be recognized from its persisted cap note.');
assert.equal(assessmentScoreWasCapped({
  score: 4.6,
  scoreCeilingCode: 'none',
  appliedScoreCeiling: null,
  errors: [],
}), false, 'Uncapped assessments must retain their explanatory component breakdown.');
assert.match(
  examinations,
  /assessmentScoreWasCapped\(assessment\) \? '' : assessmentBreakdown\(assessment\.rubricBreakdown, \{ track \}\)/,
  'Capped assessments must not render a contradictory point-by-point comparison.',
);

for (const [id, feature, handler] of [
  ['spa-bar-easy', 'bar-easy', 'openBarEasy'],
  ['spa-chairs-case', 'chair-cases', 'openChairCases'],
  ['spa-jurisprudence', 'doctrines', 'openDoctrines'],
  ['spa-case-digest', 'anchor-cases', 'openAnchorCases'],
]) {
  assert.match(html, new RegExp(`id="${id}"[^>]*data-public-feature="${feature}"`));
  assert.match(publicLanding, new RegExp(`feature === '${feature}'[\\s\\S]*?global\\.${handler}\\?\\.\\(\\)`));
  assert.match(js, new RegExp(`global\\.${handler} =`));
}

for (const route of ['bar-easy', 'chairs-cases', 'doctrines', 'anchor-case-digests']) {
  assert.match(js, new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
}

assert.match(js, /maxlength="5000"/);
assert.match(js, /maxlength="3000"/);
assert.match(js, /Your answer text and coaching explanation are not saved/);
assert.match(js, /Your answer text is not saved\. Only your thumbs-up or thumbs-down mastery result is recorded/);
assert.doesNotMatch(js, /localStorage[^\n]*(?:answerText|studentAnswer)|(?:answerText|studentAnswer)[^\n]*localStorage/,
  'Study answers must not be copied into localStorage by the public 2026 experience.');
assert.doesNotMatch(js, /sessionStorage/);
assert.match(js, /snapshot\?\.flags\?\.\[flag\] !== true/);
assert.match(js, /AI-assisted educational content/);
assert.match(js, /Source-based coaching/);
assert.doesNotMatch(js, /AI-prepared beta|Gemini coaching|Gemini explanation/);

assert.match(js, /openVerdictExport/);
assert.match(js, /selectionKind/);
assert.match(js, /selectedIds/);
assert.match(html, /openVerdictExport/);
assert.match(css, /#031a33/);
assert.match(css, /#c5a059/i);
assert.match(css, /'Playfair Display'/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(css, /animation-duration:\.01ms!important/);

console.log('DueDiligence 2026 frontend contracts passed.');
