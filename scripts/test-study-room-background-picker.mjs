import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [liveSource,backgroundSource]=await Promise.all([
  readFile(path.join(root,'assets/study-room-live.js'),'utf8'),
  readFile(path.join(root,'assets/study-room-backgrounds.js'),'utf8'),
]);
const marker='global.DueDiligenceStudyRoom = Object.freeze({';
assert.equal(liveSource.split(marker).length,2);
// Run the entire actual controller and live IIFE, without bootstrap/Auth. Only
// unrelated hardware discovery/tile painting and toast rendering are substituted.
// Camera ownership, publication guard, picker and cleanup functions are real.
const instrumented=liveSource.replace(marker,`
  syncActualInputDevice = async () => {};
  syncSelfMediaState = () => {};
  renderParticipants = () => {};
  startRoomAudioFromGesture = async () => true;
  toast = (message) => global.__messages.push(String(message));
  global.__pickerHooks = {state,setLocalSourceEnabled,setRawCameraEnabled,applyBackgroundChoice,
    uploadBackground,removeCustomBackground,selectedBackgroundRequest,destroyBackgroundController,
    ensureBackgroundController,assertCameraQuiet,toggleLocalTrack,bindControls};
  ${marker}`);
class Element {
  constructor(){this.value='';this.textContent='';this.src='';this.hidden=false;this.disabled=false;this.dataset={};this.attributes=new Map();this.children=new Map();this.listeners=new Map();
    const values=new Set();this.classList={add:(...xs)=>xs.forEach(x=>values.add(x)),remove:(...xs)=>xs.forEach(x=>values.delete(x)),contains:x=>values.has(x),toggle:(x,on)=>on?values.add(x):values.delete(x)};}
  setAttribute(k,v){this.attributes.set(k,String(v));} getAttribute(k){return this.attributes.get(k)||null;} removeAttribute(k){this.attributes.delete(k);}
  querySelector(key){if(!this.children.has(key))this.children.set(key,new Element());return this.children.get(key);}
  querySelectorAll(){return [];} addEventListener(k,fn){this.listeners.set(k,fn);} replaceChildren(){} append(){} focus(){} remove(){} pause(){} play(){return Promise.resolve();}
}
function png(){const b=new Uint8Array(24);b.set([137,80,78,71,13,10,26,10]);b.set([73,72,68,82],12);const v=new DataView(b.buffer);v.setUint32(16,64);v.setUint32(20,36);return new Blob([b],{type:'image/png'});}
function harness(options={}) {
  const nodes=new Map(),messages=[],events=[],createdUrls=[],revokedUrls=[],windowEvents=new Map();
  const controls={supported:true,effectFailure:false,muteFailure:false,unpublishFailure:false,stopFailure:false,...options};
  const counters={controllers:0,processors:0,rawStarts:0,captures:0,publishes:0,maxPublications:0};
  const byId=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const document={readyState:'loading',getElementById:byId,addEventListener(){},querySelectorAll:()=>[],createElement:()=>new Element(),body:new Element()};
  class LocalURL extends URL {
    static createObjectURL(){const url=`blob:https://duediligence.ph/${createdUrls.length+1}`;createdUrls.push(url);return url;}
    static revokeObjectURL(url){revokedUrls.push(url);}
  }
  function makeTrack(){
    counters.captures++;const raw={kind:'video',readyState:'live',enabled:true,muted:false,getSettings:()=>({deviceId:'camera-a'})};
    return {kind:'video',source:'camera',isMuted:false,processor:null,raw,
      get mediaStreamTrack(){return this.processor?.processedTrack||raw;},getProcessor(){return this.processor;},
      async setProcessor(p){this.processor=p;},async stopProcessor(){if(controls.stopProcessorFailure)throw new Error('processor stop failed');await this.processor?.destroy?.();this.processor=null;},
      async restartTrack(){raw.readyState='live';},
      stop(){if(controls.stopFailure)throw new Error('stop failed');raw.readyState='ended';if(this.processor)this.processor.processedTrack.readyState='ended';},
      attach:()=>new Element(),detach(){},};
  }
  const liveKit={Track:{Source:{Camera:'camera',Microphone:'microphone',ScreenShare:'screen_share'}},createLocalVideoTrack:async()=>makeTrack()};
  function localParticipant(){
    const local={trackPublications:new Map(),pendingCamera:null,
      getTrackPublication(source){return [...this.trackPublications.values()].find(x=>x.source===source);},
      async publishTrack(track){
        counters.publishes++;const key=`camera-${counters.publishes}`;
        const pub={source:'camera',track,isMuted:false,
          async mute(){if(controls.muteFailure)throw new Error('mute failed');this.isMuted=true;track.isMuted=true;},
          async unmute(){this.isMuted=false;track.isMuted=false;track.raw.readyState='live';},};
        this.trackPublications.set(key,pub);counters.maxPublications=Math.max(counters.maxPublications,this.trackPublications.size);events.push({type:'publish',mode:track.getProcessor()?.mode||'raw'});return pub;
      },
      async unpublishTrack(track,stop){
        if(controls.unpublishFailure)throw new Error('unpublish failed');
        const pair=[...this.trackPublications].find(([,p])=>p.track===track);if(!pair)return undefined;
        this.trackPublications.delete(pair[0]);if(stop)track.stop();return pair[1];
      },
      async setCameraEnabled(enabled){
        counters.rawStarts++;assert.equal(enabled,true);
        // Source-first reuse and pending-source serialization model the real SDK;
        // do not invent a fresh track when an existing camera publication survives.
        const existing=this.getTrackPublication('camera');if(existing){await existing.unmute();return existing;}
        if(this.pendingCamera)return this.pendingCamera;
        this.pendingCamera=(async()=>this.publishTrack(await liveKit.createLocalVideoTrack()))();
        try{return await this.pendingCamera;}finally{this.pendingCamera=null;}
      },
    };return local;
  }
  const window={document,location:{hostname:'duediligence.ph',origin:'https://duediligence.ph',protocol:'https:',search:''},
    Blob,URL:LocalURL,LivekitClient:liveKit,__messages:messages,
    localStorage:{getItem:()=>null,setItem(){throw new Error('Unexpected persistence');}},
    navigator:{mediaDevices:{getUserMedia(){throw new Error('Unexpected device request');}}},
    fetch(){throw new Error('Unexpected network');},
    addEventListener:(name,fn)=>windowEvents.set(name,fn),
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  };
  window.LivekitTrackProcessors={supportsBackgroundProcessors:()=>controls.supported,supportsModernBackgroundProcessors:()=>true,
    BackgroundProcessor(){counters.processors++;return {mode:'disabled',processedTrack:{kind:'video',readyState:'live',enabled:true,muted:false},
      async switchTo(request){events.push({type:'switch',...request});if(controls.effectFailure&&request.mode==='virtual-background')throw new Error('effect failed');this.mode=request.mode;this.imagePath=request.imagePath;},
      async destroy(){this.processedTrack.readyState='ended';},};},};
  const context=vm.createContext({window,URLSearchParams,Blob,URL:LocalURL,console});
  vm.runInContext(backgroundSource,context,{filename:'actual-study-room-backgrounds.js'});
  const original=window.DueDiligenceStudyRoomMandatoryBackground;
  window.DueDiligenceStudyRoomMandatoryBackground={...original,createController(opts){counters.controllers++;return original.createController({...opts,
    verifyImage:async()=>{if(controls.imageFailure)throw new Error('Image decode failed');if(controls.verifyImage)await controls.verifyImage();return {width:64,height:36};}});}};
  vm.runInContext(instrumented,context,{filename:'actual-study-room-live-picker.js'});
  const hooks=window.__pickerHooks;hooks.state.room={localParticipant:localParticipant()};
  return {hooks,state:hooks.state,local:()=>hooks.state.room.localParticipant,controls,counters,events,messages,byId,windowEvents,window,createdUrls,revokedUrls,
    async upload(file=png()){const input={files:[file],value:'selected'};await hooks.uploadBackground({target:input});assert.equal(input.value,'');},
    async changeRoom(){await hooks.destroyBackgroundController();hooks.state.room={localParticipant:localParticipant()};},};
}

