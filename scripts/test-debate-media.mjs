import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {DebateMedia} from '../assets/debate-media.js';
const backgroundSource=await readFile(new URL('../assets/study-room-backgrounds.js',import.meta.url),'utf8');
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
 const h={captures:[],processors:[],rooms:[],urls:[],revoked:[],videoCalls:[],presentationCalls:[],issues:[],states:[],intervals:new Map(),time:0,supported:true,failEffect:false,captureGate:null};
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
    async setMicrophoneEnabled(enabled){this.isMicrophoneEnabled=enabled;if(enabled&&!this.getTrackPublication('microphone'))await this.publishTrack(new Track('audio'),{source:'microphone'});},
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
 set('document',{createElement:tag=>new Element(tag)});set('navigator',{mediaDevices:{getDisplayMedia(){throw new Error('Never called directly');},enumerateDevices:async()=>[]}});
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
