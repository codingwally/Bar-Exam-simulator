(function dueDiligenceStudyRoom(global) {
  'use strict';

  const document = global.document;
  if (!document) return;
  try {
    global.opener = null;
  } catch {
    // Some embedded browsers expose a read-only opener; server-side access still protects the room.
  }

  const config = global.DueDiligencePhase2Config;
  const LiveKit = global.LivekitClient;
  const LOCAL_TEST_HOSTS = new Set(['127.0.0.1', 'localhost']);
  const LOCAL_TEST_MODE = LOCAL_TEST_HOSTS.has(global.location.hostname)
    ? new URLSearchParams(global.location.search).get('study-room-qa')
    : '';
  const STORAGE_KEY = 'duediligence.study-room.nickname.v2';
  const FALLBACK_NICKNAME = 'Participant 1';
  const MAX_NICKNAME_LENGTH = 32;
  const MAX_ROOMS = 4;
  const ROOM_REFRESH_INTERVAL_MS = 15_000;
  const MEDIA_RELIABILITY_VERSION = 'study-room-media-hotfix-20260829-1';
  const MICROPHONE_STATS_INTERVAL_MS = 400;
  const MICROPHONE_STATS_ATTEMPTS = 10;
  const STUDY_VIDEO_CAPTURE = Object.freeze({
    width: 640,
    height: 360,
    frameRate: 15,
  });
  const STUDY_VIDEO_ENCODING = Object.freeze({
    maxBitrate: 450_000,
    maxFramerate: 15,
  });
  const MANDATORY_BACKGROUND_POLICY = 'due-diligence-mandatory-virtual-background-no-raw-first-frame';
  const DISALLOWED_NICKNAME = /[\p{Cc}\p{Cf}<>]/u;
  const RESERVED_NICKNAME = /\b(?:admin|administrator|founder|moderator|staff|support)\b|\bdue\s+diligence\b/iu;
  const ROOM_PRESENTATION = Object.freeze({
    '1': Object.freeze({
      name: 'Library Study Room',
      cover: '../assets/study-room/dimasalang-library.webp',
    }),
    '2': Object.freeze({
      name: 'Tropical Study Room',
      cover: '../assets/study-room/participant-2-tropical.webp',
    }),
    '3': Object.freeze({
      name: 'Quiet Study Room',
      cover: '../assets/study-room/participant-3-bedroom.webp',
    }),
    '4': Object.freeze({
      name: 'Condo Study Room',
      cover: '../assets/study-room/participant-4-condo.webp',
    }),
  });

  const state = {
    client: null,
    session: null,
    access: null,
    rooms: [],
    selectedRoomKey: '',
    currentRoomKey: '',
    roomCatalogBusy: false,
    roomCatalogPromise: null,
    roomMutationBusy: false,
    roomRefreshTimer: 0,
    room: null,
    switchingRoom: false,
    backgroundController: null,
    backgroundCleanup: Promise.resolve(),
    cameraOperationBusy: false,
    cameraGuard: Promise.resolve(),
    cameraPublishGuard: null,
    controllerProtectedCameraTracks: new Set(),
    recovering: false,
    previewStream: null,
    audioContext: null,
    analyser: null,
    meterFrame: 0,
    audioPlaybackBlocked: false,
    microphoneTransport: 'off',
    attachedTracks: [],
    blockedParticipants: new Set(),
    localMutedParticipants: new Set(),
    participantVolumes: new Map(),
    activeSpeakers: new Set(),
    joinWithMicrophone: false,
    joinWithCamera: false,
    selectedDevices: {
      videoinput: '',
      audioinput: '',
      audiooutput: '',
    },
    joining: false,
    leaving: false,
    focusStartedAt: null,
    focusTimer: 0,
    clockTimer: 0,
    toastTimer: 0,
    deviceChangeBound: false,
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

  function isPermissionError(error) {
    return ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name);
  }

  function isRetryableDeviceError(error) {
    return [
      'NotFoundError',
      'DevicesNotFoundError',
      'NotReadableError',
      'TrackStartError',
      'OverconstrainedError',
      'ConstraintNotSatisfiedError',
      'AbortError',
    ].includes(error?.name);
  }

  function deviceErrorMessage(kind, error) {
    const label = kind === 'microphone' ? 'microphone' : 'camera';
    if (kind === 'camera' && /^STUDY_ROOM_BACKGROUND_/u.test(String(error?.code || ''))) {
      return String(error?.message || 'The required Due Diligence backdrop could not start, so video remains off.');
    }
    if (kind === 'microphone' && error?.code === 'MICROPHONE_TRANSPORT_STALLED') {
      return 'Microphone permission is on, but the browser is not sending audio. The Study Room retried the system-default microphone; choose another microphone if this continues.';
    }
    if (error?.code === 'MEDIA_TRACK_NOT_LIVE') {
      return `The ${label} did not produce a live signal. Choose another device and try again.`;
    }
    if (isPermissionError(error)) {
      return `${label === 'microphone' ? 'Microphone' : 'Camera'} access is blocked. Allow it for duediligence.ph in your browser site permissions, then try again.`;
    }
    if (error?.name === 'PermissionTimeoutError') {
      return `The browser is still waiting for ${label} permission. Choose Allow in the browser prompt, then try again.`;
    }
    if (['NotReadableError', 'TrackStartError'].includes(error?.name)) {
      return `The selected ${label} is busy in another app. Close the other app or choose a different device.`;
    }
    if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) {
      return `No available ${label} was found. Connect one and try again.`;
    }
    if (['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) {
      return `The selected ${label} is no longer available. The device list was refreshed; try the system default.`;
    }
    return `The ${label} could not start. Check browser permission and choose another device.`;
  }

  async function requestUserMediaWithTimeout(mediaDevices, constraints, timeoutMs = 12000) {
    let timedOut = false;
    let timer = 0;
    const mediaPromise = Promise.resolve().then(() => mediaDevices.getUserMedia(constraints));
    mediaPromise.then((stream) => {
      if (timedOut) stream?.getTracks?.().forEach((track) => track.stop());
    }).catch(() => {});
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = global.setTimeout(() => {
        timedOut = true;
        const error = new Error('The browser is still waiting for device permission.');
        error.name = 'PermissionTimeoutError';
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([mediaPromise, timeoutPromise]);
    } finally {
      global.clearTimeout(timer);
    }
  }

  function waitForMediaSample(delayMs = MICROPHONE_STATS_INTERVAL_MS) {
    return new Promise((resolve) => global.setTimeout(resolve, delayMs));
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

  function roomPresentation(roomKey) {
    return ROOM_PRESENTATION[String(roomKey)] || Object.freeze({
      name: `Study Room ${String(roomKey || '')}`.trim(),
      cover: '../assets/study-room/virtual-background-due-diligence-branded.webp',
    });
  }

  function normalizeRoomCatalog(payload) {
    const listed = Array.isArray(payload?.rooms) ? payload.rooms : [];
    const byRoomKey = new Map();
    listed.forEach((candidate) => {
      const roomKey = String(candidate?.roomKey || '').trim();
      if (!/^[1-4]$/u.test(roomKey) || byRoomKey.has(roomKey)) return;
      const participantCount = Number(candidate?.participantCount);
      const capacity = Number(candidate?.capacity);
      byRoomKey.set(roomKey, Object.freeze({
        roomKey,
        active: candidate?.active === true,
        participantCount: Number.isSafeInteger(participantCount) && participantCount >= 0
          ? Math.min(participantCount, 12)
          : 0,
        capacity: Number.isSafeInteger(capacity) && capacity > 0 ? Math.min(capacity, 12) : 12,
        focusStartedAt: Number.isFinite(Date.parse(String(candidate?.focusStartedAt || '')))
          ? String(candidate.focusStartedAt)
          : null,
      }));
    });
    return Array.from({ length: MAX_ROOMS }, (_unused, index) => {
      const roomKey = String(index + 1);
      return byRoomKey.get(roomKey) || Object.freeze({
        roomKey,
        active: false,
        participantCount: 0,
        capacity: 12,
        focusStartedAt: null,
      });
    });
  }

  function selectedRoom() {
    return state.rooms.find((room) => room.roomKey === state.selectedRoomKey) || null;
  }

  function activeRoom(roomKey) {
    return state.rooms.find((room) => room.roomKey === String(roomKey) && room.active) || null;
  }

  function syncJoinButton() {
    const button = byId('sr-join');
    if (!button || state.joining) return;
    const room = selectedRoom();
    button.disabled = !room?.active;
    button.textContent = room?.active
      ? `Join ${roomPresentation(room.roomKey).name}`
      : 'Open a room to join';
  }

  function selectRoom(roomKey) {
    const room = activeRoom(roomKey);
    if (!room) return false;
    state.selectedRoomKey = room.roomKey;
    renderRoomCatalog();
    return true;
  }

  function roomCountCopy(room) {
    if (!room.active) return 'Open this room';
    if (room.participantCount === 0) return 'Ready for the first study partner';
    return `${room.participantCount} ${room.participantCount === 1 ? 'person' : 'people'} studying`;
  }

  function createRoomCard(room, firstInactiveRoomKey) {
    const presentation = roomPresentation(room.roomKey);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sr-room-card${room.active ? '' : ' sr-room-card-create'}${state.selectedRoomKey === room.roomKey ? ' is-selected' : ''}`;
    button.id = room.active ? `sr-room-card-${room.roomKey}` : (room.roomKey === firstInactiveRoomKey ? 'sr-create-room' : `sr-create-room-${room.roomKey}`);
    button.dataset.roomKey = room.roomKey;
    button.dataset.roomAction = room.active ? 'select' : 'create';
    button.dataset.roomState = room.active ? 'available' : 'create';
    button.disabled = state.roomCatalogBusy
      || state.roomMutationBusy
      || state.joining
      || state.switchingRoom;
    button.setAttribute('aria-label', room.active
      ? `${presentation.name}, ${roomCountCopy(room)}`
      : `Open ${presentation.name}`);
    if (room.active) button.setAttribute('aria-pressed', String(state.selectedRoomKey === room.roomKey));

    if (room.active) {
      const cover = document.createElement('img');
      cover.className = 'sr-room-card-cover';
      cover.src = presentation.cover;
      cover.alt = '';
      cover.setAttribute('aria-hidden', 'true');
      button.append(cover);
    } else {
      const createIcon = document.createElement('span');
      createIcon.className = 'sr-room-create-icon';
      createIcon.setAttribute('aria-hidden', 'true');
      const createIconImage = document.createElement('img');
      createIconImage.src = '../assets/icons/navigation/layout-grid.svg';
      createIconImage.width = 24;
      createIconImage.height = 24;
      createIconImage.alt = '';
      createIcon.append(createIconImage);
      button.append(createIcon);
    }

    const copy = document.createElement('span');
    copy.className = 'sr-room-card-copy';
    const title = document.createElement('strong');
    title.textContent = presentation.name;
    const status = document.createElement('small');
    if (room.active) {
      const peopleIcon = document.createElement('img');
      peopleIcon.src = '../assets/icons/navigation/users.svg';
      peopleIcon.width = 15;
      peopleIcon.height = 15;
      peopleIcon.alt = '';
      peopleIcon.setAttribute('aria-hidden', 'true');
      status.append(peopleIcon);
    }
    const statusText = document.createElement('span');
    statusText.textContent = roomCountCopy(room);
    status.append(statusText);
    copy.append(title, status);
    button.append(copy);
    button.addEventListener('click', () => {
      if (room.active) selectRoom(room.roomKey);
      else createRoomSlot(room.roomKey);
    });
    return button;
  }

  function renderRoomSelector() {
    const menu = byId('sr-room-selector-menu');
    if (!menu) return;
    const activeRooms = state.rooms.filter((room) => room.active);
    menu.replaceChildren(...activeRooms.map((room) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.role = 'option';
      option.dataset.roomKey = room.roomKey;
      option.setAttribute('aria-selected', String(room.roomKey === state.currentRoomKey));
      option.textContent = `${roomPresentation(room.roomKey).name} · ${room.participantCount}`;
      option.disabled = state.joining || state.switchingRoom || state.roomMutationBusy;
      option.addEventListener('click', () => switchToRoom(room.roomKey));
      return option;
    }));
    const selector = byId('sr-room-selector');
    if (selector) selector.disabled = activeRooms.length < 2;
  }

  function renderRoomCatalog() {
    const grid = byId('sr-room-card-grid');
    const firstInactiveRoomKey = state.rooms.find((room) => !room.active)?.roomKey || '';
    if (grid) grid.replaceChildren(...state.rooms.map((room) => createRoomCard(room, firstInactiveRoomKey)));
    const activeCount = state.rooms.filter((room) => room.active).length;
    const count = byId('sr-room-lobby-count');
    if (count) count.textContent = `${activeCount} of ${MAX_ROOMS} rooms open`;
    const selected = selectedRoom();
    const activeName = byId('sr-active-room-name');
    if (activeName) activeName.textContent = roomPresentation(state.currentRoomKey || selected?.roomKey || '1').name;
    renderRoomSelector();
    syncJoinButton();
  }

  function localQualityRoomCatalog() {
    const activeCount = LOCAL_TEST_MODE === 'live' ? 4 : 3;
    return normalizeRoomCatalog({
      rooms: Array.from({ length: MAX_ROOMS }, (_unused, index) => ({
        roomKey: String(index + 1),
        active: index < activeCount,
        participantCount: index === 0 ? 4 : index < activeCount ? index : 0,
        capacity: 12,
        focusStartedAt: new Date(Date.now() - ((index + 1) * 900_000)).toISOString(),
      })),
    });
  }

  async function refreshRoomCatalog(options = {}) {
    if (state.roomCatalogPromise) return state.roomCatalogPromise;
    state.roomCatalogBusy = true;
    renderRoomCatalog();
    const operation = (async () => {
      try {
        const payload = LOCAL_TEST_MODE
          ? { rooms: state.rooms.length ? state.rooms : localQualityRoomCatalog() }
          : await workerRequest('/admin/study-room/rooms', { operation: 'list' });
        state.rooms = normalizeRoomCatalog(payload);
        if (!activeRoom(state.selectedRoomKey)) {
          state.selectedRoomKey = state.rooms.find((room) => room.active)?.roomKey || '';
        }
        renderRoomCatalog();
        return state.rooms;
      } catch (error) {
        if (!options.quiet) {
          setStatus('sr-prejoin-status', friendlyError(error, 'The Study Room list could not refresh.'), 'error');
        }
        throw error;
      }
    })();
    state.roomCatalogPromise = operation;
    try {
      return await operation;
    } finally {
      if (state.roomCatalogPromise === operation) state.roomCatalogPromise = null;
      state.roomCatalogBusy = false;
      renderRoomCatalog();
    }
  }

  async function createRoomSlot(roomKey) {
    if (state.roomCatalogBusy || state.roomMutationBusy || state.joining || state.switchingRoom) return;
    const requestedKey = String(roomKey || '');
    if (!/^[1-4]$/u.test(requestedKey)) return;
    const requestedRoom = state.rooms.find((room) => room.roomKey === requestedKey);
    if (!requestedRoom) return;
    if (requestedRoom.active) {
      selectRoom(requestedKey);
      return;
    }
    if (state.rooms.filter((room) => room.active).length >= MAX_ROOMS) {
      setStatus('sr-prejoin-status', 'All four Study Rooms are already open. Choose one to join.', 'error');
      await refreshRoomCatalog({ quiet: true }).catch(() => {});
      return;
    }
    state.roomMutationBusy = true;
    renderRoomCatalog();
    setStatus('sr-prejoin-status', `Opening ${roomPresentation(requestedKey).name}…`);
    try {
      if (LOCAL_TEST_MODE) {
        state.rooms = state.rooms.map((room) => room.roomKey === requestedKey
          ? Object.freeze({ ...room, active: true, focusStartedAt: new Date().toISOString() })
          : room);
      } else {
        await workerRequest('/admin/study-room/rooms', { operation: 'create', roomKey: requestedKey });
        state.rooms = state.rooms.map((room) => room.roomKey === requestedKey
          ? Object.freeze({ ...room, active: true, focusStartedAt: new Date().toISOString() })
          : room);
        await refreshRoomCatalog({ quiet: true }).catch(() => state.rooms);
      }
      state.selectedRoomKey = requestedKey;
      renderRoomCatalog();
      setStatus('sr-prejoin-status', `${roomPresentation(requestedKey).name} is open. Camera and microphone are still off.`, 'ok');
    } catch (error) {
      setStatus('sr-prejoin-status', friendlyError(error, 'That Study Room could not open just now.'), 'error');
      await refreshRoomCatalog({ quiet: true }).catch(() => {});
    } finally {
      state.roomMutationBusy = false;
      renderRoomCatalog();
    }
  }

  function startRoomCatalogRefresh() {
    global.clearInterval(state.roomRefreshTimer);
    state.roomRefreshTimer = global.setInterval(() => {
      refreshRoomCatalog({ quiet: true }).catch(() => {});
    }, ROOM_REFRESH_INTERVAL_MS);
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
    if (!isMicrophone && enabled) {
      try {
        if (ensureBackgroundController().capabilities().supported !== true) enabled = false;
      } catch (error) {
        enabled = false;
        setStatus('sr-prejoin-status', deviceErrorMessage('camera', error), 'error');
      }
    }
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

  async function startMeter(stream) {
    stopMeter();
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !global.AudioContext) return;
    state.audioContext = new global.AudioContext();
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume().catch(() => {});
    }
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

  const DEVICE_SELECT_IDS = Object.freeze({
    videoinput: ['sr-camera-select', 'sr-live-camera-select'],
    audioinput: ['sr-microphone-select', 'sr-live-microphone-select'],
    audiooutput: ['sr-speaker-select', 'sr-live-speaker-select'],
  });
  const DEVICE_LABEL_COPY = Object.freeze({
    videoinput: Object.freeze({
      noun: 'camera',
      generic: /^(?:camera|webcam|video(?: input| device)?|default(?: device)?)(?:\s*(?:#|-)?\s*\d+)?$/iu,
    }),
    audioinput: Object.freeze({
      noun: 'microphone',
      generic: /^(?:microphone|mic|audio(?: input| device)?|default(?: device)?)(?:\s*(?:#|-)?\s*\d+)?$/iu,
    }),
    audiooutput: Object.freeze({
      noun: 'speaker',
      generic: /^(?:speaker|speakers|audio(?: output| device)?|default(?: device)?)(?:\s*(?:#|-)?\s*\d+)?$/iu,
    }),
  });

  function selectedDeviceId(kind) {
    const remembered = state.selectedDevices[kind];
    if (remembered) return remembered;
    for (const id of DEVICE_SELECT_IDS[kind] || []) {
      const value = byId(id)?.value || '';
      if (value) return value;
    }
    return '';
  }

  function rememberDeviceSelection(kind, value) {
    const normalized = String(value || '');
    state.selectedDevices[kind] = normalized;
    for (const id of DEVICE_SELECT_IDS[kind] || []) {
      const select = byId(id);
      const options = select?.options || select?.children || [];
      if (select && [...options].some((option) => option.value === normalized)) {
        select.value = normalized;
      }
    }
  }

  function deviceOptionLabel(device, index, kind) {
    const copy = DEVICE_LABEL_COPY[kind] || Object.freeze({ noun: 'device', generic: /^$/u });
    const provided = String(device?.label || '').trim();
    if (provided && !copy.generic.test(provided)) return provided;
    if (index === 0 || String(device?.deviceId || '').toLowerCase() === 'default') {
      return `System default ${copy.noun}`;
    }
    return `Alternate ${copy.noun} ${index + 1}`;
  }

  function fillSelect(select, devices, kind) {
    if (!select) return;
    const previous = selectedDeviceId(kind) || select.value;
    select.replaceChildren();
    if (!devices.length) {
      const option = new Option(deviceOptionLabel(null, 0, kind), '');
      select.append(option);
      select.disabled = true;
      if (state.selectedDevices[kind] === previous) state.selectedDevices[kind] = '';
      return;
    }
    devices.forEach((device, index) => {
      const label = deviceOptionLabel(device, index, kind);
      select.append(new Option(label, device.deviceId));
    });
    select.disabled = false;
    if (devices.some((device) => device.deviceId === previous)) select.value = previous;
    if (!state.selectedDevices[kind] || !devices.some((device) => device.deviceId === state.selectedDevices[kind])) {
      state.selectedDevices[kind] = select.value;
    }
  }

  async function refreshDeviceLists() {
    if (!global.navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await global.navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const microphones = devices.filter((device) => device.kind === 'audioinput');
    const speakers = devices.filter((device) => device.kind === 'audiooutput');
    for (const prefix of ['sr-', 'sr-live-']) {
      fillSelect(byId(`${prefix}camera-select`), cameras, 'videoinput');
      fillSelect(byId(`${prefix}microphone-select`), microphones, 'audioinput');
      fillSelect(byId(`${prefix}speaker-select`), speakers, 'audiooutput');
    }
    return devices;
  }

  async function brieflyRequestDevicePermission(mediaDevices, constraints) {
    const temporaryStream = await requestUserMediaWithTimeout(mediaDevices, constraints, 10000);
    temporaryStream?.getTracks?.().forEach((track) => track.stop());
  }

  async function discoverDevices() {
    const mediaDevices = global.navigator.mediaDevices;
    const devices = await refreshDeviceLists();
    if (!mediaDevices?.getUserMedia) return;

    const noDevicesEnumerated = devices.length === 0;
    const needsCameraLabel = noDevicesEnumerated
      || devices.some((device) => device.kind === 'videoinput' && !device.label);
    const needsMicrophoneLabel = noDevicesEnumerated
      || devices.some((device) => device.kind === 'audioinput' && !device.label);
    if (!needsCameraLabel && !needsMicrophoneLabel) {
      setStatus('sr-prejoin-status', 'Camera and microphone are off. Your available devices were detected.', 'ok');
      return;
    }

    let permissionError = null;
    let partialAccess = false;
    let refreshedDevices = devices;
    setStatus('sr-prejoin-status', 'Allow device access to identify your camera and microphone. Your camera indicator may turn on briefly during this local check; nothing is shared.');
    try {
      await brieflyRequestDevicePermission(mediaDevices, {
        video: needsCameraLabel,
        audio: needsMicrophoneLabel,
      });
    } catch (error) {
      permissionError = error;
      const canRetrySeparately = needsCameraLabel
        && needsMicrophoneLabel
        && isRetryableDeviceError(error);
      if (canRetrySeparately) {
        let successes = 0;
        const failures = [];
        for (const constraints of [
          { video: true, audio: false },
          { video: false, audio: true },
        ]) {
          try {
            await brieflyRequestDevicePermission(mediaDevices, constraints);
            successes += 1;
          } catch (individualError) {
            failures.push(individualError);
          }
        }
        partialAccess = successes > 0 && failures.length > 0;
        permissionError = failures[0] || null;
      }
    } finally {
      refreshedDevices = await refreshDeviceLists();
    }

    if (permissionError) {
      const cameraLabelResolved = !needsCameraLabel
        || refreshedDevices.some((device) => device.kind === 'videoinput' && device.label);
      const microphoneLabelResolved = !needsMicrophoneLabel
        || refreshedDevices.some((device) => device.kind === 'audioinput' && device.label);
      if (cameraLabelResolved && microphoneLabelResolved) {
        setStatus('sr-prejoin-status', 'Camera and microphone are off. Your available devices were detected.', 'ok');
        return;
      }
      const denied = isPermissionError(permissionError);
      const waiting = permissionError?.name === 'PermissionTimeoutError';
      setStatus(
        'sr-prejoin-status',
        partialAccess
          ? 'Camera and microphone are off. Available devices were refreshed, but one device type could not be identified.'
          : waiting
          ? 'Camera and microphone are off. The browser is still waiting for permission. Choose Allow in the browser prompt, then select Test devices.'
          : denied
          ? 'Camera and microphone are off. Allow device permission when you are ready to test them.'
          : 'Camera and microphone are off. Some device names could not be detected automatically.',
        denied || partialAccess ? '' : 'error',
      );
      return;
    }
    setStatus('sr-prejoin-status', 'Camera and microphone are off. Your available devices were detected.', 'ok');
  }

  function bindDeviceChangeDetection() {
    const mediaDevices = global.navigator.mediaDevices;
    if (state.deviceChangeBound || !mediaDevices?.addEventListener) return;
    mediaDevices.addEventListener('devicechange', refreshDeviceLists);
    state.deviceChangeBound = true;
  }

  async function captureOneDeviceTest(mediaDevices, kind, selected) {
    const constraints = kind === 'camera'
      ? { video: selected, audio: false }
      : { video: false, audio: selected };
    try {
      return await requestUserMediaWithTimeout(mediaDevices, constraints);
    } catch (error) {
      if (selected === true || !isRetryableDeviceError(error)) throw error;
      await refreshDeviceLists();
      return requestUserMediaWithTimeout(
        mediaDevices,
        kind === 'camera' ? { video: true, audio: false } : { video: false, audio: true },
      );
    }
  }

  async function captureSelectedDeviceTest(mediaDevices) {
    const selectedCamera = selectedConstraint('sr-camera-select');
    const selectedMicrophone = selectedConstraint('sr-microphone-select');
    const combinedConstraints = { video: selectedCamera, audio: selectedMicrophone };
    try {
      const stream = await requestUserMediaWithTimeout(mediaDevices, combinedConstraints);
      return { stream, cameraError: null, microphoneError: null };
    } catch (combinedError) {
      if (!isRetryableDeviceError(combinedError)) throw combinedError;

      const capturedStreams = [];
      let cameraError = null;
      let microphoneError = null;
      try {
        capturedStreams.push(await captureOneDeviceTest(mediaDevices, 'camera', selectedCamera));
      } catch (error) {
        cameraError = error;
      }
      try {
        capturedStreams.push(await captureOneDeviceTest(mediaDevices, 'microphone', selectedMicrophone));
      } catch (error) {
        microphoneError = error;
      }

      const tracks = capturedStreams.flatMap((stream) => stream?.getTracks?.() || []);
      if (!tracks.length) throw microphoneError || cameraError || combinedError;
      return {
        stream: new global.MediaStream(tracks),
        cameraError,
        microphoneError,
      };
    }
  }

  function syncTestedDeviceSelections(stream) {
    for (const track of stream?.getTracks?.() || []) {
      const deviceId = track.getSettings?.().deviceId || '';
      const kind = track.kind === 'audio' ? 'audioinput' : track.kind === 'video' ? 'videoinput' : '';
      if (deviceId && kind) rememberDeviceSelection(kind, deviceId);
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
      const result = await captureSelectedDeviceTest(global.navigator.mediaDevices);
      state.previewStream = result.stream;
      const video = byId('sr-local-preview');
      video.srcObject = state.previewStream;
      video.hidden = state.previewStream.getVideoTracks().length === 0;
      byId('sr-camera-placeholder').hidden = !video.hidden;
      await video.play().catch(() => {});
      await startMeter(state.previewStream).catch(() => {});
      await refreshDeviceLists();
      syncTestedDeviceSelections(state.previewStream);
      const label = button.querySelector('span');
      if (label) label.textContent = 'Stop device test';
      const hasCamera = state.previewStream.getVideoTracks().length > 0;
      const hasMicrophone = state.previewStream.getAudioTracks().length > 0;
      setStatus(
        'sr-prejoin-status',
        hasCamera && hasMicrophone
          ? 'Camera and microphone are working on this computer. Nothing has been shared.'
          : hasMicrophone
          ? 'Microphone is working; the camera could not start. Nothing has been shared.'
          : 'Camera is working; the microphone could not start. Nothing has been shared.',
        'ok',
      );
    } catch (error) {
      stopDeviceTest();
      const denied = isPermissionError(error);
      const waiting = error?.name === 'PermissionTimeoutError';
      setStatus(
        'sr-prejoin-status',
        denied
          ? 'Camera or microphone permission was not granted. Allow access for duediligence.ph in browser site permissions, then retry. You can still join with both off.'
          : waiting
          ? 'The browser is still waiting for device permission. Choose Allow in the browser prompt, then try again.'
          : 'The selected camera or microphone could not start. Close other calling apps, choose another device, or join with both off.',
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
    } else if (kind === 'audio') {
      element.muted = false;
    }
    container.append(element);
    state.attachedTracks.push({ track, element });
    if (kind === 'audio' && typeof element.play === 'function') {
      try {
        Promise.resolve(element.play())
          .then(() => {
            state.audioPlaybackBlocked = false;
            updateAudioPrompt();
          })
          .catch(() => {
            state.audioPlaybackBlocked = true;
            updateAudioPrompt();
          });
      } catch {
        state.audioPlaybackBlocked = true;
        updateAudioPrompt();
      }
    }
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
    const localCameraProtected = !participant.isLocal
      || isStaticQualityCameraPublication(videoPublication)
      || isMandatoryProcessedCameraTrack(videoTrack);
    const cameraVisible = Boolean(videoTrack && !videoPublication?.isMuted && localCameraProtected);
    if (participant.isLocal && videoTrack && !videoPublication?.isMuted && !localCameraProtected) {
      scheduleLocalCameraGuard(state.room);
    }
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
    const microphoneOn = Boolean(audioPublication && !audioPublication.isMuted);
    mediaState.classList.toggle('is-muted', !microphoneOn);
    mediaState.setAttribute('aria-label', microphoneOn ? 'Microphone on' : 'Microphone muted');
    mediaState.title = microphoneOn ? 'Microphone on' : 'Microphone muted';
    const microphoneIcon = document.createElement('img');
    microphoneIcon.src = '../assets/icons/navigation/mic.svg';
    microphoneIcon.width = 17;
    microphoneIcon.height = 17;
    microphoneIcon.alt = '';
    microphoneIcon.setAttribute('aria-hidden', 'true');
    mediaState.append(microphoneIcon);
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
      localMute.title = locallyMuted ? 'Hear again' : 'Mute for me';
      localMute.setAttribute(
        'aria-label',
        locallyMuted
          ? `Hear ${displayName(participant)} again`
          : `Mute ${displayName(participant)} only for you`,
      );
      const localMuteIcon = document.createElement('img');
      localMuteIcon.src = '../assets/icons/navigation/mic.svg';
      localMuteIcon.width = 17;
      localMuteIcon.height = 17;
      localMuteIcon.alt = '';
      localMuteIcon.setAttribute('aria-hidden', 'true');
      const localMuteCopy = document.createElement('span');
      localMuteCopy.className = 'sr-visually-hidden';
      localMuteCopy.textContent = locallyMuted ? 'Hear again' : 'Mute for me';
      localMute.append(localMuteIcon, localMuteCopy);
      localMute.addEventListener('click', () => {
        if (locallyMuted) {
          state.localMutedParticipants.delete(participant.identity);
          setParticipantVolume(participant, state.participantVolumes.get(participant.identity) ?? 100);
        } else {
          state.localMutedParticipants.add(participant.identity);
          participant.setVolume?.(0);
        }
        renderParticipants();
      });

      const block = document.createElement('button');
      const blocked = state.blockedParticipants.has(participant.identity);
      block.type = 'button';
      block.title = blocked ? 'Unblock' : 'Block locally';
      block.setAttribute(
        'aria-label',
        blocked ? `Unblock ${displayName(participant)}` : `Block ${displayName(participant)} only for you`,
      );
      const blockIcon = document.createElement('img');
      blockIcon.src = '../assets/icons/community/eye-slash.svg';
      blockIcon.width = 17;
      blockIcon.height = 17;
      blockIcon.alt = '';
      blockIcon.setAttribute('aria-hidden', 'true');
      const blockCopy = document.createElement('span');
      blockCopy.className = 'sr-visually-hidden';
      blockCopy.textContent = blocked ? 'Unblock' : 'Block locally';
      block.append(blockIcon, blockCopy);
      block.addEventListener('click', () => setParticipantBlocked(participant, !blocked).catch(() => {
        toast('This participant could not be blocked just now.');
      }));
      actions.append(localMute, block);
      row.append(actions);

      const volume = document.createElement('label');
      volume.className = 'sr-person-volume';
      const volumeLabel = document.createElement('span');
      volumeLabel.textContent = 'Volume';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(state.participantVolumes.get(participant.identity) ?? 100);
      slider.disabled = blocked || locallyMuted;
      slider.setAttribute('aria-label', `${displayName(participant)} volume`);
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
      if (
        state.blockedParticipants.has(participant.identity)
        || state.localMutedParticipants.has(participant.identity)
      ) return;
      const publication = publicationFor(participant, LiveKit?.Track?.Source?.Microphone || 'microphone');
      if (publication?.track && !publication.isMuted) {
        attachTrack(publication.track, audioBin, 'audio', false);
        setParticipantVolume(participant, state.participantVolumes.get(participant.identity) ?? 100);
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
    if (state.currentRoomKey) {
      state.rooms = state.rooms.map((room) => room.roomKey === state.currentRoomKey
        ? Object.freeze({ ...room, active: true, participantCount: participants.length })
        : room);
      renderRoomSelector();
    }
    syncSelfMediaState();
  }

  function syncActiveSpeakerTiles() {
    byId('sr-participant-grid')?.querySelectorAll('[data-participant-identity]').forEach((tile) => {
      tile.classList.toggle('is-speaking', state.activeSpeakers.has(tile.dataset.participantIdentity));
    });
  }

  async function recoverFromTerminalDisconnect(room) {
    if (state.leaving || state.recovering || state.room !== room) return;
    state.recovering = true;
    state.leaving = true;
    try {
      global.clearInterval(state.focusTimer);
      state.focusTimer = 0;
      detachTracks();
      // Keep state.room available until controller cleanup has muted,
      // unpublished, and stopped any protected camera track.
      await destroyBackgroundController();
      removeLocalCameraPublishGuard(room);
      if (state.room === room) clearConnectedRoomState();
      state.joining = false;
      syncJoinButton();
      byId('sr-live-room').hidden = true;
      byId('sr-prejoin').hidden = false;
      setStatus(
        'sr-prejoin-status',
        'The room connection ended. Your camera and microphone are off. You can rejoin when ready.',
        'error',
      );
      toast('The Study Room connection ended. Your camera and microphone are off.');
    } finally {
      state.leaving = false;
      state.recovering = false;
    }
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
    const micOn = isLocalSourceEnabled(local, 'microphone');
    const cameraOn = isLocalSourceEnabled(local, 'camera');
    byId('sr-microphone-state').textContent = micOn ? 'On' : 'Off';
    byId('sr-camera-state').textContent = cameraOn ? 'On' : 'Off';
    const micButton = byId('sr-toggle-microphone');
    const cameraButton = byId('sr-toggle-camera');
    micButton.setAttribute('aria-pressed', String(micOn));
    cameraButton.setAttribute('aria-pressed', String(cameraOn));
    micButton.setAttribute('aria-label', micOn ? 'Mute your microphone' : 'Unmute your microphone');
    cameraButton.setAttribute('aria-label', cameraOn ? 'Stop your camera' : 'Start your camera');
    micButton.querySelector('span').textContent = micOn ? 'Mute' : 'Unmute';
    cameraButton.querySelector('span').textContent = cameraOn ? 'Stop video' : 'Start video';
    const mediaStatus = byId('sr-live-media-status');
    if (mediaStatus) {
      mediaStatus.textContent = micOn
        ? state.microphoneTransport === 'sending'
          ? 'Your microphone is sending audio to the room.'
          : state.microphoneTransport === 'checking'
          ? 'Your microphone is on. Confirming the outgoing audio connection…'
          : 'Your microphone is on, but this browser could not expose outgoing packet confirmation.'
        : 'Your microphone is muted. Press Unmute when you want others to hear you.';
      mediaStatus.classList.toggle('is-on', micOn);
    }
  }

  function updateAudioPrompt() {
    const prompt = byId('sr-audio-prompt');
    prompt.hidden = !state.room
      || (!state.audioPlaybackBlocked && state.room.canPlaybackAudio !== false);
  }

  async function startRoomAudioFromGesture(room = state.room) {
    try {
      await room?.startAudio?.();
      const audioElements = state.attachedTracks
        .filter(({ element }) => String(element?.tagName || '').toLowerCase() === 'audio')
        .map(({ element }) => element);
      await Promise.all(audioElements.map((element) => element.play?.()));
      state.audioPlaybackBlocked = false;
      updateAudioPrompt();
      return true;
    } catch {
      state.audioPlaybackBlocked = true;
      updateAudioPrompt();
      return false;
    }
  }

  function bindRoomEvents(room) {
    const event = LiveKit.RoomEvent;
    [event.LocalTrackPublished, event.TrackUnmuted].filter(Boolean).forEach((eventName) => {
      room.on(eventName, () => scheduleLocalCameraGuard(room));
    });
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
      if (
        state.activeSpeakers.has(room.localParticipant?.identity)
        && isLocalSourceEnabled(room.localParticipant, 'microphone')
      ) {
        state.microphoneTransport = 'sending';
        syncSelfMediaState();
      }
      // Keep attached audio/video elements stable while only the speaking halo changes.
      syncActiveSpeakerTiles();
    });
    room.on(event.ConnectionStateChanged, (connectionState) => {
      syncConnectionState(connectionState);
      if (String(connectionState || '').toLowerCase() === 'connected') {
        scheduleLocalCameraGuard(room);
      }
    });
    room.on(event.AudioPlaybackStatusChanged, (canPlayAudio) => {
      state.audioPlaybackBlocked = canPlayAudio === false || room.canPlaybackAudio === false;
      updateAudioPrompt();
    });
    if (event.MediaDevicesChanged) {
      room.on(event.MediaDevicesChanged, () => refreshDeviceLists().catch(() => {}));
    }
    if (event.ActiveDeviceChanged) {
      room.on(event.ActiveDeviceChanged, (deviceKind, deviceId) => {
        if (!DEVICE_SELECT_IDS[deviceKind] || !deviceId) return;
        refreshDeviceLists()
          .then(() => rememberDeviceSelection(deviceKind, deviceId))
          .catch(() => {});
      });
    }
    if (event.MediaDevicesError) {
      room.on(event.MediaDevicesError, (error, deviceKind) => {
        const kind = deviceKind === 'videoinput'
          ? 'camera'
          : deviceKind === 'audioinput'
          ? 'microphone'
          : /camera|video/iu.test(String(error?.message || ''))
          ? 'camera'
          : 'microphone';
        if (kind === 'microphone') state.microphoneTransport = 'failed';
        toast(deviceErrorMessage(kind, error));
        syncSelfMediaState();
      });
    }
    if (event.LocalAudioSilenceDetected) {
      room.on(event.LocalAudioSilenceDetected, () => {
        toast('Your microphone is on, but no sound is detected. Check the selected microphone and its physical mute switch.');
      });
    }
    room.on(event.Disconnected, () => {
      recoverFromTerminalDisconnect(room).catch(() => {});
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
    const cameraId = selectedDeviceId('videoinput');
    const microphoneId = selectedDeviceId('audioinput');
    const speakerId = selectedDeviceId('audiooutput');
    return {
      camera: cameraId ? { deviceId: { exact: cameraId } } : undefined,
      microphone: {
        ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      speakerId,
    };
  }

  function localSourcePublication(local, kind) {
    const isMicrophone = kind === 'microphone';
    return publicationFor(
      local,
      isMicrophone
        ? (LiveKit.Track?.Source?.Microphone || 'microphone')
        : (LiveKit.Track?.Source?.Camera || 'camera'),
    );
  }

  function microphonePublicationIsLive(publication) {
    const track = publication?.track;
    const mediaStreamTrack = track?.mediaStreamTrack;
    return Boolean(
      publication
      && track
      && !publication.isMuted
      && track.isMuted !== true
      && mediaStreamTrack
      && mediaStreamTrack.readyState === 'live'
      && mediaStreamTrack.enabled !== false
      && publication.isUpstreamPaused !== true
      && track.isUpstreamPaused !== true
    );
  }

  function microphonePublishOptions() {
    return {
      ...(LiveKit.AudioPresets?.speech ? { audioPreset: LiveKit.AudioPresets.speech } : {}),
      dtx: false,
      red: true,
      forceStereo: false,
    };
  }

  function cameraPublishOptions() {
    return {
      source: LiveKit.Track?.Source?.Camera || 'camera',
      simulcast: true,
      videoCodec: 'vp8',
      degradationPreference: 'maintain-framerate',
      videoEncoding: { ...STUDY_VIDEO_ENCODING },
      ...(LiveKit.VideoPresets?.h180 ? { videoSimulcastLayers: [LiveKit.VideoPresets.h180] } : {}),
    };
  }

  function studyRoomMediaOptions() {
    return {
      adaptiveStream: {
        pixelDensity: 1,
        pauseVideoInBackground: true,
      },
      dynacast: true,
      disconnectOnPageLeave: true,
      stopLocalTrackOnUnpublish: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      },
      videoCaptureDefaults: {
        resolution: { ...STUDY_VIDEO_CAPTURE },
      },
      publishDefaults: {
        ...microphonePublishOptions(),
        simulcast: true,
        videoCodec: 'vp8',
        degradationPreference: 'maintain-framerate',
        videoEncoding: { ...STUDY_VIDEO_ENCODING },
        ...(LiveKit.VideoPresets?.h180 ? { videoSimulcastLayers: [LiveKit.VideoPresets.h180] } : {}),
      },
    };
  }

  async function microphoneTransportSample(publication) {
    const getSenderStats = publication?.track?.getSenderStats;
    if (typeof getSenderStats !== 'function') return null;
    try {
      const stats = await getSenderStats.call(publication.track);
      const bytesSent = Number(stats?.bytesSent);
      const packetsSent = Number(stats?.packetsSent);
      if (!Number.isFinite(bytesSent) && !Number.isFinite(packetsSent)) return null;
      return {
        bytesSent: Number.isFinite(bytesSent) ? bytesSent : 0,
        packetsSent: Number.isFinite(packetsSent) ? packetsSent : 0,
      };
    } catch {
      return null;
    }
  }

  async function verifyMicrophoneTransport(local, candidatePublication) {
    const publication = candidatePublication?.track
      ? candidatePublication
      : localSourcePublication(local, 'microphone');
    if (!microphonePublicationIsLive(publication)) throw sourceStartError('microphone');

    if (typeof publication.track?.getSenderStats !== 'function') return 'unverified';
    let previous = null;
    for (let attempt = 0; attempt <= MICROPHONE_STATS_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await waitForMediaSample();
      if (state.room?.localParticipant !== local) throw new Error('The Study Room changed while checking the microphone.');
      if (!microphonePublicationIsLive(publication)) throw sourceStartError('microphone');
      const current = await microphoneTransportSample(publication);
      if (
        current
        && previous
        && (
          current.bytesSent > previous.bytesSent
          || current.packetsSent > previous.packetsSent
        )
      ) return 'sending';
      if (current) previous = current;
    }
    if (!previous) return 'unverified';
    const error = new Error('The microphone track is live, but no outgoing audio packets were detected.');
    error.name = 'TrackStartError';
    error.code = 'MICROPHONE_TRANSPORT_STALLED';
    throw error;
  }

  async function discardMicrophonePublication(local) {
    const publication = localSourcePublication(local, 'microphone');
    const track = publication?.track;
    if (!track) return;
    try {
      await local.unpublishTrack?.(track, true);
    } catch {
      // The stopped track below prevents a stale capture from being reused.
    }
    track.stop?.();
  }

  function isStaticQualityCameraPublication(publication) {
    return LOCAL_TEST_MODE === 'live' && publication?.__studyRoomStaticPreview === true;
  }

  function isMandatoryProcessedCameraTrack(track) {
    try {
      const effects = global.LivekitTrackProcessors;
      const processor = track?.getProcessor?.();
      const processedTrack = processor?.processedTrack;
      const processorOptions = processor?.transformer?.options;
      const strictProductionVerification = Boolean(
        effects?.POLICY === MANDATORY_BACKGROUND_POLICY
        && typeof effects.MANDATORY_IMAGE_PATH === 'string'
        && effects.MANDATORY_IMAGE_PATH.length > 0
        && processor
        && processor.mode === 'virtual-background'
        && processorOptions?.imagePath === effects.MANDATORY_IMAGE_PATH
        && processorOptions.backgroundDisabled !== true
        && typeof processorOptions.blurRadius === 'undefined'
        && processedTrack
        && processedTrack.readyState === 'live'
        && processedTrack.enabled !== false
        && track.mediaStreamTrack === processedTrack
        && track.getProcessor?.() === processor
      );
      if (strictProductionVerification) return true;

      // The controller contract is also tracked after enableCamera returns.
      // This fallback supports isolated controller test doubles only when the
      // production processor bundle is absent; production always takes the
      // stronger identity/processedTrack verification above.
      return Boolean(
        !effects
        && state.controllerProtectedCameraTracks.has(track)
        && processor?.mode === 'virtual-background'
        && (processor?.imagePath || processorOptions?.imagePath)
          === '/assets/study-room/virtual-background-due-diligence-branded.webp'
        && track?.mediaStreamTrack?.readyState === 'live'
        && track.mediaStreamTrack.enabled !== false
      );
    } catch {
      return false;
    }
  }

  function mandatoryCameraError() {
    const error = new Error('The required Due Diligence backdrop was not verified, so video remains off.');
    error.name = 'StudyRoomBackgroundError';
    error.code = 'STUDY_ROOM_BACKGROUND_NOT_VERIFIED';
    return error;
  }

  function assertMandatoryProcessedCameraTrack(track) {
    if (!isMandatoryProcessedCameraTrack(track)) throw mandatoryCameraError();
    return track;
  }

  function isCameraPublishAttempt(track, publishOptions = {}) {
    const cameraSource = LiveKit?.Track?.Source?.Camera || 'camera';
    const screenShareSource = LiveKit?.Track?.Source?.ScreenShare || 'screen_share';
    const source = publishOptions?.source || track?.source || '';
    if (source === screenShareSource || source === 'screen_share') return false;
    return source === cameraSource
      || source === 'camera'
      || track?.kind === 'video'
      || track?.mediaStreamTrack?.kind === 'video';
  }

  function removeLocalCameraPublishGuard(room = state.cameraPublishGuard?.room) {
    const guard = state.cameraPublishGuard;
    if (!guard || (room && guard.room !== room)) return;
    try {
      if (guard.participant.publishTrack === guard.guardedPublishTrack) {
        if (guard.hadOwnPublishTrack) {
          Object.defineProperty(guard.participant, 'publishTrack', guard.originalDescriptor);
        } else {
          delete guard.participant.publishTrack;
        }
      }
    } catch {
      // The room is being discarded; retaining the fail-closed wrapper is safe.
    }
    state.cameraPublishGuard = null;
  }

  function installLocalCameraPublishGuard(room) {
    if (state.cameraPublishGuard?.room === room) return true;
    removeLocalCameraPublishGuard();
    const participant = room?.localParticipant;
    const originalPublishTrack = participant?.publishTrack;
    if (!participant) return false;
    // The real LiveKit participant always exposes publishTrack. A controller
    // test double may publish into an in-memory collection directly.
    if (typeof originalPublishTrack !== 'function') return true;
    const originalDescriptor = Object.getOwnPropertyDescriptor(participant, 'publishTrack');
    const guardedPublishTrack = function guardedStudyRoomPublishTrack(track, publishOptions) {
      if (isCameraPublishAttempt(track, publishOptions)) assertMandatoryProcessedCameraTrack(track);
      return originalPublishTrack.call(this, track, publishOptions);
    };
    try {
      participant.publishTrack = guardedPublishTrack;
      if (participant.publishTrack !== guardedPublishTrack) return false;
      state.cameraPublishGuard = {
        room,
        participant,
        guardedPublishTrack,
        hadOwnPublishTrack: Boolean(originalDescriptor),
        originalDescriptor,
      };
      return true;
    } catch {
      return false;
    }
  }

  async function failClosedUnprotectedLocalCamera(room) {
    if (!room || state.room !== room) return true;
    const local = room.localParticipant;
    const publication = localSourcePublication(local, 'camera');
    if (
      !publication
      || isStaticQualityCameraPublication(publication)
      || isMandatoryProcessedCameraTrack(publication.track)
    ) return true;

    try {
      await publication.mute?.();
    } catch {
      // Unpublishing and stopping below remain the fail-closed fallback.
    }
    try {
      if (publication.track) await local.unpublishTrack?.(publication.track, false);
    } catch {
      // Disconnecting or stopping the local track below still prevents video.
    }
    publication.track?.stop?.();
    if (state.backgroundController) await destroyBackgroundController();
    syncSelfMediaState();
    toast('An unprotected camera track was blocked. Video is off.');
    return false;
  }

  function scheduleLocalCameraGuard(room) {
    state.cameraGuard = state.cameraGuard
      .catch(() => {})
      .then(() => failClosedUnprotectedLocalCamera(room))
      .catch(() => false);
    return state.cameraGuard;
  }

  function isLocalSourceEnabled(local, kind) {
    const publication = localSourcePublication(local, kind);
    if (kind === 'microphone') return microphonePublicationIsLive(publication);
    const mediaStreamTrack = publication?.track?.mediaStreamTrack;
    const live = Boolean(
      publication
      && publication.track
      && !publication.isMuted
      && mediaStreamTrack
      && mediaStreamTrack.readyState === 'live'
      && mediaStreamTrack.enabled !== false
      && mediaStreamTrack.muted !== true
      && publication.isUpstreamPaused !== true
    );
    if (!live || kind !== 'camera') return live;
    return isStaticQualityCameraPublication(publication)
      || isMandatoryProcessedCameraTrack(publication.track);
  }

  function syncBrandedBackdropState(snapshot = {}) {
    const status = String(snapshot.status || 'idle');
    const node = byId('sr-branded-backdrop-status');
    const copy = byId('sr-branded-backdrop-copy');
    if (node) node.dataset.backdropState = status;
    if (copy) {
      copy.textContent = status === 'enabled'
        ? 'Due Diligence backdrop is active on your camera.'
        : status === 'preparing'
        ? 'Preparing the required Due Diligence backdrop before video is shared…'
        : status === 'unavailable'
        ? (snapshot.error || 'This device cannot safely apply the required backdrop, so video remains off.')
        : status === 'destroyed'
        ? 'The protected camera has been closed.'
        : 'Your real background is never shared; the Due Diligence backdrop is applied before video starts.';
    }
    const unavailable = snapshot.supported === false || status === 'unavailable';
    for (const id of ['sr-join-camera', 'sr-toggle-camera']) {
      const button = byId(id);
      if (!button) continue;
      if (unavailable) {
        button.disabled = true;
        button.title = 'This browser cannot safely apply the required Due Diligence backdrop.';
      } else if (status === 'preparing' || state.cameraOperationBusy) {
        button.disabled = true;
      } else {
        button.disabled = false;
        button.removeAttribute?.('title');
      }
    }
  }

  function ensureBackgroundController() {
    if (state.backgroundController) return state.backgroundController;
    const createController = global.DueDiligenceStudyRoomMandatoryBackground?.createController;
    if (typeof createController !== 'function') {
      const error = new Error('The required Due Diligence backdrop could not load, so video remains off.');
      error.code = 'STUDY_ROOM_BACKGROUND_LIBRARY_UNAVAILABLE';
      syncBrandedBackdropState({ status: 'unavailable', supported: false, error: error.message });
      throw error;
    }
    state.backgroundController = createController({
      liveKit: LiveKit,
      getLocalParticipant: () => state.room?.localParticipant || null,
      onStateChange: syncBrandedBackdropState,
      maxFps: STUDY_VIDEO_CAPTURE.frameRate,
    });
    const capabilities = state.backgroundController.capabilities();
    syncBrandedBackdropState({
      status: capabilities.supported ? 'disabled' : 'unavailable',
      ...capabilities,
      error: capabilities.supported
        ? ''
        : 'This browser cannot safely apply the required Due Diligence backdrop, so video remains off.',
    });
    return state.backgroundController;
  }

  async function destroyBackgroundController() {
    const controller = state.backgroundController;
    state.backgroundController = null;
    if (!controller) {
      await state.backgroundCleanup.catch(() => {});
      return;
    }
    const capabilities = controller.capabilities?.() || { supported: false };
    const cleanup = state.backgroundCleanup
      .catch(() => {})
      .then(() => controller.destroy?.())
      .catch(() => {});
    state.backgroundCleanup = cleanup;
    await cleanup;
    state.controllerProtectedCameraTracks.clear();
    if (!state.backgroundController) {
      syncBrandedBackdropState({
        status: capabilities.supported ? 'idle' : 'unavailable',
        ...capabilities,
        error: capabilities.supported
          ? ''
          : 'This browser cannot safely apply the required Due Diligence backdrop, so video remains off.',
      });
    }
  }

  async function setProtectedCameraEnabled(enabled) {
    await state.backgroundCleanup.catch(() => {});
    const room = state.room;
    if (!room?.localParticipant) throw new Error('The room is not connected.');
    if (!installLocalCameraPublishGuard(room)) {
      syncBrandedBackdropState({
        status: 'unavailable',
        supported: false,
        error: 'This browser could not enforce protected camera publication, so video remains off.',
      });
      throw mandatoryCameraError();
    }
    const controller = ensureBackgroundController();
    state.cameraOperationBusy = true;
    try {
      if (!enabled) {
        await controller.disableCamera();
        return;
      }
      const deviceId = selectedDeviceId('videoinput');
      const result = await controller.enableCamera(
        captureOptions('camera', deviceId),
        cameraPublishOptions(),
      );
      if (result?.publication?.track) state.controllerProtectedCameraTracks.add(result.publication.track);
      assertMandatoryProcessedCameraTrack(result?.publication?.track);
      if (!isLocalSourceEnabled(room.localParticipant, 'camera')) throw sourceStartError('camera');
      await syncActualInputDevice('camera', deviceId);
    } finally {
      state.cameraOperationBusy = false;
      syncBrandedBackdropState(controller.snapshot?.() || controller.capabilities?.() || {});
    }
  }

  async function switchProtectedCameraDevice(deviceId) {
    await state.backgroundCleanup.catch(() => {});
    const room = state.room;
    if (!room?.localParticipant || !installLocalCameraPublishGuard(room)) throw mandatoryCameraError();
    const controller = ensureBackgroundController();
    state.cameraOperationBusy = true;
    try {
      const result = await ensureBackgroundController().switchCamera(captureOptions('camera', deviceId));
      if (result?.publication?.track) state.controllerProtectedCameraTracks.add(result.publication.track);
      assertMandatoryProcessedCameraTrack(result?.publication?.track);
      if (!isLocalSourceEnabled(room.localParticipant, 'camera')) throw sourceStartError('camera');
      await syncActualInputDevice('camera', deviceId);
      return result;
    } finally {
      state.cameraOperationBusy = false;
      syncBrandedBackdropState(controller.snapshot?.() || controller.capabilities?.() || {});
    }
  }

  function captureOptions(kind, deviceId = '') {
    if (kind === 'microphone') {
      return {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      };
    }
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      resolution: { ...STUDY_VIDEO_CAPTURE },
    };
  }

  function sourceStartError(kind) {
    const error = new Error(`The ${kind} did not produce a live media track.`);
    error.name = 'TrackStartError';
    error.code = 'MEDIA_TRACK_NOT_LIVE';
    return error;
  }

  async function actualInputDeviceId(kind) {
    const local = state.room?.localParticipant;
    const publication = localSourcePublication(local, kind);
    const deviceKind = kind === 'microphone' ? 'audioinput' : 'videoinput';
    let trackDeviceId = '';
    try {
      trackDeviceId = await publication?.track?.getDeviceId?.(false) || '';
    } catch {
      trackDeviceId = '';
    }
    return trackDeviceId
      || publication?.track?.mediaStreamTrack?.getSettings?.().deviceId
      || state.room?.getActiveDevice?.(deviceKind)
      || '';
  }

  async function syncActualInputDevice(kind, expectedDeviceId = '') {
    const deviceKind = kind === 'microphone' ? 'audioinput' : 'videoinput';
    const actualId = await actualInputDeviceId(kind) || expectedDeviceId;
    if (!actualId || actualId === 'default') return;
    await refreshDeviceLists();
    rememberDeviceSelection(deviceKind, actualId);
  }

  async function setLocalSourceEnabled(kind, enabled) {
    const local = state.room?.localParticipant;
    if (!local) throw new Error('The room is not connected.');
    const isMicrophone = kind === 'microphone';
    if (!isMicrophone) {
      await setProtectedCameraEnabled(enabled);
      return;
    }
    const deviceKind = 'audioinput';
    const deviceId = selectedDeviceId(deviceKind);
    const setEnabled = local.setMicrophoneEnabled.bind(local);
    if (!enabled) {
      await setEnabled(false);
      state.microphoneTransport = 'off';
      return;
    }

    const existingPublication = localSourcePublication(local, kind);
    const enableAndVerify = async (options) => {
      state.microphoneTransport = 'checking';
      syncSelfMediaState();
      const publication = await setEnabled(true, options, microphonePublishOptions());
      const verification = await verifyMicrophoneTransport(local, publication);
      state.microphoneTransport = verification;
      return publication || localSourcePublication(local, kind);
    };
    try {
      if (
        existingPublication
        && deviceId
        && state.room.switchActiveDevice
        && state.room.getActiveDevice?.(deviceKind) !== deviceId
      ) {
        await state.room.switchActiveDevice(deviceKind, deviceId, true);
      }
      await enableAndVerify(captureOptions(kind, deviceId));
    } catch (error) {
      if (!isRetryableDeviceError(error)) {
        state.microphoneTransport = 'failed';
        throw error;
      }
      await discardMicrophonePublication(local);
      await refreshDeviceLists();
      try {
        if (state.room.switchActiveDevice) {
          await state.room.switchActiveDevice(deviceKind, 'default', false);
        }
        await enableAndVerify(captureOptions(kind));
      } catch (retryError) {
        state.microphoneTransport = 'failed';
        await discardMicrophonePublication(local);
        throw retryError;
      }
    }
    await syncActualInputDevice(kind);
  }

  async function applySelectedSpeaker() {
    const speakerId = selectedDeviceId('audiooutput');
    if (!speakerId || !state.room?.switchActiveDevice) return;
    await state.room.switchActiveDevice('audiooutput', speakerId, true);
  }

  async function enableInitialMedia() {
    const local = state.room.localParticipant;
    const devices = selectedDeviceOptions();
    const warnings = [];
    // Microphone startup is independent of the video processor and should not
    // wait for segmentation assets or camera initialization.
    if (state.joinWithMicrophone) {
      try {
        await setLocalSourceEnabled('microphone', true);
      } catch {
        warnings.push('microphone');
      }
    }
    if (state.joinWithCamera) {
      try {
        await setLocalSourceEnabled('camera', true);
      } catch {
        warnings.push('camera');
      }
    }
    if (devices.speakerId) {
      await applySelectedSpeaker().catch(() => warnings.push('speaker'));
    }
    if (warnings.length) toast(`The ${warnings.join(' and ')} could not start. You joined with it off.`);
  }

  async function joinRoom() {
    if (state.joining || state.room) return;
    const roomToJoin = selectedRoom();
    if (!roomToJoin?.active) {
      setStatus('sr-prejoin-status', 'Open or choose one of the four Study Rooms before joining.', 'error');
      byId('sr-room-lobby')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return;
    }
    const roomKey = roomToJoin.roomKey;
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
      room = new LiveKit.Room(studyRoomMediaOptions());
      state.room = room;
      if (!installLocalCameraPublishGuard(room)) {
        syncBrandedBackdropState({
          status: 'unavailable',
          supported: false,
          error: 'This browser could not enforce protected camera publication, so video remains off.',
        });
      }
      const audioUnlock = startRoomAudioFromGesture(room);
      const credential = await workerRequest('/admin/study-room/join', { nickname, roomKey });
      if (String(credential.room_key || '') !== roomKey) {
        throw new Error('The secure service returned a different Study Room than the one selected.');
      }
      bindRoomEvents(room);
      await room.connect(credential.server_url, credential.participant_token, {
        autoSubscribe: true,
        maxRetries: 5,
      });
      await audioUnlock;
      state.currentRoomKey = roomKey;
      state.focusStartedAt = Date.parse(credential.focus_started_at || '') || Date.now();
      byId('sr-live-nickname').value = credential.participant_name || nickname;
      byId('sr-active-room-name').textContent = roomPresentation(roomKey).name;
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
      const previousLeaving = state.leaving;
      state.leaving = true;
      try {
        if (state.room === room) await destroyBackgroundController();
        removeLocalCameraPublishGuard(room);
        if (room) await room.disconnect().catch(() => {});
        if (state.room === room) clearConnectedRoomState();
      } finally {
        state.leaving = previousLeaving;
      }
      setStatus(
        'sr-prejoin-status',
        friendlyError(error, 'The Study Room could not connect. Your camera and microphone stayed off.'),
        'error',
      );
      refreshRoomCatalog({ quiet: true }).catch(() => {});
    } finally {
      state.joining = false;
      button.disabled = false;
      syncJoinButton();
    }
  }

  async function toggleLocalTrack(kind) {
    const local = state.room?.localParticipant;
    if (!local) return;
    const button = byId(kind === 'microphone' ? 'sr-toggle-microphone' : 'sr-toggle-camera');
    button.disabled = true;
    startRoomAudioFromGesture();
    try {
      const enabled = !isLocalSourceEnabled(local, kind);
      await setLocalSourceEnabled(kind, enabled);
      renderParticipants();
      toast(kind === 'microphone'
        ? (enabled
          ? state.microphoneTransport === 'sending'
            ? 'Microphone is on and sending audio.'
            : 'Microphone is on. Ask a study partner to confirm audio.'
          : 'Microphone muted.')
        : (enabled ? 'Camera is on.' : 'Camera turned off.'));
    } catch (error) {
      toast(deviceErrorMessage(kind, error));
      syncSelfMediaState();
    } finally {
      if (kind === 'camera') {
        const controller = state.backgroundController;
        syncBrandedBackdropState(controller?.snapshot?.() || controller?.capabilities?.() || {
          status: 'unavailable',
          supported: false,
        });
      } else {
        button.disabled = false;
      }
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
        roomKey: state.currentRoomKey,
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
    const previousDeviceId = selectedDeviceId(kind);
    if (!state.room || !deviceId) {
      rememberDeviceSelection(kind, deviceId);
      return;
    }
    const sourceKind = kind === 'audioinput'
      ? 'microphone'
      : kind === 'videoinput'
      ? 'camera'
      : '';
    const local = state.room.localParticipant;
    const publication = sourceKind ? localSourcePublication(local, sourceKind) : null;
    const previousActualDeviceId = sourceKind
      ? await actualInputDeviceId(sourceKind) || previousDeviceId
      : state.room.getActiveDevice?.(kind) || previousDeviceId;
    const sourceWasLive = sourceKind ? isLocalSourceEnabled(local, sourceKind) : false;
    if (kind === 'videoinput' && !sourceWasLive) {
      rememberDeviceSelection(kind, deviceId);
      toast('Camera selected. The Due Diligence backdrop will be applied before it starts.');
      return;
    }
    if (kind === 'videoinput' && sourceWasLive) {
      try {
        await switchProtectedCameraDevice(deviceId);
        rememberDeviceSelection(kind, deviceId);
        toast('Camera updated with the Due Diligence backdrop protected.');
      } catch (error) {
        let rolledBack = false;
        if (previousActualDeviceId && previousActualDeviceId !== deviceId) {
          try {
            await switchProtectedCameraDevice(previousActualDeviceId);
            rolledBack = true;
          } catch {
            rolledBack = false;
          }
        }
        await refreshDeviceLists();
        rememberDeviceSelection(kind, rolledBack ? previousActualDeviceId : previousDeviceId);
        syncSelfMediaState();
        toast(rolledBack
          ? 'That camera could not start. Your previous protected camera is still active.'
          : deviceErrorMessage('camera', error));
      }
      return;
    }
    try {
      const switched = await state.room.switchActiveDevice(kind, deviceId, true);
      if (!switched) throw new Error('Device switch was not confirmed.');
      if (sourceWasLive && !isLocalSourceEnabled(local, sourceKind)) throw sourceStartError(sourceKind);
      if (sourceKind && sourceWasLive) await syncActualInputDevice(sourceKind);
      else rememberDeviceSelection(kind, deviceId);
      toast('Device updated.');
    } catch {
      let rolledBack = false;
      if (previousActualDeviceId && previousActualDeviceId !== deviceId) {
        try {
          rolledBack = await state.room.switchActiveDevice(kind, previousActualDeviceId, true) !== false;
        } catch {
          rolledBack = false;
        }
      }
      await refreshDeviceLists();
      rememberDeviceSelection(kind, rolledBack ? previousActualDeviceId : previousDeviceId);
      if (sourceKind) syncSelfMediaState();
      const sourceStillLive = sourceKind && isLocalSourceEnabled(local, sourceKind);
      toast(
        rolledBack && (!sourceWasLive || sourceStillLive)
          ? 'That device could not start. Your previous device is still active.'
          : sourceWasLive && !sourceStillLive
          ? `That device could not start, and your previous ${sourceKind} could not restart. ${sourceKind === 'microphone' ? 'Your microphone' : 'Your camera'} is off.`
          : 'That device could not be selected. It may be in use or unavailable.',
      );
    }
  }

  function clearConnectedRoomState() {
    state.room = null;
    state.currentRoomKey = '';
    state.focusStartedAt = null;
    state.audioPlaybackBlocked = false;
    state.microphoneTransport = 'off';
    state.blockedParticipants.clear();
    state.localMutedParticipants.clear();
    state.participantVolumes.clear();
    state.activeSpeakers.clear();
  }

  async function disconnectConnectedRoom() {
    const room = state.room;
    global.clearInterval(state.focusTimer);
    state.focusTimer = 0;
    detachTracks();
    await destroyBackgroundController();
    removeLocalCameraPublishGuard(room);
    try {
      await room?.disconnect?.();
    } catch {
      // LiveKit stops any remaining local media during page shutdown or reconnect.
    }
    if (state.room === room) clearConnectedRoomState();
  }

  async function switchToRoom(roomKey) {
    const target = activeRoom(roomKey);
    const selector = byId('sr-room-selector');
    const menu = byId('sr-room-selector-menu');
    if (menu) menu.hidden = true;
    if (selector) selector.setAttribute('aria-expanded', 'false');
    if (!target) {
      toast('That Study Room is no longer open.');
      await refreshRoomCatalog({ quiet: true }).catch(() => {});
      return;
    }
    if (!state.room) {
      selectRoom(target.roomKey);
      return;
    }
    if (target.roomKey === state.currentRoomKey || state.switchingRoom) return;

    const local = state.room.localParticipant;
    const resumeMicrophone = isLocalSourceEnabled(local, 'microphone');
    const resumeCamera = isLocalSourceEnabled(local, 'camera');
    state.switchingRoom = true;
    state.leaving = true;
    toast(`Moving to ${roomPresentation(target.roomKey).name}…`);
    try {
      await disconnectConnectedRoom();
      state.selectedRoomKey = target.roomKey;
      state.joinWithMicrophone = resumeMicrophone;
      state.joinWithCamera = resumeCamera;
      byId('sr-live-room').hidden = true;
      byId('sr-prejoin').hidden = false;
      renderRoomCatalog();
    } finally {
      state.leaving = false;
      state.switchingRoom = false;
    }
    await joinRoom();
  }

  async function leaveRoom() {
    if (state.leaving) return;
    state.leaving = true;
    byId('sr-leave').disabled = true;
    await disconnectConnectedRoom();
    stopDeviceTest();
    global.clearInterval(state.roomRefreshTimer);
    global.close();
    global.setTimeout(() => {
      if (!global.closed) global.location.replace('../#quorum');
    }, 150);
  }

  function createLocalQualityPreview() {
    const cameraSource = LiveKit?.Track?.Source?.Camera || 'camera';
    const previewPeople = [
      { identity: 'sr_localqualitypreview0000', name: 'Dimasalang', image: '../assets/study-room/dimasalang-library.webp', isLocal: true },
      { identity: 'sr_previewparticipant00002', name: 'Participant 2', image: '../assets/study-room/participant-2-tropical.webp' },
      { identity: 'sr_previewparticipant00003', name: 'Participant 3', image: '../assets/study-room/participant-3-bedroom.webp' },
      { identity: 'sr_previewparticipant00004', name: 'Participant 4', image: '../assets/study-room/participant-4-condo.webp' },
    ];
    const participants = previewPeople.map((person) => {
      const track = {
        mediaStreamTrack: {
          readyState: 'live',
          enabled: true,
          muted: false,
          getSettings: () => ({ deviceId: 'quality-preview-camera' }),
        },
        attach() {
          const image = document.createElement('img');
          image.src = person.image;
          image.alt = '';
          image.setAttribute('aria-hidden', 'true');
          return image;
        },
        detach(element) {
          element?.remove?.();
        },
      };
      const publication = {
        source: cameraSource,
        isMuted: false,
        track,
        __studyRoomStaticPreview: true,
      };
      const trackPublications = new Map([[cameraSource, publication]]);
      return {
        identity: person.identity,
        name: person.name,
        isLocal: person.isLocal === true,
        trackPublications,
        getTrackPublication: (source) => trackPublications.get(source) || null,
        setMicrophoneEnabled: async () => {},
        setVolume: () => {},
      };
    });
    const [local, ...remote] = participants;
    state.room = {
      localParticipant: local,
      remoteParticipants: new Map(remote.map((participant) => [participant.identity, participant])),
      connectionState: 'connected',
      canPlaybackAudio: true,
    };
    state.selectedRoomKey = '1';
    state.currentRoomKey = '1';
    state.focusStartedAt = Date.now() - 48 * 60 * 1000 - 32 * 1000;
    byId('sr-live-nickname').value = local.name;
    byId('sr-active-room-name').textContent = roomPresentation('1').name;
    byId('sr-prejoin').hidden = true;
    byId('sr-live-room').hidden = false;
    syncBrandedBackdropState({ status: 'enabled', supported: true });
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
      byId('sr-open-devices').setAttribute('aria-expanded', String(!drawer.hidden));
      byId('sr-open-devices').textContent = drawer.hidden ? 'Choose devices' : 'Hide device settings';
    });
    byId('sr-dock-devices').addEventListener('click', () => {
      byId('sr-device-drawer').hidden = false;
      byId('sr-open-devices').textContent = 'Hide device settings';
      byId('sr-open-devices').setAttribute('aria-expanded', 'true');
      byId('sr-dock-devices').setAttribute('aria-expanded', 'true');
      byId('sr-device-drawer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    byId('sr-room-selector').addEventListener('click', () => {
      const menu = byId('sr-room-selector-menu');
      menu.hidden = !menu.hidden;
      byId('sr-room-selector').setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector?.('[aria-selected="true"]')?.focus?.();
    });
    byId('sr-nickname-form').addEventListener('submit', updateNickname);
    byId('sr-camera-select').addEventListener('change', (event) => {
      rememberDeviceSelection('videoinput', event.target.value);
    });
    byId('sr-microphone-select').addEventListener('change', (event) => {
      rememberDeviceSelection('audioinput', event.target.value);
    });
    byId('sr-speaker-select').addEventListener('change', (event) => {
      rememberDeviceSelection('audiooutput', event.target.value);
    });
    byId('sr-live-camera-select').addEventListener('change', (event) => switchDevice('videoinput', event.target));
    byId('sr-live-microphone-select').addEventListener('change', (event) => switchDevice('audioinput', event.target));
    byId('sr-live-speaker-select').addEventListener('change', (event) => switchDevice('audiooutput', event.target));
    byId('sr-leave').addEventListener('click', leaveRoom);
    byId('sr-audio-prompt').addEventListener('click', async () => {
      const started = await startRoomAudioFromGesture();
      if (!started) {
        toast('Your browser still blocked room audio. Check the site sound permission.');
      }
    });
    global.addEventListener('pagehide', () => {
      state.leaving = true;
      stopDeviceTest();
      global.clearInterval(state.roomRefreshTimer);
      const room = state.room;
      destroyBackgroundController().catch(() => {});
      removeLocalCameraPublishGuard(room);
      room?.disconnect?.();
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
        state.access = { allowed: true, role: 'admin', maxRooms: 4, maxParticipants: 12 };
        state.rooms = localQualityRoomCatalog();
        state.selectedRoomKey = state.rooms.find((room) => room.active)?.roomKey || '';
      } else {
        await createAuthClient();
        state.access = await workerRequest('/admin/study-room/access');
        // Device discovery and the audio-only join path must not wait on a slow
        // room-catalog endpoint. Render the four fixed slots immediately and
        // refresh their active state in parallel.
        state.rooms = normalizeRoomCatalog({ rooms: [] });
        state.selectedRoomKey = '';
      }
      showExperience();
      renderRoomCatalog();
      if (!LOCAL_TEST_MODE) {
        refreshRoomCatalog({ quiet: true }).catch((error) => {
          setStatus('sr-prejoin-status', friendlyError(error, 'The Study Room list could not refresh.'), 'error');
        });
      }
      try {
        ensureBackgroundController();
      } catch {
        // Video fails closed, while room access and audio remain available.
      }
      bindDeviceChangeDetection();
      await discoverDevices();
      startRoomCatalogRefresh();
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
    mediaReliabilityVersion: MEDIA_RELIABILITY_VERSION,
    normalizeNickname,
    verifyAccess,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