test('explicit camera ON with Background off creates no controller/processor, repeated ON no duplicate',async()=>{
  const h=harness();assert.equal(h.counters.captures,0);
  await Promise.all([h.hooks.setLocalSourceEnabled('camera',true),h.hooks.setLocalSourceEnabled('camera',true)]);
  assert.equal(h.counters.controllers,0);assert.equal(h.counters.processors,0);assert.equal(h.counters.captures,1);assert.equal(h.local().trackPublications.size,1);
  await h.hooks.setLocalSourceEnabled('camera',false);assert.equal(h.local().trackPublications.size,0);
});
test('brand choice before ON never auto-starts, and is applied before publication',async()=>{
  const h=harness();await h.hooks.applyBackgroundChoice('brand');assert.equal(h.counters.publishes,0);
  await h.hooks.setLocalSourceEnabled('camera',true);assert.equal(h.counters.rawStarts,0);
  assert.equal(h.events.find(x=>x.type==='publish').mode,'virtual-background');
});
for(const controls of [{supported:false},{effectFailure:true}])test(`selected background failure never falls back to raw ${JSON.stringify(controls)}`,async()=>{
  const h=harness(controls);await h.hooks.applyBackgroundChoice('brand');
  await assert.rejects(h.hooks.setLocalSourceEnabled('camera',true));
  assert.equal(h.counters.rawStarts,0);assert.equal(h.local().trackPublications.size,0);
  assert.equal(h.state.backdropEnabled,true);await assert.rejects(h.hooks.setLocalSourceEnabled('camera',true));assert.equal(h.counters.rawStarts,0);
});
test('custom upload retained before ON, current custom image applies before publication',async()=>{
  const h=harness();await h.upload();assert.equal(h.counters.publishes,0);assert.equal(h.state.backgroundChoice,'custom');assert.equal(h.state.backdropEnabled,true);
  await h.hooks.setLocalSourceEnabled('camera',true);
  assert.equal(h.events.filter(x=>x.type==='switch').at(-1).imagePath,h.state.customBackgroundPath);
  assert.equal(h.events.find(x=>x.type==='publish').mode,'virtual-background');assert.equal(h.counters.rawStarts,0);
});
test('successful replacement retires both previous registered and preview URLs without false error',async()=>{
  const h=harness();await h.upload();const before={path:h.state.customBackgroundPath,preview:h.state.customBackgroundPreview};
  await h.upload();assert.notEqual(h.state.customBackgroundPath,before.path);
  assert.ok(h.revokedUrls.includes(before.path));assert.ok(h.revokedUrls.includes(before.preview));
  assert.equal(h.byId('sr-background-upload-status').classList.contains('is-error'),false);
});
test('invalid size/type/decode replacement preserves current file and preview',async()=>{
  const h=harness();await h.upload();const oldFile=h.state.customBackgroundFile,oldPath=h.state.customBackgroundPath,oldPreview=h.state.customBackgroundPreview;
  for(const file of [new Blob(['<svg/>'],{type:'image/svg+xml'}),new Blob([new Uint8Array(5*1024*1024+1)],{type:'image/png'})]){
    await h.upload(file);assert.equal(h.state.customBackgroundFile,oldFile);assert.equal(h.state.customBackgroundPath,oldPath);assert.equal(h.state.customBackgroundPreview,oldPreview);
    assert.equal(h.byId('sr-background-upload-status').classList.contains('is-error'),true);
  }
  h.controls.imageFailure=true;await h.upload();assert.equal(h.state.customBackgroundFile,oldFile);assert.equal(h.state.customBackgroundPreview,oldPreview);
});
test('remove custom image is safe before camera ON and releases both URLs',async()=>{
  const h=harness();await h.upload();const oldPath=h.state.customBackgroundPath,oldPreview=h.state.customBackgroundPreview;
  await h.hooks.removeCustomBackground();assert.equal(h.state.customBackgroundFile,null);assert.equal(h.state.backgroundChoice,'brand');
  assert.ok(h.revokedUrls.includes(oldPath));assert.ok(h.revokedUrls.includes(oldPreview));assert.equal(h.counters.publishes,0);
});
test('room change destroys old registration, retains Blob/preview and re-registers in new controller',async()=>{
  const h=harness();await h.upload();const file=h.state.customBackgroundFile,old=h.state.customBackgroundPath,preview=h.state.customBackgroundPreview;
  await h.hooks.setLocalSourceEnabled('camera',true);await h.changeRoom();assert.ok(h.revokedUrls.includes(old));
  assert.equal(h.state.customBackgroundFile,file);assert.equal(h.state.customBackgroundPreview,preview);assert.equal(h.revokedUrls.includes(preview),false);
  await h.hooks.setLocalSourceEnabled('camera',true);assert.notEqual(h.state.customBackgroundPath,old);
  assert.equal(h.events.filter(x=>x.type==='switch').at(-1).imagePath,h.state.customBackgroundPath);
  assert.equal(h.local().trackPublications.size,1);assert.equal(h.counters.maxPublications,1);
});
test('unconfirmed raw stop is a truthful error, keeps ownership and does not report off',async()=>{
  const h=harness();await h.hooks.setLocalSourceEnabled('camera',true);Object.assign(h.controls,{muteFailure:true,unpublishFailure:true,stopFailure:true});
  await assert.rejects(h.hooks.setLocalSourceEnabled('camera',false),e=>e.code==='MEDIA_TRACK_STOP_UNCONFIRMED');
  const pub=h.local().getTrackPublication('camera');assert.equal(pub.isMuted,false);assert.equal(h.state.userApprovedRawCameraTracks.has(pub.track),true);
  assert.equal(h.messages.some(x=>/Camera turned off/.test(x)),false);assert.equal(h.local().trackPublications.size,1);
});
test('surviving muted raw publication must not allow a second protected camera',async()=>{
  const h=harness();await h.hooks.setLocalSourceEnabled('camera',true);Object.assign(h.controls,{unpublishFailure:true,stopFailure:true});
  await h.hooks.applyBackgroundChoice('brand');
  assert.equal(h.local().trackPublications.size,1,'Effect transition must refuse while an old raw publication cannot be removed.');
  assert.equal(h.counters.maxPublications,1,'No duplicate camera publication, including a muted survivor.');
  assert.equal(h.counters.captures,1,'A surviving raw camera must be resolved before another capture starts.');
});
test('repeated protected ON and camera off/on preserve one publication and selected custom request',async()=>{
  const h=harness();await h.upload();await h.hooks.setLocalSourceEnabled('camera',true);await h.hooks.setLocalSourceEnabled('camera',true);
  await h.hooks.setLocalSourceEnabled('camera',false);await h.hooks.setLocalSourceEnabled('camera',true);
  assert.equal(h.counters.maxPublications,1);assert.equal(h.counters.captures,1);assert.equal(h.counters.rawStarts,0);
  assert.equal(h.events.filter(x=>x.type==='switch').at(-1).imagePath,h.state.customBackgroundPath);
});
test('failed custom application is marked error, remains selected for retry, and never restarts raw',async()=>{
  const h=harness();await h.hooks.setLocalSourceEnabled('camera',true);h.controls.effectFailure=true;
  await h.upload();assert.equal(h.byId('sr-background-upload-status').classList.contains('is-error'),true);
  assert.match(h.byId('sr-background-upload-status').textContent,/could not start/i);
  assert.equal(h.state.backgroundChoice,'custom');assert.equal(h.state.backdropEnabled,true);
  assert.equal(h.local().trackPublications.size,0);assert.equal(h.counters.rawStarts,1);
  const image=h.state.customBackgroundPath;
  await assert.rejects(h.hooks.setLocalSourceEnabled('camera',true));assert.equal(h.counters.rawStarts,1);
  h.controls.effectFailure=false;await h.hooks.setLocalSourceEnabled('camera',true);
  assert.equal(h.events.filter(x=>x.type==='switch').at(-1).imagePath,image);
  assert.equal(h.local().trackPublications.size,1);assert.equal(h.counters.maxPublications,1);
});
test('confirmed-muted raw survivor can be reused on explicit raw ON without a new camera',async()=>{
  const h=harness();await h.hooks.setLocalSourceEnabled('camera',true);const track=h.local().getTrackPublication('camera').track;
  Object.assign(h.controls,{unpublishFailure:true,stopFailure:true});
  await h.hooks.setLocalSourceEnabled('camera',false);assert.equal(h.local().getTrackPublication('camera').isMuted,true);
  assert.equal(h.state.userApprovedRawCameraTracks.has(track),true);
  await h.hooks.setLocalSourceEnabled('camera',true);assert.equal(h.local().getTrackPublication('camera').track,track);
  assert.equal(h.counters.captures,1);assert.equal(h.counters.maxPublications,1);assert.equal(h.counters.processors,0);
});
test('pagehide revokes custom preview and controller image without storing the file',async()=>{
  const h=harness();await h.upload();const preview=h.state.customBackgroundPreview,image=h.state.customBackgroundPath;
  let disconnected=0;h.state.room.disconnect=()=>{disconnected++;};h.hooks.bindControls();
  h.windowEvents.get('pagehide')();await h.state.backgroundCleanup;
  assert.equal(h.state.customBackgroundFile,null);assert.equal(h.state.customBackgroundPreview,'');
  assert.ok(h.revokedUrls.includes(preview));assert.ok(h.revokedUrls.includes(image));assert.equal(disconnected,1);
});
test('inflight upload during controller teardown cannot resurrect a registered URL',async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
  const h=harness({verifyImage:async()=>{entered();await gate;}});
  const uploading=h.upload();await started;await h.hooks.destroyBackgroundController();release();await uploading;
  assert.equal(h.state.customBackgroundFile,null);assert.equal(h.state.customBackgroundPreview,'');
  assert.equal(h.createdUrls.length,1);assert.deepEqual(h.revokedUrls,h.createdUrls);
  assert.equal(h.byId('sr-background-upload-status').classList.contains('is-error'),true);
});
test('Background off must not unmute a surviving processed publication after failed teardown',async()=>{
  const h=harness();await h.hooks.applyBackgroundChoice('brand');await h.hooks.setLocalSourceEnabled('camera',true);
  Object.assign(h.controls,{unpublishFailure:true,stopFailure:true,stopProcessorFailure:true});
  const applied=await h.hooks.applyBackgroundChoice('off');
  assert.equal(applied,false,'Off must report failure if the processor could not be detached or camera removed.');
  assert.equal(h.local().getTrackPublication('camera').isMuted,true,'Do not resume the processor while claiming processor-free Off.');
  assert.equal(h.counters.maxPublications,1);
});
test('a discarded controller with surviving processed publication cannot publish a second camera on retry',async()=>{
  const h=harness();await h.hooks.applyBackgroundChoice('brand');await h.hooks.setLocalSourceEnabled('camera',true);
  Object.assign(h.controls,{unpublishFailure:true,stopFailure:true,stopProcessorFailure:true});
  await h.hooks.applyBackgroundChoice('off');await h.hooks.applyBackgroundChoice('brand');
  await assert.rejects(h.hooks.setLocalSourceEnabled('camera',true));
  assert.equal(h.local().trackPublications.size,1);assert.equal(h.counters.maxPublications,1);
  assert.equal(h.counters.captures,1,'Reject the orphaned processed survivor before acquiring another camera.');
});
test('actual camera click wrapper keeps background picker enabled after raw startup',async()=>{
  const h=harness();await h.hooks.toggleLocalTrack('camera');
  assert.equal(h.counters.processors,0);assert.equal(h.byId('sr-toggle-backdrop').disabled,false);
  assert.equal(h.byId('sr-background-file').disabled,false);
  assert.ok(h.messages.includes('Camera is on.'));
  await h.hooks.toggleLocalTrack('camera');assert.equal(h.local().trackPublications.size,0);
  assert.ok(h.messages.includes('Camera turned off.'));
});
test('actual camera click wrapper never reports off after an unconfirmed raw stop',async()=>{
  const h=harness();await h.hooks.toggleLocalTrack('camera');
  Object.assign(h.controls,{muteFailure:true,unpublishFailure:true,stopFailure:true});
  await h.hooks.toggleLocalTrack('camera');
  assert.equal(h.messages.includes('Camera turned off.'),false);
  assert.equal(h.local().getTrackPublication('camera').isMuted,false);
  assert.equal(h.state.userApprovedRawCameraTracks.has(h.local().getTrackPublication('camera').track),true);
  assert.equal(h.counters.maxPublications,1);
});
test('explicit Off after unsupported protected selection is required before raw ON',async()=>{
  const h=harness({supported:false});await h.hooks.applyBackgroundChoice('brand');
  await assert.rejects(h.hooks.setLocalSourceEnabled('camera',true));assert.equal(h.counters.rawStarts,0);
  assert.equal(await h.hooks.applyBackgroundChoice('off'),true);assert.equal(h.counters.rawStarts,0);
  await h.hooks.setLocalSourceEnabled('camera',true);
  assert.equal(h.counters.processors,0);assert.equal(h.counters.captures,1);assert.equal(h.local().trackPublications.size,1);
});
test('active custom replacement and removal preserve one healthy processor/publication',async()=>{
  const h=harness();await h.upload();await h.hooks.setLocalSourceEnabled('camera',true);
  const publication=h.local().getTrackPublication('camera'),processor=publication.track.getProcessor();
  const oldPath=h.state.customBackgroundPath,oldPreview=h.state.customBackgroundPreview;
  await h.upload();assert.equal(h.local().getTrackPublication('camera'),publication);
  assert.equal(publication.track.getProcessor(),processor);assert.ok(h.revokedUrls.includes(oldPath));assert.ok(h.revokedUrls.includes(oldPreview));
  const newPath=h.state.customBackgroundPath,newPreview=h.state.customBackgroundPreview;
  await h.hooks.removeCustomBackground();assert.equal(h.state.customBackgroundFile,null);
  assert.equal(h.local().getTrackPublication('camera'),publication);assert.equal(publication.track.getProcessor(),processor);
  assert.ok(h.revokedUrls.includes(newPath));assert.ok(h.revokedUrls.includes(newPreview));
  assert.equal(h.events.filter(x=>x.type==='switch').at(-1).imagePath,'/assets/study-room/virtual-background-due-diligence-polished-20260908.webp');
  assert.equal(h.counters.maxPublications,1);assert.equal(h.counters.processors,1);assert.equal(h.counters.rawStarts,0);
});
