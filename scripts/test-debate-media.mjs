import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {DebateMedia} from '../assets/debate-media.js';
const backgroundSource=await readFile(new URL('../assets/study-room-backgrounds.js',import.meta.url),'utf8');
const clientSource=await readFile(new URL('../assets/debate-room.js',import.meta.url),'utf8');
const deviceDialogSource=clientSource.match(/^async function openDeviceDialog\(\)\{[\s\S]*?^\}/m)?.[0];
assert.ok(deviceDialogSource,'Exercise the actual device-dialog handler, not a copied implementation.');
const deviceDialogHelpers=['const esc = ','const option = '].map(prefix=>clientSource.split(/\r?\n/).find(line=>line.startsWith(prefix))).join('\n');
async function openActualDeviceDialog(h){
 const open=vm.runInNewContext(`${deviceDialogHelpers}\n${deviceDialogSource}\nopenDeviceDialog`,{media:h.media,
  openDialog(title,html,submit){h.dialog={title,html,submit};}});
 await open();return h.dialog;
}
function selectedDeviceForm(html,changes={}){
 const fields={};
 for(const [,name,options] of html.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g)){
  const values=[...options.matchAll(/<option value="([^"]*)"( selected)?[^>]*>/g)];
  fields[name]=(values.find(value=>value[2])||values[0])?.[1]||'';
 }
 return new Map(Object.entries({...fields,image:null,...changes}));
}
const events=Object.fromEntries(['TrackSubscribed','TrackUnsubscribed','LocalTrackPublished','LocalTrackUnpublished','TrackPublished','TrackUnpublished','ParticipantConnected','ParticipantDisconnected','ConnectionStateChanged','Disconnected','LocalTrackMuted','LocalTrackUnmuted','ParticipantPermissionsChanged'].map(x=>[x,x]));
const credential=(identity='epoch-1',sources=['camera','microphone','screen_share','screen_share_audio'],roomName='main')=>({identity,roomName,sources,url:'wss://local-inert.invalid',token:identity});
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.currentTime=0;this.videoWidth=0;this.parentElement=null;}
 append(el){el.remove();this.children.push(el);el.parentElement=this;}
 replaceChildren(...els){for(const e of [...this.children])e.remove();for(const e of els)this.append(e);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);this.parentElement=null;}
 querySelector(tag){return this.children.find(e=>e.tag===tag)||null;}
 setAttribute(k,v){this.attributes[k]=v;} async play(){} pause(){}
}
async function harness(run){
 const restore=new Map();const set=(key,value)=>{restore.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  const h={captures:[],microphoneCaptures:[],processors:[],rooms:[],urls:[],revoked:[],videoCalls:[],presentationCalls:[],issues:[],states:[],intervals:new Map(),time:0,supported:true,failEffect:false,captureGate:null,devices:[]};
 let sequence=0;
 class Track{
  constructor(kind='video'){this.kind=kind;this.rawTrack={readyState:'live',enabled:true};this.mediaStreamTrack=this.rawTrack;this.isMuted=false;this.attached=new Set();this.restarts=[];this.stops=0;}
  attach(e){this.attached.add(e);e.srcObject=this;}detach(e){this.attached.delete(e);}
  stop(){this.stops++;this.mediaStreamTrack.readyState='ended';}
  // Actual LiveKit LocalTrack.setTrackMuted changes _mediaStreamTrack (input),
  // while the mediaStreamTrack getter returns processor output when attached.
  async mute(){this.isMuted=true;this.rawTrack.enabled=false;}async unmute(){this.isMuted=false;this.rawTrack.enabled=true;}
  async restartTrack(options){this.restarts.push(options);if(this.processor)this.mediaStreamTrack=this.processor.processedTrack;}
  async setProcessor(processor){this.processor=processor;this.mediaStreamTrack=processor.processedTrack;}
  getProcessor(){return this.processor;}async stopProcessor(){await this.processor?.destroy();this.processor=null;}
 }
 class Room{
  constructor(options){this.options=options;this.handlers=new Map();this.state='disconnected';this.remoteParticipants=new Map();this.disconnects=[];h.rooms.push(this);
   const room=this;this.localParticipant={identity:'',trackPublications:new Map(),isMicrophoneEnabled:false,isScreenShareEnabled:false,
    get isCameraEnabled(){return !!this.getTrackPublication('camera')?.track&&!this.getTrackPublication('camera').isMuted;},
    getTrackPublication(source){return [...this.trackPublications.values()].find(p=>p.source===source);},
    async publishTrack(track,{source}){assert.equal(track.mediaStreamTrack.readyState,'live');const p={track,source,trackSid:'TR_'+(++sequence),isMuted:false,
      async mute(){this.isMuted=true;await track.mute();},async unmute(){this.isMuted=false;await track.unmute();}};
     this.trackPublications.set(p.trackSid,p);room.emit('LocalTrackPublished',p);return p;},
    async unpublishTrack(track,stop){const p=[...this.trackPublications.values()].find(p=>p.track===track);if(!p)return;
     this.trackPublications.delete(p.trackSid);if(stop)track.stop();room.emit('LocalTrackUnpublished',p);p.track=undefined;return p;},
     async setMicrophoneEnabled(enabled,options){this.isMicrophoneEnabled=enabled;if(enabled&&!this.getTrackPublication('microphone')){h.microphoneCaptures.push(options);await this.publishTrack(new Track('audio'),{source:'microphone'});}},
    async setScreenShareEnabled(enabled,options){this.isScreenShareEnabled=enabled;h.shareOptions=options;if(enabled){await this.publishTrack(new Track(),{source:'screen_share'});if(options.audio)await this.publishTrack(new Track('audio'),{source:'screen_share_audio'});}},
   };
  }
  on(event,handler){const handlers=this.handlers.get(event)||[];handlers.push(handler);this.handlers.set(event,handlers);return this;}
  emit(event,...args){for(const fn of this.handlers.get(event)||[])fn(...args);}
  async connect(_url,token,options){this.connectOptions=options;this.localParticipant.identity=token;this.state='connected';}
  async disconnect(stop=true){this.disconnects.push(stop);for(const p of [...this.localParticipant.trackPublications.values()])await this.localParticipant.unpublishTrack(p.track,stop);this.state='disconnected';this.emit('Disconnected');}
  async startAudio(){}
 }
 const kit={Room,RoomEvent:events,VideoQuality:{LOW:0,MEDIUM:1,HIGH:2},Track:{Source:{Camera:'camera'}},
  async createLocalVideoTrack(options){const track=new Track();track.capture=options;h.captures.push(track);if(h.captureGate)await h.captureGate;return track;}};
 const effects={supportsBackgroundProcessors:()=>h.supported,supportsModernBackgroundProcessors:()=>true,BackgroundProcessor:()=>{
   const p={processedTrack:{readyState:'live',enabled:true},modes:[],async switchTo(mode){this.modes.push(mode);if(h.failEffect)throw new Error('Inert processor failure');},async destroy(){this.processedTrack.readyState='ended';}};h.processors.push(p);return p;}};
 class LocalURL extends URL{static createObjectURL(){const url='blob:https://local.test/'+(++sequence);h.urls.push(url);return url;}static revokeObjectURL(url){h.revoked.push(url);}}
 const runtime={LivekitClient:kit,LivekitTrackProcessors:effects,Blob,URL:LocalURL,location:{origin:'https://local.test',protocol:'https:'}};
 vm.runInNewContext(backgroundSource,{window:runtime});
  set('document',{createElement:tag=>new Element(tag)});set('navigator',{mediaDevices:{getDisplayMedia(){throw new Error('Never called directly');},enumerateDevices:async()=>h.devices}});
 set('LivekitClient',kit);set('DueDiligenceStudyRoomMandatoryBackground',{createController:options=>runtime.DueDiligenceStudyRoomMandatoryBackground.createController({...options,verifyImage:async()=>({width:640,height:480})})});
 set('setInterval',fn=>{const id=++sequence;h.intervals.set(id,fn);return id;});set('clearInterval',id=>h.intervals.delete(id));set('performance',{now:()=>h.time});
 h.media=new DebateMedia({audioRoot:new Element('audio-root'),presentation:new Element('presentation'),onVideo:(...args)=>h.videoCalls.push(args),onPresentation:(...args)=>h.presentationCalls.push(args),onState:state=>h.states.push(state),onIssue:issue=>h.issues.push(issue)});
 h.remote=(identity,source='camera')=>{
   const track=new Track(source.includes('audio')||source==='microphone'?'audio':'video');const publication={source,track,trackSid:'TR_'+(++sequence),subscriptions:[],qualities:[],setSubscribed(v){this.subscriptions.push(v);},setVideoQuality(q){this.qualities.push(q);}};
   const participant={identity,trackPublications:new Map([[publication.trackSid,publication]])};return{track,publication,participant};
 };
 try{await run(h);}finally{await h.media.leave();for(const [key,descriptor]of restore)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}

test('initial and repeated credential joins do not capture; raw camera survives identity transfer without new capture',()=>harness(async h=>{
 await h.media.join(credential());assert.equal(h.captures.length,0);assert.equal(h.rooms[0].connectOptions.autoSubscribe,false);
 await h.media.camera(true,'camera-A');const track=h.captures[0];await h.media.join(credential());assert.equal(h.rooms.length,1);
 await h.media.microphone(true);await h.media.share(true);const nonCamera=[...h.media.room.localParticipant.trackPublications.values()].filter(p=>p.source!=='camera').map(p=>p.track);
 await h.media.suspend();assert.equal(h.media.joined,false);assert.equal(track.mediaStreamTrack.readyState,'live');assert.ok(nonCamera.every(t=>t.mediaStreamTrack.readyState==='ended'));
 await h.media.join(credential('epoch-2',['camera','microphone'],'affirmative'));
 assert.equal(h.captures.length,1);assert.equal(h.media.ownedCamera.track,track);assert.equal(h.media.cameraOn,true);assert.equal(h.media.room.localParticipant.isMicrophoneEnabled,false);assert.equal(h.media.room.localParticipant.isScreenShareEnabled,false);
 await h.media.camera(false);await h.media.join(credential('epoch-3'));assert.equal(h.media.cameraOn,false);assert.equal(h.media.ownedCamera.actual,null,'An off camera is not republished by a new role');assert.equal(h.captures.length,1);
}));

test('actual background controller retains one processor across20 effects and permission epochs; device switch uses actual switchCamera',()=>harness(async h=>{
 await h.media.join(credential());await h.media.setEffect('blur');assert.equal(h.captures.length,0);await h.media.camera(true,'camera-A');
 const track=h.captures[0],processor=h.processors[0];assert.equal(processor.modes.at(-1).mode,'background-blur');
 for(let i=0;i<20;i++){await h.media.setEffect(['blur','brand','none'][i%3]);await h.media.join(credential('epoch-'+(i+2)));assert.equal(h.media.ownedCamera.track,track);assert.equal(h.media.cameraOn,true);}
 assert.equal(h.captures.length,1);assert.equal(h.processors.length,1);assert.equal(track.getProcessor(),processor);
 await h.media.camera(true,'camera-B');assert.equal(track.restarts.length,1);assert.equal(track.restarts[0].deviceId.exact,'camera-B');assert.equal(h.captures.length,1);
 await h.media.camera(false);assert.equal(h.media.cameraOn,false);await h.media.camera(true);assert.equal(h.processors.length,1);
}));

test('effect failure never publishes raw; explicit None recovers unsupported capability; leaving clears private custom image',()=>harness(async h=>{
 await h.media.join(credential());await h.media.setEffect('blur');await h.media.camera(true);h.failEffect=true;
 await assert.rejects(()=>h.media.setEffect('brand'));assert.equal(h.media.cameraOn,false);assert.equal(h.media.effect,'brand');assert.equal(h.captures.length,1);assert.equal(h.captures[0].mediaStreamTrack.readyState,'ended');
 await assert.rejects(()=>h.media.camera(true));assert.equal(h.media.cameraOn,false);h.failEffect=false;await h.media.setEffect('none');await h.media.camera(true);assert.equal(h.media.cameraOn,true);
 const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);new DataView(bytes.buffer).setUint32(16,640);new DataView(bytes.buffer).setUint32(20,480);
 await h.media.setEffect('custom',new Blob([bytes],{type:'image/png'}));const path=h.media.customPath;
 await h.media.join(credential('epoch-custom'));assert.equal(h.media.customPath,path);assert.ok(!h.revoked.includes(path));
 await h.media.leave();assert.ok(h.revoked.includes(path));assert.equal(h.media.customFile,null);assert.equal(h.media.effect,'custom');
 await h.media.join(credential('epoch-after-leave'));await assert.rejects(()=>h.media.camera(true),/Choose your custom image again/);assert.equal(h.media.cameraOn,false);
 h.supported=false;await h.media.setEffect('none');await h.media.camera(true);assert.equal(h.media.effect,'none');assert.equal(h.media.cameraOn,true);
}));

test('selected observer page alone receives camera; fixed seats/judges stay priority; screen never reaches camera callback',()=>harness(async h=>{
 await h.media.join(credential());const peers=Array.from({length:100},(_,n)=>h.remote('observer-'+n));
 for(const peer of peers)h.media.room.remoteParticipants.set(peer.participant.identity,peer.participant);
 h.media.setVideoSubscriptions({priority:['observer-0','observer-1'],visible:peers.slice(2,8).map(x=>x.participant.identity)});
 assert.equal(peers.filter(p=>p.publication.subscriptions.at(-1)).length,8);assert.equal(h.media.videos.size,8);
 assert.equal(peers[0].publication.qualities.at(-1),1);assert.equal(peers[7].publication.qualities.at(-1),0);
 const fixedElement=h.media.videos.get(peers[0].publication.trackSid).element;
 h.media.setVideoSubscriptions({priority:['observer-0','observer-1'],visible:peers.slice(8,14).map(x=>x.participant.identity)});
 assert.equal(h.media.videos.size,8);assert.equal(h.media.videos.get(peers[0].publication.trackSid).element,fixedElement);assert.equal(peers[2].publication.subscriptions.at(-1),false);
 const screen=h.remote('presenter','screen_share');h.media.attach(screen.track,screen.publication,screen.participant);
 const video=h.media.presentation.children[0];video.videoWidth=1920;video.currentTime=1;for(const fn of h.intervals.values())fn();h.time=7000;for(const fn of h.intervals.values())fn();
 assert.ok(h.presentationCalls.some(([,label])=>label==='Video stalled'));assert.ok(h.videoCalls.every(([identity])=>identity!=='presenter'));assert.equal(video.parentElement,h.media.presentation);
}));

test('microphone and screen audio attach separately without loopback or duplicate nodes; stale old room events cannot resurrect tracks',()=>harness(async h=>{
 await h.media.join(credential());const oldRoom=h.media.room;const mic=h.remote('speaker','microphone'),share=h.remote('speaker','screen_share_audio');
 h.media.attach(mic.track,mic.publication,mic.participant);h.media.attach(share.track,share.publication,share.participant);h.media.attach(mic.track,mic.publication,mic.participant);
 assert.equal(h.media.audioTracks.size,2);assert.equal(h.media.audioRoot.children.length,2);h.media.detach(mic.publication.trackSid);assert.equal(h.media.audioTracks.size,1);
 h.media.attach(mic.track,mic.publication,oldRoom.localParticipant);assert.equal(h.media.audioTracks.size,1);
 await h.media.join(credential('new-epoch'));oldRoom.emit('TrackSubscribed',mic.track,mic.publication,mic.participant);assert.equal(h.media.audioTracks.size,0);
}));

test('late camera permission after leave never publishes; restricted or ended retained track requires explicit fresh action',()=>harness(async h=>{
 await h.media.join(credential());let release;h.captureGate=new Promise(resolve=>{release=resolve;});const capture=h.media.camera(true);
 while(!h.captures.length)await Promise.resolve();const leaving=h.media.leave();release();await capture;await leaving;
 assert.equal(h.captures[0].mediaStreamTrack.readyState,'ended');assert.equal(h.media.ownedCamera,null);
 h.captureGate=null;await h.media.join(credential('resume'));await h.media.camera(true);const active=h.media.ownedCamera.track;
 await h.media.join(credential('restricted',[]));assert.equal(h.media.cameraOn,false);await h.media.join(credential('allowed-again'));assert.equal(h.media.cameraOn,false);
 await h.media.camera(true);h.media.ownedCamera.track.stop();const captures=h.captures.length;await h.media.join(credential('ended'));assert.equal(h.captures.length,captures);assert.equal(h.media.cameraOn,false);
}));

test('failed or dishonest mute cannot leave an outgoing camera; ended raw publication is replaced without duplicate source',()=>harness(async h=>{
 await h.media.join(credential());await h.media.camera(true);let track=h.media.ownedCamera.track;
 h.media.ownedCamera.actual.mute=async()=>{throw new Error('inert transport failure');};await h.media.camera(false);
 assert.equal(track.mediaStreamTrack.readyState,'ended');assert.equal(h.media.cameraOn,false);assert.equal(h.media.room.localParticipant.trackPublications.size,0);
 await h.media.camera(true);track=h.media.ownedCamera.track;h.media.ownedCamera.actual.mute=async()=>{};await h.media.camera(false);
 assert.equal(track.mediaStreamTrack.readyState,'ended');assert.equal(h.media.room.localParticipant.trackPublications.size,0);
 await h.media.camera(true);h.media.ownedCamera.track.stop();await h.media.camera(true);
 assert.equal(h.media.room.localParticipant.trackPublications.size,1,'An ended publication must be removed before explicit replacement capture');
}));

test('provider disconnect stops captured mic/share even when SDK cleared publication maps; only owned camera can remain local',()=>harness(async h=>{
 await h.media.join(credential());await h.media.camera(true);await h.media.microphone(true);await h.media.share(true);
 const track=h.media.ownedCamera.track;const room=h.media.room;
 const others=[...room.localParticipant.trackPublications.values()].filter(p=>p.track!==track).map(p=>p.track);
 room.localParticipant.trackPublications.clear();room.state='disconnected';room.emit('Disconnected');
 assert.ok(others.every(t=>t.mediaStreamTrack.readyState==='ended'));assert.equal(track.mediaStreamTrack.readyState,'live');
 await h.media.join(credential('reconnected'));assert.equal(h.captures.length,1);assert.equal(h.media.ownedCamera.track,track);
}));

test('actual device dialog saves off-device choices without capture and uses them on later explicit enable',()=>harness(async h=>{
 h.devices=[{kind:'videoinput',deviceId:'camera-A',label:'Camera A'},{kind:'audioinput',deviceId:'microphone-B',label:'Microphone B'}];
 let dialog=await openActualDeviceDialog(h);
 await dialog.submit(selectedDeviceForm(dialog.html,{cameraDevice:'camera-A',microphoneDevice:'microphone-B'}));
 assert.equal(h.captures.length,0);assert.equal(h.microphoneCaptures.length,0);assert.equal(h.rooms.length,0);
 dialog=await openActualDeviceDialog(h);const reopened=selectedDeviceForm(dialog.html);
 assert.equal(reopened.get('cameraDevice'),'camera-A');assert.equal(reopened.get('microphoneDevice'),'microphone-B');
 await h.media.join(credential());await h.media.camera(true);await h.media.microphone(true);
 assert.deepEqual(h.captures[0].capture,{deviceId:{exact:'camera-A'}});
 assert.deepEqual(h.microphoneCaptures[0],{deviceId:{exact:'microphone-B'}});
}));

test('background-only save through the actual dialog preserves both active input choices',()=>harness(async h=>{
 h.devices=[{kind:'videoinput',deviceId:'camera-A'},{kind:'audioinput',deviceId:'microphone-B'}];
 await h.media.join(credential());await h.media.camera(true,'camera-A');await h.media.microphone(true,'microphone-B');
 const microphone=h.media.room.localParticipant.getTrackPublication('microphone').track;
 let dialog=await openActualDeviceDialog(h);await dialog.submit(selectedDeviceForm(dialog.html,{effect:'blur'}));
 assert.equal(h.media.effect,'blur');assert.equal(h.media.cameraOn,true);
 assert.equal(h.media.cameraDevice,'camera-A');assert.equal(h.media.microphoneDevice,'microphone-B');
 assert.deepEqual(h.captures.at(-1).capture,{deviceId:{exact:'camera-A'}});
 assert.equal(h.microphoneCaptures.length,1);assert.equal(microphone.restarts.length,0);
 dialog=await openActualDeviceDialog(h);const reopened=selectedDeviceForm(dialog.html);
 assert.equal(reopened.get('cameraDevice'),'camera-A');assert.equal(reopened.get('microphoneDevice'),'microphone-B');assert.equal(reopened.get('effect'),'blur');
}));

test('unavailable selected inputs stay explicit on reopen; saving does not silently choose default or capture',()=>harness(async h=>{
 await h.media.selectDevices({cameraDevice:'unplugged-camera',microphoneDevice:'unplugged-microphone'});
 const dialog=await openActualDeviceDialog(h);const submitted=selectedDeviceForm(dialog.html);
 assert.equal(submitted.get('cameraDevice'),'unplugged-camera');assert.equal(submitted.get('microphoneDevice'),'unplugged-microphone');
 await dialog.submit(submitted);assert.equal(h.media.cameraDevice,'unplugged-camera');assert.equal(h.media.microphoneDevice,'unplugged-microphone');
 assert.equal(h.captures.length,0);assert.equal(h.microphoneCaptures.length,0);
}));

test('active selection changes restart existing inputs and a failed camera switch stops outgoing video',()=>harness(async h=>{
 await h.media.join(credential());await h.media.camera(true,'camera-A');await h.media.microphone(true,'microphone-A');
 const camera=h.media.ownedCamera.track,microphone=h.media.room.localParticipant.getTrackPublication('microphone').track;
 await h.media.selectDevices({cameraDevice:'camera-B',microphoneDevice:'microphone-B'});
 assert.deepEqual(camera.restarts,[{deviceId:{exact:'camera-B'}}]);assert.deepEqual(microphone.restarts,[{deviceId:{exact:'microphone-B'}}]);
 assert.equal(h.captures.length,1);assert.equal(h.microphoneCaptures.length,1);
 camera.restartTrack=async()=>{throw new Error('Inert device switch failure');};
 await assert.rejects(()=>h.media.selectDevices({cameraDevice:'camera-C'}),/device switch failure/);
 assert.equal(h.media.cameraOn,false);assert.equal(camera.rawTrack.enabled,false);
}));

test('an old device dialog cannot restore preferences or capture after leave',()=>harness(async h=>{
 await h.media.join(credential());const dialog=await openActualDeviceDialog(h);await h.media.leave();
 await assert.rejects(()=>dialog.submit(selectedDeviceForm(dialog.html,{cameraDevice:'old-camera',microphoneDevice:'old-microphone'})),/room connection changed/);
 assert.equal(h.media.cameraDevice,'');assert.equal(h.media.microphoneDevice,'');assert.equal(h.captures.length,0);assert.equal(h.microphoneCaptures.length,0);
}));

test('microphone revocation stops capture while off-device preferences remain editable',()=>harness(async h=>{
 await h.media.join(credential());await h.media.microphone(true,'microphone-A');
 const track=h.media.room.localParticipant.getTrackPublication('microphone').track;
 h.media.room.localParticipant.permissions={canPublishSources:['camera']};
 h.media.room.emit('ParticipantPermissionsChanged',null,h.media.room.localParticipant);
 await h.media.selectDevices({microphoneDevice:'microphone-B'});
 assert.equal(track.mediaStreamTrack.readyState,'ended');assert.equal(h.media.room.localParticipant.isMicrophoneEnabled,false);
 assert.equal(track.restarts.length,0);assert.equal(h.microphoneCaptures.length,1);assert.equal(h.media.microphoneDevice,'microphone-B');
 await assert.rejects(()=>h.media.microphone(true),/microphone floor/);
}));

function deferred(){let resolve;return{promise:new Promise(done=>resolve=done),resolve:()=>resolve()};}
function publishSources(h,sources){
 h.media.room.localParticipant.permissions={canPublishSources:sources};
 h.media.room.emit('ParticipantPermissionsChanged',null,h.media.room.localParticipant);
}

for(const pendingStep of ['restart','unmute'])test(`camera revocation during ${pendingStep} cannot resume capture when permission returns`,()=>harness(async h=>{
 await h.media.join(credential());await h.media.camera(true,'camera-A');
 const owned=h.media.ownedCamera,track=owned.track,started=deferred(),finish=deferred();
 if(pendingStep==='restart')track.restartTrack=async()=>{started.resolve();await finish.promise;track.rawTrack.enabled=true;};
 else{
  const unmute=owned.actual.unmute.bind(owned.actual);
  owned.actual.unmute=async()=>{started.resolve();await finish.promise;await unmute();};
 }
 const changing=h.media.selectDevices({cameraDevice:'camera-B'});await started.promise;
 publishSources(h,['microphone']);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);
 publishSources(h,['camera','microphone']);finish.resolve();await changing;
 assert.equal(h.media.allowed('camera'),true);assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);
 assert.equal(h.captures.length,1);
 await h.media.camera(true);assert.equal(h.media.cameraOn,true);assert.equal(track.rawTrack.enabled,true);
}));

