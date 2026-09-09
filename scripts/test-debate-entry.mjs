import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDebateIntegration } from '../worker/debate-integration.mjs';

// Source and inert-transport checks only. No browser, account or provider calls.
const source = await readFile(new URL('../assets/debate-entry.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../assets/debate-room.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../debate-room/index.html', import.meta.url), 'utf8');
const shell = await readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const paid = { id: '91000000-0000-4000-8000-000000000001', verified: true, displayName: 'Paid member', role: 'student', paid: true };
const unpaid = { id: '91000000-0000-4000-8000-000000000002', verified: true, displayName: 'Unpaid member', role: 'student', paid: false };

function transport(env, actor) {
  const reads = [];
  const integration = createDebateIntegration({ env,
    authenticate: async request => request.headers.get('Authorization') === 'Bearer inert-session' ? actor : null,
    rpc: async (name, args) => { assert.equal(name, 'debate_v3_list'); reads.push(args.p_actor_id); return []; },
    fetcher: async () => assert.fail('No external request is permitted'),
  });
  return { reads, integration, fetch: (url, options) => integration.handle(new Request(url, options)) };
}

function entryHarness(fetcher, actor) {
  const links = [{ hidden: true }, { hidden: true }], callbacks = new Map();
  let initialRefresh;
  const window = {
    location: { origin: 'https://duediligence.ph', search: '', replace: () => assert.fail('No authentication redirect expected') },
    DueDiligencePhase2Config: { workerUrl: 'https://worker.test' },
    DueDiligencePhase4: { getSession: () => actor ? { access_token: 'inert-session', user: actor } : null },
    addEventListener: (name, callback) => callbacks.set(name, callback),
    setTimeout: callback => { initialRefresh = callback; },
  };
  vm.runInNewContext(source, { window, document: { querySelectorAll: selector => { assert.equal(selector, '[data-debate-room-entry]'); return links; } },
    fetch: fetcher, AbortController, URL, setTimeout, clearTimeout, Date, JSON, Number });
  return { links, refresh: () => initialRefresh(), callbacks };
}

test('desktop and mobile Debate links follow Study Room and use the separate route', () => {
  for (const id of ['dd-study-room-trigger', 'spa-study-room']) {
    const pattern = new RegExp(`<button\\b[^>]*\\bid="${id}"[\\s\\S]*?<\\/button>\\s*<a\\b([^>]*data-debate-room-entry[^>]*)>Debate Room<\\/a>`);
    const attributes = home.match(pattern)?.[1];
    assert.ok(attributes, `${id}: Debate must immediately follow Study Room`);
    assert.match(attributes, /href="debate-room\/"/);
    assert.doesNotMatch(attributes, /admin|paid|entitlement|data-dd2-view/);
  }
  assert.equal((home.match(/data-debate-room-entry/g) || []).length, 2);
  assert.match(shell, /if \(memberTools\) memberTools\.hidden = !signedIn;/, 'The desktop container depends on sign-in, not a paid plan or admin role');
});

for (const actor of [paid, unpaid]) test(`public Debate access shows both links and permits event listing for ${actor.displayName.toLowerCase()} without admin role`, async () => {
  const remote = transport({ DEBATE_ROOM_ENABLED: 'true' }, actor);
  const ui = entryHarness(remote.fetch, actor);
  await ui.refresh();
  assert.ok(ui.links.every(link => !link.hidden));
  const response = await remote.integration.handle(new Request('https://worker.test/debate-room/events', { headers: { Authorization: 'Bearer inert-session' } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).events, []);
  assert.deepEqual(remote.reads, [actor.id], 'The production integration lists the authenticated member’s events');
});

test('public navigation still requires authentication for private event records', async () => {
  const remote = transport({ DEBATE_ROOM_ENABLED: 'true' }, null);
  const ui = entryHarness(remote.fetch, null);
  await ui.refresh();
  assert.ok(ui.links.every(link => !link.hidden), 'Visitors may reach the sign-in page');
  const response = await remote.integration.handle(new Request('https://worker.test/debate-room/events'));
  assert.equal(response.status, 401);
  assert.deepEqual(remote.reads, []);
});

test('disabled public release keeps both links restricted to the exact preview account', async () => {
  for (const actor of [paid, unpaid]) {
    const remote = transport({ DEBATE_PREVIEW_ACTOR_IDS: paid.id }, actor);
    const ui = entryHarness(remote.fetch, actor);
    await ui.refresh();
    assert.ok(ui.links.every(link => link.hidden === (actor.id !== paid.id)));
  }
});

test('navigation does not expose either link when access cannot be confirmed', async () => {
  const ui = entryHarness(async () => { throw new Error('Inert transport unavailable'); }, unpaid);
  await ui.refresh();
  assert.ok(ui.links.every(link => link.hidden));
});

test('public copy uses practice debates and pairings while preserving form and action contracts', () => {
  assert.match(page, /Practice debate · Results are excluded from competition standings\./);
  assert.match(page, /Camera and microphone are off\./);
  assert.match(client, /name="rehearsal"[^>]*[\s\S]*?Practice debate \(excluded from competition standings\)/);
  assert.match(client, /button\('Generate pairings','fixtures'\)/);
  assert.match(client, /openDialog\('Publish reviewed pairings'/);
  assert.match(client, /command\('publish_fixtures',\{confirmed:true\}\)/);
  assert.doesNotMatch(client, /eligible observer snapshot|Preview retention defaults:|public-launch policy|Operational metadata|No export or delivery jobs yet\./);
  assert.match(client, /Email delivery must be available\./);
  assert.match(client, /Recording, transcription and livestreaming are not enabled\./);
});

test('internal error codes become an actionable public message while availability explanations remain explicit', () => {
  const declaration = client.match(/^function publicErrorMessage\(value\) \{.+\}$/m)?.[0];
  assert.ok(declaration);
  const describe = vm.runInNewContext(`${declaration}; publicErrorMessage`);
  for (const code of ['MEDIA_UNCONFIGURED', 'OUTBOX_FAILED', 'FORBIDDEN', 'STORE_UNAVAILABLE: internal context']) {
    assert.match(describe(code), /could not be completed/);
    assert.doesNotMatch(describe(code), /UNCONFIGURED|OUTBOX|FORBIDDEN|STORE_UNAVAILABLE/);
  }
  for (const explanation of ['Live video is unavailable. Your camera and microphone are off.', 'Email delivery is disabled.', 'Sign in to use Debate Room.']) assert.equal(describe(explanation), explanation);
  assert.match(client, /textContent=error\?publicErrorMessage\(message\):message/);
  assert.match(client, /\$\('dialog-status'\)\.textContent=publicErrorMessage\(error\.message\)/);
  assert.match(client, /esc\(publicErrorMessage\(j\.error\)\)/);
});

test('delivery types use public names without changing saved job types or failure status', () => {
  const declaration = client.match(/^const deliveryName = .+;$/m)?.[0];
  assert.ok(declaration);
  const label = vm.runInNewContext(`${declaration}; deliveryName`);
  assert.equal(label('invitation_mail'), 'Invitation email');
  assert.equal(label('media'), 'Room connection');
  assert.equal(label('delete_export'), 'Download removal');
  assert.equal(label('unknown_internal_job'), 'Event request');
  assert.match(client, /esc\(humanState\(j\.status\)\)/);
  assert.match(client, /j\.status==='failed'\?button\('Retry','retry-job'/);
});
