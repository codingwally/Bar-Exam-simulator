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
    this.busy=false;this.captureEpoch=null;this.capturePermissionEpoch=null;
    this.permissionEpochs={camera:0,microphone:0,screen_share:0,screen_share_audio:0};
    // A stable facade lets the existing controller retain its track/processor
    // while a new authorized RTC identity replaces only the publication.
    this.cameraBridge={
      publishTrack:async(track,options)=>{
        if(!this.cameraCaptureCurrent())throw new Error('Camera entry was cancelled.');
        const room=this.room,epoch=this.generation;
        const actual=await room.localParticipant.publishTrack(track,options);
        if(epoch!==this.generation||room!==this.room||!this.cameraCaptureCurrent()){await room.localParticipant.unpublishTrack(track,true).catch(()=>{});track.stop();throw new Error('Camera entry was cancelled.');}
        const owned={track,actual,room,protected:true};
        const facade={get track(){return owned.actual?.track||owned.track;},get isMuted(){return owned.actual?.isMuted??owned.track.isMuted;},
          mute:()=>owned.actual?.mute?.()||owned.track.mute(),unmute:async()=>{
            if(!this.cameraCaptureCurrent())throw new Error('Camera entry was cancelled.');
            await (owned.actual?.unmute?.()||owned.track.unmute());
            if(!this.cameraCaptureCurrent()){
              try{await (owned.actual?.mute?.()||owned.track.mute());}catch{owned.track.stop();}
              throw new Error('Camera entry was cancelled.');
            }
          }};
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
  cameraCaptureCurrent(){return this.captureEpoch===this.generation&&this.capturePermissionEpoch===this.permissionEpochs.camera&&this.allowed(SOURCE.camera);}
  updateSources(sources){
    const previous=this.sources;this.sources=[...sources];
    const revoked=[SOURCE.camera,SOURCE.microphone,SOURCE.screen,SOURCE.shareAudio].filter(source=>previous.includes(source)&&!this.sources.includes(source));
    for(const source of revoked){
      // A later grant must not revive an operation that crossed a revocation.
      ++this.permissionEpochs[source];
    }
    const stoppingOperations=[];
    if(revoked.includes(SOURCE.camera)&&(this.cameraOn||this.captureEpoch===this.generation))stoppingOperations.push(this.stopCameraSafely());
    if(revoked.includes(SOURCE.microphone))stoppingOperations.push(this.stopMicrophoneSafely());
    if(revoked.includes(SOURCE.screen)||revoked.includes(SOURCE.shareAudio))stoppingOperations.push(this.stopShareSafely());
    for(const stopping of stoppingOperations){
      if(stopping)this.operation=Promise.all([this.operation.catch(()=>{}),stopping.catch(error=>this.onIssue(error.message))]).then(()=>{});
    }
  }
  emit(){this.onState({joined:this.joined,microphone:!!this.room?.localParticipant.isMicrophoneEnabled,
    camera:this.joined&&this.cameraOn&&!!this.ownedCamera?.actual&&liveTrack(this.ownedCamera.track),
    share:!!this.room?.localParticipant.isScreenShareEnabled,sources:[...this.sources],state:this.room?.state||'disconnected'});}
  enqueue(operation){const run=this.operation.catch(()=>{}).then(operation);this.operation=run;return run;}

  join(credential){
    if(!credential?.identity||!credential?.roomName||!Array.isArray(credential.sources))return Promise.reject(new Error('We could not confirm your room access. Try entering again.'));
    if(this.joined&&this.credential?.identity===credential.identity&&this.credential.roomName===credential.roomName){this.updateSources(credential.sources);this.credential=credential;this.emit();return Promise.resolve();}
    const epoch=++this.generation;
    return this.enqueue(async()=>{
      if(epoch!==this.generation)return;
      await this.suspendInternal();if(epoch!==this.generation)return;
      const kit=globalThis.LivekitClient;
      if(!kit?.Room)throw new Error('Video could not load. Refresh the page or continue using the debate’s written features.');
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
        const permissions=room.localParticipant.permissions,known=permissions?.canPublishSources;
        if(permissions?.canPublish===false)this.updateSources([]);
        else if(Array.isArray(known))this.updateSources(known.map(sourceName).filter(Boolean));
        this.emit();
      });
      try{
        await room.connect(credential.url,credential.token,{autoSubscribe:false});
        if(!current()){await room.disconnect(false);return;}
        this.syncSubscriptions();const owned=this.ownedCamera;
        if(this.cameraOn&&this.sources.includes(SOURCE.camera)&&liveTrack(owned?.track)){
          if(owned.protected&&!this.background?.snapshot().processorAttached)throw new Error('Restart your camera to continue using the selected background.');
          const permissionEpoch=this.permissionEpochs.camera;
          owned.actual=await room.localParticipant.publishTrack(owned.track,{source:SOURCE.camera});owned.room=room;
          if(permissionEpoch!==this.permissionEpochs.camera||!this.allowed(SOURCE.camera)||!this.cameraOn){
            await this.stopCameraSafely();
            if(!current())await room.localParticipant.unpublishTrack(owned.track,false);
            return;
          }
          if(!current()){await room.localParticipant.unpublishTrack(owned.track,false);return;}
          this.attach(owned.track,owned.actual,room.localParticipant);
        }else if(this.cameraOn){await this.stopCameraSafely();this.onIssue('Your camera is off. Turn it on again when you are ready.');}
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
  async stopMicrophoneSafely(room=this.room,track=room?.localParticipant.getTrackPublication(SOURCE.microphone)?.track){
    if(!room)return;
    // Stop the source even if the SDK mute is waiting for a device restart.
    track?.stop();
    try{await room.localParticipant.setMicrophoneEnabled(false);}
    finally{if(track){try{await room.localParticipant.unpublishTrack(track,true);}finally{track.stop();}}this.emit();}
  }
  microphone(enabled,deviceId){const epoch=this.generation,permissionEpoch=this.permissionEpochs.microphone;return this.enqueue(async()=>{
    if(epoch!==this.generation)return;
    if(enabled&&!this.allowed(SOURCE.microphone))throw new Error('You do not have the microphone floor. Request help or wait for your speaking stage.');if(!this.room)return;
    const room=this.room,current=()=>epoch===this.generation&&room===this.room&&permissionEpoch===this.permissionEpochs.microphone&&this.allowed(SOURCE.microphone);
    if(enabled&&!current())return;
    if(deviceId&&deviceId!==this.microphoneDevice&&room.localParticipant.isMicrophoneEnabled){const track=room.localParticipant.getTrackPublication(SOURCE.microphone)?.track;if(track){await track.restartTrack(captureOptions(deviceId));if(!current()){await this.stopMicrophoneSafely(room,track);return;}}}
    this.microphoneDevice=deviceId??this.microphoneDevice;await room.localParticipant.setMicrophoneEnabled(enabled,captureOptions(this.microphoneDevice));
    if(enabled&&!current())await this.stopMicrophoneSafely(room);this.emit();
  });}
  backgroundController(){
    if(!this.background){const factory=globalThis.DueDiligenceStudyRoomMandatoryBackground?.createController;if(!factory)throw new Error('Background effects could not load. The camera remains off.');
      this.background=factory({getLocalParticipant:()=>this.cameraBridge,maxFps:15,onStateChange:state=>{if(state.error){this.cameraOn=false;this.onIssue(`${state.error} Choose None to show your actual background.`);}this.emit();}});}
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
      if(this.background)await this.background.disableCamera();else if(owned?.actual)await owned.actual.mute?.();else await owned?.track?.mute?.();
      if(owned?.track&&owned.actual?.isMuted!==true&&owned.track.isMuted!==true)throw new Error('Camera mute could not be confirmed.');
    }catch{
      // A failed mute must never leave a green/false Off state with outgoing
      // video. Stop the owned source even if transport cleanup is unavailable.
      try{if(owned?.actual&&owned.room)await owned.room.localParticipant.unpublishTrack(owned.track,true);}finally{owned?.track?.stop?.();}
      if(this.background){await this.background.destroy();this.background=null;this.customPath='';this.customFile=null;}
      this.ownedCamera=null;
    }finally{this.cameraOn=false;this.emit();}
  }
  camera(enabled,deviceId){const epoch=this.generation,permissionEpoch=this.permissionEpochs.camera;return this.enqueue(async()=>{
    if(epoch!==this.generation)return;this.busy=true;this.captureEpoch=epoch;this.capturePermissionEpoch=permissionEpoch;
    try{if(!enabled){await this.stopCameraSafely();return;}
      if(!this.allowed(SOURCE.camera))throw new Error('Your camera is not available. Enter the room and check that cameras are allowed.');await this.enableCameraInternal(deviceId,epoch);
    }catch(error){await this.stopCameraSafely();throw error;}
    finally{this.busy=false;this.captureEpoch=null;this.capturePermissionEpoch=null;}
  });}
  async enableCameraInternal(deviceId,epoch){
    if(!this.cameraCaptureCurrent()){await this.stopCameraSafely();return;}
    const changed=deviceId!==undefined&&deviceId!==this.cameraDevice;this.cameraDevice=deviceId??this.cameraDevice;const options=captureOptions(this.cameraDevice);
    if(this.effect!=='none'||this.background){const controller=this.backgroundController();
      if(!controller.capabilities().supported)throw new Error('This browser cannot apply backgrounds. Choose None to show your actual background.');
      await controller.switchBackground(await this.effectRequest(this.effect));
      if(!this.cameraCaptureCurrent()){await this.stopCameraSafely();return;}
      if(changed&&this.ownedCamera?.actual)await controller.switchCamera(options);else await controller.enableCamera(options);
      const owned=this.ownedCamera,room=this.room;
      if(owned&&!owned.actual){
        if(!this.cameraCaptureCurrent()){await this.stopCameraSafely();return;}
        if(!liveTrack(owned.track)||(this.effect!=='none'&&!controller.snapshot().processorAttached))throw new Error('Restart your camera to continue using the selected background.');
        // The controller retains its track and facade across room transfers.
        // An explicit retry must replace the missing transport publication too.
        owned.actual=await room.localParticipant.publishTrack(owned.track,{source:SOURCE.camera});owned.room=room;
      }
    }else{
      const room=this.room;
      if(this.ownedCamera?.actual&&liveTrack(this.ownedCamera.track)){
        if(changed)await this.ownedCamera.track.restartTrack(options);
        if(!this.cameraCaptureCurrent()){await this.stopCameraSafely();return;}
        await this.ownedCamera.actual.unmute();
      }
      else{
        const previous=this.ownedCamera;
        if(previous?.actual&&previous.room)await previous.room.localParticipant.unpublishTrack(previous.track,true);
        previous?.track?.stop?.();this.ownedCamera=null;
        if(!this.cameraCaptureCurrent()){await this.stopCameraSafely();return;}
        const track=await globalThis.LivekitClient.createLocalVideoTrack(options);
        if(epoch!==this.generation||room!==this.room||!this.cameraCaptureCurrent()){track.stop();return;}
        let actual;try{actual=await room.localParticipant.publishTrack(track,{source:SOURCE.camera});}catch(error){track.stop();throw error;}
        this.ownedCamera={track,actual,room,protected:false};}
    }
    if(epoch!==this.generation||!this.cameraCaptureCurrent()){await this.stopCameraSafely();return;}
    this.cameraOn=true;if(this.ownedCamera?.actual)this.attach(this.ownedCamera.track,this.ownedCamera.actual,this.room.localParticipant);this.emit();
  }
  setEffect(effect,file){
    if(!['none','blur','brand','custom'].includes(effect))return Promise.reject(new Error('Choose a supported background.'));
    const epoch=this.generation,permissionEpoch=this.permissionEpochs.camera;return this.enqueue(async()=>{
      if(epoch!==this.generation)return;if(!this.room)throw new Error('Enter the room before choosing a background.');this.captureEpoch=epoch;this.capturePermissionEpoch=permissionEpoch;this.busy=true;
      const wasOn=this.cameraOn,oldPath=this.customPath;
      try{
        if(effect==='none'&&!this.background){this.effect='none';return;}
        const controller=this.backgroundController();
        if(effect==='none'&&!controller.capabilities().supported){
          await controller.destroy();this.background=null;this.effect='none';
          if(wasOn)await this.enableCameraInternal(undefined,epoch);return;
        }
        if(!controller.capabilities().supported)throw new Error('Background effects are unavailable. Choose None to show your actual background.');
        const request=await this.effectRequest(effect,file);if(epoch!==this.generation)return;
        this.effect=effect;
        if(this.ownedCamera&&!this.ownedCamera.protected){const owned=this.ownedCamera;await owned.room.localParticipant.unpublishTrack(owned.track,false);owned.track.stop();this.ownedCamera=null;}
        await controller.switchBackground(request);if(oldPath&&oldPath!==this.customPath)controller.removeCustomBackground(oldPath);
        if(wasOn)await this.enableCameraInternal(undefined,epoch);
      }catch(error){await this.stopCameraSafely();throw error;}
      finally{this.captureEpoch=null;this.capturePermissionEpoch=null;this.busy=false;this.emit();}
    });
  }
  async stopShareSafely(room=this.room){
    if(!room)return;
    const captured=()=>[...(room.localParticipant.trackPublications?.values()||[])].filter(publication=>[SOURCE.screen,SOURCE.shareAudio].includes(sourceName(publication.source))).map(publication=>publication.track).filter(Boolean);
    const tracks=new Set(captured());for(const track of tracks)track.stop();
    let failure;
    try{await room.localParticipant.setScreenShareEnabled(false);}catch(error){failure=error;}
    // A pending capture can finish while the SDK disable is in flight.
    for(const track of captured()){tracks.add(track);track.stop();}
    for(const track of tracks){try{await room.localParticipant.unpublishTrack(track,true);}catch(error){failure||=error;}finally{track.stop();}}
    this.emit();if(failure)throw failure;
  }
  share(enabled){const epoch=this.generation,screenEpoch=this.permissionEpochs.screen_share,audioEpoch=this.permissionEpochs.screen_share_audio;return this.enqueue(async()=>{
    if(epoch!==this.generation)return;if(enabled&&!this.allowed(SOURCE.screen))throw new Error('Screen sharing needs the moderator’s presenter permission.');
    if(enabled&&!navigator.mediaDevices?.getDisplayMedia)throw new Error('This browser cannot share its screen. Present a source link or document through Shared evidence.');if(!this.room)return;
    const room=this.room,audio=this.allowed(SOURCE.shareAudio);
    const current=()=>epoch===this.generation&&room===this.room&&screenEpoch===this.permissionEpochs.screen_share&&this.allowed(SOURCE.screen)
      &&(!audio||(audioEpoch===this.permissionEpochs.screen_share_audio&&this.allowed(SOURCE.shareAudio)));
    if(!enabled){await this.stopShareSafely(room);return;}if(!current())return;
    try{await room.localParticipant.setScreenShareEnabled(true,{audio,resolution:{width:1920,height:1080,frameRate:10}});}
    catch(error){await this.stopShareSafely(room).catch(()=>{});throw error;}
    if(!current())await this.stopShareSafely(room);this.emit();
  });}
  async enableSound(){await this.room?.startAudio();await Promise.allSettled([...this.audioTracks.values(),...this.videos.values()].map(x=>x.element.play()));}
  async devices(){return navigator.mediaDevices?.enumerateDevices()||[];}
  selectDevices({cameraDevice=this.cameraDevice,microphoneDevice=this.microphoneDevice}={}){
    const epoch=this.generation,cameraPermissionEpoch=this.permissionEpochs.camera,microphonePermissionEpoch=this.permissionEpochs.microphone;
    return this.enqueue(async()=>{
      if(epoch!==this.generation)return;
      if(typeof cameraDevice!=='string'||typeof microphoneDevice!=='string')throw new Error('Choose an available camera and microphone.');
      if(cameraDevice!==this.cameraDevice){
        if(this.cameraOn&&this.allowed(SOURCE.camera)){
          this.captureEpoch=epoch;this.capturePermissionEpoch=cameraPermissionEpoch;this.busy=true;
          try{await this.enableCameraInternal(cameraDevice,epoch);}
          catch(error){await this.stopCameraSafely();throw error;}
          finally{this.captureEpoch=null;this.capturePermissionEpoch=null;this.busy=false;}
        }else this.cameraDevice=cameraDevice;
      }
      if(epoch!==this.generation)return;
      if(microphoneDevice!==this.microphoneDevice){
        const room=this.room,participant=room?.localParticipant;
        if(participant?.isMicrophoneEnabled){
          if(!this.allowed(SOURCE.microphone))throw new Error('Your microphone permission changed. Wait for your speaking stage before switching an active microphone.');
          const track=participant.getTrackPublication(SOURCE.microphone)?.track;if(track){
            if(microphonePermissionEpoch!==this.permissionEpochs.microphone)return;
            await track.restartTrack(captureOptions(microphoneDevice));
            if(epoch!==this.generation||room!==this.room||microphonePermissionEpoch!==this.permissionEpochs.microphone||!this.allowed(SOURCE.microphone)){
              await this.stopMicrophoneSafely(room,track);return;
            }
          }
        }
        if(epoch!==this.generation)return;
        this.microphoneDevice=microphoneDevice;
      }
      this.emit();
    });
  }
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
