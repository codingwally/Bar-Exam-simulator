/** Credential-free component rendering only; no hosted account or full-site claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/debate-local-rehearsal/home-display-browser');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = ['index.html', 'assets/lex-forum.js', 'assets/lex-forum.css', 'assets/quorum-first-shell.css', 'assets/phase2-experience.js', 'assets/icons/community/camera.svg', 'assets/icons/navigation/mic.svg', 'assets/vendor/debate-fonts/inter-v20-latin.woff2', 'assets/vendor/debate-fonts/fraunces-v38-latin.woff2'];
const exactFunction = (source, name) => {
  const match = source.replace(/\r\n/g, '\n').match(new RegExp(`  function ${name}\\([\\s\\S]*?\\n  }\\n`));
  assert.ok(match, `Source function ${name} exists`); return match[0];
};

export async function buildDisplayFixture() {
  const bytes = Object.fromEntries(await Promise.all(sourcePaths.map(async name => [name, await readFile(path.join(root, name))])));
  const index = bytes['index.html'].toString(), forum = bytes['assets/lex-forum.js'].toString(), account = bytes['assets/phase2-experience.js'].toString();
  const notice = index.match(/<section class="lex-notice-card">[\s\S]*?<\/section>/)[0];
  const study = index.match(/<button class="quorum-nav-link quorum-nav-study-room"[\s\S]*?<\/button>/)[0].replace(/ hidden(?=>)/, '');
  const debate = index.match(/<a class="quorum-nav-link" data-debate-room-entry[\s\S]*?<\/a>/)[0].replace(/ hidden(?=>)/, '');
  const schoolList = account.match(/  const lawSchools = Object\.freeze\(\[[\s\S]*?\n  \]\);/)[0];
  const runtime = [schoolList, ...['schoolDisplayName','formatSchoolName'].map(name => exactFunction(account, name)), ...['academicDetails','authorBlock','textElement','initials'].map(name => exactFunction(forum, name))].join('\n');
  const head = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home display component review</title><link rel="icon" href="data:,"><style>
    @font-face{font-family:Inter;font-style:normal;font-weight:100 900;src:url('/assets/vendor/debate-fonts/inter-v20-latin.woff2')}@font-face{font-family:Fraunces;font-style:normal;font-weight:400 700;src:url('/assets/vendor/debate-fonts/fraunces-v38-latin.woff2')}
    body{margin:0;font-family:Inter,sans-serif}*{box-sizing:border-box}.review-label{padding:16px;background:#fff;color:#13243b;font-size:13px}.review-author{padding:20px;border-bottom:1px solid #d8dee8}
    </style><link rel="stylesheet" href="/assets/quorum-first-shell.css"><link rel="stylesheet" href="/assets/lex-forum.css"><body>`;
  const home = `${head}<div class="review-label">Component review · Synthetic members · No sign-in or service requests</div><section id="page-community"><div class="lex-page-wrap"><div class="lex-layout"><div class="lex-primary" id="review-authors"></div><aside class="lex-secondary">${notice}</aside></div></div></section><script>
    const global=window; const state={profile:{school:'PRIVATE_VIEWER_SCHOOL'}}; function showMemberProfile(){throw Error('Profile actions are excluded from this component review')}
    ${runtime}
    global.DueDiligencePhase2={formatSchoolName};
    for(const author of [{displayName:'Sample Member One',school:'san-beda-college-alabang',yearLevel:'first_year'},{displayName:'Sample Member Two',school:'liceo-de-cagayan-university',yearLevel:'review'},{displayName:'Sample Alias',anonymous:true,school:'PRIVATE_SCHOOL',yearLevel:'PRIVATE_YEAR'}]){const row=document.createElement('div');row.className='review-author';row.append(authorBlock(author));document.getElementById('review-authors').append(row)}
    </script></body></html>`;
  const nav = `${head}<header id="site-header" class="qfs-shell"><nav id="spa-nav" class="qfs-drawer is-open"><div class="quorum-nav-heading"><p>Menu</p></div>${study}${debate}</nav></header></body></html>`;
  return { bytes, pages: { '/home': home, '/navigation': nav }, sourceHashes: Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, digest(value)])) };
}

export async function runHomeDisplayBrowser() {
  assert.equal(process.platform, 'linux', 'Browser rendering runs only on isolated Linux CI.');
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.HOME_DISPLAY_BROWSER_CI, '1');
  await mkdir(output, { recursive: true });
  const fixture = await buildDisplayFixture();
  const systemEnv = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','DISPLAY'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const report = { status: 'RUNNING', scope: 'PRODUCT_COMPONENT_CSS_HTML_AND_RENDERER_WITH_SYNTHETIC_NAMES', sourceSha: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, env: systemEnv, encoding:'utf8' }).trim(), testSha256: digest(await readFile(fileURLToPath(import.meta.url))), sourceHashes: fixture.sourceHashes, checks: [], screenshots: [], measurements: [], unexpectedNetwork: 0, actualHostedAuth: false, fullWebsiteAcceptance: false, customerDataStored: false, deploymentPerformed: false };
  const check = (name, value) => { if (!value) report.failedCheck = name; assert.ok(value, name); report.checks.push(name); };
  let browser;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const page = fixture.pages[pathname], asset = fixture.bytes[pathname.slice(1)];
    if (!page && !asset) { res.writeHead(404); res.end(); return; }
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('Content-Type', page ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2');
    res.end(page || asset);
  });
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = createRequire(import.meta.url)('playwright');
    browser = await chromium.launch({ headless:true, channel:'chrome', env:systemEnv });
    const context = await browser.newContext({ reducedMotion:'reduce', serviceWorkers:'block' });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET' && (fixture.pages[url.pathname] || fixture.bytes[url.pathname.slice(1)])) return route.continue();
      report.unexpectedNetwork++; return route.abort();
    });
    const page = await context.newPage(); const pageErrors = []; page.on('pageerror', () => pageErrors.push('PAGE_ERROR'));
    for (const viewport of [{width:1909,height:850},{width:1280,height:720},{width:390,height:844}]) {
      await page.setViewportSize(viewport); await page.goto(origin+'/home'); await page.evaluate(() => document.fonts.ready);
      const measured = await page.locator('.lex-notice-card p').evaluate(element => {
        const color = getComputedStyle(element).color, background = getComputedStyle(document.getElementById('page-community')).backgroundColor;
        const luminance = text => { const rgb = text.match(/[\d.]+/g).slice(0,3).map(Number).map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4); return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; };
        const a=luminance(color),b=luminance(background),rect=element.getBoundingClientRect();
        return {color,background,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),width:rect.width,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,pageWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth};
      });
      report.measurements.push({viewport,notice:measured});
      check(`Notice contrast at ${viewport.width}px is at least4.5:1`, measured.contrast>=4.5);
      check(`Notice text at ${viewport.width}px is not clipped`, measured.scrollHeight<=measured.clientHeight && measured.width>0);
      check(`Component page at ${viewport.width}px has no horizontal overflow`, measured.pageWidth<=measured.viewportWidth);
      const labels = await page.locator('.lex-author-copy>span').allTextContents();
      check(`Actual author renderer has readable public labels and preserved anonymity at ${viewport.width}px`, JSON.stringify(labels)===JSON.stringify(['San Beda College Alabang · First Year','Liceo de Cagayan University · Review / Bar Candidate','Anonymous']));
      const homeFile=`home-${viewport.width}x${viewport.height}.png`; await page.screenshot({path:path.join(output,homeFile),fullPage:true}); report.screenshots.push({file:homeFile,sha256:digest(await readFile(path.join(output,homeFile)))});
      await page.goto(origin+'/navigation'); await page.evaluate(() => document.fonts.ready);
      for (const [selector, assetPath] of [['#spa-study-room','/assets/icons/community/camera.svg'],['[data-debate-room-entry]','/assets/icons/navigation/mic.svg']]) {
        const control=page.locator(selector); await control.hover({trial:true});
        const icon=await control.evaluate(element=>{const style=getComputedStyle(element,'::before'),rect=element.getBoundingClientRect();return {mask:style.maskImage,width:style.width,height:style.height,left:rect.left,right:rect.right,viewportWidth:innerWidth};});
        check(`${selector} at ${viewport.width}px uses its real SVG mask`,icon.mask.includes(assetPath)&&icon.width==='20px'&&icon.height==='20px');
        check(`${selector} at ${viewport.width}px remains reachable`,icon.left>=0&&icon.right<=icon.viewportWidth);
      }
      const navFile=`navigation-${viewport.width}x${viewport.height}.png`;await page.screenshot({path:path.join(output,navFile),fullPage:true});report.screenshots.push({file:navFile,sha256:digest(await readFile(path.join(output,navFile)))});
    }
    check('No page errors or external requests',pageErrors.length===0&&report.unexpectedNetwork===0);
    report.status='PASS_COMPONENT_BROWSER';
  } catch { report.status='FAIL_COMPONENT_BROWSER'; throw new Error('Home display component browser verification failed; see sanitized report.'); }
  finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n'); }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) runHomeDisplayBrowser().catch(error=>{console.error(error.message);process.exitCode=1;});