test('pending first camera capture is discarded after same-identity credential revocation and regrant',()=>harness(async h=>{
 await h.media.join(credential());const finish=deferred();h.captureGate=finish.promise;
 const enabling=h.media.camera(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.captures.length,1);
 await h.media.join(credential('epoch-1',['microphone']));await h.media.join(credential());
 finish.resolve();await enabling;
 assert.equal(h.captures[0].mediaStreamTrack.readyState,'ended');assert.equal(h.media.ownedCamera,null);assert.equal(h.media.cameraOn,false);
 assert.equal(h.media.room.localParticipant.getTrackPublication('camera'),undefined);
 h.captureGate=null;await h.media.camera(true);assert.equal(h.captures.length,2);assert.equal(h.media.cameraOn,true);
}));

for(const action of ['selectDevices','microphone'])test(`${action} stops a microphone restart that crosses revocation and regrant`,()=>harness(async h=>{
 await h.media.join(credential());await h.media.microphone(true,'microphone-A');
 const track=h.media.room.localParticipant.getTrackPublication('microphone').track,started=deferred(),finish=deferred();
 track.restartTrack=async()=>{
  started.resolve();await finish.promise;
  // Model a replacement input arriving after the old input was stopped.
  track.rawTrack={readyState:'live',enabled:true};track.mediaStreamTrack=track.rawTrack;
 };
 const changing=action==='selectDevices'?h.media.selectDevices({microphoneDevice:'microphone-B'}):h.media.microphone(true,'microphone-B');
 await started.promise;publishSources(h,['camera']);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(track.mediaStreamTrack.readyState,'ended');
 publishSources(h,['camera','microphone']);finish.resolve();await changing;
 assert.equal(track.mediaStreamTrack.readyState,'ended');assert.equal(h.media.room.localParticipant.isMicrophoneEnabled,false);
 assert.equal(h.media.room.localParticipant.getTrackPublication('microphone'),undefined);
 assert.equal(h.microphoneCaptures.length,1);
 await h.media.microphone(true);assert.equal(h.microphoneCaptures.length,2);assert.equal(h.media.room.localParticipant.isMicrophoneEnabled,true);
}));

