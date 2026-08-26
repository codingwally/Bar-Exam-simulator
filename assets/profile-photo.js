(function dueDiligenceProfilePhoto(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  if (!config?.workerUrl) return;

  const SOURCE_BYTES = 20 * 1024 * 1024;
  const UPLOAD_BYTES = 3 * 1024 * 1024;
  const SIGNED_URL_FALLBACK_LIFETIME_MS = 13 * 60 * 1000;
  const SIGNED_URL_EXPIRY_SKEW_MS = 30 * 1000;
  const EMPTY_PROFILE_CACHE_MS = 5 * 60 * 1000;
  const IMAGE_REFRESH_BACKOFF_MS = 60 * 1000;
  const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const state = {
    userId: '',
    profile: null,
    expiresAt: 0,
    pending: null,
    pendingUserId: '',
    requestSequence: 0,
    mutationSequence: 0,
    activeMutationSequence: 0,
    refreshAttemptedPath: '',
    refreshAttemptedAt: 0,
  };

  function currentSession() {
    return global.DueDiligencePhase2?.getSession?.() || null;
  }

  function currentUserId() {
    return String(currentSession()?.user?.id || '').trim();
  }

  function profilePhotoError(code, message, status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function dispatchProfilePhoto(profile, reason) {
    if (typeof global.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') return;
    global.dispatchEvent(new global.CustomEvent('duediligence:profile-photo', {
      detail: {
        userId: state.userId || null,
        profile: profile ? { ...profile } : null,
        reason,
      },
    }));
  }

  function resetForSession(userId = '') {
    const normalizedUserId = String(userId || '').trim();
    if (state.userId === normalizedUserId) return false;
    state.userId = normalizedUserId;
    state.profile = null;
    state.expiresAt = 0;
    state.pending = null;
    state.pendingUserId = '';
    state.requestSequence += 1;
    state.mutationSequence += 1;
    state.activeMutationSequence = 0;
    state.refreshAttemptedPath = '';
    state.refreshAttemptedAt = 0;
    dispatchProfilePhoto(null, 'session');
    return true;
  }

  function ensureCurrentIdentity() {
    const userId = currentUserId();
    if (!userId || !currentSession()?.access_token) {
      resetForSession('');
      throw profilePhotoError('AUTHENTICATION_REQUIRED', 'Sign in to manage your profile photo.', 401);
    }
    if (state.userId !== userId) resetForSession(userId);
    return userId;
  }

  function requestId() {
    return global.crypto?.randomUUID?.().replace(/-/g, '')
      || `${Date.now().toString(36)}${global.Math.random().toString(36).slice(2)}`;
  }

  async function quorumRequest(path, body, expectedUserId, options = {}) {
    const activeSession = currentSession();
    if (!activeSession?.access_token || String(activeSession.user?.id || '') !== expectedUserId) {
      throw profilePhotoError(
        'PROFILE_PHOTO_SESSION_CHANGED',
        'The signed-in account changed before the profile photo request completed.',
        409,
      );
    }
    if (global.navigator?.onLine === false) {
      throw profilePhotoError('OFFLINE', 'You appear to be offline. Reconnect and try again.');
    }
    const response = await global.fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeSession.access_token}`,
        'X-Request-ID': requestId(),
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const code = payload?.error?.code
        || (response.status === 401 ? 'AUTHENTICATION_REQUIRED' : 'PROFILE_PHOTO_UNAVAILABLE');
      if (response.status === 401 && options.authRetry !== false) {
        const refreshed = await global.DueDiligencePhase2?.refreshSession?.().catch(() => null);
        if (refreshed?.access_token && String(refreshed.user?.id || '') === expectedUserId) {
          return quorumRequest(path, body, expectedUserId, { authRetry: false });
        }
      }
      throw profilePhotoError(
        code,
        payload?.error?.message || 'Your profile photo could not be updated. Please try again.',
        response.status,
      );
    }
    if (currentUserId() !== expectedUserId) {
      throw profilePhotoError(
        'PROFILE_PHOTO_SESSION_CHANGED',
        'The signed-in account changed before the profile photo request completed.',
        409,
      );
    }
    return payload.data || {};
  }

  function signedUrlExpiresAt(value, now = Date.now()) {
    try {
      const token = new global.URL(String(value || ''), global.location?.origin || 'https://duediligence.ph')
        .searchParams.get('token');
      const encodedPayload = String(token || '').split('.')[1];
      if (!encodedPayload) return now + SIGNED_URL_FALLBACK_LIFETIME_MS;
      const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const payload = JSON.parse(global.atob(padded));
      const expiresAt = Number(payload?.exp) * 1000;
      return Number.isFinite(expiresAt) && expiresAt > 0
        ? expiresAt
        : now + SIGNED_URL_FALLBACK_LIFETIME_MS;
    } catch {
      return now + SIGNED_URL_FALLBACK_LIFETIME_MS;
    }
  }

  function normalizeProfile(profile) {
    return Object.freeze({
      avatarUrl: String(profile?.avatarUrl || '').trim() || null,
      displayName: String(profile?.displayName || profile?.display_name || '').trim()
        || String(currentSession()?.user?.user_metadata?.full_name
          || currentSession()?.user?.user_metadata?.name
          || '').trim()
        || 'Due Diligence Member',
      memberId: String(profile?.memberId || '').trim() || null,
    });
  }

  function avatarObjectPath(value) {
    try {
      return new global.URL(String(value || ''), global.location?.origin || 'https://duediligence.ph')
        .pathname;
    } catch {
      return '';
    }
  }

  function remember(profile, options = {}) {
    const expectedUserId = String(options.userId || currentUserId()).trim();
    if (!expectedUserId || expectedUserId !== currentUserId()) {
      throw profilePhotoError(
        'PROFILE_PHOTO_SESSION_CHANGED',
        'The signed-in account changed before the profile photo could be displayed.',
        409,
      );
    }
    if (state.userId !== expectedUserId) resetForSession(expectedUserId);
    const normalized = normalizeProfile(profile);
    const now = Date.now();
    state.profile = normalized;
    if (options.reason === 'uploaded' || !normalized.avatarUrl) {
      state.refreshAttemptedPath = '';
      state.refreshAttemptedAt = 0;
    }
    state.expiresAt = normalized.avatarUrl
      ? Math.max(now, signedUrlExpiresAt(normalized.avatarUrl, now) - SIGNED_URL_EXPIRY_SKEW_MS)
      : now + EMPTY_PROFILE_CACHE_MS;
    dispatchProfilePhoto(normalized, options.reason || 'loaded');
    return normalized;
  }

  async function load(options = {}) {
    const userId = ensureCurrentIdentity();
    const now = Date.now();
    if (options.force !== true && state.profile && now < state.expiresAt) return state.profile;
    if (state.pending && state.pendingUserId === userId) return state.pending;

    const sequence = ++state.requestSequence;
    const mutationSequence = state.mutationSequence;
    const pending = (async () => {
      const profile = await quorumRequest(
        '/quorum/query',
        { operation: 'profile', payload: {} },
        userId,
      );
      if (sequence !== state.requestSequence
          || mutationSequence !== state.mutationSequence
          || state.activeMutationSequence !== 0
          || currentUserId() !== userId) {
        throw profilePhotoError(
          'PROFILE_PHOTO_SESSION_CHANGED',
          'The signed-in account changed before the profile photo could be displayed.',
          409,
        );
      }
      return remember(profile, { userId, reason: options.reason || 'loaded' });
    })();
    state.pending = pending;
    state.pendingUserId = userId;
    try {
      return await pending;
    } finally {
      if (state.pending === pending) {
        state.pending = null;
        state.pendingUserId = '';
      }
    }
  }

  function initials(value) {
    return String(value || 'Due Diligence Member')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || 'DD';
  }

  function render(container, profile, options = {}) {
    if (!container) return null;
    const normalized = normalizeProfile(profile || state.profile || {});
    const fallbackText = String(options.initials || initials(normalized.displayName)).trim() || 'DD';
    const expectedUserId = currentUserId();
    let retryAttempted = false;
    let fallbackNotified = false;

    const showFallback = (reason = '') => {
      container.classList?.remove('has-profile-photo');
      container.replaceChildren?.();
      container.textContent = fallbackText;
      if (options.decorative === true) {
        container.setAttribute?.('aria-hidden', 'true');
        container.removeAttribute?.('aria-label');
      } else {
        container.removeAttribute?.('aria-hidden');
        container.setAttribute?.('aria-label', options.fallbackLabel || `${normalized.displayName} initials`);
      }
      if (reason && !fallbackNotified && typeof options.onFallback === 'function') {
        fallbackNotified = true;
        options.onFallback(reason);
      }
    };

    if (!normalized.avatarUrl) {
      showFallback();
      return { image: null, showFallback };
    }

    const image = global.document.createElement('img');
    image.alt = options.decorative === true
      ? ''
      : (options.alt || `${normalized.displayName} profile photo`);
    image.decoding = 'async';
    image.addEventListener('load', () => {
      if (container.firstElementChild !== image) return;
      const imagePath = avatarObjectPath(image.src);
      if (currentUserId() === expectedUserId
          && imagePath
          && imagePath === state.refreshAttemptedPath) {
        state.refreshAttemptedPath = '';
        state.refreshAttemptedAt = 0;
      }
    });
    image.addEventListener('error', async () => {
      if (container.firstElementChild !== image || currentUserId() !== expectedUserId) {
        return;
      }
      if (retryAttempted || options.refreshOnError === false) {
        showFallback('image-error');
        return;
      }
      const imagePath = avatarObjectPath(image.src);
      if (imagePath
          && imagePath === state.refreshAttemptedPath
          && Date.now() - state.refreshAttemptedAt < IMAGE_REFRESH_BACKOFF_MS) {
        showFallback('image-error');
        return;
      }
      retryAttempted = true;
      state.refreshAttemptedPath = imagePath;
      state.refreshAttemptedAt = Date.now();
      try {
        const refreshed = await load({ force: true, reason: 'url-refresh' });
        if (container.firstElementChild !== image
            || currentUserId() !== expectedUserId
            || !refreshed.avatarUrl
            || refreshed.avatarUrl === image.src) {
          showFallback('image-error');
          return;
        }
        image.src = refreshed.avatarUrl;
      } catch {
        if (container.firstElementChild === image && currentUserId() === expectedUserId) {
          showFallback('image-error');
        }
      }
    });
    image.src = normalized.avatarUrl;
    container.classList?.add('has-profile-photo');
    container.replaceChildren?.(image);
    if (options.decorative === true) {
      container.setAttribute?.('aria-hidden', 'true');
      container.removeAttribute?.('aria-label');
    } else {
      container.removeAttribute?.('aria-hidden');
      container.setAttribute?.('aria-label', options.alt || `${normalized.displayName} profile photo`);
    }
    return { image, showFallback };
  }

  async function bytesPayload(blob) {
    if (!blob || !acceptedMimeTypes.has(blob.type) || blob.size < 1 || blob.size > UPLOAD_BYTES) {
      throw profilePhotoError(
        'INVALID_PROFILE_PHOTO',
        'The optimized profile photo must be a JPEG, PNG, or WebP image no larger than 3 MB.',
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return { mimeType: blob.type, dataBase64: global.btoa(binary) };
  }

  async function imageBitmap(file) {
    if (typeof global.createImageBitmap === 'function') return global.createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const image = new global.Image();
      const objectUrl = global.URL.createObjectURL(file);
      image.onload = () => {
        global.URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        global.URL.revokeObjectURL(objectUrl);
        reject(profilePhotoError(
          'INVALID_PROFILE_PHOTO',
          'This photo could not be opened. Choose another JPEG, PNG, or WebP image.',
        ));
      };
      image.src = objectUrl;
    });
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  async function optimize(file) {
    if (!file || !acceptedMimeTypes.has(file.type) || file.size < 1 || file.size > SOURCE_BYTES) {
      throw profilePhotoError(
        'INVALID_PROFILE_PHOTO',
        'Choose a JPEG, PNG, or WebP profile photo no larger than 20 MB.',
      );
    }
    const bitmap = await imageBitmap(file);
    try {
      if (bitmap.width < 256 || bitmap.height < 256) {
        throw profilePhotoError(
          'INVALID_PROFILE_PHOTO',
          'Choose a profile photo at least 256 pixels wide and tall.',
        );
      }
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(256, Math.round(bitmap.width * scale));
      const height = Math.max(256, Math.round(bitmap.height * scale));
      const canvas = global.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        throw profilePhotoError('INVALID_PROFILE_PHOTO', 'This browser could not prepare the selected photo.');
      }
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      let blob = null;
      for (const quality of [0.88, 0.8, 0.72, 0.64]) {
        blob = await canvasBlob(canvas, quality);
        if (blob?.size && blob.size <= UPLOAD_BYTES) break;
      }
      if (!blob || blob.size < 1 || blob.size > UPLOAD_BYTES) {
        throw profilePhotoError(
          'INVALID_PROFILE_PHOTO',
          'This photo is too large after optimization. Choose a smaller photo.',
        );
      }
      const payload = await bytesPayload(blob);
      return { ...payload, width, height, cropX: 0.5, cropY: 0.5 };
    } finally {
      bitmap.close?.();
    }
  }

  async function upload(file) {
    const userId = ensureCurrentIdentity();
    const mutationSequence = ++state.mutationSequence;
    state.activeMutationSequence = mutationSequence;
    state.requestSequence += 1;
    state.pending = null;
    state.pendingUserId = '';
    try {
      const profileImage = await optimize(file);
      if (mutationSequence !== state.mutationSequence || currentUserId() !== userId) {
        throw profilePhotoError(
          'PROFILE_PHOTO_SESSION_CHANGED',
          'The signed-in account changed before the profile photo could be uploaded.',
          409,
        );
      }
      const result = await quorumRequest('/quorum/command', {
        operation: 'set_profile_avatar',
        payload: {},
        profileImage,
      }, userId);
      if (mutationSequence !== state.mutationSequence || currentUserId() !== userId) {
        throw profilePhotoError(
          'PROFILE_PHOTO_SESSION_CHANGED',
          'A newer profile photo change completed before this upload. Refresh your profile to review the current photo.',
          409,
        );
      }
      return remember({
        ...(state.profile || {}),
        avatarUrl: result.avatarUrl || null,
      }, { userId, reason: 'uploaded' });
    } finally {
      if (state.activeMutationSequence === mutationSequence) {
        state.activeMutationSequence = 0;
        state.requestSequence += 1;
        state.pending = null;
        state.pendingUserId = '';
      }
    }
  }

  async function remove() {
    const userId = ensureCurrentIdentity();
    const mutationSequence = ++state.mutationSequence;
    state.activeMutationSequence = mutationSequence;
    state.requestSequence += 1;
    state.pending = null;
    state.pendingUserId = '';
    try {
      await quorumRequest('/quorum/command', {
        operation: 'remove_profile_avatar',
        payload: {},
      }, userId);
      if (mutationSequence !== state.mutationSequence || currentUserId() !== userId) {
        throw profilePhotoError(
          'PROFILE_PHOTO_SESSION_CHANGED',
          'A newer profile photo change completed before this removal. Refresh your profile to review the current photo.',
          409,
        );
      }
      return remember({
        ...(state.profile || {}),
        avatarUrl: null,
      }, { userId, reason: 'removed' });
    } finally {
      if (state.activeMutationSequence === mutationSequence) {
        state.activeMutationSequence = 0;
        state.requestSequence += 1;
        state.pending = null;
        state.pendingUserId = '';
      }
    }
  }

  global.addEventListener?.('duediligence:session', (event) => {
    resetForSession(event.detail?.authenticated === true ? event.detail?.userId : '');
  });

  global.DueDiligenceProfilePhoto = Object.freeze({
    SOURCE_BYTES,
    UPLOAD_BYTES,
    current: (userId = currentUserId()) => (
      String(userId || '').trim() === state.userId ? state.profile : null
    ),
    initials,
    load,
    optimize,
    remember,
    remove,
    render,
    resetForSession,
    signedUrlExpiresAt,
    upload,
  });
}(window));
