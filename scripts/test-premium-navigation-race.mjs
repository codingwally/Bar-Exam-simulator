import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const guardSource = html.match(
  /\/\* PREMIUM NAVIGATION INTENT START \*\/([\s\S]*?)\/\* PREMIUM NAVIGATION INTENT END \*\//,
)?.[1];
const openPremiumSource = html.match(
  /async function openPremiumBarFeels\(options = \{\}\) \{[\s\S]*?\n\}/,
)?.[0];

assert.ok(guardSource, 'Premium navigation intent guard must be present.');
assert.ok(openPremiumSource, 'openPremiumBarFeels must remain available.');
assert.match(
  html,
  /function showPage\(page,[\s\S]*?if \(page !== 'bar-feels'\) cancelPremiumNavigationIntent\(\);/,
  'Changing to another SPA page must cancel a pending Bar Feels navigation.',
);

let resolveAccess;
let openedBarFeels = 0;
let activatedBarFeels = 0;
let restoredBarFeels = 0;
let unlimitedChecks = 0;
const accessPromise = new Promise((resolve) => {
  resolveAccess = resolve;
});
const context = vm.createContext({
  document: { activeElement: null },
  window: {
    DueDiligencePhase4: {
      ensureUnlimitedFeatureAccess: async (routeHash, options = {}) => {
        assert.equal(routeHash, '#bar-feels');
        unlimitedChecks += 1;
        await accessPromise;
        return options.isCurrent?.() !== false;
      },
    },
    DueDiligenceExaminations: {
      openBarFeels: () => {
        openedBarFeels += 1;
      },
      restoreRoute: async (track) => {
        assert.equal(track, 'bar_feels');
        restoredBarFeels += 1;
        return { status: 'restored' };
      },
    },
  },
  activatePrimaryMenuItem: () => {
    activatedBarFeels += 1;
  },
  toast: () => {},
});

vm.runInContext(
  `${guardSource}\n${openPremiumSource}\nthis.openPremiumBarFeelsForTest = openPremiumBarFeels;\n`
    + 'this.cancelPremiumNavigationIntentForTest = cancelPremiumNavigationIntent;',
  context,
);

const pendingNavigation = context.openPremiumBarFeelsForTest();
context.cancelPremiumNavigationIntentForTest();
resolveAccess({
  role: 'student',
  subscription: { planCode: 'premium', status: 'active' },
  subscriptionState: { examinationBeta: { active: false } },
});
await pendingNavigation;

assert.equal(
  openedBarFeels,
  0,
  'A stale Premium entitlement response must not reopen Bar Feels after the user navigates away.',
);
assert.equal(activatedBarFeels, 0);
assert.equal(unlimitedChecks, 1);

const restoredNavigation = context.openPremiumBarFeelsForTest({
  restoreActive: true,
  isCurrent: () => true,
});
await restoredNavigation;
assert.equal(restoredBarFeels, 1, 'Premium access must be verified before restoring Bar Feels.');
assert.equal(openedBarFeels, 0, 'A restored Bar Feels attempt must not be replaced by the catalog.');
assert.equal(activatedBarFeels, 1);
assert.equal(unlimitedChecks, 2);

let resolveCatalog;
let signalCatalogStarted;
const catalogStarted = new Promise((resolve) => { signalCatalogStarted = resolve; });
context.window.DueDiligenceExaminations.openBarFeels = () => {
  openedBarFeels += 1;
  signalCatalogStarted();
  return new Promise((resolve) => { resolveCatalog = resolve; });
};
const activationCountBeforeStaleCatalog = activatedBarFeels;
const staleCatalogNavigation = context.openPremiumBarFeelsForTest();
await catalogStarted;
context.cancelPremiumNavigationIntentForTest();
resolveCatalog(true);
const staleCatalogOutcome = await staleCatalogNavigation;
assert.equal(staleCatalogOutcome?.status, 'stale');
assert.equal(
  activatedBarFeels,
  activationCountBeforeStaleCatalog,
  'A stale Bar Feels catalog response must not activate the menu or look successful.',
);

console.log('Premium navigation race regression passed.');