for(const source of ['camera','microphone'])test(`leave during an active ${source} device restart stops the late input and clears preferences`,()=>harness(async h=>{
 await h.media.join(credential());await h.media[source](true,`${source}-A`);
 const track=h.media.room.localParticipant.getTrackPublication(source).track,started=deferred(),finish=deferred();
 track.restartTrack=async()=>{started.resolve();await finish.promise;track.rawTrack.enabled=true;};
 const changing=h.media.selectDevices({[`${source}Device`]:`${source}-B`});await started.promise;
 const leaving=h.media.leave();finish.resolve();await changing;await leaving;
 assert.equal(track.mediaStreamTrack.readyState,'ended');assert.equal(h.media.room,null);
 assert.equal(h.media.cameraOn,false);assert.equal(h.media.cameraDevice,'');assert.equal(h.media.microphoneDevice,'');
}));

test('protected camera device restart remains off after revocation and preserves its chosen effect',()=>harness(async h=>{
 await h.media.join(credential());await h.media.setEffect('blur');await h.media.camera(true,'camera-A');
 const track=h.media.ownedCamera.track,started=deferred(),finish=deferred();
 track.restartTrack=async()=>{started.resolve();await finish.promise;track.rawTrack.enabled=true;};
 const changing=h.media.selectDevices({cameraDevice:'camera-B'});await started.promise;
 publishSources(h,['microphone']);publishSources(h,['camera','microphone']);finish.resolve();await changing;
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);assert.equal(h.media.effect,'blur');
 assert.equal(h.processors.length,1);assert.equal(h.captures.length,1);
 await h.media.camera(true);assert.equal(h.media.cameraOn,true);assert.equal(track.rawTrack.enabled,true);assert.equal(h.processors.length,1);
}));

