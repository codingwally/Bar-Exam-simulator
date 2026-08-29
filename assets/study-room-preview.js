(function studyRoomPreviewModule(global) {
  'use strict';

  const document = global.document;
  if (!document) return;

  const ADMIN_ROLES = new Set(['admin', 'administrator', 'super admin', 'founder admin']);

  let access = null;
  let session = null;
  let restoreFocusTo = null;
  let initialized = false;
  let authSettled = false;
  let accessResolutionFailed = false;
  let accessResolution = 0;
  let adminRoomWindow = null;

  function normalized(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  }

  function isAdmin(value = access) {
    return ADMIN_ROLES.has(normalized(value?.role));
  }

  function isSubscriptionEligible(value = access) {
    if (!value || typeof value !== 'object' || isAdmin(value)) return false;
    return global.DueDiligenceSubscriptionCta?.isAudienceEligible?.(value) === true;
  }

  function runtimeSession() {
    return global.DueDiligencePhase4?.getSession?.()
      || global.DueDiligencePhase2?.getSession?.()
      || global.DueDiligencePhase2?.currentSession?.()
      || null;
  }

  function runtimeAccess() {
    return global.DueDiligencePhase4?.getAccess?.() || null;
  }

  function accessWithVerifiedRole(value = runtimeAccess() || access) {
    const current = value;
    if (!current || typeof current !== 'object') return null;
    const headerRole = normalized(document.getElementById('dd2-header-role-label')?.textContent);
    if (!ADMIN_ROLES.has(headerRole)) return current;
    return { ...(current || {}), role: headerRole };
  }

  function signedIn(value = session) {
    return Boolean(value?.access_token || value?.user);
  }

  function accessIsResolving() {
    return !authSettled || (signedIn() && !access && !accessResolutionFailed);
  }

  function headerShowsAdmin() {
    const headerRole = normalized(document.getElementById('dd2-header-role-label')?.textContent);
    return ADMIN_ROLES.has(headerRole);
  }

  function syncTriggerVisibility(overrides = {}) {
    const hasSession = Object.prototype.hasOwnProperty.call(overrides, 'session');
    const hasAccess = Object.prototype.hasOwnProperty.call(overrides, 'access');
    session = hasSession ? overrides.session : (runtimeSession() || session);
    if (!signedIn()) {
      access = null;
    } else {
      const nextAccess = hasAccess ? overrides.access : (runtimeAccess() || access);
      access = accessWithVerifiedRole(nextAccess) || null;
    }

    const busy = accessIsResolving();
    document.querySelectorAll('[data-study-room-trigger]').forEach((trigger) => {
      trigger.disabled = busy;
      trigger.setAttribute('aria-busy', String(busy));
      trigger.setAttribute('aria-disabled', String(busy));
    });
    const mobileTrigger = document.getElementById('spa-study-room');
    if (mobileTrigger) mobileTrigger.hidden = !signedIn();
    syncSubscriptionState();
  }

  function syncSubscriptionState() {
    const subscribe = document.getElementById('dd-study-room-subscribe');
    const note = document.getElementById('dd-study-room-subscribe-note');
    if (!subscribe || !note) return;
    const known = Boolean(access && typeof access === 'object');
    const eligible = isSubscriptionEligible(access);
    const subscribed = known && !eligible;
    subscribe.disabled = !eligible;
    subscribe.classList.toggle('is-subscribed', subscribed);
    subscribe.querySelector('span').textContent = !known
      ? 'Checking access…'
      : subscribed ? 'Already subscribed' : 'Subscribe now';
    note.textContent = !known
      ? 'Confirming your account status'
      : subscribed ? 'Subscription active' : 'Opens Plans & Pricing';
  }

  function hydratePreviewImages() {
    document.querySelectorAll('#dd-study-room-overlay img[data-src]').forEach((image) => {
      if (!image.getAttribute('src')) image.setAttribute('src', image.dataset.src);
      image.removeAttribute('data-src');
    });
  }

  function focusableElements() {
    const dialog = document.getElementById('dd-study-room-dialog');
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
  }

  function openMarketingPreview(trigger = null) {
    const overlay = document.getElementById('dd-study-room-overlay');
    const dialog = document.getElementById('dd-study-room-dialog');
    if (!overlay || !dialog) return false;
    restoreFocusTo = trigger instanceof global.HTMLElement ? trigger : document.activeElement;
    hydratePreviewImages();
    access = accessWithVerifiedRole() || access;
    syncSubscriptionState();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dd-study-room-open');
    global.requestAnimationFrame(() => document.getElementById('dd-study-room-close')?.focus({ preventScroll: true }));
    global.DueDiligenceAnalytics?.track?.('study_room_preview_opened', {
      access: isAdmin(access) ? 'admin' : (isSubscriptionEligible(access) ? 'eligible' : 'subscribed'),
    });
    return true;
  }

  function openAdminRoom() {
    const roomUrl = new URL('/study-room/', global.location.origin);
    if (adminRoomWindow && !adminRoomWindow.closed) {
      adminRoomWindow.focus?.();
      return true;
    }
    let popup = null;
    try {
      popup = global.open(
        roomUrl.href,
        'DueDiligenceStudyRoom',
        'popup=yes,width=1440,height=900,left=40,top=40,resizable=yes,scrollbars=yes,toolbar=no,location=no,menubar=no,status=no',
      );
    } catch {
      global.location.assign(roomUrl.href);
      return true;
    }
    if (!popup) {
      global.location.assign(roomUrl.href);
      return true;
    }
    adminRoomWindow = popup;
    try {
      popup.opener = null;
    } catch {
      // The secure room still opened; some browsers make the WindowProxy read-only.
    }
    popup.focus?.();
    global.DueDiligenceAnalytics?.track?.('study_room_admin_window_opened');
    return true;
  }

  function open(trigger = null) {
    if (accessIsResolving()) return false;
    access = accessWithVerifiedRole() || access;
    if (isAdmin(access) || (accessResolutionFailed && signedIn() && headerShowsAdmin())) {
      return openAdminRoom();
    }
    return openMarketingPreview(trigger);
  }

  function close({ restoreFocus = true } = {}) {
    const overlay = document.getElementById('dd-study-room-overlay');
    if (!overlay || overlay.hidden) return false;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dd-study-room-open');
    if (restoreFocus && restoreFocusTo instanceof global.HTMLElement) {
      restoreFocusTo.focus({ preventScroll: true });
    }
    restoreFocusTo = null;
    return true;
  }

  function openPricing() {
    if (!isSubscriptionEligible(access)) return;
    close({ restoreFocus: false });
    const target = document.getElementById('dd2-header-pricing-button')
      || document.getElementById('spa-pricing');
    target?.click();
    global.DueDiligenceAnalytics?.track?.('study_room_preview_pricing_opened');
  }

  function setPreviewStatus(message) {
    const status = document.getElementById('dd-study-room-preview-status');
    if (status) status.textContent = message;
  }

  function bindPreviewControls() {
    const microphone = document.getElementById('dd-study-room-mute');
    microphone?.addEventListener('click', () => {
      const muted = microphone.getAttribute('aria-pressed') !== 'true';
      microphone.setAttribute('aria-pressed', String(muted));
      microphone.querySelector('span').textContent = muted ? 'Unmute' : 'Mute';
      setPreviewStatus(muted ? 'Microphone muted in this interface preview.' : 'Microphone unmuted in this interface preview.');
    });

    document.querySelectorAll('[data-study-room-control]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.studyRoomControl;
        if (action === 'leave') {
          setPreviewStatus('The live room is still in admin testing. No call was started.');
          return;
        }
        const pressed = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(pressed));
        setPreviewStatus(button.getAttribute('aria-label') + ' ' + (pressed ? 'selected' : 'cleared') + ' in this interface preview.');
      });
    });

    document.querySelectorAll('[data-study-room-background]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-study-room-background]').forEach((choice) => {
          choice.setAttribute('aria-pressed', String(choice === button));
        });
        setPreviewStatus(button.dataset.studyRoomBackground + ' background selected for this interface preview.');
      });
    });

    document.getElementById('dd-study-room-volume')?.addEventListener('input', (event) => {
      setPreviewStatus('Room volume preview set to ' + event.target.value + ' percent.');
    });

    document.getElementById('dd-study-room-window')?.addEventListener('click', () => {
      setPreviewStatus('The live room will open in a separate window during the next testing phase.');
    });
  }

  function bindDialog() {
    const overlay = document.getElementById('dd-study-room-overlay');

    // Navigation can rebuild the signed-in header, so trigger handling is delegated.
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest?.('[data-study-room-trigger]');
      if (trigger) {
        event.preventDefault();
        open(trigger);
        return;
      }
      if (event.target.closest?.('#dd-study-room-close')) {
        close();
        return;
      }
      if (event.target.closest?.('#dd-study-room-subscribe')) openPricing();
    });

    overlay?.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    document.addEventListener('keydown', (event) => {
      if (!overlay || overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    bindDialog();
    bindPreviewControls();
    syncTriggerVisibility({
      session: runtimeSession(),
      access: runtimeAccess(),
    });
  }

  function accessEventHandler(event) {
    const detail = event?.detail;
    const hasNestedAccess = Boolean(detail && Object.prototype.hasOwnProperty.call(detail, 'access'));
    const nextAccess = hasNestedAccess
      ? detail.access
      : (detail && typeof detail === 'object' ? detail : runtimeAccess());
    authSettled = true;
    accessResolutionFailed = false;
    syncTriggerVisibility({ access: nextAccess || null });
  }

  function sessionEventHandler(event) {
    const detail = event?.detail;
    const hasExplicitSession = Boolean(detail && Object.prototype.hasOwnProperty.call(detail, 'session'));
    const nextSession = detail?.authenticated === false
      ? null
      : (hasExplicitSession
        ? detail.session
        : (runtimeSession() || (detail?.authenticated === true ? { access_token: 'authenticated-session' } : null)));
    const previousUserId = String(session?.user?.id || '');
    const nextUserId = String(nextSession?.user?.id || '');
    const changedAccount = signedIn(nextSession)
      && (!signedIn(session) || (previousUserId && nextUserId && previousUserId !== nextUserId));

    accessResolution += 1;
    authSettled = true;
    accessResolutionFailed = false;
    syncTriggerVisibility({
      session: nextSession,
      access: !signedIn(nextSession) || changedAccount ? null : access,
    });
    if (signedIn(nextSession) && !access) {
      Promise.resolve().then(refreshWhenAuthReady).catch(() => {});
    }
  }

  async function refreshWhenAuthReady() {
    const resolution = ++accessResolution;
    accessResolutionFailed = false;
    await Promise.resolve(global.DueDiligencePhase2?.whenAuthReady?.());
    if (resolution !== accessResolution) return;

    authSettled = true;
    const readySession = runtimeSession();
    if (!signedIn(readySession)) {
      syncTriggerVisibility({ session: null, access: null });
      return;
    }

    const readyAccess = runtimeAccess();
    syncTriggerVisibility({ session: readySession, access: readyAccess });
    if (readyAccess) return;

    const resolvedAccess = await global.DueDiligencePhase4?.refreshAccess?.({
      enforce: false,
      force: true,
    }).catch(() => null);
    if (resolution !== accessResolution) return;

    const latestSession = runtimeSession();
    const latestAccess = resolvedAccess || runtimeAccess();
    accessResolutionFailed = signedIn(latestSession) && !latestAccess;
    syncTriggerVisibility({
      session: signedIn(latestSession) ? latestSession : null,
      access: signedIn(latestSession) ? latestAccess : null,
    });
  }

  global.addEventListener('duediligence:access', accessEventHandler);
  global.addEventListener('duediligence:session', sessionEventHandler);
  document.addEventListener('duediligence:access', accessEventHandler);
  document.addEventListener('duediligence:session', sessionEventHandler);

  global.DueDiligenceStudyRoomPreview = Object.freeze({
    close,
    open,
    sync: syncTriggerVisibility,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();

  Promise.resolve().then(refreshWhenAuthReady).catch(() => {
    authSettled = true;
    accessResolutionFailed = signedIn(runtimeSession() || session);
    syncTriggerVisibility();
  });
})(window);
