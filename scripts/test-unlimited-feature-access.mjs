import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [html, phase2, phase4, loader, landing, forecast, serviceWorker] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/phase2-experience.js', root), 'utf8'),
  readFile(new URL('assets/phase4-experience.js', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/bar-forecast.js', root), 'utf8'),
  readFile(new URL('service-worker.js', root), 'utf8'),
]);

function namedFunction(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`, 'u').exec(source);
  assert.ok(match, `Missing function ${name}.`);
  const openingBrace = source.indexOf('{', source.indexOf(')', match.index));
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  throw new Error(`Unbalanced function ${name}.`);
}

const predicateContext = vm.createContext({ state: { access: null } });
for (const name of [
  'legalRequired',
  'setupExempt',
  'reauthenticationRequired',
  'paidSubscriptionExpired',
  'profileRequired',
  'setupRequired',
  'canUseUnlimitedFeature',
]) vm.runInContext(namedFunction(phase4, name), predicateContext);

for (const access of [
  { allowed: true, unlimited: true, basis: 'paid_subscription', profileCompleted: true },
  { allowed: true, unlimited: true, basis: 'provisional_payment', profileCompleted: true },
  { allowed: true, unlimited: true, basis: 'founding_beta', freeBeta: { active: true } },
  { allowed: true, unlimited: true, role: 'founder_admin' },
]) {
  predicateContext.access = access;
  assert.equal(vm.runInContext('canUseUnlimitedFeature(access)', predicateContext), true);
}

for (const access of [
  { allowed: true, unlimited: false, basis: 'introductory_tokens', profileCompleted: true },
  { allowed: false, unlimited: true, basis: 'paid_subscription', profileCompleted: true },
  { allowed: true, unlimited: true, basis: 'paid_subscription', termsRequired: true },
  { allowed: true, unlimited: true, basis: 'paid_subscription', reauthenticationRequired: true },
  {
    allowed: true,
    unlimited: true,
    basis: 'profile_required',
    commercialLaunchEnabled: true,
    profileCompleted: false,
  },
]) {
  predicateContext.access = access;
  assert.equal(vm.runInContext('canUseUnlimitedFeature(access)', predicateContext), false);
}

function featureLoaderHarness(access, unlimitedResult) {
  const appended = [];
  const unlimitedChecks = [];
  const pageCalls = [];

  function assetElement(tagName) {
    const listeners = new Map();
    return {
      tagName,
      dataset: {},
      addEventListener(type, callback) { listeners.set(type, callback); },
      dispatch(type) { listeners.get(type)?.(); },
    };
  }

  const document = {
    activeElement: null,
    readyState: 'loading',
    styleSheets: [],
    createElement: assetElement,
    head: {
      append(element) {
        appended.push(element.href || element.src || element.tagName);
        element.dispatch('load');
      },
    },
    body: {
      append(element) {
        appended.push(element.href || element.src || element.tagName);
        element.dispatch('load');
      },
    },
  };
  const location = { href: 'https://duediligence.test/#quorum' };
  const window = {
    document,
    location,
    addEventListener() {},
    setTimeout() { return 0; },
    DueDiligencePhase4: {
      getAccess: () => access,
      ensureProtectedAccess: async () => true,
      ensureUnlimitedFeatureAccess: async (routeHash, options) => {
        unlimitedChecks.push({ routeHash, options });
        return unlimitedResult;
      },
    },
    showPage(...args) {
      pageCalls.push(args);
      return true;
    },
    toast() {},
  };
  vm.runInNewContext(loader, {
    window,
    document,
    location,
    URL,
    console,
    Promise,
  }, { filename: 'assets/feature-loader.js' });
  return { appended, unlimitedChecks, pageCalls, window };
}

{
  const eligible = featureLoaderHarness({
    allowed: true,
    unlimited: true,
    basis: 'provisional_payment',
    profileCompleted: true,
  }, true);
  assert.equal(await eligible.window.DueDiligenceFeatureLoader.loadForFeature('bar-feels'), true);
  assert.equal(eligible.unlimitedChecks.length, 0);
  assert.ok(eligible.appended.some((asset) => String(asset).includes('examinations.js')));
}

{
  const unpaid = featureLoaderHarness({
    allowed: true,
    unlimited: false,
    basis: 'introductory_tokens',
    profileCompleted: true,
  }, false);
  assert.equal(await unpaid.window.DueDiligenceFeatureLoader.loadForFeature('bar-feels'), false);
  assert.equal(unpaid.unlimitedChecks.length, 1);
  assert.equal(unpaid.unlimitedChecks[0].routeHash, '#bar-feels');
  assert.equal(unpaid.unlimitedChecks[0].options.featureId, 'bar-feels');
  assert.equal(unpaid.appended.length, 0, 'Bar Simulation assets must remain unloaded.');

  assert.equal(unpaid.window.showPage('bar-feels', null), false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(unpaid.pageCalls.length, 0, 'Direct page routing must not bypass the gate.');
}

assert.match(phase4, /async function ensureUnlimitedFeatureAccess[\s\S]*canUseUnlimitedFeature\(access\)[\s\S]*openUnlimitedFeatureGate/);
assert.match(phase4, /reason: 'unlimited_feature'[\s\S]*featureLabel:[\s\S]*targetHash:/);
assert.match(phase2, /'Subscribe to access this feature'/);
assert.match(phase2, /function returnToUnlimitedFeature[\s\S]*context\.targetHash[\s\S]*dispatchEvent\(new Event\('popstate'\)\)/);
assert.match(phase2, /unlimitedFeatureAction && unlimitedFeatureAccessActive\(access\)[\s\S]*returnToUnlimitedFeature\('access-active'\)/);
assert.match(phase2, /unlimitedFeatureReady \? 'Open feature' : 'Back'/);
assert.doesNotMatch(
  phase2.match(/function unlimitedFeatureActionContext[\s\S]*?function pricingContent/)?.[0] || '',
  /commercial release/i,
);
assert.match(landing, /\['retainer', 'quorum', 'bar-feels'\]/);
assert.match(
  landing,
  /feature === 'bar-forecast'[\s\S]*ensureUnlimitedFeatureAccess\?\.\(returnHash,[\s\S]*featureId: 'bar-forecast'[\s\S]*if \(allowed !== true\) return false;[\s\S]*loadFeature\(feature\)/,
);
assert.match(indexBarFeels(html), /ensureUnlimitedFeatureAccess\('#bar-feels'/);
assert.match(html, /if \(page === 'bar-feels'\)[\s\S]*Do not reveal the page before that asynchronous gate resolves/);
assert.match(forecast, /openUnlimitedFeatureGate\(ROUTE,[\s\S]*featureId: 'bar-forecast'/);
assert.doesNotMatch(namedFunction(forecast, 'routeToPlansAndPricing'), /toast/);
assert.match(serviceWorker, /duediligence-shell-unlimited-access-20260902-1/);
for (const asset of [
  'phase2-experience.js',
  'phase4-experience.js',
  'feature-loader.js',
  'private-beta-landing.js',
  'bar-forecast.js',
]) assert.match(serviceWorker, new RegExp(`${asset.replace('.', '\\.') }[^'\\n]*unlimited=feature-access-20260902-1`));

function indexBarFeels(source) {
  return namedFunction(source, 'openPremiumBarFeels');
}

console.log('Unlimited Forecast and Bar Simulation access flow passed.');
