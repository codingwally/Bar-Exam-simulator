(function phase2Experience(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  if (!config) return;

  const state = {
    client: null,
    session: null,
    user: null,
    profile: null,
    marketingOptIn: false,
    initialized: false,
    onboardingBusy: false,
    nativeView: null,
    previousFocus: null,
    reminderResolve: null,
    guestUsage: null,
    admin: null,
    authInFlight: false,
    authStartedAt: 0,
    authTimeout: null,
    signInNotificationAttempted: false,
    privateBetaAllowed: config.features?.privateBetaGate !== true,
  };

  const originalContinueAsGuest = global.continueAsGuest;
  const legalReviewNotice = 'Beta document — prepared for independent legal review.';
  const authReturnStorageKey = 'duediligence.auth.return.v1';
  const authAttemptStorageKey = 'duediligence.auth.attempt.v1';
  const pendingSubmissionStorageKey = 'duediligence.pending-submission.v1';
  const authTimeoutMs = 12_000;
  const pendingSubmissionMaxAgeMs = 30 * 60 * 1000;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[character]));
  }

  function randomId(byteLength = 24) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    const match = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    return match ? decodeURIComponent(match.slice(prefix.length)) : '';
  }

  function writeDeviceCookie(value) {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${config.guest.deviceCookieName}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`;
  }

  function guestDeviceId() {
    let localValue = '';
    try {
      localValue = localStorage.getItem(config.guest.deviceStorageKey) || '';
    } catch {
      localValue = '';
    }
    const cookieValue = readCookie(config.guest.deviceCookieName);
    const candidate = localValue || cookieValue || randomId(32);
    try {
      localStorage.setItem(config.guest.deviceStorageKey, candidate);
    } catch {
      // The first-party cookie remains the redundant store when storage is unavailable.
    }
    writeDeviceCookie(candidate);
    return candidate;
  }

  function crestMarkup() {
    return `
      <svg viewBox="0 0 48 48" width="32" height="32" fill="none" aria-hidden="true">
        <path d="M24 8v27M11 15h26M12 15 7.5 24h9L12 15Zm24 0-4.5 9h9L36 15Z"
          stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.5 24c1.8 3.2 7.2 3.2 9 0M31.5 24c1.8 3.2 7.2 3.2 9 0M18 37h12"
          stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>`;
  }

  function injectShell() {
    if (document.getElementById('dd2-entry-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="dd2-overlay" id="dd2-entry-overlay" role="dialog" aria-modal="true"
        aria-labelledby="dd2-entry-title" aria-describedby="dd2-entry-copy" aria-hidden="true">
        <section class="dd2-entry" tabindex="-1">
          <div class="dd2-entry-story">
            <div class="dd2-entry-kicker">Philippine Bar Essay Preparation</div>
            <h2>Prepare with conviction.</h2>
            <p>Serious essay practice, disciplined ALAC structure, and source-based feedback in a private chamber built for future lawyers.</p>
          </div>
          <div class="dd2-entry-panel">
            <button type="button" class="dd2-close dd2-entry-close" id="dd2-entry-close"
              aria-label="Close sign-in and return">×</button>
            <div class="dd2-mark">${crestMarkup()}</div>
            <h3 id="dd2-entry-title">Welcome to Due Diligence</h3>
            <p id="dd2-entry-copy">Your chamber for serious Bar preparation.</p>
            <ul class="dd2-benefits">
              <li>Save progress</li>
              <li>Personal analytics</li>
              <li>Guided Subject Matter practice</li>
            </ul>
            <div class="dd2-entry-actions">
              <button type="button" class="dd2-button dd2-button-primary" id="dd2-google-signin">Continue with Google</button>
              <button type="button" class="dd2-button dd2-button-secondary" id="dd2-guest-continue" hidden>Continue as Guest</button>
            </div>
            <form class="dd2-entry-consent" id="dd2-entry-consent" hidden>
              <label class="dd2-check">
                <input type="checkbox" id="dd2-entry-legal-acceptance" required>
                <span>I accept the <button class="link-button" type="button" data-dd2-view="terms">Terms of Use</button>
                  and acknowledge the <button class="link-button" type="button" data-dd2-view="privacy">Privacy Policy</button>.</span>
              </label>
              <button type="submit" class="dd2-button dd2-button-primary" id="dd2-entry-consent-submit">Accept &amp; Continue</button>
            </form>
            <div class="dd2-status" id="dd2-auth-status" role="status" aria-live="polite"></div>
            <p class="dd2-entry-note" id="dd2-entry-note">Google opens its secure consent screen. Only basic identity scopes are requested. Review the <button class="link-button" type="button" data-dd2-view="terms">Terms of Use</button> and <button class="link-button" type="button" data-dd2-view="privacy">Privacy Policy</button> before continuing.</p>
            <div class="dd2-dialog-footer"><button type="button" class="dd2-button dd2-button-secondary dd2-dialog-back" id="dd2-entry-back">Back</button></div>
          </div>
        </section>
      </div>

      <div class="dd2-overlay dd2-native-view" id="dd2-native-view" role="dialog" aria-modal="true"
        aria-labelledby="dd2-native-title" aria-hidden="true">
        <article class="dd2-native-card" tabindex="-1">
          <header class="dd2-native-header">
            <div>
              <div class="dd2-view-kicker" id="dd2-native-kicker">Due Diligence</div>
              <h2 id="dd2-native-title">Information</h2>
            </div>
            <button type="button" class="dd2-close" id="dd2-native-close" aria-label="Close">×</button>
          </header>
          <div id="dd2-native-body"></div>
          <div class="dd2-dialog-footer"><button type="button" class="dd2-button dd2-button-secondary dd2-dialog-back" id="dd2-native-back">Back</button></div>
        </article>
      </div>

      <div class="dd2-overlay" id="dd2-onboarding-overlay" role="dialog" aria-modal="true"
        aria-labelledby="dd2-onboarding-title" aria-hidden="true">
        <section class="dd2-onboarding-card" tabindex="-1">
          <button type="button" class="dd2-close dd2-card-close" id="dd2-onboarding-close" aria-label="Close setup and return to sign-in">×</button>
          <div class="dd2-view-kicker">First-time setup</div>
          <h2 id="dd2-onboarding-title">Make this chamber yours.</h2>
          <p>Tell us where you are in your legal studies. Your school and year level are optional if you are not yet enrolled.</p>
          <form class="dd2-form" id="dd2-onboarding-form">
            <div class="dd2-onboarding-grid">
              <label class="dd2-label dd2-wide">Display name
                <input class="dd2-field" id="dd2-display-name" maxlength="120" autocomplete="name" required>
              </label>
              <label class="dd2-label">Enrollment status
                <select class="dd2-field" id="dd2-enrollment-status" required>
                  <option value="enrolled">Currently enrolled</option>
                  <option value="not_yet_enrolled">Not yet enrolled</option>
                </select>
              </label>
              <label class="dd2-label">Year level
                <select class="dd2-field" id="dd2-year-level">
                  <option value="">Select year level</option>
                  <option value="1">First year</option>
                  <option value="2">Second year</option>
                  <option value="3">Third year</option>
                  <option value="4">Fourth year</option>
                  <option value="review">Graduate / Bar review</option>
                </select>
              </label>
              <label class="dd2-label dd2-wide">Law school
                <input class="dd2-field" id="dd2-school" maxlength="180" autocomplete="organization">
              </label>
            </div>
            <label class="dd2-check">
              <input type="checkbox" id="dd2-legal-acceptance" required>
              <span>I accept the <button class="link-button" type="button" data-dd2-view="terms">Beta Terms</button>
                and acknowledge the <button class="link-button" type="button" data-dd2-view="privacy">Beta Privacy Notice</button>.</span>
            </label>
            <label class="dd2-check">
              <input type="checkbox" id="dd2-marketing-consent">
              <span>Send me optional product and Bar-review updates. I can withdraw this at any time.</span>
            </label>
            <label class="dd2-check">
              <input type="checkbox" id="dd2-ai-improvement-consent">
              <span>Optionally allow de-identified answer content to improve internal rubrics and quality. I can withdraw this without losing simulator access.</span>
            </label>
            <div class="dd2-status" id="dd2-onboarding-status" role="status" aria-live="polite"></div>
            <button class="dd2-button dd2-button-primary" id="dd2-onboarding-submit" type="submit">Enter Due Diligence</button>
            <div class="dd2-dialog-footer"><button type="button" class="dd2-button dd2-button-secondary dd2-dialog-back" id="dd2-onboarding-back">Back</button></div>
          </form>
        </section>
      </div>

      <div class="dd2-overlay" id="dd2-guest-reminder" role="dialog" aria-modal="true"
        aria-labelledby="dd2-reminder-title" aria-hidden="true">
        <section class="dd2-reminder-card" tabindex="-1">
          <button type="button" class="dd2-close dd2-card-close" id="dd2-reminder-close" aria-label="Close guest reminder">×</button>
          <div class="dd2-view-kicker">Guest preview</div>
          <h3 id="dd2-reminder-title">Three assessments, fully graded.</h3>
          <p>Guest access includes 3 graded questions across all subjects. Sign in to continue practicing after your preview.</p>
          <div class="dd2-reminder-actions">
            <button type="button" class="dd2-button dd2-button-secondary dd2-dialog-back" id="dd2-reminder-back">Back</button>
            <button type="button" class="dd2-button dd2-button-secondary" id="dd2-reminder-signin">Sign in</button>
            <button type="button" class="dd2-button dd2-button-primary" id="dd2-reminder-continue">Continue as Guest</button>
          </div>
        </section>
      </div>
    `);

    const topActions = document.querySelector('.topbar-actions');
    if (topActions) {
      topActions.insertAdjacentHTML(
        'afterbegin',
        '<span class="dd2-guest-badge" id="dd2-guest-badge" aria-live="polite"></span>',
      );
    }
  }

  function setOverlay(open, id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.toggle('is-open', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle(
      'dd2-locked',
      Boolean(document.querySelector('.dd2-overlay.is-open')),
    );
    global.syncModalIsolation?.();
    if (open) {
      state.previousFocus = document.activeElement;
      requestAnimationFrame(() => {
        const target = overlay.querySelector(
          'button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
        ) || overlay.querySelector('[tabindex="-1"]');
        target?.focus();
      });
    } else {
      const previousFocus = state.previousFocus;
      requestAnimationFrame(() => {
        const visibleTarget = (element) => {
          if (!element?.isConnected || element.hidden || element.disabled) return false;
          if (typeof element.getClientRects === 'function') {
            return element.getClientRects().length > 0;
          }
          return element.offsetParent !== null;
        };
        const fallbackTargets = [
          previousFocus,
          document.getElementById('site-menu-toggle'),
          document.querySelector('.spa-tab.active'),
          document.getElementById('btn-signin'),
        ];
        fallbackTargets.find(visibleTarget)?.focus();
      });
    }
  }

  function setStatus(id, message, kind = '') {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.className = `dd2-status${kind ? ` is-${kind}` : ''}`;
  }

  function safeSessionRead(key) {
    try {
      return sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function safeSessionWrite(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function safeSessionRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Session storage is an enhancement, never an authentication dependency.
    }
  }

  function resetGoogleSignIn(message = '', kind = '') {
    if (state.authTimeout) clearTimeout(state.authTimeout);
    state.authTimeout = null;
    state.authInFlight = false;
    state.authStartedAt = 0;
    const button = document.getElementById('dd2-google-signin');
    if (button) {
      button.disabled = false;
      button.textContent = 'Continue with Google';
    }
    if (message) setStatus('dd2-auth-status', message, kind);
  }

  function armAuthTimeout() {
    if (state.authTimeout) clearTimeout(state.authTimeout);
    state.authTimeout = setTimeout(() => {
      if (state.session?.access_token) return;
      resetGoogleSignIn(
        'Google sign-in did not complete. You can retry now, or check that pop-ups and redirects are allowed.',
        'error',
      );
    }, authTimeoutMs);
  }

  function sanitizeSubmissionDraft(view, draft = {}) {
    const source = draft && typeof draft === 'object' ? draft : {};
    if (view === 'support') {
      return {
        category: String(source.category || 'technical').slice(0, 40),
        message: String(source.message || '').slice(0, 4000),
        replyEmail: String(source.replyEmail || '').slice(0, 254),
      };
    }
    if (view === 'partnership') {
      return {
        inquiryType: String(source.inquiryType || 'institutional_license').slice(0, 60),
        contactName: String(source.contactName || '').slice(0, 120),
        contactEmail: String(source.contactEmail || '').slice(0, 254),
        organization: String(source.organization || '').slice(0, 180),
        message: String(source.message || '').slice(0, 5000),
        consent: source.consent === true,
      };
    }
    if (view === 'correction') {
      return {
        questionId: String(source.questionId || '').slice(0, 120),
        correctionType: String(source.correctionType || 'suggested_answer').slice(0, 40),
        proposedCorrection: String(source.proposedCorrection || '').slice(0, 6000),
        explanation: String(source.explanation || '').slice(0, 3000),
        sourceUrls: Array.isArray(source.sourceUrls)
          ? source.sourceUrls.slice(0, 5).map((value) => String(value).slice(0, 2000))
          : [],
      };
    }
    if (view === 'grade') {
      return { questionId: String(source.questionId || '').slice(0, 120) };
    }
    if (view === 'payment') {
      return { planCode: String(source.planCode || '').slice(0, 80) };
    }
    if (view === 'refund') {
      return {
        paymentRequestId: String(source.paymentRequestId || '').slice(0, 80),
        reason: String(source.reason || '').slice(0, 2000),
      };
    }
    return {};
  }

  function queuePendingSubmission(view, draft = {}) {
    if (!['support', 'partnership', 'correction', 'grade', 'payment', 'refund'].includes(view)) return;
    safeSessionWrite(pendingSubmissionStorageKey, JSON.stringify({
      view,
      draft: sanitizeSubmissionDraft(view, draft),
      createdAt: Date.now(),
    }));
  }

  function readPendingSubmission() {
    const raw = safeSessionRead(pendingSubmissionStorageKey);
    if (!raw) return null;
    try {
      const pending = JSON.parse(raw);
      if (!pending?.view
          || !Number.isFinite(Number(pending.createdAt))
          || Date.now() - Number(pending.createdAt) > pendingSubmissionMaxAgeMs) {
        safeSessionRemove(pendingSubmissionStorageKey);
        return null;
      }
      return {
        view: pending.view,
        draft: sanitizeSubmissionDraft(pending.view, pending.draft),
      };
    } catch {
      safeSessionRemove(pendingSubmissionStorageKey);
      return null;
    }
  }

  function requireSubmissionAuthentication(view, draft = {}) {
    if (state.session?.access_token && state.user) return true;
    queuePendingSubmission(view, draft);
    showEntry({
      message: 'Sign in with Google to submit securely. Your non-sensitive draft will be restored after sign-in.',
    });
    return false;
  }

  function restoreFormValue(id, value, property = 'value') {
    const element = document.getElementById(id);
    if (element && value !== undefined && value !== null) element[property] = value;
  }

  function resumePendingSubmission() {
    if (!state.session?.access_token) return;
    const pending = readPendingSubmission();
    if (!pending) return;
    safeSessionRemove(pendingSubmissionStorageKey);
    if (pending.view === 'support') {
      renderNativeView('support');
      restoreFormValue('dd2-support-category', pending.draft.category);
      restoreFormValue('dd2-support-email', pending.draft.replyEmail);
      restoreFormValue('dd2-support-message', pending.draft.message);
    } else if (pending.view === 'partnership') {
      renderNativeView('partnership');
      restoreFormValue('dd2-partnership-type', pending.draft.inquiryType);
      restoreFormValue('dd2-partnership-name', pending.draft.contactName);
      restoreFormValue('dd2-partnership-email', pending.draft.contactEmail);
      restoreFormValue('dd2-partnership-organization', pending.draft.organization);
      restoreFormValue('dd2-partnership-message', pending.draft.message);
      restoreFormValue('dd2-partnership-consent', pending.draft.consent, 'checked');
    }
    global.dispatchEvent(new CustomEvent('duediligence:submission-resume', {
      detail: pending,
    }));
    global.toast?.(
      pending.view === 'grade'
        ? 'Signed in. Your saved examination draft is ready when you are.'
        : 'Signed in. Your saved draft has been restored.',
      'ok',
    );
  }

  async function clearInvalidLocalSession() {
    try {
      await state.client?.auth?.signOut?.({ scope: 'local' });
    } catch {
      // Local state is cleared below even if the auth client cannot reach the provider.
    }
    state.session = null;
    state.user = null;
    state.profile = null;
    state.admin = null;
    global.DueDiligencePrivateBeta?.clearAccess?.();
    syncAuthUi();
  }

  async function handleSubmissionUnauthorized(view, draft = {}) {
    queuePendingSubmission(view, draft);
    await clearInvalidLocalSession();
    showEntry({
      message: 'Your secure session expired. Sign in again and your non-sensitive draft will be restored.',
    });
  }

  function trapOverlayFocus(event) {
    if (event.key !== 'Tab') return;
    const overlays = Array.from(document.querySelectorAll('.dd2-overlay.is-open'));
    const overlay = overlays[overlays.length - 1];
    if (!overlay) return;
    const focusable = Array.from(overlay.querySelectorAll(
      'button:not([disabled]):not([hidden]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    )).filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      overlay.querySelector('[tabindex="-1"]')?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function safeReturnHash(value) {
    try {
      const url = new URL(String(value || ''), location.origin);
      if (url.origin !== location.origin || url.pathname !== location.pathname) return '';
      return /^#[a-z0-9][a-z0-9-]{0,64}$/i.test(url.hash) ? url.hash : '';
    } catch {
      return '';
    }
  }

  function rememberAuthReturn(returnHash) {
    const hash = safeReturnHash(returnHash);
    if (!hash) return;
    safeSessionWrite(authReturnStorageKey, `${location.origin}${location.pathname}${hash}`);
  }

  function setEntryMode(mode = 'signin') {
    const consent = document.getElementById('dd2-entry-consent');
    const actions = document.querySelector('#dd2-entry-overlay .dd2-entry-actions');
    const note = document.getElementById('dd2-entry-note');
    const consentMode = mode === 'consent';
    if (consent) consent.hidden = !consentMode;
    if (actions) actions.hidden = consentMode;
    if (note) {
      if (consentMode) {
        note.textContent = 'Acceptance is recorded with the current document versions and timestamp.';
      } else {
        note.innerHTML = 'Google opens its secure consent screen. Only basic identity scopes are requested. Review the <button class="link-button" type="button" data-dd2-view="terms">Terms of Use</button> and <button class="link-button" type="button" data-dd2-view="privacy">Privacy Policy</button> before continuing.';
      }
    }
    if (!consentMode) {
      const checkbox = document.getElementById('dd2-entry-legal-acceptance');
      if (checkbox) checkbox.checked = false;
    }
  }

  function showEntry(options = {}) {
    const completed = Boolean(options.completed);
    hideNativeView();
    const allowGuest = options.allowGuest === true && !completed;
    const allowDismiss = options.allowDismiss === true;
    const routeBound = options.routeBound === true;
    rememberAuthReturn(options.returnHash);
    setEntryMode(options.mode || 'signin');
    const overlay = document.getElementById('dd2-entry-overlay');
    const title = document.getElementById('dd2-entry-title');
    const copy = document.getElementById('dd2-entry-copy');
    const guestButton = document.getElementById('dd2-guest-continue');
    if (title) title.textContent = options.title || (completed
      ? 'You have completed your 3 guest questions.'
      : 'Welcome to Due Diligence');
    if (copy) copy.textContent = options.copy || (completed
      ? 'Sign in to continue.'
      : 'Your chamber for serious Bar preparation.');
    if (guestButton) guestButton.hidden = !allowGuest;
    if (overlay) {
      overlay.dataset.dismissible = allowDismiss ? 'true' : 'false';
      overlay.dataset.routeBound = routeBound ? 'true' : 'false';
    }
    setStatus('dd2-auth-status', options.message || '');
    setOverlay(true, 'dd2-entry-overlay');
  }

  function closeEntry() {
    const overlay = document.getElementById('dd2-entry-overlay');
    if (overlay) {
      overlay.dataset.dismissible = 'false';
      overlay.dataset.routeBound = 'false';
    }
    setOverlay(false, 'dd2-entry-overlay');
  }

  function returnFromEntry() {
    const protectedRoute = ['subject-matter', 'bar-feels', 'quorum', 'examination-room']
      .includes(location.hash.replace(/^#/, ''));
    closeEntry();
    if (!state.session?.access_token) {
      safeSessionRemove(authReturnStorageKey);
      return;
    }
    if (protectedRoute) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    global.showPage?.('mock', document.getElementById('spa-mock'));
    global.showWelcome?.({ preserveSession: true });
  }

  async function returnFromOnboarding() {
    if (state.onboardingBusy) return;
    setOverlay(false, 'dd2-onboarding-overlay');
    try {
      await state.client?.auth?.signOut?.({ scope: 'local' });
    } catch {
      // Local state is cleared below; the provider session is not altered.
    }
    state.session = null;
    state.user = null;
    state.profile = null;
    state.admin = null;
    syncAuthUi();
    showEntry({ allowDismiss: true });
  }

  function continueFromGuestReminder() {
    try {
      localStorage.setItem(config.guest.reminderStorageKey, 'shown');
    } catch {
      // The reminder may repeat when persistent storage is unavailable.
    }
    setOverlay(false, 'dd2-guest-reminder');
    state.reminderResolve?.(true);
    state.reminderResolve = null;
  }

  function syncEntryWithHistoryRoute() {
    const protectedRoute = ['subject-matter', 'bar-feels', 'quorum', 'examination-room']
      .includes(location.hash.replace(/^#/, ''));
    if (protectedRoute && !state.session?.access_token) {
      showEntry({ routeBound: true, returnHash: location.hash });
      return;
    }
    const overlay = document.getElementById('dd2-entry-overlay');
    if (overlay?.dataset.routeBound === 'true'
        && overlay.classList.contains('is-open')) {
      closeEntry();
    }
  }

  async function signInWithGoogle() {
    if (state.authInFlight) return;
    if (!state.client) {
      setStatus('dd2-auth-status', 'Sign-in is temporarily unavailable. Please try again shortly.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('dd2-auth-status', 'You appear to be offline. Reconnect and try again.', 'error');
      return;
    }
    const button = document.getElementById('dd2-google-signin');
    state.authInFlight = true;
    state.authStartedAt = Date.now();
    if (button) {
      button.disabled = true;
      button.textContent = 'Opening Google securely…';
    }
    setStatus('dd2-auth-status', 'Opening Google securely…');
    armAuthTimeout();
    try {
      if (!safeSessionRead(authReturnStorageKey)) {
        safeSessionWrite(authReturnStorageKey, location.href);
      }
      safeSessionWrite(authAttemptStorageKey, String(Date.now()));
      const { error } = await state.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: config.supabase.oauthRedirectUrl,
          scopes: 'openid email profile',
        },
      });
      if (error) throw error;
    } catch {
      resetGoogleSignIn(
        navigator.onLine
          ? 'Google sign-in could not start. Please try again.'
          : 'You appear to be offline. Reconnect and try again.',
        'error',
      );
    }
  }

  function isAuthenticationReturn() {
    const query = new URLSearchParams(location.search);
    return query.get('auth') === 'callback' || query.has('code');
  }

  async function notifyOwnerOfSuccessfulSignIn(session) {
    if (state.signInNotificationAttempted || !isAuthenticationReturn()) return;
    const accessToken = String(session?.access_token || '');
    if (!accessToken) return;
    state.signInNotificationAttempted = true;
    try {
      await fetch(`${config.workerUrl}/auth/sign-in-notification`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        keepalive: true,
      });
    } catch {
      // Owner notification is best-effort and must never interrupt user authentication.
    }
  }

  function continueGuestFromEntry() {
    closeEntry();
    if (typeof originalContinueAsGuest === 'function'
      && typeof onboardingStage !== 'undefined'
      && onboardingStage === 'signIn') {
      originalContinueAsGuest();
    }
  }

  function requireSignInForGuestLimit() {
    setOverlay(false, 'dd2-guest-reminder');
    state.reminderResolve?.(false);
    state.reminderResolve = null;
    showEntry({ completed: true });
  }

  function initials() {
    const source = state.profile?.display_name || state.user?.user_metadata?.full_name || 'Due Diligence';
    return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function syncAuthUi() {
    const signedIn = Boolean(state.session?.access_token && state.user);
    const signInButton = document.getElementById('btn-signin');
    if (signInButton) {
      signInButton.textContent = 'The Docket';
      signInButton.title = signedIn
        ? 'Manage your profile, preferences, and activity.'
        : 'Open The Docket to sign in.';
      signInButton.hidden = false;
    }
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      badge.classList.toggle('is-visible', !signedIn && Boolean(state.guestUsage));
      if (state.guestUsage) badge.textContent = `${state.guestUsage.remaining} guest grades left`;
    }
  }

  function deferOnboardingForPrivateBeta() {
    if (config.features?.privateBetaGate !== true || state.privateBetaAllowed) return false;
    setOverlay(false, 'dd2-onboarding-overlay');
    return true;
  }

  function restoreAuthDestination() {
    const stored = safeSessionRead(authReturnStorageKey);
    const hash = safeReturnHash(stored);
    safeSessionRemove(authReturnStorageKey);
    if (!hash) {
      resumePendingSubmission();
      return;
    }
    history.replaceState({}, '', `${location.pathname}${hash}`);
    requestAnimationFrame(() => {
      if (hash === '#mock') {
        global.showPage?.('mock', document.getElementById('spa-mock'));
        global.showWelcome?.({ preserveSession: true });
      } else if (hash === '#subject-matter') {
        global.DueDiligenceExaminations?.openPerSubject?.();
      } else if (hash === '#bar-feels') {
        global.openPremiumBarFeels?.();
      } else if (hash === '#quorum') {
        global.DueDiligenceQuorum?.open?.(document.getElementById('spa-community'));
      } else if (hash === '#examination-room') {
        global.openExaminationRoom?.();
      } else if (hash === '#account') {
        renderNativeView('account');
      }
      resumePendingSubmission();
    });
  }

  function openTermsAcceptance() {
    showEntry({
      mode: 'consent',
      allowDismiss: true,
      routeBound: true,
      title: 'Review the current Terms and Privacy Policy',
      copy: 'One acknowledgment is required before your first protected activity.',
    });
    requestAnimationFrame(() => document.getElementById('dd2-entry-legal-acceptance')?.focus());
  }

  async function submitEntryConsent(event) {
    event.preventDefault();
    if (!state.client || !state.user || !state.session?.access_token) {
      setEntryMode('signin');
      setStatus('dd2-auth-status', 'Sign in with Google before accepting the documents.', 'error');
      return;
    }
    const accepted = document.getElementById('dd2-entry-legal-acceptance')?.checked === true;
    if (!accepted) {
      setStatus('dd2-auth-status', 'Accept the Terms of Use and acknowledge the Privacy Policy to continue.', 'error');
      return;
    }
    const button = document.getElementById('dd2-entry-consent-submit');
    if (button) button.disabled = true;
    setStatus('dd2-auth-status', 'Recording your acceptance securely…');
    try {
      const { error } = await state.client.rpc('accept_terms', {
        p_terms_version: config.legal.termsVersion,
        p_privacy_version: config.legal.privacyVersion,
        p_acceptance_source: 'protected_feature_sign_in',
      });
      if (error) throw error;
      closeEntry();
      setStatus('dd2-auth-status', '');
      global.toast?.('Terms and Privacy acceptance recorded.', 'ok');
      restoreAuthDestination();
    } catch {
      setStatus('dd2-auth-status', 'Acceptance could not be recorded. Check your connection and try again.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadUserState() {
    if (!state.client || !state.user) return;
    if (deferOnboardingForPrivateBeta()) return;
    const [{ data: profile }, { data: terms }, { data: marketing }] = await Promise.all([
      state.client
        .from('profiles')
        .select('id,display_name,school,enrollment_status,year_level,profile_completed_at,subscription_tier,subscription_status')
        .eq('id', state.user.id)
        .maybeSingle(),
      state.client
        .from('terms_acceptances')
        .select('accepted_at')
        .eq('terms_version', config.legal.termsVersion)
        .eq('privacy_version', config.legal.privacyVersion)
        .limit(1),
      state.client
        .from('marketing_consents')
        .select('opted_in,changed_at')
        .order('changed_at', { ascending: false })
        .limit(1),
    ]);
    state.profile = profile || null;
    state.marketingOptIn = Boolean(marketing?.[0]?.opted_in);
    state.admin = null;
    if (state.session?.access_token && config.features.adminDashboard) {
      try {
        const response = await fetch(`${config.workerUrl}/admin/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.session.access_token}`,
            ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
          },
          body: '{}',
        });
        const admin = await response.json().catch(() => null);
        if (response.ok && admin?.authorized) state.admin = admin;
      } catch {
        state.admin = null;
      }
    }
    syncAuthUi();
    if (!terms?.length) {
      openTermsAcceptance();
    } else {
      closeEntry();
      setOverlay(false, 'dd2-onboarding-overlay');
      global.toast?.(`Welcome back, ${profile?.display_name || state.user?.user_metadata?.full_name || 'future counsel'}.`, 'ok');
      restoreAuthDestination();
    }
  }

  function openOnboarding() {
    if (deferOnboardingForPrivateBeta()) return;
    const displayName = document.getElementById('dd2-display-name');
    const school = document.getElementById('dd2-school');
    const enrollment = document.getElementById('dd2-enrollment-status');
    const year = document.getElementById('dd2-year-level');
    if (displayName) displayName.value = state.profile?.display_name || state.user?.user_metadata?.full_name || '';
    if (school) school.value = state.profile?.school || '';
    if (enrollment) enrollment.value = state.profile?.enrollment_status || 'enrolled';
    if (year) year.value = state.profile?.year_level || '';
    const marketing = document.getElementById('dd2-marketing-consent');
    if (marketing) marketing.checked = state.marketingOptIn;
    const legal = document.getElementById('dd2-legal-acceptance');
    if (legal) legal.checked = false;
    updateEnrollmentFields();
    closeEntry();
    setOverlay(true, 'dd2-onboarding-overlay');
  }

  function updateEnrollmentFields() {
    const enrolled = document.getElementById('dd2-enrollment-status')?.value === 'enrolled';
    const school = document.getElementById('dd2-school');
    const year = document.getElementById('dd2-year-level');
    if (school) school.required = enrolled;
    if (year) year.required = enrolled;
  }

  async function submitOnboarding(event) {
    event.preventDefault();
    if (state.onboardingBusy || !state.client || !state.user) return;
    const displayName = document.getElementById('dd2-display-name').value.trim();
    const school = document.getElementById('dd2-school').value.trim();
    const enrollmentStatus = document.getElementById('dd2-enrollment-status').value;
    const yearLevel = document.getElementById('dd2-year-level').value;
    const accepted = document.getElementById('dd2-legal-acceptance').checked;
    const marketingOptIn = document.getElementById('dd2-marketing-consent').checked;
    const aiImprovementOptIn = document.getElementById('dd2-ai-improvement-consent').checked;
    if (displayName.length < 2) {
      setStatus('dd2-onboarding-status', 'Enter the name you want shown in Due Diligence.', 'error');
      return;
    }
    if (!accepted) {
      setStatus('dd2-onboarding-status', 'Accept the Beta Terms and acknowledge the Privacy Notice to continue.', 'error');
      return;
    }
    if (enrollmentStatus === 'enrolled' && (!school || !yearLevel)) {
      setStatus('dd2-onboarding-status', 'School and year level are required for enrolled students.', 'error');
      return;
    }
    state.onboardingBusy = true;
    const button = document.getElementById('dd2-onboarding-submit');
    if (button) button.disabled = true;
    setStatus('dd2-onboarding-status', 'Saving your chamber…');
    try {
      const { error: termsError } = await state.client.rpc('accept_terms', {
        p_terms_version: config.legal.termsVersion,
        p_privacy_version: config.legal.privacyVersion,
        p_acceptance_source: 'web_onboarding',
      });
      if (termsError) throw termsError;
      const { error: marketingError } = await state.client.rpc('record_marketing_consent', {
        p_opted_in: marketingOptIn,
        p_consent_version: config.legal.marketingConsentVersion,
        p_source: 'web_onboarding',
      });
      if (marketingError) throw marketingError;
      const { error: aiConsentError } = await state.client.rpc('record_ai_improvement_consent', {
        p_opted_in: aiImprovementOptIn,
        p_consent_version: config.legal.aiImprovementConsentVersion,
        p_source: 'web_onboarding',
      });
      if (aiConsentError) throw aiConsentError;
      const { error: profileError } = await state.client.rpc('complete_profile_onboarding', {
        p_display_name: displayName,
        p_school: school || null,
        p_enrollment_status: enrollmentStatus,
        p_year_level: yearLevel || null,
        p_terms_version: config.legal.termsVersion,
        p_privacy_version: config.legal.privacyVersion,
      });
      if (profileError) throw profileError;
      state.profile = {
        ...(state.profile || {}),
        display_name: displayName,
        school: school || null,
        enrollment_status: enrollmentStatus,
        year_level: yearLevel || null,
        profile_completed_at: new Date().toISOString(),
      };
      state.marketingOptIn = marketingOptIn;
      setStatus('dd2-onboarding-status', 'Profile saved.', 'success');
      setOverlay(false, 'dd2-onboarding-overlay');
      syncAuthUi();
      if (typeof onboardingStage !== 'undefined' && onboardingStage === 'signIn') {
        global.completeOnboardingSignIn?.();
      }
      global.toast?.(`Welcome, ${displayName}.`, 'ok');
      global.DueDiligenceAnalytics?.track('onboarding_completed');
      resumePendingSubmission();
    } catch (error) {
      const unavailable = /network|fetch|offline/i.test(String(error?.message || ''));
      setStatus(
        'dd2-onboarding-status',
        unavailable
          ? 'Your profile could not be saved because the connection was interrupted. Reconnect and try again.'
          : 'Your profile could not be saved. Your sign-in is still secure; review the fields and try again.',
        'error',
      );
    } finally {
      state.onboardingBusy = false;
      if (button) button.disabled = false;
    }
  }

  function termsContent() {
    return `
      <div class="dd2-copy">
        <p><strong>Version:</strong> ${escapeHtml(config.legal.termsVersion)}<br>${legalReviewNotice}</p>
        <h3>Educational service</h3>
        <p>Due Diligence is an independent Philippine Bar Examination study platform. It is not affiliated with, certified by, or endorsed by the Supreme Court of the Philippines or any government agency.</p>
        <h3>No legal advice or guaranteed result</h3>
        <p>Questions, suggested answers, scores, AI assessments, and explanations are for education only. They do not constitute legal advice, an official Bar grade, or a guarantee of examination performance. Verify authorities against official sources.</p>
        <h3>AI limitations</h3>
        <p>Gemini helps assess and explain answers using curated platform context. AI output may be incomplete or inaccurate. Use the correction workflow when material appears wrong.</p>
        <h3>AI, grading, and authority limitations</h3>
        <p>AI-generated grading and suggested answers may be incomplete or inaccurate. They are not official Supreme Court or Bar Examiner grades. A “Human Verified” label appears only after a genuine editorial review record exists. Provider capacity may temporarily interrupt grading; no grade or authority will be fabricated.</p>
        <h3>Retainer and access</h3>
        <p>During the current beta, every authenticated account that has accepted the current Beta Terms and Privacy Notice receives Beta All Access while the platform-wide beta setting remains enabled. Beta access is free through at least August 15, 2026 and may continue until the developers determine that beta testing is sufficient. There is no automatic per-user beta expiration while this setting is enabled. Authorized founders may later change the platform-wide setting in the protected Admin dashboard. Security, legal, and acceptable-use restrictions continue to apply.</p>
        <h3>Payments, cancellation, and refunds</h3>
        <p>Commercial terms and payment instructions are not published during beta testing. Any future offer will present its applicable terms before a student is asked to decide.</p>
        <h3>Your submissions</h3>
        <p>You remain responsible for submitted content. Do not submit confidential, privileged, unlawful, or third-party personal information. Service processing of an answer is necessary to provide grading. Separate optional consent governs retention of de-identified answer content for internal quality improvement.</p>
        <h3>Acceptable use</h3>
        <p>Do not scrape the platform, share credentials, bypass access controls, interfere with service, commit fraud, harass others, or submit unlawful material. We may proportionately suspend or terminate access after notice and an opportunity to raise a support complaint, except where immediate action is reasonably necessary for security or law.</p>
        <h3>Ownership and lawful use</h3>
        <p>Due Diligence owns its original software, branding, interface, and proprietary curation. It does not claim ownership over Philippine laws, jurisprudence, government works, or official Bar materials. Unauthorized commercial reproduction and unlawful access may be pursued, while lawful fair use, criticism, reporting, and statutory rights remain respected.</p>
        <h3>Governing law and complaints</h3>
        <p>These Beta Terms are governed by Philippine law. Submit a complaint through Support; we will document and review it before taking further internal action where practicable.</p>
      </div>`;
  }

  function privacyContent() {
    return `
      <div class="dd2-copy">
        <p><strong>Version:</strong> ${escapeHtml(config.legal.privacyVersion)}<br>${legalReviewNotice}</p>
        <h3>What the platform handles</h3>
        <p>For signed-in users, Supabase stores account identity, approved profile fields, legal-document acceptance, marketing preference, roles, and future account records. Google processes the secure sign-in consent flow.</p>
        <h3>Essay assessment</h3>
        <p>Cloudflare routes grading requests to the Due Diligence Worker, which sends the submitted essay and curated question context to Gemini for assessment. Do not place client secrets or confidential case information in practice answers.</p>
        <h3>Access records</h3>
        <p>Protected examinations require authentication. Supabase UUIDs anchor Beta All Access eligibility, legal acceptance, subscriptions, progress, and history so refreshes or device changes do not reset access. Legacy trial and per-account access records remain available only as a fallback if the platform-wide beta setting is later disabled.</p>
        <h3>Support and corrections</h3>
        <p>Support stores the category, message, optional reply email, status, and timestamps. Do not submit examination answers through Support. Correction submissions store only the reviewed correction fields described in that form.</p>
        <h3>Payments and infrastructure</h3>
        <p>Payment amount, channel, date, reference, status, and proof are processed for manual verification. Proofs are private and available only through short-lived authorized review. Supabase, Cloudflare, GitHub Pages, Google authentication, and Gemini process data only as needed for their platform roles.</p>
        <h3>Purpose and legal basis</h3>
        <p>We process account and answer data to perform the requested educational service, secure the platform, prevent fraud, maintain records, and meet legal obligations. Optional marketing and AI-improvement processing relies on separate consent that may be withdrawn.</p>
        <h3>Retention and security</h3>
        <p>Account, legal-acceptance, grading, payment, support, and audit records are retained only as needed for the service, disputes, security, and applicable law. Payment proofs are removed under the approved retention schedule. Controls include least-privilege access, private storage, row-level security, authenticated Worker routes, and audit trails.</p>
        <h3>Your rights</h3>
        <p>You may request access, correction, deletion where applicable, restriction, objection, consent withdrawal, or account-recovery assistance through Support. Identity verification may be required. Google identity transfer is not offered unless the same internal UUID and attached data can be preserved safely.</p>
        <h3>AI-improvement choice</h3>
        <p>Answer processing for an immediate grade is required service processing. Retaining de-identified answer content for internal model, rubric, and quality improvement is optional and may be withdrawn without losing paid simulator access.</p>
      </div>`;
  }

  function pricingContent() {
    const features = [
      'All published Subject Matter practice categories',
      'Premium-only Bar Feels',
      'Private examination uploads',
      'Automated and Human Examiner review routes',
    ];
    return `
      <div class="dd2-copy">
        <p><strong>Pricing will be announced after beta testing.</strong></p>
        <div class="dd2-plan-grid">
          <article class="dd2-plan">
            <div class="dd2-plan-head">
              <div><h3>Premium</h3><span class="dd2-badge">Beta access active</span></div>
              <div class="dd2-price dd2-price-placeholder" aria-hidden="true">
                <span>000</span><small> beta preview</small>
              </div>
            </div>
            <ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
            <button class="dd2-button dd2-button-secondary" type="button" disabled>
              Pricing available after beta
            </button>
          </article>
        </div>
        <p>Premium remains clearly identified while commercial details stay private during beta testing.</p>
      </div>`;
  }

  function supportContent() {
    if (!state.session?.access_token) {
      return `
        <div class="dd2-copy dd2-auth-gate">
          <p>Support requests are attached to a verified account so we can protect your request and reply securely.</p>
          <button class="dd2-button dd2-button-primary" id="dd2-support-signin" type="button">Sign in to contact Support</button>
          <p class="dd2-form-note">Viewing help information remains public. Sending a request requires sign-in.</p>
        </div>`;
    }
    return `
      <div class="dd2-copy">
        <p>Request technical, account, accessibility, or content help without leaving Due Diligence. Do not paste an examination answer here.</p>
        <form class="dd2-form" id="dd2-support-form">
          <label class="dd2-label">Category
            <select class="dd2-field" id="dd2-support-category" required>
              <option value="technical">Technical issue</option>
              <option value="account">The Docket</option>
              <option value="account_recovery">Docket Recovery</option>
              <option value="content">Content or source</option>
              <option value="accessibility">Accessibility</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="dd2-label">Reply email (optional)
            <input class="dd2-field" id="dd2-support-email" type="email" maxlength="254" autocomplete="email">
          </label>
          <label class="dd2-label">Message
            <textarea class="dd2-field" id="dd2-support-message" minlength="20" maxlength="4000" required
              placeholder="Describe what happened, what you expected, and the browser or device you used."></textarea>
          </label>
          <div class="dd2-status" id="dd2-support-status" role="status" aria-live="polite"></div>
          <button class="dd2-button dd2-button-primary" id="dd2-support-submit" type="submit">Send Support request</button>
        </form>
        <h3>Frequently asked</h3>
        <p><strong>How is an answer scored?</strong><br>Each answer receives an independent 0–5 ALAC assessment. It is not an official Bar grade.</p>
        <p><strong>How does free access work?</strong><br>Every authenticated student who accepts the current Beta Terms and Privacy Notice receives Beta All Access while the platform-wide setting is enabled. It is free through at least August 15, 2026 and may continue until the developers determine that beta testing is sufficient. There is no automatic per-user expiration during that period.</p>
        <p><strong>Where should I report a model-answer issue?</strong><br>Use “Suggest a Correction/Better Answer” beneath the assessment so the editorial context stays attached.</p>
      </div>`;
  }

  function accountContent() {
    if (!state.user) {
      return `
        <div class="dd2-copy">
          <p>Sign in with Google to create an account, save approved profile information, and prepare for personal analytics.</p>
          <button class="dd2-button dd2-button-primary" id="dd2-account-signin" type="button">Continue with Google</button>
        </div>`;
    }
    const name = state.profile?.display_name || state.user.user_metadata?.full_name || 'Due Diligence student';
    return `
      <div class="dd2-account-summary">
        <div class="dd2-account-avatar">${escapeHtml(initials())}</div>
        <div><strong>${escapeHtml(name)}</strong><span>Signed in securely with Google</span></div>
      </div>
      <form class="dd2-form" id="dd2-account-form">
        <label class="dd2-label">Display name
          <input class="dd2-field" id="dd2-account-name" value="${escapeHtml(state.profile?.display_name || '')}" maxlength="120" required>
        </label>
        <label class="dd2-label">Enrollment status
          <select class="dd2-field" id="dd2-account-enrollment">
            <option value="enrolled"${state.profile?.enrollment_status === 'enrolled' ? ' selected' : ''}>Currently enrolled</option>
            <option value="not_yet_enrolled"${state.profile?.enrollment_status === 'not_yet_enrolled' ? ' selected' : ''}>Not yet enrolled</option>
          </select>
        </label>
        <label class="dd2-label">Law school
          <input class="dd2-field" id="dd2-account-school" value="${escapeHtml(state.profile?.school || '')}" maxlength="180">
        </label>
        <label class="dd2-label">Year level
          <select class="dd2-field" id="dd2-account-year">
            <option value="">Select year level</option>
            ${['1', '2', '3', '4', 'review'].map((value) => `<option value="${value}"${state.profile?.year_level === value ? ' selected' : ''}>${value === 'review' ? 'Graduate / Bar review' : `${value}${value === '1' ? 'st' : value === '2' ? 'nd' : value === '3' ? 'rd' : 'th'} year`}</option>`).join('')}
          </select>
        </label>
        <label class="dd2-check">
          <input type="checkbox" id="dd2-account-marketing"${state.marketingOptIn ? ' checked' : ''}>
          <span>Receive optional product and Bar-review updates.</span>
        </label>
        <div class="dd2-status" id="dd2-account-status" role="status" aria-live="polite"></div>
        <button class="dd2-button dd2-button-primary" type="submit">Save approved profile fields</button>
        <button class="dd2-button dd2-button-secondary" id="dd2-logout" type="button">Sign out</button>
      </form>
      <div class="dd2-copy">
        ${state.admin?.authorized ? `
          <h3>Administration</h3>
          <p>Your account has verified administrator access.</p>
          <a class="dd2-button dd2-button-primary" href="/admin/">Open Chambers</a>
        ` : ''}
        <h3>Docket recovery</h3>
        <p>Contact Support. We respond within 24 hours.</p>
        <p>Direct public email changes and account transfers are not available. Choose Docket Recovery in Support so identity verification can be documented safely.</p>
        <h3>Retainer and access</h3>
        <div id="dd2-account-access"><p>Loading verified access status…</p></div>
        <h3>Premium beta</h3>
        <p><strong>Beta access active.</strong> Pricing will be announced after beta testing.</p>
        <p class="dd2-form-note">Initial response target: 24 hours. Ordinary internal resolution: seven calendar days; complex review may take up to 14 days without waiving statutory remedies.</p>
      </div>`;
  }

  function partnershipContent() {
    if (!state.session?.access_token) {
      return `
        <div class="dd2-copy dd2-auth-gate">
          <p>Partnership inquiries require a verified account to reduce impersonation and protect follow-up correspondence.</p>
          <button class="dd2-button dd2-button-primary" id="dd2-partnership-signin" type="button">Sign in to send an inquiry</button>
        </div>`;
    }
    return `
      <div class="dd2-copy">
        <p>Discuss institutional licensing, academic collaboration, technology, content, or media opportunities without leaving Due Diligence.</p>
        <form class="dd2-form" id="dd2-partnership-form">
          <label class="dd2-label">Inquiry type
            <select class="dd2-field" id="dd2-partnership-type" required>
              <option value="institutional_license">Institutional license</option>
              <option value="academic_partnership">Academic partnership</option>
              <option value="content_collaboration">Content collaboration</option>
              <option value="technology_partnership">Technology partnership</option>
              <option value="media">Media inquiry</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="dd2-label">Name
            <input class="dd2-field" id="dd2-partnership-name" minlength="2" maxlength="120" autocomplete="name" required>
          </label>
          <label class="dd2-label">Contact email
            <input class="dd2-field" id="dd2-partnership-email" type="email" maxlength="254" autocomplete="email" required>
          </label>
          <label class="dd2-label">Organization (optional)
            <input class="dd2-field" id="dd2-partnership-organization" maxlength="180" autocomplete="organization">
          </label>
          <label class="dd2-label">Message
            <textarea class="dd2-field" id="dd2-partnership-message" minlength="20" maxlength="5000" required></textarea>
          </label>
          <label class="dd2-check">
            <input type="checkbox" id="dd2-partnership-consent" required>
            <span>I consent to the founders using these details to respond to this inquiry.</span>
          </label>
          <div class="dd2-status" id="dd2-partnership-status" role="status" aria-live="polite"></div>
          <button class="dd2-button dd2-button-primary" id="dd2-partnership-submit" type="submit">Send Partnership inquiry</button>
        </form>
        <p>For a direct follow-up, write to <a href="mailto:invest@duediligence.ph?subject=Investment%20Inquiry">invest@duediligence.ph</a>.</p>
      </div>`;
  }

  function nativeDefinition(view) {
    const definitions = {
      support: ['Member assistance', 'Support', supportContent],
      pricing: ['Access options', 'Retainer', pricingContent],
      terms: ['Legal', 'Beta Terms', termsContent],
      privacy: ['Legal', 'Beta Privacy Notice', privacyContent],
      account: ['Your chamber', 'The Docket', accountContent],
      partnership: ['Collaborate', 'Partnerships', partnershipContent],
    };
    return definitions[view] || null;
  }

  function renderNativeView(view, options = {}) {
    const definition = nativeDefinition(view);
    if (!definition) {
      hideNativeView();
      return;
    }
    state.nativeView = view;
    document.getElementById('dd2-native-kicker').textContent = definition[0];
    document.getElementById('dd2-native-title').textContent = definition[1];
    document.getElementById('dd2-native-body').innerHTML = definition[2]();
    setOverlay(true, 'dd2-native-view');
    bindNativeViewHandlers(view);
    if (options.push !== false) {
      const updateHistory = history.state?.dd2View ? 'replaceState' : 'pushState';
      history[updateHistory]({ dd2View: view }, '', `#${view}`);
    }
  }

  function hideNativeView() {
    state.nativeView = null;
    setOverlay(false, 'dd2-native-view');
  }

  function closeNativeView() {
    const shouldRewindHistory = Boolean(history.state?.dd2View);
    hideNativeView();
    if (shouldRewindHistory) history.back();
  }

  async function submitSupport(event) {
    event.preventDefault();
    const submit = document.getElementById('dd2-support-submit');
    const payload = {
      category: document.getElementById('dd2-support-category').value,
      message: document.getElementById('dd2-support-message').value.trim(),
      replyEmail: document.getElementById('dd2-support-email').value.trim(),
    };
    if (!requireSubmissionAuthentication('support', payload)) return;
    if (payload.message.length < 20) {
      setStatus('dd2-support-status', 'Describe the issue in at least 20 characters.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('dd2-support-status', 'You appear to be offline. Reconnect and try again.', 'error');
      return;
    }
    submit.disabled = true;
    setStatus('dd2-support-status', 'Sending securely…');
    try {
      await nativeWorkerRequest('/support', {
        body: payload,
        submissionView: 'support',
        submissionDraft: payload,
      });
      document.getElementById('dd2-support-form').reset();
      setStatus('dd2-support-status', 'Your Support request was received.', 'success');
      global.DueDiligenceAnalytics?.track('support_submitted', {
        resultCategory: payload.category,
      });
    } catch (error) {
      setStatus('dd2-support-status', error.message || 'Your Support request could not be submitted. Please retry.', 'error');
      submit.disabled = false;
    }
  }

  async function nativeWorkerRequest(path, options = {}) {
    const form = options.body instanceof FormData;
    const headers = {
      'X-Request-ID': options.requestId || randomId(18),
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      ...(state.session?.access_token
        ? { Authorization: `Bearer ${state.session.access_token}` }
        : {}),
    };
    if (!state.session?.access_token || !state.user) {
      requireSubmissionAuthentication(
        options.submissionView || 'account',
        options.submissionDraft || {},
      );
      throw new Error('Sign in with Google to continue.');
    }
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers,
      body: form ? options.body : JSON.stringify(options.body || {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error?.message || 'The request could not be completed.');
      error.code = payload?.error?.code
        || (response.status === 401 ? 'AUTHENTICATION_REQUIRED' : 'REQUEST_FAILED');
      if (response.status === 401
          || ['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error.code)) {
        await handleSubmissionUnauthorized(
          options.submissionView || 'account',
          options.submissionDraft || {},
        );
      }
      throw error;
    }
    return payload;
  }

  async function loadBillingAndAccess() {
    if (!state.session?.access_token) return;
    try {
      const accessPayload = await nativeWorkerRequest('/access', { requestId: randomId(18) });
      const access = accessPayload.access || {};
      const accountAccess = document.getElementById('dd2-account-access');
      if (accountAccess) {
        const globalBetaActive = access.globalBeta?.active === true;
        const trial = access.trial?.expiresAt
          ? `Trial expires ${new Date(access.trial.expiresAt).toLocaleString()}.`
          : 'Trial begins only when you open your first protected examination.';
        accountAccess.innerHTML = `
          <div class="dd2-access-summary">
            <strong>${globalBetaActive ? 'Beta All Access' : access.premium ? 'Premium beta access' : 'Beta access'}</strong>
            <span>${globalBetaActive
              ? 'All current beta features are available at no charge while the platform-wide Admin setting remains enabled.'
              : 'Pricing will be announced after beta testing.'}</span>
            <span>${globalBetaActive
              ? 'Free through at least August 15, 2026 and may continue until developers determine beta testing is sufficient.'
              : escapeHtml(trial)}</span>
          </div>`;
      }
    } catch (error) {
      const element = document.getElementById('dd2-account-access');
      if (element) element.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    }
  }

  async function submitPartnership(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById('dd2-partnership-submit');
    const draft = {
      inquiryType: document.getElementById('dd2-partnership-type').value,
      contactName: document.getElementById('dd2-partnership-name').value.trim(),
      contactEmail: document.getElementById('dd2-partnership-email').value.trim(),
      organization: document.getElementById('dd2-partnership-organization').value.trim(),
      message: document.getElementById('dd2-partnership-message').value.trim(),
      consent: document.getElementById('dd2-partnership-consent').checked,
    };
    if (!requireSubmissionAuthentication('partnership', draft)) return;
    submit.disabled = true;
    setStatus('dd2-partnership-status', 'Sending securely…');
    try {
      const payload = await nativeWorkerRequest('/partnerships', {
        body: draft,
        submissionView: 'partnership',
        submissionDraft: draft,
      });
      form.reset();
      setStatus('dd2-partnership-status', payload.message, 'success');
    } catch (error) {
      setStatus('dd2-partnership-status', error.message, 'error');
      submit.disabled = false;
    }
  }

  async function submitAccount(event) {
    event.preventDefault();
    if (!state.client || !state.user) return;
    const values = {
      displayName: document.getElementById('dd2-account-name').value.trim(),
      enrollmentStatus: document.getElementById('dd2-account-enrollment').value,
      school: document.getElementById('dd2-account-school').value.trim(),
      yearLevel: document.getElementById('dd2-account-year').value,
      marketing: document.getElementById('dd2-account-marketing').checked,
    };
    if (values.displayName.length < 2
      || (values.enrollmentStatus === 'enrolled' && (!values.school || !values.yearLevel))) {
      setStatus('dd2-account-status', 'Complete the required profile fields.', 'error');
      return;
    }
    setStatus('dd2-account-status', 'Saving…');
    try {
      const { error: profileError } = await state.client.rpc('complete_profile_onboarding', {
        p_display_name: values.displayName,
        p_school: values.school || null,
        p_enrollment_status: values.enrollmentStatus,
        p_year_level: values.yearLevel || null,
        p_terms_version: config.legal.termsVersion,
        p_privacy_version: config.legal.privacyVersion,
      });
      if (profileError) throw profileError;
      const { error: marketingError } = await state.client.rpc('record_marketing_consent', {
        p_opted_in: values.marketing,
        p_consent_version: config.legal.marketingConsentVersion,
        p_source: 'account_settings',
      });
      if (marketingError) throw marketingError;
      state.profile = {
        ...state.profile,
        display_name: values.displayName,
        enrollment_status: values.enrollmentStatus,
        school: values.school || null,
        year_level: values.yearLevel || null,
      };
      state.marketingOptIn = values.marketing;
      syncAuthUi();
      setStatus('dd2-account-status', 'Docket preferences saved.', 'success');
    } catch {
      setStatus('dd2-account-status', 'Docket preferences could not be saved. Please try again.', 'error');
    }
  }

  async function signOut() {
    if (!state.client) return;
    const { error } = await state.client.auth.signOut();
    if (error) {
      setStatus('dd2-account-status', 'Sign-out could not be completed. Please retry.', 'error');
      return;
    }
    state.session = null;
    state.user = null;
    state.profile = null;
    state.marketingOptIn = false;
    global.DueDiligencePrivateBeta?.clear?.();
    syncAuthUi();
    hideNativeView();
    closeEntry();
  }

  function bindNativeViewHandlers(view) {
    document.getElementById('dd2-support-form')?.addEventListener('submit', submitSupport);
    document.getElementById('dd2-account-form')?.addEventListener('submit', submitAccount);
    document.getElementById('dd2-partnership-form')?.addEventListener('submit', submitPartnership);
    document.getElementById('dd2-logout')?.addEventListener('click', signOut);
    document.getElementById('dd2-account-signin')?.addEventListener('click', () => {
      hideNativeView();
      showEntry({ allowDismiss: true });
    });
    document.getElementById('dd2-support-signin')?.addEventListener('click', () => {
      requireSubmissionAuthentication('support');
    });
    document.getElementById('dd2-partnership-signin')?.addEventListener('click', () => {
      requireSubmissionAuthentication('partnership');
    });
    if (view === 'account') {
      document.getElementById('dd2-account-enrollment')?.addEventListener('change', () => {
        const enrolled = document.getElementById('dd2-account-enrollment').value === 'enrolled';
        document.getElementById('dd2-account-school').required = enrolled;
        document.getElementById('dd2-account-year').required = enrolled;
      });
    }
    if (['pricing','account'].includes(view) && state.user) {
      loadBillingAndAccess();
    }
  }

  function bindNavigation() {
    const signIn = document.getElementById('btn-signin');
    if (signIn) signIn.onclick = null;
    signIn?.addEventListener('click', () => (
      state.user ? renderNativeView('account') : showEntry({ allowDismiss: true })
    ));

    const feedback = document.getElementById('btn-open-feedback');
    feedback?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderNativeView('support');
    }, true);

    document.querySelectorAll('a[href^="mailto:support@duediligence.ph"]').forEach((link) => {
      link.setAttribute('href', '#support');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        renderNativeView('support');
      });
    });
    document.querySelectorAll('a[href^="mailto:premium@duediligence.ph"]').forEach((link) => {
      link.setAttribute('href', '#pricing');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        renderNativeView('pricing');
      });
    });
    document.querySelectorAll('[data-dd2-view="partnership"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        renderNativeView('partnership');
      });
    });
  }

  async function initializeAuth() {
    if (!global.supabase?.createClient) {
      syncAuthUi();
      return;
    }
    state.client = global.supabase.createClient(
      config.supabase.url,
      config.supabase.publishableKey,
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          storage: global.sessionStorage,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
    const { data, error: sessionError } = await state.client.auth.getSession();
    state.session = sessionError ? null : data?.session || null;
    state.user = state.session?.user || null;
    syncAuthUi();
    global.dispatchEvent(new CustomEvent('duediligence:session', {
      detail: {
        authenticated: Boolean(state.session?.access_token),
        userId: state.user?.id || null,
      },
    }));
    if (state.user) closeEntry();
    if (state.session?.access_token) {
      safeSessionRemove(authAttemptStorageKey);
      resetGoogleSignIn();
      setTimeout(() => notifyOwnerOfSuccessfulSignIn(state.session), 0);
    } else if (new URLSearchParams(location.search).has('error')) {
      resetGoogleSignIn('Google sign-in was not completed. You can try again now.', 'error');
    }

    state.client.auth.onAuthStateChange((event, session) => {
      state.session = session || null;
      state.user = session?.user || null;
      if (session?.access_token) {
        safeSessionRemove(authAttemptStorageKey);
        resetGoogleSignIn();
      } else if (event === 'SIGNED_OUT') {
        state.privateBetaAllowed = config.features?.privateBetaGate !== true;
        global.DueDiligencePrivateBeta?.clear?.();
        resetGoogleSignIn();
      }
      syncAuthUi();
      global.dispatchEvent(new CustomEvent('duediligence:session', {
        detail: {
          authenticated: Boolean(state.session?.access_token),
          userId: state.user?.id || null,
        },
      }));
      if (session && ['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) {
        closeEntry();
        if (event === 'SIGNED_IN') {
          global.DueDiligenceAnalytics?.track('sign_in_completed');
          setTimeout(() => notifyOwnerOfSuccessfulSignIn(session), 0);
          const createdAt = new Date(session.user?.created_at || 0).getTime();
          if (createdAt && Date.now() - createdAt < 10 * 60 * 1000) {
            global.DueDiligenceAnalytics?.track('registration_completed');
          }
        }
        setTimeout(() => loadUserState(), 0);
      }
    });

    if (state.user) await loadUserState();
    if (new URLSearchParams(location.search).has('auth')
        || new URLSearchParams(location.search).has('code')
        || new URLSearchParams(location.search).has('error')) {
      history.replaceState({}, '', `${location.pathname}${location.hash || ''}`);
    }
  }

  async function recoverAuthAfterNavigation() {
    if (!state.client) {
      resetGoogleSignIn();
      return;
    }
    try {
      const { data } = await state.client.auth.getSession();
      if (data?.session?.access_token) {
        state.session = data.session;
        state.user = data.session.user || null;
        safeSessionRemove(authAttemptStorageKey);
        resetGoogleSignIn();
        syncAuthUi();
        return;
      }
    } catch {
      // The retry control is restored below.
    }
    if (safeSessionRead(authAttemptStorageKey) || state.authInFlight) {
      safeSessionRemove(authAttemptStorageKey);
      resetGoogleSignIn('Google sign-in was not completed. You can try again now.', 'error');
    } else {
      resetGoogleSignIn();
    }
  }

  async function requestGuestAccessStatus(headers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetch(`${config.workerUrl}/guest-access`, {
        method: 'POST',
        headers: {
          ...headers,
          ...(globalThis.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload.access) {
        const error = new Error(
          payload?.error?.message || 'Guest access could not be checked.',
        );
        error.code = payload?.error?.code || 'GUEST_ACCESS_UNAVAILABLE';
        throw error;
      }
      return payload.access;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function reconcileGuestAccess(options = {}) {
    const promptWhenExhausted = options.promptWhenExhausted === true;
    let access;
    try {
      if (state.session?.access_token) {
        try {
          access = await requestGuestAccessStatus({
            Authorization: `Bearer ${state.session.access_token}`,
          });
        } catch (error) {
          if (error?.code !== 'INVALID_SESSION') throw error;
          state.session = null;
          state.user = null;
          state.profile = null;
          state.admin = null;
          syncAuthUi();
          access = await requestGuestAccessStatus({
            'X-Guest-Device-ID': guestDeviceId(),
          });
        }
      } else {
        access = await requestGuestAccessStatus({
          'X-Guest-Device-ID': guestDeviceId(),
        });
      }
    } catch {
      return { known: false, signedIn: Boolean(state.session?.access_token), exhausted: false };
    }

    if (access.signedIn) {
      state.guestUsage = null;
      syncAuthUi();
      return { known: true, signedIn: true, exhausted: false };
    }

    state.guestUsage = {
      remaining: Math.max(0, Math.min(config.guest.gradeLimit, Number(access.guest?.remaining) || 0)),
      completed: Math.max(0, Math.min(config.guest.gradeLimit, Number(access.guest?.completed) || 0)),
    };
    syncAuthUi();
    const exhausted = state.guestUsage.remaining === 0;
    if (exhausted && promptWhenExhausted) requireSignInForGuestLimit();
    return { known: true, signedIn: false, exhausted };
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    injectShell();
    bindNavigation();
    document.getElementById('dd2-google-signin')?.addEventListener('click', signInWithGoogle);
    document.getElementById('dd2-entry-consent')?.addEventListener('submit', submitEntryConsent);
    document.getElementById('dd2-guest-continue')?.addEventListener('click', continueGuestFromEntry);
    document.getElementById('dd2-entry-close')?.addEventListener('click', returnFromEntry);
    document.getElementById('dd2-entry-back')?.addEventListener('click', returnFromEntry);
    document.getElementById('dd2-entry-overlay')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget && event.currentTarget.dataset.dismissible === 'true') {
        closeEntry();
      }
    });
    document.getElementById('dd2-onboarding-form')?.addEventListener('submit', submitOnboarding);
    document.getElementById('dd2-enrollment-status')?.addEventListener('change', updateEnrollmentFields);
    document.getElementById('dd2-onboarding-close')?.addEventListener('click', returnFromOnboarding);
    document.getElementById('dd2-onboarding-back')?.addEventListener('click', returnFromOnboarding);
    document.getElementById('dd2-native-close')?.addEventListener('click', closeNativeView);
    document.getElementById('dd2-native-back')?.addEventListener('click', closeNativeView);
    document.getElementById('dd2-native-view')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget && state.nativeView) closeNativeView();
    });
    document.getElementById('dd2-reminder-continue')?.addEventListener('click', continueFromGuestReminder);
    document.getElementById('dd2-reminder-close')?.addEventListener('click', continueFromGuestReminder);
    document.getElementById('dd2-reminder-back')?.addEventListener('click', continueFromGuestReminder);
    document.getElementById('dd2-reminder-signin')?.addEventListener('click', () => {
      setOverlay(false, 'dd2-guest-reminder');
      state.reminderResolve?.(false);
      state.reminderResolve = null;
      showEntry();
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-dd2-view]');
      if (button) renderNativeView(button.dataset.dd2View);
    });
    document.addEventListener('keydown', (event) => {
      trapOverlayFocus(event);
      const entryOverlay = document.getElementById('dd2-entry-overlay');
      if (event.key === 'Escape'
          && entryOverlay?.getAttribute('aria-hidden') === 'false') {
        event.preventDefault();
        returnFromEntry();
        return;
      }
      if (event.key === 'Escape' && state.nativeView) {
        event.preventDefault();
        closeNativeView();
        return;
      }
      if (event.key === 'Escape'
          && document.getElementById('dd2-onboarding-overlay')?.getAttribute('aria-hidden') === 'false') {
        event.preventDefault();
        returnFromOnboarding();
        return;
      }
      if (event.key === 'Escape'
          && document.getElementById('dd2-guest-reminder')?.getAttribute('aria-hidden') === 'false') {
        event.preventDefault();
        continueFromGuestReminder();
      }
    });
    global.addEventListener('popstate', () => {
      syncEntryWithHistoryRoute();
      const hashView = location.hash.replace(/^#/, '');
      if (nativeDefinition(hashView)) renderNativeView(hashView, { push: false });
      else hideNativeView();
    });
    global.addEventListener('pageshow', recoverAuthAfterNavigation);
    global.addEventListener('duediligence:private-beta-access', (event) => {
      state.privateBetaAllowed = config.features?.privateBetaGate !== true
        || event.detail?.allowed === true;
      if (!state.privateBetaAllowed) {
        setOverlay(false, 'dd2-onboarding-overlay');
        return;
      }
      if (state.user) {
        loadUserState().catch(() => {
          global.toast?.('Your profile could not be loaded. Refresh and try again.', 'warn');
        });
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible'
          && state.authInFlight
          && Date.now() - state.authStartedAt > 1_000) {
        recoverAuthAfterNavigation();
      }
    });
    await initializeAuth();
    if (!state.user) syncAuthUi();
  }

  async function beforeGrade() {
    if (state.session?.access_token && state.user) return true;
    const questionId = typeof currentSubj !== 'undefined'
      && typeof currentIdx !== 'undefined'
      && typeof BAR_QUESTIONS !== 'undefined'
      ? BAR_QUESTIONS?.[currentSubj]?.[currentIdx]?.id || ''
      : '';
    requireSubmissionAuthentication('grade', { questionId });
    return false;
  }

  function gradingHeaders() {
    if (state.session?.access_token) {
      return {
        Authorization: `Bearer ${state.session.access_token}`,
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      };
    }
    return {
      'X-Request-ID': randomId(18),
      ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
    };
  }

  function afterGrade(access) {
    if (access?.signedIn || !access?.guest) return;
    state.guestUsage = {
      remaining: Number(access.guest.remaining) || 0,
      completed: Number(access.guest.completed) || 0,
    };
    syncAuthUi();
    if (state.guestUsage.remaining === 2) global.toast?.('2 guest grades remaining.', 'ok');
    if (state.guestUsage.remaining === 1) global.toast?.('1 guest grade remaining.', 'warn');
    if (state.guestUsage.remaining === 0) {
      setTimeout(requireSignInForGuestLimit, 900);
    }
  }

  function handleGradeError(error) {
    if (!['GUEST_LIMIT_REACHED', 'AUTHENTICATION_REQUIRED', 'INVALID_SESSION'].includes(error?.code)) {
      return false;
    }
    if (typeof examStage !== 'undefined') examStage = 'answering';
    global.closeModal?.('checking-modal', { restoreFocus: false });
    if (error?.code === 'GUEST_LIMIT_REACHED') requireSignInForGuestLimit();
    else handleSubmissionUnauthorized('grade', {
      questionId: typeof currentSubj !== 'undefined' && typeof currentIdx !== 'undefined'
        && typeof BAR_QUESTIONS !== 'undefined'
        ? BAR_QUESTIONS?.[currentSubj]?.[currentIdx]?.id || ''
        : '',
    });
    return true;
  }

  global.DueDiligencePhase2 = Object.freeze({
    initialize,
    beforeGrade,
    gradingHeaders,
    afterGrade,
    handleGradeError,
    openView: renderNativeView,
    openSignIn: showEntry,
    requireSubmissionAuthentication,
    handleSubmissionUnauthorized,
    getSession: () => state.session,
    config,
  });

  global.beginOnboardingSignIn = () => {
    global.closeModal?.('signin-prompt-modal', { restoreFocus: false });
    showEntry();
  };
  global.mockAuth = (provider) => {
    if (provider === 'Google') signInWithGoogle();
    else global.toast?.(`${provider} sign-in is not active in this Beta.`, 'warn');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