test('a fresh explicit microphone enable waits for outstanding revocation cleanup',()=>harness(async h=>{
 await h.media.join(credential());await h.media.microphone(true,'microphone-A');
 const participant=h.media.room.localParticipant,setEnabled=participant.setMicrophoneEnabled.bind(participant),started=deferred(),finish=deferred();
 participant.setMicrophoneEnabled=async(enabled,options)=>{if(!enabled){started.resolve();await finish.promise;}await setEnabled(enabled,options);};
 publishSources(h,['camera']);await started.promise;publishSources(h,['camera','microphone']);
 const enabling=h.media.microphone(true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.microphoneCaptures.length,1);
 finish.resolve();await enabling;
 assert.equal(h.microphoneCaptures.length,2);assert.equal(participant.isMicrophoneEnabled,true);
 assert.equal(participant.getTrackPublication('microphone').track.mediaStreamTrack.readyState,'live');
}));

for(const effect of ['none','blur'])test(`a replacement credential without camera permission disables retained ${effect} input`,()=>harness(async h=>{
 await h.media.join(credential());if(effect!=='none')await h.media.setEffect(effect);await h.media.camera(true,'camera-A');
 const track=h.media.ownedCamera.track;
 await h.media.join(credential('restricted',[]));
 assert.equal(h.media.allowed('camera'),false);assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);
 assert.equal(h.media.room.localParticipant.getTrackPublication('camera'),undefined);
 await h.media.join(credential('permitted-again'));
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);
 assert.equal(h.media.room.localParticipant.getTrackPublication('camera'),undefined);
 assert.equal(h.captures.length,1);assert.equal(h.media.effect,effect);
}));

