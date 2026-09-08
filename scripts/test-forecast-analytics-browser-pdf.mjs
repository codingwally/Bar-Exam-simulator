import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildForecastAnalyticsPdfBrowserWorker, buildForecastPdfBrowserWorker } from './build-forecast-pdf-browser-worker.mjs';
import { buildForecastAnalyticsPdf } from '../worker/forecast-analytics-pdf.mjs';
import { buildForecastResultPdf } from '../worker/forecast-result-pdf.mjs';
import { curatedFixture, withMaximumAnswers } from '../worker/forecast-result-layout-fixture.mjs';
import { analyticsFixture, OWNER } from '../worker/forecast-analytics-test-fixture.mjs';
import { validateForecastAnalyticsScope, validateForecastScopeAttempt, forecastAnalyticsFileName,
  FORECAST_ANALYTICS_VERSION, assertForecastAnalyticsPdfSize } from '../worker/forecast-analytics-core.mjs';

const source = await readFile(new URL('../browser/forecast-analytics-pdf-worker.mjs', import.meta.url), 'utf8');
const fixture = await analyticsFixture(2);
function worker({ stallAppend = false } = {}) {
  const messages = []; let closed = 0; let renders = 0; let calls = 0; let copiedScope; let owner;
  const self = { postMessage: (value, transfer) => messages.push({ value, transfer }), close: () => closed++ };
  const createForecastAnalyticsPdf = async ({ scope, ownerId }) => {
    validateForecastAnalyticsScope(scope, ownerId); assertForecastAnalyticsPdfSize(scope);
    copiedScope = structuredClone(scope); owner = ownerId;
    return { append: async attempt => {
      validateForecastScopeAttempt(copiedScope, owner, attempt, calls); calls++;
      if (stallAppend) await new Promise(() => {});
      return { completedAttempts: calls, totalAttempts: copiedScope.manifest.length, pageCount: 1 + calls * 21 };
    }, finish: async () => { renders++; return new TextEncoder().encode('%PDF-inert-protocol'); } };
  };
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gmu, ''), { self, createForecastAnalyticsPdf,
    FORECAST_ANALYTICS_VERSION, forecastAnalyticsFileName });
  return { send: data => self.onmessage({ data }), messages, state: () => ({ closed, renders, calls }) };
}
const start = () => ({ type: 'start', requestId: 1, ownerId: OWNER, scope: fixture.scope });

test('actual worker protocol renders every member in frozen order and emits one final transferable PDF only', async () => {
  const w = worker(); await w.send(start());
  for (let i = 0; i < 2; i++) await w.send({ type: 'append', requestId: 1, index: i, attempt: fixture.attempts[i] });
  assert.equal(w.messages.some(row => row.value.bytes), false);
  await w.send({ type: 'finish', requestId: 1 });
  assert.deepEqual(w.messages.map(row => row.value.type), ['ready', 'progress', 'progress', 'result']);
  assert.deepEqual(w.state(), { closed: 1, renders: 1, calls: 2 });
  const final = w.messages.at(-1); assert.equal(final.transfer[0], final.value.bytes);
  assert.equal(final.value.completedAttempts, 2); assert.equal(final.value.scopeHash, fixture.scope.scopeHash);
  await w.send(start()); assert.equal(w.messages.length, 4);
});

test('unknown keys, token injection, wrong owners and incomplete finish fail with fixed errors only', async () => {
  for (const bad of [{ ...start(), access_token: 'PRIVATE_TOKEN' }, { ...start(), ownerId: undefined },
    { ...start(), ownerId: '22222222-2222-4222-8222-222222222222' }, { type: 'finish', requestId: 1 }]) {
    const w = worker(); await w.send(bad);
    assert.equal(w.messages.length, 1); assert.equal(w.messages[0].value.type, 'error');
    assert.doesNotMatch(JSON.stringify(w.messages), /PRIVATE_TOKEN|owner|answer|http|11111111/u);
    assert.deepEqual(w.state(), { closed: 1, renders: 0, calls: 0 });
  }
});

