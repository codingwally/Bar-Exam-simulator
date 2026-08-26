import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../assets/lex-forum.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../assets/lex-forum.css', import.meta.url), 'utf8');
const featureLoader = await readFile(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

assert.match(
  html,
  /data-quorum-view="my-posts">\s*My Posts/,
  'My Posts must have a distinct route/view identity.',
);
assert.match(
  html,
  /data-quorum-view="profile">\s*Profile/,
  'Profile must retain its own route/view identity.',
);
assert.match(
  featureLoader,
  /assets\/lex-forum\.css\?v=public-reliability-20260827-1/,
  'The Home accessibility fix must ship behind the current stylesheet cache key.',
);
assert.match(
  featureLoader,
  /assets\/lex-forum\.js\?v=public-reliability-20260827-1/,
  'The Home navigation fix must ship behind the current script cache key.',
);
assert.match(
  source,
  /const routableViews = new Set\(\[[\s\S]*?'my-posts'/,
  'The My Posts view must survive Back, Forward, refresh, and deep links.',
);
assert.match(
  source,
  /else if \(view === 'my-posts'\) \{[\s\S]{0,220}?await refreshFeed\(\{ viewRequestSequence \}\);/,
  'The My Posts view must render the member-filtered contribution feed.',
);
assert.match(
  source,
  /comments\.setAttribute\('aria-controls', commentRegionId\(item\.entryId\)\);/,
  'Each Comment toggle must identify its controlled comments region.',
);
assert.match(
  source,
  /comments\.setAttribute\('aria-expanded', String\(state\.commentsOpen\.has\(item\.entryId\)\)\);/,
  'Each Comment toggle must expose its initial expanded state.',
);
assert.match(
  source,
  /\(\) => toggleComments\(item, article, comments\)/,
  'The Comment toggle must pass its control to the state transition.',
);
assert.match(
  source,
  /async function toggleComments\(item, article, control\) \{[\s\S]*?control\.setAttribute\('aria-expanded', 'false'\);[\s\S]*?control\.setAttribute\('aria-expanded', 'true'\);/,
  'Opening and closing comments must keep aria-expanded synchronized.',
);
assert.match(
  source,
  /section\.id = commentRegionId\(item\.entryId\);/,
  'The comments region must use the same deterministic id referenced by its toggle.',
);

const toggleCommentsSource = source.match(
  /async function toggleComments\(item, article, control\) \{[\s\S]*?(?=\r?\n\r?\n  function renderCommentsSection)/,
)?.[0];
assert.ok(toggleCommentsSource, 'toggleComments must remain available for behavioral regression coverage.');

let currentCommentsRegion = null;
const commentControlAttributes = new Map();
const commentControl = {
  setAttribute(name, value) {
    commentControlAttributes.set(name, String(value));
  },
};
const commentArticle = {
  append(node) {
    currentCommentsRegion = node;
  },
  querySelector() {
    return currentCommentsRegion;
  },
};
const commentContext = vm.createContext({
  state: {
    commentsOpen: new Set(),
    comments: new Map(),
  },
  query: async () => [],
  renderCommentsSection: () => ({
    remove() {
      currentCommentsRegion = null;
    },
    replaceWith(node) {
      currentCommentsRegion = node;
    },
  }),
  handleError: () => {},
});
vm.runInContext(toggleCommentsSource, commentContext);
const toggleComments = vm.runInContext('toggleComments', commentContext);
const commentItem = { entryId: 'entry-regression' };

await toggleComments(commentItem, commentArticle, commentControl);
assert.equal(commentControlAttributes.get('aria-expanded'), 'true');
assert.equal(commentContext.state.commentsOpen.has(commentItem.entryId), true);
assert.ok(currentCommentsRegion, 'Opening comments must render the controlled region.');

await toggleComments(commentItem, commentArticle, commentControl);
assert.equal(commentControlAttributes.get('aria-expanded'), 'false');
assert.equal(commentContext.state.commentsOpen.has(commentItem.entryId), false);
assert.equal(currentCommentsRegion, null, 'Closing comments must remove the controlled region.');

const arrangeVisibleCommentsSource = source.match(
  /function arrangeVisibleComments\(comments\) \{[\s\S]*?(?=\r?\n\r?\n  function renderComment)/,
)?.[0];
assert.ok(arrangeVisibleCommentsSource, 'Comment ordering must remain available for behavioral regression coverage.');
const arrangeContext = vm.createContext({ Set });
vm.runInContext(arrangeVisibleCommentsSource, arrangeContext);
const arrangeVisibleComments = vm.runInContext('arrangeVisibleComments', arrangeContext);
const arrangedOrphanComments = arrangeVisibleComments([
  { commentId: 'reply-visible', parentCommentId: 'parent-unavailable' },
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(arrangedOrphanComments)),
  [{ comment: { commentId: 'reply-visible', parentCommentId: 'parent-unavailable' }, isReply: false }],
  'A visible reply whose parent is unavailable must render as a readable top-level comment.',
);

const syncSource = source.match(
  /function syncViewButtons\(\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(syncSource, 'syncViewButtons must remain available.');

const controls = ['home', 'my-posts', 'profile'].map((view) => ({
  dataset: { quorumView: view },
  classes: new Set(),
  attributes: new Map(),
  classList: {
    toggle(name, active) {
      if (active) this.owner.classes.add(name);
      else this.owner.classes.delete(name);
    },
    owner: null,
  },
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  },
  removeAttribute(name) {
    this.attributes.delete(name);
  },
}));
for (const control of controls) control.classList.owner = control;

const context = vm.createContext({
  state: { view: 'my-posts' },
  $$: () => controls,
});
vm.runInContext(`${syncSource}\nsyncViewButtons();`, context);

assert.deepEqual(
  controls.filter((control) => control.classes.has('is-active')).map((control) => control.dataset.quorumView),
  ['my-posts'],
  'Only My Posts may be visually active on the My Posts route.',
);
assert.equal(controls[1].attributes.get('aria-current'), 'page');
assert.equal(controls[2].attributes.has('aria-current'), false);

assert.match(
  styles,
  /#page-community \.quorum-affirm-count \{[\s\S]*?min-width:\s*24px;[\s\S]*?min-height:\s*24px;/,
  'The affirmation-count control must retain the WCAG 2.2 minimum target size.',
);
assert.match(
  styles,
  /#page-community \.quorum-affirm-count:focus-visible \{[\s\S]*?outline:/,
  'The affirmation-count control must expose a visible keyboard focus indicator.',
);
assert.match(
  styles,
  /#page-community \.lex-title-row \{[\s\S]*?position:\s*absolute;[\s\S]*?clip-path:\s*inset\(50%\);/,
  'The Home title must remain available to assistive technology without changing the visual design.',
);
assert.doesNotMatch(
  styles,
  /#page-community \.lex-page-head \.eyebrow,\s*#page-community \.lex-title-row\s*\{\s*display:\s*none;/,
  'The Home title must not be removed from the accessibility tree.',
);
assert.match(
  styles,
  /#page-community \.lex-status \{\s*color:\s*#5b687b;/,
  'Home feed-status text must retain its accessible contrast.',
);
assert.match(
  styles,
  /#page-community \.quorum-chip \{[\s\S]*?color:\s*#55657a;[\s\S]*?background:\s*#f4f5f7;/,
  'Home metadata chips must retain their accessible contrast pair.',
);
assert.match(
  styles,
  /\.quorum-practice-card \.lex-kicker \{\s*color:\s*#f0cf76;/,
  'The Mock Bar kicker must remain readable on its dark card.',
);
assert.ok(contrastRatio('#5b687b', '#f7f7f5') >= 4.5);
assert.ok(contrastRatio('#55657a', '#f4f5f7') >= 4.5);
assert.ok(contrastRatio('#59697f', '#ffffff') >= 4.5);
assert.ok(contrastRatio('#f0cf76', '#071a33') >= 4.5);

console.log('Home navigation and focused accessibility regressions passed.');
