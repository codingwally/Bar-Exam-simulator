/** Actual client command/retry paths with inert fetch and DOM boundaries. No hosted requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/debate-room.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../debate-room/index.html', import.meta.url), 'utf8');
const startup = source.indexOf("\ndocument.addEventListener('click'");
assert.ok(startup > 0, 'The real client declarations must precede startup');
const declarations = source.slice(0, startup).replace(/^import .+;\r?\n/gm, '');
const mediaInterval = source.split(/\r?\n/).find(line => line.startsWith('setInterval(()=>{if(media.joined'));
assert.ok(mediaInterval, 'Exercise the real background media renewal callback');

function harness() {
  const elements = new Map(), fetches = [], timers = new Map(), intervals = new Map();
  let timerSequence = 0;
  const document = {
    activeElement: null, querySelectorAll: () => [],
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', dataset: {}, hidden: false, open: false,
        close() { this.open = false; }, reset() {}, replaceChildren() { this.textContent = ''; },
        setAttribute() {}, querySelectorAll: () => [],
      });
      return elements.get(id);
    },
  };
  class Media {
    constructor() { this.joined = false; this.credential = null; this.leaveCalls = 0; }
    async leave() { this.joined = false; this.leaveCalls++; }
  }
  const context = vm.createContext({
    document, DebateMedia: Media, navigator: { onLine: true },
    location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:4178', pathname: '/debate-room/' },
    DEBATE_LOCAL_REHEARSAL: true, crypto: { randomUUID }, AbortController, URLSearchParams,
    performance: { now: () => 1000 }, history: { replaceState() {} },
    setTimeout(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval(callback, delay) { intervals.set(delay, callback); },
    fetch(url, options) {
      return new Promise((resolve, reject) => {
        const call = { url, options, reject,
          respond(body, status = 200, unreadable = false) {
            resolve({ ok: status >= 200 && status < 300, status,
              json: async () => { if (unreadable) throw new SyntaxError('Synthetic unreadable response'); return body; } });
          },
        };
        fetches.push(call);
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Synthetic timeout'), { name: 'AbortError' })), { once: true });
      });
    },
  });
  vm.runInContext(`${declarations}\n
    renderLive=()=>{};renderPanel=()=>{};reconcileMedia=async()=>{};loadEvents=async()=>{};
    globalThis.client={state,command,retryPending,request,refresh,adopt,clearSensitiveViews,discardEventView,
      signOutCleanup,openEvent,renewOwnedClock,guarded,media,actions};
    ${mediaInterval}
  `, context, { filename: 'assets/debate-room.js' });
  const h = { ...context.client, fetches, timers, intervals, context, element: id => document.getElementById(id) };
  open(h);
  return h;
}

function event(id = 'event-one', actor = 'official-one') {
  return { id, revision: 10, myId: actor, ownerId: actor, title: 'Synthetic command recovery',
    language: 'English', timezone: 'Asia/Manila', status: 'live', teams: [], motions: [],
    members: [{ id: actor, admitted: true, roles: ['host'] }], activeMatchId: `${id}-match`,
    matches: [{ id: `${id}-match`, judgeIds: [actor], seats: {}, closingSeats: {}, captains: {}, ruleVersion: 1,
      timer: { version: 19, controllerId: actor, leaseExpiresAtServerMs: 30000 } }],
  };
}
function open(h, next = event()) {
  h.state.session = { access_token: 'synthetic-local-only', user: { id: next.myId } };
  h.state.event = next; h.state.matchId = next.activeMatchId;
  return next;
}
const inputOf = call => JSON.parse(call.options.body);
const saved = (h, revision = h.state.event.revision + 1) => ({ ok: true, event: { ...h.state.event, revision },
  serverNow: 123000, receipt: { id: 'synthetic-receipt', eventId: h.state.event.id,
    command: inputOf(h.fetches.at(-1)).command, revision, committedAt: 122000, result: { confirmed: true } } });
const unavailable = { ok: false, error: { code: 'STORE_UNAVAILABLE', message: 'Saved debate information is temporarily unavailable.' } };
async function failCommand(h, status = 503, command = 'renew_clock') {
  const operation = h.command(command, { matchId: h.state.matchId, timerVersion: 19 });
  const rejection = assert.rejects(operation, error => error.status === status);
  h.fetches.at(-1).respond(unavailable, status); await rejection;
  return h.state.pending;
}

for (const status of [408, 425, 429, 499, 500, 502, 503, 504]) {
  test(`HTTP ${status} retains the original action for an explicit same-key retry`, async () => {
    const h = harness(), payload = { matchId: h.state.matchId, timerVersion: 19, nested: { label: 'original' } };
    const operation = h.guarded(() => h.command('renew_clock', payload));
    const original = h.fetches[0].options.body;
    payload.nested.label = 'changed after sending';
    h.fetches[0].respond(unavailable, status); await operation;
    assert.equal(h.state.busy, false); assert.ok(h.state.pending);
    assert.match(h.element('status').textContent, /Use Retry last action/);
    assert.doesNotMatch(h.element('status').textContent, /STORE_UNAVAILABLE|RPC|lease|idempotency/i);
    assert.equal(h.fetches.length, 1, 'No blind automatic retry');
    const retry = h.retryPending();
    assert.equal(h.fetches[1].options.body, original, 'Exact original payload, revision and key survive');
    h.fetches[1].respond(saved(h));
    assert.equal((await retry).confirmed, true);
    assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
    assert.equal(h.state.event.revision, 11);
    assert.equal(h.element('status').textContent, 'The saved action is confirmed.');
  });
}

for (const failure of ['network', 'timeout', 'unreadable success', 'empty success', 'unconfirmed success', 'invalid receipt',
  'empty receipt', 'wrong receipt command', 'wrong receipt event', 'missing receipt id', 'missing receipt revision',
  'missing commit time', 'missing event', 'wrong event account', 'stale event']) {
  test(`${failure} remains unconfirmed and preserves the submitted action`, async () => {
    const h = harness(), operation = h.guarded(() => h.command('save_draft', { notes: 'synthetic draft' }));
    if (failure === 'network') h.fetches[0].reject(new TypeError('Synthetic network loss'));
    else if (failure === 'timeout') [...h.timers.values()].find(timer => timer.delay === 18000).callback();
    else {
      let response = saved(h);
      if (failure === 'unconfirmed success') response = unavailable;
      else if (failure === 'invalid receipt') response.receipt = [];
      else if (failure === 'empty receipt') response.receipt = {};
      else if (failure === 'wrong receipt command') response.receipt.command = 'send_message';
      else if (failure === 'wrong receipt event') response.receipt.eventId = 'another-event';
      else if (failure === 'missing receipt id') delete response.receipt.id;
      else if (failure === 'missing receipt revision') delete response.receipt.revision;
      else if (failure === 'missing commit time') delete response.receipt.committedAt;
      else if (failure === 'missing event') delete response.event;
      else if (failure === 'wrong event account') response.event.myId = 'another-account';
      else if (failure === 'stale event') response.event.revision = response.receipt.revision - 1;
      else response = {};
      h.fetches[0].respond(response, 200, failure === 'unreadable success');
    }
    await operation;
    assert.equal(h.state.pending.command, 'save_draft'); assert.equal(h.state.busy, false);
    assert.match(h.element('status').textContent, /could not confirm whether this action was saved/);
    assert.equal(h.fetches.length, 1); assert.equal(h.timers.size, 0);
  });
}

test('background renewals and unrelated commands cannot replace a pending action', async () => {
  const h = harness(), pending = await failCommand(h, 503, 'save_draft');
  h.media.joined = true;
  await h.renewOwnedClock(); h.intervals.get(45000)();
  await assert.rejects(h.command('send_message', { text: 'new message' }), /Retry last action/);
  assert.equal(h.state.pending, pending); assert.equal(h.fetches.length, 1);
  const retry = h.retryPending();
  assert.equal(h.state.busy, true);
  await assert.rejects(h.retryPending(), /still being confirmed/);
  await assert.rejects(h.command('send_message', {}), /still being confirmed/);
  await h.renewOwnedClock(); h.intervals.get(45000)();
  assert.equal(h.fetches.length, 2);
  const rejection = assert.rejects(retry, error => error.status === 503);
  h.fetches[1].respond(unavailable, 503); await rejection;
  assert.equal(h.state.pending, pending); assert.equal(h.state.busy, false);
  assert.equal(h.fetches[1].options.body, h.fetches[0].options.body);
});

for (const [status, code] of [[400, 'INVALID_PAYLOAD'], [401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'],
  [404, 'EVENT_NOT_FOUND'], [409, 'REVISION_CONFLICT'], [413, 'PAYLOAD_TOO_LARGE'], [422, 'INVALID_REQUEST']]) {
  test(`deliberate ${status} rejection clears the action and preserves its specific guidance`, async () => {
    const h = harness(), operation = h.command('save_draft', {});
    const rejection = assert.rejects(operation, error => error.status === status && error.code === code);
    h.fetches[0].respond({ ok: false, error: { code, message: 'Specific safe participant guidance.' } }, status);
    await rejection;
    assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
    assert.equal(h.element('status').textContent, 'Specific safe participant guidance.');
    assert.equal(h.fetches.length, 1);
  });
}

test('a deliberate rejection on retry releases the pending action', async () => {
  const h = harness(); await failCommand(h);
  const retry = h.retryPending(), rejection = assert.rejects(retry, error => error.code === 'REVISION_CONFLICT');
  h.fetches[1].respond({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'Refresh the event and review the latest change.' } }, 409);
  await rejection;
  assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
  const next = h.command('check_in', {}); h.fetches[2].respond(saved(h)); await next;
  assert.equal(inputOf(h.fetches[2]).command, 'check_in');
});

for (const status of [401, 403]) {
  test(`HTTP ${status} during recovery cannot discard the original action before same-account access returns`, async () => {
    const h = harness(), pending = await failCommand(h, 503, 'send_message');
    const original = h.fetches[0].options.body;
    const retry = h.retryPending(), rejection = assert.rejects(retry, error => error.status === status);
    h.fetches[1].respond({ ok: false, error: { code: status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN', message: 'Access needs to be restored.' } }, status);
    await rejection;
    assert.equal(h.state.pending, pending); assert.equal(h.state.busy, false);
    await h.renewOwnedClock(); h.media.joined = true; h.intervals.get(45000)();
    assert.equal(h.fetches.length, 2, 'Access rejection never triggers an automatic action');
    h.state.session.access_token = 'synthetic-refreshed-same-account';
    const recovered = h.retryPending();
    assert.equal(h.fetches[2].options.body, original);
    assert.equal(h.fetches[2].options.headers.Authorization, 'Bearer synthetic-refreshed-same-account');
    h.fetches[2].respond(saved(h)); await recovered;
    assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
  });
}

for (const status of [401, 403]) {
  test(`snapshot ${status} clears private content while preserving same-account recovery after an uncertain action`, async () => {
    const h = harness(), originalEvent = h.state.event, session = h.state.session;
    const pending = await failCommand(h, 503, 'send_message'), original = h.fetches[0].options.body;
    const retry = h.retryPending(), rejected = assert.rejects(retry, error => error.status === status);
    const denied = { ok: false, error: { code: status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN', message: 'Access needs to be restored.' } };
    h.fetches[1].respond(denied, status); await rejected;
    const privateIds = ['judge-content', 'messages', 'evidence-list', 'results-content', 'overview-content',
      'participants-content', 'rules-content', 'vote-content', 'schedule-content', 'help-content', 'dialog-fields', 'live-motion'];
    for (const id of privateIds) h.element(id).textContent = 'PRIVATE';
    for (const id of ['message-form', 'evidence-form']) {
      h.element(id).privateDraft = 'PRIVATE';
      h.element(id).reset = function () { this.privateDraft = ''; };
    }
    h.state.messageHistory.set('private', ['PRIVATE']); h.state.historyDone.add('private');
    h.state.judgeDirty = true; h.state.freshInvite = { secret: 'PRIVATE' }; h.element('dialog').open = true;
    h.media.joined = true;
    const refreshing = h.refresh(); h.fetches[2].respond(denied, status); await refreshing;
    assert.equal(h.state.event, null); assert.equal(h.state.matchId, null); assert.equal(h.state.session, session);
    assert.equal(h.state.pending, pending); assert.equal(h.state.pendingAccount.id, session.user.id);
    assert.equal(h.state.pendingAccount.generation, h.state.accountGeneration);
    assert.equal(h.state.judgeDirty, false); assert.equal(h.state.freshInvite, null);
    assert.equal(h.state.messageHistory.size, 0); assert.equal(h.state.historyDone.size, 0);
    assert.equal(h.media.joined, false); assert.equal(h.media.leaveCalls, 1); assert.equal(h.element('dialog').open, false);
    assert.equal(h.element('event').hidden, true); assert.equal(h.element('lobby').hidden, false);
    for (const id of privateIds) assert.equal(h.element(id).textContent, '', id);
    for (const id of ['message-form', 'evidence-form']) assert.equal(h.element(id).privateDraft, '', id);
    assert.match(h.element('status').textContent, /access needs to be restored.*Retry last action/);
    assert.doesNotMatch(h.element('status').textContent, /saved action is confirmed/i);
    await h.refresh(); await h.renewOwnedClock(); h.intervals.get(45000)();
    await assert.rejects(h.command('send_message', { text: 'replacement' }), /Retry last action/);
    assert.equal(h.fetches.length, 3, 'Cleared event stops automatic polling and background writes');
    h.state.session = { ...session, access_token: 'synthetic-refreshed-same-account' };
    const recovered = h.actions.retry();
    assert.equal(h.fetches[3].options.body, original);
    assert.equal(h.fetches[3].options.headers.Authorization, 'Bearer synthetic-refreshed-same-account');
    h.fetches[3].respond({ ok: true, event: { ...originalEvent, revision: 11 }, serverNow: 123000,
      receipt: { id: 'recovered-receipt', eventId: originalEvent.id, command: pending.command, revision: 11, committedAt: 122000, result: { confirmed: true } } });
    await recovered;
    assert.equal(h.state.pending, null); assert.equal(h.state.pendingAccount, null);
    assert.equal(h.state.event.id, originalEvent.id); assert.equal(h.element('event').hidden, false);
  });
}

for (const transition of ['account', 'event']) {
  test(`a delayed media leave after access loss cannot restore recovery or status after ${transition} changes`, async () => {
    const h = harness(); await failCommand(h, 503, 'send_message');
    let release;
    h.media.leave = () => new Promise(resolve => { release = resolve; });
    const refreshing = h.refresh();
    h.fetches[1].respond({ ok: false, error: { code: 'FORBIDDEN', message: 'Access changed.' } }, 403);
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    assert.equal(typeof release, 'function'); assert.equal(h.state.event, null); assert.ok(h.state.pending);
    h.media.leave = async () => {};
    if (transition === 'account') await h.signOutCleanup(); else h.discardEventView();
    const next = open(h, event('event-two', transition === 'account' ? 'official-two' : 'official-one'));
    h.element('status').textContent = 'Current view';
    assert.equal(h.state.pending, null); assert.equal(h.state.pendingAccount, null);
    release(); await refreshing;
    assert.equal(h.state.event, next); assert.equal(h.state.pending, null); assert.equal(h.state.pendingAccount, null);
    assert.equal(h.element('status').textContent, 'Current view'); assert.equal(h.fetches.length, 2);
  });
}

for (const change of ['identity', 'generation']) {
  test(`recovery cannot submit its old envelope after an unannounced account ${change} change`, async () => {
    const h = harness(); await failCommand(h);
    if (change === 'identity') h.state.session = { user: { id: 'another-account' }, access_token: 'synthetic-other-account' };
    else h.state.accountGeneration++;
    await assert.rejects(h.retryPending(), error => error.code === 'VIEW_CHANGED');
    assert.equal(h.state.pending, null); assert.equal(h.state.pendingAccount, null); assert.equal(h.fetches.length, 1);
  });
}

for (const command of ['create_event', 'join_public_event']) {
  test(`the visible lobby retry control recovers an uncertain ${command} with its original envelope`, async () => {
    const lobby = page.slice(page.indexOf('<section id="lobby"'), page.indexOf('<section id="event"'));
    const retryButton = lobby.match(/<button\b[^>]*\bid="lobby-retry"[^>]*>/)?.[0];
    assert.ok(retryButton, 'Recovery must be reachable outside the hidden event workspace');
    assert.doesNotMatch(retryButton, /\b(?:hidden|disabled)(?:\s|=|>)/);
    const action = retryButton.match(/\bdata-action="([^"]+)"/)?.[1];
    const h = harness(); h.discardEventView();
    const operation = h.guarded(() => h.command(command, command === 'create_event' ? { title: 'Synthetic lobby recovery' } : {}, command === 'create_event' ? undefined : 'event-one'));
    h.fetches[0].respond(unavailable, 503); await operation;
    assert.ok(h.state.pending); assert.equal(h.element('lobby').hidden, false); assert.equal(h.element('event').hidden, true);
    const retry = h.actions[action]();
    assert.equal(h.fetches[1].options.body, h.fetches[0].options.body);
    const next = event();
    h.fetches[1].respond({ ok: true, event: next, serverNow: 123000,
      receipt: { id: 'synthetic-lobby-receipt', eventId: next.id, command, revision: next.revision, committedAt: 122000, result: {} } });
    await retry;
    assert.equal(h.state.pending, null); assert.equal(h.element('lobby').hidden, true); assert.equal(h.element('event').hidden, false);
    assert.equal(h.state.event.id, next.id);
  });
}

test('a newer read-only snapshot does not rewrite the original command revision or key', async () => {
  const h = harness(); await failCommand(h);
  const body = h.fetches[0].options.body, pending = h.state.pending;
  const refresh = h.refresh(); h.fetches[1].respond({ ok: true, event: { ...h.state.event, revision: 20 }, serverNow: 124000 }); await refresh;
  assert.equal(h.state.event.revision, 20); assert.equal(h.state.pending, pending);
  const retry = h.retryPending(); assert.equal(h.fetches[2].options.body, body);
  h.fetches[2].respond(saved(h, 20)); await retry;
  assert.equal(h.state.pending, null);
});

test('offline retry retains the unresolved action without a network request', async () => {
  const h = harness(), pending = await failCommand(h);
  h.context.navigator.onLine = false;
  await assert.rejects(h.retryPending(), /Reconnect/);
  assert.equal(h.state.pending, pending); assert.equal(h.state.busy, false); assert.equal(h.fetches.length, 1);
});

test('an interrupted confirmation display still keeps the original action available for safe retry', async () => {
  const h = harness();
  vm.runInContext("renderLive=()=>{throw new Error('Synthetic display interruption');};", h.context);
  const operation = h.guarded(() => h.command('check_in', {}));
  h.fetches[0].respond(saved(h)); await operation;
  assert.ok(h.state.pending); assert.equal(h.state.busy, false);
  vm.runInContext('renderLive=()=>{};', h.context);
  const retry = h.retryPending(); assert.equal(h.fetches[1].options.body, h.fetches[0].options.body);
  h.fetches[1].respond(saved(h, 11)); await retry;
  assert.equal(h.state.pending, null); assert.equal(h.state.event.revision, 11);
});

for (const transition of ['event', 'account']) {
  for (const operation of ['command', 'retry']) {
    for (const late of ['success', '503', 'network']) {
      test(`${transition} change isolates a late ${late} from an old ${operation} and its replacement`, async () => {
        const h = harness();
        if (operation === 'retry') await failCommand(h);
        const oldEvent = h.state.event;
        const old = h.guarded(() => operation === 'retry' ? h.retryPending() : h.command('save_draft', {}));
        const oldCall = h.fetches.at(-1);
        if (transition === 'account') await h.signOutCleanup(); else h.discardEventView();
        assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
        const nextEvent = open(h, event('event-two', transition === 'account' ? 'official-two' : 'official-one'));
        const next = h.command('check_in', {}), nextPending = h.state.pending, nextCall = h.fetches.at(-1);
        const currentStatus = h.element('status').textContent;
        if (late === 'network') oldCall.reject(new TypeError('Old connection failed'));
        else if (late === '503') oldCall.respond(unavailable, 503);
        else oldCall.respond({ ok: true, event: { ...oldEvent, revision: 999 }, serverNow: 999999, receipt: { result: {} } });
        await old;
        assert.equal(h.state.event, nextEvent); assert.equal(h.state.pending, nextPending);
        assert.equal(h.state.busy, true, 'Old finally cannot unlock the new request');
        assert.equal(h.element('status').textContent, currentStatus); assert.equal(h.state.sync, null);
        nextCall.respond(saved(h)); await next;
        assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
        assert.equal(h.state.event.id, 'event-two');
      });
    }
  }
}

test('opening another event clears pending after leaving local media without sending an unrelated command', async () => {
  const h = harness(); await failCommand(h);
  h.state.event.matches[0].myMedia = { status: 'ready' }; h.media.joined = true;
  const opening = h.openEvent('event-two');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.media.leaveCalls, 1); assert.equal(h.media.joined, false);
  assert.equal(h.state.pending, null); assert.equal(h.state.busy, false);
  assert.equal(h.fetches.length, 2); assert.equal(h.fetches[1].options.method, 'GET');
  h.fetches[1].respond({ ok: true, event: event('event-two'), serverNow: 123000 }); await opening;
  assert.equal(h.state.event.id, 'event-two');
});

test('Retry last action without pending only refreshes the current event', async () => {
  const h = harness(), retry = h.retryPending();
  assert.equal(h.fetches[0].options.method, 'GET');
  h.fetches[0].respond({ ok: true, event: { ...h.state.event, revision: 12 }, serverNow: 123000 }); await retry;
  assert.equal(h.state.event.revision, 12); assert.equal(h.state.pending, null);
});
