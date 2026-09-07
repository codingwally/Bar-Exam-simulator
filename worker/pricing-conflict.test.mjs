import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import worker from './index.mjs';

const ORIGIN = 'https://duediligence.ph';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT = '77777777-7777-4777-8777-777777777777';
const LIVE = '11111111-1111-4111-8111-111111111111';
const env = Object.freeze({ ALLOWED_ORIGIN: ORIGIN, SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'local-synthetic-test-key', PRIVATE_BETA_GATE_ENABLED: 'false' });
const conflicts = [
  ['save_draft', 'Pricing draft changed; refresh before saving'],
  ['save_draft', 'Published pricing changed; refresh before saving'],
  ['publish', 'Pricing draft changed; refresh before publishing'],
  ['publish', 'Published pricing changed; refresh before publishing'],
  ['schedule', 'Pricing draft changed; refresh before publishing'],
  ['schedule', 'Published pricing changed; refresh before publishing'],
  ['cancel_schedule', 'Scheduled pricing revision changed; refresh before cancelling'],
  ['rollback', 'Published pricing changed; refresh before rollback'],
];
const conflictMessage = 'Pricing changed while you were editing. Load the latest server draft before retrying.';
const sql = readFileSync(new URL('../supabase/migrations/20260830054727_admin_pricing_revisions.sql', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../admin/pricing-editor.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const sourceFunction = (start, end) => editor.slice(editor.indexOf(start), editor.indexOf(end));

async function actualRequest({ operation = 'save_draft', path = '/admin/pricing/action',
  upstreamStatus = 400, upstreamBody = { code: 'P0001', message: conflicts[0][1] },
  role = 'founder_admin', bearer = true, success = false } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const target = path.endsWith('/query') ? 'phase4_admin_pricing_snapshot' : 'phase4_admin_pricing_action';
  // Transport responses are local test doubles. Actual Worker routing, Auth/role
  // gates, normalization, error mapping and serialization run unchanged. No SQL
  // execution, Auth account, external request, Storage or provider is involved.
  globalThis.fetch = async (url, init = {}) => {
    const remote = new URL(String(url));
    assert.equal(remote.origin, env.SUPABASE_URL);
    const entry = { path: remote.pathname, body: init.body ? JSON.parse(init.body) : null };
    calls.push(entry);
    if (remote.pathname === '/auth/v1/user') return Response.json({ id: ACTOR,
      email: 'synthetic@example.invalid', user_metadata: {}, app_metadata: { provider: 'email' } });
    if (remote.pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json({ authorized: true, role });
    }
    assert.equal(remote.pathname, `/rest/v1/rpc/${target}`, 'unexpected outbound request fails closed');
    return Response.json(upstreamBody, { status: success ? 200 : upstreamStatus });
  };
  const action = { operation, requestKey: `pricing-local-contract-${operation}`, expectedDraftVersion: 7,
    draftRevisionId: DRAFT, expectedLiveRevisionId: LIVE,
    ...(['cancel_schedule', 'rollback'].includes(operation) ? { sourceRevisionId: DRAFT } : {}),
    ...(operation === 'schedule' ? { publishAt: '2099-09-14T00:00:00+08:00' } : {}),
    ...(['publish', 'schedule', 'cancel_schedule', 'rollback'].includes(operation)
      ? { confirmed: true, reason: 'Local synthetic conflict verification' } : {}),
    config: { page: { title: 'Local unsaved title' }, plans: [], paymentMethods: [], faqs: [] } };
  try {
    const response = await worker.fetch(new Request(`https://api.example.test${path}`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json',
        ...(bearer ? { Authorization: 'Bearer local-synthetic-only' } : {}) },
      body: JSON.stringify(path.endsWith('/query') ? { operation: 'editor_snapshot' } : action),
    }), env, {});
    return { response, payload: await response.json(), calls, target, action };
  } finally { globalThis.fetch = originalFetch; }
}

for (const [operation, message] of conflicts) {
  test(`actual pricing ${operation} returns safe409 for exact SQL conflict: ${message}`, async () => {
    assert.ok(sql.includes(`raise exception '${message}'`), 'allowlist is backed by the shipped SQL');
    const result = await actualRequest({ operation, upstreamBody: { code: 'P0001', message,
      detail: 'PRIVATE_SQL_DETAIL', hint: 'PRIVATE_HINT' } });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.payload, { ok: false, error: { code: 'PRICING_VERSION_CONFLICT', message: conflictMessage } });
    assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(result.calls.filter((call) => call.path.endsWith(result.target)).length, 1,
      'no automatic retry, overwrite, publish or additional action');
    assert.doesNotMatch(JSON.stringify(result.payload), /PRIVATE_SQL_DETAIL|PRIVATE_HINT|P0001/);
  });
}

