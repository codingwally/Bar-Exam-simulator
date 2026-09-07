import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { buildForecastPdfBrowserWorker } from './build-forecast-pdf-browser-worker.mjs';
import { buildForecastResultPdf, validateSavedForecastForExport } from '../worker/forecast-result-export.mjs';
import { OWNER, curatedFixture, withMaximumAnswers } from '../worker/forecast-result-layout-fixture.mjs';

const bundle = await buildForecastPdfBrowserWorker();
const small = await curatedFixture(); const maximum = withMaximumAnswers(small);
const hash = value => createHash('sha256').update(value).digest('hex');
const command = promisify(execFile);
// Local diagnosis can run just the real browser; the normal and --browser gates
// always execute all core parity/security cases without skips.
const coreTest = process.argv.includes('--browser-only') ? test.skip : test;
const frontend = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
const snapshotStart = frontend.indexOf('  function forecastPdfRenderingSnapshot(');
const snapshotEnd = frontend.indexOf('  function noteBrowserPdfPrepared(', snapshotStart);
assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, 'The shipped canonical rendering projection must be isolated exactly.');
const snapshotSource = frontend.slice(snapshotStart, snapshotEnd);
const projectSnapshot = vm.runInNewContext(`(${snapshotSource.trim()})`);

async function bundledRender(message) {
  const messages = []; let closed = 0;
  const self = { postMessage: (value, transfer) => messages.push({ value, transfer }), close: () => { closed++; } };
  vm.runInNewContext(new TextDecoder().decode(bundle.code), { self, console: { log() { throw new Error('NO_PUBLIC_LOGS'); } },
    Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout, crypto: webcrypto }, { timeout: 10000 });
  await self.onmessage({ data: message });
  assert.equal(messages.length, 1); assert.equal(closed, 1);
  return messages[0];
}