for(const effect of ['none','blur'])for(const regrant of [false,true])test(`retained ${effect} camera republish stays muted after revocation${regrant?' and regrant':''}`,()=>harness(async h=>{
 await h.media.join(credential());if(effect!=='none')await h.media.setEffect(effect);await h.media.camera(true,'camera-A');
 const track=h.media.ownedCamera.track,started=deferred(),finish=deferred(),OriginalRoom=globalThis.LivekitClient.Room;
 globalThis.LivekitClient.Room=class extends OriginalRoom{
  constructor(...args){super(...args);const publish=this.localParticipant.publishTrack.bind(this.localParticipant);
   this.localParticipant.publishTrack=async(input,options)=>{started.resolve();await finish.promise;return publish(input,options);};}
 };
 const joining=h.media.join(credential('replacement-identity'));await started.promise;
 assert.equal(h.media.ownedCamera.actual,null,'Revocation occurs while the retained track has no publication.');
 publishSources(h,['microphone']);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);
 if(regrant)publishSources(h,['camera','microphone']);finish.resolve();await joining;await h.media.operation;
 assert.equal(h.media.allowed('camera'),regrant);assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);
 assert.equal(h.media.ownedCamera.actual.isMuted,true);assert.equal(h.captures.length,1);assert.equal(h.media.effect,effect);
 if(!regrant)publishSources(h,['camera','microphone']);
 await h.media.camera(true);assert.equal(h.media.cameraOn,true);assert.equal(track.rawTrack.enabled,true);
 assert.equal(h.captures.length,1);assert.equal(h.processors.length,effect==='blur'?1:0);
}));

