/** CI-only actual Study DOM + local SQL journey. --harness-only never launches a browser. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { startStudyRoomRehearsal } from './serve-study-room-rehearsal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessOnly = process.argv.length === 3 && process.argv[2] === '--harness-only';
if (!harnessOnly && !(process.argv.length === 2 && process.platform === 'linux'
  && process.env.GITHUB_ACTIONS === 'true' && process.env.DEBATE_SYNTHETIC_BROWSER_CI === '1')) {
  throw new Error('Study browser execution requires Linux GitHub Actions and DEBATE_SYNTHETIC_BROWSER_CI=1; local use is limited to --harness-only.');
}
const output = path.join(ROOT, 'artifacts/debate-local-rehearsal/study-browser-ci', ...(harnessOnly ? ['harness-only'] : []));
const runtime = await startStudyRoomRehearsal({ outputDir: output });
const checks = [], errors = []; let browser;
const report = { status:'RUNNING', synthetic:true, actualDOM:!harnessOnly, actualRoutes:true, actualSQL:true,
  browserVersion:null, hostedAuth:false, providerPresence:false, physicalMedia:false, realMail:false, productionChanges:false, checks, errors };
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
const api = async (actor, route, body = {}, expected = 200) => {
  const response = await runtime.request(actor, route, body), result = await response.json();
  assert.equal(response.status, expected, `${actor} ${route} ${body.operation || ''}: ${JSON.stringify(result)}`); return result;
};
const room = async key => (await runtime.catalog()).rooms.find(entry => entry.roomKey === key);
const admission = async (actor, operation, extra = {}, expected = 200) => api(actor, '/study-room/admission', {
  operation, roomKey:'2', accessRevision:(await room('2')).accessRevision,
  ...(!['status','list'].includes(operation) ? { commandId:randomUUID() } : {}), ...extra,
}, expected);
const configure = async (key, audience) => { const current = await room(key); return api('admin','/admin/study-room/rooms', {
  operation:'update', roomKey:key, label:current.label, audience, expectedRevision:current.revision,
}); };
const eventually = async (condition, label, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(label);
};

async function verifyHarness() {
  check('Catalog defaults All users and preserves private Inner Chamber', (await runtime.catalog()).rooms.every(r => r.audience === (r.roomKey === '5' ? 'admin' : 'all')));
  await api(null,'/study-room/access',{},401);
  await api('member','/admin/study-room/rooms',{ operation:'list' },403);
  await api('member','/study-room/join',{ roomKey:'5',nickname:'Synthetic member' },403);
  const inner = await room('5'); await api('admin','/admin/study-room/rooms',{operation:'update',roomKey:'5',label:inner.label,audience:'approval',expectedRevision:inner.revision},400);
  await configure('2','approval'); await configure('3','paid'); await configure('4','admin');
  await api('member','/study-room/join',{roomKey:'3',nickname:'Synthetic member'},403);
  await api('member','/study-room/join',{roomKey:'4',nickname:'Synthetic member'},403);
  const paid = await api('paid','/study-room/join',{roomKey:'3',nickname:'Synthetic paid'},201);
  assert.equal(paid.audience,'paid');
  const before = runtime.metrics.signedCredentials;
  const waiting = await admission('member','request',{nickname:'Synthetic waiting'});
  assert.equal(waiting.admission.status,'pending');
  await api('member','/study-room/join',{roomKey:'2',nickname:'Synthetic waiting'},403);
  await admission('admin','list',{},403);
  assert.equal(runtime.metrics.signedCredentials,before); check('Pending cannot obtain a credential, and absent admin cannot list');
  const adminJoin = await api('admin','/study-room/join',{roomKey:'2',nickname:'Synthetic facilitator'},201);
  await api('member','/__study/connect',{participantToken:adminJoin.participant_token},403);
  const connected = await api('admin','/__study/connect',{participantToken:adminJoin.participant_token});
  const queued = await admission('admin','list'); assert.equal(queued.queue[0].requestId,waiting.admission.requestId);
  await admission('admin','admit',{requestId:waiting.admission.requestId,expectedVersion:waiting.admission.version});
  const granted = await api('member','/study-room/join',{roomKey:'2',nickname:'Synthetic waiting'},201);
  await api('member','/__study/connect',{participantToken:granted.participant_token});
  check('Actual SQL approval enables one actor-bound signed-token connection');
  const row = (await admission('admin','list')).queue.find(r=>r.requestId===waiting.admission.requestId);
  await admission('admin','deny',{requestId:row.requestId,expectedVersion:row.version});
  await api('member','/__study/connect',{participantToken:granted.participant_token},403);
  const cooldown = await api('member','/study-room/join',{roomKey:'2',nickname:'Synthetic waiting'},409);
  assert.equal(cooldown.error.code,'STUDY_ROOM_ADMISSION_COOLDOWN');
  await api('admin','/__study/disconnect',{connectionId:connected.connectionId}); await admission('admin','list',{},403);
  check('Revocation rejects stale JWT and later join; absent administrator loses queue access');
  const cancelled = await admission('member2','request',{nickname:'Synthetic cancel'});
  assert.equal(cancelled.admission.status,'pending'); await admission('member2','cancel');
  assert.equal((await admission('member2','status')).admission.status,'cancelled');
  check('Cancellation persists in actual service-role SQL');
}

async function verifyBrowser() {
  const require = createRequire(import.meta.url), { chromium } = require('playwright');
  assert.equal(require('playwright/package.json').version,'1.54.2');
  browser = await chromium.launch({ channel:'chrome', headless:true });
  report.browserVersion = browser.version();
  const contexts = [], pages = [], blocked = [];
  const newActor = async key => {
    const context = await browser.newContext({ viewport:{width:1280,height:900}, serviceWorkers:'block' }); contexts.push(context);
    await context.tracing.start({ screenshots:true, snapshots:true, sources:false });
    await context.addCookies([{name:'study_synthetic_actor',value:key,url:runtime.origin}]);
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== runtime.origin) { blocked.push(route.request().url()); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push({actor:key,message:error.message}));
    await page.goto(runtime.origin+'/study-room/'); await page.locator('#sr-room-card-grid [data-room-key="2"]').waitFor();
    return page;
  };
  const off = async page => { assert.equal(await page.locator('#sr-join-camera').getAttribute('aria-pressed'),'false'); assert.equal(await page.locator('#sr-join-microphone').getAttribute('aria-pressed'),'false'); };
  // Poll in Node: waitForFunction compiles page-side predicates and conflicts
  // with the real page CSP. Keep CSP intact and read only locator properties.
  const waitForJoin = (page, label) => eventually(async () => {
    const button = page.locator('#sr-join');
    return await button.isEnabled() && (!label || await button.textContent() === label);
  }, `Join control did not become ready${label ? ': ' + label : ''}`, 15000);
  const waitForPending = page => eventually(async () =>
    (await page.locator('#sr-entry-admission-status').textContent()).includes('waiting room'),
  'The admission dialog did not show its pending state', 15000);
  const open = async (page,key) => { await page.locator(`#sr-room-card-grid [data-room-key="${key}"]`).click(); await page.locator('#sr-entry-dialog').waitFor({state:'visible'}); await off(page); };
  const join = async page => { await page.locator('#sr-join').click(); await page.locator('#sr-live-room').waitFor({state:'visible'}); };
  const changePolicy = async (page,key,audience) => {
    await page.locator(`.sr-room-admin-card:has([data-room-key="${key}"]) .sr-room-edit`).click();
    await page.locator('#sr-room-audience').selectOption(audience); await page.locator('#sr-room-save').click();
    await page.locator('#sr-room-editor').waitFor({state:'hidden'}); assert.equal((await room(key)).audience,audience);
  };
  const waitingRow = (page,name) => page.locator('#sr-waiting-list .sr-waiting-person').filter({has:page.locator('strong',{hasText:name})});
  try {
    const admin = await newActor('admin');
    await admin.locator('#sr-room-add').click(); assert.equal(await admin.locator('#sr-room-audience').inputValue(),'all');
    assert.deepEqual(await admin.locator('#sr-room-audience option').evaluateAll(options=>options.map(o=>o.value)),['all','paid','admin','approval']);
    await admin.locator('#sr-room-label').fill('Synthetic added room'); await admin.locator('#sr-room-save').click();
    await admin.locator('#sr-room-editor').waitFor({state:'hidden'}); assert.equal((await room('7')).audience,'all');
    await admin.locator('.sr-room-admin-card:has([data-room-key="5"]) .sr-room-edit').click();
    assert.equal(await admin.locator('#sr-room-audience').isDisabled(),true); assert.equal(await admin.locator('#sr-room-audience').inputValue(),'admin');
    await admin.locator('#sr-room-cancel').click();
    await changePolicy(admin,'2','approval'); await changePolicy(admin,'3','paid'); await changePolicy(admin,'4','admin');
    check('Actual admin editor saves four policies and defaults a new room to All; Inner Chamber stays fixed');
    const member = await newActor('member');
    for (const key of ['3','4','5']) assert.equal(await member.locator(`#sr-room-card-grid [data-room-key="${key}"]`).isDisabled(),true);
    await api('member','/study-room/join',{roomKey:'5',nickname:'Synthetic member'},403);
    await open(member,'1'); assert.equal(await member.locator('#sr-join-microphone').isDisabled(),true); await member.locator('#sr-entry-close').click();
    await open(member,'2'); await member.locator('#sr-nickname').fill('Synthetic pending member');
    await waitForJoin(member,'Ask to enter');
    const before = runtime.metrics.signedCredentials;
    await member.locator('#sr-join').dblclick();
    await waitForPending(member);
    assert.equal(await member.locator('#sr-join').isDisabled(),true); assert.equal(runtime.metrics.signedCredentials,before);
    assert.equal((await member.evaluate(()=>window.__studySynthetic.metrics)).constructors,0);
    check('DOM pending state persists in SQL without issuing a JWT or creating a media room');
    await admission('admin','list',{},403);
    const admin2 = await newActor('admin2'); await open(admin2,'6'); await join(admin2); await admission('admin2','list',{},403);
    check('Outside admin and admin in another room cannot inspect the waiting queue');
    await open(admin,'2'); await join(admin); await admin.locator('#sr-dock-people').click();
    await admin.locator('#sr-waiting-refresh').click();
    await waitingRow(admin,'Synthetic pending member').getByRole('button',{name:'Admit',exact:true}).click();
    await member.locator('#sr-entry-admission-retry').click();
    await waitForJoin(member,'Enter room');
    assert.equal((await member.evaluate(()=>window.__studySynthetic.metrics)).connects,0); await off(member);
    check('Same-room admin manually admits; approval alone never connects the member');
    await join(member); assert.equal((await member.evaluate(()=>window.__studySynthetic.metrics)).connects,1);
    check('Only the member’s explicit Enter obtains an authorized JWT and connects the inert transport');
    await admin.screenshot({path:path.join(output,'admin-waiting-room.png'),fullPage:true});
    await member.screenshot({path:path.join(output,'member-explicit-entry.png'),fullPage:true});
    await admin.locator('#sr-waiting-refresh').click();
    await waitingRow(admin,'Synthetic pending member').getByRole('button',{name:'Remove access',exact:true}).click();
    await member.locator('#sr-live-room').waitFor({state:'hidden'});
    const cooldown = await api('member','/study-room/join',{roomKey:'2',nickname:'Synthetic pending member'},409);
    assert.equal(cooldown.error.code,'STUDY_ROOM_ADMISSION_COOLDOWN');
    check('Admin removal disconnects the synthetic member and durable denial blocks later join');
    // Reuse the third page after a genuine client auth callback, without touching client state.
    await admin2.evaluate(()=>window.__studySynthetic.switchActor('member2'));
    await admin2.locator('#sr-access-retry').click(); await admin2.locator('#sr-room-card-grid [data-room-key="2"]').waitFor();
    await open(admin2,'2'); await admin2.locator('#sr-nickname').fill('Synthetic cancel member');
    await waitForJoin(admin2); await admin2.locator('#sr-join').click();
    await waitForPending(admin2);
    await admin2.locator('#sr-entry-admission-cancel').click();
    await eventually(async()=> (await admission('member2','status')).admission?.status==='cancelled','Cancel was not persisted');
    check('Actual Cancel request persists cancellation and leaves devices off');
    await admin2.locator('#sr-entry-close').click(); runtime.holdRequest('member2');
    await open(admin2,'2'); await waitForJoin(admin2);
    await admin2.locator('#sr-join').click(); await eventually(()=>runtime.heldRequestCommitted,'Delayed request did not reach SQL');
    await admin2.evaluate(()=>window.__studySynthetic.switchActor('paid')); runtime.releaseRequest();
    await admin2.locator('#sr-entry-dialog').waitFor({state:'hidden'});
    await eventually(async()=> (await admission('member2','status')).admission?.status==='cancelled','Old actor request did not cancel after switch');
    assert.equal((await admission('paid','status')).admission,null);
    check('Late request after account switch cancels under the original identity and cannot enter for the new account');
    assert.equal(blocked.length,0,'No external network request is attempted');
    for (const page of pages) { const m = await page.evaluate(()=>window.__studySynthetic.metrics); assert.equal(m.captures,0); assert.equal(m.publications,0); assert.deepEqual(m.forbidden,[]); }
    assert.deepEqual(errors,[],'Actual DOM has no uncaught runtime errors'); check('Every browser remained free of capture, publication, WebRTC, WebSocket and external network');
  } finally {
    runtime.releaseRequest();
    for (let i=0;i<contexts.length;i++) {
      await pages[i]?.screenshot({path:path.join(output,`final-${i}.png`),fullPage:true}).catch(()=>{});
      await pages[i]?.evaluate(()=>window.__studySynthetic.closeTransports()).catch(()=>{});
      await contexts[i].tracing.stop({path:path.join(output,`synthetic-trace-${i}.zip`)}).catch(()=>{});
      await contexts[i].close();
    }
  }
}

try {
  if (harnessOnly) await verifyHarness(); else await verifyBrowser();
  report.status = harnessOnly ? 'PASS_SYNTHETIC_STUDY_HTTP_SQL' : 'PASS_SYNTHETIC_STUDY_BROWSER';
} catch (error) {
  report.status='FAIL'; report.failure={message:error.message,stack:error.stack}; process.exitCode=1;
  console.error(error.stack);
} finally {
  await browser?.close(); await runtime.close();
  const manifest = JSON.parse(await readFile(path.join(output,'harness.json'),'utf8'));
  report.sourceHashes = manifest.sourceHashes; report.substitutions = manifest.substitutions;
  report.metrics={...runtime.metrics}; report.finishedAt=new Date().toISOString();
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:checks.length,report:path.join(output,'report.json')}));
}
