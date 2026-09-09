const SOURCE={camera:'camera',microphone:'microphone',screen:'screen_share',shareAudio:'screen_share_audio'};
const sourceName=source=>typeof source==='string'?source:({1:SOURCE.camera,2:SOURCE.microphone,3:SOURCE.screen,4:SOURCE.shareAudio}[source]);
const liveTrack=track=>track?.mediaStreamTrack?.readyState==='live';
const captureOptions=deviceId=>deviceId?{deviceId:{exact:deviceId}}:{};

/** One owned camera/processor survives permission epochs; explicit leave owns final cleanup. */
export class DebateMedia {
  constructor({audioRoot,presentation,onState=()=>{},onIssue=()=>{},onVideo=()=>{},onPresentation=()=>{}}){
    Object.assign(this,{audioRoot,presentation,onState,onIssue,onVideo,onPresentation});
    this.room=null;this.credential=null;this.generation=0;this.operation=Promise.resolve();
    this.audioTracks=new Map();this.videos=new Map();this.localTracks=new Map();this.sources=[];
    this.background=null;this.effect='none';this.customFile=null;this.customPath='';
    this.ownedCamera=null;this.cameraOn=false;this.cameraDevice='';this.microphoneDevice='';
    this.priority=new Set();this.visible=new Set();this.subscriptionState=new WeakMap();
    this.busy=false;this.captureEpoch=null;
    // A stable facade lets the existing controller retain its track/processor
    // while a new authorized RTC identity replaces only the publication.
    this.cameraBridge={
      publishTrack:async(track,options)=>{
        if(this.captureEpoch!==this.generation||!this.allowed(SOURCE.camera))throw new Error('Camera entry was cancelled.');
        const room=this.room,epoch=this.generation;
        const actual=await room.localParticipant.publishTrack(track,options);
        if(epoch!==this.generation||room!==this.room){await room.localParticipant.unpublishTrack(track,true).catch(()=>{});track.stop();throw new Error('Camera entry was cancelled.');}
        const owned={track,actual,room,protected:true};
        const facade={get track(){return owned.actual?.track||owned.track;},get isMuted(){return owned.actual?.isMuted??owned.track.isMuted;},
          mute:()=>owned.actual?.mute?.()||owned.track.mute(),unmute:()=>owned.actual?.unmute?.()||owned.track.unmute()};
        this.ownedCamera=owned;return facade;
      },
      unpublishTrack:async(track,stop)=>{
        const owned=this.ownedCamera;if(owned?.track!==track)return undefined;
        const actual=owned.actual;const result=await owned.room?.localParticipant.unpublishTrack(track,stop);
        owned.actual=null;owned.room=null;
        return result||(actual?{...actual,track:undefined}:{track:undefined});
      },
    };
  }
  get joined(){return this.room?.state==='connected';}
  allowed(source){return this.joined&&this.sources.includes(source);}
  emit(){this.onState({joined:this.joined,microphone:!!this.room?.localParticipant.isMicrophoneEnabled,
    camera:this.joined&&this.cameraOn&&!!this.ownedCamera?.actual&&liveTrack(this.ownedCamera.track),
    share:!!this.room?.localParticipant.isScreenShareEnabled,sources:[...this.sources],state:this.room?.state||'disconnected'});}
  enqueue(operation){const run=this.operation.catch(()=>{}).then(operation);this.operation=run;return run;}

