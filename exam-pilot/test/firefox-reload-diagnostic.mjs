import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadPlaywright} from './playwright-runtime.mjs';
// Generic browser-engine diagnostic. It never starts an exam or changes data.
// Modes: minimal, exam-shell, or exam-modules. The repeat count defaults to 20.
const mode=process.argv[2]||'minimal',count=Number(process.argv[3]||20);
if(!['minimal','exam-shell','exam-modules'].includes(mode)||!Number.isSafeInteger(count)||count<1||count>200)throw Error('Use minimal|exam-shell|exam-modules and 1 to 200 reloads');
const actualWorker=await readFile(new URL('../public/exam-sw.mjs',import.meta.url),'utf8'),tinyWorker="self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));";
const fixture=`<!doctype html><title>Firefox reload diagnostic</title><h1>Generic worker fixture</h1><script>navigator.serviceWorker.register('/exam-sw.mjs').then(()=>navigator.serviceWorker.ready).then(()=>{document.body.dataset.ready='true'});</script>${mode==='exam-modules'?'<script type="module" src="/student.mjs"></script>':''}`;
const publicRoot=new URL('../public/',import.meta.url);
const http=createServer(async(request,response)=>{try{const path=new URL(request.url,'http://localhost').pathname;if(['/practice','/official','/','/index.html'].includes(path)){response.setHeader('Content-Type','text/html');response.end(fixture);return;}if(path==='/exam-sw.mjs'){response.setHeader('Content-Type','text/javascript');response.end(mode==='minimal'?tinyWorker:actualWorker);return;}if(!/^\/(?:student\.(?:mjs|css)|local-drafts\.mjs|fonts\/(?:inter|fraunces)\.woff2|icons\/[a-z0-9-]+\.svg)$/.test(path)){response.writeHead(404);response.end();return;}response.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'font/woff2');response.end(await readFile(new URL(path.slice(1),publicRoot)));}catch{response.writeHead(500);response.end();}});
await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const origin=`http://localhost:${http.address().port}`;
const server=await loadPlaywright().firefox.launchServer({headless:true}),browser=await loadPlaywright().firefox.connect(server.wsEndpoint()),context=await browser.newContext(),page=await context.newPage(),events=[];let passed=0;
page.on('request',r=>events.push({type:'request',resource:r.resourceType(),path:new URL(r.url()).pathname}));page.on('crash',()=>events.push({type:'crash'}));page.on('pageerror',e=>events.push({type:'pageerror',message:e.message}));
try{await page.goto(`${origin}/practice`,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForFunction(()=>document.body.dataset.ready==='true');for(let i=0;i<count;i++){await page.reload({waitUntil:'domcontentloaded',timeout:10000});await page.getByRole('heading').waitFor({timeout:5000});passed++;}console.log(JSON.stringify({mode,browser:browser.version(),result:'PASS',reloads:passed,examStarted:false}));}
catch(error){console.log(JSON.stringify({mode,browser:browser.version(),result:'FAIL',reloads:passed,error:error.message,events:events.slice(-20),examStarted:false}));process.exitCode=1;}
finally{await Promise.race([context.close(),new Promise(resolve=>setTimeout(resolve,2000))]);await Promise.race([server.kill(),new Promise(resolve=>setTimeout(resolve,2000))]);http.close();}
