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
    investorGateObserver: null,
  };

  const originalContinueAsGuest = global.continueAsGuest;
  const legalReviewNotice = 'Beta document — prepared for independent legal review.';

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
            <div class="dd2-mark">${crestMarkup()}</div>
            <h3 id="dd2-entry-title">Welcome to Due Diligence</h3>
            <p id="dd2-entry-copy">Your chamber for serious Bar preparation.</p>
            <ul class="dd2-benefits">
              <li>Save progress</li>
              <li>Personal analytics</li>
              <li>320 curated questions</li>
            </ul>
            <div class="dd2-entry-actions">
              <button type="button" class="dd2-button dd2-button-primary" id="dd2-google-signin">Continue with Google</button>
              <button type="button" class="dd2-button dd2-button-secondary" id="dd2-guest-continue" hidden>Continue as Guest</button>
            </div>
            <div class="dd2-status" id="dd2-auth-status" role="status" aria-live="polite"></div>
            <p class="dd2-entry-note">Google opens its secure consent screen. Authentication is required before any examination question is displayed.</p>
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
        </article>
      </div>

      <div class="dd2-overlay" id="dd2-onboarding-overlay" role="dialog" aria-modal="true"
        aria-labelledby="dd2-onboarding-title" aria-hidden="true">
        <section class="dd2-onboarding-card" tabindex="-1">
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
          </form>
        </section>
      </div>

      <div class="dd2-overlay" id="dd2-guest-reminder" role="dialog" aria-modal="true"
        aria-labelledby="dd2-reminder-title" aria-hidden="true">
        <section class="dd2-reminder-card" tabindex="-1">
          <div class="dd2-view-kicker">Guest preview</div>
          <h3 id="dd2-reminder-title">Three assessments, fully graded.</h3>
          <p>Guest access includes 3 graded questions across all subjects. Sign in to continue practicing after your preview.</p>
          <div class="dd2-reminder-actions">
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
    if (open) {
      state.previousFocus = document.activeElement;
      requestAnimationFrame(() => {
        const target = overlay.querySelector(
          'button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
        ) || overlay.querySelector('[tabindex="-1"]');
        target?.focus();
      });
    } else if (state.previousFocus?.isConnected) {
      requestAnimationFrame(() => state.previousFocus.focus());
    }
  }

  function setStatus(id, message, kind = '') {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.className = `dd2-status${kind ? ` is-${kind}` : ''}`;
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

  function showEntry(options = {}) {
    const completed = Boolean(options.completed);
    const title = document.getElementById('dd2-entry-title');
    const copy = document.getElementById('dd2-entry-copy');
    const guestButton = document.getElementById('dd2-guest-continue');
    if (title) title.textContent = completed
      ? 'You have completed your 3 guest questions.'
      : 'Welcome to Due Diligence';
    if (copy) copy.textContent = completed
      ? 'Sign in to continue.'
      : 'Your chamber for serious Bar preparation.';
    if (guestButton) guestButton.hidden = completed;
    setStatus('dd2-auth-status', '');
    setOverlay(true, 'dd2-entry-overlay');
  }

  function closeEntry() {
    setOverlay(false, 'dd2-entry-overlay');
  }

  async function signInWithGoogle() {
    if (!state.client) {
      setStatus('dd2-auth-status', 'Sign-in is temporarily unavailable. Please try again shortly.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('dd2-auth-status', 'You appear to be offline. Reconnect and try again.', 'error');
      return;
    }
    const button = document.getElementById('dd2-google-signin');
    if (button) button.disabled = true;
    setStatus('dd2-auth-status', 'Opening Google securely…');
    try {
      sessionStorage.setItem('duediligence.auth.return.v1', location.href);
      const { error } = await state.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: config.supabase.oauthRedirectUrl,
          scopes: 'openid email profile',
        },
      });
      if (error) throw error;
    } catch {
      setStatus('dd2-auth-status', 'Google sign-in could not start. Please try again.', 'error');
      if (button) button.disabled = false;
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
    const investorModal = document.getElementById('investor-modal');
    if (investorModal?.classList.contains('open')) {
      if (!state.investorGateObserver && typeof MutationObserver === 'function') {
        state.investorGateObserver = new MutationObserver(() => {
          if (investorModal.classList.contains('open')) return;
          state.investorGateObserver.disconnect();
          state.investorGateObserver = null;
          requireSignInForGuestLimit();
        });
        state.investorGateObserver.observe(investorModal, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }
      return;
    }
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
    const avatar = document.getElementById('avatar-pill');
    if (signInButton) {
      signInButton.textContent = signedIn ? 'Account' : 'Sign In';
      signInButton.hidden = false;
    }
    if (avatar) {
      const avatarInitials = avatar.querySelector('.av');
      const tier = avatar.querySelector('.tier');
      if (avatarInitials) avatarInitials.textContent = signedIn ? initials() : 'DD';
      if (tier) tier.textContent = signedIn
        ? (state.admin?.authorized
          ? (state.admin.role === 'super_admin'
            ? 'Super Admin'
            : state.admin.role === 'founder_admin' ? 'Founder Admin' : 'Administrator')
          : 'Student account')
        : 'Sign in required';
    }
    const badge = document.getElementById('dd2-guest-badge');
    if (badge) {
      badge.classList.toggle('is-visible', !signedIn && Boolean(state.guestUsage));
      if (state.guestUsage) badge.textContent = `${state.guestUsage.remaining} guest grades left`;
    }
  }

  async function loadUserState() {
    if (!state.client || !state.user) return;
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
    if (!profile?.profile_completed_at || !terms?.length) {
      openOnboarding();
    } else {
      closeEntry();
      setOverlay(false, 'dd2-onboarding-overlay');
      global.toast?.(`Welcome back, ${profile.display_name || 'future counsel'}.`, 'ok');
    }
  }

  function openOnboarding() {
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
    } catch {
      setStatus(
        'dd2-onboarding-status',
        'Your profile could not be saved. No protected account fields were changed. Please try again.',
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
        <h3>Access and subscriptions</h3>
        <p>Eligible accounts receive a non-restartable 72-hour trial and three lifetime AI grades. Active trial, Free Beta, or paid access has no product-level daily grading limit. Paid plans are activated for the stated period only after manual Philippine-peso payment verification. There is no automatic renewal.</p>
        <h3>Payments, cancellation, and refunds</h3>
        <p>GCash and MariBank payments are manually verified. A voluntary cancellation requested within five calendar days of activation is eligible for an 80% refund. Later requests are reviewed using unused time and documented consumption. Verified continuous outages of twenty days qualify for a prorated refund or equivalent extension, subject to applicable law. Initial response target is 24 hours; ordinary review is seven calendar days and complex review may take up to 14 days without waiving statutory remedies.</p>
        <h3>Your submissions</h3>
        <p>You remain responsible for submitted content. Do not submit confidential, privileged, unlawful, or third-party personal information. Service processing of an answer is necessary to provide grading. Separate optional consent governs retention of de-identified answer content for internal quality improvement.</p>
        <h3>Acceptable use</h3>
        <p>Do not scrape the platform, share credentials, bypass access controls, interfere with service, commit fraud, harass others, or submit unlawful material. We may proportionately suspend or terminate access after notice and an opportunity to raise a support complaint, except where immediate action is reasonably necessary for security or law.</p>
        <h3>Ownership and lawful use</h3>
        <p>Due Diligence owns its original software, branding, interface, and proprietary curation. It does not claim ownership over Philippine laws, jurisprudence, government works, or official Bar materials. Unauthorized commercial reproduction and unlawful access may be pursued, while lawful fair use, criticism, reporting, and statutory rights remain respected.</p>
        <h3>Governing law and complaints</h3>
        <p>These Beta Terms are governed by Philippine law. Submit a complaint through native Support; we will document and review it before taking further internal action where practicable.</p>
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
        <p>Protected examinations require authentication. Supabase UUIDs anchor trial activation, lifetime-grade usage, Free Beta access, subscriptions, progress, and history so refreshes or device changes do not reset access.</p>
        <h3>Support and corrections</h3>
        <p>Native Support stores the category, message, optional reply email, status, and timestamps. Do not submit examination answers through Support. Correction submissions store only the reviewed correction fields described in that form.</p>
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
    const plans = config.plans.items.map((plan) => `
      <article class="dd2-plan">
        <div class="dd2-plan-head">
          <h3>${escapeHtml(plan.name)}</h3>
          <div class="dd2-price">₱${plan.pricePhp}<small>planned price</small></div>
        </div>
        ${plan.featurePlaceholders.length
          ? `<ul>${plan.featurePlaceholders.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>`
          : '<p class="dd2-form-note">Feature packaging will be finalized before subscriptions are activated.</p>'}
      </article>
    `).join('');
    return `
      <div class="dd2-copy">
        <p><strong>${escapeHtml(config.plans.notice)}</strong></p>
        <div class="dd2-plan-grid">${plans}</div>
        <p>No payment, checkout, entitlement enforcement, coaching booking, or paid access is active.</p>
      </div>`;
  }

  function supportContent() {
    return `
      <div class="dd2-copy">
        <p>Request technical, account, accessibility, or content help without leaving Due Diligence. Do not paste an examination answer here.</p>
        <form class="dd2-form" id="dd2-support-form">
          <label class="dd2-label">Category
            <select class="dd2-field" id="dd2-support-category" required>
              <option value="technical">Technical issue</option>
              <option value="account">Account</option>
              <option value="account_recovery">Account Recovery</option>
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
          <button class="dd2-button dd2-button-primary" id="dd2-support-submit" type="submit">Send support request</button>
        </form>
        <h3>Frequently asked</h3>
        <p><strong>How is an answer scored?</strong><br>Each answer receives an independent 0–5 ALAC assessment. It is not an official Bar grade.</p>
        <p><strong>How does free access work?</strong><br>Every authenticated student receives three lifetime AI grades. The 72-hour trial unlocks the simulator, and successful trial grades count toward those three. Failed provider calls and blank timer expirations do not count.</p>
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
          <a class="dd2-button dd2-button-primary" href="/admin/">Open Admin Dashboard</a>
        ` : ''}
        <h3>Account recovery</h3>
        <p>Contact Support. We respond within 24 hours.</p>
        <p>Direct public email changes and account transfers are not available. Choose Account Recovery in Support so identity verification can be documented safely.</p>
        <h3>Future account controls</h3>
        <p>Data export, deletion, billing, device management, and coaching bookings are prepared as future account areas but are not active in this Beta.</p>
      </div>`;
  }

  function nativeDefinition(view) {
    const definitions = {
      support: ['Member assistance', 'Support', supportContent],
      pricing: ['Planned membership', 'Plans & Pricing', pricingContent],
      terms: ['Legal', 'Beta Terms', termsContent],
      privacy: ['Legal', 'Beta Privacy Notice', privacyContent],
      account: ['Your chamber', 'Account', accountContent],
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
      history.pushState({ dd2View: view }, '', `#${view}`);
    }
  }

  function hideNativeView() {
    state.nativeView = null;
    setOverlay(false, 'dd2-native-view');
  }

  function closeNativeView() {
    if (history.state?.dd2View) history.back();
    else hideNativeView();
  }

  async function submitSupport(event) {
    event.preventDefault();
    const submit = document.getElementById('dd2-support-submit');
    const payload = {
      category: document.getElementById('dd2-support-category').value,
      message: document.getElementById('dd2-support-message').value.trim(),
      replyEmail: document.getElementById('dd2-support-email').value.trim(),
    };
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
      const response = await fetch(`${config.workerUrl}/support`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.message || 'Your support request could not be submitted.');
      }
      document.getElementById('dd2-support-form').reset();
      setStatus('dd2-support-status', 'Your support request was received.', 'success');
      global.DueDiligenceAnalytics?.track('support_submitted', {
        resultCategory: payload.category,
      });
    } catch (error) {
      setStatus('dd2-support-status', error.message || 'Your support request could not be submitted. Please retry.', 'error');
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
      setStatus('dd2-account-status', 'Account preferences saved.', 'success');
    } catch {
      setStatus('dd2-account-status', 'Account preferences could not be saved. Please try again.', 'error');
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
    syncAuthUi();
    hideNativeView();
    showEntry();
  }

  function bindNativeViewHandlers(view) {
    document.getElementById('dd2-native-close')?.addEventListener('click', closeNativeView, { once: true });
    document.getElementById('dd2-support-form')?.addEventListener('submit', submitSupport);
    document.getElementById('dd2-account-form')?.addEventListener('submit', submitAccount);
    document.getElementById('dd2-logout')?.addEventListener('click', signOut);
    document.getElementById('dd2-account-signin')?.addEventListener('click', () => {
      hideNativeView();
      showEntry();
    });
    if (view === 'account') {
      document.getElementById('dd2-account-enrollment')?.addEventListener('change', () => {
        const enrolled = document.getElementById('dd2-account-enrollment').value === 'enrolled';
        document.getElementById('dd2-account-school').required = enrolled;
        document.getElementById('dd2-account-year').required = enrolled;
      });
    }
  }

  function bindNavigation() {
    const signIn = document.getElementById('btn-signin');
    const avatar = document.getElementById('avatar-pill');
    const pricing = document.getElementById('btn-subscribe');
    for (const element of [signIn, avatar, pricing]) {
      if (element) element.onclick = null;
    }
    signIn?.addEventListener('click', () => state.user ? renderNativeView('account') : showEntry());
    avatar?.addEventListener('click', () => state.user ? renderNativeView('account') : showEntry());
    if (pricing) {
      pricing.textContent = 'Plans & Pricing';
      pricing.classList.remove('btn-subscribe');
      pricing.classList.add('icon-btn');
      pricing.addEventListener('click', () => renderNativeView('pricing'));
    }

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
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
    const { data } = await state.client.auth.getSession();
    state.session = data?.session || null;
    state.user = state.session?.user || null;
    syncAuthUi();

    state.client.auth.onAuthStateChange((event, session) => {
      state.session = session || null;
      state.user = session?.user || null;
      syncAuthUi();
      if (session && ['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) {
        if (event === 'SIGNED_IN') {
          global.DueDiligenceAnalytics?.track('sign_in_completed');
          const createdAt = new Date(session.user?.created_at || 0).getTime();
          if (createdAt && Date.now() - createdAt < 10 * 60 * 1000) {
            global.DueDiligenceAnalytics?.track('registration_completed');
          }
        }
        setTimeout(() => loadUserState(), 0);
      }
    });

    if (state.user) await loadUserState();
    if (new URLSearchParams(location.search).has('auth')) {
      history.replaceState({}, '', `${location.pathname}${location.hash || ''}`);
    }
  }

  async function requestGuestAccessStatus(headers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetch(`${config.workerUrl}/guest-access`, {
        method: 'POST',
        headers,
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

  function firstPatronWelcome() {
    if (new URLSearchParams(location.search).has('auth')) return Promise.resolve(false);
    const key = 'dd_investor_welcome_seen';
    let seen = false;
    try {
      seen = sessionStorage.getItem(key) === '1';
      if (!seen) sessionStorage.setItem(key, '1');
    } catch {
      seen = true;
    }
    if (!seen && typeof global.openModal === 'function') {
      return new Promise((resolve) => {
        setTimeout(() => {
          global.openModal('investor-modal');
          resolve(true);
        }, 280);
      });
    }
    return Promise.resolve(false);
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    injectShell();
    bindNavigation();
    document.getElementById('dd2-google-signin')?.addEventListener('click', signInWithGoogle);
    document.getElementById('dd2-guest-continue')?.addEventListener('click', continueGuestFromEntry);
    document.getElementById('dd2-onboarding-form')?.addEventListener('submit', submitOnboarding);
    document.getElementById('dd2-enrollment-status')?.addEventListener('change', updateEnrollmentFields);
    document.getElementById('dd2-reminder-continue')?.addEventListener('click', () => {
      try {
        localStorage.setItem(config.guest.reminderStorageKey, 'shown');
      } catch {
        // The reminder may repeat when persistent storage is unavailable.
      }
      setOverlay(false, 'dd2-guest-reminder');
      state.reminderResolve?.(true);
      state.reminderResolve = null;
    });
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
      if (event.key === 'Escape' && state.nativeView) {
        event.preventDefault();
        closeNativeView();
      }
    });
    global.addEventListener('popstate', () => {
      const hashView = location.hash.replace(/^#/, '');
      if (nativeDefinition(hashView)) renderNativeView(hashView, { push: false });
      else hideNativeView();
    });
    await initializeAuth();
    if (!state.user) syncAuthUi();
  }

  async function beforeGrade() {
    const access = await reconcileGuestAccess({ promptWhenExhausted: true });
    if (access.signedIn) return true;
    if (access.exhausted) return false;
    let shown = false;
    try {
      shown = localStorage.getItem(config.guest.reminderStorageKey) === 'shown';
    } catch {
      shown = false;
    }
    if (shown) return true;
    setOverlay(true, 'dd2-guest-reminder');
    return new Promise((resolve) => {
      state.reminderResolve = resolve;
    });
  }

  function gradingHeaders() {
    if (state.session?.access_token) {
      return { Authorization: `Bearer ${state.session.access_token}` };
    }
    return {
      'X-Guest-Device-ID': guestDeviceId(),
      'X-Request-ID': randomId(18),
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
    if (error?.code !== 'GUEST_LIMIT_REACHED') return false;
    if (typeof examStage !== 'undefined') examStage = 'answering';
    global.closeModal?.('checking-modal', { restoreFocus: false });
    requireSignInForGuestLimit();
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