test('explicit protected camera retry after a restricted transfer republishes its retained track and processor',()=>harness(async h=>{
 await h.media.join(credential());await h.media.setEffect('blur');await h.media.camera(true,'camera-A');
 const track=h.media.ownedCamera.track,processor=track.getProcessor();
 await h.media.join(credential('restricted',[]));await h.media.join(credential('permitted-again'));
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);assert.equal(h.media.ownedCamera.actual,null);
 await h.media.camera(true);
 assert.equal(h.media.room.localParticipant.getTrackPublication('camera').track,track);assert.equal(h.media.ownedCamera.actual.track,track);
 assert.equal(h.media.cameraOn,true);assert.equal(track.rawTrack.enabled,true);assert.equal(track.getProcessor(),processor);
 assert.equal(h.media.effect,'blur');assert.equal(h.media.cameraDevice,'camera-A');assert.equal(h.captures.length,1);assert.equal(h.processors.length,1);
}));

test('protected retry publication crossing camera revocation stays muted despite regrant',()=>harness(async h=>{
 await h.media.join(credential());await h.media.setEffect('blur');await h.media.camera(true,'camera-A');
 const track=h.media.ownedCamera.track;await h.media.join(credential('restricted',[]));await h.media.join(credential('permitted-again'));
 const participant=h.media.room.localParticipant,publish=participant.publishTrack.bind(participant),started=deferred(),finish=deferred();
 participant.publishTrack=async(input,options)=>{started.resolve();await finish.promise;return publish(input,options);};
 const retrying=h.media.camera(true);await started.promise;
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,true);
 publishSources(h,['microphone']);await new Promise(resolve=>setImmediate(resolve));assert.equal(track.rawTrack.enabled,false);
 publishSources(h,['camera','microphone']);finish.resolve();await retrying;await h.media.operation;
 assert.equal(h.media.cameraOn,false);assert.equal(track.rawTrack.enabled,false);assert.equal(h.media.ownedCamera.actual.isMuted,true);
 assert.equal(h.media.effect,'blur');assert.equal(h.captures.length,1);assert.equal(h.processors.length,1);
 await h.media.camera(true);assert.equal(h.media.cameraOn,true);assert.equal(track.rawTrack.enabled,true);
}));