test('unknown errors and near matches remain sanitized503; no broad SQL-message mapping', async () => {
  for (const upstreamBody of [
    { code: 'P0001', message: `${conflicts[0][1]} PRIVATE_SECRET` },
    { code: 'P0001', message: `PRIVATE_SECRET ${conflicts[0][1]}` },
    { code: 'P0001', message: conflicts[0][1].toLowerCase() },
    { code: 'P0001', message: 'Request key conflict' },
    { code: 'P0001', message: 'Pricing draft not found' },
    { code: '23505', message: conflicts[0][1] },
    { message: conflicts[0][1] },
    { code: 'P0001', message: null },
  ]) {
    const result = await actualRequest({ upstreamBody });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.payload.error, { code: 'ADMIN_DATA_UNAVAILABLE', message: 'Administrator data is temporarily unavailable.' });
    assert.doesNotMatch(JSON.stringify(result.payload), /PRIVATE_SECRET|P0001|23505/);
  }
  for (const upstreamStatus of [409, 500, 503]) {
    const result = await actualRequest({ upstreamStatus });
    assert.equal(result.response.status, 503, 'only the known400 SQL rejection is reclassified');
  }
});

test('401/403 upstream denials and unsigned/non-Founder requests preserve authorization', async () => {
  for (const upstreamStatus of [401, 403]) {
    const result = await actualRequest({ upstreamStatus });
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.payload.error, { code: 'ADMIN_FORBIDDEN', message: 'You are not authorized for this administrator operation.' });
  }
  const sqlDenied = await actualRequest({ upstreamBody: { code: 'P0001',
    message: 'Founder administrator authorization required' } });
  assert.equal(sqlDenied.response.status, 403);
  assert.equal(sqlDenied.payload.error.code, 'ADMIN_FORBIDDEN');
  for (const role of ['admin', 'student', null]) {
    const result = await actualRequest({ role });
    assert.equal(result.response.status, 403);
    assert.equal(result.calls.some((call) => call.path.endsWith(result.target)), false);
  }
  const unsigned = await actualRequest({ bearer: false });
  assert.equal(unsigned.response.status, 401); assert.equal(unsigned.calls.length, 0);
});

test('identical SQL text on another RPC is not reclassified', async () => {
  const result = await actualRequest({ path: '/admin/pricing/query' });
  assert.equal(result.response.status, 503);
  assert.equal(result.payload.error.code, 'ADMIN_DATA_UNAVAILABLE');
});

test('accepted actions and idempotent replay return unchanged without extra calls', async () => {
  for (const replayed of [false, true]) {
    const action = { ok: true, operation: 'save_draft', revisionId: DRAFT, lockVersion: 8, replayed };
    const result = await actualRequest({ success: true, upstreamBody: action });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload, { ok: true, action, data: action });
    const forwarded = result.calls.filter((call) => call.path.endsWith(result.target));
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].body.p_request_key, result.action.requestKey);
    assert.equal(forwarded[0].body.p_expected_lock_version, 7);
    assert.deepEqual(forwarded[0].body.p_config, result.action.config);
  }
});

test('actual editor catch displays Load latest while retaining local edits and awaiting explicit reload', async () => {
  const { payload } = await actualRequest();
  const error = Object.assign(new Error(payload.error.message), { code: payload.error.code });
  let actionCalls = 0; let reloads = 0; let validations = 0;
  const status = { dataset: {}, children: [], span: { textContent: '' },
    querySelector(selector) { return selector === 'span' ? this.span : this.children.find((item) => item.dataset.editorAction === 'reload-latest'); },
    append(button) { this.children.push(button); } };
  const config = { page: { title: 'UNSAVED_OWNER_TEXT' } };
  const selected = { name: 'nonpayable-synthetic.png' };
  const controller = { config, dirty: true, expectedDraftVersion: 7, draftRevisionId: DRAFT,
    pendingFiles: new Map([['qr', selected]]), root: { querySelector: () => status },
    options: { action: async () => { actionCalls += 1; throw error; } } };
  const scope = { controller, document: { createElement: () => ({ dataset: {} }) },
    controllerIsActive: () => true, validateConfig: () => { validations += 1; },
    ensureDraft: async () => {}, actionBody: () => ({ operation: 'save_draft' }),
    setBusy: (state, busy) => { state.busy = busy; },
    reloadSnapshot: async () => { reloads += 1; }, operationSuccess: () => 'Saved' };
  await runInNewContext(`${sourceFunction('  function setMessage(', '\n  function setOperationError(')}
    ${sourceFunction('  async function performOperation(', '\n  function openOperation(')}
    performOperation(controller, 'save_draft');`, scope);
  assert.equal(actionCalls, 1); assert.equal(validations, 1); assert.equal(reloads, 0);
  assert.equal(controller.config, config); assert.equal(controller.dirty, true);
  assert.equal(controller.pendingFiles.get('qr'), selected);
  assert.equal(controller.expectedDraftVersion, 7); assert.equal(controller.draftRevisionId, DRAFT);
  assert.equal(controller.conflict, true); assert.equal(controller.busy, false);
  assert.equal(status.children.length, 1);
  assert.equal(status.children[0].textContent, 'Load latest server draft');
  assert.equal(status.children[0].dataset.editorAction, 'reload-latest');
  assert.match(status.span.textContent, /Your local edits are still here/);
});