test('reordered members, incomplete completion and duplicate start cannot return a partial PDF', async () => {
  for (const next of [{ type: 'append', requestId: 1, index: 1, attempt: fixture.attempts[1] },
    { type: 'append', requestId: 1, index: 0, attempt: fixture.attempts[1] }, { type: 'finish', requestId: 1 }, start()]) {
    const w = worker(); await w.send(start()); await w.send(next);
    assert.equal(w.messages.at(-1).value.type, 'error'); assert.equal(w.state().renders, 0);
    assert.equal(w.messages.some(row => row.value.bytes), false); assert.equal(w.state().closed, 1);
  }
});

test('concurrent worker messages fail closed instead of racing the sequential page assembly', async () => {
  const w = worker({ stallAppend: true }); await w.send(start());
  void w.send({ type: 'append', requestId: 1, index: 0, attempt: fixture.attempts[0] });
  await w.send({ type: 'finish', requestId: 1 });
  assert.equal(w.messages.at(-1).value.type, 'error'); assert.equal(w.state().renders, 0); assert.equal(w.state().closed, 1);
});

test('period worker source has no token transport, storage, logging or server exporter import', () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|console\.|forecast-result-export|forecast-analytics-export|postMessage\([^)]*attempt\s*:/u);
});

async function browserLauncher() {
  if (process.env.FORECAST_PDF_AGENT_BROWSER_CLI) return { exe: process.execPath, prefix: [process.env.FORECAST_PDF_AGENT_BROWSER_CLI] };
  if (process.platform !== 'win32') return { exe: 'npx', prefix: ['--offline', '--yes', 'agent-browser@0.36.0'] };
  for (const filename of [process.env.AGENT_BROWSER_NPX_CLI,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
    path.join(path.dirname(process.execPath), '../node_modules/npm/bin/npx-cli.js')].filter(Boolean)) {
    try { await access(filename); return { exe: process.execPath, prefix: [filename, '--offline', '--yes', 'agent-browser@0.36.0'] }; } catch {}
  }
  throw new Error('Provide the installed pinned agent-browser0.36 CLI path for the loopback-only test.');
}