coreTest('browser bundle has no server provider, private fixture, auth transport or corpus dependency', () => {
  assert.ok(bundle.code.length > 0 && bundle.code.length < 3_000_000);
  assert.equal(bundle.inputs.some(name => /fixture|\.test\.mjs|forecast-result-export\.mjs|content\//u.test(name)), false);
  assert.doesNotMatch(new TextDecoder().decode(bundle.code), /SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|generativelanguage|gemini|Local synthetic resource fixture|Bearer /iu);
});

coreTest('actual bundled worker equals Node renderer for Unicode20 and maximum20x6000 and never mutates saved results', async () => {
  for (const [attempt, expected] of [[small, '7b6de709318e3899ddfdd5d9334e2bdc77534055209dd481b8870795789e323a'],
    [maximum, '332d07f769d9ad957beb10ad451b0c23864c5bad768064fe83096e44413f7450']]) {
    const before = JSON.stringify(attempt); validateSavedForecastForExport(attempt, OWNER);
    const nodeBytes = await buildForecastResultPdf({ attempt, ownerId: OWNER }); assert.equal(hash(nodeBytes), expected);
    for (let repeat = 0; repeat < 2; repeat++) {
      const { value, transfer } = await bundledRender({ type: 'render', requestId: 1, ownerId: OWNER, attempt: projectSnapshot(attempt) });
      assert.equal(value.type, 'result'); assert.equal(value.attemptId, attempt.id);
      assert.equal(value.resultRevision, 1); assert.equal(value.pdfVersion, 'forecast-pdf-v1');
      assert.equal(transfer.length, 1); assert.equal(transfer[0], value.bytes);
      assert.deepEqual(new Uint8Array(value.bytes), nodeBytes);
    }
    assert.equal(JSON.stringify(attempt), before);
  }
});

coreTest('bundled render worker rejects wrong owner, incomplete data and credential-bearing envelopes with fixed errors', async () => {
  for (const message of [
    { type: 'render', requestId: 1, ownerId: '22222222-2222-4222-8222-222222222222', attempt: small },
    { type: 'render', requestId: 1, ownerId: OWNER, attempt: { ...small, status: 'processing' } },
    { type: 'render', requestId: 1, ownerId: OWNER, attempt: small, access_token: 'PRIVATE_TOKEN' },
  ]) {
    const { value } = await bundledRender(message);
    assert.equal(value.type, 'error'); assert.ok(['BAR_FORECAST_EXPORT_NOT_READY', 'BAR_FORECAST_PDF_RENDER_FAILED'].includes(value.code));
    assert.deepEqual(Object.keys(value).sort(), ['code', 'requestId', 'type']);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_TOKEN|11111111|answer|owner|http/iu);
  }
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

// Explicit opt-in uses the installed browser against an inert loopback fixture,
// not a customer session, authentication stub or website/provider endpoint.
if (process.argv.includes('--browser') || process.argv.includes('--browser-only')) test('actual isolated browser worker preserves all PDF bytes twice at both sizes with no external network', async () => {
  const launcher = await browserLauncher();
  const expected = new Map();
  for (const [kind, attempt] of [['small', small], ['maximum', maximum]]) expected.set(kind, await buildForecastResultPdf({ attempt, ownerId: OWNER }));
  const received = new Map(); const localPaths = [];
  const html = `<!doctype html><meta charset="utf-8"><title>Local PDF parity verification</title>
    <button id="start">Verify saved PDF bytes</button><output id="status">Ready</output>
    <script>
    window.localPdfDiagnostic={stage:'ready',code:'none'};
    document.getElementById('start').onclick=async()=>{
      document.getElementById('start').disabled=true;
      try {
        for(const kind of ['small','maximum']) for(let repeat=1;repeat<=2;repeat++) {
          window.localPdfDiagnostic.stage='fixture';
          const attempt=await (await fetch('/fixture/'+kind)).json();
          window.localPdfDiagnostic.stage='render';
          const data=await new Promise((resolve,reject)=>{
            const worker=new Worker('/assets/forecast-result-pdf-worker.js');
            const timeout=setTimeout(()=>{worker.terminate();reject(new Error('RENDER_TIMEOUT'));},60000);
            worker.onerror=()=>{clearTimeout(timeout);worker.terminate();reject(new Error('RENDER_FAILED'));};
            worker.onmessage=({data})=>{clearTimeout(timeout);worker.terminate();data.type==='result'?resolve(data):reject(new Error('RENDER_REJECTED'));};
            worker.postMessage({type:'render',requestId:1,ownerId:${JSON.stringify(OWNER)},attempt});
          });
          window.localPdfDiagnostic.stage='compare';
          // ASCII encoding keeps the CLI's CDP network guard from interpreting
          // binary PDF bytes as a request-text field. Node decodes every byte.
          const bytes=new Uint8Array(data.bytes);let binary='';
          for(let start=0;start<bytes.length;start+=16384) binary+=String.fromCharCode(...bytes.subarray(start,start+16384));
          const response=await fetch('/pdf-result/'+kind+'/'+repeat,{method:'POST',headers:{'Content-Type':'text/plain'},body:btoa(binary)});
          if(!response.ok)throw new Error('BYTES_REJECTED');
        }
        document.getElementById('status').textContent='All four PDF byte comparisons passed.';
        document.getElementById('status').id='complete';
        window.localPdfDiagnostic.stage='complete';
      } catch(error) {
        window.localPdfDiagnostic.code=['RENDER_TIMEOUT','RENDER_FAILED','RENDER_REJECTED','BYTES_REJECTED'].includes(error?.message)?error.message:'UNRECOGNIZED';
        document.getElementById('status').textContent='Local verification failed';document.getElementById('status').id='failed';
      }
    };
    </script>`;
  const server = createServer(async (req, res) => {
    localPaths.push(req.url);
    res.setHeader('Cache-Control', 'no-store');
    // The pinned CLI wraps dedicated workers in guarded blob bootstraps. Its
    // repeated command-level guards may import a second same-origin bootstrap;
    // permit that local wrapper without enabling any remote network source.
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' blob: 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; style-src 'none'; img-src 'none'");
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (req.url === '/assets/forecast-result-pdf-worker.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.code); return; }
    const fixture = req.url.match(/^\/fixture\/(small|maximum)$/u)?.[1];
    if (fixture) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(projectSnapshot(fixture === 'small' ? small : maximum))); return; }
    const result = req.url.match(/^\/pdf-result\/(small|maximum)\/([12])$/u);
    if (result && req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 10 * 1024 * 1024) { res.statusCode = 413; res.end(); return; } chunks.push(chunk); }
      const encoded = Buffer.concat(chunks).toString('ascii');
      const bytes = Buffer.from(encoded, 'base64'); const valid = bytes.toString('base64') === encoded
        && bytes.equals(Buffer.from(expected.get(result[1])));
      received.set(`${result[1]}-${result[2]}`, valid); res.statusCode = valid ? 204 : 409; res.end(); return;
    }
    res.statusCode = 404; res.end();
  });
  const privateDir = await mkdtemp(path.join(tmpdir(), 'dd-forecast-pdf-'));
  const config = path.join(privateDir, 'browser.json'); const namespace = `fp-${randomBytes(6).toString('hex')}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|pathext|systemroot|windir|comspec|home|userprofile|localappdata|appdata|temp|tmp|tmpdir|user|logname|ci|display|xdg_runtime_dir|xdg_cache_home|lang|lc_all|ld_library_path)$/iu.test(name)));
  let launched = false;
  const browser = async (...args) => {
    const { stdout } = await command(launcher.exe, [...launcher.prefix, '--namespace', namespace, '--session', 'local',
      '--config', config, '--restore-save', 'never', '--allowed-domains', '127.0.0.1', '--json', ...args],
    { timeout: 60000, maxBuffer: 1000000, windowsHide: true, env });
    const value = JSON.parse(stdout); assert.equal(value.success, true, 'The isolated browser command must succeed'); return value;
  };
  try {
    await writeFile(config, '{"headed":false}', { mode: 0o600 });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    launched = true; await browser('open', origin); await browser('snapshot', '-i'); await browser('click', '#start');
    await browser('wait', '--fn', "Boolean(document.getElementById('complete')||document.getElementById('failed'))");
    const observation = await browser('eval', 'JSON.stringify(window.localPdfDiagnostic)');
    assert.equal(observation.data?.result, JSON.stringify({ stage: 'complete', code: 'none' }), 'Local browser render must complete');
    assert.equal(received.size, 4); assert.equal([...received.values()].every(Boolean), true);
    assert.equal(localPaths.filter(value => value.startsWith('/pdf-result/')).length, 4);
    assert.equal(localPaths.every(value => value.startsWith('/')), true);
  } catch (error) {
    let diagnostic;
    try {
      if (!launched) throw new Error('BROWSER_NOT_STARTED');
      const observation = await browser('eval', 'JSON.stringify(window.localPdfDiagnostic)');
      const value = JSON.parse(observation.data?.result || '{}');
      diagnostic = { stage: ['ready','fixture','render','compare','complete'].includes(value.stage) ? value.stage : 'unknown',
        code: ['none','RENDER_TIMEOUT','RENDER_FAILED','RENDER_REJECTED','BYTES_REJECTED','UNRECOGNIZED'].includes(value.code) ? value.code : 'unknown',
        workerRequests: localPaths.filter(value => value === '/assets/forecast-result-pdf-worker.js').length,
        fixtureRequests: localPaths.filter(value => value.startsWith('/fixture/')).length,
        compared: received.size };
    } catch { diagnostic = { stage: 'unavailable' }; }
    throw new Error(`Loopback PDF verification failed: ${JSON.stringify(diagnostic)}`, { cause: error });
  } finally {
    if (launched) await browser('close').catch(() => {});
    if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(privateDir)), path.resolve(tmpdir()));
    assert.match(path.basename(privateDir), /^dd-forecast-pdf-/u);
    await rm(privateDir, { recursive: true, force: true });
  }
});
