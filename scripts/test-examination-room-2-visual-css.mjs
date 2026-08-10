import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../assets/duediligence-2026.css', import.meta.url), 'utf8');

assert.match(css, /#dd26-exam-main\{max-width:1200px;margin-inline:auto;outline:0;\}/,
  'the classroom workspace should stay at a readable professional width');
assert.match(css, /\.dd26-form-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*column-gap:24px[^}]*row-gap:22px/,
  'desktop form columns need deliberate, even spacing');
assert.match(css, /\.dd26-form-grid>\.dd26-field>span\{[^}]*min-height:31px[^}]*align-items:flex-end/,
  'paired controls need a shared label zone so their top edges align');
assert.match(css, /\.dd26-textarea,\.dd26-input,\.dd26-select\{[^}]*min-height:52px/,
  'all form controls need a consistent minimum height');
assert.match(css, /\.dd26-textarea:focus-visible,\.dd26-input:focus-visible,\.dd26-select:focus-visible/,
  'keyboard focus must be visible on every form control');
assert.match(css, /\[aria-invalid="true"\][^}]*:user-invalid/,
  'server and browser validation states both need visible error styling');
assert.match(css, /\.dd26-button:disabled,\.dd26-button\[aria-disabled="true"\]\{[^}]*cursor:not-allowed/,
  'blocked actions need an unmistakable disabled state');
assert.match(css, /\.dd26-stepper:has\(>button\)\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\);\}/,
  'the five-control preview must not leave one authoring step stranded on a new row');
assert.match(css, /\.dd26-rules-summary dl div,\.dd26-publish-summary div,\.dd26-receipt dl div\{[^}]*grid-template-columns:minmax\(180px,\.32fr\) minmax\(0,1fr\)/,
  'review summaries need a stable label column');

for (const contract of [
  '.dd26-flow-list',
  '.dd26-flow-step',
  '.dd26-flow-step.is-complete',
  '.dd26-flow-step.is-current',
  '.dd26-flow-step.is-blocked',
  '.dd26-inline-error',
  '.dd26-step-error',
  '.dd26-field-error',
]) {
  assert.ok(css.includes(contract), `missing Professor flow style: ${contract}`);
}

const mobile = css.slice(css.indexOf('@media (max-width:680px)'));
assert.match(mobile, /\.dd26-form-grid\{grid-template-columns:1fr/,
  'forms must reflow to one column on a phone');
assert.match(mobile, /\.dd26-actions>\.dd26-button\{width:100%;\}/,
  'phone actions must become easy-to-tap full-width controls');
assert.match(mobile, /\.dd26-rules-summary dl div,\.dd26-publish-summary div,\.dd26-receipt dl div\{grid-template-columns:1fr/,
  'review summaries must reflow instead of squeezing values');

assert.equal((css.match(/\.dd26-textarea\.compact\{/g) || []).length, 1,
  'compact textareas should have one authoritative size rule');

console.log('Examination Room visual CSS contracts passed.');
