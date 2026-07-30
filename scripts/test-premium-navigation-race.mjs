import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const guardSource = html.match(
  /\/\* PREMIUM NAVIGATION INTENT START \*\/([\s\S]*?)\/\* PREMIUM NAVIGATION INTENT END \*\//,
)?.[1];
const openPremiumSource = html.match(
  /async function openPremiumBarFeels\(\) \{[\s\S]*?\n\}/,
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
let openedPricing = 0;
let activatedBarFeels = 0;
const accessPromise = new Promise((resolve) => {
  resolveAccess = resolve;
});
const context = vm.createContext({
  window: {
    DueDiligencePhase4: {
      requireAuthentication: () => true,
      refreshAccess: () => accessPromise,
      openView: () => {
        openedPricing += 1;
      },
    },
    DueDiligenceExaminations: {
      openBarFeels: () => {
        openedBarFeels += 1;
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
assert.equal(openedPricing, 0);

console.log('Premium navigation race regression passed.');
