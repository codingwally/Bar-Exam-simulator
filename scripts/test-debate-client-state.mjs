/**
 * Behavioral tests of the actual browser client, with no network or devices.
 * Evaluate the real source up to startup wiring. Only unrelated rendering and
 * discovery dependencies are replaced; request/adopt/history/cleanup/tile code
 * executes unchanged. The small DOM below implements only operations exercised
 * here. This is state-isolation evidence, not a browser or media-provider test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as domain from '../worker/debate-domain.mjs';
import { eventInstant, eventLocalInput } from '../assets/debate-dates.js';

const filename = new URL('../assets/debate-room.js', import.meta.url);
const source = await readFile(filename, 'utf8');
const startup = source.indexOf("\ndocument.addEventListener('click'");
assert.ok(startup > 0, 'The client startup boundary must be recognizable before evaluating source');
const declarations = source.slice(0, startup).replace(/^import .+;\r?\n/gm, '');
const evidenceStart = source.indexOf('\nasync function submitEvidence(form)');
const evidenceEnd = source.indexOf("\n$('evidence-form').onsubmit", evidenceStart);
assert.ok(evidenceStart > startup && evidenceEnd > evidenceStart, 'Extract the real upload helper without running startup listeners');
const evidenceDeclaration = source.slice(evidenceStart, evidenceEnd);
const matchChangeWiring = source.match(/^\$\('active-match'\)\.onchange=.*$/m)?.[0];
assert.ok(matchChangeWiring, 'Exercise the actual active-match selection handler');
const lobbyWiring = source.match(/^\$\('back-lobby'\)\.onclick=.*$/m)?.[0];
assert.ok(lobbyWiring, 'Exercise the actual return-to-lobby handler');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = {}; this.className = ''; this.hidden = false;
    this.value = ''; this.open = false; this.removeCalls = 0; this.closed = 0; this._text = '';
    this.classList = { toggle: (name, force) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const present = force ?? !classes.has(name);
      if (present) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' '); return present;
    } };
  }
  detach() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  append(...nodes) { for (const node of nodes) { node.detach(); this.children.push(node); node.parentElement = this; } }
  prepend(node) { node.detach(); this.children.unshift(node); node.parentElement = this; }
  remove() { this.removeCalls++; this.detach(); }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.detach(); this._text = ''; this.append(...nodes); if (this.id === 'active-match' && !nodes.length) this.value = ''; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(html) {
    this.replaceChildren();
    this._html = html;
    if (!html) return;
    // Retain emitted HTML for these read-only rendering assertions; no event handlers are synthesized.
    if (['schedule-content','rules-content','stage-controls','private-space-controls','evidence-list','run-of-show'].includes(this.id)) return;
    if (this.id === 'active-match') { for (const option of html.matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)) { const node = new Element('option'); node.value = option[1]; node.textContent = option[2]; this.append(node); } return; }
    // The only parsed template needed is ensureTile's camera-off fallback.
    if (html.startsWith('<span class="initials"')) {
      const initials = new Element('span'); initials.className = 'initials';
      const caption = new Element('div'); caption.className = 'caption';
      const label = new Element('span'), camera = new Element('small'); camera.textContent = 'Camera off';
      caption.append(label, camera); this.append(initials, caption);
    } else throw new Error('Unexpected HTML rendering in state-isolation harness');
  }
  get innerHTML() { return this._html || ''; }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  matches(selector) { if (selector === '*') return true; if (selector === '[type=submit]') return this.type === 'submit'; return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tagName === selector.toUpperCase(); }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/), descendants = [];
    const visit = node => { for (const child of node.children) { descendants.push(child); visit(child); } }; visit(this);
    return descendants.filter(node => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (ancestor && !ancestor.matches(parts[i])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  close() { this.open = false; this.closed++; }
  reset() { this.resetCalls = (this.resetCalls || 0) + 1; for (const field of this.querySelectorAll('*')) { field.value = field.defaultValue || ''; if (field.type === 'file') field.files = []; } }
}

function harness() {
  const elements = new Map(), timers = new Map(), clearedTimers = new Set(), fetches = [];
  const counters = { live: 0, panel: 0, messages: 0, discovery: 0 };
  let timerSequence = 0;
  const document = {
    activeElement: null,
    getElementById(id) { if (!elements.has(id)) { const element = new Element(); element.id = id; elements.set(id, element); } return elements.get(id); },
    createElement(tagName) { return new Element(tagName); },
    querySelectorAll(selector) { if (selector === '#event-tabs button') return []; throw new Error(`Unexpected document selector ${selector}`); },
  };
  class MediaBoundary {
    constructor() { this.videos = new Map(); this.audioTracks = new Map(); this.credential = null; this.joined = false; this.leaveCalls = 0; }
    async leave() { this.leaveCalls++; this.joined = false; this.credential = null; }
  }
  const context = vm.createContext({
    ...domain, eventInstant, eventLocalInput, DebateMedia: MediaBoundary, document, counters,
    location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:4178', pathname: '/debate-room/', search: '', hash: '' },
    DEBATE_LOCAL_REHEARSAL: true, navigator: { onLine: true },
    crypto: { randomUUID }, performance: { now: () => 1000 }, AbortController, URLSearchParams, URL,
    FormData: class { constructor(form) { this.values = new Map(form.querySelectorAll('*').filter(field => field.name).map(field => [field.name, field.type === 'file' ? field.files?.[0] : field.value])); } get(name) { return this.values.get(name) ?? null; } },
    history: { replaced: [], replaceState(...args) { this.replaced.push(args); } },
    setTimeout(callback, milliseconds) { const timer = ++timerSequence; timers.set(timer, { callback, milliseconds }); return timer; },
    clearTimeout(timer) { clearedTimers.add(timer); timers.delete(timer); },
    fetch(url, options) { return new Promise((resolve, reject) => { const call = { url, options, respond(body, status = 200) { resolve({ ok: status >= 200 && status < 300, status, json: async () => body }); } }; fetches.push(call); options.signal?.addEventListener('abort', () => { call.aborted = true; const error = new Error('Upload aborted'); error.name = 'AbortError'; reject(error); }, { once: true }); }); },
  });
  vm.runInContext(`${declarations}\n${evidenceDeclaration}\n
    const actualRenderLive = renderLive;
    renderLive = () => { counters.live++; };
    renderPanel = () => { counters.panel++; };
    renderMessages = () => { counters.messages++; };
    loadEvents = async () => { counters.discovery++; };
    globalThis.client = {state, media, request, refresh, command, retryPending, adopt,
      loadHistory, ensureTile, clearSensitiveViews, discardEventView, messageHistoryKey, signOutCleanup, submitEvidence,
      currentMatch, usableMatches, actualRenderLive, renderSchedule, renderRules, actions, leaveCurrentMedia, openEvent};
    ${matchChangeWiring}
    ${lobbyWiring}
  `, context, { filename: filename.pathname });
  return { ...context.client, document, elements, timers, clearedTimers, fetches, counters, context,
    timer(callback = () => {}) { return context.setTimeout(callback, 650); },
    element(id) { return document.getElementById(id); },
  };
}

function eventFixture(id = 'event-one') {
  return {
    id, revision: 10, myId: 'judge-one', ownerId: 'host', title: 'Local client regression',
    language: 'English', timezone: 'Asia/Manila', status: 'active', activeMatchId: `${id}-match`,
    teams: [], motions: [], members: [{ id: 'judge-one', displayName: 'Judge One', admitted: true, checkedIn: true, roles: ['judge'], teamId: null }],
    matches: [{ id: `${id}-match`, judgeIds: ['judge-one'], hostIds: ['host'],
      seats: { A1: 'alice', A2: 'ben', A3: 'cara', N1: 'dan', N2: 'eve', N3: 'fay' },
      closingSeats: { affirmative: 'A1', negative: 'N1' }, captains: { affirmative: 'alice', negative: 'dan' },
      ruleVersion: 1, messages: [] }],
  };
}
function openFixture(h, event = eventFixture()) {
  h.state.session = { access_token: 'synthetic-in-memory-token', user: { id: 'judge-one' } };
  h.state.client = { auth: { existingSession: true } };
  h.state.event = event; h.state.matchId = event.activeMatchId; h.element('channel').value = 'main';
  return event;
}
function addSecret(h, id, text = 'PRIVATE_OLD_PERSON_SCORE') {
  const node = new Element('input'); node.textContent = text; h.element(id).append(node); return node;
}
const viewChanged = error => error.code === 'VIEW_CHANGED' && error.status === 409;

const expiredMatch = id => ({ id, title: 'Archived match', phase: 'expired', officialRecordsExpired: true });
function privateLiveView(h) {
  const ids = ['live-motion', 'stage-controls', 'active-match', 'stage-label', 'speaker-label', 'run-of-show', 'private-space-controls', 'affirmative-name', 'negative-name', 'next-stage', 'presentation', 'stage-announcement'];
  for (const id of ids) addSecret(h, id, `PRIVATE_OLD_${id}`);
  h.element('stage-controls').dataset.renderKey = 'old-privileged-controls';
  const tile = h.ensureTile('A1', 'Private Former Speaker', h.element('stage'), 'old-private-track', 'A1');
  return { ids, tile };
}
function assertPrivateLiveCleared(h, { ids, tile }) {
  for (const id of ids) assert.equal(h.element(id).textContent.includes('PRIVATE_OLD_'), false, `${id} cannot retain private data`);
  assert.equal(tile.parentElement, null); assert.equal(h.state.tiles.size, 0); assert.equal(h.element('stage-controls').dataset.renderKey, undefined);
}

test('expired record tombstones cannot become the selected match or be offered by the live dropdown', () => {
  const h = harness(), event = openFixture(h), expired = expiredMatch('expired-match');
  event.matches.unshift(expired); event.activeMatchId = expired.id; h.state.matchId = expired.id;
  assert.equal(h.currentMatch().id, 'event-one-match'); assert.deepEqual(Array.from(h.usableMatches(), match => match.id), ['event-one-match']);
  h.actualRenderLive();
  assert.deepEqual(h.element('active-match').options.map(option => option.value), ['event-one-match']);
  event.matches = [expired]; assert.equal(h.currentMatch(), undefined);
});

test('expiry of the selected match discards private DOM, forms, history and stale media context', () => {
  const h = harness(), event = openFixture(h), live = privateLiveView(h), { fields } = privateDrafts(h);
  h.state.messageHistory.set('old-private-channel', [{ text: 'PRIVATE_OLD_CHAT' }]); h.state.judgeDirty = true;
  h.state.draftTimer = h.timer(); const draftTimer = h.state.draftTimer;
  h.media.credential = { identity: 'old-private-track' }; h.media.joined = true;
  const expired = structuredClone(event); expired.revision++; expired.matches = [expiredMatch(event.activeMatchId)];
  h.adopt(expired); assertPrivateLiveCleared(h, live); assertDraftsCleared(fields);
  assert.equal(h.currentMatch(), undefined); assert.equal(h.state.matchId, null); assert.equal(h.state.messageHistory.size, 0);
  assert.equal(h.state.judgeDirty, false); assert.equal(h.timers.has(draftTimer), false); assert.equal(h.media.leaveCalls, 1);
  h.actualRenderLive(); assert.equal(h.element('live-motion').textContent, 'No active match record is available.');
  assert.equal(h.fetches.length, 0, 'Expired records cannot issue a stale server action');
});

test('returning to waiting admission clears the previous live room and unsent private content', () => {
  const h = harness(), event = openFixture(h), live = privateLiveView(h), { fields } = privateDrafts(h);
  h.state.panel = 'live'; h.state.messageHistory.set('old-room', [{ text: 'PRIVATE_OLD_CHAT' }]); h.media.joined = true;
  const waiting = structuredClone(event); waiting.revision++; waiting.awaitingAdmission = true; waiting.matches = []; waiting.motions = []; waiting.members[0].admitted = false;
  h.adopt(waiting); assertPrivateLiveCleared(h, live); assertDraftsCleared(fields);
  assert.equal(h.state.panel, 'overview'); assert.equal(h.state.messageHistory.size, 0); assert.equal(h.media.joined, false); assert.equal(h.currentMatch(), undefined);
});

test('expired schedule entries render a retention notice without an open action or invented historical rules', () => {
  const h = harness(), event = openFixture(h); event.matches = [expiredMatch(event.activeMatchId)];
  h.renderSchedule(); assert.match(h.element('schedule-content').innerHTML, /Official records expired under the approved retention policy/);
  assert.doesNotMatch(h.element('schedule-content').innerHTML, /data-action="(?:select-match|advance-match)"/);
  h.renderRules(); assert.doesNotMatch(h.element('rules-content').innerHTML, /Accept these rules and sides|Download rules PDF|Official decision:/);
});

test('sign-out removes the prior live motion and controls in addition to private forms', async () => {
  const h = harness(); openFixture(h); const live = privateLiveView(h); await h.signOutCleanup(); assertPrivateLiveCleared(h, live);
});

for (const transition of ['leave', 'select', 'open-event', 'lobby']) {
  test(`a delayed media ${transition} cannot leave or navigate in a newly opened event`, async () => {
    const h = harness(), oldEvent = openFixture(h); oldEvent.matches[0].myMedia = { identity: 'old-private-media' };
    let completeLeave;
    h.media.leave = () => new Promise(resolve => { completeLeave = resolve; });
    const operation = transition === 'leave' ? h.leaveCurrentMedia() : transition === 'select' ? h.actions['select-match']({ dataset: { match: 'old-second-match' } }) : transition === 'open-event' ? h.openEvent('old-target-event') : h.element('back-lobby').onclick();
    h.discardEventView(); const newEvent = openFixture(h, eventFixture('new-event'));
    const newPrivateView = addSecret(h, 'live-motion', 'NEW_EVENT_MOTION'), newGeneration = h.state.viewGeneration;
    completeLeave(); await operation;
    assert.equal(h.fetches.length, 0, 'The prior media cleanup cannot send leave_media against the new event');
    assert.equal(h.state.event.id, newEvent.id); assert.equal(h.state.matchId, newEvent.activeMatchId);
    assert.equal(h.state.viewGeneration, newGeneration); assert.equal(newPrivateView.parentElement, h.element('live-motion'));
  });
}

test('changing the active-match selector preserves the chosen ID across asynchronous media and DOM cleanup', async () => {
  const h = harness(), event = openFixture(h);
  event.matches.push({ ...event.matches[0], id: 'second-match' });
  const selector = h.element('active-match'); selector.value = 'second-match';
  await selector.onchange();
  assert.equal(h.state.matchId, 'second-match'); assert.equal(h.currentMatch().id, 'second-match');
  assert.equal(h.context.history.replaced.at(-1)[2], '/debate-room/#event=event-one&match=second-match');
});

function privateDrafts(h) {
  const fields = {};
  for (const [formId, names] of [['message-form', ['text']], ['evidence-form', ['title', 'sourceUrl', 'description', 'ruling', 'file', 'channel']]]) {
    const form = h.element(formId);
    for (const name of names) {
      const field = new Element('input'); field.name = name; field.type = name === 'file' ? 'file' : 'text';
      field.defaultValue = name === 'channel' ? 'public' : ''; field.value = name === 'channel' ? 'team' : `PRIVATE_${name}`;
      if (name === 'file') field.files = [{ name: 'private.pdf', size: 64, type: 'application/pdf' }];
      fields[name] = field; form.append(field);
    }
    const submit = new Element('button'); submit.type = 'submit'; form.append(submit);
  }
  return { fields, form: h.element('evidence-form'), submit: h.element('evidence-form').querySelector('[type=submit]') };
}
function assertDraftsCleared(fields) {
  for (const [name, field] of Object.entries(fields)) assert.equal(field.value, name === 'channel' ? 'public' : '', `${name} draft must be reset`);
  assert.deepEqual(fields.file.files, [], 'The prior account file selection must be released');
}
async function untilFetch(h, count) { for (let i = 0; i < 30 && h.fetches.length < count; i++) await Promise.resolve(); assert.equal(h.fetches.length, count); }

for (const cleanup of ['discardEventView', 'signOutCleanup']) {
  test(`${cleanup} clears unsent private messages, evidence metadata, audience and file selections`, async () => {
    const h = harness(); openFixture(h); const { fields } = privateDrafts(h);
    await h[cleanup](); assertDraftsCleared(fields);
    assert.equal(h.state.event, null); assert.equal(h.fetches.length, 0, 'Discarding a draft must never publish it');
  });
}

test('an ordinary update preserves private drafts, while reassignment clears them before the new team renders', () => {
  const h = harness(), initial = openFixture(h); const { fields } = privateDrafts(h);
  const tick = structuredClone(initial); tick.revision++; h.adopt(tick);
  assert.equal(fields.text.value, 'PRIVATE_text'); assert.equal(fields.file.files.length, 1);
  const changed = structuredClone(tick); changed.revision++; changed.members[0].teamId = 'other-team'; h.adopt(changed);
  assertDraftsCleared(fields); assert.equal(h.fetches.length, 0);
});

test('two evidence submits upload and attach only once; the guard lasts until the saved receipt', async () => {
  const h = harness(), event = openFixture(h), { form, fields, submit } = privateDrafts(h); fields.channel.value = 'public';
  const operation = h.submitEvidence(form); await h.submitEvidence(form);
  assert.equal(h.fetches.length, 1); assert.equal(submit.disabled, true); assert.equal(h.state.evidenceUploading, true);
  assert.equal(h.fetches[0].options.body, fields.file.files[0]); assert.match(h.fetches[0].url, /channel=public/);
  h.fetches[0].respond({ ok: true, attachment: { uploadId: 'durable-upload-one', storageKey: 'private-key' } });
  await untilFetch(h, 2); await h.submitEvidence(form); assert.equal(h.fetches.length, 2, 'The attachment command is also protected');
  const envelope = JSON.parse(h.fetches[1].options.body); assert.equal(envelope.command, 'share_evidence'); assert.equal(envelope.payload.attachment.uploadId, 'durable-upload-one');
  h.fetches[1].respond({ ok: true, event: { ...event, revision: 11 }, receipt: { result: { saved: true } } }); await operation;
  assert.equal(h.state.evidenceUploading, false); assert.equal(submit.disabled, false); const { text, ...evidenceFields } = fields; assertDraftsCleared(evidenceFields); assert.equal(text.value, 'PRIVATE_text', 'Saving evidence must preserve an unrelated current message draft');
  assert.equal(h.timers.size, 0, 'Upload and command deadlines must be cleared');
});

for (const change of ['account', 'event', 'match', 'authority']) {
  test(`a delayed evidence upload cannot attach after ${change} changes`, async () => {
    const h = harness(), event = openFixture(h), { form, fields, submit } = privateDrafts(h); fields.channel.value = 'public';
    const operation = h.submitEvidence(form), rejection = assert.rejects(operation, /account or match changed/);
    if (change === 'account') { await h.signOutCleanup(); openFixture(h); }
    if (change === 'event') { h.discardEventView(); openFixture(h, eventFixture('event-two')); }
    if (change === 'match') { h.clearSensitiveViews(); h.state.event.matches.push({ ...event.matches[0], id: 'match-two' }); h.state.matchId = 'match-two'; }
    if (change === 'authority') { const changed = structuredClone(event); changed.revision++; changed.matches[0].ruleVersion++; h.adopt(changed); }
    h.fetches[0].respond({ ok: true, attachment: { uploadId: 'old-private-upload', storageKey: 'private-key' } }); await rejection;
    assert.equal(h.fetches.length, 1, 'The old upload must never issue share_evidence in the new context');
    assert.equal(h.state.pending, null); assert.equal(h.state.evidenceUploading, false); assert.equal(submit.disabled, false); assertDraftsCleared(fields);
  });
}

test('the evidence deadline aborts a stalled upload and restores a usable form without attaching', async () => {
  const h = harness(); openFixture(h); const { form, fields, submit } = privateDrafts(h); fields.channel.value = 'public';
  const operation = h.submitEvidence(form), rejection = assert.rejects(operation, error => error.name === 'AbortError');
  const [timerId, timer] = [...h.timers.entries()].find(([, entry]) => entry.milliseconds === 18000); timer.callback(); await rejection;
  assert.equal(h.fetches[0].aborted, true); assert.equal(h.fetches.length, 1); assert.equal(h.state.evidenceUploading, false); assert.equal(submit.disabled, false);
  assert.equal(h.timers.has(timerId), false); assert.equal(fields.title.value, 'PRIVATE_title', 'A same-context network failure preserves a retryable draft');
});

test('history accepts the current view and rejects delayed history after leaving it', async () => {
  const h = harness(); openFixture(h);
  const key = h.messageHistoryKey('public');
  const current = h.loadHistory();
  assert.match(h.fetches[0].url, /eventId=event-one&matchId=event-one-match&channel=public/);
  h.fetches[0].respond({ ok: true, messages: [{ id: 'first', channel: 'public', text: 'Current history' }], nextCursor: 'older' });
  await current;
  assert.equal(h.state.messageHistory.get(key)[0].text, 'Current history');
  assert.equal(h.counters.messages, 1);
  const delayed = h.loadHistory();
  const rejected = assert.rejects(delayed, viewChanged);
  assert.match(h.fetches[1].url, /before=first/);
  h.discardEventView(); openFixture(h, eventFixture('event-two'));
  h.fetches[1].respond({ ok: true, messages: [{ id: 'private-old', text: 'Old event secret' }], nextCursor: null });
  await rejected;
  assert.equal(h.state.messageHistory.size, 0);
  assert.equal(h.state.historyDone.size, 0);
  assert.equal(h.counters.messages, 1, 'Old history cannot trigger rendering in the new view');
  assert.equal(h.state.event.id, 'event-two');
});

test('active-event 403 clears private DOM, draft timers and media without signing out', async () => {
  const h = harness(); openFixture(h);
  const session = h.state.session, authClient = h.state.client, generation = h.state.accountGeneration;
  const secretIds = ['judge-content', 'results-content', 'messages', 'evidence-list', 'overview-content', 'participants-content', 'rules-content', 'vote-content', 'schedule-content', 'help-content', 'dialog-fields'];
  const secrets = secretIds.map(id => addSecret(h, id));
  h.element('dialog').open = true;
  h.state.judgeDirty = true; h.state.draftTimer = h.timer();
  const draftTimer = h.state.draftTimer;
  h.state.pending = { eventId: 'event-one', command: 'save_draft' };
  h.state.freshInvite = { secret: 'PRIVATE_INVITE' };
  h.state.messageHistory.set('private-channel', [{ text: 'PRIVATE_CHAT' }]); h.state.historyDone.add('private-channel');
  h.media.joined = true;
  const tile = h.ensureTile('A1', 'Alice', h.element('stage'), 'old-camera', 'A1');
  const refreshing = h.refresh();
  h.fetches[0].respond({ ok: false, error: { code: 'NOT_MEMBER', message: 'Membership removed' } }, 403);
  await refreshing;
  assert.equal(h.state.event, null); assert.equal(h.state.matchId, null);
  assert.equal(h.state.session, session); assert.equal(h.state.client, authClient);
  assert.equal(h.state.accountGeneration, generation, 'Event removal must not log out the global account');
  assert.equal(h.media.leaveCalls, 1); assert.equal(h.media.joined, false);
  assert.equal(h.state.tiles.size, 0); assert.equal(tile.parentElement, null);
  for (const [index, id] of secretIds.entries()) {
    assert.equal(h.element(id).children.length, 0, `${id} must remove private children`);
    assert.equal(secrets[index].parentElement, null);
  }
  assert.equal(h.state.judgeDirty, false); assert.equal(h.state.pending, null); assert.equal(h.state.freshInvite, null);
  assert.equal(h.state.messageHistory.size, 0); assert.equal(h.state.historyDone.size, 0);
  assert.ok(h.clearedTimers.has(draftTimer)); assert.equal(h.timers.has(draftTimer), false);
  assert.equal(h.element('dialog').open, false); assert.equal(h.element('event').hidden, true); assert.equal(h.element('lobby').hidden, false);
  assert.equal(h.counters.discovery, 1);
});

for (const operation of ['command', 'retryPending']) {
  test(`delayed ${operation} receipt cannot readopt its old event after a view change`, async () => {
    const h = harness(); const oldEvent = openFixture(h);
    if (operation === 'retryPending') h.state.pending = { command: 'save_draft', eventId: oldEvent.id, idempotencyKey: 'same-receipt-key' };
    const pending = operation === 'command' ? h.command('save_draft', { matchId: oldEvent.activeMatchId }) : h.retryPending();
    const rejected = assert.rejects(pending, viewChanged);
    assert.equal(h.fetches[0].options.method, 'POST');
    h.discardEventView(); const nextEvent = openFixture(h, eventFixture('event-two'));
    h.fetches[0].respond({ ok: true, event: { ...oldEvent, revision: 999 }, serverNow: 100_000, receipt: { result: { saved: true } } });
    await rejected;
    assert.equal(h.state.event, nextEvent); assert.equal(h.state.matchId, nextEvent.activeMatchId);
    assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
    assert.equal(h.state.sync, null, 'Even the stale response clock must be discarded');
    assert.equal(h.counters.live, 0); assert.equal(h.counters.panel, 0);
  });
}

test('the same media identity preserves the video node; a camera-off replacement removes it', () => {
  const h = harness(); openFixture(h);
  const parent = h.element('stage'), video = new Element('video');
  h.media.videos.set('old-track', { identity: 'alice-epoch-one', source: 'camera', element: video });
  const tile = h.ensureTile('A1', 'Alice Speaker', parent, 'alice-epoch-one', 'A1');
  assert.equal(video.parentElement, tile);
  const afterTick = h.ensureTile('A1', 'Alice Speaker', parent, 'alice-epoch-one', 'A1');
  assert.equal(afterTick, tile); assert.equal(video.parentElement, tile); assert.equal(video.removeCalls, 0);
  assert.equal(tile.querySelectorAll('video').length, 1, 'Routine snapshots must preserve the existing video node');
  const replacement = h.ensureTile('A1', 'Grace Substitute', parent, 'grace-epoch-one', 'A1');
  assert.equal(replacement, tile); assert.equal(video.parentElement, null); assert.equal(video.removeCalls, 1);
  assert.equal(tile.querySelectorAll('video').length, 0, 'The old stream must not be shown under the substitute name');
  assert.equal(tile.querySelector('.caption span').textContent, 'Grace Substitute');
  assert.equal(tile.querySelector('.initials').textContent, 'GS');
  assert.equal(tile.dataset.identity, 'grace-epoch-one');
  assert.ok(h.media.videos.has('old-track'), 'A delayed SDK track removal does not defeat the identity guard');
});

for (const [change, mutate] of [
  ['rule version', match => { match.ruleVersion++; }],
  ['speaker assignment', match => { match.seats.A1 = 'grace'; }],
  ['closing assignment', match => { match.closingSeats.affirmative = 'A2'; }],
  ['captain assignment', match => { match.captains.affirmative = 'ben'; }],
]) {
  test(`a ${change} change discards dirty scores and cancels the pending autosave`, () => {
    const h = harness(); const before = openFixture(h);
    const scoreInput = addSecret(h, 'judge-content'); addSecret(h, 'dialog-fields');
    const form = new Element('form'); form.append(new Element('input')); h.document.activeElement = form.children[0];
    h.element('dialog').open = true; h.state.judgeDirty = true;
    let oldScoresSaved = false;
    h.state.draftTimer = h.timer(() => { oldScoresSaved = true; });
    const oldTimer = h.state.draftTimer, generation = h.state.viewGeneration;
    h.state.messageHistory.set('private-channel', [{ text: 'Private old context' }]);
    // An ordinary timer/revision tick must not throw away active typing.
    const tick = structuredClone(before); tick.revision++;
    h.adopt(tick);
    assert.equal(h.state.judgeDirty, true); assert.equal(scoreInput.parentElement, h.element('judge-content'));
    assert.equal(h.timers.has(oldTimer), true); assert.equal(h.counters.panel, 0);
    const changed = structuredClone(tick); changed.revision++; mutate(changed.matches[0]);
    h.adopt(changed);
    assert.equal(h.state.event, changed); assert.equal(h.state.judgeDirty, false);
    assert.equal(h.state.viewGeneration, generation + 1);
    assert.equal(h.element('judge-content').children.length, 0); assert.equal(scoreInput.parentElement, null);
    assert.equal(h.element('dialog-fields').children.length, 0); assert.equal(h.element('dialog').open, false);
    assert.equal(h.state.messageHistory.size, 0); assert.ok(h.clearedTimers.has(oldTimer));
    assert.equal(h.timers.has(oldTimer), false);
    for (const timer of h.timers.values()) timer.callback();
    assert.equal(oldScoresSaved, false, 'No queued autosave can submit the old person/rubric scores');
    assert.equal(h.element('context-change-note').hidden, false);
    assert.match(h.element('context-change-note').textContent, /Unsaved values.*discarded/);
    assert.equal(h.counters.panel, 1, 'The new scoring context renders even when the old form had focus');
  });
}
