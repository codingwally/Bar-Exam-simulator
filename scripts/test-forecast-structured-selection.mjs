// Inert native regression for single-range P/list replacement. No accounts or remote application calls.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { extractFunction } from './test-forecast-multiline-editor.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const commits={original:'1f95f1d6baac05e5b519278aa3f4509dd5dbc317',multiline:'7c984e4021318cad688c1c5bf4cbe835848e4dfb'};
const fromGit=(commit,file)=>execFileSync('git',['-C',root,'show',commit+':'+file],{encoding:'utf8',windowsHide:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
function probe(source,css){
 const names=['answerParagraphPlaceholder','answerParagraphText','answerPlainText','sanitizeAnswerMarkup','placeCaretAtEnd','captureAnswerFromEditor','selectedAnswerLength','insertPlainAnswerText','sanitizeEditorDom'];
 const functions=names.filter(name=>!name.startsWith('answerParagraph')||source.includes(`function ${name}(`)).map(name=>extractFunction(source,name)).join('\n');
 const start=source.indexOf("    editor.addEventListener('paste'"),end=source.indexOf("    editor.addEventListener('keydown'",start);
 assert.ok(start>=0&&end>start);
 return `(async()=>{
  const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.replaceChildren(style);
  const global=window,MAX_ANSWER_CHARACTERS=6000;
  const state={currentIndex:0,questions:[{id:'synthetic-question'}],answers:new Map(),answerMarkup:new Map()};
  const syncExamCompletion=()=>{},scheduleForecastDraftSave=()=>{},syncEditorToolbarState=()=>{};
  ${functions}
  const make=(length,tag)=>{const ending=' Exact ending '+tag,head='Original facts and legal analysis remain intact. '.repeat(150).slice(0,length-ending.length);return head.slice(0,-1)+(head.endsWith(' ')?'x':head.slice(-1))+ending;};
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  const output=[];
  for(const kind of ['paragraph','unordered-list','ordered-list'])for(const selectionMode of ['full','partial']){
    document.body.replaceChildren();state.answers.clear();state.answerMarkup.clear();
    const editor=document.createElement('div');editor.className='bf26-answer';editor.contentEditable='true';document.body.append(editor);state.examRefs={editor};
    ${source.slice(start,end)}
    const separator=kind==='paragraph'?'\\n\\n':'\\n';
    const lengths=kind==='paragraph'?[1999,1998,1999]:[1999,2000,1999];
    const texts=lengths.map((length,i)=>make(length,'original-'+i));
    const original=texts.join(separator);
    const container=kind==='paragraph'?editor:document.createElement(kind==='ordered-list'?'ol':'ul');if(container!==editor)editor.append(container);
    for(const text of texts){const part=document.createElement(kind==='paragraph'?'p':'li');part.textContent=text;container.append(part);}
    editor.focus();const setupBeforeCapture=answerPlainText(editor);captureAnswerFromEditor();
    const originalRead=answerPlainText(editor);const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);
    let prefix='',suffix='';
    if(selectionMode==='partial'){
      const first=container.firstChild.firstChild,last=container.lastChild.firstChild;
      range.setStart(first,5);range.setEnd(last,last.textContent.length-5);prefix=original.slice(0,5);suffix=original.slice(-5);
    }
    selection.removeAllRanges();selection.addRange(range);
    const selectedByRuntime=selectedAnswerLength(editor),rawRangeCharacters=range.toString().length,renderedSelectionCharacters=selection.toString().length;
    const replacement=make(6000-prefix.length-suffix.length,'replacement-'+kind+'-'+selectionMode),expected=prefix+replacement+suffix;
    const data=new DataTransfer();data.setData('text/plain',replacement);
    editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    sanitizeEditorDom(editor);const actual=state.answers.get('synthetic-question')||'';
    output.push({kind,selectionMode,setupExact:originalRead===original,setupLength:originalRead.length,
      setupBeforeCaptureLength:setupBeforeCapture.length,setupExpectedNewlines:(original.match(/\\n/g)||[]).length,setupActualNewlines:(originalRead.match(/\\n/g)||[]).length,
      selectedByRuntime,rawRangeCharacters,renderedSelectionCharacters,expectedSelectionLength:6000-prefix.length-suffix.length,
      replacementLength:replacement.length,expectedLength:expected.length,actualLength:actual.length,exact:actual===expected,
      retainsInsertedEnding:actual.includes(replacement.slice(-43)),retainsOriginalSuffix:actual.endsWith(suffix),
      expectedSha256:await digest(expected),actualSha256:await digest(actual),
      listItemsAfter:editor.querySelectorAll('li').length,paragraphsAfter:editor.querySelectorAll('p').length});
  }
  return output;
 })()`;
}

export function boundaryChecks(source) {
  const actual=extractFunction(source,'selectedAnswerLength');
  const read=({rangeCount=1,collapsed=false,inside=true,structured=true,raw='abc',rendered='a\nbc'}={})=>{
    let renderedReads=0,cloneReads=0;
    const range={startContainer:{},endContainer:{},cloneContents:()=>{cloneReads++;return {querySelector:()=>structured};},toString:()=>raw};
    const selection={rangeCount,isCollapsed:collapsed,getRangeAt:()=>range,toString:()=>{renderedReads++;if(rendered instanceof Error)throw rendered;return rendered;}};
    const fn=vm.runInNewContext(actual+';selectedAnswerLength',{global:{getSelection:()=>selection},answerParagraphText:()=> 'a\nbc'});
    return {value:fn({contains:()=>inside}),renderedReads,cloneReads};
  };
  assert.deepEqual(read(),{value:4,renderedReads:1,cloneReads:1});
  assert.deepEqual(read({rangeCount:2,rendered:new Error('Do not join multiple ranges')}),{value:3,renderedReads:0,cloneReads:1});
  assert.deepEqual(read({inside:false,rendered:new Error('Do not read another surface')}),{value:0,renderedReads:0,cloneReads:0});
  assert.deepEqual(read({structured:false,rendered:new Error('Keep ordinary DIV reader')}),{value:4,renderedReads:0,cloneReads:1});
  assert.deepEqual(read({collapsed:true}),{value:0,renderedReads:0,cloneReads:0});
  assert.equal(read({rendered:'a\r\nb'}).value,3);
  return 6;
}
async function launcher() {
  if(process.platform!=='win32')return {binary:'npx',prefix:['--yes','agent-browser@0.36.0']};
  for(const candidate of [process.env.AGENT_BROWSER_NPX_CLI,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js'),path.join(path.dirname(process.execPath),'../node_modules/npm/bin/npx-cli.js')].filter(Boolean)){
    try{await access(candidate);return {binary:process.execPath,prefix:[candidate,'--yes','agent-browser@0.36.0']};}catch{}
  }
  throw new Error('Set AGENT_BROWSER_NPX_CLI to the installed npx-cli.js.');
}
export async function main(browser=false) {
 const source=await readFile(path.join(root,'assets/bar-forecast.js'),'utf8'),css=await readFile(path.join(root,'assets/bar-forecast.css'),'utf8');
 const boundaryCases=boundaryChecks(source);
 if(!browser)return {sourceContractsPassed:true,boundaryCases,nativeNotRun:true};
 const inputs={...Object.fromEntries(Object.entries(commits).map(([name,commit])=>[name,{source:fromGit(commit,'assets/bar-forecast.js'),css:fromGit(commit,'assets/bar-forecast.css')}])),candidate:{source,css}};
 const launch=await launcher();
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'"});res.end('<!doctype html><title>Inert structured selection</title>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const namespace='ps-'+randomUUID().slice(0,8),run=promisify(execFile);
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(?:path|pathext|systemroot|windir|comspec|home|userprofile|localappdata|appdata|temp|tmp|tmpdir|user|logname|ci|display|xdg_runtime_dir|xdg_cache_home|lang|lc_all|ld_library_path)$/iu.test(name)));
 const command=async(args,commands)=>{
   const pending=run(launch.binary,[...launch.prefix,'--namespace',namespace,'--session','local','--restore-save','never','--json',...args],{windowsHide:true,timeout:60000,maxBuffer:2000000,env});
   if(commands){pending.child.stdin.on('error',()=>{});pending.child.stdin.end(JSON.stringify(commands));}
   let stdout;try{({stdout}=await pending);}catch{throw new Error('STRUCTURED_SELECTION_NATIVE_COMMAND_FAILED');}
   try{return JSON.parse(stdout);}catch{throw new Error('STRUCTURED_SELECTION_NATIVE_OUTPUT_INVALID');}
 };
 try {
   const commands=[['open','http://127.0.0.1:'+server.address().port+'/'],...Object.values(inputs).map(({source,css})=>['eval',probe(source,css)])];
   const result=await command(['batch','--bail'],commands);
   assert.ok(Array.isArray(result));assert.equal(result.length,commands.length);assert.ok(result.every(row=>row.success===true));
   const observations=Object.fromEntries(Object.keys(inputs).map((key,i)=>[key,result[i+1].result.result]));
   // Diagnostic evidence is synthetic counts/booleans/hashes only, never source/answers.
   console.log(JSON.stringify({phase:'native-structured-selection',commits,observations}));
   for(const rows of Object.values(observations)){
     assert.equal(rows.length,6);assert.ok(rows.every(row=>row.setupExact&&row.setupLength===6000),'All starting surfaces must be exact6000 characters.');
   }
   for(const key of ['original','multiline'])assert.ok(observations[key].every(row=>!row.exact&&!row.retainsInsertedEnding),'Both earlier versions must reproduce the existing truncation.');
   for(const row of observations.candidate){
     assert.equal(row.selectedByRuntime,row.expectedSelectionLength);
     assert.equal(row.exact,true);assert.equal(row.actualLength,6000);assert.equal(row.retainsInsertedEnding,true);
     assert.equal(row.retainsOriginalSuffix,true);assert.equal(row.actualSha256,row.expectedSha256);
   }
   return {nativeCases:6,boundaryCases,baselineReproductions:12,sourceSha256:sha(source),cssSha256:sha(css),remoteApplicationRequests:0};
 }finally{try{await command(['close']);}finally{await new Promise(resolve=>server.close(resolve));}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--browser'));
 console.log(JSON.stringify(await main(process.argv[2]==='--browser')));
}
