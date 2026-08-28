import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/lex-forum.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../assets/lex-forum.css', import.meta.url), 'utf8');
const featureLoader = await readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pagesWorkflow = await readFile(new URL('../.github/workflows/deploy-pages-only.yml', import.meta.url), 'utf8');

function extractNamedFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}.`);
  const openingBrace = text.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}.`);
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    contains: (value) => values.has(value),
    add: (value) => values.add(value),
    toggle(value, force) {
      if (force) values.add(value);
      else values.delete(value);
    },
  };
}

function fakeElement(tag) {
  const classes = new Set();
  const listeners = new Map();
  const element = {
    tagName: String(tag).toUpperCase(),
    type: '',
    textContent: '',
    hidden: false,
    id: '',
    dataset: {},
    attributes: new Map(),
    children: [],
    isConnected: true,
    scrollHeight: 0,
    clientHeight: 0,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, handler) { listeners.set(name, handler); },
    click() { listeners.get('click')?.(); },
  };
  Object.defineProperty(element, 'className', {
    get: () => [...classes].join(' '),
    set: (value) => {
      classes.clear();
      String(value || '').split(/\s+/u).filter(Boolean).forEach((name) => classes.add(name));
    },
  });
  element.classList = {
    contains: (value) => classes.has(value),
    add: (value) => classes.add(value),
    toggle(value, force) {
      if (force) classes.add(value);
      else classes.delete(value);
    },
  };
  return element;
}

const context = vm.createContext({});
vm.runInContext(extractNamedFunction(source, 'updatePostBodyDisclosure'), context);

const longBody = { classList: classList(['is-collapsed']) };
const longToggle = {
  hidden: true,
  textContent: '',
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
};
context.body = longBody;
context.toggle = longToggle;
vm.runInContext('updatePostBodyDisclosure(body, toggle, false, true)', context);
assert.equal(longBody.classList.contains('is-collapsed'), true);
assert.equal(longToggle.hidden, false);
assert.equal(longToggle.textContent, 'Read more');
assert.equal(longToggle.attributes.get('aria-expanded'), 'false');

vm.runInContext('updatePostBodyDisclosure(body, toggle, true, true)', context);
assert.equal(longBody.classList.contains('is-collapsed'), false);
assert.equal(longToggle.textContent, 'Show less');
assert.equal(longToggle.attributes.get('aria-expanded'), 'true');

const shortBody = { classList: classList(['is-collapsed']) };
const shortToggle = {
  hidden: false,
  textContent: '',
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
};
context.body = shortBody;
context.toggle = shortToggle;
vm.runInContext('updatePostBodyDisclosure(body, toggle, false, false)', context);
assert.equal(shortBody.classList.contains('is-collapsed'), false);
assert.equal(shortToggle.hidden, true);

const integrationState = { view: 'home', expandedPostBodies: new Set() };
const integrationContext = vm.createContext({
  state: integrationState,
  document: { createElement: fakeElement },
  $: (selector, root) => root.children.find((child) => child.classList.contains(selector.slice(1))) || null,
});
for (const name of [
  'postBodyRegionId',
  'textElement',
  'button',
  'updatePostBodyDisclosure',
  'preparePostBodyDisclosure',
  'applyPostBodyDisclosure',
  'syncPostBodyDisclosure',
  'renderPostBody',
]) {
  vm.runInContext(extractNamedFunction(source, name), integrationContext);
}

const renderedLong = vm.runInContext("renderPostBody({ entryId: 'post-1', body: 'Long post' })", integrationContext);
const [renderedLongBody, renderedLongToggle] = renderedLong.children;
renderedLongBody.scrollHeight = 180;
renderedLongBody.clientHeight = 100;
integrationContext.wrapper = renderedLong;
vm.runInContext('syncPostBodyDisclosure(wrapper)', integrationContext);
assert.equal(renderedLongBody.classList.contains('is-collapsed'), true);
assert.equal(renderedLongToggle.hidden, false);
assert.equal(renderedLongToggle.textContent, 'Read more');
assert.equal(renderedLongToggle.tagName, 'BUTTON');
assert.equal(renderedLongToggle.type, 'button', 'Native button semantics provide keyboard activation.');

renderedLongToggle.click();
assert.equal(renderedLongBody.classList.contains('is-collapsed'), false);
assert.equal(renderedLongToggle.textContent, 'Show less');

const rerenderedLong = vm.runInContext("renderPostBody({ entryId: 'post-1', body: 'Long post' })", integrationContext);
const [rerenderedLongBody, rerenderedLongToggle] = rerenderedLong.children;
rerenderedLongBody.scrollHeight = 180;
rerenderedLongBody.clientHeight = 100;
integrationContext.wrapper = rerenderedLong;
vm.runInContext('syncPostBodyDisclosure(wrapper)', integrationContext);
assert.equal(rerenderedLongBody.classList.contains('is-collapsed'), false, 'Expansion survives a feed rerender.');
assert.equal(rerenderedLongToggle.textContent, 'Show less');
rerenderedLongToggle.click();
assert.equal(rerenderedLongBody.classList.contains('is-collapsed'), true);

