import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [workspaceSource, workspaceCss, featureLoader, index, serviceWorker] = await Promise.all([
  read('assets/study-workspace.js'),
  read('assets/study-workspace.css'),
  read('assets/feature-loader.js'),
  read('index.html'),
  read('service-worker.js'),
]);

function loadSaveHarness({ online = true, failLocalWrite = false, request } = {}) {
  const storedItems = [];
  const status = {
    textContent: '',
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
  const note = { value: 'A private offline note' };
  const saveButton = {
    disabled: false,
    textContent: 'Save for offline',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
  const studyDialog = {
    querySelector(selector) {
      if (selector === '[data-study-save]') return saveButton;
      return null;
    },
  };
  const document = {
    readyState: 'loading',
    body: { append() {} },
    addEventListener() {},
    getElementById(id) {
      if (id === 'dd-study-notes-dialog') return studyDialog;
      if (id === 'dd-study-sync') return status;
      if (id === 'dd-study-note') return note;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const requests = [];
  const phase4Request = async (path, options) => {
    requests.push({ path, options });
    if (request) return request(path, options, requests.length);
    return { data: { revision: requests.length, updatedAt: '2026-08-27T00:00:00.000Z' } };
  };
  const context = {
    Blob,
    CSS: { escape: (value) => String(value) },
    Date,
    URL,
    console,
    document,
    location: { hash: '', protocol: 'http:' },
    navigator: { onLine: online },
    DueDiligencePhase4: {
      getSession: () => ({ user: { id: 'user-1' } }),
      request: phase4Request,
    },
    __testPutItem: async (item) => {
      if (failLocalWrite) throw new Error('quota-blocked');
      storedItems.push(JSON.parse(JSON.stringify(item)));
    },
  };
  context.window = context;
  let executable = workspaceSource
    .replace('  async function putItem(item) {', '  async function originalPutItem(item) {')
    .replace(
      '  async function allForOwner(ownerUserId) {',
      '  async function putItem(item) { return global.__testPutItem(item); }\n\n  async function allForOwner(ownerUserId) {',
    )
    .replace(
      'global.DueDiligenceStudyWorkspace = Object.freeze({ discover, openNotes, purgeOwner });',
      'global.DueDiligenceStudyWorkspace = Object.freeze({ discover, openNotes, purgeOwner, __saveNotes: saveNotes, __setActiveItem(value) { activeItem = value; } });',
    );
  assert.notEqual(executable, workspaceSource, 'runtime test hooks must be installed');
  vm.runInNewContext(executable, vm.createContext(context), { filename: 'study-workspace.js' });
  const workspace = context.DueDiligenceStudyWorkspace;
  workspace.__setActiveItem({
    type: 'syllabus_review',
    id: 'question-1',
    title: 'Syllabus review item',
    text: 'Question and revealed review text',
    sources: [],
  });
  return { workspace, storedItems, requests, status, note, saveButton };
}

test('Save for offline shows local progress, browser location, sync progress, and durable success', async () => {
  let releaseSync;
  let announceSync;
  const syncStarted = new Promise((resolve) => { announceSync = resolve; });
  const harness = loadSaveHarness({
    request: (_path, _options, requestNumber) => {
      if (requestNumber > 1) return { data: { revision: 9, updatedAt: '2026-08-27T00:01:00.000Z' } };
      announceSync();
      return new Promise((resolve) => { releaseSync = resolve; });
    },
  });
  const stored = { revision: 7, selectedText: '', noteText: '' };
  const saving = harness.workspace.__saveNotes(stored);

  assert.equal(harness.status.textContent, 'Saving the offline copy in this browser…');
  assert.equal(harness.status.dataset.state, 'working');
  assert.equal(harness.saveButton.disabled, true);
  assert.equal(harness.saveButton.attributes['aria-busy'], 'true');

  await syncStarted;
  assert.match(harness.status.textContent, /Saved in this browser on this device · Syncing/);
  assert.equal(harness.storedItems[0].savedOffline, true);
  assert.equal(harness.storedItems[0].dirty, true);
  assert.equal(harness.requests[0].options.body.expectedRevision, 7);

  releaseSync({ data: { revision: 8, updatedAt: '2026-08-27T00:00:30.000Z' } });
  await saving;
  assert.equal(harness.status.textContent, 'Saved in this browser on this device · Synced to Due Diligence.');
  assert.equal(harness.status.dataset.state, 'success');
  assert.equal(harness.saveButton.disabled, false);
  assert.equal(harness.saveButton.attributes['aria-busy'], 'false');
  assert.equal(harness.saveButton.textContent, 'Save changes offline');
  assert.equal(stored.revision, 8);
  assert.equal(stored.dirty, false);

  harness.note.value = 'A second saved note';
  await harness.workspace.__saveNotes(stored);
  assert.equal(harness.requests[1].options.body.expectedRevision, 8, 'a later save must retain the latest synced revision');
  assert.equal(stored.revision, 9);
});

test('offline success says the copy is saved on this device and queues sync', async () => {
  const harness = loadSaveHarness({ online: false });
  const stored = { revision: 0, selectedText: '', noteText: '' };
  await harness.workspace.__saveNotes(stored);

  assert.equal(harness.requests.length, 0);
  assert.equal(harness.storedItems.length, 1);
  assert.equal(harness.status.dataset.state, 'success');
  assert.match(harness.status.textContent, /Saved in this browser on this device/);
  assert.match(harness.status.textContent, /sync when you are online/);
  assert.equal(harness.saveButton.textContent, 'Save changes offline');
});

test('blocked browser storage becomes a visible actionable error and never claims success', async () => {
  const harness = loadSaveHarness({ failLocalWrite: true });
  const stored = { revision: 0, selectedText: '', noteText: '' };
  await assert.doesNotReject(() => harness.workspace.__saveNotes(stored));

  assert.equal(harness.requests.length, 0);
  assert.equal(harness.storedItems.length, 0);
  assert.equal(harness.status.dataset.state, 'error');
  assert.equal(harness.status.attributes.role, 'alert');
  assert.equal(harness.status.attributes['aria-live'], 'assertive');
  assert.match(harness.status.textContent, /Could not save in this browser/);
  assert.match(harness.status.textContent, /allow site storage or free browser space/);
  assert.equal(harness.saveButton.disabled, false);
  assert.equal(harness.saveButton.textContent, 'Try Save for offline again');
  assert.equal(stored.savedOffline, undefined);
});

test('online sync failure remains truthful that the device copy succeeded', async () => {
  const harness = loadSaveHarness({ request: async () => { throw new Error('network-down'); } });
  const stored = { revision: 2, selectedText: '', noteText: '' };
  await harness.workspace.__saveNotes(stored);

  assert.equal(harness.storedItems.length, 1);
  assert.equal(harness.status.dataset.state, 'warning');
  assert.match(harness.status.textContent, /Saved in this browser on this device/);
  assert.match(harness.status.textContent, /sync failed and will retry automatically/);
  assert.equal(stored.savedOffline, true);
  assert.equal(stored.dirty, true);
});

test('dialog and cache references explain the storage location and deliver the new feedback UI', () => {
  assert.match(workspaceSource, /Where it goes:[\s\S]*private browser storage on this device, not Downloads/);
  assert.match(workspaceSource, /Reopen this same study item[\s\S]*Available offline · Study notes/);
  assert.match(workspaceSource, /try\s*\{[\s\S]*getItem\(activeItem\.type, activeItem\.id\)[\s\S]*catch\s*\{[\s\S]*deviceStorageUnavailable = true/);
  assert.match(workspaceSource, /Browser storage is unavailable\. Allow site storage or free browser space/);
  for (const state of ['working', 'success', 'warning', 'error']) {
    assert.match(workspaceCss, new RegExp(`dd-study-sync\\[data-state="${state}"\\]`));
  }
  assert.match(featureLoader, /study-workspace\.js\?v=syllabus-reveal-p0-20260826-2&feedback=offline-save-20260827-1/);
  assert.match(featureLoader, /study-workspace\.css[^'\n]*feedback=offline-save-20260827-1/);
  assert.match(index, /feature-loader\.js\?v=syllabus-reveal-p0-20260826-2&feedback=offline-save-20260827-1/);
  assert.match(serviceWorker, /duediligence-shell-20260827-public-reliability-2-examination-room-production-1/);
  assert.match(serviceWorker, /study-workspace\.css[^'\n]*feedback=offline-save-20260827-1/);
});