// Explicit, inert native verification. The real bundle serially renders complete
// canonical fixtures; the browser's actual downloaded files, not an echoed byte
// payload or fake PDF, must match the Node renderer twice. No account/API/model.
if (process.argv.includes('--browser')) test('native period and selected downloads preserve complete Unicode/max6000 bytes twice with serial/abort/size guards', async () => {
  const launcher = await browserLauncher(); // Resolve before opening a server.
  const command = promisify(execFile); const hash = value => createHash('sha256').update(value).digest('hex');
  const bundle = await buildForecastAnalyticsPdfBrowserWorker(); const selectedBundle = await buildForecastPdfBrowserWorker();
  assert.ok(bundle.code.length > 0 && bundle.code.length < 3_000_000);
  assert.equal(bundle.inputs.some(name => /fixture|\.test\.mjs|forecast-(?:result|analytics)-export\.mjs|forecast-attempt-store\.mjs|content\//u.test(name)), false);
  assert.doesNotMatch(new TextDecoder().decode(bundle.code), /SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|generativelanguage|Bearer |Local synthetic resource fixture/iu);
  const maximum = await analyticsFixture(1); maximum.attempts[0] = withMaximumAnswers(maximum.attempts[0]);
  maximum.scope.manifest[0].resultHash = hash(JSON.stringify(maximum.attempts[0].result));
  assert.equal(maximum.attempts[0].answers.length, 20);
  assert.ok(maximum.attempts[0].answers.every(row => row.answer.length === 6000));
  const selected = await curatedFixture(); const baseline = JSON.stringify({ fixture, maximum, selected });
  const expected = new Map([
    ['period', await buildForecastAnalyticsPdf({ ...fixture, ownerId: OWNER })],
    ['maximum', await buildForecastAnalyticsPdf({ ...maximum, ownerId: OWNER })],
    ['selected', await buildForecastResultPdf({ attempt: selected, ownerId: OWNER })],
  ]);
  // This independent selected-report golden predates Analytics and protects the
  // existing worker/font/report contract from a shared-module regression.
  assert.equal(hash(expected.get('selected')), '7b6de709318e3899ddfdd5d9334e2bdc77534055209dd481b8870795789e323a');
  assert.equal(JSON.stringify({ fixture, maximum, selected }), baseline);
  const frontend = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
  const extract = name => {
    const match = new RegExp(`^  function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}`, 'mu').exec(frontend);
    assert.ok(match, 'The actual public rendering projection must be isolated exactly');
    return vm.runInNewContext(`(${match[0]})`);
  };
  const projectScope = extract('forecastAnalyticsRenderingSnapshot'); const projectAttempt = extract('forecastPdfRenderingSnapshot');
  const project = value => ({ scope: projectScope(value.scope), attempts: value.attempts.map(projectAttempt) });
  const fixtures = { period: project(fixture), maximum: project(maximum), selected: projectAttempt(selected) };
  const observedPaths = []; const html = `<!doctype html><meta charset="utf-8"><title>Local saved period PDF verification</title>
    <h1>Local saved PDF verification</h1><p>Synthetic canonical results only. No account or grading request.</p>
    <button id="period">Download two complete reports</button><button id="maximum">Download20maximum answers</button>
    <button id="selected">Download existing selected report</button><button id="guards">Verify safe refusal/cancellation</button>
    <output id="status">Ready</output><script>
    const ownerId=${JSON.stringify(OWNER)};
    window.pdfCheck={stage:'ready',code:'none',downloads:0,errors:0,guards:0,unchanged:true,sequence:[]};
    addEventListener('error',()=>window.pdfCheck.errors++);addEventListener('unhandledrejection',()=>window.pdfCheck.errors++);
    const status=document.getElementById('status');
    function exchange(worker,message){return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('TIMEOUT'));},60000);
      worker.onerror=e=>{e.preventDefault();clearTimeout(timer);reject(new Error('WORKER_ERROR'));};
      worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};worker.postMessage(message);
    });}
    async function render(kind,data){
      const worker=new Worker(kind==='selected'?'/assets/forecast-result-pdf-worker.js':'/assets/forecast-analytics-pdf-worker.js');
      try{
        if(kind==='selected')return await exchange(worker,{type:'render',requestId:1,ownerId,attempt:data});
        window.pdfCheck.sequence.push('start');
        let value=await exchange(worker,{type:'start',requestId:1,ownerId,scope:data.scope});
        if(value.type!=='ready'||value.scopeId!==data.scope.id||value.scopeHash!==data.scope.scopeHash||value.totalAttempts!==data.attempts.length)throw new Error('SEQUENCE');
        for(let index=0;index<data.attempts.length;index++){
          window.pdfCheck.sequence.push('append'+index);
          value=await exchange(worker,{type:'append',requestId:1,index,attempt:data.attempts[index]});
          if(value.type!=='progress'||value.completedAttempts!==index+1||value.totalAttempts!==data.attempts.length)throw new Error('SEQUENCE');
        }
        window.pdfCheck.sequence.push('finish');
        value=await exchange(worker,{type:'finish',requestId:1});
        if(value.completedAttempts!==data.attempts.length||value.scopeId!==data.scope.id||value.scopeHash!==data.scope.scopeHash)throw new Error('SEQUENCE');
        return value;
      }finally{worker.terminate();}
    }
    for(const kind of ['period','maximum','selected'])document.getElementById(kind).onclick=async()=>{
      for(const button of document.querySelectorAll('button'))button.disabled=true;
      try{
        window.pdfCheck.stage='fixture';const data=await(await fetch('/fixture/'+kind)).json();const before=JSON.stringify(data);
        window.pdfCheck.stage='render';const value=await render(kind,data);
        if(value.type!=='result'||!(value.bytes instanceof ArrayBuffer)||value.bytes.byteLength>10485760)throw new Error('OUTPUT');
        window.pdfCheck.unchanged&&=before===JSON.stringify(data);if(!window.pdfCheck.unchanged)throw new Error('MUTATION');
        const bytes=new Uint8Array(value.bytes);if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('OUTPUT');
        const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const link=document.createElement('a');
        link.href=url;link.download='local-'+kind+'.pdf';document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);window.pdfCheck.downloads++;window.pdfCheck.stage='ready';status.textContent='Downloaded complete saved PDF';
      }catch(error){window.pdfCheck.stage='failed';window.pdfCheck.code=['TIMEOUT','WORKER_ERROR','SEQUENCE','OUTPUT','MUTATION'].includes(error.message)?error.message:'UNRECOGNIZED';status.textContent='Verification failed';}
      finally{for(const button of document.querySelectorAll('button'))button.disabled=false;}
    };
    document.getElementById('guards').onclick=async()=>{
      try{
        const data=await(await fetch('/fixture/period')).json();
        for(const kind of ['oversize','incomplete','owner']){
          const worker=new Worker('/assets/forecast-analytics-pdf-worker.js');let value;
          try{
            const scope=structuredClone(data.scope);
            if(kind==='oversize'){
              scope.manifest=Array.from({length:20},(_,i)=>({...scope.manifest[0],attemptId:'77777777-7777-4777-8777-'+String(i).padStart(12,'0')}));
              scope.analytics.completedAttempts=20;scope.analytics.bySubject[0].completedAttempts=20;
            }
            value=await exchange(worker,{type:'start',requestId:1,ownerId:kind==='owner'?'22222222-2222-4222-8222-222222222222':ownerId,scope});
            if(kind==='incomplete'){if(value.type!=='ready')throw new Error('GUARD');value=await exchange(worker,{type:'finish',requestId:1});}
            if(value.type!=='error'||Object.keys(value).sort().join(',')!=='code,requestId,type'||value.bytes)throw new Error('GUARD');
            if(kind==='oversize'&&value.code!=='BAR_FORECAST_ANALYTICS_SIZE_LIMIT')throw new Error('GUARD');window.pdfCheck.guards++;
          }finally{worker.terminate();}
        }
        let late=0;const worker=new Worker('/assets/forecast-analytics-pdf-worker.js');worker.onmessage=()=>late++;
        worker.postMessage({type:'start',requestId:1,ownerId,scope:data.scope});worker.terminate();
        await new Promise(resolve=>setTimeout(resolve,250));if(late)throw new Error('GUARD');window.pdfCheck.guards++;
        window.pdfCheck.stage='guards-complete';status.textContent='Safe refusal and cancellation verified';
      }catch{window.pdfCheck.stage='failed';window.pdfCheck.code='GUARD';status.textContent='Verification failed';}
    };
    </script>`;
  const server = createServer((req, res) => {
    observedPaths.push(req.url); res.setHeader('Cache-Control', 'no-store');
    // Test-only blob allowance is required by pinned CLI worker containment;
    // it is not a relaxation or assertion about the real application's CSP.
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' blob: 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; style-src 'none'; img-src 'none'");
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    const key = req.url.match(/^\/fixture\/(period|maximum|selected)$/u)?.[1];
    if (key) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixtures[key])); return; }
    if (req.url === '/assets/forecast-analytics-pdf-worker.js' || req.url === '/assets/forecast-result-pdf-worker.js') {
      res.setHeader('Content-Type', 'application/javascript'); res.end(req.url.includes('analytics') ? bundle.code : selectedBundle.code); return;
    }
    res.statusCode = 404; res.end();
  });
  const privateDir = await mkdtemp(path.join(tmpdir(), 'dd-analytics-pdf-')); const config = path.join(privateDir, 'browser.json');
  const downloads = path.join(privateDir, 'downloads'); const namespace = `ap-${randomBytes(6).toString('hex')}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|pathext|systemroot|windir|comspec|home|userprofile|localappdata|appdata|temp|tmp|tmpdir|user|logname|ci|display|xdg_runtime_dir|xdg_cache_home|lang|lc_all|ld_library_path)$/iu.test(name)));
  let launched = false; let verified = 0;
  const browser = async (...args) => {
    const { stdout } = await command(launcher.exe, [...launcher.prefix, '--namespace', namespace, '--session', 'local',
      '--config', config, '--restore-save', 'never', '--allowed-domains', '127.0.0.1', '--download-path', downloads, '--json', ...args],
    { timeout: 60000, maxBuffer: 1000000, windowsHide: true, env });
    const value = JSON.parse(stdout); assert.equal(value.success, true, 'The isolated browser command must succeed'); return value;
  };
  const observe = async () => JSON.parse((await browser('eval', 'JSON.stringify(window.pdfCheck)')).data?.result || '{}');
  try {
    await writeFile(config, '{"headed":false}', { mode: 0o600 }); await mkdir(downloads);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    launched = true; await browser('open', `http://127.0.0.1:${server.address().port}`); await browser('snapshot', '-i');
    await browser('screenshot', path.join(privateDir, 'loopback-start.png'));
    for (const kind of ['period', 'maximum', 'selected']) for (let repeat = 1; repeat <= 2; repeat++) {
      const candidate = path.join(downloads, `local-${kind}.pdf`);
      await assert.rejects(access(candidate), error => error.code === 'ENOENT');
      await browser('click', `#${kind}`);
      await browser('wait', '--fn', `window.pdfCheck.stage==='failed'||window.pdfCheck.downloads===${verified + 1}`);
      const observation = await observe(); assert.equal(observation.stage, 'ready'); assert.equal(observation.code, 'none');
      assert.equal(observation.downloads, verified + 1); assert.equal(observation.unchanged, true); assert.equal(observation.errors, 0);
      let bytes; const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        let stat; try { stat = await lstat(candidate); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat) {
          assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 10485760);
          bytes = await readFile(candidate); if (bytes.length) break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(bytes, 'The exact native PDF download must complete within its bound');
      assert.deepEqual(bytes, Buffer.from(expected.get(kind)), 'Every actual downloaded byte must equal the complete canonical renderer');
      await rename(candidate, path.join(downloads, `verified-${kind}-${repeat}.pdf`)); verified++;
      assert.equal(JSON.stringify({ fixture, maximum, selected }), baseline);
    }
    await browser('click', '#guards'); await browser('wait', '--fn', "['guards-complete','failed'].includes(window.pdfCheck.stage)");
    const final = await observe(); assert.equal(final.stage, 'guards-complete'); assert.equal(final.guards, 4);
    assert.equal(final.downloads, 6); assert.equal(final.errors, 0); assert.equal(final.unchanged, true);
    assert.deepEqual(final.sequence, ['start', 'append0', 'append1', 'finish', 'start', 'append0', 'append1', 'finish',
      'start', 'append0', 'finish', 'start', 'append0', 'finish']);
    const resources = await browser('eval', "performance.getEntriesByType('resource').every(row=>new URL(row.name,location.href).origin===location.origin)");
    assert.equal(resources.data?.result, true);
    await browser('snapshot', '-i'); await browser('screenshot', path.join(privateDir, 'loopback-complete.png'));
    assert.equal(observedPaths.filter(value => value.startsWith('/fixture/')).length, 7);
    assert.equal(observedPaths.every(value => value.startsWith('/')), true);
  } catch (error) {
    let diagnostic = { stage: 'unavailable', verified };
    try {
      const value = await observe(); diagnostic = { stage: ['ready','fixture','render','failed','guards-complete'].includes(value.stage) ? value.stage : 'unknown',
        code: ['none','TIMEOUT','WORKER_ERROR','SEQUENCE','OUTPUT','MUTATION','UNRECOGNIZED','GUARD'].includes(value.code) ? value.code : 'unknown', verified };
    } catch {}
    throw new Error(`Local native period verification failed: ${JSON.stringify(diagnostic)}`, { cause: error });
  } finally {
    if (launched) await browser('close').catch(() => {});
    if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(privateDir)), path.resolve(tmpdir()));
    assert.match(path.basename(privateDir), /^dd-analytics-pdf-/u);
    await rm(privateDir, { recursive: true, force: true });
  }
});