const renderedShort = vm.runInContext("renderPostBody({ entryId: 'post-2', body: 'Short post' })", integrationContext);
const [renderedShortBody, renderedShortToggle] = renderedShort.children;
renderedShortBody.scrollHeight = 60;
renderedShortBody.clientHeight = 100;
integrationContext.wrapper = renderedShort;
vm.runInContext('syncPostBodyDisclosure(wrapper)', integrationContext);
assert.equal(renderedShortToggle.hidden, true);
assert.equal(renderedShortBody.classList.contains('is-collapsed'), false);

integrationState.view = 'post';
const renderedFullPost = vm.runInContext("renderPostBody({ entryId: 'post-3', body: 'Full post' })", integrationContext);
assert.equal(renderedFullPost.tagName, 'P');
assert.equal(renderedFullPost.children.length, 0, 'Non-Home views render the full body without a disclosure wrapper.');

let scheduledFromRender = 0;
const feedElement = fakeElement('div');
const loadMoreElement = fakeElement('button');
const renderFeedContext = vm.createContext({
  state: { view: 'home', circleDetail: null, items: [], hasMore: false },
  global: { DueDiligenceSubscriptionCta: { createHomeInvitation: () => null } },
  navigator: { onLine: true },
  document: { createElement: fakeElement },
  $: (selector) => selector === '#lex-feed' ? feedElement : loadMoreElement,
  textElement: (tag, className, value) => {
    const node = fakeElement(tag);
    node.className = className;
    node.textContent = String(value ?? '');
    return node;
  },
  button: (label, className) => {
    const node = fakeElement('button');
    node.className = className;
    node.textContent = label;
    return node;
  },
  refreshFeed: () => {},
  circleDetailPanel: () => fakeElement('div'),
  renderEntry: () => fakeElement('article'),
  schedulePostBodyDisclosureSync: () => { scheduledFromRender += 1; },
});
vm.runInContext(extractNamedFunction(source, 'renderFeed'), renderFeedContext);
vm.runInContext('renderFeed()', renderFeedContext);
assert.equal(scheduledFromRender, 1, 'Initial feed rendering must schedule disclosure measurement.');

let scheduledFrameCallback = null;
let disclosureSyncs = 0;
const schedulerState = { postBodyResizeFrame: 0 };
const schedulerContext = vm.createContext({
  state: schedulerState,
  cancelAnimationFrame: () => {},
  requestAnimationFrame: (callback) => {
    scheduledFrameCallback = callback;
    return 27;
  },
  syncPostBodyDisclosures: () => { disclosureSyncs += 1; },
});
vm.runInContext(extractNamedFunction(source, 'schedulePostBodyDisclosureSync'), schedulerContext);
vm.runInContext('schedulePostBodyDisclosureSync()', schedulerContext);
assert.equal(schedulerState.postBodyResizeFrame, 27);
scheduledFrameCallback();
assert.equal(schedulerState.postBodyResizeFrame, 0);
assert.equal(disclosureSyncs, 1);

assert.match(
  source,
  /if \(state\.view !== 'home' \|\| !item\.entryId\) return body;/,
  'Only Home feed posts may be collapsed; full-post and other views must keep the complete body visible.',
);
assert.match(source, /toggle\.setAttribute\('aria-controls', body\.id\);/);
assert.match(source, /toggle\.setAttribute\('aria-expanded', 'false'\);/);
assert.match(source, /state\.expandedPostBodies\.has\(entryId\)/);
assert.match(source, /disclosure\.body\.scrollHeight > disclosure\.body\.clientHeight \+ 1/);
assert.match(source, /inner\.append\(renderPostBody\(item\)\)/);
assert.match(source, /const disclosures = \$\$\('\.lex-post-copy', feed\)[\s\S]*?const measurements = disclosures\.map[\s\S]*?measurements\.forEach/,
  'Feed-wide disclosure sync must batch writes, reads, then final writes.');
assert.match(source, /global\.addEventListener\('resize', schedulePostBodyDisclosureSync/);
assert.match(styles, /#page-community \.lex-post-body\.is-collapsed \{[\s\S]*?max-height:\s*calc\(1\.45em \* 5\);[\s\S]*?overflow:\s*hidden;/);
assert.match(styles, /#page-community \.lex-post-read-more \{[\s\S]*?min-height:\s*44px;/);
assert.match(styles, /#page-community \.lex-post-read-more\[hidden\] \{\s*display:\s*none;/);
assert.match(featureLoader, /lex-forum\.css[^'\n]*collapse=home-read-more-20260828-1/);
assert.match(featureLoader, /lex-forum\.js[^'\n]*collapse=home-read-more-20260828-1/);
assert.match(index, /feature-loader\.js[^"\n]*collapse=home-read-more-20260828-1/);
assert.match(pagesWorkflow, /collapse=home-read-more-20260828-1/);
assert.match(pagesWorkflow, /function renderPostBody\(item\)/);
assert.match(pagesWorkflow, /lex-post-read-more/);

console.log('Home long-post collapse and disclosure accessibility contracts passed.');
