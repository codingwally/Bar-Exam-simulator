// Inert native DOM regression. No account, network application, model or camera.
// --browser requires the existing pinned agent-browser0.36.0 installation.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createServer } from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = '1f95f1d6baac05e5b519278aa3f4509dd5dbc317';
const run = promisify(execFile);
const hash = text => createHash('sha256').update(text).digest('hex');
export function extractFunction(source, name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Actual function is missing: ${name}`);
  const following = source.slice(start + 5).search(/^  (?:async )?function /m);
  assert.ok(following >= 0);
  return source.slice(start, start + 5 + following).trim();
}
function fixtureFunctions(source) {
  const a = source.indexOf('export function fixtureAnswer('), b = source.indexOf('\nexport function forecastEditorChunkSource(', a);
  const c = source.indexOf('\n// A DOM click', b);
  assert.ok(a >= 0 && b > a && c > b);
  return vm.runInNewContext(`(() => { ${source.slice(a, c).replaceAll('export function ', 'function ')};return {fixtureAnswer,forecastEditorChunkSource};})()`,
    { assert, Buffer, BAR_FORECAST_LIMITS: { answerCharacters: 6000 } });
}
export function editorProbeSource(source, css, answers, chunkSources) {
  const names = ['wordCount', 'answerParagraphPlaceholder', 'answerParagraphText', 'answerPlainText', 'sanitizeAnswerMarkup', 'placeCaretAtEnd',
    'captureAnswerFromEditor', 'selectedAnswerLength', 'insertPlainAnswerText', 'sanitizeEditorDom',
    'allAnswersComplete', 'freezeSubmission', 'syncExam', 'submitForecast'];
  const functions = names.filter(name => !name.startsWith('answerParagraph') || source.includes(`function ${name}(`))
    .map(name => extractFunction(source, name)).join('\n');
  const start = source.indexOf("    editor.addEventListener('paste'");
  const end = source.indexOf("    editor.addEventListener('keydown'", start);
  assert.ok(start >= 0 && end > start); const handlers = source.slice(start, end);
  return `(async () => {
    const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.replaceChildren(style);
    const global=window,MAX_ANSWER_CHARACTERS=6000,REQUIRED_QUESTION_COUNT=20,MINIMUM_WORDS=10;
    const answers=${JSON.stringify(answers)},maximum=answers[19];
    const state={view:'exam',currentIndex:0,questions:[{id:'q1',number:1}],answers:new Map(),answerMarkup:new Map(),answerFontSize:16,
      clientAttemptId:'22222222-2222-4222-8222-222222222222',subject:'Civil Law and Land Titles and Deeds',setId:'sha256:'+'a'.repeat(64)};
    const syncExamCompletion=()=>{},scheduleForecastDraftSave=()=>{},syncEditorToolbarState=()=>{},subjectSchedule=()=>null,renderPromptHighlights=()=>{},setStatus=()=>{};
    const persistForecastDraft=()=>true;let submitted=null;const sendForecastSubmission=async()=>{submitted=state.submissionSnapshot;};
    ${functions}
    const out=[];
    const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
    for(const mode of ['short-paste','blank-boundaries-paste','literal-html-paste','maximum-paste','replace-entire-paste','replace-partial-paste','undo-redo-paste','maximum-drop','plain-restore','overlimit-capture','paragraph-enter','rich-markup','list-markup','maximum20-final-no-input']) {
      document.body.replaceChildren();state.currentIndex=0;state.questions=[{id:'q1',number:1}];state.answers.clear();state.answerMarkup.clear();submitted=null;
      const editor=document.createElement('div');editor.className='bf26-answer';editor.id='bf26-current-answer';editor.contentEditable='true';document.body.append(editor);
      state.examRefs={editor,...Object.fromEntries(['metaSubject','metaSchedule','metaQuestion','questionLabel'].map(k=>[k,document.createElement('span')]))};
      ${handlers}
      editor.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
      let expected=['short-paste','paragraph-enter'].includes(mode)?'Alpha\\n\\nBeta':mode==='rich-markup'?'Bold\\nItalic':maximum;
      if(mode==='blank-boundaries-paste')expected='\\n\\nAlpha\\n\\nBeta\\n\\n';
      if(mode==='literal-html-paste')expected='<b>not markup</b> & <script>not code</script>\\n\\nLast line';
      if(mode==='list-markup')expected='One\\nTwo';
      let inserted=expected;
      if(mode==='replace-entire-paste'||mode==='replace-partial-paste'){
        if(mode==='replace-partial-paste')expected='Keep '+maximum.slice(5);
        editor.innerText=expected;captureAnswerFromEditor();range.selectNodeContents(editor);
        if(mode==='replace-partial-paste'){range.setStart(editor.firstChild,5);inserted=maximum.slice(5);}
        selection.removeAllRanges();selection.addRange(range);
      }
      if(mode.endsWith('paste')){const data=new DataTransfer();data.setData('text/plain',inserted);editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));}
      else if(mode==='maximum-drop'){const data=new DataTransfer();data.setData('text/plain',expected);editor.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));}
      else if(mode==='plain-restore'){state.answers.set('q1',maximum);syncExam(true);captureAnswerFromEditor();}
      else if(mode==='overlimit-capture'){editor.innerText=maximum+'overflow';captureAnswerFromEditor();}
      else if(mode==='paragraph-enter'){document.execCommand('insertText',false,'Alpha');document.execCommand('insertParagraph');document.execCommand('insertParagraph');document.execCommand('insertText',false,'Beta');}
      else if(mode==='rich-markup'){editor.innerHTML='<b data-test="remove">Bold</b><br><i>Italic</i>';sanitizeEditorDom(editor);}
      else if(mode==='list-markup'){editor.innerHTML='<ul><li>One</li><li>Two</li></ul>';sanitizeEditorDom(editor);}
      else {
        state.questions=answers.map((_,i)=>({id:'fixture-'+(i+1),number:i+1}));
        const footer=document.createElement('div');footer.className='bf26-exam-footer';const next=document.createElement('button');next.textContent='Next';
        next.addEventListener('click',()=>{state.currentIndex++;syncExam(true);});footer.append(next);document.body.append(footer);
        for(const runChunk of [${chunkSources.map(s => `() => (${s})`).join(',')}]) runChunk();
        editor.innerText=maximum.split(' Final editor capture:')[0];editor.dispatchEvent(new Event('input',{bubbles:true}));
        editor.innerText=maximum; // The real submit must capture the final edit before any input event.
        const old=window.confirm;window.confirm=()=>true;try{await submitForecast();}finally{window.confirm=old;}
      }
      let undoCleared=null;
      if(mode==='undo-redo-paste'){document.execCommand('undo');undoCleared=answerPlainText(editor)==='';document.execCommand('redo');}
      const key=state.questions[state.currentIndex].id;const before=state.answers.get(key)||'';sanitizeEditorDom(editor);const after=state.answers.get(key)||'';
      const record={mode,expectedLength:expected.length,capturedBefore:before.length,capturedAfter:after.length,
        equalBefore:before===expected,equalAfter:after===expected,expectedNewlines:(expected.match(/\\n/g)||[]).length,
        afterNewlines:(after.match(/\\n/g)||[]).length,retainsEnding:after.endsWith(expected.slice(-43)),
        expectedSha256:await digest(expected),actualSha256:await digest(after),whiteSpace:getComputedStyle(editor).whiteSpace};
      if(mode==='rich-markup'){record.boldPreserved=!!editor.querySelector('b');record.italicPreserved=!!editor.querySelector('i');record.unapprovedAttributeRemoved=!editor.querySelector('[data-test]');}
      if(mode==='literal-html-paste')record.literalOnly=!editor.querySelector('b,script');
      if(mode==='list-markup')record.listPreserved=editor.querySelectorAll('li').length===2;
      if(mode==='undo-redo-paste')record.undoCleared=undoCleared;
      if(mode==='maximum20-final-no-input'){record.submittedAnswers=submitted?.answers?.length||0;record.all20Exact=submitted?.answers?.every((a,i)=>a.answer===answers[i])===true;record.all20AtMaximum=submitted?.answers?.every(a=>a.answer.length===6000)===true;}
      out.push(record);
    }
    return out;
  })()`;
}
export function keyboardProbeSource(source, css) {
  return editorProbeSource(source, css, Array(20).fill('Alpha'), [])
    .replace(/for\(const mode of \[[^\]]+\]\)/u, "for(const mode of ['paragraph-enter'])")
    .replace("document.execCommand('insertParagraph');document.execCommand('insertParagraph');document.execCommand('insertText',false,'Beta');", '')
    .replace('out.push(record);', `out.push(record);window.__readNativeEnter=async()=>{
      const expected='Alpha\\n\\nBeta',actual=state.answers.get('q1')||'';
      return {expectedLength:expected.length,actualLength:actual.length,equal:actual===expected,
        boldPreserved:!!editor.querySelector('b'),nestedPlaceholder:!!editor.querySelector('div>b>br'),
        expectedSha256:await digest(expected),actualSha256:await digest(actual)};
    };`);
}
async function launchCommand() {
  if (process.platform !== 'win32') return { binary: 'npx', prefix: ['--yes', 'agent-browser@0.36.0'] };
  for (const candidate of [process.env.AGENT_BROWSER_NPX_CLI,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
    path.join(path.dirname(process.execPath), '../node_modules/npm/bin/npx-cli.js')].filter(Boolean)) {
    try { await access(candidate); return { binary: process.execPath, prefix: [candidate, '--yes', 'agent-browser@0.36.0'] }; } catch {}
  }
  throw new Error('Set AGENT_BROWSER_NPX_CLI to the installed npx-cli.js.');
}
export async function nativeCheck({ source, css, baselineSource, baselineCss, answers, chunks }) {
  const launcher = await launchCommand(); const namespace = `am-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  // WebCrypto is absent on about:blank in native Chrome; an inert loopback origin
  // supplies a secure context without loading the application or external data.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'" });
    response.end('<!doctype html><title>Inert multiline regression</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|pathext|systemroot|windir|comspec|home|userprofile|localappdata|appdata|temp|tmp|tmpdir|user|logname|ci|display|xdg_runtime_dir|xdg_cache_home|lang|lc_all|ld_library_path)$/iu.test(name)));
  const command = async (...args) => {
    const batch = args[0] === 'batch';
    const input = batch ? JSON.stringify(args[1]) : args[0] === 'eval' ? args[1] : null;
    const pending = run(launcher.binary, [...launcher.prefix, '--namespace', namespace, '--session', 'local', '--restore-save', 'never', '--json', ...(batch ? ['batch', '--bail'] : input === null ? args : ['eval', '--stdin'])],
      { windowsHide: true, timeout: 60000, maxBuffer: 4000000, env });
    if (input !== null) { pending.child.stdin.on('error', () => {}); pending.child.stdin.end(input); }
    const result = JSON.parse((await pending).stdout);
    if (batch) {
      assert.ok(Array.isArray(result)); assert.equal(result.length, args[1].length);
      return result.map(row => { assert.equal(row.success, true); return row.result?.result ?? row.result; });
    }
    assert.equal(result.success, true);
    return Object.hasOwn(result.data || {}, 'result') ? result.data.result : result.data;
  };
  try {
    const results = await command('batch', [
      ['open', `http://127.0.0.1:${server.address().port}/`],
      ['eval', editorProbeSource(baselineSource, baselineCss, answers, chunks)],
      ['eval', editorProbeSource(source, css, answers, chunks)],
      ['eval', keyboardProbeSource(baselineSource, baselineCss)], ['press', 'Enter'], ['press', 'Enter'],
      ['keyboard', 'type', 'Beta'], ['eval', 'window.__readNativeEnter()'],
      ['eval', keyboardProbeSource(source, css)], ['press', 'Enter'], ['press', 'Enter'],
      ['keyboard', 'type', 'Beta'], ['eval', 'window.__readNativeEnter()'],
      ['eval', keyboardProbeSource(source, css).replace("document.execCommand('insertText',false,'Alpha');", "document.execCommand('bold');document.execCommand('insertText',false,'Alpha');")],
      ['press', 'Enter'], ['press', 'Enter'], ['keyboard', 'type', 'Beta'], ['eval', 'window.__readNativeEnter()'],
      ['eval', keyboardProbeSource(source, css)], ['press', 'Shift+Enter'], ['press', 'Shift+Enter'],
      ['keyboard', 'type', 'Beta'], ['eval', 'window.__readNativeEnter()'],
    ]);
    const baseline = results[1], current = results[2], baselineKeyboard = results[7], currentKeyboard = results[12], currentBoldKeyboard = results[17], currentShiftKeyboard = results[22];
    // Only synthetic counts/booleans/hashes are emitted, including on failure.
    console.log(JSON.stringify({ phase: 'native-editor-observation', baseline, current, baselineKeyboard, currentKeyboard, currentBoldKeyboard, currentShiftKeyboard }));
    assert.equal(baseline.find(r => r.mode === 'maximum-paste').equalAfter, false, 'Native baseline must reproduce real paste corruption.');
    assert.equal(baseline.find(r => r.mode === 'plain-restore').equalAfter, false, 'Native baseline must reproduce plain draft corruption.');
    for (const row of current) {
      assert.equal(row.equalAfter, true, `Actual shipped multiline path must preserve every character: ${row.mode}`);
      assert.equal(row.retainsEnding, true); assert.equal(row.actualSha256, row.expectedSha256);
      assert.equal(row.afterNewlines, row.expectedNewlines); assert.equal(row.whiteSpace, 'pre-wrap');
    }
    const rich = current.find(r => r.mode === 'rich-markup');
    assert.ok(rich.boldPreserved && rich.italicPreserved && rich.unapprovedAttributeRemoved);
    assert.ok(current.find(r => r.mode === 'literal-html-paste').literalOnly);
    assert.ok(current.find(r => r.mode === 'list-markup').listPreserved);
    assert.ok(current.find(r => r.mode === 'undo-redo-paste').undoCleared);
    assert.equal(baselineKeyboard.equal, false, 'Real native Enter must reproduce the baseline failure.');
    assert.equal(currentKeyboard.equal, true, 'Actual keyboard Enter and typing must preserve two, not three, newlines.');
    assert.equal(currentKeyboard.actualSha256, currentKeyboard.expectedSha256);
    assert.equal(currentBoldKeyboard.equal, true); assert.equal(currentBoldKeyboard.boldPreserved, true);
    assert.equal(currentShiftKeyboard.equal, true);
    const submitted = current.find(r => r.mode === 'maximum20-final-no-input');
    assert.equal(submitted.submittedAnswers, 20); assert.ok(submitted.all20Exact && submitted.all20AtMaximum);
    return { nativeCases: current.length + 3, baseline, current, baselineKeyboard, currentKeyboard, currentBoldKeyboard, currentShiftKeyboard, sourceSha256: hash(source), cssSha256: hash(css),
      baselineSourceSha256: hash(baselineSource), baselineCssSha256: hash(baselineCss), remoteApplicationRequests: 0 };
  } finally {
    try { await command('close'); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}

export async function main(browser = false) {
  const [source, css, runner] = await Promise.all(['assets/bar-forecast.js', 'assets/bar-forecast.css', 'scripts/verify-astra-forecast-staging.mjs'].map(file => readFile(path.join(root, file), 'utf8')));
  assert.match(css, /\.bf26-answer\s*\{[^}]*white-space:\s*pre-wrap/u);
  assert.match(extractFunction(source, 'captureAnswerFromEditor'), /refs\.editor\.innerText = plain/u);
  assert.match(extractFunction(source, 'syncExam'), /else refs\.editor\.innerText = state\.answers\.get/u);
  assert.match(extractFunction(source, 'captureAnswerFromEditor'), /plain\.length > MAX_ANSWER_CHARACTERS/u);
  assert.match(extractFunction(source, 'sanitizeAnswerMarkup'), /child\.removeAttribute\(attribute\.name\)/u);
  const fixture = fixtureFunctions(runner);
  const answers = Array.from({ length: 20 }, (_, i) => fixture.fixtureAnswer('astra-durable-1788807259312-57ea4763', 3, i + 1));
  assert.ok(answers.every(a => a.length === 6000));
  const chunks = []; for (let i = 0; i < 19; i += 4) chunks.push(fixture.forecastEditorChunkSource(answers.slice(i, Math.min(i + 4, 19))));
  assert.ok(chunks.every(s => /editor\.innerText=answer/u.test(s)));
  if (!browser) return { sourceContractsPassed: true, nativeNotRun: true };
  const fromBaseline = file => execFileSync('git', ['-C', root, 'show', `${BASELINE}:${file}`], { encoding: 'utf8', windowsHide: true });
  return nativeCheck({ source, css, baselineSource: fromBaseline('assets/bar-forecast.js'), baselineCss: fromBaseline('assets/bar-forecast.css'), answers, chunks });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--browser'));
  console.log(JSON.stringify(await main(process.argv[2] === '--browser')));
}
