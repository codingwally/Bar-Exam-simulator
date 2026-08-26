import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [html, css, js] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin-observatory.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
]);

assert.match(html, /<details class="nav-more" open>/);
assert.match(html, /Security &amp; Activity Log/);
assert.match(html, /Website Settings/);
assert.match(html, /Return to website/);
assert.match(html, /id="download-current-section"[^>]+disabled/);
assert.doesNotMatch(html, /id="download-current-section"[\s\S]{0,160}ph-caret-down/);
assert.match(html, /admin-observatory\.css\?v=public-admin-reliability-20260827-2/);

assert.match(js, /renderEpoch:\s*0/);
assert.match(js, /new AbortController\(\)/);
assert.match(js, /state\.renderController\?\.abort\(\)/);
assert.match(js, /function assertRenderActive\(context\)/);
assert.match(js, /async function readApi\(path, body, context\)/);
assert.match(js, /const payload = await api\(path, body, \{ signal: context\.signal \}\)/);
assert.match(js, /function stageRenderCommit\(context, commit\)/);
assert.match(js, /function mountObservatoryCharts\(section, report, context, renderedSurface\)/);
assert.match(js, /isRenderActive\(context\?\.epoch, context\?\.section, context\?\.signal\)[\s\S]{0,180}view\?\.firstElementChild !== renderedSurface/);
assert.match(js, /mountObservatoryCharts\(section, report, context, renderedSurface\)/);
assert.match(js, /assertRenderActive\(context\);\s*applyRenderCommits\(context\);\s*view\.innerHTML/);
assert.match(js, /isRenderActive\(epoch, section, controller\.signal\)/);
assert.match(js, /No data was substituted/);
assert.match(js, /data-retry-section/);
assert.match(js, /state\.sectionReady = true/);
assert.match(js, /Exporting…/);
assert.match(js, /Downloaded/);
assert.match(js, /reportWindowKey/);
assert.match(js, /answerHistoryKey/);
assert.match(js, /quorumPostsKey/);
assert.match(js, /requiresDestructiveConfirmation/);
assert.match(js, /nextRank < previousRank/);
assert.doesNotMatch(js, /if \(action === 'role_change'\) return true/);
assert.match(js, /mount\.classList\.add\('row-actions', 'row-actions-visible'\)/);
assert.doesNotMatch(js, /menu\.className = 'action-menu'/);
assert.doesNotMatch(js, /loadAllPhase4Operational\('payments'\)\.catch\(\(\) => \(\{ items: \[\] \}\)\)/);
assert.doesNotMatch(js, /loadAllUserDirectory\(\)\.catch\(\(\) => \(\{ items: \[\]/);
assert.doesNotMatch(js, /label:\s*'First answer'/);
assert.doesNotMatch(js, /Number\((?:data|page)\.total \|\|/, 'Verified zero totals must not fall back to stale values.');

const extractNamedFunction = (source, name) => {
  const signature = `async function ${name}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${name} must exist.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}.`);
};

const initialNavigationSource = extractNamedFunction(js, 'navigateInitialSection');

async function exerciseInitialNavigationRace(replacementSection) {
  let resolveInitial;
  const initialResult = new Promise((resolve) => { resolveInitial = resolve; });
  const calls = [];
  const toasts = [];
  const state = { renderEpoch: 0, section: 'executive' };
  let locationSection = 'executive';
  const context = vm.createContext({
    state,
    sectionFromLocation: () => locationSection,
    sectionAllowed: () => true,
    navigateSection: async (section, historyMode = 'push') => {
      state.renderEpoch += 1;
      state.section = section;
      locationSection = section;
      calls.push([section, historyMode]);
      if (calls.length === 1) return initialResult;
      return true;
    },
    toast: (message) => toasts.push(message),
  });
  vm.runInContext(initialNavigationSource, context);
  const startup = vm.runInContext('navigateInitialSection()', context);
  await context.navigateSection(replacementSection);
  resolveInitial(false);
  await startup;
  return { calls, toasts };
}

for (const replacementSection of ['examination_room_v1', 'executive']) {
  const result = await exerciseInitialNavigationRace(replacementSection);
  assert.deepEqual(
    result.calls,
    [['executive', 'replace'], [replacementSection, 'push']],
    `A newer ${replacementSection} navigation must not be replaced by the stale Payments fallback.`,
  );
  assert.deepEqual(result.toasts, []);
}

{
  const calls = [];
  const toasts = [];
  const state = { renderEpoch: 0, section: 'executive' };
  let locationSection = 'executive';
  const context = vm.createContext({
    state,
    sectionFromLocation: () => locationSection,
    sectionAllowed: () => true,
    navigateSection: async (section, historyMode = 'push') => {
      state.renderEpoch += 1;
      state.section = section;
      locationSection = section;
      calls.push([section, historyMode]);
      return section !== 'executive';
    },
    toast: (message) => toasts.push(message),
  });
  vm.runInContext(initialNavigationSource, context);
  await vm.runInContext('navigateInitialSection()', context);
  assert.deepEqual(calls, [['executive', 'replace'], ['payments', 'replace']]);
  assert.deepEqual(toasts, ['Overview is temporarily unavailable. Payments remains available.']);
}

const functionSource = (name) => {
  const start = js.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist.`);
  const next = js.indexOf('\n  async function ', start + 20);
  return js.slice(start, next === -1 ? js.length : next);
};

for (const loader of [
  'loadReport', 'loadOperational', 'loadUserDirectory', 'loadRecentSignIns',
  'loadRecentUserActivity', 'loadPhase4Operational', 'loadAllUserDirectory',
  'loadAllPhase4Operational', 'loadRecentUserActivityWindow', 'loadForumModeration',
  'loadLiveActivity', 'loadAnswerHistory', 'loadQuorumPosts',
]) {
  const source = functionSource(loader);
  assert.match(source, /context\s*=\s*currentRenderContext\(\)/, `${loader} must capture the active render context.`);
  assert.match(source, /assertRenderActive\(context\)/, `${loader} must reject a stale epoch.`);
  assert.doesNotMatch(source, /\bapi\('\/admin/, `${loader} must not bypass the abort-aware read wrapper.`);
}

for (const match of js.matchAll(/state\.operational\.set\(/g)) {
  const beforeCommit = js.slice(Math.max(0, match.index - 180), match.index);
  assert.match(beforeCommit, /assertRenderActive\(context\)/, 'Every cache commit must re-check the active render immediately before mutation.');
}
const reportCommit = js.indexOf('state.report = payload.report');
assert.notEqual(reportCommit, -1);
assert.match(js.slice(Math.max(0, reportCommit - 180), reportCommit), /assertRenderActive\(context\)/,
  'The report cache must re-check the active render immediately before mutation.');

for (const renderer of [
  'renderExecutive', 'renderRealtime', 'renderBusinessRevenue', 'renderBusinessComparisons',
  'renderRecentUsers', 'renderUsers', 'renderAnswerExports', 'renderPaidSubscribers',
  'renderSubscriptions', 'renderQuorumModeration',
]) {
  assert.match(functionSource(renderer), /stageRenderCommit\(context/, `${renderer} must stage shared state until its epoch wins.`);
}

const refreshHandler = js.slice(js.indexOf("$('#refresh-dashboard')?.addEventListener"), js.indexOf("$('#download-current-section')?.addEventListener"));
assert.doesNotMatch(refreshHandler, /finally/, 'An older refresh must not clear a newer render busy state.');

assert.match(css, /\.metric-definition[\s\S]*display:\s*block/);
assert.match(css, /\.admin-table-actions[\s\S]*position:\s*sticky/);
assert.match(css, /@media \(max-width: 920px\)[\s\S]*#reporting-range[\s\S]*display:\s*grid/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.topbar-tools \.topbar-download[\s\S]*display:\s*inline-flex/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*#reporting-range[\s\S]*grid-row:\s*1/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.topbar-tools \.refresh-button[\s\S]*grid-row:\s*2/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.topbar-tools \.topbar-download[\s\S]*grid-row:\s*2/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.topbar-tools \.freshness[\s\S]*grid-row:\s*3/);
assert.match(css, /font-size:\s*max\(0\.875rem, 14px\)/);
assert.match(css, /background:\s*#050b12/);
const reliabilityCss = css.slice(css.indexOf('Release 1 admin reliability'));
assert.match(reliabilityCss, /@media \(max-width: 820px\)[\s\S]*\.table-wrap tr,[\s\S]*background:\s*#08131d/);
assert.match(reliabilityCss, /\.action-context div,[\s\S]*background:\s*#0b151f/);
assert.doesNotMatch(reliabilityCss, /background:\s*(?:white|#fff(?:fff)?)/i, 'Release overrides must not reintroduce white wrappers at tablet widths.');

console.log('Admin public reliability, truthful state, visible controls, and race-protection contracts passed.');
