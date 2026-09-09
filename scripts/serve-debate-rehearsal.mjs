/** Local development only. This server never authenticates hosted users or contacts providers. */
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, realpath, appendFile } from 'node:fs/promises';
import { createDebateService, DebateServiceError } from '../worker/debate-service.mjs';
import { createDebateStore, createMemoryDebateStoreForTests } from '../worker/debate-store.mjs';
import { createDebateRoutes } from '../worker/debate-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireWorker = createRequire(path.join(ROOT, 'worker/package.json'));
const labels = ['Host / neutral judge', 'Affirmative 1 / captain', 'Affirmative 2', 'Affirmative 3', 'Negative 1 / captain', 'Negative 2', 'Negative 3', 'Panel judge 2', 'Panel judge 3', 'Observer'];
export const REHEARSAL_ACTORS = Object.freeze(labels.map((label, index) => Object.freeze({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  displayName: `${label} (local rehearsal)`, label, email: `debate-local-${index + 1}@example.test`, verified: true,
})));
const RPC_NAMES = new Set(['debate_v3_read','debate_v3_list','debate_v3_receipt','debate_v3_rate_limit','debate_v3_commit','debate_v3_claim_jobs','debate_v3_finish_job','debate_v3_read_job','debate_v3_active_events','debate_v3_discover','debate_v3_reserve_upload','debate_v3_read_upload','debate_v3_complete_upload','debate_v3_fail_upload','debate_v3_expired_jobs']);
const SOURCE_FILES = ['worker/debate-sanctions.mjs','worker/debate-domain.mjs','worker/debate-tournament.mjs','worker/debate-fixtures.mjs','worker/debate-service.mjs','worker/debate-store.mjs','worker/debate-routes.mjs','worker/debate-schema-draft.sql','worker/debate-documents.mjs','assets/debate-room.js','assets/debate-media.js','assets/debate-dates.js','assets/debate-room.css','debate-room/index.html','scripts/serve-debate-rehearsal.mjs','scripts/test-debate-organizer-rehearsal.mjs'];
const fail = (code, message) => { throw new DebateServiceError(code, message); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const isInside = (base, target) => target === base || target.startsWith(`${base}${path.sep}`);

export async function createRehearsalRuntime({ outputDir, storeMode = 'pglite', clockStartMs = Date.now(), autoProcessOutbox = true, resume = false } = {}) {
  if (!['pglite','memory'].includes(storeMode)) throw new Error('Choose --store=pglite or explicit --store=memory. No hosted store is supported.');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const output = path.resolve(outputDir || path.join(ROOT, 'artifacts/debate-local-rehearsal', runId));
  let priorManifest = null;
  if (resume) {
    if (!outputDir || storeMode !== 'pglite') throw new Error('Resuming requires the explicit existing PGlite output directory; memory state cannot be resumed.');
    priorManifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    if (priorManifest.storeMode !== 'pglite' || priorManifest.providerNetwork !== 'DISABLED' || priorManifest.productionChanges !== false) throw new Error('Only a recorded isolated local rehearsal can be resumed.');
    const lastLog = (await readFile(path.join(output, 'request-log.jsonl'), 'utf8')).trim().split('\n').at(-1);
    if (lastLog) { const previous = JSON.parse(lastLog); clockStartMs = previous.simulatedAtMs + Math.max(0, Date.now() - Date.parse(previous.actualAt)); }
  }
  await mkdir(output, { recursive: true });
  const sourceHashes = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex')])));
  let offsetMs = 0, closed = false, logTail = Promise.resolve(); const startedMonotonic = performance.now();
  const now = () => clockStartMs + Math.floor(performance.now() - startedMonotonic) + offsetMs;
  const log = record => { logTail = logTail.then(() => appendFile(path.join(output, 'request-log.jsonl'), `${JSON.stringify({ actualAt: new Date().toISOString(), simulatedAtMs: now(), ...record })}\n`)); return logTail; };
  const advance = async milliseconds => {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 86400000) fail('INVALID_TIME_ADVANCE', 'Advance simulated time by zero to 24 hours.');
    offsetMs += milliseconds; await log({ kind: 'SIMULATED_TIME_ADVANCE', milliseconds, totalOffsetMs: offsetMs, enduranceEvidence: false }); return now();
  };
  let db = null, store;
  if (storeMode === 'pglite') {
    const { PGlite } = await import(pathToFileURL(requireWorker.resolve('@electric-sql/pglite')).href);
    db = new PGlite(path.join(output, 'database'));
    try {
      if (!resume) await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
      await db.exec(await readFile(path.join(ROOT, 'worker/debate-schema-draft.sql'), 'utf8'));
      await db.exec('set role service_role;');
      const rpc = async (name, args) => {
        if (!RPC_NAMES.has(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error('Unexpected local RPC.');
        const keys = Object.keys(args), values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
        return (await db.query(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, values)).rows[0].result;
      };
      store = createDebateStore({ rpc });
    } catch (error) { await db.close(); throw error; }
  } else store = createMemoryDebateStoreForTests();
  const deniedAdapter = kind => async () => fail(`LOCAL_REHEARSAL_${kind.toUpperCase()}_DISABLED`, `${kind} is disabled in this local software rehearsal; no provider connection or outbound delivery was attempted.`);
  const adapters = {
    media: deniedAdapter('media'), mail: deniedAdapter('mail'), upload: deniedAdapter('upload'),
    export: async job => {
      let renderer;
      try { renderer = await import(pathToFileURL(path.join(ROOT, 'worker/debate-documents.mjs')).href); }
      catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') fail('LOCAL_EXPORT_RENDERER_UNAVAILABLE', 'The real Debate document renderer is not available in this local build.'); throw error; }
      const document = await renderer.renderDebateDocument(job.payload.document, { format: job.payload.format || 'pdf' });
      if (!(document.bytes instanceof Uint8Array) || !['application/pdf','text/csv','text/csv; charset=utf-8'].includes(document.mimeType) || !/^[^\r\n/\\]{1,180}$/.test(document.filename)) throw new Error('Document renderer returned unsafe output.');
      const extension = document.mimeType.startsWith('text/csv') ? 'csv' : 'pdf';
      const storageKey = `exports/${job.eventId}/${job.id}.${extension}`, destination = path.resolve(output, storageKey);
      if (!isInside(output, destination)) throw new Error('Invalid generated export location.');
      await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, document.bytes);
      await log({ kind: 'LOCAL_DOCUMENT_GENERATED', jobId: job.id, eventId: job.eventId, resultVersion: job.resultVersion, filename: document.filename, bytes: document.bytes.length, sha256: createHash('sha256').update(document.bytes).digest('hex') });
      return { status: 'completed', downloadId: job.id, storageKey, filename: document.filename, mimeType: document.mimeType };
    },
  };
  const inner = createDebateService({ store, adapters, now, limits: { maxParticipants: 10, approvedRehearsalRecipientIds: REHEARSAL_ACTORS.map(actor => actor.id) } });
  const service = { ...inner, execute: async input => {
    if (!REHEARSAL_ACTORS.some(actor => actor.id === input.actor?.id)) fail('LOCAL_ACTOR_REQUIRED', 'Only the ten fixed synthetic rehearsal identities are available.');
    if (input.command === 'create_event' && input.payload?.rehearsal !== true) fail('LOCAL_REHEARSAL_REQUIRED', 'Select Rehearsal event before creating this local event.');
    try {
      const result = await inner.execute(input);
      await log({ kind: 'COMMAND_COMMITTED', command: input.command, actorId: input.actor.id, eventId: result.event.id, matchId: input.payload?.matchId || null,
        payloadFields: Object.keys(input.payload || {}).filter(key => !/secret|token|password/i.test(key)), receiptId: result.receipt.id, committedRevision: result.receipt.revision });
      if (autoProcessOutbox) { await inner.processOutbox({ eventId: result.event.id, limit: 20 }); result.event = (await inner.snapshot({ actor: input.actor, eventId: result.event.id })).event; }
      return result;
    } catch (error) { await log({ kind: 'COMMAND_REJECTED', command: input.command, actorId: input.actor?.id, eventId: input.eventId, code: error.code || 'UNEXPECTED_ERROR' }); throw error; }
  } };
  const manifest = { runId, createdAt: new Date().toISOString(), outputDir: output, storeMode, databaseEvidence: storeMode === 'pglite' ? 'Actual local draft SQL through service_role; not hosted Postgres concurrency or deployment proof.' : 'Test MemoryStore only; not SQL or persistence evidence.',
    sourceHashes, physicalMedia: 'UNVERIFIED: no physical or synthetic provider media connected.', endurance: 'UNVERIFIED: simulated time never counts toward the required 90-minute run.',
    capacity: 'UNVERIFIED: 10 synthetic identities is not 10 connected media participants.', providerNetwork: 'DISABLED', realEmail: 'DISABLED', productionChanges: false };
  if (resume) { manifest.resumedFromRunId = priorManifest.runId; await writeFile(path.join(output, `resume-${runId}.json`), JSON.stringify(manifest, null, 2)); }
  else await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await log({ kind: resume ? 'RUNTIME_RESUMED' : 'RUNTIME_STARTED', storeMode, sourceHashes, ...(resume ? { resumedFromRunId: priorManifest.runId } : {}) });
  return { service, store, actors: REHEARSAL_ACTORS, outputDir: output, manifest, now, advance, log,
    get offsetMs() { return offsetMs; },
    async close() { if (closed) return; closed = true; await log({ kind: 'RUNTIME_CLOSED' }); await logTail; await db?.close(); },
  };
}

async function buildLocalSite(runtime) {
  const site = path.join(runtime.outputDir, 'site'); await mkdir(path.join(site, 'assets/brand'), { recursive: true }); await mkdir(path.join(site, 'debate-room'), { recursive: true });
  const esbuild = requireWorker('esbuild');
  await esbuild.build({ entryPoints: [path.join(ROOT, 'assets/debate-room.js')], outfile: path.join(site, 'assets/debate-room.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'local-domain-source', setup(build) { build.onResolve({ filter: /(?:^|\/)debate-domain\.js$/ }, () => ({ path: path.join(ROOT, 'worker/debate-domain.mjs') })); } }], });
  const css = (await readFile(path.join(ROOT, 'assets/debate-room.css'), 'utf8')).replace(/@import\s+url\([^)]*\)\s*;/g, '');
  await writeFile(path.join(site, 'assets/debate-room.css'), css);
  for (const filename of ['icon-192.png','favicon.ico']) await copyFile(path.join(ROOT, 'assets/brand', filename), path.join(site, 'assets/brand', filename));
  let html = await readFile(path.join(ROOT, 'debate-room/index.html'), 'utf8');
  // Local actor auth and disconnected media need no SDK/CDN/runtime-secret configuration.
  html = html.replace(/<script\b[^>]*src="[^"]*(?:supabase|phase2-config|auth-session-storage|vendor\/livekit|study-room-backgrounds)[^"]*"[^>]*><\/script>/g, '');
  html = html.replace('</head>', `<script>globalThis.DEBATE_LOCAL_REHEARSAL=true;</script></head>`);
  const toolbar = `<aside id="local-rehearsal-tools" aria-label="Local software rehearsal controls" style="padding:12px 18px;border-bottom:2px solid #c5a059;background:#102c44;display:flex;flex-wrap:wrap;gap:12px;align-items:center;font:14px sans-serif"><strong>LOCAL SOFTWARE REHEARSAL</strong><span>No media, real email or provider traffic. Local font fallback.</span><label style="margin:0">Act as <select id="local-actor" style="max-width:280px">${REHEARSAL_ACTORS.map(actor => `<option value="${actor.id}">${escape(actor.label)}</option>`).join('')}</select></label><button id="local-setup" type="button">Prepare a real rehearsal event</button><button id="local-minute" type="button">Advance simulated time 1 minute</button><span id="local-clock-label"></span><span id="local-tool-status" role="status"></span></aside>
  <script>
  (async()=>{const status=document.getElementById('local-tool-status'),selector=document.getElementById('local-actor');
    const call=async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Local action failed');return j;};
    const identity=await call('/__rehearsal/identity');selector.value=identity.user.id;
    selector.onchange=async()=>{await call('/__rehearsal/actor',{id:selector.value});location.reload();};
    document.getElementById('local-minute').onclick=async()=>{try{const r=await call('/__rehearsal/advance',{milliseconds:60000});document.getElementById('local-clock-label').textContent='Simulated offset '+Math.round(r.offsetMs/60000)+' min; not endurance evidence';}catch(e){status.textContent=e.message;}};
    document.getElementById('local-setup').onclick=async e=>{e.target.disabled=true;status.textContent='Creating via actual service commands…';try{const r=await call('/__rehearsal/setup',{});await call('/__rehearsal/actor',{id:identity.actors[0].id});location.hash='event='+encodeURIComponent(r.eventId)+'&match='+encodeURIComponent(r.matchId);location.reload();}catch(e){status.textContent=e.message;e.target.disabled=false;}};
  })().catch(e=>{document.getElementById('local-tool-status').textContent=e.message;});
  </script>`;
  html = html.replace('<body>', `<body>${toolbar}`); await writeFile(path.join(site, 'debate-room/index.html'), html);
  return { site, allowed: new Map([
    ['/debate-room/', 'debate-room/index.html'], ['/debate-room/index.html', 'debate-room/index.html'],
    ['/assets/debate-room.js', 'assets/debate-room.js'], ['/assets/debate-room.css', 'assets/debate-room.css'],
    ['/assets/brand/icon-192.png', 'assets/brand/icon-192.png'], ['/assets/brand/favicon.ico', 'assets/brand/favicon.ico'],
  ]) };
}

export async function startLocalDebateServer({ port = 4178, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid localhost port.');
  const runtime = await createRehearsalRuntime(options); let server;
  try {
    const { site, allowed } = await buildLocalSite(runtime), secret = randomBytes(32).toString('hex');
    const tokens = new Map(runtime.actors.map(actor => [`local-rehearsal:${actor.id}:${secret}`, actor]));
    const tokenFor = actor => `local-rehearsal:${actor.id}:${secret}`;
    let addressPort = port, setupInProgress = false;
    const actorForCookie = request => runtime.actors.find(actor => actor.id === /(?:^|;\s*)dd_debate_local_actor=([^;]+)/.exec(request.headers.cookie || '')?.[1]) || runtime.actors[0];
    const routes = createDebateRoutes({ service: runtime.service, authenticate: request => tokens.get((request.headers.get('authorization') || '').replace(/^Bearer /, '')) || null });
    const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" };
    const json = (response, body, status = 200, extra = {}) => { response.writeHead(status, { ...headers, 'Content-Type':'application/json; charset=utf-8', ...extra }); response.end(JSON.stringify(body)); };
    const readBody = async (request, max = 262144) => { let size = 0; const chunks = []; for await (const chunk of request) { size += chunk.length; if (size > max) fail('PAYLOAD_TOO_LARGE','Local request is too large.'); chunks.push(chunk); } return Buffer.concat(chunks); };
    server = http.createServer(async (request, response) => {
      try {
        const host = request.headers.host || '', allowedHosts = [`127.0.0.1:${addressPort}`, `localhost:${addressPort}`];
        if (request.socket.remoteAddress !== '127.0.0.1' || !allowedHosts.includes(host)) return json(response, { ok:false,error:{code:'LOCALHOST_ONLY',message:'Only this exact loopback origin is allowed.'}},403);
        const origin = `http://${host}`, url = new URL(request.url || '/', origin);
        if (request.headers.origin && request.headers.origin !== origin) return json(response,{ok:false,error:{code:'ORIGIN_NOT_ALLOWED',message:'Cross-origin local requests are disabled.'}},403);
        if (!['GET','POST','HEAD'].includes(request.method)) return json(response,{ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'Unsupported local method.'}},405);
        if (request.method === 'POST' && request.headers.origin !== origin) return json(response,{ok:false,error:{code:'ORIGIN_REQUIRED',message:'A same-origin request is required.'}},403);
        const pathname = decodeURIComponent(url.pathname);
        if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) return json(response,{ok:false,error:{code:'NOT_FOUND',message:'File unavailable.'}},404);
        if (pathname === '/__rehearsal/identity' && request.method === 'GET') {
          const actor = actorForCookie(request); return json(response,{token:tokenFor(actor),user:{id:actor.id,email:actor.email,user_metadata:{full_name:actor.displayName}},actors:runtime.actors.map(({id,label})=>({id,label})),storeMode:runtime.manifest.storeMode,localOnly:true,offsetMs:runtime.offsetMs});
        }
        if (pathname === '/__rehearsal/status' && request.method === 'GET') return json(response,{ok:true,runId:runtime.manifest.runId,storeMode:runtime.manifest.storeMode,serverNow:runtime.now(),offsetMs:runtime.offsetMs,providerNetwork:'DISABLED',realEmail:'DISABLED'});
        if (pathname.startsWith('/__rehearsal/') && request.method === 'POST') {
          let body; try { body = JSON.parse((await readBody(request,4096)).toString('utf8')); } catch { fail('INVALID_JSON','Local action must be JSON.'); }
          if (pathname === '/__rehearsal/actor') { const actor=runtime.actors.find(a=>a.id===body.id);if(!actor)fail('LOCAL_ACTOR_REQUIRED','Choose one of the ten local identities.');await runtime.log({kind:'ACTOR_SWITCH',actorId:actor.id});return json(response,{ok:true,actorId:actor.id},200,{'Set-Cookie':`dd_debate_local_actor=${actor.id}; Path=/; SameSite=Strict; HttpOnly`}); }
          if (pathname === '/__rehearsal/advance') { await runtime.advance(body.milliseconds);return json(response,{ok:true,serverNow:runtime.now(),offsetMs:runtime.offsetMs,enduranceEvidence:false}); }
          if (pathname === '/__rehearsal/setup') {
            if(setupInProgress)fail('SETUP_PENDING','A local event setup is already running.');setupInProgress=true;
            try{const {runOrganizerRehearsal}=await import('./test-debate-organizer-rehearsal.mjs');const result=await runOrganizerRehearsal(runtime,{mode:'setup'});return json(response,{ok:true,eventId:result.eventId,matchId:result.matchId});}finally{setupInProgress=false;}
          }
          return json(response,{ok:false,error:{code:'NOT_FOUND',message:'Unknown local control.'}},404);
        }
        if (pathname === '/debate-room/media') return json(response,{ok:false,error:{code:'LOCAL_REHEARSAL_MEDIA_DISABLED',message:'Media provider connections are disabled in this local software rehearsal. No camera or microphone evidence is claimed.'}},503);
        if (pathname === '/debate-room/outbox' && request.method === 'POST') {
          const actor=tokens.get(String(request.headers.authorization||'').replace(/^Bearer /,''));if(!actor)fail('AUTH_REQUIRED','Choose a local identity.');
          if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||''))fail('INVALID_CONTENT_TYPE','Send this action as JSON.');
          let body;try{body=JSON.parse((await readBody(request,4096)).toString('utf8'));}catch{fail('INVALID_JSON','This local action must be JSON.');}
          await runtime.service.snapshot({actor,eventId:body?.eventId});
          const outcomes=await runtime.service.processOutbox({eventId:body.eventId,limit:20});
          await runtime.log({kind:'AUTHORIZED_OUTBOX_PROCESS',actorId:actor.id,eventId:body.eventId,outcomes:outcomes.map(({jobId,status,error})=>({jobId,status,error}))});
          return json(response,{ok:true,outcomes,...await runtime.service.snapshot({actor,eventId:body.eventId})});
        }
        if (pathname === '/debate-room/download' && request.method === 'GET') {
          const actor=tokens.get(String(request.headers.authorization||'').replace(/^Bearer /,''));if(!actor)fail('AUTH_REQUIRED','Choose a local identity.');
          const authorized=await runtime.service.authorizeDownload({actor,eventId:url.searchParams.get('eventId'),downloadId:url.searchParams.get('downloadId')});
          const target=path.resolve(runtime.outputDir,authorized.storageKey||''), exportsRoot=path.join(runtime.outputDir,'exports');
          if(!isInside(exportsRoot,target)||!isInside(exportsRoot,await realpath(target)))fail('NOT_FOUND','The generated local export is unavailable.');
          const bytes=await readFile(target);response.writeHead(200,{...headers,'Content-Type':authorized.mimeType,'X-Debate-Filename':authorized.filename,'Content-Disposition':`attachment; filename="${authorized.filename.replace(/["\r\n]/g,'_')}"`});return response.end(bytes);
        }
        if (pathname.startsWith('/debate-room/') && !allowed.has(pathname)) {
          const body=request.method==='POST'?await readBody(request):null;
          const upstream=new Request(url,{method:request.method,headers:request.headers,...(body?{body}: {})});
          const result=await routes.handle(upstream);if(result){response.writeHead(result.status,{...headers,...Object.fromEntries(result.headers)});return response.end(Buffer.from(await result.arrayBuffer()));}
        }
        if(pathname==='/'&&request.method==='GET'){response.writeHead(302,{...headers,Location:'/debate-room/'});return response.end();}
        const relative=allowed.get(pathname);if(!relative||!['GET','HEAD'].includes(request.method))return json(response,{ok:false,error:{code:'NOT_FOUND',message:'Only the built Debate Room is served here.'}},404);
        const target=path.resolve(site,relative);if(!isInside(site,await realpath(target)))throw new Error('Unsafe static path.');
        const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon'}[path.extname(target)];
        response.writeHead(200,{...headers,'Content-Type':mime});response.end(request.method==='HEAD'?undefined:await readFile(target));
      }catch(error){await runtime.log({kind:'HTTP_REJECTED',code:error.code||'UNEXPECTED_ERROR'});json(response,{ok:false,error:{code:error.code||'LOCAL_SERVER_ERROR',message:error.code?error.message:'The local rehearsal request failed; saved local state remains available.'}},error.code==='AUTH_REQUIRED'?401:/FORBIDDEN|NOT_MEMBER|ORIGIN/.test(error.code||'')?403:400);}
    });
    server.requestTimeout=20000;server.headersTimeout=15000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});addressPort=server.address().port;
    const url=`http://127.0.0.1:${addressPort}/debate-room/`;await writeFile(path.join(runtime.outputDir,'server.json'),JSON.stringify({pid:process.pid,url,port:addressPort,outputDir:runtime.outputDir},null,2));
    await runtime.log({kind:'SERVER_STARTED',pid:process.pid,url});
    return {...runtime,url,port:addressPort,async close(){await new Promise(resolve=>server.close(resolve));await runtime.close();}};
  }catch(error){server?.close();await runtime.close();throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
  const server=await startLocalDebateServer({port:Number(option('port')||4178),storeMode:option('store')||'pglite',outputDir:option('output'),resume:process.argv.includes('--resume')});
  process.stdout.write(`${JSON.stringify({url:server.url,pid:process.pid,outputDir:server.outputDir,storeMode:server.manifest.storeMode,media:'DISABLED',mail:'DISABLED'})}\n`);
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await server.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
