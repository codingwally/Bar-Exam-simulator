(function dueDiligenceAdminPulse(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const PULSE_REFRESH_MS = 30_000;
  const GOOGLE_IDENTITY_TIMEOUT_MS = 7_000;
  const GOOGLE_WEB_CLIENT_ID = '601805240028-vgnu9dv3egpm7n6musiveujfp3c9vs5q.apps.googleusercontent.com';
  const SERVICE_WORKER_URL = '/service-worker.js?v=admin-pulse-pilot-20260830-1';
  const ADMIN_PULSE_CALLBACK_PATH = '/admin-pulse/?auth=callback';
  const EVENT_DEFINITIONS = Object.freeze({
    new_subscriber: Object.freeze({
      label: 'New subscriber',
      icon: '/assets/icons/navigation/circle-user-round.svg',
      tone: 'subscriber',
    }),
    home_wall_post: Object.freeze({
      label: 'Home Wall post',
      icon: '/assets/icons/navigation/pen-line.svg',
      tone: 'post',
    }),
    support_request: Object.freeze({
      label: 'Support request',
      icon: '/assets/icons/navigation/headphones.svg',
      tone: 'support',
    }),
    user_active: Object.freeze({
      label: 'Live user',
      icon: '/assets/icons/navigation/users.svg',
      tone: 'live',
    }),
    new_sign_in: Object.freeze({
      label: 'New sign-in',
      icon: '/assets/icons/navigation/door-open.svg',
      tone: 'signin',
    }),
  });

  const state = {
    client: null,
    session: null,
    authorization: null,
    pulseEnabled: false,
    vapidPublicKey: '',
    serverSubscribed: false,
    confirmedPushEndpoint: '',
    snapshot: null,
    events: [],
    filter: null,
    refreshTimer: null,
    refreshInFlight: false,
    canSignIn: true,
    googleNonce: null,
    googleServicesPromise: null,
    googleRenderGeneration: 0,
    googleSignInBusy: false,
    targetEventId: new URLSearchParams(global.location.search).get('event') || '',
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function isIosDevice() {
    return /iPad|iPhone|iPod/u.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandaloneApp() {
    return global.matchMedia?.('(display-mode: standalone)')?.matches === true
      || navigator.standalone === true;
  }

  function isIosSafariBrowser() {
    if (!isIosDevice() || isStandaloneApp()) return false;
    return /Safari/u.test(navigator.userAgent)
      && !/CriOS|FxiOS|EdgiOS|OPiOS/u.test(navigator.userAgent);
  }

  function updateIosInstallGuidance() {
    const showSafariGuide = isIosSafariBrowser();
    $('#ios-install-guide').hidden = !showSafariGuide;
    const banner = $('#pilot-banner');
    if (!banner) return;
    banner.hidden = !showSafariGuide || !state.session?.access_token;
    if (!banner.hidden) {
      banner.textContent = 'For iPhone notifications, tap Share, choose Add to Home Screen, then open DD Pulse. Select your Google email in the installed app and enable important notifications.';
    }
  }

  function uuidKey() {
    return global.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizedText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function normalizedEventType(value) {
    const eventType = normalizedText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(EVENT_DEFINITIONS, eventType)
      ? eventType
      : 'unknown';
  }

  function eventDefinition(eventType) {
    return EVENT_DEFINITIONS[eventType] || Object.freeze({
      label: 'Website update',
      icon: '/assets/icons/navigation/bell.svg',
      tone: 'notification',
    });
  }

  function validDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatRelativeTime(value) {
    const date = validDate(value);
    if (!date) return 'Time unavailable';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const absoluteSeconds = Math.abs(seconds);
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (absoluteSeconds < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 7) return formatter.format(days, 'day');
    return new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);
  }

  function formatExactTime(value) {
    const date = validDate(value);
    if (!date) return 'Time unavailable';
    return new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function setConnection(stateName, label) {
    const pill = $('#connection-pill');
    if (pill) pill.dataset.state = stateName;
    if ($('#connection-label')) $('#connection-label').textContent = label;
  }

  function showAccessStatus(message, tone = '') {
    const status = $('#access-status');
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function googleIdentityModule() {
    return global.DueDiligenceAdminPulseGoogleIdentity || null;
  }

  function googleServicesAvailable() {
    return Boolean(global.google?.accounts?.id?.initialize
      && global.google?.accounts?.id?.renderButton);
  }

  function waitForGoogleIdentityServices() {
    if (googleServicesAvailable()) return Promise.resolve(true);
    if (state.googleServicesPromise) return state.googleServicesPromise;
    const script = $('#google-gis-client');
    state.googleServicesPromise = new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (available) => {
        if (settled) return;
        settled = true;
        if (timer) global.clearTimeout(timer);
        script?.removeEventListener('load', handleLoad);
        script?.removeEventListener('error', handleError);
        resolve(available);
      };
      const handleLoad = () => finish(googleServicesAvailable());
      const handleError = () => finish(false);
      script?.addEventListener('load', handleLoad, { once: true });
      script?.addEventListener('error', handleError, { once: true });
      timer = global.setTimeout(
        () => finish(googleServicesAvailable()),
        GOOGLE_IDENTITY_TIMEOUT_MS,
      );
    });
    return state.googleServicesPromise;
  }

  function offerGoogleRedirectFallback({ gisUsable = false } = {}) {
    const allowFallback = googleIdentityModule()?.shouldOfferRedirectFallback?.({
      isIos: isIosDevice(),
      gisAvailable: gisUsable,
    }) === true;
    $('#google-signin-container').hidden = true;
    $('#google-signin-fallback').hidden = !allowFallback;
    if (allowFallback) {
      showAccessStatus(
        'The direct Google sign-in button could not load. You can continue through the browser instead.',
        'notice',
      );
      return;
    }
    showAccessStatus(
      'Google sign-in could not load. Check your connection, turn off content blocking for this page, and reload Pulse.',
      'error',
    );
  }

  async function handleGoogleCredential(response, rawNonce, generation) {
    if (generation !== state.googleRenderGeneration
        || state.googleSignInBusy
        || state.googleNonce?.raw !== rawNonce) return;
    state.googleSignInBusy = true;
    state.googleNonce = null;
    $('#google-signin-container').hidden = true;
    $('#google-signin-fallback').hidden = true;
    showAccessStatus('Confirming your Google email…', 'notice');
    try {
      const { data, error } = await googleIdentityModule().exchangeCredential({
        client: state.client,
        credential: response?.credential,
        rawNonce,
      });
      if (error) throw error;
      state.session = data?.session || state.session;
      if (!state.session?.access_token) {
        const current = await state.client.auth.getSession();
        if (current.error) throw current.error;
        state.session = current.data?.session || null;
      }
      if (!state.session?.access_token) {
        throw new Error('Google sign-in completed without an administrator session.');
      }
      showAccessStatus('Confirming your administrator role…', 'notice');
      await authorizeSession();
    } catch (error) {
      if (!state.session?.access_token) {
        showAccess({
          status: error?.message || 'Google sign-in could not be completed. Please try again.',
          tone: 'error',
          canSignIn: true,
        });
      }
    } finally {
      state.googleSignInBusy = false;
    }
  }

  async function prepareGoogleSignIn(generation = state.googleRenderGeneration) {
    if (!state.canSignIn || !state.client || state.googleSignInBusy) return;
    const identity = googleIdentityModule();
    if (!identity?.createNonce || !identity?.exchangeCredential) {
      offerGoogleRedirectFallback();
      return;
    }
    $('#google-signin-container').hidden = true;
    $('#google-signin-fallback').hidden = true;
    const available = await waitForGoogleIdentityServices();
    if (generation !== state.googleRenderGeneration || !state.canSignIn) return;
    if (!available) {
      offerGoogleRedirectFallback();
      return;
    }
    try {
      const nonce = await identity.createNonce();
      if (generation !== state.googleRenderGeneration || !state.canSignIn) return;
      const container = $('#google-signin-container');
      const width = Math.max(200, Math.min(330, Math.floor(container.clientWidth || 330)));
      container.replaceChildren();
      global.google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: (response) => handleGoogleCredential(response, nonce.raw, generation),
        nonce: nonce.hashed,
        ux_mode: 'popup',
        itp_support: true,
        auto_select: false,
        use_fedcm_for_button: true,
      });
      global.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width,
      });
      state.googleNonce = nonce;
      container.hidden = false;
    } catch {
      offerGoogleRedirectFallback();
    }
  }

  function showAccess({
    title = 'Website Pulse',
    copy = 'See new subscribers, Home Wall posts, support requests, live users, and new sign-ins in one calm view.',
    status = '',
    tone = '',
    canSignIn = true,
    canSwitchAccount = false,
  } = {}) {
    clearRefreshTimer();
    state.canSignIn = canSignIn;
    state.googleRenderGeneration += 1;
    $('#pulse-shell').hidden = true;
    $('#access-card').hidden = false;
    $('#access-title').textContent = title;
    $('#access-copy').textContent = copy;
    $('#google-signin-container').hidden = true;
    $('#google-signin-fallback').hidden = true;
    $('#google-signin-fallback').disabled = false;
    $('#google-button-label').textContent = 'Continue with Google in browser';
    $('#access-signout').hidden = !canSwitchAccount;
    showAccessStatus(status, tone);
    updateIosInstallGuidance();
    if (canSignIn) void prepareGoogleSignIn(state.googleRenderGeneration);
  }

  function showPulse() {
    $('#access-card').hidden = true;
    $('#pulse-shell').hidden = false;
    updateIosInstallGuidance();
  }

  function clearRefreshTimer() {
    if (state.refreshTimer) global.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    state.refreshTimer = global.setInterval(() => {
      if (!document.hidden && navigator.onLine) refreshPulse({ quiet: true });
    }, PULSE_REFRESH_MS);
  }

  async function api(path, body = {}) {
    const token = state.session?.access_token;
    if (!token) throw new Error('Administrator sign-in is required.');
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': uuidKey(),
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(
        payload?.error?.message
        || (response.status === 401 || response.status === 403
          ? 'This account is not authorized for Website Pulse.'
          : 'Website Pulse could not be reached.'),
      );
      error.code = payload?.error?.code || '';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function accountName() {
    const user = state.session?.user || {};
    return normalizedText(
      user.user_metadata?.full_name
      || user.user_metadata?.name
      || user.email,
      'Administrator',
    );
  }

  function accountRole() {
    return normalizedText(state.authorization?.role, 'administrator')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function updateAccountCopy() {
    $('#account-name').textContent = accountName();
    $('#account-role').textContent = accountRole();
  }

  function normalizeEvents(events) {
    if (!Array.isArray(events)) return [];
    const seen = new Set();
    return events
      .map((event) => {
        const id = normalizedText(event?.id);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        const eventType = normalizedEventType(event?.eventType);
        return {
          id,
          eventType,
          occurredAt: normalizedText(event?.occurredAt),
          title: normalizedText(event?.title, eventDefinition(eventType).label),
          summary: normalizedText(event?.summary, 'Open Website Pulse for the latest details.'),
          url: normalizedText(event?.url),
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftTime = validDate(left.occurredAt)?.getTime() || 0;
        const rightTime = validDate(right.occurredAt)?.getTime() || 0;
        return rightTime - leftTime;
      });
  }

  function iconForEvent(eventType) {
    const definition = eventDefinition(eventType);
    const wrapper = document.createElement('span');
    wrapper.className = `signal-icon signal-${definition.tone}`;
    wrapper.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = definition.icon;
    image.width = 22;
    image.height = 22;
    image.alt = '';
    wrapper.append(image);
    return wrapper;
  }

  function updateSignalCounts() {
    for (const eventType of Object.keys(EVENT_DEFINITIONS)) {
      const count = state.events.filter((event) => event.eventType === eventType).length;
      const target = document.querySelector(`[data-signal-count="${eventType}"]`);
      if (target) target.textContent = String(count);
    }
  }

  function highlightTargetEvent() {
    if (!state.targetEventId) return;
    const target = [...document.querySelectorAll('.feed-item')]
      .find((item) => item.dataset.eventId === state.targetEventId);
    if (!target) return;
    target.classList.add('is-targeted');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderEvents() {
    const feed = $('#activity-feed');
    const feedState = $('#feed-state');
    const visibleEvents = state.filter
      ? state.events.filter((event) => event.eventType === state.filter)
      : state.events;
    feed.replaceChildren();
    if (!visibleEvents.length) {
      const label = state.filter ? eventDefinition(state.filter).label.toLowerCase() : 'important activity';
      feedState.textContent = `No ${label} updates are in the current feed.`;
      feedState.hidden = false;
      delete feedState.dataset.tone;
      return;
    }
    feedState.hidden = true;
    for (const event of visibleEvents) {
      const definition = eventDefinition(event.eventType);
      const item = document.createElement('li');
      item.className = 'feed-item';
      item.dataset.eventId = event.id;
      item.append(iconForEvent(event.eventType));

      const body = document.createElement('div');
      body.className = 'feed-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'feed-title-row';
      const title = document.createElement('strong');
      title.textContent = event.title;
      const type = document.createElement('span');
      type.className = 'feed-type';
      type.textContent = definition.label;
      titleRow.append(title, type);
      const summary = document.createElement('p');
      summary.className = 'feed-summary';
      summary.textContent = event.summary;
      body.append(titleRow, summary);

      const time = document.createElement('time');
      time.className = 'feed-time';
      time.dateTime = event.occurredAt;
      time.title = formatExactTime(event.occurredAt);
      time.textContent = formatRelativeTime(event.occurredAt);
      item.append(body, time);
      feed.append(item);
    }
    global.requestAnimationFrame(highlightTargetEvent);
  }

  function renderFilterState() {
    for (const button of $$('[data-event-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.eventFilter === state.filter));
    }
    $('#show-all-events').setAttribute('aria-pressed', String(!state.filter));
    renderEvents();
  }

  function renderSnapshot() {
    const activeCount = Math.max(0, Number(state.snapshot?.activeUsers?.count) || 0);
    $('#active-user-count').textContent = String(activeCount);
    $('#active-user-label').textContent = activeCount === 1
      ? 'person active on the website'
      : 'people active on the website';
    $('#snapshot-time').textContent = state.snapshot?.generatedAt
      ? `Updated ${formatRelativeTime(state.snapshot.generatedAt)}`
      : 'Website activity time unavailable';
    $('#last-updated').textContent = state.snapshot?.generatedAt
      ? `Updated ${formatExactTime(state.snapshot.generatedAt)}`
      : 'Update time unavailable';
    updateSignalCounts();
    renderEvents();
  }

  function showPilotDisabled() {
    state.pulseEnabled = false;
    showAccess({
      title: 'Administrator pilot not enabled',
      copy: 'Your administrator email is confirmed. Website Pulse is disabled in this environment until the controlled pilot is turned on.',
      status: `Signed in as ${accountName()}.`,
      tone: 'notice',
      canSignIn: false,
      canSwitchAccount: true,
    });
  }

  async function existingPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in global)) return null;
    const registration = await navigator.serviceWorker.getRegistration('/');
    return registration?.pushManager?.getSubscription?.() || null;
  }

  async function updateNotificationState() {
    const button = $('#enable-notifications');
    const status = $('#notification-status');
    button.disabled = true;
    if (!state.pulseEnabled || !state.vapidPublicKey) {
      status.textContent = 'Notifications are not enabled for this pilot environment.';
      return;
    }
    if (isIosDevice() && !isStandaloneApp()) {
      status.textContent = 'On iPhone, add Pulse to the Home Screen and open the installed app before enabling notifications.';
      return;
    }
    if (!global.isSecureContext || !('Notification' in global)
        || !('serviceWorker' in navigator) || !('PushManager' in global)) {
      status.textContent = 'This device or browser does not support Website Pulse notifications.';
      return;
    }
    if (Notification.permission === 'denied') {
      status.textContent = 'Notifications are blocked in this device’s settings.';
      return;
    }
    const subscription = await existingPushSubscription().catch(() => null);
    if (subscription) {
      if (state.confirmedPushEndpoint !== subscription.endpoint) {
        try {
          const ownership = await api('/admin/pulse/push-subscription', {
            operation: 'upsert',
            subscription: subscription.toJSON(),
          });
          state.serverSubscribed = ownership.subscribed === true;
          if (state.serverSubscribed) state.confirmedPushEndpoint = subscription.endpoint;
        } catch {
          state.serverSubscribed = false;
        }
      }
      status.textContent = state.serverSubscribed
        ? 'Important notifications are enabled on this device.'
        : 'This device is ready. Reconnect it to the administrator pilot.';
      button.textContent = state.serverSubscribed
        ? 'Refresh notification connection'
        : 'Reconnect important notifications';
    } else {
      status.textContent = state.serverSubscribed
        ? 'Another registered device may already receive notifications.'
        : `${isIosDevice() ? 'iPhone' : 'Android'} will ask once for notification permission.`;
      button.textContent = 'Enable important notifications';
    }
    button.disabled = false;
  }

  function base64UrlToUint8Array(value) {
    const normalized = normalizedText(value);
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = global.atob((normalized + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function enableImportantNotifications() {
    const button = $('#enable-notifications');
    const status = $('#notification-status');
    button.disabled = true;
    status.textContent = 'Connecting this device…';
    if (isIosDevice() && !isStandaloneApp()) {
      status.textContent = 'On iPhone, add Pulse to the Home Screen and open the installed app before enabling notifications.';
      return;
    }
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        status.textContent = 'Notifications were not enabled. You can try again from this screen.';
        return;
      }
      const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(state.vapidPublicKey),
        });
      }
      const payload = await api('/admin/pulse/push-subscription', {
        operation: 'upsert',
        subscription: subscription.toJSON(),
      });
      state.serverSubscribed = payload.subscribed === true;
      if (state.serverSubscribed) state.confirmedPushEndpoint = subscription.endpoint;
      status.textContent = state.serverSubscribed
        ? 'Important notifications are enabled on this device.'
        : 'This device could not be confirmed for notifications.';
    } catch (error) {
      status.textContent = error?.message || 'Notifications could not be enabled on this device.';
    } finally {
      button.disabled = false;
      await updateNotificationState();
    }
  }

  async function refreshPulse({ quiet = false } = {}) {
    if (state.refreshInFlight || !state.session?.access_token) return;
    if (!navigator.onLine) {
      setConnection('offline', 'Offline');
      return;
    }
    state.refreshInFlight = true;
    if (!quiet) setConnection('refreshing', 'Updating');
    try {
      const payload = await api('/admin/pulse/snapshot');
      state.pulseEnabled = payload.enabled === true;
      state.vapidPublicKey = normalizedText(payload.vapidPublicKey);
      state.serverSubscribed = payload.subscribed === true;
      if (!state.pulseEnabled) {
        showPilotDisabled();
        return;
      }
      state.snapshot = payload.snapshot || {};
      state.events = normalizeEvents(payload.snapshot?.events);
      showPulse();
      renderSnapshot();
      await updateNotificationState();
      setConnection('connected', 'Connected');
      scheduleRefresh();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        showAccess({
          title: 'Administrator access unavailable',
          copy: 'This Google email is signed in, but it is not assigned an active Due Diligence administrator role.',
          status: error.message,
          tone: 'error',
          canSignIn: false,
          canSwitchAccount: true,
        });
      } else {
        setConnection(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Update failed' : 'Offline');
        const feedState = $('#feed-state');
        if (feedState && !state.events.length) {
          feedState.hidden = false;
          feedState.dataset.tone = 'error';
          feedState.textContent = error?.message || 'Website Pulse could not be updated.';
        }
      }
    } finally {
      state.refreshInFlight = false;
    }
  }

  async function authorizeSession() {
    try {
      state.authorization = await api('/admin/session');
      updateAccountCopy();
      await refreshPulse();
    } catch (error) {
      showAccess({
        title: 'Administrator access unavailable',
        copy: 'This Google email is signed in, but it is not assigned an active Due Diligence administrator role.',
        status: error?.message || 'This account is not authorized for Website Pulse.',
        tone: 'error',
        canSignIn: false,
        canSwitchAccount: true,
      });
    }
  }

  async function startGoogleOAuthFallback() {
    if (isIosDevice()) {
      showAccessStatus(
        'Google sign-in must use the direct button inside the installed iPhone app. Reload Pulse and try again.',
        'error',
      );
      return;
    }
    const button = $('#google-signin-fallback');
    button.disabled = true;
    $('#google-button-label').textContent = 'Opening Google…';
    showAccessStatus('Choose the Google email already authorized for Due Diligence.', 'notice');
    try {
      const redirectTo = new URL(ADMIN_PULSE_CALLBACK_PATH, global.location.origin).href;
      const { error } = await state.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          scopes: 'openid email profile',
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
    } catch (error) {
      button.disabled = false;
      $('#google-button-label').textContent = 'Continue with Google in browser';
      showAccessStatus(error?.message || 'Google sign-in could not start. Please try again.', 'error');
    }
  }

  async function removeThisDeviceFromPush() {
    const subscription = await existingPushSubscription().catch(() => null);
    if (!subscription) return;
    try {
      await api('/admin/pulse/push-subscription', {
        operation: 'remove',
        subscription: { endpoint: subscription.endpoint },
      });
    } catch {
      // Signing out must continue even when the notification endpoint is unavailable.
    }
    await subscription.unsubscribe().catch(() => false);
  }

  async function signOut() {
    clearRefreshTimer();
    try {
      await removeThisDeviceFromPush();
      await state.client?.auth?.signOut?.({ scope: 'local' });
    } finally {
      state.session = null;
      state.authorization = null;
      state.snapshot = null;
      state.events = [];
      state.confirmedPushEndpoint = '';
      global.google?.accounts?.id?.disableAutoSelect?.();
      showAccess();
    }
  }

  function bindInteractions() {
    $('#google-signin-fallback').addEventListener('click', startGoogleOAuthFallback);
    $('#access-signout').addEventListener('click', signOut);
    $('#account-signout').addEventListener('click', signOut);
    $('#refresh-pulse').addEventListener('click', () => refreshPulse());
    $('#enable-notifications').addEventListener('click', enableImportantNotifications);
    $('#signal-grid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-event-filter]');
      if (!button) return;
      state.filter = state.filter === button.dataset.eventFilter ? null : button.dataset.eventFilter;
      renderFilterState();
    });
    $('#show-all-events').addEventListener('click', () => {
      state.filter = null;
      renderFilterState();
    });
    global.addEventListener('online', () => {
      setConnection('refreshing', 'Reconnecting');
      refreshPulse();
    });
    global.addEventListener('offline', () => setConnection('offline', 'Offline'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.pulseEnabled) refreshPulse({ quiet: true });
    });
    navigator.serviceWorker?.addEventListener?.('message', (event) => {
      if (event.data?.type !== 'ADMIN_PULSE_NOTIFICATION_OPENED') return;
      state.targetEventId = normalizedText(event.data.eventId);
      refreshPulse({ quiet: true }).then(highlightTargetEvent);
    });
    const googleScript = $('#google-gis-client');
    googleScript?.addEventListener('load', () => {
      state.googleServicesPromise = null;
      if (state.canSignIn) void prepareGoogleSignIn(state.googleRenderGeneration);
    });
    googleScript?.addEventListener('error', () => {
      state.googleServicesPromise = Promise.resolve(false);
      if (state.canSignIn) offerGoogleRedirectFallback();
    });
  }

  function cleanAuthenticationCallback() {
    const url = new URL(global.location.href);
    if (!url.searchParams.has('code') && url.searchParams.get('auth') !== 'callback') return;
    url.searchParams.delete('code');
    url.searchParams.delete('auth');
    global.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  async function initialize() {
    bindInteractions();
    updateIosInstallGuidance();
    if (!config?.supabase?.url || !config?.supabase?.publishableKey
        || !config?.workerUrl || !global.supabase?.createClient) {
      showAccess({
        title: 'Website Pulse is not configured',
        copy: 'The administrator pilot cannot start in this environment.',
        status: 'Required public application settings are unavailable.',
        tone: 'error',
        canSignIn: false,
      });
      return;
    }
    const authStorage = global.DueDiligenceAuthSessionStorage?.prepare?.(config.supabase.url)
      || global.localStorage
      || global.sessionStorage;
    state.client = global.supabase.createClient(config.supabase.url, config.supabase.publishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storage: authStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    state.client.auth.onAuthStateChange((event, session) => {
      state.session = session || null;
      if (event === 'SIGNED_OUT') showAccess();
    });
    showAccess({
      status: 'Checking for an existing administrator session…',
      canSignIn: false,
    });
    const { data, error } = await state.client.auth.getSession();
    cleanAuthenticationCallback();
    if (error) {
      showAccess({
        status: 'Your saved session could not be checked. Continue with Google to sign in.',
        tone: 'error',
        canSignIn: true,
      });
      return;
    }
    state.session = data?.session || null;
    if (!state.session?.access_token) {
      showAccess({
        status: 'Sign in with your existing Due Diligence administrator email.',
        canSignIn: true,
      });
      return;
    }
    showAccessStatus('Confirming your administrator role…');
    await authorizeSession();
  }

  initialize().catch((error) => {
    showAccess({
      title: 'Website Pulse could not start',
      copy: 'The administrator pilot encountered an unexpected problem.',
      status: error?.message || 'Please reload and try again.',
      tone: 'error',
      canSignIn: false,
      canSwitchAccount: Boolean(state.session),
    });
  });
})(window);
