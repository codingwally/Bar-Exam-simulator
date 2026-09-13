/** Actual native-navigation/focus functions with an explicitly delayed history.
 * No browser, account, network request or shared form submission is exercised. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const between = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
};
const functions = between('  function setOverlay(', '  function setStatus(')
  + between('  function syncNativeViewWithHash(', '  async function submitSupport(')
  + between('  function bindNavigation()', '  function handleAuthStateChange(');
const closeListeners = ['close', 'back'].map(name => {
  const match = source.match(new RegExp(`^.*document\\.getElementById\\('dd2-native-${name}'\\).*addEventListener\\('click'.*$`, 'm'));
  assert.ok(match, name); return match[0];
}).join('\n');
const routeListeners = between("    document.addEventListener('keydown', (event) => {", "    global.addEventListener('pageshow'");

function harness({ hash = '#quorum', historyState = {} } = {}) {
  const nodes = new Map(), globalListeners = new Map(), documentListeners = new Map(), frames = [], traversals = [], isolation = [];
  const location = { pathname: '/', search: '', hash }, entries = [{ hash, state: historyState }];
  let index = 0, backCalls = 0, homeShows = 0;
  const state = { user: { id: 'synthetic-member' }, nativeView: null, nativeViewMode: 'route', nativeViewSequence: 0,
    nativeViewClosing: false, overlayFocusOrigins: new Map(), answerDraft: 'The learner’s existing answer.', selectedPaymentProof: null };
  const listen = (map, name, callback) => { if (!map.has(name)) map.set(name, []); map.get(name).push(callback); };
  class Element {
    constructor(id) {
      this.id = id; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.classes = new Set();
      this.isConnected = true; this.hidden = false; this.disabled = false; this.inert = false; this.innerHTML = '';
      this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name) };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    addEventListener(name, callback) { listen(this.listeners, name, callback); }
    querySelector() { return this.id === 'dd2-native-view' ? element('dd2-native-close') : null; }
    focus() { if (!this.inert && !this.hidden && !this.disabled) document.activeElement = this; }
    click() {
      if (this.inert || this.hidden || this.disabled) return false;
      for (const callback of this.listeners.get('click') || []) callback({ target: this, currentTarget: this, preventDefault() {}, stopImmediatePropagation() {} });
      return true;
    }
  }
  function element(id) { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); }
  const document = { activeElement: element('btn-signin'), body: element('body'), getElementById: element,
    querySelector: selector => selector === '.dd2-overlay.is-open' && element('dd2-native-view').classes.has('is-open') ? element('dd2-native-view') : null,
    querySelectorAll: () => [], addEventListener: (name, callback) => listen(documentListeners, name, callback) };
  const global = { scrollX: 0, scrollY: 120, scrollCalls: [], scrollTo(value) { this.scrollCalls.push(value); },
    addEventListener: (name, callback) => listen(globalListeners, name, callback),
    syncModalIsolation() { const open = element('dd2-native-view').classes.has('is-open'); isolation.push(open); element('btn-signin').inert = open; },
    DueDiligencePublicHome: { show() { homeShows++; } } };
  const entry = (value, url) => ({ state: JSON.parse(JSON.stringify(value)), hash: new URL(url, 'https://duediligence.ph/').hash });
  const history = { get state() { return entries[index].state; }, get length() { return entries.length; },
    pushState(value, title, url) { entries.splice(index + 1); entries.push(entry(value, url)); index++; location.hash = entries[index].hash; },
    replaceState(value, title, url) { entries[index] = entry(value, url); location.hash = entries[index].hash; },
    back() { backCalls++; if (index > 0) traversals.push(index - 1); } };
  const context = vm.createContext({ state, document, global, history, location, requestAnimationFrame: callback => frames.push(callback),
    clearCommercialPricingRefresh() {}, nativeDefinition: view => ['privacy', 'terms', 'account', 'pricing'].includes(view) ? ['View', view, () => `<p>${view}</p>`] : null,
    unlimitedFeatureActionContext: () => null, bindNativeViewHandlers() {}, syncEntryWithHistoryRoute() {}, trapOverlayFocus() {},
    showEntry() { assert.fail('No authentication operation is expected'); } });
  vm.runInContext(functions + '\n' + closeListeners + '\n' + routeListeners + '\nbindNavigation();', context);
  const flushFrames = () => { while (frames.length) frames.shift()(); };
  return { ...context, element, isolation, entries, flushFrames,
    get backCalls() { return backCalls; }, get pendingBacks() { return traversals.length; }, get homeShows() { return homeShows; },
    escape() { for (const callback of documentListeners.get('keydown') || []) callback({ key: 'Escape', preventDefault() {} }); },
    settleBack() {
      assert.equal(traversals.length, 1, 'One owned traversal must be pending');
      const previousHash = location.hash; index = traversals.shift(); location.hash = entries[index].hash;
      for (const callback of globalListeners.get('popstate') || []) callback({ state: history.state });
      if (previousHash !== location.hash) for (const callback of globalListeners.get('hashchange') || []) callback({});
      flushFrames();
    } };
}

test('owned route close keeps its dialog and focus isolation until delayed Back settles', () => {
  const h = harness(); h.renderNativeView('privacy'); h.flushFrames();
  h.element('dd2-native-body').innerHTML = 'Existing dialog content';
  h.element('dd2-native-close').click();
  assert.equal(h.state.nativeView, 'privacy'); assert.equal(h.state.nativeViewClosing, true);
  assert.equal(h.element('dd2-native-view').getAttribute('aria-hidden'), 'false');
  assert.equal(h.document.activeElement.id, 'dd2-native-close'); assert.equal(h.element('btn-signin').inert, true);
  assert.equal(h.element('btn-signin').click(), false, 'The background Profile control stays isolated');
  h.renderNativeView('account');
  h.renderNativeView('account', { push: false });
  h.syncNativeViewWithHash();
  h.syncNativeViewWithHash({ reason: 'route-change' });
  assert.equal(h.location.hash, '#privacy'); assert.equal(h.element('dd2-native-body').innerHTML, 'Existing dialog content');
  assert.equal(h.state.nativeViewClosing, true, 'Unsettled history or push:false cannot replace the closing dialog');
  assert.equal(h.pendingBacks, 1); assert.equal(h.backCalls, 1); assert.deepEqual(h.isolation, [true]);
  h.settleBack();
  assert.equal(h.location.hash, '#quorum'); assert.equal(h.state.nativeView, null); assert.equal(h.state.nativeViewClosing, false);
  assert.equal(h.element('dd2-native-view').getAttribute('aria-hidden'), 'true'); assert.equal(h.document.activeElement.id, 'btn-signin');
  assert.equal(h.state.answerDraft, 'The learner’s existing answer.');
});

test('repeated Close, Back and Escape queue one traversal and later independent Profile navigation still works', () => {
  const h = harness(); h.renderNativeView('privacy'); h.flushFrames();
  h.element('dd2-native-close').click(); h.element('dd2-native-back').click(); h.escape(); h.element('dd2-native-close').click();
  assert.equal(h.backCalls, 1); assert.equal(h.pendingBacks, 1); h.settleBack();
  h.escape(); h.closeNativeView(); assert.equal(h.backCalls, 1, 'A closed overlay cannot rewind again');
  assert.equal(h.element('btn-signin').click(), true); h.flushFrames();
  assert.equal(h.state.nativeView, 'account'); assert.equal(h.location.hash, '#account');
  h.element('dd2-native-back').click(); assert.equal(h.backCalls, 2); h.settleBack();
  h.renderNativeView('terms'); h.flushFrames(); assert.equal(h.location.hash, '#terms'); assert.equal(h.state.nativeView, 'terms');
  assert.equal(h.entries.length, 2, 'Replacing a forward dialog does not add extra history pops or entries');
});

test('settled route dismissal restores the existing origin hash and preserves direct-link dismissal', () => {
  const h = harness({ hash: '#forecast', historyState: { existingRoute: 'forecast' } });
  h.renderNativeView('privacy'); h.flushFrames(); h.closeNativeView(); h.settleBack();
  assert.equal(h.location.hash, '#forecast'); assert.deepEqual(h.history.state, { existingRoute: 'forecast' });
  h.element('btn-signin').click(); assert.equal(h.state.nativeView, 'account'); assert.equal(h.location.hash, '#account');
  const direct = harness({ hash: '#privacy', historyState: { unrelated: true } });
  direct.renderNativeView('privacy', { push: false }); direct.flushFrames(); direct.closeNativeView(); direct.flushFrames();
  assert.equal(direct.backCalls, 0); assert.equal(direct.state.nativeView, null); assert.equal(direct.location.hash, '#privacy');
  assert.deepEqual(direct.history.state, { unrelated: true }); assert.equal(direct.document.activeElement.id, 'btn-signin');
});

test('explicit Home-return dismissal remains immediate and never traverses history', () => {
  const h = harness(); h.renderNativeView('privacy', { returnToQuorum: true }); h.flushFrames();
  h.closeNativeView(); h.flushFrames(); assert.equal(h.state.nativeView, null); assert.equal(h.location.hash, '#quorum');
  assert.equal(h.backCalls, 0); assert.equal(h.homeShows, 1); assert.equal(h.document.activeElement.id, 'btn-signin');
});

test('paid-access action close retains callback, answer focus and scroll restoration without duplicate dismissal', () => {
  const h = harness({ hash: '#subject-matter', historyState: { existingAnswer: 'saved' } }), closed = [], answer = h.element('dd-answer-rich-editor');
  h.renderNativeView('pricing', { mode: 'action', actionId: 'answer-access', context: { reason: 'subject_reveal_review' },
    onClose: event => closed.push(event), returnFocus: answer }); h.flushFrames();
  h.escape(); h.element('dd2-native-back').click(); h.element('dd2-native-close').click();
  assert.equal(h.state.nativeView, 'pricing'); assert.equal(h.pendingBacks, 1); assert.equal(closed.length, 0);
  h.settleBack(); assert.equal(h.state.nativeView, null); assert.equal(closed.length, 1); assert.equal(closed[0].actionId, 'answer-access');
  assert.equal(closed[0].view, 'pricing'); assert.equal(h.document.activeElement, answer); assert.equal(h.global.scrollCalls.length, 1);
  assert.equal(h.global.scrollCalls[0].top, 120); assert.equal(h.location.hash, '#subject-matter');
  assert.deepEqual(h.history.state, { existingAnswer: 'saved' }); assert.equal(h.state.answerDraft, 'The learner’s existing answer.');
  h.closeNativeView(); assert.equal(h.backCalls, 1); assert.equal(closed.length, 1);
});

test('an action dialog whose history entry is no longer owned dismisses without another Back', () => {
  const h = harness(), closed = [];
  h.renderNativeView('pricing', { mode: 'action', actionId: 'access', onClose: event => closed.push(event) }); h.flushFrames();
  h.history.replaceState({ externalRoute: true }, '', '#quorum'); h.closeNativeView(); h.flushFrames();
  assert.equal(h.backCalls, 0); assert.equal(h.state.nativeView, null); assert.equal(closed.length, 1);
  assert.deepEqual(h.history.state, { externalRoute: true });
});

test('the changed native-view script has a fresh document URL and matching service-worker shell entry', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8'), sw = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  const raw = html.match(/<script src="(assets\/phase2-experience\.js[^\"]+)"/)[1].replaceAll('&amp;', '&');
  const url = new URL(raw, 'https://duediligence.ph/');
  assert.equal(url.searchParams.get('navigation'), 'native-close-20260910-1');
  assert.equal(url.searchParams.get('display'), 'home-readable-20260910-1');
  assert.equal(url.searchParams.get('asset-recovery'), 'bootstrap-20260909-1');
  assert.ok(sw.includes(`'${url.pathname}${url.search}'`));
  const old = new URL(url); old.searchParams.delete('navigation');
  assert.notEqual(old.href, url.href); assert.equal(sw.includes(`'${old.pathname}${old.search}'`), false);
  const oldCache = 'duediligence-shell-previous', unrelatedCache = 'learner-offline-data';
  const stored = new Map([[oldCache, new Map([[old.href, 'STALE_SCRIPT']])], [unrelatedCache, new Map()]]);
  const handlers = new Map(), origin = url.origin;
  const caches = {
    async open(name) {
      if (!stored.has(name)) stored.set(name, new Map());
      return { async addAll(paths) { for (const pathname of paths) stored.get(name).set(new URL(pathname, origin).href, 'CURRENT_SCRIPT'); } };
    },
    async keys() { return [...stored.keys()]; },
    async delete(name) { return stored.delete(name); },
    async match(request) { for (const cache of stored.values()) if (cache.has(request.url)) return cache.get(request.url); },
  };
  vm.runInNewContext(sw, { caches, URL, self: { location: { origin }, addEventListener: (name, callback) => handlers.set(name, callback) },
    fetch() { assert.fail('The installed exact script URL must be served from its new cache'); } });
  let completion;
  handlers.get('install')({ waitUntil(value) { completion = value; } }); await completion;
  let response;
  handlers.get('fetch')({ request: { method: 'GET', mode: 'cors', headers: new Headers(), url: url.href }, respondWith(value) { response = value; } });
  assert.equal(await response, 'CURRENT_SCRIPT', 'The old cached URL cannot answer a request for the changed script');
  handlers.get('activate')({ waitUntil(value) { completion = value; } }); await completion;
  assert.equal(stored.has(oldCache), false); assert.equal(stored.has(unrelatedCache), true, 'Activation preserves unrelated learner caches');
});
