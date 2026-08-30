import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const [html, adminSource, editorSource, editorCss, rendererSource] = await Promise.all([
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/pricing-editor.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/pricing-editor.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/pricing-renderer.js', import.meta.url), 'utf8'),
]);

assert.match(html, /data-section="pricing"[^>]*>[\s\S]{0,120}Plans &amp; Pricing/);
assert.ok(
  html.indexOf('data-section="pricing"') < html.indexOf('data-section="subscriptions"'),
  'Plans & Pricing should be the first Commercial tool.',
);
assert.ok(
  html.indexOf('../assets/pricing-renderer.css') < html.indexOf('pricing-editor.css'),
  'The shared preview styles must load before Admin editor styles.',
);
assert.ok(
  html.indexOf('../assets/pricing-renderer.js') < html.indexOf('pricing-editor.js')
    && html.indexOf('pricing-editor.js') < html.indexOf('<script src="admin.js?'),
  'The safe renderer and editor must load before the Admin orchestrator.',
);

assert.match(adminSource, /pricing:\s*'Plans & Pricing'/);
assert.match(adminSource, /const founderOnly = \['pricing', 'forum'/);
assert.match(adminSource, /\['founder_admin', 'super_admin'\]\.includes/);
assert.match(adminSource, /readApi\('\/admin\/pricing\/query',[\s\S]{0,100}operation:\s*'editor_snapshot'/);
assert.match(adminSource, /pricingRequest\('\/admin\/pricing\/action', body\)/);
assert.match(adminSource, /pricingRequest\('\/admin\/pricing\/assets\/upload', formData\)/);
assert.match(adminSource, /pricingRequest\('\/admin\/pricing\/asset', \{ assetId \}, \{ responseType: 'blob' \}\)/);
assert.match(adminSource, /const isMultipart = body instanceof FormData/);
assert.match(adminSource, /isMultipart \? \{\} : \{ 'Content-Type': 'application\/json' \}/);
assert.match(adminSource, /state\.renderController\?\.abort\(\);[\s\S]{0,120}DueDiligencePricingEditor\?\.destroy/);
assert.match(adminSource, /isActive: \(\) => isRenderActive\(context\.epoch, context\.section, context\.signal\)/);
assert.match(adminSource, /DueDiligencePricingEditor\?\.confirmLeave/);

for (const fieldName of [
  'eyebrow', 'title', 'intro', 'notice', 'finePrint',
  'planCode', 'pricePesos', 'durationDays', 'displayStartsAt', 'displayEndsAt',
  'checkoutStartsAt', 'checkoutEndsAt', 'checkoutEnabled', 'channelCode',
  'qrAmountMode', 'accountDetails', 'question', 'answer',
]) {
  assert.match(editorSource, new RegExp(fieldName), `Editor field ${fieldName} must be present.`);
}
for (const operation of ['save_draft', 'schedule', 'publish', 'cancel_schedule', 'rollback']) {
  assert.match(editorSource, new RegExp(`['"]${operation}['"]`), `Editor operation ${operation} must be present.`);
}
for (const optimisticField of [
  'expectedDraftVersion', 'expectedLiveRevisionId', 'draftRevisionId', 'sourceRevisionId',
]) {
  assert.match(editorSource, new RegExp(optimisticField));
}
assert.match(editorSource, /addEventListener\('beforeunload'/);
assert.match(editorSource, /VERSION_CONFLICT\|STALE_/);
assert.match(editorSource, /Only real PNG and JPEG image files are accepted/);
assert.match(editorSource, /\[137, 80, 78, 71, 13, 10, 26, 10\]/);
assert.match(editorSource, /bytes\[0\] === 255 && bytes\[1\] === 216 && bytes\[2\] === 255/);
assert.match(editorSource, /QR_MAX_BYTES = 5 \* 1024 \* 1024/);
assert.match(editorSource, /QR_MIN_EDGE = 100/);
assert.match(editorSource, /dimensions\.width < QR_MIN_EDGE \|\| dimensions\.height < QR_MIN_EDGE/);
assert.match(editorSource, /plain text without HTML, scripts, or data URLs/);
assert.match(
  editorSource,
  /method\.qrAsset = assetFromPayload\(payload\);[\s\S]{0,160}reconfirmExactQrAmount\(controller, method\)/,
  'Uploading a replacement exact QR must capture the plan price currently being reviewed.',
);
assert.doesNotMatch(editorSource, /contenteditable/i);
assert.doesNotMatch(editorSource, /dragstart|draggable/i);

const setBusySource = editorSource.slice(
  editorSource.indexOf('function setBusy('),
  editorSource.indexOf('function setMessage('),
);
assert.ok(setBusySource.startsWith('function setBusy('), 'Busy-state helper must be present.');
const busyStatus = { textContent: '' };
const busySandbox = {
  controller: {
    root: {
      toggleAttribute() {},
      querySelectorAll() { return []; },
      querySelector() { return busyStatus; },
    },
    message: { text: 'Draft saved. Nothing was published.' },
    dirty: false,
  },
  busyStatus,
};
runInNewContext(`${setBusySource}; setBusy(controller, true, 'Saving draft…');`, busySandbox);
assert.equal(busyStatus.textContent, 'Saving draft…');
runInNewContext(`${setBusySource}; setBusy(controller, false);`, busySandbox);
assert.equal(
  busyStatus.textContent,
  'Draft saved. Nothing was published.',
  'Completing an async action must restore its success or error message instead of leaving “Working…”.',
);

const restoreFocusSource = editorSource.slice(
  editorSource.indexOf('function restoreOperationFocus('),
  editorSource.indexOf('function closeOperation('),
);
assert.ok(restoreFocusSource.startsWith('function restoreOperationFocus('), 'Dialog focus-restoration helper must be present.');
let restoredFocusCount = 0;
const restoreFocusSandbox = {
  controller: {
    root: {
      querySelectorAll() {
        return [{
          dataset: { operation: 'rollback', sourceRevisionId: 'revision-one' },
          focus() { restoredFocusCount += 1; },
        }, {
          dataset: { operation: 'rollback', sourceRevisionId: 'revision-two' },
          focus() { restoredFocusCount += 10; },
        }];
      },
    },
  },
  operation: { type: 'rollback', sourceRevisionId: 'revision-one' },
};
runInNewContext(`${restoreFocusSource}; restoreOperationFocus(controller, operation);`, restoreFocusSandbox);
assert.equal(restoredFocusCount, 1, 'Closing a dialog must restore focus to the exact publication action that opened it.');

const toManilaInputSource = editorSource.match(
  /function toManilaInput\(value\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(toManilaInputSource, 'The Manila datetime form converter must be present.');
const dateInputSandbox = {};
runInNewContext(
  `${toManilaInputSource}; this.results = [
    toManilaInput(null),
    toManilaInput(''),
    toManilaInput('2026-09-02T00:00:00+08:00'),
  ];`,
  dateInputSandbox,
);
assert.deepEqual(
  [...dateInputSandbox.results],
  ['', '', '2026-09-02T00:00'],
  'Optional dates must stay blank instead of rendering the Unix epoch.',
);

assert.match(editorCss, /grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(360px, 0\.85fr\)/);
assert.match(editorCss, /data-preview-size="mobile"/);
assert.match(editorCss, /max-width:\s*390px/);
assert.match(editorCss, /pricing-preview-frame[\s\S]{0,220}background:\s*#f8f4eb/);
assert.match(editorCss, /pricing-payment-preview[\s\S]{0,180}color:\s*#202733;[\s\S]{0,80}background:\s*#f8f4eb/);
assert.match(editorCss, /pricing-payment-preview h3[^{]*\{[^}]*color:\s*#07182f/);
assert.doesNotMatch(editorCss, /pricing-preview-frame[^}]*background:\s*#050b12/);
assert.match(editorCss, /min-height:\s*44px/);
assert.match(editorCss, /@media \(max-width: 560px\)/);

class FakeElement {
  constructor() {
    this.innerHTML = '';
  }

  querySelectorAll() {
    return [];
  }
}

const rendererSandbox = {
  window: {},
  Element: FakeElement,
};
runInNewContext(rendererSource, rendererSandbox);
const renderer = rendererSandbox.window.DueDiligencePricingRenderer;
assert.equal(typeof renderer.normalizeConfig, 'function');
assert.equal(typeof renderer.render, 'function');

const capped = renderer.normalizeConfig({
  plans: Array.from({ length: 25 }, (_, index) => ({
    planCode: `plan_${index}`,
    name: `Plan ${index}`,
  })),
  paymentMethods: Array.from({ length: 45 }, (_, index) => ({
    channelCode: `channel_${index}`,
    label: `Channel ${index}`,
  })),
  faqs: Array.from({ length: 45 }, (_, index) => ({
    id: `faq_${index}`,
    question: `Question ${index}`,
    answer: `Answer ${index}`,
  })),
});
assert.equal(capped.plans.length, 20);
assert.equal(capped.paymentMethods.length, 40);
assert.equal(capped.faqs.length, 40);

const normalized = renderer.normalizeConfig({
  page: { title: '<img src=x onerror=alert(1)>', unknown: 'discard me' },
  plans: [{
    versionId: 'plan-version-id',
    planCode: 'thirty_day_access',
    name: '30-Day Access',
    priceCentavos: 19_900,
    durationDays: 30,
    visible: true,
    checkoutEnabled: true,
    displayStartsAt: '2026-09-01T00:00:00+08:00',
    checkoutStartsAt: '2026-09-02T00:00:00+08:00',
    checkoutOpen: false,
    displayOpen: true,
    entitlementMode: 'rolling_days',
    unknown: 'discard me',
  }],
  paymentMethods: [{
    versionId: 'payment-version-id',
    channelCode: 'bpi_instapay',
    qrUrl: '/pricing/assets/11111111-1111-4111-8111-111111111111',
    qrAmountCentavos: 19_900,
    qrAmountMode: 'exact',
    visible: false,
  }],
});
assert.equal(normalized.plans[0].priceCentavos, 19_900);
assert.equal(normalized.plans[0].versionId, 'plan-version-id');
assert.equal(normalized.plans[0].checkoutOpen, false);
assert.equal(normalized.plans[0].displayOpen, true);
assert.equal(normalized.plans[0].entitlementMode, 'rolling_days');
assert.equal(normalized.paymentMethods[0].qrUrl, '/pricing/assets/11111111-1111-4111-8111-111111111111');
assert.equal(normalized.paymentMethods[0].qrAmountCentavos, 19_900);
assert.equal(normalized.paymentMethods[0].visible, false);
assert.equal('unknown' in normalized.plans[0], false);
assert.equal('unknown' in normalized.page, false);

const compatibleGenericMethod = {
  channelCode: 'generic_instapay',
  planCode: null,
  label: 'Generic InstaPay',
  qrUrl: '/assets/payments/bpi-instapay-149.png',
  qrAmountMode: 'generic',
  qrAmountCentavos: null,
  enabled: true,
  visible: true,
};

const previewHost = new FakeElement();
renderer.render(previewHost, normalized, {
  mode: 'preview',
  serverNow: '2026-08-30T12:00:00+08:00',
});
assert.match(previewHost.innerHTML, /30-Day Access/);
assert.match(previewHost.innerHTML, /Opens Sep 2, 2026/);
assert.doesNotMatch(previewHost.innerHTML, /<img src=x onerror=alert\(1\)>/);
assert.match(previewHost.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);

const publicBeforeDisplayHost = new FakeElement();
const publicBeforeDisplayConfig = JSON.parse(JSON.stringify(normalized));
publicBeforeDisplayConfig.plans[0].displayOpen = null;
renderer.render(publicBeforeDisplayHost, publicBeforeDisplayConfig, {
  mode: 'public',
  serverNow: '2026-08-30T12:00:00+08:00',
});
assert.doesNotMatch(publicBeforeDisplayHost.innerHTML, /30-Day Access/);
assert.match(publicBeforeDisplayHost.innerHTML, /No plans are currently available/);

const openEndedHost = new FakeElement();
renderer.render(openEndedHost, {
  page: { title: 'Open plan' },
  plans: [{
    planCode: 'open_plan',
    name: 'Open Plan',
    priceCentavos: 10_000,
    durationDays: 30,
    visible: true,
    checkoutEnabled: true,
  }],
  paymentMethods: [compatibleGenericMethod],
}, { mode: 'preview', serverNow: '2026-09-10T00:00:00+08:00' });
assert.match(openEndedHost.innerHTML, />Choose plan<\/button>/, 'Missing end dates must not close a plan.');
assert.doesNotMatch(openEndedHost.innerHTML, /Enrollment closed/);

const fixedHost = new FakeElement();
renderer.render(fixedHost, {
  plans: [{
    planCode: 'legacy_access',
    name: 'Legacy Access',
    priceCentavos: 14_900,
    durationDays: 30,
    entitlementMode: 'fixed_end',
    fixedEntitlementEndsAt: '2026-10-01T23:59:59+08:00',
    visible: true,
    checkoutEnabled: true,
  }],
  paymentMethods: [compatibleGenericMethod],
}, { mode: 'preview', serverNow: '2026-08-30T00:00:00+08:00' });
assert.match(fixedHost.innerHTML, /through Oct 1, 2026/);
assert.doesNotMatch(fixedHost.innerHTML, /for 30 days/);

const checkoutPlan = {
  planCode: 'checkout_plan',
  name: 'Checkout Plan',
  priceCentavos: 19_900,
  durationDays: 30,
  visible: true,
  checkoutEnabled: true,
};
const matchingExactMethod = {
  channelCode: 'checkout_qr',
  planCode: 'checkout_plan',
  label: 'Checkout QR',
  qrUrl: '/assets/payments/bpi-instapay-149.png',
  qrAmountMode: 'exact',
  qrAmountCentavos: 19_900,
  enabled: true,
  visible: true,
};
const renderCheckoutPreview = (paymentMethods) => {
  const host = new FakeElement();
  renderer.render(host, { plans: [checkoutPlan], paymentMethods }, {
    mode: 'preview',
    serverNow: '2026-09-10T00:00:00+08:00',
  });
  return host.innerHTML;
};
assert.match(renderCheckoutPreview([matchingExactMethod]), /data-checkout-state="available"/);
assert.match(renderCheckoutPreview([matchingExactMethod]), />Choose plan<\/button>/);
for (const [label, paymentMethods] of [
  ['missing QR method', []],
  ['QR-less method', [{ ...matchingExactMethod, qrUrl: null }]],
  ['disabled method', [{ ...matchingExactMethod, enabled: false }]],
  ['hidden method', [{ ...matchingExactMethod, visible: false }]],
]) {
  const html = renderCheckoutPreview(paymentMethods);
  assert.match(html, /data-checkout-state="payment_channel_required"/, `${label} must fail closed.`);
  assert.match(html, /disabled>Payment QR required<\/button>/, `${label} must explain why checkout is unavailable.`);
}
const mismatchedAmountPreview = renderCheckoutPreview([{
  ...matchingExactMethod,
  qrAmountCentavos: 14_900,
}]);
assert.match(mismatchedAmountPreview, /data-checkout-state="payment_channel_required"/);
assert.match(mismatchedAmountPreview, /disabled>Update payment QR for this price<\/button>/);
const missingExactAmountPreview = renderCheckoutPreview([{
  ...matchingExactMethod,
  qrAmountCentavos: null,
}]);
assert.match(missingExactAmountPreview, /data-checkout-state="payment_channel_required"/);
assert.match(missingExactAmountPreview, /disabled>Update payment QR for this price<\/button>/);

const editorSandbox = {
  window: {
    addEventListener() {},
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    DueDiligencePricingRenderer: renderer,
  },
};
const testableEditorSource = editorSource.replace(
  '  global.DueDiligencePricingEditor = Object.freeze({',
  '  global.__DueDiligencePricingEditorTest = Object.freeze({ validateConfig, serializeConfig, reconfirmExactQrAmount });\n'
    + '  global.DueDiligencePricingEditor = Object.freeze({',
);
runInNewContext(testableEditorSource, editorSandbox);
const snapshot = editorSandbox.window.DueDiligencePricingEditor.normalizeSnapshot({
  ok: true,
  data: {
    serverNow: '2026-08-30T00:00:00+08:00',
    timezone: 'Asia/Manila',
    draft: { revisionId: 'draft-id', lockVersion: 7, config: normalized },
    live: { revisionId: 'live-id', version: 6, config: normalized },
    scheduled: null,
    history: [],
  },
});
assert.equal(snapshot.expectedDraftVersion, 7);
assert.equal(snapshot.timezone, 'Asia/Manila');
assert.equal(snapshot.draft.revisionId, 'draft-id');

const staleExactQrConfig = {
  page: { title: 'Plans & Pricing' },
  plans: [{
    planCode: 'bar_access_30d',
    name: '30-Day Access',
    priceCentavos: 21_950,
    durationDays: 30,
    entitlementMode: 'rolling_days',
    visible: true,
    checkoutEnabled: true,
  }],
  paymentMethods: [{
    channelCode: 'bpi_exact_199',
    planCode: 'bar_access_30d',
    label: 'BPI exact 199 QR',
    qrUrl: '/assets/payments/bpi-instapay-149.png',
    qrAmountMode: 'exact',
    qrAmountCentavos: 19_900,
    enabled: true,
    visible: true,
  }],
  faqs: [],
};
const staleExactQrController = { config: staleExactQrConfig };
const serializedStaleQr = editorSandbox.window.__DueDiligencePricingEditorTest.serializeConfig(
  staleExactQrController,
);
assert.equal(
  serializedStaleQr.paymentMethods[0].qrAmountCentavos,
  19_900,
  'Editing a plan price must not silently relabel an existing exact-amount QR.',
);
const staleExactQrPreview = new FakeElement();
renderer.render(staleExactQrPreview, serializedStaleQr, {
  mode: 'preview',
  serverNow: '2026-09-10T00:00:00+08:00',
});
assert.match(staleExactQrPreview.innerHTML, /data-checkout-state="payment_channel_required"/);
assert.match(staleExactQrPreview.innerHTML, /disabled>Update payment QR for this price<\/button>/);
editorSandbox.window.__DueDiligencePricingEditorTest.reconfirmExactQrAmount(
  staleExactQrController,
  staleExactQrConfig.paymentMethods[0],
);
assert.equal(
  staleExactQrConfig.paymentMethods[0].qrAmountCentavos,
  21_950,
  'Replacing or explicitly reconfirming an exact QR must capture the current plan price.',
);
const reconfirmedExactQrPreview = new FakeElement();
renderer.render(reconfirmedExactQrPreview, staleExactQrConfig, {
  mode: 'preview',
  serverNow: '2026-09-10T00:00:00+08:00',
});
assert.match(reconfirmedExactQrPreview.innerHTML, /data-checkout-state="available"/);

const disabledQrDraft = {
  page: { title: 'Plans & Pricing' },
  plans: [{
    planCode: 'bar_access_30d',
    name: '30-Day Access',
    priceCentavos: 19_900,
    durationDays: 30,
    entitlementMode: 'rolling_days',
    visible: true,
    checkoutEnabled: true,
  }],
  paymentMethods: [{
    channelCode: 'future_bpi_qr',
    planCode: 'bar_access_30d',
    label: 'Future BPI QR',
    qrAmountMode: 'exact',
    qrAmountCentavos: 19_900,
    qrAsset: null,
    qrUrl: null,
    enabled: false,
  }],
  faqs: [],
};
const validationController = {
  config: disabledQrDraft,
  pendingFiles: { size: 0 },
};
assert.doesNotThrow(
  () => editorSandbox.window.__DueDiligencePricingEditorTest.validateConfig(
    validationController,
    'save_draft',
  ),
  'A disabled future payment method must be saveable as a draft before its QR is ready.',
);
disabledQrDraft.paymentMethods[0].enabled = true;
assert.throws(
  () => editorSandbox.window.__DueDiligencePricingEditorTest.validateConfig(
    validationController,
    'save_draft',
  ),
  /Disable Future BPI QR or upload its QR image/,
  'An enabled payment method must fail closed until its QR is uploaded.',
);
const missingExactAmountDraft = {
  ...disabledQrDraft,
  plans: disabledQrDraft.plans.map((plan) => ({ ...plan })),
  paymentMethods: [{
    ...disabledQrDraft.paymentMethods[0],
    qrUrl: '/assets/payments/bpi-instapay-149.png',
    qrAmountMode: 'exact',
    qrAmountCentavos: null,
    enabled: true,
  }],
};
assert.throws(
  () => editorSandbox.window.__DueDiligencePricingEditorTest.validateConfig(
    { config: missingExactAmountDraft, pendingFiles: { size: 0 } },
    'save_draft',
  ),
  /needs a captured exact amount/,
  'An enabled exact QR must not pass without a captured amount.',
);
disabledQrDraft.paymentMethods[0].enabled = false;
disabledQrDraft.plans[0].priceCentavos = 0;
assert.throws(
  () => editorSandbox.window.__DueDiligencePricingEditorTest.validateConfig(
    validationController,
    'save_draft',
  ),
  /needs a price above ₱0 before checkout can be enabled/,
  'A checkout-enabled plan must reject a zero price before it reaches payment submission.',
);
disabledQrDraft.plans[0].checkoutEnabled = false;
assert.doesNotThrow(
  () => editorSandbox.window.__DueDiligencePricingEditorTest.validateConfig(
    validationController,
    'save_draft',
  ),
  'A zero-price display-only plan must remain saveable while checkout is disabled.',
);

console.log('Admin Plans & Pricing editor, authorization, safe preview, QR, and publication contracts passed.');
