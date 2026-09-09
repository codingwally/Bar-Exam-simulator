const SOURCE = {camera:'camera', microphone:'microphone', screen:'screen_share', shareAudio:'screen_share_audio'};

/** Media lifetime is independent of event, clock, form and chat rendering. */
export class DebateMedia {
  constructor({audioRoot, presentation, onState = () => {}, onIssue = () => {}, onVideo = () => {}}) {
    Object.assign(this, {audioRoot, presentation, onState, onIssue, onVideo});
    this.room = null; this.generation = 0; this.audioTracks = new Map(); this.videos = new Map();
    this.sources = []; this.background = null; this.effect = 'none'; this.busy = false;
  }
  get joined() { return this.room?.state === 'connected'; }
  allowed(source) { return this.joined && this.sources.includes(source); }
  emit() { this.onState({joined:this.joined, microphone:!!this.room?.localParticipant.isMicrophoneEnabled,
    camera:!!this.room?.localParticipant.isCameraEnabled, share:!!this.room?.localParticipant.isScreenShareEnabled,
    sources:this.sources, state:this.room?.state || 'disconnected'}); }

  async join(credential) {
    await this.leave();
    const epoch = ++this.generation;
    const kit = globalThis.LivekitClient;
    if (!kit?.Room) throw new Error('Video conferencing could not load. Refresh or continue with the saved competition controls.');
    this.sources = [...credential.sources];
    const room = new kit.Room({adaptiveStream:true,dynacast:true,
      videoCaptureDefaults:{resolution:{width:1280,height:720,frameRate:24}},
      audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      publishDefaults:{simulcast:true,videoSimulcastLayers:[{width:320,height:180,encoding:{maxBitrate:120000,maxFramerate:15}}]}});
    this.room = room;
    const events = kit.RoomEvent;
    room.on(events.TrackSubscribed, (track, publication, participant) => this.attach(track, publication, participant));
    room.on(events.TrackUnsubscribed, (track, publication) => this.detach(publication.trackSid));
    room.on(events.LocalTrackPublished, (publication) => this.attach(publication.track, publication, room.localParticipant));
    room.on(events.LocalTrackUnpublished, (publication) => this.detach(publication.trackSid));
    room.on(events.ParticipantDisconnected, (participant) => {
      for (const [sid,item] of [...this.videos]) if (item.identity === participant.identity) this.detach(sid);
      for (const [sid,item] of [...this.audioTracks]) if (item.identity === participant.identity) this.detach(sid);
      this.onIssue('A participant disconnected. The moderator can request a technical pause; the shared clock has not been changed.');
    });
    room.on(events.ConnectionStateChanged, () => this.emit());
    room.on(events.Disconnected, () => this.emit());
    room.on(events.LocalTrackMuted, () => this.emit());
    room.on(events.LocalTrackUnmuted, () => this.emit());
    room.on(events.ParticipantPermissionsChanged, () => {
      const permissions = room.localParticipant.permissions;
      const known = permissions?.canPublishSources;
      if (Array.isArray(known)) this.sources = known.map(x => typeof x === 'string' ? x : ({1:'camera',2:'microphone',3:'screen_share',4:'screen_share_audio'}[x])).filter(Boolean);
      this.emit();
    });
    try {
      await room.connect(credential.url, credential.token, {autoSubscribe:true});
      if (epoch !== this.generation) { await room.disconnect(); return; }
      // Connecting never starts capture. Both devices require the member's click.
      this.emit();
    } catch (error) { if (epoch === this.generation) await this.leave(); throw error; }
  }

  attach(track, publication, participant) {
    if (!track || !publication?.trackSid) return;
    const sid = publication.trackSid;
    this.detach(sid);
    const local = participant === this.room?.localParticipant;
    if (track.kind === 'audio') {
      if (local) return;
      const element = document.createElement('audio');
      element.autoplay = true; element.dataset.trackSid = sid;
      track.attach(element); this.audioRoot.append(element);
      this.audioTracks.set(sid, {element,track,identity:participant.identity});
      element.play().catch(() => this.onIssue('Tap Enable sound to hear the room.'));
    } else if (track.kind === 'video') {
      const element = document.createElement('video');
      element.autoplay = true; element.playsInline = true; element.muted = true;
      element.dataset.trackSid = sid;
      track.attach(element);
      const item = {element,track,identity:participant.identity,source:publication.source,lastTime:-1,lastFrame:performance.now()};
      this.videos.set(sid,item);
      if (publication.source === SOURCE.screen) {
        this.presentation.replaceChildren(element); this.presentation.hidden = false;
        element.style.objectFit = 'contain';
      } else this.onVideo(participant.identity,element,'Starting video');
      element.play().catch(() => this.onIssue('Video playback needs another tap. Use Enable sound to resume playback.'));
      item.health = setInterval(() => {
        if (element.currentTime !== item.lastTime && element.videoWidth > 0) { item.lastFrame = performance.now(); item.lastTime = element.currentTime; }
        const label = performance.now()-item.lastFrame > 5000 ? 'Video stalled' : element.videoWidth ? 'Video' : 'Starting video';
        this.onVideo(participant.identity,element,label);
      },1500);
    }
    this.emit();
  }

