(function phase2Experience(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  if (!config) return;

  const state = {
    client: null,
    session: null,
    user: null,
    profile: null,
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
    sessionRefreshPromise: null,
    userStatePromise: null,
    userStateUserId: null,
    welcomedUserId: null,
    sessionEventInitialized: false,
    lastSessionEventUserId: null,
    lastSessionEventAccessToken: null,
    authReturnPending: isAuthenticationReturn(),
  };

  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });

  const originalContinueAsGuest = global.continueAsGuest;
  let commercialLegal = Object.freeze({
    termsVersion: config.legal.termsVersion,
    privacyVersion: config.legal.privacyVersion,
  });
  const legalReviewNotice = 'Commercial launch document — prepared for independent legal review.';
  const lawSchools = Object.freeze([
    ['adamson-university', 'Adamson University'],
    ['aemilianum-college', 'Aemilianum College'],
    ['aklan-catholic-college', 'Aklan Catholic College'],
    ['andres-bonifacio-college', 'Andres Bonifacio College'],
    ['angeles-university-foundation', 'Angeles University Foundation'],
    ['araullo-university', 'Araullo University'],
    ['arellano-university', 'Arellano University'],
    ['ateneo-de-davao-university', 'Ateneo de Davao University'],
    ['ateneo-de-manila-university', 'Ateneo de Manila University'],
    ['ateneo-de-naga-university', 'Ateneo de Naga University'],
    ['ateneo-de-zamboanga-university', 'Ateneo de Zamboanga University'],
    ['batangas-state-university', 'Batangas State University'],
    ['bicol-college', 'Bicol College'],
    ['bicol-university', 'Bicol University'],
    ['bit-international-college', 'BIT International College'],
    ['bukidnon-state-university', 'Bukidnon State University'],
    ['bulacan-state-university', 'Bulacan State University'],
    ['cagayan-state-university', 'Cagayan State University'],
    ['cainta-catholic-college', 'Cainta Catholic College'],
    ['catanduanes-state-university', 'Catanduanes State University'],
    ['central-philippine-university', 'Central Philippine University'],
    ['centro-escolar-university', 'Centro Escolar University'],
    ['city-university-of-pasay', 'City University of Pasay'],
    ['colegio-de-la-purisima-concepcion', 'Colegio de la Purisima Concepcion'],
    ['cor-jesu-college', 'Cor Jesu College'],
    ['cotabato-state-university', 'Cotabato State University'],
    ['de-la-salle-lipa', 'De La Salle Lipa'],
    ['de-la-salle-university', 'De La Salle University'],
    ['de-la-salle-university-dasmarinas', 'De La Salle University – Dasmariñas'],
    ['dmc-college-foundation', 'DMC College Foundation'],
    ['don-mariano-marcos-memorial-state-university', 'Don Mariano Marcos Memorial State University'],
    ['dr-v-orestes-romualdez-educational-foundation', 'Dr. V. Orestes Romualdez Educational Foundation'],
    ['eastern-samar-state-university', 'Eastern Samar State University'],
    ['far-eastern-university', 'Far Eastern University'],
    ['father-saturnino-urios-university', 'Father Saturnino Urios University'],
    ['foundation-university', 'Foundation University'],
    ['holy-name-university', 'Holy Name University'],
    ['isabela-state-university-cauayan', 'Isabela State University – Cauayan Campus'],
    ['jose-rizal-memorial-state-university', 'Jose Rizal Memorial State University'],
    ['jose-rizal-university', 'Jose Rizal University'],
    ['josefina-h-cerilles-state-college', 'Josefina H. Cerilles State College – Pagadian Campus'],
    ['kalinga-state-university', 'Kalinga State University'],
    ['laguna-state-polytechnic-university', 'Laguna State Polytechnic University – Santa Cruz Campus'],
    ['leyte-colleges', 'Leyte Colleges'],
    ['liceo-de-cagayan-university', 'Liceo de Cagayan University'],
    ['lyceum-of-the-philippines-university', 'Lyceum of the Philippines University'],
    ['lyceum-northwestern-university', 'Lyceum Northwestern University'],
    ['manila-law-college', 'Manila Law College'],
    ['manuel-l-quezon-university', 'Manuel L. Quezon University'],
    ['manuel-s-enverga-university-foundation', 'Manuel S. Enverga University Foundation'],
    ['mariano-marcos-state-university', 'Mariano Marcos State University'],
    ['mindanao-state-university', 'Mindanao State University'],
    ['misamis-university', 'Misamis University'],
    ['new-era-university', 'New Era University'],
    ['northeastern-college', 'Northeastern College'],
    ['notre-dame-university', 'Notre Dame University'],
    ['northwestern-university', 'Northwestern University'],
    ['palawan-state-university', 'Palawan State University'],
    ['pamantasan-ng-lungsod-ng-maynila', 'Pamantasan ng Lungsod ng Maynila'],
    ['pampanga-state-university', 'Pampanga State University'],
    ['panpacific-university', 'Panpacific University'],
    ['philippine-christian-university', 'Philippine Christian University'],
    ['philippine-law-school', 'Philippine Law School'],
    ['polytechnic-university-of-the-philippines', 'Polytechnic University of the Philippines'],
    ['saint-louis-university', 'Saint Louis University'],
    ['saint-louis-college', 'Saint Louis College'],
    ['saint-marys-university', 'Saint Mary’s University'],
    ['saint-pauls-school-of-professional-studies', 'Saint Paul’s School of Professional Studies'],
    ['san-beda-university', 'San Beda University'],
    ['san-beda-college-alabang', 'San Beda College Alabang'],
    ['san-pablo-colleges', 'San Pablo Colleges'],
    ['san-sebastian-college-recoletos', 'San Sebastian College-Recoletos'],
    ['silliman-university', 'Silliman University'],
    ['st-dominic-savio-college', 'St. Dominic Savio College'],
    ['st-marys-college-of-tagum', 'St. Mary’s College of Tagum'],
    ['st-thomas-more-school-of-law-and-business', 'St. Thomas More School of Law and Business'],
    ['sultan-kudarat-state-university', 'Sultan Kudarat State University'],
    ['tarlac-state-university', 'Tarlac State University'],
    ['the-college-of-maasin', 'The College of Maasin'],
    ['universidad-de-manila', 'Universidad de Manila'],
    ['university-of-baguio', 'University of Baguio'],
    ['university-of-batangas', 'University of Batangas'],
    ['university-of-bohol', 'University of Bohol'],
    ['university-of-cagayan-valley', 'University of Cagayan Valley'],
    ['university-of-cebu', 'University of Cebu'],
    ['university-of-eastern-philippines', 'University of Eastern Philippines'],
    ['university-of-iloilo', 'University of Iloilo'],
    ['university-of-la-salette', 'University of La Salette'],
    ['university-of-makati', 'University of Makati'],
    ['university-of-mindanao', 'University of Mindanao'],
    ['university-of-negros-occidental-recoletos', 'University of Negros Occidental-Recoletos'],
    ['university-of-nueva-caceres', 'University of Nueva Caceres'],
    ['university-of-northern-philippines', 'University of Northern Philippines'],
    ['university-of-perpetual-help-system', 'University of Perpetual Help System'],
    ['university-of-pangasinan', 'University of Pangasinan'],
    ['university-of-saint-la-salle', 'University of Saint La Salle'],
    ['university-of-san-agustin', 'University of San Agustin'],
    ['university-of-san-carlos', 'University of San Carlos'],
    ['university-of-san-jose-recoletos', 'University of San Jose-Recoletos'],
    ['university-of-santo-tomas', 'University of Santo Tomas'],
    ['university-of-the-cordilleras', 'University of the Cordilleras'],
    ['university-of-the-east', 'University of the East'],
    ['university-of-the-philippines', 'University of the Philippines'],
    ['university-of-the-visayas', 'University of the Visayas'],
    ['urdaneta-city-university', 'Urdaneta City University'],
    ['virgen-milagrosa-university-foundation', 'Virgen Milagrosa University Foundation'],
    ['western-mindanao-state-university', 'Western Mindanao State University'],
    ['xavier-university-ateneo-de-cagayan', 'Xavier University – Ateneo de Cagayan'],
  ]);
  const authReturnStorageKey = 'duediligence.auth.return.v1';
  const authAttemptStorageKey = 'duediligence.auth.attempt.v1';
  const pendingSubmissionStorageKey = 'duediligence.pending-submission.v1';
  const authTimeoutMs = 12_000;
  const pendingSubmissionMaxAgeMs = 30 * 60 * 1000;

  function dispatchSessionState(session, reason = 'session') {
    const userId = session?.user?.id || null;
    const accessToken = session?.access_token || null;
    if (state.sessionEventInitialized
        && state.lastSessionEventUserId === userId
        && state.lastSessionEventAccessToken === accessToken) {
      return false;
    }
    state.sessionEventInitialized = true;
    state.lastSessionEventUserId = userId;
    state.lastSessionEventAccessToken = accessToken;
    global.dispatchEvent(new CustomEvent('duediligence:session', {
      detail: {
        authenticated: Boolean(accessToken),
        userId,
        reason,
      },
    }));
    return true;
  }

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
    return '<img src="assets/brand/icon-192.png" width="42" height="42" alt="" aria-hidden="true">';
  }

  function validLegalVersion(value, prefix) {
    const normalized = String(value || '').trim();
    return normalized.startsWith(prefix)
      && normalized.length >= prefix.length + 3
      && normalized.length <= 120
      ? normalized
      : '';
  }

  async function refreshLegalPolicy() {
    const payload = await publicWorkerRequest('/beta/access/policy');
    const termsVersion = validLegalVersion(payload?.policy?.legal?.termsVersion, 'terms-');
    const privacyVersion = validLegalVersion(payload?.policy?.legal?.privacyVersion, 'privacy-');
    if (!termsVersion || !privacyVersion) {
      throw new Error('The current Terms and Privacy policy could not be verified.');
    }
    commercialLegal = Object.freeze({ termsVersion, privacyVersion });
    return commercialLegal;
  }

  function schoolSuggestionsMarkup() {
    return lawSchools
      .map(([, label]) => `<option value="${escapeHtml(label)}"></option>`)
      .join('');
  }

  function schoolDisplayName(profile = state.profile) {
    const schoolId = String(profile?.law_school_id || '').trim().toLowerCase();
    const savedOther = String(profile?.law_school_other || '').trim();
    const legacySchool = String(profile?.school || '').trim();
    if (schoolId === 'other' && savedOther) return savedOther;
    const lookup = schoolId || legacySchool.toLocaleLowerCase('en-PH');
    const known = lawSchools.find(([value, label]) => (
      value === lookup || label.toLocaleLowerCase('en-PH') === lookup
    ));
    return known?.[1] || savedOther || legacySchool || schoolId;
  }

  function normalizeSchoolInput(value) {
    const schoolName = String(value || '').trim().replace(/\s+/g, ' ');
    const normalized = schoolName.toLocaleLowerCase('en-PH');
    const known = lawSchools.find(([schoolId, label]) => (
      schoolId === normalized || label.toLocaleLowerCase('en-PH') === normalized
    ));
    return known
      ? { schoolId: known[0], schoolOther: null, schoolName: known[1] }
      : { schoolId: 'other', schoolOther: schoolName, schoolName };
  }

  function injectShell() {
    if (document.getElementById('dd2-entry-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="dd2-overlay" id="dd2-entry-overlay" role="dialog" aria-modal="true"
        aria-labelledby="dd2-entry-title" aria-describedby="dd2-entry-copy" aria-hidden="true">
        <section class="dd2-entry" tabindex="-1">
          <div class="dd2-entry-story">
            <div class="dd2-entry-brandmark" aria-hidden="true">
              <img src="assets/brand/icon-512.png" width="512" height="512" alt="">
            </div>
            <div class="dd2-entry-kicker">Philippine Bar Essay Preparation</div>
            <h2>Prepare with conviction.</h2>
            <p>Serious essay practice, disciplined ALAC structure, and source-based feedback in a chamber built for future lawyers.</p>
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
          <button type="button" class="dd2-close dd2-card-close" id="dd2-onboarding-close" aria-label="Close setup and return to the homepage">×</button>
          <div class="dd2-view-kicker">First-time setup</div>
          <h2 id="dd2-onboarding-title">Make this chamber yours.</h2>
          <p>Tell us where you are in your legal studies. This information personalizes your Docket and does not grant an administrative or teaching role.</p>
          <form class="dd2-form" id="dd2-onboarding-form">
            <div class="dd2-onboarding-grid">
              <label class="dd2-label dd2-wide">Display name
                <input class="dd2-field" id="dd2-display-name" maxlength="120" autocomplete="name" required>
              </label>
              <label class="dd2-label dd2-wide">Law school
                <input class="dd2-field" id="dd2-school" list="dd2-school-suggestions" maxlength="180"
                  autocomplete="organization" placeholder="Type your law school" required>
                <datalist id="dd2-school-suggestions">${schoolSuggestionsMarkup()}</datalist>
                <span class="dd2-field-help">Suggestions are optional. You may type and save any school name.</span>
              </label>
              <label class="dd2-label dd2-wide">Year or category
                <select class="dd2-field" id="dd2-year-level" required>
                  <option value="">Select year or category</option>
                  <option value="first_year">First Year</option>
                  <option value="second_year">Second Year</option>
                  <option value="third_year">Third Year</option>
                  <option value="fourth_year">Fourth Year</option>
                  <option value="fifth_year">Fifth Year</option>
                  <option value="review">Review / Bar Candidate</option>
                  <option value="professor">Professor</option>
                </select>
              </label>
              <label class="dd2-label dd2-wide" id="dd2-professor-license-wrap" hidden>Professor license declaration
                <input class="dd2-field" id="dd2-professor-license" maxlength="80" autocomplete="off" placeholder="IBP or professional license number">
                <span class="dd2-field-help">A declaration is stored privately for verification. It does not grant Professor or administrator authority.</span>
              </label>
            </div>
            <label class="dd2-check">
              <input type="checkbox" id="dd2-legal-acceptance" required>
              <span>I accept the <button class="link-button" type="button" data-dd2-view="terms">Terms of Use</button>
                and acknowledge the <button class="link-button" type="button" data-dd2-view="privacy">Privacy Policy</button>.</span>
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

  async function refreshAuthenticatedSession() {
    if (!state.client) return null;
    if (state.sessionRefreshPromise) return state.sessionRefreshPromise;
    state.sessionRefreshPromise = (async () => {
      try {
        const { data, error } = await state.client.auth.refreshSession();
        const session = error ? null : data?.session || null;
        if (!session?.access_token) return null;
        state.session = session;
        state.user = session.user || null;
        syncAuthUi();
        dispatchSessionState(session, 'refresh');
        return session;
      } catch {
        return null;
      }
    })().finally(() => {
      state.sessionRefreshPromise = null;
    });
    return state.sessionRefreshPromise;
  }

  async function handleSubmissionUnauthorized(view, draft = {}, options = {}) {
    if (options.attemptRefresh !== false && await refreshAuthenticatedSession()) {
      global.toast?.('Your session was restored. Please retry the last action.', 'ok');
      return true;
    }
    queuePendingSubmission(view, draft);
    await clearInvalidLocalSession();
    showEntry({
      message: 'Your secure session expired. Sign in again and your non-sensitive draft will be restored.',
    });
    return false;
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
      if (/^#[a-z0-9][a-z0-9-]{0,64}$/i.test(url.hash)) return url.hash;
      if (!url.hash.startsWith('#examination-room?')) return '';
      const parameters = new URLSearchParams(url.hash.slice('#examination-room?'.length));
      const allowed = new Set(['exam', 'submission', 'question', 'role']);
      const parameterKeys = [...parameters.keys()];
      if (parameterKeys.some((key) => !allowed.has(key))
          || new Set(parameterKeys).size !== parameterKeys.length) return '';
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const examId = String(parameters.get('exam') || '');
      const submissionId = String(parameters.get('submission') || '');
      const question = String(parameters.get('question') || '');
      const role = String(parameters.get('role') || '');
      if (!uuid.test(examId) || (submissionId && !uuid.test(submissionId))
          || (question && (!/^\d{1,3}$/.test(question) || Number(question) < 1 || Number(question) > 200))
          || (role && !['student', 'professor'].includes(role))
          || (question && !submissionId)
          || (submissionId && role !== 'professor')
          || (role === 'student' && (submissionId || question))) return '';
      const safe = new URLSearchParams({ exam: examId });
      if (submissionId) safe.set('submission', submissionId);
      if (question) safe.set('question', question);
      if (role) safe.set('role', role);
      return `#examination-room?${safe}`;
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
    const allowGuest = config.guest?.enabled === true && options.allowGuest === true && !completed;
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
    const protectedRoute = ['mock-bar', 'subject-matter', 'bar-feels', 'quorum', 'examination-room']
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

  function returnFromOnboarding() {
    if (state.onboardingBusy) return;
    setOverlay(false, 'dd2-onboarding-overlay');
    syncAuthUi();
    global.DueDiligencePublicHome?.show?.();
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
    const routeName = location.hash.replace(/^#/, '').split('?')[0];
    const protectedRoute = ['mock-bar', 'subject-matter', 'bar-feels', 'quorum', 'examination-room']
      .includes(routeName);
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
    if (config.guest?.enabled !== true) {
      signInWithGoogle();
      return;
    }
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
      signInButton.textContent = 'Profile';
      signInButton.title = signedIn
        ? 'Manage your profile, preferences, and activity.'
        : 'Sign in to open your profile.';
    }
    const headerAccount = document.getElementById('header-account-control');
    if (headerAccount) {
      headerAccount.textContent = signedIn ? 'Profile' : 'Sign in';
      headerAccount.title = signedIn
        ? 'Open your profile and account controls.'
        : 'Sign in to Due Diligence.';
      headerAccount.setAttribute(
        'aria-label',
        signedIn ? 'Open signed-in account controls' : 'Sign in to Due Diligence',
      );
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
    if (!state.authReturnPending) return;
    state.authReturnPending = false;
    safeSessionRemove(authReturnStorageKey);
    history.replaceState(
      { ...(history.state || {}), dueDiligenceRoute: 'quorum' },
      '',
      `${location.pathname}${location.search}#quorum`,
    );
    global.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
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
    event?.preventDefault();
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
      const acceptance = await recordCurrentTermsAcceptance();
      const { data: confirmed, error: confirmationError } = await state.client
        .from('terms_acceptances')
        .select('accepted_at')
        .eq('user_id', state.user.id)
        .eq('terms_version', acceptance.termsVersion)
        .eq('privacy_version', acceptance.privacyVersion)
        .maybeSingle();
      if (confirmationError || !confirmed?.accepted_at) {
        throw new Error('Acceptance persistence could not be confirmed.');
      }
      state.userStatePromise = null;
      state.userStateUserId = null;
      await loadUserStateFor(state.user.id);
      setStatus('dd2-auth-status', '');
      global.toast?.('Terms and Privacy acceptance recorded.', 'ok');
    } catch {
      setStatus('dd2-auth-status', 'Acceptance could not be recorded. Check your connection and try again.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadUserState() {
    if (!state.client || !state.user) return;
    if (deferOnboardingForPrivateBeta()) return;
    const userId = state.user.id;
    if (state.userStatePromise && state.userStateUserId === userId) {
      return state.userStatePromise;
    }
    const pending = loadUserStateFor(userId);
    state.userStateUserId = userId;
    state.userStatePromise = pending;
    try {
      return await pending;
    } finally {
      if (state.userStatePromise === pending) {
        state.userStatePromise = null;
        state.userStateUserId = null;
      }
    }
  }

  async function loadUserStateFor(userId) {
    try {
      await refreshLegalPolicy();
    } catch {
      showEntry({
        mode: 'consent',
        allowDismiss: true,
        routeBound: true,
        title: 'Terms and Privacy temporarily unavailable',
        copy: 'The current documents could not be verified. Please retry in a moment.',
      });
      setStatus('dd2-auth-status', 'Current policy verification failed. No acceptance was recorded.', 'error');
      return;
    }
    const [{ data: profile }, { data: terms }] = await Promise.all([
      state.client
        .from('profiles')
        .select('id,display_name,school,enrollment_status,year_level,profile_completed_at,subscription_tier,subscription_status,law_school_id,law_school_other,commercial_category,commercial_onboarding_completed_at')
        .eq('id', userId)
        .maybeSingle(),
      state.client
        .from('terms_acceptances')
        .select('accepted_at')
        .eq('terms_version', commercialLegal.termsVersion)
        .eq('privacy_version', commercialLegal.privacyVersion)
        .limit(1),
    ]);
    if (state.user?.id !== userId) return;
    state.profile = profile || null;
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
    } else if (!profile?.profile_completed_at) {
      openOnboarding();
    } else {
      closeEntry();
      setOverlay(false, 'dd2-onboarding-overlay');
      if (state.welcomedUserId !== userId) {
        state.welcomedUserId = userId;
        global.toast?.(`Welcome back, ${profile?.display_name || state.user?.user_metadata?.full_name || 'future counsel'}.`, 'ok');
      }
      restoreAuthDestination();
    }
  }

  function openOnboarding() {
    if (deferOnboardingForPrivateBeta()) return;
    const displayName = document.getElementById('dd2-display-name');
    const school = document.getElementById('dd2-school');
    const year = document.getElementById('dd2-year-level');
    if (displayName) displayName.value = state.profile?.display_name || state.user?.user_metadata?.full_name || '';
    if (school) school.value = schoolDisplayName();
    if (year) year.value = state.profile?.commercial_category || '';
    const legal = document.getElementById('dd2-legal-acceptance');
    if (legal) legal.checked = false;
    updateEnrollmentFields();
    closeEntry();
    setOverlay(true, 'dd2-onboarding-overlay');
  }

  function updateEnrollmentFields() {
    const professorLicense = document.getElementById('dd2-professor-license');
    const professorWrap = document.getElementById('dd2-professor-license-wrap');
    const professorSelected = document.getElementById('dd2-year-level')?.value === 'professor';
    if (professorWrap) professorWrap.hidden = !professorSelected;
    if (professorLicense) professorLicense.required = professorSelected;
  }

  async function submitOnboarding(event) {
    event.preventDefault();
    if (state.onboardingBusy || !state.client || !state.user) return;
    const displayName = document.getElementById('dd2-display-name').value.trim();
    const school = normalizeSchoolInput(document.getElementById('dd2-school').value);
    const category = document.getElementById('dd2-year-level').value;
    const professorLicense = document.getElementById('dd2-professor-license').value.trim();
    const accepted = document.getElementById('dd2-legal-acceptance').checked;
    const aiImprovementOptIn = document.getElementById('dd2-ai-improvement-consent').checked;
    if (displayName.length < 2) {
      setStatus('dd2-onboarding-status', 'Enter the name you want shown in Due Diligence.', 'error');
      return;
    }
    if (!accepted) {
      setStatus('dd2-onboarding-status', 'Accept the Terms of Use and acknowledge the Privacy Policy to continue.', 'error');
      return;
    }
    if (school.schoolName.length < 2 || !category) {
      setStatus('dd2-onboarding-status', 'Enter your law school and select your year or category.', 'error');
      return;
    }
    if (category === 'professor' && professorLicense.length < 3) {
      setStatus('dd2-onboarding-status', 'Enter the Professor license declaration.', 'error');
      return;
    }
    state.onboardingBusy = true;
    const button = document.getElementById('dd2-onboarding-submit');
    if (button) button.disabled = true;
    setStatus('dd2-onboarding-status', 'Saving your chamber…');
    try {
      await recordCurrentTermsAcceptance();
      const { error: aiConsentError } = await state.client.rpc('record_ai_improvement_consent', {
        p_opted_in: aiImprovementOptIn,
        p_consent_version: config.legal.aiImprovementConsentVersion,
        p_source: 'web_onboarding',
      });
      if (aiConsentError) throw aiConsentError;
      const { error: profileError } = await state.client.rpc('complete_commercial_profile_onboarding', {
        p_display_name: displayName,
        p_law_school_id: school.schoolId,
        p_law_school_other: school.schoolOther,
        p_category: category,
        p_professor_license_number: professorLicense || null,
        p_terms_version: commercialLegal.termsVersion,
        p_privacy_version: commercialLegal.privacyVersion,
      });
      if (profileError) throw profileError;
      state.profile = {
        ...(state.profile || {}),
        display_name: displayName,
        school: school.schoolName,
        enrollment_status: 'enrolled',
        year_level: category,
        law_school_id: school.schoolId,
        law_school_other: school.schoolOther,
        commercial_category: category,
        commercial_onboarding_completed_at: new Date().toISOString(),
        profile_completed_at: new Date().toISOString(),
      };
      setStatus('dd2-onboarding-status', 'Profile saved.', 'success');
      setOverlay(false, 'dd2-onboarding-overlay');
      syncAuthUi();
      if (typeof onboardingStage !== 'undefined' && onboardingStage === 'signIn') {
        global.completeOnboardingSignIn?.();
      }
      global.toast?.(`Welcome, ${displayName}.`, 'ok');
      global.DueDiligenceAnalytics?.track('onboarding_completed');
      global.dispatchEvent(new CustomEvent('duediligence:profile-completed'));
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
        <p><strong>Version:</strong> ${escapeHtml(commercialLegal.termsVersion)}<br>${legalReviewNotice}</p>
        <h3>Educational service</h3>
        <p>Due Diligence is an independent Philippine Bar Examination study platform. It is not affiliated with, certified by, or endorsed by the Supreme Court of the Philippines or any government agency.</p>
        <h3>No legal advice or guaranteed result</h3>
        <p>Questions, suggested answers, scores, AI assessments, and explanations are for education only. They do not constitute legal advice, an official Bar grade, or a guarantee of examination performance. Verify authorities against official sources.</p>
        <h3>AI limitations</h3>
        <p>AI-assisted systems assess and explain answers using curated platform context. Output may be incomplete or inaccurate. Use the correction workflow when material appears wrong.</p>
        <h3>AI, grading, and authority limitations</h3>
        <p>AI-generated grading and suggested answers may be incomplete or inaccurate. They are not official Supreme Court or Bar Examiner grades. A “Human Verified” label appears only after a genuine editorial review record exists. Provider capacity may temporarily interrupt grading; no grade or authority will be fabricated.</p>
        <h3>Free and Early Access</h3>
        <p>Free accounts receive five successful question submissions per Philippine calendar day across the available examination tracks. A failed grading operation does not consume an allowance. Early Access is a one-time ₱149 offer available through September 1, 2026 and provides unlimited access through October 1, 2026. Approved Founding Members receive complimentary access through September 1, 2026.</p>
        <h3>Payments, cancellation, and refunds</h3>
        <p>Early Access has no automatic renewal. A payment-proof submission creates one non-renewable 24-hour provisional entitlement while it is reviewed. A verified entitlement ends on October 1, 2026. Eligible refund requests must be filed within seven calendar days of the first provisional or paid access start and are reviewed using the published unused-time formula, without limiting statutory consumer rights.</p>
        <h3>Your submissions</h3>
        <p>You remain responsible for submitted content. Do not submit confidential, privileged, unlawful, or third-party personal information. Service processing of an answer is necessary to provide grading. Separate optional consent governs retention of de-identified answer content for internal quality improvement.</p>
        <h3>Acceptable use</h3>
        <p>Do not scrape the platform, share credentials, bypass access controls, interfere with service, commit fraud, harass others, or submit unlawful material. We may proportionately suspend or terminate access after notice and an opportunity to raise a support complaint, except where immediate action is reasonably necessary for security or law.</p>
        <h3>Ownership and lawful use</h3>
        <p>Due Diligence owns its original software, branding, interface, and proprietary curation. It does not claim ownership over Philippine laws, jurisprudence, government works, or official Bar materials. Unauthorized commercial reproduction and unlawful access may be pursued, while lawful fair use, criticism, reporting, and statutory rights remain respected.</p>
        <h3>Governing law and complaints</h3>
        <p>These Terms are governed by Philippine law. Submit a complaint through Support; we will document and review it before taking further internal action where practicable.</p>
      </div>`;
  }

  function privacyContent() {
    return `
      <div class="dd2-copy">
        <p><strong>Version:</strong> ${escapeHtml(commercialLegal.privacyVersion)}<br>${legalReviewNotice}</p>
        <h3>What the platform handles</h3>
        <p>For signed-in users, Supabase stores account identity, approved profile fields, legal-document acceptance, roles, and future account records. Historical marketing-consent records may remain for audit, but Due Diligence does not currently operate an email-marketing program or collect a new marketing preference. Google processes the secure sign-in consent flow.</p>
        <h3>Essay assessment</h3>
        <p>Cloudflare routes grading requests to the Due Diligence Worker, which sends the submitted essay and curated question context to the configured assessment provider. Do not place client secrets or confidential case information in practice answers.</p>
        <h3>Access records</h3>
        <p>Protected examinations require authentication. Supabase UUIDs anchor daily allowances, approved Founding Member eligibility, Early Access entitlements, legal acceptance, progress, and history so refreshes or device changes do not reset access.</p>
        <h3>Support and corrections</h3>
        <p>Support stores the category, message, optional reply email, status, and timestamps. Do not submit examination answers through Support. Correction submissions store only the reviewed correction fields described in that form.</p>
        <h3>Payments and infrastructure</h3>
        <p>Payment amount, channel, date, reference, status, and proof are processed for manual verification. Proofs are private and available only through short-lived authorized review. Supabase, Cloudflare, GitHub Pages, Google authentication, and the configured assessment provider process data only as needed for their platform roles.</p>
        <h3>Purpose and legal basis</h3>
        <p>We process account and answer data to perform the requested educational service, secure the platform, prevent fraud, maintain records, and meet legal obligations. Optional AI-improvement processing relies on separate consent that may be withdrawn. No email-marketing program is active.</p>
        <h3>Retention and security</h3>
        <p>Account, legal-acceptance, grading, payment, support, and audit records are retained only as needed for the service, disputes, security, and applicable law. Payment proofs are removed under the approved retention schedule. Controls include least-privilege access, private storage, row-level security, authenticated Worker routes, and audit trails.</p>
        <h3>Your rights</h3>
        <p>You may request access, correction, deletion where applicable, restriction, objection, consent withdrawal, or account-recovery assistance through Support. Identity verification may be required. Google identity transfer is not offered unless the same internal UUID and attached data can be preserved safely.</p>
        <h3>AI-improvement choice</h3>
        <p>Answer processing for an immediate grade is required service processing. Retaining de-identified answer content for internal model, rubric, and quality improvement is optional and may be withdrawn without losing paid simulator access.</p>
      </div>`;
  }

  function pricingContent() {
    return `
      <div class="dd2-copy">
        <p class="dd2-pricing-intro"><strong>Choose one clear access option.</strong> Free remains available. Early Access is a one-time launch offer with no automatic renewal.</p>
        <div class="dd2-plan-grid" id="dd2-pricing-plans" aria-live="polite">
          <div class="dd2-loading-line">Loading current access options…</div>
        </div>
        <div id="dd2-payment-host"></div>
        <p class="dd2-form-note">After the Early Access sale closes, later paid-plan pricing will remain unannounced until separately approved.</p>
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
              <option value="account">Profile</option>
              <option value="account_recovery">Profile recovery</option>
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
        <p><strong>How does Free access work?</strong><br>Every authenticated user receives five successful question submissions per Philippine calendar day. Failed grading does not consume an allowance, and the allowance resets at Philippine midnight.</p>
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
    const schoolName = schoolDisplayName();
    const category = state.profile?.commercial_category
      || ({ '1': 'first_year', '2': 'second_year', '3': 'third_year', '4': 'fourth_year' }[state.profile?.year_level]
        || (state.profile?.year_level === 'review' ? 'review' : ''));
    return `
      <div class="dd2-account-summary">
        <div class="dd2-account-avatar">${escapeHtml(initials())}</div>
        <div><strong>${escapeHtml(name)}</strong><span>Signed in securely with Google</span></div>
      </div>
      <form class="dd2-form" id="dd2-account-form">
        <label class="dd2-label">Display name
          <input class="dd2-field" id="dd2-account-name" value="${escapeHtml(state.profile?.display_name || '')}" maxlength="120" required>
        </label>
        <label class="dd2-label">Law school
          <input class="dd2-field" id="dd2-account-school" list="dd2-account-school-suggestions"
            value="${escapeHtml(schoolName)}" maxlength="180" autocomplete="organization"
            placeholder="Type your law school" required>
          <datalist id="dd2-account-school-suggestions">${schoolSuggestionsMarkup()}</datalist>
          <span class="dd2-field-help">Choose a suggestion or save any school name you enter.</span>
        </label>
        <label class="dd2-label">Year or category
          <select class="dd2-field" id="dd2-account-year" required>
            <option value="">Select year or category</option>
            ${[
              ['first_year', 'First Year'], ['second_year', 'Second Year'],
              ['third_year', 'Third Year'], ['fourth_year', 'Fourth Year'],
              ['fifth_year', 'Fifth Year'], ['review', 'Review / Bar Candidate'],
              ['professor', 'Professor'],
            ].map(([value, label]) => `<option value="${value}"${category === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="dd2-label" id="dd2-account-professor-wrap"${category === 'professor' ? '' : ' hidden'}>Professor license declaration
          <input class="dd2-field" id="dd2-account-professor-license" maxlength="80" autocomplete="off" placeholder="Re-enter to verify profile changes">
          <span class="dd2-field-help">Stored privately. This declaration does not grant Professor or administrator authority.</span>
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
        <h3>Plan and access</h3>
        <div id="dd2-account-access"><p>Loading verified access status…</p></div>
        <div id="dd2-account-billing"></div>
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
      pricing: ['Access options', 'Plans & Pricing', pricingContent],
      terms: ['Legal', 'Terms of Use', termsContent],
      privacy: ['Legal', 'Privacy Policy', privacyContent],
      account: ['Your account', 'Profile', accountContent],
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

  function mandatoryAccessChoiceOpen() {
    return document.getElementById('dd2-native-view')
      ?.hasAttribute('data-access-choice-required') === true;
  }

  function refuseMandatoryAccessChoiceDismissal() {
    global.toast?.('Choose Free or ₱149 Early Access before continuing.', 'warn');
    if (location.hash !== '#pricing') {
      history.replaceState(
        { ...(history.state || {}), dd2View: 'pricing' },
        '',
        '#pricing',
      );
    }
  }

  function closeNativeView() {
    if (mandatoryAccessChoiceOpen()) {
      refuseMandatoryAccessChoiceDismissal();
      return;
    }
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
    const requestId = options.requestId || randomId(18);
    const headers = {
      'X-Request-ID': requestId,
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
        if (options.authRetry !== false && await refreshAuthenticatedSession()) {
          return nativeWorkerRequest(path, {
            ...options,
            requestId,
            authRetry: false,
          });
        }
        await handleSubmissionUnauthorized(
          options.submissionView || 'account',
          options.submissionDraft || {},
          { attemptRefresh: false },
        );
      }
      throw error;
    }
    return payload;
  }

  async function recordCurrentTermsAcceptance() {
    const payload = await nativeWorkerRequest('/beta/access/accept-terms', {
      body: {},
      submissionView: 'account',
      submissionDraft: {},
    });
    const termsVersion = validLegalVersion(payload?.acceptance?.termsVersion, 'terms-');
    const privacyVersion = validLegalVersion(payload?.acceptance?.privacyVersion, 'privacy-');
    if (payload?.acceptance?.recorded !== true
        || !termsVersion
        || !privacyVersion
        || !String(payload?.acceptance?.acceptedAt || '').trim()) {
      throw new Error('Acceptance persistence could not be confirmed.');
    }
    commercialLegal = Object.freeze({ termsVersion, privacyVersion });
    return payload.acceptance;
  }

  async function publicWorkerRequest(path) {
    const response = await fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': randomId(18),
        ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
      },
      body: '{}',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || 'Current access options could not be loaded.');
    }
    return payload;
  }

  function manilaDate(value, options = {}) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: options.short ? 'short' : 'long',
      day: 'numeric',
      ...(options.includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    }).format(date);
  }

  function manilaTodayInput() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function normalizedCommercialPlans(plans) {
    return (Array.isArray(plans) ? plans : [])
      .filter((plan) => ['free', 'early_access_beta'].includes(plan?.planCode))
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  }

  function renderCommercialPlanCards(plans, access = null) {
    const host = document.getElementById('dd2-pricing-plans');
    if (!host) return;
    const safePlans = normalizedCommercialPlans(plans);
    const free = safePlans.find((plan) => plan.planCode === 'free') || {
      planCode: 'free', name: 'Free', pricePhp: 0,
      description: 'Five successful question submissions per Philippine calendar day.',
      features: ['Five successful submissions daily', 'All examination tracks', 'Resets at Philippine midnight'],
    };
    const early = safePlans.find((plan) => plan.planCode === 'early_access_beta') || null;
    const freeFeatures = Array.isArray(free.features) ? free.features : [];
    const earlyFeatures = Array.isArray(early?.features) ? early.features : [];
    const earlyOpen = early?.checkoutEnabled === true && access?.checkoutOpen !== false;
    const alreadyUnlimited = access?.unlimited === true;
    const choiceRequired = access?.choiceRequired === true
      || access?.planSelectionRequired === true
      || ['plan_selection_required', 'payment_required'].includes(String(access?.basis || ''));
    const freeSelected = access?.accessMode === 'free' && !choiceRequired;
    const freeAction = alreadyUnlimited
      ? '<button class="dd2-button dd2-button-secondary" type="button" disabled>Account access active</button>'
      : freeSelected
        ? '<button class="dd2-button dd2-button-secondary" type="button" disabled>Free selected</button>'
        : `<button class="dd2-button dd2-button-secondary" id="dd2-choose-free" type="button">${state.user ? 'Choose Free' : 'Sign in to choose Free'}</button>`;
    const paidAction = alreadyUnlimited
      ? '<button class="dd2-button dd2-button-secondary" type="button" disabled>Unlimited access active</button>'
      : earlyOpen
        ? `<button class="dd2-button dd2-button-primary" id="dd2-open-payment" type="button">${state.user ? 'Get Early Access' : 'Sign in to get Early Access'}</button>`
        : '<button class="dd2-button dd2-button-secondary" type="button" disabled>Early Access offer closed</button>';
    host.innerHTML = `
      <article class="dd2-plan">
        <div class="dd2-plan-head"><div><h3>${escapeHtml(free.name || 'Free')}</h3><span class="dd2-badge">Always available</span></div><div class="dd2-price">₱0<small>no payment</small></div></div>
        <p>${escapeHtml(free.description || '')}</p>
        <ul>${freeFeatures.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
        ${freeAction}
      </article>
      <article class="dd2-plan dd2-plan-featured${earlyOpen ? '' : ' is-disabled'}">
        <div class="dd2-plan-head"><div><h3>Early Access</h3><span class="dd2-badge">One-time launch offer</span></div><div class="dd2-price">₱149<small>one time</small></div></div>
        <p>${escapeHtml(early?.description || 'Next paid-plan pricing will be announced separately.')}</p>
        <ul>${earlyFeatures.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
        ${early?.salesCloseAt ? `<p class="dd2-plan-date"><strong>Purchase by:</strong> ${escapeHtml(manilaDate(early.salesCloseAt, { includeTime: true }))} Philippine time</p>` : ''}
        ${early?.entitlementEndsAt ? `<p class="dd2-plan-date"><strong>Access through:</strong> ${escapeHtml(manilaDate(early.entitlementEndsAt, { includeTime: true }))}</p>` : ''}
        <p class="dd2-plan-note">One-time payment. No automatic renewal.</p>
        ${paidAction}
      </article>`;
    document.getElementById('dd2-choose-free')?.addEventListener('click', () => {
      if (!state.session?.access_token) {
        hideNativeView();
        showEntry({ allowDismiss: true, routeBound: true, returnHash: '#pricing' });
        return;
      }
      global.DueDiligencePhase4?.chooseFreeAccess?.();
    });
    document.getElementById('dd2-open-payment')?.addEventListener('click', () => {
      if (!state.session?.access_token) {
        hideNativeView();
        showEntry({ allowDismiss: true, routeBound: true, returnHash: '#pricing' });
        return;
      }
      renderPaymentForm();
    });
  }

  function renderPaymentForm() {
    const host = document.getElementById('dd2-payment-host');
    if (!host) return;
    const today = manilaTodayInput();
    host.innerHTML = `
      <section class="dd2-payment-panel" aria-labelledby="dd2-payment-title">
        <div class="dd2-view-kicker">Secure manual verification</div>
        <h3 id="dd2-payment-title">Submit ₱149 Early Access proof</h3>
        <p>Your one non-renewable 24-hour provisional access begins when this proof is accepted by the server. Verification fixes access through October 1, 2026.</p>
        <div class="dd2-payment-channel" aria-label="Approved payment channel">
          <span>GoTyme InstaPay</span>
          <strong>Exact amount: ₱149.00</strong>
        </div>
        <figure class="dd2-qr-frame">
          <picture><img id="dd2-payment-qr" src="assets/payments/gotyme-instapay-149.png" alt="GoTyme InstaPay QR code for the ₱149 Due Diligence Early Access payment" width="676" height="775"></picture>
          <figcaption>Scan with an InstaPay-compatible banking or e-wallet app. Pay exactly ₱149.00, then upload the resulting receipt below.</figcaption>
        </figure>
        <form class="dd2-form" id="dd2-payment-form">
          <input type="hidden" id="dd2-payment-method" value="gotyme_instapay">
          <label class="dd2-label">Payment date
            <input class="dd2-field" id="dd2-payment-date" type="date" value="${today}" max="${today}" required>
          </label>
          <label class="dd2-label">Transaction reference
            <input class="dd2-field" id="dd2-payment-reference" minlength="4" maxlength="100" autocomplete="off" required>
          </label>
          <label class="dd2-label">Payment proof
            <input class="dd2-field" id="dd2-payment-proof" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" required>
            <span class="dd2-field-help">PNG, JPEG, or PDF only. The proof is private and subject to file-signature validation.</span>
          </label>
          <label class="dd2-label">Note (optional)
            <textarea class="dd2-field" id="dd2-payment-note" maxlength="2000" placeholder="Add only information needed to match your payment."></textarea>
          </label>
          <div class="dd2-status" id="dd2-payment-status" role="status" aria-live="polite"></div>
          <button class="dd2-button dd2-button-primary" id="dd2-payment-submit" type="submit">Submit proof securely</button>
        </form>
      </section>`;
    host.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    document.getElementById('dd2-payment-form')?.addEventListener('submit', submitCommercialPayment);
  }

  async function submitCommercialPayment(event) {
    event.preventDefault();
    const submit = document.getElementById('dd2-payment-submit');
    const proof = document.getElementById('dd2-payment-proof')?.files?.[0];
    if (!proof) {
      setStatus('dd2-payment-status', 'Choose a PNG, JPEG, or PDF payment proof.', 'error');
      return;
    }
    const form = new FormData();
    form.set('planCode', 'early_access_beta');
    form.set('amountPhp', '149');
    form.set('paymentMethod', document.getElementById('dd2-payment-method').value);
    form.set('paymentDate', document.getElementById('dd2-payment-date').value);
    form.set('transactionReference', document.getElementById('dd2-payment-reference').value.trim());
    form.set('note', document.getElementById('dd2-payment-note').value.trim());
    form.set('proof', proof);
    submit.disabled = true;
    setStatus('dd2-payment-status', 'Validating and storing your proof securely…');
    try {
      const result = await nativeWorkerRequest('/payments/submit', {
        body: form,
        submissionView: 'payment',
        submissionDraft: { planCode: 'early_access_beta' },
      });
      setStatus('dd2-payment-status', result.message || 'Proof received. Provisional access is active while verification is pending.', 'success');
      global.DueDiligencePhase4?.refreshAccess?.().catch(() => {});
      global.toast?.('Early Access proof received securely.', 'ok');
    } catch (error) {
      setStatus('dd2-payment-status', error.message || 'The proof could not be submitted. No access change was made.', 'error');
      submit.disabled = false;
    }
  }

  async function loadCommercialPricing() {
    const host = document.getElementById('dd2-pricing-plans');
    if (!host) return;
    try {
      const [plansPayload, accessPayload] = await Promise.all([
        publicWorkerRequest('/plans'),
        state.session?.access_token
          ? nativeWorkerRequest('/access', { requestId: randomId(18) })
          : Promise.resolve({ access: null }),
      ]);
      renderCommercialPlanCards(plansPayload.plans, accessPayload.access);
    } catch (error) {
      host.innerHTML = `<div class="dd2-status is-error">${escapeHtml(error.message || 'Current access options could not be loaded. Please retry.')}</div>`;
    }
  }

  function accessSummaryMarkup(access) {
    const label = access?.accountLabel || 'Free';
    const remaining = Math.max(0, Number(access?.remainingToday) || 0);
    const limit = Math.max(0, Number(access?.dailyLimit) || 5);
    const quota = access?.unlimited
      ? 'Unlimited successful submissions while this entitlement is active.'
      : `${remaining} of ${limit} successful submissions remain today.`;
    return `
      <div class="dd2-access-summary">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(quota)}</span>
        ${access?.resetAt && !access?.unlimited ? `<span>Allowance resets ${escapeHtml(manilaDate(access.resetAt, { includeTime: true }))} Philippine time.</span>` : ''}
        ${access?.entitlementEndsAt ? `<span>Access ends ${escapeHtml(manilaDate(access.entitlementEndsAt, { includeTime: true }))} Philippine time.</span>` : ''}
        ${access?.paymentState ? `<span>Payment verification: ${escapeHtml(String(access.paymentState).replaceAll('_', ' '))}.</span>` : ''}
      </div>`;
  }

  function billingMarkup(billing) {
    const payments = Array.isArray(billing?.payments) ? billing.payments : [];
    const refunds = Array.isArray(billing?.refunds) ? billing.refunds : [];
    if (!payments.length) return '<h3>Payments</h3><p>No payment proof has been submitted from this account.</p>';
    const refundedPaymentIds = new Set(refunds.map((refund) => refund.paymentRequestId));
    return `
      <h3>Payments and refunds</h3>
      <div class="dd2-record-list">${payments.map((payment) => `
        <article class="dd2-record">
          <strong>Early Access · ₱${escapeHtml(Number(payment.amountPhp || 149).toFixed(2))}</strong>
          <span class="dd2-record-status">${escapeHtml(String(payment.status || 'pending').replaceAll('_', ' '))}</span>
          <small>Submitted ${escapeHtml(manilaDate(payment.submittedAt, { includeTime: true }))} · ${escapeHtml(payment.method || '')}</small>
          ${payment.reviewReason ? `<p>${escapeHtml(payment.reviewReason)}</p>` : ''}
          ${payment.status === 'approved' && !refundedPaymentIds.has(payment.id)
            ? `<button class="dd2-button dd2-button-secondary" data-refund-payment="${escapeHtml(payment.id)}" type="button">Request eligible refund review</button>` : ''}
        </article>`).join('')}</div>
      ${refunds.length ? `<h3>Refund requests</h3><div class="dd2-record-list">${refunds.map((refund) => `
        <article class="dd2-record"><strong>Refund review</strong><span class="dd2-record-status">${escapeHtml(String(refund.status || 'pending').replaceAll('_', ' '))}</span><small>Submitted ${escapeHtml(manilaDate(refund.submittedAt, { includeTime: true }))}</small><p>${escapeHtml(refund.calculationNote || 'Awaiting review.')}</p></article>`).join('')}</div>` : ''}
      <div id="dd2-refund-host"></div>`;
  }

  function openRefundForm(paymentRequestId) {
    const host = document.getElementById('dd2-refund-host');
    if (!host) return;
    host.innerHTML = `
      <form class="dd2-payment-panel dd2-form" id="dd2-refund-form">
        <h3>Request refund review</h3>
        <p>Eligible requests must be filed within seven calendar days of the first provisional or paid access start. The server calculates the unused-time amount and an administrator confirms any payment.</p>
        <input id="dd2-refund-payment-id" type="hidden" value="${escapeHtml(paymentRequestId)}">
        <label class="dd2-label">Reason
          <textarea class="dd2-field" id="dd2-refund-reason" minlength="10" maxlength="2000" required></textarea>
        </label>
        <div class="dd2-status" id="dd2-refund-status" role="status" aria-live="polite"></div>
        <button class="dd2-button dd2-button-primary" id="dd2-refund-submit" type="submit">Submit refund request</button>
      </form>`;
    document.getElementById('dd2-refund-form')?.addEventListener('submit', submitRefundRequest);
    document.getElementById('dd2-refund-reason')?.focus();
  }

  async function submitRefundRequest(event) {
    event.preventDefault();
    const submit = document.getElementById('dd2-refund-submit');
    const payload = {
      paymentRequestId: document.getElementById('dd2-refund-payment-id').value,
      reason: document.getElementById('dd2-refund-reason').value.trim(),
    };
    submit.disabled = true;
    setStatus('dd2-refund-status', 'Submitting for review…');
    try {
      const result = await nativeWorkerRequest('/refunds/submit', {
        body: payload, submissionView: 'refund', submissionDraft: payload,
      });
      setStatus('dd2-refund-status', result.message || 'Refund request received.', 'success');
      await loadBillingAndAccess();
    } catch (error) {
      setStatus('dd2-refund-status', error.message || 'The refund request could not be submitted.', 'error');
      submit.disabled = false;
    }
  }

  async function loadBillingAndAccess() {
    if (!state.session?.access_token) return;
    try {
      const [accessPayload, billingPayload] = await Promise.all([
        nativeWorkerRequest('/access', { requestId: randomId(18) }),
        nativeWorkerRequest('/payments/status', { requestId: randomId(18) }),
      ]);
      const access = accessPayload.access || {};
      const accountAccess = document.getElementById('dd2-account-access');
      if (accountAccess) accountAccess.innerHTML = accessSummaryMarkup(access);
      const billingHost = document.getElementById('dd2-account-billing');
      if (billingHost) {
        billingHost.innerHTML = billingMarkup(billingPayload.billing || {});
        billingHost.querySelectorAll('[data-refund-payment]').forEach((button) => {
          button.addEventListener('click', () => openRefundForm(button.dataset.refundPayment));
        });
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
    const school = normalizeSchoolInput(document.getElementById('dd2-account-school').value);
    const values = {
      displayName: document.getElementById('dd2-account-name').value.trim(),
      school,
      category: document.getElementById('dd2-account-year').value,
      professorLicense: document.getElementById('dd2-account-professor-license').value.trim(),
    };
    if (values.displayName.length < 2
      || values.school.schoolName.length < 2
      || !values.category
      || (values.category === 'professor' && values.professorLicense.length < 3)) {
      setStatus('dd2-account-status', 'Complete the required profile fields.', 'error');
      return;
    }
    setStatus('dd2-account-status', 'Saving…');
    try {
      await refreshLegalPolicy();
      const { error: profileError } = await state.client.rpc('complete_commercial_profile_onboarding', {
        p_display_name: values.displayName,
        p_law_school_id: values.school.schoolId,
        p_law_school_other: values.school.schoolOther,
        p_category: values.category,
        p_professor_license_number: values.professorLicense || null,
        p_terms_version: commercialLegal.termsVersion,
        p_privacy_version: commercialLegal.privacyVersion,
      });
      if (profileError) throw profileError;
      state.profile = {
        ...state.profile,
        display_name: values.displayName,
        enrollment_status: 'enrolled',
        school: values.school.schoolName,
        year_level: values.category,
        law_school_id: values.school.schoolId,
        law_school_other: values.school.schoolOther,
        commercial_category: values.category,
        commercial_onboarding_completed_at: new Date().toISOString(),
      };
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
      const syncFields = () => {
        const professor = document.getElementById('dd2-account-professor-license');
        const professorWrap = document.getElementById('dd2-account-professor-wrap');
        const professorSelected = document.getElementById('dd2-account-year')?.value === 'professor';
        if (professorWrap) professorWrap.hidden = !professorSelected;
        if (professor) professor.required = professorSelected;
      };
      document.getElementById('dd2-account-year')?.addEventListener('change', syncFields);
      syncFields();
    }
    if (view === 'pricing') loadCommercialPricing();
    if (view === 'account' && state.user) loadBillingAndAccess();
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
    const authStorage = global.DueDiligenceAuthSessionStorage?.prepare?.(config.supabase.url)
      || global.localStorage
      || global.sessionStorage;
    state.client = global.supabase.createClient(
      config.supabase.url,
      config.supabase.publishableKey,
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          storage: authStorage,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
    const { data, error: sessionError } = await state.client.auth.getSession();
    state.session = sessionError ? null : data?.session || null;
    state.user = state.session?.user || null;
    syncAuthUi();
    dispatchSessionState(state.session, 'initial');
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
        state.welcomedUserId = null;
        state.userStatePromise = null;
        state.userStateUserId = null;
        global.DueDiligencePrivateBeta?.clear?.();
        resetGoogleSignIn();
      }
      syncAuthUi();
      dispatchSessionState(session, event);
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
          const refreshed = await refreshAuthenticatedSession();
          if (refreshed) {
            access = await requestGuestAccessStatus({
              Authorization: `Bearer ${refreshed.access_token}`,
            });
          } else {
            await clearInvalidLocalSession();
          }
          if (!access) {
            access = await requestGuestAccessStatus({
              'X-Guest-Device-ID': guestDeviceId(),
            });
          }
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
    document.getElementById('dd2-entry-consent-submit')?.addEventListener('click', submitEntryConsent);
    document.getElementById('dd2-guest-continue')?.addEventListener('click', continueGuestFromEntry);
    document.getElementById('dd2-entry-close')?.addEventListener('click', returnFromEntry);
    document.getElementById('dd2-entry-back')?.addEventListener('click', returnFromEntry);
    document.getElementById('dd2-entry-overlay')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget && event.currentTarget.dataset.dismissible === 'true') {
        closeEntry();
      }
    });
    document.getElementById('dd2-onboarding-form')?.addEventListener('submit', submitOnboarding);
    document.getElementById('dd2-year-level')?.addEventListener('change', updateEnrollmentFields);
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
      if (mandatoryAccessChoiceOpen()) {
        refuseMandatoryAccessChoiceDismissal();
        renderNativeView('pricing', { push: false });
        return;
      }
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
    try {
      await initializeAuth();
    } finally {
      resolveAuthReady?.();
      resolveAuthReady = null;
    }
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
    else handleSubmissionUnauthorized(
      'grade',
      {
        questionId: typeof currentSubj !== 'undefined' && typeof currentIdx !== 'undefined'
          && typeof BAR_QUESTIONS !== 'undefined'
          ? BAR_QUESTIONS?.[currentSubj]?.[currentIdx]?.id || ''
          : '',
      },
      { attemptRefresh: error?.authRetryExhausted !== true },
    );
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
    refreshSession: refreshAuthenticatedSession,
    whenAuthReady: () => authReady,
    getSession: () => state.session,
    config,
  });

  global.beginOnboardingSignIn = () => {
    global.closeModal?.('signin-prompt-modal', { restoreFocus: false });
    showEntry();
  };
  global.mockAuth = (provider) => {
    if (provider === 'Google') signInWithGoogle();
    else global.toast?.(`${provider} sign-in is not available. Continue with Google.`, 'warn');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
