import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  html,
  /<button class="tabbtn" id="tab-history">Analytics<\/button>/,
  'Bar Question Practice should expose the existing analytics dashboard with the current product name.',
);
assert.doesNotMatch(
  html,
  /id="tab-write"|Answer\s*&(?:amp;)?\s*Review/i,
  'The redundant Answer & Review sub-navigation control should not be rendered.',
);
assert.match(
  html,
  /<div class="index-tabs" id="subject-tabs" hidden aria-hidden="true"><\/div>/,
  'The duplicate subject rail should remain unavailable visually and to assistive technology.',
);
assert.match(
  html,
  /\.index-tabs\[hidden\]\{display:none!important;\}/,
  'Responsive CSS must not override the hidden subject rail.',
);
assert.doesNotMatch(
  html,
  /class="btn-tool mic"|Voice-to-Text Essay Dictation|>Dictate|startDictation\(|SpeechRecognition/,
  'The non-functional dictation control and its dead implementation should be removed.',
);
assert.match(
  html,
  /document\.getElementById\("tab-history"\)\?\.addEventListener\("click", \(\) => \{\s*openAnalytics\(\);\s*\}\);/,
  'The workspace Analytics control should open the established analytics dashboard.',
);
assert.match(
  html,
  /onclick="changeMockBarSubject\(\)"/,
  'Change Subject must remain available after removing the duplicate subject rail.',
);
assert.match(
  html,
  /id="submit-btn" onclick="evaluateAnswer\(\)"/,
  'Essay submission must remain wired to the existing grading flow.',
);
assert.doesNotMatch(
  html,
  />The Verdict<|Close The Verdict|The Verdict is temporarily unavailable/,
  'Visible legacy Verdict naming should be replaced with Analytics in the frontend shell.',
);

console.log('Bar Question Practice UI contract tests passed.');
