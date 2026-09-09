import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/debate-room.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../debate-room/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function closeLiveTools()');
const end = source.indexOf('function openDialog(', start);
assert.ok(start > 0 && end > start);

function toolsHarness(event = { awaitingAdmission: false }) {
  const panels = ['conversation', 'evidence', 'stages', 'rooms'].map(name => ({ dataset: { toolPanel: name }, hidden: true }));
  const buttons = panels.map(panel => ({ dataset: { liveTool: panel.dataset.toolPanel }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
  const dialog = { open: false, opens: 0, closes: 0, showModal() { this.open = true; this.opens++; }, close() { this.open = false; this.closes++; } };
  const title = { textContent: '' }, state = { event };
  const document = { querySelectorAll(selector) {
    if (selector === '[data-live-tool]') return buttons;
    if (selector === '[data-tool-panel]') return panels;
    assert.fail('Unexpected selector: ' + selector);
  } };
  const context = vm.createContext({ document, state, $: id => ({ 'live-tools-dialog': dialog, 'live-tools-title': title })[id] });
  vm.runInContext(source.slice(start, end) + '; globalThis.controls = { openLiveTool, closeLiveTools };', context);
  return { ...context.controls, dialog, panels, buttons, title, state };
}

test('room tools use the actual native dialog and expose only the selected panel', () => {
  const h = toolsHarness();
  for (const name of ['conversation', 'evidence', 'stages', 'rooms']) {
    h.openLiveTool(name);
    assert.equal(h.dialog.open, true);
    assert.deepEqual(h.panels.filter(panel => !panel.hidden).map(panel => panel.dataset.toolPanel), [name]);
    assert.deepEqual(h.buttons.filter(button => button.attributes['aria-expanded'] === 'true').map(button => button.dataset.liveTool), [name]);
  }
  assert.equal(h.dialog.opens, 1, 'Switching tools does not remount or reopen the native dialog');
});

test('closing a tool closes its existing dialog and clears expanded navigation state', () => {
  const h = toolsHarness();
  h.openLiveTool('conversation'); h.closeLiveTools();
  assert.equal(h.dialog.open, false);
  assert.equal(h.dialog.closes, 1);
  assert.ok(h.buttons.every(button => button.attributes['aria-expanded'] === 'false'));
  h.openLiveTool('evidence');
  assert.doesNotMatch(source.slice(start, end), /replaceChildren|innerHTML|\.reset\(|media\./, 'Layout controls may not reset forms or remount media');
});

test('a waiting participant, signed-out view or unknown tool cannot open private room panels', () => {
  for (const event of [null, { awaitingAdmission: true }]) {
    const h = toolsHarness(event); h.openLiveTool('conversation');
    assert.equal(h.dialog.opens, 0);
    assert.ok(h.panels.every(panel => panel.hidden));
  }
  const h = toolsHarness(); h.openLiveTool('unknown');
  assert.equal(h.dialog.opens, 0);
});

test('account or role changes and ordinary action dialogs close the supporting tool first', () => {
  assert.match(source, /const clearSensitiveViews = \(\) => \{closeLiveTools\(\);state\.viewGeneration\+\+/);
  assert.match(source, /function openDialog\([^\n]+\{\r?\n  closeLiveTools\(\);/);
  assert.match(source, /if\(state\.panel!=='live'\)closeLiveTools\(\);/);
  assert.match(source, /\$\('live-tools-dialog'\)\.addEventListener\('close',closeLiveTools\)/);
});

test('each retained form, tile bench, timer and media control has one stable DOM identity', () => {
  const ids = ['channel', 'message-form', 'messages', 'evidence-form', 'evidence-list', 'run-of-show', 'private-space-controls', 'request-help',
    'judge-tiles', 'affirmative-tiles', 'negative-tiles', 'observer-tiles', 'clock', 'stage-controls', 'presentation',
    'join-media', 'mic', 'camera', 'share', 'devices', 'audio', 'leave-media'];
  for (const id of ids) assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, id);
  const dialog = html.slice(html.indexOf('<dialog id="live-tools-dialog"'), html.indexOf('<dialog id="dialog"'));
  assert.match(dialog, /id="message-form"/);
  assert.match(dialog, /id="evidence-form"/);
  assert.match(dialog, /id="run-of-show"/);
  assert.doesNotMatch(dialog, /id="(?:arena|clock|stage-controls|presentation|judge-tiles|affirmative-tiles|negative-tiles|observer-tiles)"/);
});