  detach(sid) {
    const item = this.audioTracks.get(sid) || this.videos.get(sid);
    if (!item) return;
    clearInterval(item.health);
    item.track.detach(item.element); item.element.pause(); item.element.srcObject = null; item.element.remove();
    if (item.source === SOURCE.screen && !this.presentation.querySelector('video')) this.presentation.hidden = true;
    this.audioTracks.delete(sid); this.videos.delete(sid);
    if (item.source === SOURCE.camera) this.onVideo(item.identity,null,'Camera off');
  }

  async microphone(enabled, deviceId) {
    if (enabled && !this.allowed(SOURCE.microphone)) throw new Error('You do not have the microphone floor. Request help or wait for your speaking stage.');
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(enabled, deviceId ? {deviceId:{exact:deviceId}} : undefined);
    this.emit();
  }

  backgroundController() {
    if (!this.background) {
      const factory = globalThis.DueDiligenceStudyRoomMandatoryBackground?.createController;
      if (!factory) throw new Error('Background effects could not load. The camera remains off.');
      this.background = factory({getLocalParticipant:()=>this.room?.localParticipant,
        onStateChange:(state)=> { if (state.error) this.onIssue(`${state.error} Your camera stays off; select None explicitly to use your raw camera.`); this.emit(); }});
    }
    return this.background;
  }

  async camera(enabled,deviceId) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.room) throw new Error('Enter the room before enabling your camera.');
      if (!enabled) {
        await this.background?.disableCamera();
        await this.room.localParticipant.setCameraEnabled(false); this.emit(); return;
      }
      if (!this.allowed(SOURCE.camera)) throw new Error('Camera publishing is restricted for this event.');
      if (this.effect === 'none' && !this.background) {
        await this.room.localParticipant.setCameraEnabled(true,deviceId ? {deviceId:{exact:deviceId}} : undefined);
      } else {
        const controller = this.backgroundController();
        if (!controller.capabilities().supported) throw new Error('This browser cannot apply backgrounds. Select None explicitly to use the camera without an effect.');
        await controller.enableCamera(deviceId ? {deviceId:{exact:deviceId}} : {});
      }
      this.emit();
    } finally { this.busy = false; }
  }

  async setEffect(effect,file) {
    if (!['none','blur','brand','custom'].includes(effect)) throw new Error('Choose a supported background.');
    const wasOn = this.room?.localParticipant.isCameraEnabled;
    if (effect === 'none') {
      // Explicit None is the user's consent to raw-camera use after a failure.
      if (this.background) { await this.background.destroy(); this.background = null; }
      this.effect = 'none';
      if (wasOn) await this.camera(true);
      return;
    }
    if (!this.room) throw new Error('Enter the room before choosing a background.');
    if (!this.background && wasOn) await this.room.localParticipant.setCameraEnabled(false);
    const controller = this.backgroundController();
    if (!controller.capabilities().supported) throw new Error('Background effects are unavailable in this browser. Select None to use the camera without an effect.');
    let request = effect === 'blur' ? {mode:'background-blur',blurRadius:10}
      : {mode:'virtual-background',imagePath:'/assets/study-room/virtual-background-due-diligence-polished-20260908.webp'};
    if (effect === 'custom') { const registered = await controller.registerCustomBackground(file); request.imagePath = registered.imagePath; }
    this.effect = effect;
    await controller.switchBackground(request);
    if (wasOn) await this.camera(true);
  }

  async share(enabled) {
    if (enabled && !this.allowed(SOURCE.screen)) throw new Error('Screen sharing needs the moderator’s presenter permission.');
    if (enabled && !navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot share its screen. Present a source link or document through Shared evidence.');
    if (!this.room) return;
    await this.room.localParticipant.setScreenShareEnabled(enabled,{audio:this.sources.includes(SOURCE.shareAudio),resolution:{width:1920,height:1080,frameRate:10}});
    this.emit();
  }
  async enableSound() {
    await this.room?.startAudio();
    await Promise.allSettled([...this.audioTracks.values(),...this.videos.values()].map(x=>x.element.play()));
  }
  async devices() { return navigator.mediaDevices?.enumerateDevices() || []; }
  async leave() {
    ++this.generation;
    const room = this.room;
    this.room = null;
    await this.background?.destroy().catch(()=>{}); this.background = null;
    for (const sid of [...this.audioTracks.keys(),...this.videos.keys()]) this.detach(sid);
    try { await room?.disconnect(); } finally { this.sources = []; this.emit(); }
  }
}