test('leaving during a protected retry publication cannot keep the old capture or room alive',()=>harness(async h=>{
 await h.media.join(credential());await h.media.setEffect('blur');await h.media.camera(true);
 const track=h.media.ownedCamera.track;await h.media.join(credential('restricted',[]));await h.media.join(credential('permitted-again'));
 const participant=h.media.room.localParticipant,publish=participant.publishTrack.bind(participant),started=deferred(),finish=deferred();
 participant.publishTrack=async(input,options)=>{started.resolve();await finish.promise;return publish(input,options);};
 const retrying=h.media.camera(true);await started.promise;const leaving=h.media.leave();finish.resolve();
 const settled=await Promise.allSettled([retrying,leaving]);assert.equal(settled[1].status,'fulfilled');
 assert.equal(h.media.cameraOn,false);assert.equal(h.media.room,null);assert.equal(h.media.ownedCamera,null);assert.equal(h.media.background,null);
 assert.equal(track.rawTrack.enabled,false);assert.equal(track.mediaStreamTrack.readyState,'ended');
}));

for(const revoked of ['screen_share','screen_share_audio','both'])test(`pending screen capture is stopped after ${revoked} revocation and regrant`,()=>harness(async h=>{
 await h.media.join(credential());const participant=h.media.room.localParticipant,setShare=participant.setScreenShareEnabled.bind(participant);
 const started=deferred(),finish=deferred(),captured=[];
 const publish=participant.publishTrack.bind(participant);
 participant.publishTrack=async(track,options)=>{if(options.source.startsWith('screen_share'))captured.push(track);return publish(track,options);};
 participant.setScreenShareEnabled=async(enabled,options)=>{
  if(enabled){started.resolve();await finish.promise;await setShare(enabled,options);}
  else await setShare(enabled,options);
 };
 const sharing=h.media.share(true);await started.promise;
 publishSources(h,credential().sources.filter(source=>revoked==='both'?!source.startsWith('screen_share'):source!==revoked));
 publishSources(h,credential().sources);finish.resolve();await sharing;await h.media.operation;
 assert.equal(h.media.allowed('screen_share'),true);assert.equal(participant.isScreenShareEnabled,false);
 assert.equal(captured.length,2);assert.ok(captured.every(track=>track.mediaStreamTrack.readyState==='ended'));
 assert.equal([...participant.trackPublications.values()].filter(p=>p.source.startsWith('screen_share')).length,0);
 participant.setScreenShareEnabled=setShare;await h.media.share(true);
 assert.equal(participant.isScreenShareEnabled,true);assert.equal(h.shareOptions.audio,true);
 assert.equal([...participant.trackPublications.values()].filter(p=>p.source.startsWith('screen_share')).length,2);
}));

