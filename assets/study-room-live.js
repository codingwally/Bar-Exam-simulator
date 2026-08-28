(function dueDiligenceStudyRoom(global) {
  'use strict';

  const document = global.document;
  if (!document) return;

  const config = global.DueDiligencePhase2Config;
  const LiveKit = global.LivekitClient;
  const LOCAL_TEST_HOSTS = new Set(['127.0.0.1', 'localhost']);
  const LOCAL_TEST_MODE = LOCAL_TEST_HOSTS.has(global.location.hostname)
    ? new URLSearchParams(global.location.search).get('study-room-qa')
    : '';
  const STORAGE_KEY = 'duediligence.study-room.nickname.v2';
  const FALLBACK_NICKNAME = 'Participant 1';
  const MAX_NICKNAME_LENGTH = 32;
  const DISALLOWED_NICKNAME = /[\p{Cc}\p{Cf}<>]/u;
  const RESERVED_NICKNAME = /\b(?:admin|administrator|founder|moderator|staff|support)\b|\bdue\s+diligence\b/iu;

  const state = {
    client: null,
    session: null,
    access: null,
    room: null,
    previewStream: null,
    audioContext: null,
    analyser: null,
    meterFrame: 0,
    attachedTracks: [],
    blockedParticipants: new Set(),
    localMutedParticipants: new Set(),
    participantVolumes: new Map(),
    activeSpeakers: new Set(),
    joinWithMicrophone: false,
    joinWithCamera: false,
    joining: false,
    leaving: false,
    focusStartedAt: null,
    focusTimer: 0,
    clockTimer: 0,
    toastTimer: 0,
  };

  const byId = (id) => document.getElementById(id);

  function randomId(length = 18) {
    const bytes = global.crypto?.getRandomValues?.(new Uint8Array(length)) || new Uint8Array(length);
    return Array.from(bytes, (value) => value.toString(36).padStart(2, '0')).join('').slice(0, length);
  }

  function safeStorageRead() {
    try {
      return global.localStorage?.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function safeStorageWrite(value) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, value);
    } catch {
      // The nickname still works for this room when storage is unavailable.
    }
  }

  function defaultNickname() {
    const saved = safeStorageRead();
    if (saved) return saved;
    const bytes = global.crypto?.getRandomValues?.(new Uint8Array(2));
    const value = bytes ? ((bytes[0] << 8) | bytes[1]) : 0;
    const nickname = `Participant ${(value % 900) + 100}`;
    safeStorageWrite(nickname);
    return nickname;
  }

  function graphemeLength(value) {
    if (typeof Intl?.Segmenter === 'function') {
      return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
    }
    return [...value].length;
  }

  function normalizeNickname(value) {
    const normalized = String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (DISALLOWED_NICKNAME.test(normalized)) {
      throw new Error('Use a simple nickname without hidden formatting or markup.');
    }
    const length = graphemeLength(normalized);
    if (length < 2 || length > MAX_NICKNAME_LENGTH) {
      throw new Error('Your nickname must contain 2 to 32 characters.');
    }
    if (RESERVED_NICKNAME.test(normalized)) {
      throw new Error('That nickname is reserved for official Due Diligence notices.');
    }
    return normalized;
  }

  function displayName(participant) {
    const raw = String(participant?.name || '').trim();
    return raw || (participant?.isLocal ? FALLBACK_NICKNAME : 'Study partner');
  }

  function initials(value) {
    const words = String(value || '').trim().split(/\s+/u).filter(Boolean);
    return words.slice(0, 2).map((word) => [...word][0] || '').join('').toLocaleUpperCase('en-PH') || 'S';
  }

  function setStatus(id, message, tone = '') {
    const node = byId(id);
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', tone === 'error');
    node.classList.toggle('is-ok', tone === 'ok');
  }

  function toast(message) {
    const node = byId('sr-toast');
    if (!node) return;
    global.clearTimeout(state.toastTimer);
    node.textContent = message;
    node.hidden = false;
    state.toastTimer = global.setTimeout(() => {
      node.hidden = true;
    }, 5000);
  }

  function friendlyError(error, fallback) {
    const message = String(error?.message || '').trim();
    if (message && !/failed to fetch|networkerror|load failed/iu.test(message)) return message;
    return fallback;
  }

  async function workerRequest(path, body = {}) {
    const token = String(state.session?.access_token || '');
    if (!token) {
      const error = new Error('Sign in before opening the Study Room.');
      error.status = 401;
      throw error;
    }
    let response;
    try {
      response = await global.fetch(`${config.workerUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Request-ID': randomId(),
          ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new Error('The Study Room could not reach the secure service. Check your connection and try again.');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(
        payload?.error?.message
        || (response.status === 403
          ? 'The live Study Room is currently limited to authorized administrators.'
          : 'The Study Room is temporarily unavailable.'),
      );
      error.status = response.status;
      error.code = payload?.error?.code || '';
      error.recovery = payload?.error?.recovery || '';
      throw error;
    }
    return payload;
  }

  function showAccessError(error) {
    const title = byId('sr-access-title');
    const copy = byId('sr-access-copy');
    const retry = byId('sr-access-retry');
    const forbidden = Number(error?.status) === 401 || Number(error?.status) === 403;
    title.textContent = forbidden ? 'The live room is still private' : 'The Study Room needs a moment';
    copy.textContent = friendlyError(
      error,
      forbidden
        ? 'The preview remains available on the Due Diligence home page.'
        : 'Your camera and microphone stayed off. Check your connection and try again.',
    );
    if (error?.recovery && error.recovery !== copy.textContent) {
      copy.textContent += ` ${error.recovery}`;
    }
    byId('sr-access-loading').hidden = true;
    byId('sr-access-actions').hidden = false;
    retry.hidden = forbidden;
  }

  function showExperience() {
    byId('sr-access-state').hidden = true;
    byId('sr-experience').hidden = false;
    byId('sr-prejoin').hidden = false;
    byId('sr-live-room').hidden = true;
  }

  function initializeDateClock() {
    const update = () => {
      const now = new Date();
      byId('sr-date').textContent = new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(now);
      byId('sr-time').textContent = `${new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
      }).format(now)} PHT`;
      byId('sr-time').dateTime = now.toISOString();
    };
    update();
    state.clockTimer = global.setInterval(update, 30_000);
  }

  function currentNickname() {
    return normalizeNickname(byId('sr-nickname')?.value || defaultNickname());
  }

  function syncNicknamePreview() {
    const raw = String(byId('sr-nickname')?.value || '').trim() || defaultNickname();
    byId('sr-preview-name').textContent = raw;
    byId('sr-preview-avatar').textContent = initials(raw);
  }

  function setJoinOption(kind, enabled) {
    const isMicrophone = kind === 'microphone';
    if (isMicrophone) state.joinWithMicrophone = enabled;
    else state.joinWithCamera = enabled;
    const button = byId(isMicrophone ? 'sr-join-microphone' : 'sr-join-camera');
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('small').textContent = `${enabled ? 'On' : 'Off'} when you join`;
  }

  function stopMeter() {
    if (state.meterFrame) global.cancelAnimationFrame(state.meterFrame);
    state.meterFrame = 0;
    state.analyser = null;
    if (state.audioContext) state.audioContext.close().catch(() => {});
    state.audioContext = null;
    byId('sr-microphone-meter')?.querySelectorAll('span').forEach((bar) => bar.classList.remove('is-active'));
  }

  function startMeter(stream) {
    stopMeter();
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !global.AudioContext) return;
    state.audioContext = new global.AudioContext();
    const source = state.audioContext.createMediaStreamSource(new global.MediaStream([audioTrack]));
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);
    const samples = new Uint8Array(state.analyser.frequencyBinCount);
    const bars = [...byId('sr-microphone-meter').querySelectorAll('span')];
    const draw = () => {
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(samples);
      const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
      const active = Math.min(bars.length, Math.round((average / 110) * bars.length));
      bars.forEach((bar, index) => bar.classList.toggle('is-active', index < active));
      state.meterFrame = global.requestAnimationFrame(draw);
    };
    draw();
  }

  function stopDeviceTest() {
    stopMeter();
    state.previewStream?.getTracks?.().forEach((track) => track.stop());
    state.previewStream = null;
    const video = byId('sr-local-preview');
    if (video) {
      video.pause();
      video.srcObject = null;
      video.hidden = true;
    }
    byId('sr-camera-placeholder').hidden = false;
    const button = byId('sr-test-devices');
    const label = button?.querySelector('span');
    if (label) label.textContent = 'Test camera & microphone';
  }

  function selectedConstraint(id) {
    const value = byId(id)?.value || '';
    return value ? { deviceId: { exact: value } } : true;
  }

  function fillSelect(select, devices, fallback) {
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    if (!devices.length) {
      const option = new Option(fallback, '');
      select.append(option);
      select.disabled = true;
      return;
    }
    devices.forEach((device, index) => {
      const label = device.label || `${fallback} ${index + 1}`;
      select.append(new Option(label, device.deviceId));
    });
    select.disabled = false;
    if (devices.some((device) => device.deviceId === previous)) select.value = previous;
  }

  async function refreshDeviceLists() {
    if (!global.navigator.mediaDevices?.enumerateDevices) return;
    const devices = await global.navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const microphones = devices.filter((device) => device.kind === 'audioinput');
    const speakers = devices.filter((device) => device.kind === 'audiooutput');
    for (const prefix of ['sr-', 'sr-live-']) {
      fillSelect(byId(`${prefix}camera-select`), cameras, 'Camera');
      fillSelect(byId(`${prefix}microphone-select`), microphones, 'Microphone');
      fillSelect(byId(`${prefix}speaker-select`), speakers, 'Speaker');
    }
  }

  async function testDevices() {
    if (state.previewStream) {
      stopDeviceTest();
      setStatus('sr-prejoin-status', 'Camera and microphone are off.');
      return;
    }
    if (!global.navigator.mediaDevices?.getUserMedia) {
      setStatus('sr-prejoin-status', 'This browser cannot access camera or microphone devices.', 'error');
      return;
    }
    const button = byId('sr-test-devices');
    button.disabled = true;
    setStatus('sr-prejoin-status', 'Waiting for camera and microphone permission…');
    try {
      state.previewStream = await global.navigator.mediaDevices.getUserMedia({
        video: selectedConstraint('sr-camera-select'),
        audio: selectedConstraint('sr-microphone-select'),
      });
      const video = byId('sr-local-preview');
      video.srcObject = state.previewStream;
      video.hidden = state.previewStream.getVideoTracks().length === 0;
      byId('sr-camera-placeholder').hidden = !video.hidden;
      await video.play().catch(() => {});
      startMeter(state.previewStream);
      await refreshDeviceLists();
      const label = button.querySelector('span');
      if (label) label.textContent = 'Stop device test';
      setStatus('sr-prejoin-status', 'Device test is active only on this computer. Nothing has been shared.', 'ok');
    } catch (error) {
      stopDeviceTest();
      const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(error?.name);
      setStatus(
        'sr-prejoin-status',
        denied
          ? 'Camera or microphone permission was not granted. You can still join with both off.'
          : 'The selected camera or microphone could not start. Choose another device or join with both off.',
        'error',
      );
    } finally {
      button.disabled = false;
    }
  }

  function publicationFor(participant, source) {
    if (!participant) return null;
    if (typeof participant.getTrackPublication === 'function') {
      const publication = participant.getTrackPublication(source);
      if (publication) return publication;
    }
    const publications = participant.trackPublications?.values?.()
      ? [...participant.trackPublications.values()]
      : [];
    return publications.find((publication) => publication?.source === source) || null;
  }

  function detachTracks() {
    state.attachedTracks.forEach(({ track, element }) => {
      try {
        track.detach(element);
      } catch {
        element.remove();
      }
    });
    state.attachedTracks = [];
    byId('sr-audio-bin')?.replaceChildren();
  }

  function attachTrack(track, container, kind, isLocal = false) {
    if (!track || !container) return null;
    const element = track.attach();
    element.autoplay = true;
    if (kind === 'video') {
      element.playsInline = true;
      element.muted = isLocal;
    }
    container.append(element);
    state.attachedTracks.push({ track, element });
    return element;
  }

  function participantCollection() {
    if (!state.room) return [];
    const local = state.room.localParticipant;
    const remote = state.room.remoteParticipants?.values?.()
      ? [...state.room.remoteParticipants.values()]
      : [];
    return [local, ...remote].filter(Boolean);
  }

  function createTile(participant) {
    const tile = document.createElement('article');
    tile.className = `sr-participant-tile${participant.isLocal ? ' is-self' : ''}`;
    tile.dataset.participantIdentity = participant.identity || '';
    tile.classList.toggle('is-speaking', state.activeSpeakers.has(participant.identity));

    const videoPublication = publicationFor(participant, LiveKit?.Track?.Source?.Camera || 'camera');
    const videoTrack = videoPublication?.track;
    const cameraVisible = Boolean(videoTrack && !videoPublication?.isMuted);
    if (cameraVisible) {
      attachTrack(videoTrack, tile, 'video', participant.isLocal);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'sr-tile-placeholder';
      const avatar = document.createElement('span');
      avatar.className = 'sr-avatar';
      avatar.textContent = initials(displayName(participant));
      const copy = document.createElement('span');
      copy.textContent = 'Camera off';
      placeholder.append(avatar, copy);
      tile.append(placeholder);
    }

    const audioPublication = publicationFor(participant, LiveKit?.Track?.Source?.Microphone || 'microphone');
    const meta = document.createElement('div');
    meta.className = 'sr-tile-meta';
    const name = document.createElement('span');
    name.className = 'sr-tile-name';
    name.textContent = participant.isLocal ? `You · ${displayName(participant)}` : displayName(participant);
    const mediaState = document.createElement('span');
    mediaState.className = 'sr-tile-media-state';
    mediaState.textContent = audioPublication && !audioPublication.isMuted ? 'Mic on' : 'Muted';
    meta.append(name, mediaState);
    tile.append(meta);
    return tile;
  }

  function setParticipantVolume(participant, value) {
    const volume = Math.max(0, Math.min(100, Number(value) || 0));
    state.participantVolumes.set(participant.identity, volume);
    participant.setVolume?.(volume / 100);
  }

  async function setParticipantBlocked(participant, blocked) {
    const publications = participant.trackPublications?.values?.()
      ? [...participant.trackPublications.values()]
      : [];
    await Promise.all(publications.map(async (publication) => {
      if (typeof publication.setSubscribed === 'function') {
        await publication.setSubscribed(!blocked);
      }
    }));
    if (blocked) state.blockedParticipants.add(participant.identity);
    else state.blockedParticipants.delete(participant.identity);
    renderParticipants();
    toast(blocked
      ? `${displayName(participant)} is blocked only for you.`
      : `${displayName(participant)} is visible and audible again.`);
  }

  async function muteParticipantForRoom(participant, button) {
    const publication = publicationFor(participant, LiveKit?.Track?.Source?.Microphone || 'microphone');
    if (!publication?.trackSid || publication.isMuted) return;
    button.disabled = true;
    try {
      await workerRequest('/admin/study-room/moderate', {
        operation: 'mute',
        participantIdentity: participant.identity,
        trackSid: publication.trackSid,
      });
      toast(`${displayName(participant)} was muted for the room. Only they can unmute again.`);
    } catch (error) {
      toast(friendlyError(error, 'That participant could not be muted just now.'));
    } finally {
      button.disabled = false;
    }
  }

  function createPersonRow(participant) {
    const row = document.createElement('div');
    row.className = 'sr-person-row';
    const name = document.createElement('div');
    name.className = 'sr-person-name';
    const presence = document.createElement('i');
    const label = document.createElement('span');
    label.textContent = participant.isLocal ? `${displayName(participant)} (You)` : displayName(participant);
    name.append(presence, label);
    row.append(name);

    if (!participant.isLocal) {
      const actions = document.createElement('div');
      actions.className = 'sr-person-actions';
      const localMute = document.createElement('button');
      const locallyMuted = state.localMutedParticipants.has(participant.identity);
      localMute.type = 'button';
      localMute.textContent = locallyMuted ? 'Hear again' : 'Mute for me';
      localMute.addEventListener('click', () => {
        if (locallyMuted) {
          state.localMutedParticipants.delete(participant.identity);
          setParticipantVolume(participant, state.participantVolumes.get(participant.identity) ?? 75);
        } else {
          state.localMutedParticipants.add(participant.identity);
          participant.setVolume?.(0);
        }
        renderPeople();
      });

      const audioPublication = publicationFor(participant, LiveKit?.Track?.Source?.Microphone || 'microphone');
      const roomMute = document.createElement('button');
      roomMute.type = 'button';
      roomMute.textContent = 'Mute for room';
      roomMute.disabled = !audioPublication?.trackSid || audioPublication?.isMuted;
      roomMute.addEventListener('click', () => muteParticipantForRoom(participant, roomMute));

      const block = document.createElement('button');
      const blocked = state.blockedParticipants.has(participant.identity);
      block.type = 'button';
      block.textContent = blocked ? 'Unblock' : 'Block locally';
      block.addEventListener('click', () => setParticipantBlocked(participant, !blocked).catch(() => {
        toast('This participant could not be blocked just now.');
      }));
      actions.append(localMute, roomMute, block);
      row.append(actions);

      const volume = document.createElement('label');
      volume.className = 'sr-person-volume';
      const volumeLabel = document.createElement('span');
      volumeLabel.textContent = 'Volume';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(state.participantVolumes.get(participant.identity) ?? 75);
      slider.disabled = blocked || locallyMuted;
      const volumeValue = document.createElement('span');
      volumeValue.textContent = `${slider.value}%`;
      slider.addEventListener('input', () => {
        volumeValue.textContent = `${slider.value}%`;
        setParticipantVolume(participant, slider.value);
      });
      volume.append(volumeLabel, slider, volumeValue);
      row.append(volume);
    }
    return row;
  }

  function attachRemoteAudio(participants) {
    const audioBin = byId('sr-audio-bin');
    participants.filter((participant) => !participant.isLocal).forEach((participant) => {
      if (state.blockedParticipants.has(participant.identity)) return;
      const publication = publicationFor(participant, LiveKit?.Track?.Source?.Microphone || 'microphone');
      if (publication?.track && !publication.isMuted) {
        attachTrack(publication.track, audioBin, 'audio', false);
        if (!state.participantVolumes.has(participant.identity)) setParticipantVolume(participant, 75);
      }
    });
  }

  function renderPeople(participants = participantCollection()) {
    const list = byId('sr-people-list');
    if (!list) return;
    list.replaceChildren(...participants.map(createPersonRow));
    byId('sr-people-count').textContent = String(participants.length);
  }

  function renderParticipants() {
    if (!state.room) return;
    detachTracks();
    const participants = participantCollection();
    const visibleParticipants = participants.filter((participant) => (
      participant.isLocal || !state.blockedParticipants.has(participant.identity)
    ));
    const grid = byId('sr-participant-grid');
    grid.dataset.count = String(visibleParticipants.length);
    grid.replaceChildren(...visibleParticipants.map(createTile));
    attachRemoteAudio(participants);
    renderPeople(participants);
    const countCopy = `${participants.length} ${participants.length === 1 ? 'studying' : 'studying'}`;
    byId('sr-room-count').textContent = countCopy;
    syncSelfMediaState();
  }

  function syncActiveSpeakerTiles() {
    byId('sr-participant-grid')?.querySelectorAll('[data-participant-identity]').forEach((tile) => {
      tile.classList.toggle('is-speaking', state.activeSpeakers.has(tile.dataset.participantIdentity));
    });
  }

  function recoverFromTerminalDisconnect(room) {
    if (state.leaving || state.room !== room) return;
    global.clearInterval(state.focusTimer);
    state.focusTimer = 0;
    detachTracks();
    state.room = null;
    state.focusStartedAt = null;
    state.blockedParticipants.clear();
    state.localMutedParticipants.clear();
    state.participantVolumes.clear();
    state.activeSpeakers.clear();
    state.joining = false;
    const joinButton = byId('sr-join');
    joinButton.disabled = false;
    joinButton.textContent = 'Rejoin Study Room';
    byId('sr-live-room').hidden = true;
    byId('sr-prejoin').hidden = false;
    setStatus(
      'sr-prejoin-status',
      'The room connection ended. Your camera and microphone are off. You can rejoin when ready.',
      'error',
    );
    toast('The Study Room connection ended. Your camera and microphone are off.');
  }

  function connectionLabel(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('disconnected')) return 'Offline';
    if (normalized.includes('reconnecting')) return 'Reconnecting';
    if (normalized.includes('connecting')) return 'Connecting';
    if (normalized.includes('connected')) return 'Excellent';
    return 'Checking';
  }

  function syncConnectionState(value = state.room?.connectionState) {
    byId('sr-connection-state').textContent = connectionLabel(value);
  }

  function syncSelfMediaState() {
    const local = state.room?.localParticipant;
    if (!local) return;
    const mic = publicationFor(local, LiveKit?.Track?.Source?.Microphone || 'microphone');
    const camera = publicationFor(local, LiveKit?.Track?.Source?.Camera || 'camera');
    const micOn = Boolean(mic && !mic.isMuted);
    const cameraOn = Boolean(camera && !camera.isMuted);
    byId('sr-microphone-state').textContent = micOn ? 'On' : 'Off';
    byId('sr-camera-state').textContent = cameraOn ? 'On' : 'Off';
    const micButton = byId('sr-toggle-microphone');
    const cameraButton = byId('sr-toggle-camera');
    micButton.setAttribute('aria-pressed', String(micOn));
    cameraButton.setAttribute('aria-pressed', String(cameraOn));
    micButton.querySelector('span').textContent = micOn ? 'Mute' : 'Turn mic on';
    cameraButton.querySelector('span').textContent = cameraOn ? 'Turn camera off' : 'Turn camera on';
  }

  function updateAudioPrompt() {
    const prompt = byId('sr-audio-prompt');
    prompt.hidden = !state.room || state.room.canPlaybackAudio !== false;
  }

  function bindRoomEvents(room) {
    const event = LiveKit.RoomEvent;
    const rerenderEvents = [
      event.ParticipantConnected,
      event.ParticipantDisconnected,
      event.TrackSubscribed,
      event.TrackUnsubscribed,
      event.TrackMuted,
      event.TrackUnmuted,
      event.LocalTrackPublished,
      event.LocalTrackUnpublished,
      event.ParticipantNameChanged,
    ].filter(Boolean);
    rerenderEvents.forEach((eventName) => room.on(eventName, renderParticipants));
    room.on(event.ActiveSpeakersChanged, (speakers) => {
      state.activeSpeakers = new Set((speakers || []).map((participant) => participant.identity));
      // Keep attached audio/video elements stable while only the speaking halo changes.
      syncActiveSpeakerTiles();
    });
    room.on(event.ConnectionStateChanged, (connectionState) => {
      syncConnectionState(connectionState);
    });
    room.on(event.AudioPlaybackStatusChanged, updateAudioPrompt);
    room.on(event.Disconnected, () => {
      recoverFromTerminalDisconnect(room);
    });
  }

  function startFocusClock() {
    global.clearInterval(state.focusTimer);
    const render = () => {
      const startedAt = Number(state.focusStartedAt) || Date.now();
      const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      byId('sr-focus-clock').textContent = [hours, minutes, seconds]
        .map((value) => String(value).padStart(2, '0'))
        .join(':');
    };
    render();
    state.focusTimer = global.setInterval(render, 1000);
  }

  function selectedDeviceOptions() {
    const cameraId = byId('sr-camera-select')?.value || '';
    const microphoneId = byId('sr-microphone-select')?.value || '';
    return {
      camera: cameraId ? { deviceId: cameraId } : undefined,
      microphone: microphoneId ? { deviceId: microphoneId } : undefined,
    };
  }

  async function enableInitialMedia() {
    const local = state.room.localParticipant;
    const devices = selectedDeviceOptions();
    const warnings = [];
    if (state.joinWithCamera) {
      try {
        await local.setCameraEnabled(true, devices.camera);
      } catch {
        warnings.push('camera');
      }
    }
    if (state.joinWithMicrophone) {
      try {
        await local.setMicrophoneEnabled(true, devices.microphone);
      } catch {
        warnings.push('microphone');
      }
    }
    if (warnings.length) toast(`The ${warnings.join(' and ')} could not start. You joined with it off.`);
  }

  async function joinRoom() {
    if (state.joining || state.room) return;
    let nickname;
    try {
      nickname = currentNickname();
    } catch (error) {
      setStatus('sr-prejoin-status', error.message, 'error');
      byId('sr-nickname').focus();
      return;
    }
    if (!LiveKit?.Room) {
      setStatus('sr-prejoin-status', 'The secure video library could not load. Check your connection and try again.', 'error');
      return;
    }
    state.joining = true;
    const button = byId('sr-join');
    button.disabled = true;
    button.textContent = 'Joining securely…';
    setStatus('sr-prejoin-status', 'Connecting with camera and microphone still off…');
    safeStorageWrite(nickname);
    stopDeviceTest();
    let room;
    try {
      const credential = await workerRequest('/admin/study-room/join', { nickname });
      room = new LiveKit.Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        stopLocalTrackOnUnpublish: true,
      });
      state.room = room;
      bindRoomEvents(room);
      await room.connect(credential.server_url, credential.participant_token, {
        autoSubscribe: true,
        maxRetries: 5,
      });
      state.focusStartedAt = Date.parse(credential.focus_started_at || '') || Date.now();
      byId('sr-live-nickname').value = credential.participant_name || nickname;
      await enableInitialMedia();
      byId('sr-prejoin').hidden = true;
      byId('sr-live-room').hidden = false;
      syncConnectionState(room.connectionState);
      renderParticipants();
      startFocusClock();
      await refreshDeviceLists();
      updateAudioPrompt();
      byId('sr-live-room').focus?.({ preventScroll: true });
    } catch (error) {
      if (room) await room.disconnect().catch(() => {});
      state.room = null;
      setStatus(
        'sr-prejoin-status',
        friendlyError(error, 'The Study Room could not connect. Your camera and microphone stayed off.'),
        'error',
      );
    } finally {
      state.joining = false;
      button.disabled = false;
      button.textContent = 'Join Study Room';
    }
  }

  async function toggleLocalTrack(kind) {
    const local = state.room?.localParticipant;
    if (!local) return;
    const button = byId(kind === 'microphone' ? 'sr-toggle-microphone' : 'sr-toggle-camera');
    button.disabled = true;
    try {
      const publication = publicationFor(
        local,
        kind === 'microphone'
          ? (LiveKit.Track?.Source?.Microphone || 'microphone')
          : (LiveKit.Track?.Source?.Camera || 'camera'),
      );
      const enabled = !(publication && !publication.isMuted);
      if (kind === 'microphone') {
        const id = byId('sr-live-microphone-select')?.value || '';
        await local.setMicrophoneEnabled(enabled, id ? { deviceId: id } : undefined);
      } else {
        const id = byId('sr-live-camera-select')?.value || '';
        await local.setCameraEnabled(enabled, id ? { deviceId: id } : undefined);
      }
      renderParticipants();
    } catch {
      toast(`The ${kind} could not change. Check browser permission and the selected device.`);
    } finally {
      button.disabled = false;
    }
  }

  async function updateNickname(event) {
    event.preventDefault();
    if (!state.room?.localParticipant) return;
    const input = byId('sr-live-nickname');
    let nickname;
    try {
      nickname = normalizeNickname(input.value);
    } catch (error) {
      toast(error.message);
      input.focus();
      return;
    }
    const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await workerRequest('/admin/study-room/moderate', {
        operation: 'rename',
        participantIdentity: state.room.localParticipant.identity,
        nickname,
      });
      input.value = payload.result?.participantName || nickname;
      safeStorageWrite(input.value);
      toast('Your Study Room nickname was updated.');
    } catch (error) {
      toast(friendlyError(error, 'Your nickname could not be updated just now.'));
    } finally {
      submit.disabled = false;
    }
  }

  async function switchDevice(kind, select) {
    const deviceId = select.value;
    if (!state.room || !deviceId) return;
    try {
      const switched = await state.room.switchActiveDevice(kind, deviceId, true);
      if (!switched) throw new Error('Device switch was not confirmed.');
      toast('Device updated.');
    } catch {
      toast('That device could not be selected. It may be in use or unavailable.');
    }
  }

  async function leaveRoom() {
    if (state.leaving) return;
    state.leaving = true;
    byId('sr-leave').disabled = true;
    global.clearInterval(state.focusTimer);
    detachTracks();
    try {
      await state.room?.disconnect?.();
    } catch {
      // The local tracks are still stopped by LiveKit during page shutdown.
    }
    state.room = null;
    stopDeviceTest();
    global.close();
    global.setTimeout(() => {
      if (!global.closed) global.location.replace('../#quorum');
    }, 150);
  }

  function createLocalQualityPreview() {
    const local = {
      identity: 'sr_localqualitypreview0000',
      name: defaultNickname(),
      isLocal: true,
      trackPublications: new Map(),
      setCameraEnabled: async () => {},
      setMicrophoneEnabled: async () => {},
    };
    state.room = {
      localParticipant: local,
      remoteParticipants: new Map(),
      connectionState: 'connected',
      canPlaybackAudio: true,
    };
    state.focusStartedAt = Date.now() - 48 * 60 * 1000 - 32 * 1000;
    byId('sr-live-nickname').value = local.name;
    byId('sr-prejoin').hidden = true;
    byId('sr-live-room').hidden = false;
    syncConnectionState(state.room.connectionState);
    renderParticipants();
    startFocusClock();
  }

  function bindControls() {
    byId('sr-access-retry').addEventListener('click', verifyAccess);
    byId('sr-nickname').addEventListener('input', syncNicknamePreview);
    byId('sr-test-devices').addEventListener('click', testDevices);
    byId('sr-join-microphone').addEventListener('click', () => {
      setJoinOption('microphone', !state.joinWithMicrophone);
    });
    byId('sr-join-camera').addEventListener('click', () => {
      setJoinOption('camera', !state.joinWithCamera);
    });
    byId('sr-join').addEventListener('click', joinRoom);
    byId('sr-toggle-microphone').addEventListener('click', () => toggleLocalTrack('microphone'));
    byId('sr-toggle-camera').addEventListener('click', () => toggleLocalTrack('camera'));
    byId('sr-open-devices').addEventListener('click', () => {
      const drawer = byId('sr-device-drawer');
      drawer.hidden = !drawer.hidden;
      byId('sr-open-devices').textContent = drawer.hidden ? 'Choose devices' : 'Hide device settings';
    });
    byId('sr-dock-devices').addEventListener('click', () => {
      byId('sr-device-drawer').hidden = false;
      byId('sr-open-devices').textContent = 'Hide device settings';
      byId('sr-device-drawer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    byId('sr-nickname-form').addEventListener('submit', updateNickname);
    byId('sr-live-camera-select').addEventListener('change', (event) => switchDevice('videoinput', event.target));
    byId('sr-live-microphone-select').addEventListener('change', (event) => switchDevice('audioinput', event.target));
    byId('sr-live-speaker-select').addEventListener('change', (event) => switchDevice('audiooutput', event.target));
    byId('sr-leave').addEventListener('click', leaveRoom);
    byId('sr-audio-prompt').addEventListener('click', async () => {
      try {
        await state.room?.startAudio?.();
        updateAudioPrompt();
      } catch {
        toast('Your browser still blocked room audio. Check the site sound permission.');
      }
    });
    global.addEventListener('pagehide', () => {
      stopDeviceTest();
      state.room?.disconnect?.();
    });
  }

  async function createAuthClient() {
    if (!config?.supabase?.url || !config?.supabase?.publishableKey || !global.supabase?.createClient) {
      throw new Error('Secure sign-in could not load. Return to Due Diligence and try again.');
    }
    const storage = global.DueDiligenceAuthSessionStorage?.prepare?.(config.supabase.url)
      || global.localStorage
      || global.sessionStorage;
    state.client = global.supabase.createClient(
      config.supabase.url,
      config.supabase.publishableKey,
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          storage,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );
    const { data, error } = await state.client.auth.getSession();
    if (error || !data?.session?.access_token) {
      const signInError = new Error('Sign in on Due Diligence before opening the live Study Room.');
      signInError.status = 401;
      throw signInError;
    }
    state.session = data.session;
    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session || null;
      if (!session && state.room) leaveRoom();
    });
  }

  async function verifyAccess() {
    byId('sr-access-title').textContent = 'Opening the Study Room';
    byId('sr-access-copy').textContent = 'Confirming your approved tester access. Your camera and microphone remain off.';
    byId('sr-access-loading').hidden = false;
    byId('sr-access-actions').hidden = true;
    try {
      if (LOCAL_TEST_MODE) {
        state.access = { allowed: true, role: 'admin', maxParticipants: 12 };
      } else {
        await createAuthClient();
        state.access = await workerRequest('/admin/study-room/access');
      }
      showExperience();
      await refreshDeviceLists();
      if (LOCAL_TEST_MODE === 'live') createLocalQualityPreview();
    } catch (error) {
      showAccessError(error);
    }
  }

  async function initialize() {
    bindControls();
    initializeDateClock();
    const nickname = defaultNickname();
    byId('sr-nickname').value = nickname;
    syncNicknamePreview();
    setJoinOption('microphone', false);
    setJoinOption('camera', false);
    await verifyAccess();
  }

  global.DueDiligenceStudyRoom = Object.freeze({
    normalizeNickname,
    verifyAccess,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