  join(credential){
    if(!credential?.identity||!credential?.roomName||!Array.isArray(credential.sources))return Promise.reject(new Error('The room credential could not be confirmed.'));
    if(this.joined&&this.credential?.identity===credential.identity&&this.credential.roomName===credential.roomName){this.sources=[...credential.sources];this.credential=credential;this.emit();return Promise.resolve();}
    const epoch=++this.generation;
    return this.enqueue(async()=>{
      if(epoch!==this.generation)return;
      await this.suspendInternal();if(epoch!==this.generation)return;
      const kit=globalThis.LivekitClient;
      if(!kit?.Room)throw new Error('Video conferencing could not load. Refresh or continue with the saved competition controls.');
      this.sources=[...credential.sources];this.credential=credential;
      const room=new kit.Room({adaptiveStream:true,dynacast:true,stopLocalTrackOnUnpublish:false,
        videoCaptureDefaults:{resolution:{width:1280,height:720,frameRate:24}},
        audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
        publishDefaults:{simulcast:true,videoSimulcastLayers:[{width:320,height:180,encoding:{maxBitrate:120000,maxFramerate:15}}]}});
      this.room=room;const current=()=>this.room===room&&epoch===this.generation;
      const bind=(name,handler)=>{const event=kit.RoomEvent?.[name];if(event)room.on(event,(...args)=>{if(current())handler(...args);});};
      bind('TrackSubscribed',(track,publication,participant)=>this.attach(track,publication,participant));
      bind('TrackUnsubscribed',(_track,publication)=>this.detach(publication.trackSid));
      bind('LocalTrackPublished',publication=>{this.localTracks.set(publication.trackSid,publication.track);this.attach(publication.track,publication,room.localParticipant);});
      bind('LocalTrackUnpublished',publication=>{
        const track=this.localTracks.get(publication.trackSid);if(track&&track!==this.ownedCamera?.track)track.stop();
        this.localTracks.delete(publication.trackSid);this.detach(publication.trackSid);
      });
      for(const event of ['TrackPublished','TrackUnpublished','ParticipantConnected'])bind(event,()=>this.syncSubscriptions());
      bind('ParticipantDisconnected',participant=>{
        for(const [sid,item]of [...this.videos,...this.audioTracks])if(item.identity===participant.identity)this.detach(sid);
        this.onIssue('A participant disconnected. The moderator can request a technical pause; the shared clock has not changed.');
      });
      for(const event of ['ConnectionStateChanged','LocalTrackMuted','LocalTrackUnmuted'])bind(event,()=>this.emit());
      bind('Disconnected',()=>{
        for(const track of this.localTracks.values())if(track!==this.ownedCamera?.track)track.stop();this.localTracks.clear();
        if(this.ownedCamera)this.ownedCamera.actual=null;
        for(const sid of [...this.audioTracks.keys(),...this.videos.keys()])this.detach(sid);
        this.emit();
      });
      bind('ParticipantPermissionsChanged',(_previous,participant)=>{
        if(participant&&participant!==room.localParticipant)return;
        const known=room.localParticipant.permissions?.canPublishSources;
        if(Array.isArray(known))this.sources=known.map(sourceName).filter(Boolean);
        if(!this.sources.includes(SOURCE.camera)&&this.cameraOn)this.stopCameraSafely().catch(error=>this.onIssue(error.message));
        this.emit();
      });
      try{
        await room.connect(credential.url,credential.token,{autoSubscribe:false});
        if(!current()){await room.disconnect(false);return;}
        this.syncSubscriptions();const owned=this.ownedCamera;
        if(this.cameraOn&&this.sources.includes(SOURCE.camera)&&liveTrack(owned?.track)){
          if(owned.protected&&!this.background?.snapshot().processorAttached)throw new Error('Your protected camera needs an explicit retry before it can publish.');
          owned.actual=await room.localParticipant.publishTrack(owned.track,{source:SOURCE.camera});owned.room=room;
          if(!current()){await room.localParticipant.unpublishTrack(owned.track,false);return;}
          this.attach(owned.track,owned.actual,room.localParticipant);
        }else if(this.cameraOn){this.cameraOn=false;this.onIssue('Camera is off. Its previous capture or permission is unavailable; enable it explicitly when ready.');}
        this.emit();
      }catch(error){if(current()){await this.suspendInternal();this.cameraOn=false;this.emit();}throw error;}
    });
  }
  suspend(){++this.generation;return this.enqueue(()=>this.suspendInternal());}
  async suspendInternal(){
    const room=this.room;this.room=null;this.sources=[];
    if(room){
      // Only an existing camera survives. Mic/share sources stop before leaving.
      for(const publication of [...(room.localParticipant.trackPublications?.values()||[])]){
        if(publication.track===this.ownedCamera?.track){try{await room.localParticipant.unpublishTrack(publication.track,false);}catch{this.cameraOn=false;publication.track.stop();}}
        else{try{await room.localParticipant.unpublishTrack(publication.track,true);}catch{publication.track?.stop?.();}}
      }
      if(this.ownedCamera){this.ownedCamera.actual=null;this.ownedCamera.room=null;}
      for(const track of this.localTracks.values())if(track!==this.ownedCamera?.track)track.stop();this.localTracks.clear();
      for(const sid of [...this.audioTracks.keys(),...this.videos.keys()])this.detach(sid);
      await room.disconnect(false);
    }
    this.emit();
  }
  setVideoSubscriptions({priority=[],visible=[]}={}){
    this.priority=new Set(priority.filter(x=>typeof x==='string'));
    this.visible=new Set(visible.filter(x=>typeof x==='string').slice(0,12));this.syncSubscriptions();
  }
  shouldSubscribe(publication,participant){const source=sourceName(publication.source);return[SOURCE.microphone,SOURCE.shareAudio,SOURCE.screen].includes(source)
    ||source===SOURCE.camera&&(this.priority.has(participant.identity)||this.visible.has(participant.identity));}
  syncSubscriptions(){
    if(!this.room)return;
    for(const participant of this.room.remoteParticipants?.values()||[])for(const publication of participant.trackPublications?.values()||[]){
      const wanted=this.shouldSubscribe(publication,participant);
      if(this.subscriptionState.get(publication)!==wanted){publication.setSubscribed?.(wanted);this.subscriptionState.set(publication,wanted);if(!wanted)this.detach(publication.trackSid);}
      if(wanted&&sourceName(publication.source)===SOURCE.camera){const quality=this.priority.has(participant.identity)?globalThis.LivekitClient?.VideoQuality?.MEDIUM:globalThis.LivekitClient?.VideoQuality?.LOW;if(quality!==undefined)publication.setVideoQuality?.(quality);}
      if(wanted&&publication.track)this.attach(publication.track,publication,participant);
    }
  }
  attach(track,publication,participant){
    if(!track||!publication?.trackSid||!this.room)return;
    const local=participant===this.room.localParticipant;
    if(!local&&!this.shouldSubscribe(publication,participant)){publication.setSubscribed?.(false);return;}
    const sid=publication.trackSid,existing=this.audioTracks.get(sid)||this.videos.get(sid);if(existing?.track===track)return;
    this.detach(sid);const source=sourceName(publication.source);
    if(track.kind==='audio'){
      if(local)return;
      const element=document.createElement('audio');element.autoplay=true;element.dataset.trackSid=sid;track.attach(element);this.audioRoot.append(element);
      this.audioTracks.set(sid,{element,track,identity:participant.identity,source});
      element.play().catch(()=>{if(this.audioTracks.get(sid)?.element===element)this.onIssue('Tap Enable sound to hear the room.');});
    }else if(track.kind==='video'){
      const element=document.createElement('video');element.autoplay=true;element.playsInline=true;element.muted=true;element.dataset.trackSid=sid;track.attach(element);
      const item={element,track,identity:participant.identity,source,lastTime:-1,lastFrame:performance.now(),label:''};this.videos.set(sid,item);
      if(source===SOURCE.screen){this.presentation.replaceChildren(element);this.presentation.hidden=false;element.style.objectFit='contain';}
      const report=()=>{if(this.videos.get(sid)!==item)return;
        if(element.currentTime!==item.lastTime&&element.videoWidth>0){item.lastFrame=performance.now();item.lastTime=element.currentTime;}
        const label=performance.now()-item.lastFrame>5000?'Video stalled':element.videoWidth?'Video':'Starting video';if(item.label===label)return;item.label=label;
        if(source===SOURCE.screen){this.presentation.setAttribute('aria-label',`Shared screen · ${label}`);this.onPresentation(element,label);}else this.onVideo(participant.identity,element,label);};
      report();item.health=setInterval(report,1500);
      element.play().catch(()=>{if(this.videos.get(sid)===item)this.onIssue('Video playback needs another tap. Use Enable sound to resume playback.');});
    }
    this.emit();
  }
  detach(sid){
    const item=this.audioTracks.get(sid)||this.videos.get(sid);if(!item)return;
    clearInterval(item.health);item.track.detach(item.element);item.element.pause();item.element.srcObject=null;item.element.remove();this.audioTracks.delete(sid);this.videos.delete(sid);
    if(item.source===SOURCE.screen&&!this.presentation.querySelector('video')){this.presentation.hidden=true;this.onPresentation(null,'Screen sharing stopped');}
    if(item.source===SOURCE.camera)this.onVideo(item.identity,null,'Camera off');
  }
  microphone(enabled,deviceId){const epoch=this.generation;return this.enqueue(async()=>{
    if(epoch!==this.generation)return;
    if(enabled&&!this.allowed(SOURCE.microphone))throw new Error('You do not have the microphone floor. Request help or wait for your speaking stage.');if(!this.room)return;
    const room=this.room;
    if(deviceId&&deviceId!==this.microphoneDevice&&room.localParticipant.isMicrophoneEnabled){const track=room.localParticipant.getTrackPublication(SOURCE.microphone)?.track;if(track)await track.restartTrack(captureOptions(deviceId));}
    this.microphoneDevice=deviceId??this.microphoneDevice;await room.localParticipant.setMicrophoneEnabled(enabled,captureOptions(this.microphoneDevice));
    if(epoch!==this.generation)await room.localParticipant.setMicrophoneEnabled(false);this.emit();
  });}
  backgroundController(){
    if(!this.background){const factory=globalThis.DueDiligenceStudyRoomMandatoryBackground?.createController;if(!factory)throw new Error('Background effects could not load. The camera remains off.');
      this.background=factory({getLocalParticipant:()=>this.cameraBridge,maxFps:15,onStateChange:state=>{if(state.error){this.cameraOn=false;this.onIssue(`${state.error} Select None explicitly to use your raw camera.`);}this.emit();}});}
    return this.background;
  }
  async effectRequest(effect,file){
    if(effect==='none')return{mode:'disabled'};if(effect==='blur')return{mode:'background-blur',blurRadius:10};
    if(effect==='brand')return{mode:'virtual-background',imagePath:'/assets/study-room/virtual-background-due-diligence-polished-20260908.webp'};
    if(file?.size){const registered=await this.backgroundController().registerCustomBackground(file);this.customFile=file;this.customPath=registered.imagePath;}
    if(!this.customPath)throw new Error('Choose your custom image again. Your camera stays off until that selection is ready.');return{mode:'virtual-background',imagePath:this.customPath};
  }
  async stopCameraSafely(){
    const owned=this.ownedCamera;
    try{
      if(this.background)await this.background.disableCamera();else await owned?.actual?.mute?.();
      if(owned?.actual&&owned.actual.isMuted!==true&&owned.track.isMuted!==true)throw new Error('Camera mute could not be confirmed.');
    }catch{
      // A failed mute must never leave a green/false Off state with outgoing
      // video. Stop the owned source even if transport cleanup is unavailable.
      try{if(owned?.actual&&owned.room)await owned.room.localParticipant.unpublishTrack(owned.track,true);}finally{owned?.track?.stop?.();}
      if(this.background){await this.background.destroy();this.background=null;this.customPath='';this.customFile=null;}
      this.ownedCamera=null;
    }finally{this.cameraOn=false;this.emit();}
  }
  camera(enabled,deviceId){const epoch=this.generation;return this.enqueue(async()=>{
    if(epoch!==this.generation)return;this.busy=true;this.captureEpoch=epoch;
    try{if(!enabled){await this.stopCameraSafely();return;}
      if(!this.allowed(SOURCE.camera))throw new Error('Camera publishing is restricted or this room is not connected.');await this.enableCameraInternal(deviceId,epoch);
    }catch(error){await this.stopCameraSafely();throw error;}
    finally{this.busy=false;this.captureEpoch=null;}
  });}
  async enableCameraInternal(deviceId,epoch){
    const changed=deviceId!==undefined&&deviceId!==this.cameraDevice;this.cameraDevice=deviceId??this.cameraDevice;const options=captureOptions(this.cameraDevice);
    if(this.effect!=='none'||this.background){const controller=this.backgroundController();
      if(!controller.capabilities().supported)throw new Error('This browser cannot apply backgrounds. Select None explicitly to show your actual background.');
      await controller.switchBackground(await this.effectRequest(this.effect));
      if(changed&&this.ownedCamera?.actual)await controller.switchCamera(options);else await controller.enableCamera(options);
    }else{
      const room=this.room;
      if(this.ownedCamera?.actual&&liveTrack(this.ownedCamera.track)){if(changed)await this.ownedCamera.track.restartTrack(options);await this.ownedCamera.actual.unmute();}
      else{
        const previous=this.ownedCamera;
        if(previous?.actual&&previous.room)await previous.room.localParticipant.unpublishTrack(previous.track,true);
        previous?.track?.stop?.();this.ownedCamera=null;
        const track=await globalThis.LivekitClient.createLocalVideoTrack(options);
        if(epoch!==this.generation||room!==this.room){track.stop();return;}
        let actual;try{actual=await room.localParticipant.publishTrack(track,{source:SOURCE.camera});}catch(error){track.stop();throw error;}
        this.ownedCamera={track,actual,room,protected:false};}
    }
    if(epoch!==this.generation){await this.ownedCamera?.actual?.mute?.();this.cameraOn=false;return;}
    this.cameraOn=true;if(this.ownedCamera?.actual)this.attach(this.ownedCamera.track,this.ownedCamera.actual,this.room.localParticipant);this.emit();
  }
  setEffect(effect,file){
    if(!['none','blur','brand','custom'].includes(effect))return Promise.reject(new Error('Choose a supported background.'));
    const epoch=this.generation;return this.enqueue(async()=>{
      if(epoch!==this.generation)return;if(!this.room)throw new Error('Enter the room before choosing a background.');this.captureEpoch=epoch;this.busy=true;
      const wasOn=this.cameraOn,oldPath=this.customPath;
      try{
        if(effect==='none'&&!this.background){this.effect='none';return;}
        const controller=this.backgroundController();
        if(effect==='none'&&!controller.capabilities().supported){
          await controller.destroy();this.background=null;this.effect='none';
          if(wasOn)await this.enableCameraInternal(undefined,epoch);return;
        }
        if(!controller.capabilities().supported)throw new Error('Background effects are unavailable. Select None explicitly to show your actual background.');
        const request=await this.effectRequest(effect,file);if(epoch!==this.generation)return;
        this.effect=effect;
        if(this.ownedCamera&&!this.ownedCamera.protected){const owned=this.ownedCamera;await owned.room.localParticipant.unpublishTrack(owned.track,false);owned.track.stop();this.ownedCamera=null;}
        await controller.switchBackground(request);if(oldPath&&oldPath!==this.customPath)controller.removeCustomBackground(oldPath);
        if(wasOn)await this.enableCameraInternal(undefined,epoch);
      }catch(error){await this.stopCameraSafely();throw error;}
      finally{this.captureEpoch=null;this.busy=false;this.emit();}
    });
  }
  share(enabled){const epoch=this.generation;return this.enqueue(async()=>{
    if(epoch!==this.generation)return;if(enabled&&!this.allowed(SOURCE.screen))throw new Error('Screen sharing needs the moderator’s presenter permission.');
    if(enabled&&!navigator.mediaDevices?.getDisplayMedia)throw new Error('This browser cannot share its screen. Present a source link or document through Shared evidence.');if(!this.room)return;
    const room=this.room;await room.localParticipant.setScreenShareEnabled(enabled,{audio:this.sources.includes(SOURCE.shareAudio),resolution:{width:1920,height:1080,frameRate:10}});
    if(epoch!==this.generation)await room.localParticipant.setScreenShareEnabled(false);this.emit();
  });}
  async enableSound(){await this.room?.startAudio();await Promise.allSettled([...this.audioTracks.values(),...this.videos.values()].map(x=>x.element.play()));}
  async devices(){return navigator.mediaDevices?.enumerateDevices()||[];}
  leave(){
    ++this.generation;this.cameraOn=false;
    // Destroy marks a pending processor immediately; late capture cannot publish.
    const destroyed=this.background?.destroy().catch(error=>this.onIssue(error.message));
    return this.enqueue(async()=>{
      await this.suspendInternal();await destroyed;this.ownedCamera?.track?.stop?.();this.ownedCamera=null;this.background=null;
      this.credential=null;
      this.customFile=null;this.customPath='';this.cameraDevice='';this.microphoneDevice='';this.priority.clear();this.visible.clear();this.emit();
    });
  }
}