test('audio-only permission revocation stops an active screen capture; a fresh permitted share can omit audio',()=>harness(async h=>{
 await h.media.join(credential());await h.media.share(true);const participant=h.media.room.localParticipant;
 const captured=[...participant.trackPublications.values()].map(publication=>publication.track);
 publishSources(h,['camera','microphone','screen_share']);await h.media.operation;
 assert.equal(h.media.allowed('screen_share'),true);assert.equal(h.media.allowed('screen_share_audio'),false);
 assert.equal(participant.isScreenShareEnabled,false);assert.ok(captured.every(track=>track.mediaStreamTrack.readyState==='ended'));
 assert.equal(participant.trackPublications.size,0);
 await h.media.share(true);assert.equal(h.shareOptions.audio,false);assert.equal(participant.trackPublications.size,1);
 assert.equal(participant.getTrackPublication('screen_share_audio'),undefined);
 await h.media.share(false);assert.equal(participant.trackPublications.size,0);
}));

test('a screen SDK failure after partial publication stops all captured sources',()=>harness(async h=>{
 await h.media.join(credential());const participant=h.media.room.localParticipant,setShare=participant.setScreenShareEnabled.bind(participant),captured=[];
 participant.setScreenShareEnabled=async(enabled,options)=>{
  await setShare(enabled,options);
  if(enabled){captured.push(...[...participant.trackPublications.values()].map(publication=>publication.track));throw new Error('Inert partial screen capture failure');}
 };
 await assert.rejects(()=>h.media.share(true),/partial screen capture failure/);
 assert.equal(participant.isScreenShareEnabled,false);assert.equal(participant.trackPublications.size,0);
 assert.equal(captured.length,2);assert.ok(captured.every(track=>track.mediaStreamTrack.readyState==='ended'));
}));
