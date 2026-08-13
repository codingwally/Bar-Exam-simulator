(function privateBetaLanding(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const landing = document.getElementById('private-beta-landing');
  const appShell = document.getElementById('authenticated-app-shell');
  const dialog = document.getElementById('private-beta-dialog');
  if (!landing || !appShell || !dialog) return;

  const gateEnabled = config?.features?.privateBetaGate === true;
  const stages = ['disclosure', 'code', 'google-intro', 'google', 'final'];
  const acknowledgements = Object.freeze({
    aiLimitations: 'ai-limitations',
    educationalOnly: 'educational-only',
    termsAndPrivacy: 'terms-privacy',
  });
  const publicHomepageHashes = new Set([
    '',
    'public-platform',
    'chamber/academy',
    'chamber/commons',
    'chamber/barbound',
  ]);
  const chamberViews = Object.freeze({
    academy: Object.freeze({
      kicker: 'The Academy',
      title: 'Practice, review, and understand your progress.',
      copy: 'Build the habit of legal analysis through realistic essay practice, course-based review, and a private record that shows how your reasoning develops.',
      image: 'library-student',
      alt: 'Law student preparing in a library',
      features: Object.freeze([
        Object.freeze({ id: 'mock', title: 'Mock Bar', copy: 'Practice Philippine Bar-style essays across the existing eight subjects and receive source-backed coaching on the approved 0–5 practice scale. Expect realistic prompts and structured feedback, never an official Bar rating or prediction.' }),
        Object.freeze({ id: 'subject-matter', title: 'Subject Matter', copy: 'Choose a law-school course and practice one question at a time with technique matched to the task. After submission, review the suggested legal basis, why it applies, an adaptive discussion, answer guidance, and verified sources.' }),
        Object.freeze({ id: 'verdict', title: 'The Verdict', copy: 'Return to your private record of attempts, answers, coaching, and personal study exports. Use it to understand how your reasoning develops; it does not predict an official Bar result.' }),
      ]),
      access: 'Sign in when you begin an examination or open your personal record.',
    }),
    commons: Object.freeze({
      kicker: 'The Commons',
      title: 'Learn from clear materials and from one another.',
      copy: 'Learn the law in language you can use, exchange ideas with the Due Diligence community, and manage the access that supports your study.',
      image: 'library-community',
      alt: 'Students learning together in a library',
      features: Object.freeze([
        Object.freeze({ id: 'bar-easy', title: 'Bar Easy', copy: 'Express legal reasoning in plain language before seeing coaching and verified legal material. Expect a focused practice exchange that helps turn understanding into usable legal explanation.' }),
        Object.freeze({ id: 'quorum', title: 'Quorum', copy: 'Join Due Diligence’s academic community for questions, discussions, case notes, study assistance, resources, and study circles. Signed-in members may also use anonymous participation where the live feature allows it.' }),
        Object.freeze({ id: 'retainer', title: 'Retainer', copy: 'Review the membership and access options currently available to your account. Expect only verified live entitlements and plan information, not a discussion or study-posting area.' }),
      ]),
      access: 'Reading the introduction is public. Community participation and personal access details require sign-in.',
    }),
    barbound: Object.freeze({
      kicker: 'BarBound',
      title: 'Turn review into deliberate Bar preparation.',
      copy: 'Move from study to performance through complete simulations, doctrine recall, Chair’s Cases, and the decisions that anchor Philippine Bar subjects.',
      image: 'writing-notes',
      alt: 'Students reviewing notes and legal materials',
      features: Object.freeze([
        Object.freeze({ id: 'bar-feels', title: 'Bar Feels', copy: 'Enter a curated multi-question Bar simulation with the existing navigation, timed writing, review, and submission flow. Afterward, receive the current coaching experience without changing the approved grading system.' }),
        Object.freeze({ id: 'chair-cases', title: '2026 Bar Chair’s Cases', copy: 'Study selected decisions through their Bar relevance, facts, issue, ruling, doctrine, and disposition. Each record leads back to its official source for careful review.' }),
        Object.freeze({ id: 'doctrines', title: 'Doctrines', copy: 'Use a Recall → Explain → Verify sequence to retrieve a rule before reading it. Active recall makes the doctrine, its limits, and its authority easier to retain.' }),
        Object.freeze({ id: 'anchor-cases', title: 'Anchor Case Digests', copy: 'Review foundational cases through structured facts, issue, ruling, doctrine, disposition, and ALAC use where appropriate. Search the library and open the official primary source when deeper reading is needed.' }),
      ]),
      access: 'Protected BarBound features open only when your current account has the required access.',
    }),
  });
  const state = {
    stage: 'disclosure',
    disclosureEndReached: false,
    reducedMotion: global.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    busy: false,
    lastTrigger: null,
    accessAllowed: null,
    globalBetaEnabled: null,
    policyPromise: null,
    lastActivatedHash: '',
  };

  function privateBetaApi() {
    return global.DueDiligencePrivateBeta || null;
  }

  function currentSession() {
    return global.DueDiligencePhase2?.getSession?.() || null;
  }

  function setHidden(element, hidden) {
    if (!element) return;
    element.hidden = hidden;
    if (hidden) {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    } else {
      element.setAttribute('aria-hidden', 'false');
      element.removeAttribute('inert');
    }
  }

  function publishAccessState(allowed) {
    if (state.accessAllowed === allowed) return;
    state.accessAllowed = allowed;
    global.dispatchEvent(new CustomEvent('duediligence:private-beta-access', {
      detail: { allowed },
    }));
  }

  function normalizedHash(hash = location.hash) {
    try {
      return decodeURIComponent(String(hash || '').replace(/^#/, '')).trim();
    } catch {
      return String(hash || '').replace(/^#/, '').trim();
    }
  }

  function applicationRouteRequested(hash = location.hash) {
    return !publicHomepageHashes.has(normalizedHash(hash));
  }

  function renderPublicRoute({ focus = false } = {}) {
    const route = normalizedHash();
    const chamber = route.startsWith('chamber/') ? route.slice('chamber/'.length) : '';
    const definition = chamberViews[chamber];
    const home = document.getElementById('public-platform');
    const view = document.getElementById('pb-chamber-view');
    if (!home || !view) return;
    if (!definition) {
      setHidden(home, false);
      setHidden(view, true);
      view.replaceChildren();
      return;
    }
    const featureMarkup = definition.features.map((feature, index) => `<article class="pb-chamber-feature">
      <span class="pb-chamber-feature-number" aria-hidden="true">0${index + 1}</span>
      <div><h3>${feature.title}</h3><p>${feature.copy}</p></div>
      <button type="button" data-public-feature="${feature.id}">Open ${feature.title}</button>
    </article>`).join('');
    const firstFeature = definition.features[0];
    view.innerHTML = `<article class="pb-chamber-page">
      <section class="pb-chamber-intro">
        <div class="pb-chamber-intro-copy">
          <p class="pb-pillar-number">${definition.kicker}</p>
          <h1 tabindex="-1">${definition.title}</h1>
          <p>${definition.copy}</p>
          <div class="pb-chamber-intro-actions">
            <button class="pb-chamber-primary" type="button" data-public-feature="${firstFeature.id}">Begin with ${firstFeature.title}</button>
            <button class="pb-chamber-back" type="button" data-public-home>Back to all chambers</button>
          </div>
        </div>
        <figure class="pb-chamber-intro-visual">
          <picture>
            <source type="image/avif" srcset="assets/private-beta/${definition.image}-720.avif 720w, assets/private-beta/${definition.image}-1440.avif 1440w" sizes="(max-width:1120px) 100vw, 48vw">
            <source type="image/webp" srcset="assets/private-beta/${definition.image}-720.webp 720w, assets/private-beta/${definition.image}-1440.webp 1440w" sizes="(max-width:1120px) 100vw, 48vw">
            <img src="assets/private-beta/${definition.image}-720.jpg" width="720" height="960" loading="eager" decoding="async" alt="${definition.alt}">
          </picture>
        </figure>
      </section>
      <section class="pb-chamber-feature-index" aria-labelledby="pb-chamber-feature-title">
        <header>
          <p class="pb-eyebrow">Inside ${definition.kicker}</p>
          <h2 id="pb-chamber-feature-title">Choose your next step.</h2>
        </header>
        <div class="pb-chamber-feature-list">${featureMarkup}</div>
        <p class="pb-final-note">${definition.access}</p>
      </section>
    </article>`;
    setHidden(home, true);
    setHidden(view, false);
    if (focus) requestAnimationFrame(() => view.querySelector('h1')?.focus?.({ preventScroll: true }));
  }

  function showLanding(options = {}) {
    document.body.classList.add('private-beta-public');
    setHidden(landing, false);
    setHidden(appShell, true);
    const accessAllowed = options.accessAllowed === true
      || !gateEnabled
      || state.accessAllowed === true;
    publishAccessState(accessAllowed);
    renderPublicRoute();
  }

  async function activateApplicationRoute(hash) {
    const route = normalizedHash(hash).split(/[/?]/, 1)[0];
    if (state.lastActivatedHash === route) return;
    if (!['mock', 'mock-bar', 'subject-matter'].includes(route)) return;
    if (route === 'subject-matter') await loadFeature('subject-matter');
    state.lastActivatedHash = route;
    requestAnimationFrame(() => {
      if (route === 'subject-matter') {
        global.DueDiligenceExaminations?.openPerSubject?.();
        return;
      }
      global.showPage?.('mock', document.getElementById('spa-mock'), { history: false });
    });
  }

  function showApplication(options = {}) {
    if (dialog.open) dialog.close();
    document.body.classList.remove('private-beta-public');
    setHidden(landing, true);
    setHidden(appShell, false);
    global.syncModalIsolation?.();
    publishAccessState(true);
    const returnHash = safeReturnHash();
    if (returnHash && location.hash !== returnHash) history.replaceState({}, '', returnHash);
    if (options.activateRoute !== false) activateApplicationRoute(returnHash || location.hash);
    requestAnimationFrame(() => document.querySelector('#authenticated-app-shell .topbar')?.focus?.());
  }

  function showPublicHomepage(options = {}) {
    if (dialog.open) dialog.close();
    state.lastActivatedHash = '';
    showLanding({ accessAllowed: !gateEnabled || state.accessAllowed === true });
    if (options.history !== false) {
      const url = new URL(location.href);
      for (const parameter of ['forumPost', 'quorumEntry', 'quorumView', 'quorumCircle', 'quorumQuery']) {
        url.searchParams.delete(parameter);
      }
      url.hash = '';
      const nextUrl = `${url.pathname}${url.search}`;
      if (`${location.pathname}${location.search}${location.hash}` !== nextUrl) {
        history[options.replace === true ? 'replaceState' : 'pushState'](
          { ...(history.state || {}), dueDiligenceHome: true },
          '',
          nextUrl,
        );
      }
    }
    renderPublicRoute();
    global.scrollTo?.({ top: 0, behavior: 'auto' });
    if (options.focus !== false) {
      requestAnimationFrame(() => document.querySelector('#private-beta-landing .pb-brand')?.focus?.({ preventScroll: true }));
    }
  }

  function safeReturnHash() {
    const value = global.sessionStorage?.getItem('duediligence.private-beta.return.v1') || '';
    global.sessionStorage?.removeItem('duediligence.private-beta.return.v1');
    return /^#[a-z0-9][a-z0-9-]{0,64}$/i.test(value) && !/^#(?:admin|auth|callback)/i.test(value)
      ? value
      : '';
  }

  function preserveSafeReturnHash() {
    const hash = location.hash || '';
    if (/^#[a-z0-9][a-z0-9-]{0,64}$/i.test(hash) && !/^#(?:admin|auth|callback)/i.test(hash)) {
      global.sessionStorage?.setItem('duediligence.private-beta.return.v1', hash);
    }
  }

  function statusElement(id) {
    return document.getElementById(id);
  }

  function setStatus(id, message = '', kind = '') {
    const element = statusElement(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', kind === 'error');
    element.classList.toggle('is-success', kind === 'success');
  }

  function checkboxValues(prefix) {
    return Object.fromEntries(Object.entries(acknowledgements).map(([key, suffix]) => [
      key,
      document.getElementById(`${prefix}-${suffix}`)?.checked === true,
    ]));
  }

  function allAcknowledged(prefix) {
    return Object.values(checkboxValues(prefix)).every(Boolean);
  }

  function updateDisclosureAction() {
    const button = document.getElementById('pb-disclosure-continue');
    if (button) button.disabled = !(state.disclosureEndReached && allAcknowledged('pb-pre'));
  }

  function updateFinalAction() {
    const button = document.getElementById('pb-final-continue');
    if (button) button.disabled = !allAcknowledged('pb-final');
  }

  function markDisclosureEndReached() {
    if (state.disclosureEndReached) return;
    state.disclosureEndReached = true;
    const stateLabel = document.getElementById('pb-disclosure-state');
    if (stateLabel) {
      stateLabel.textContent = 'Complete disclosure reached.';
      stateLabel.classList.add('is-complete');
    }
    updateDisclosureAction();
  }

  function setProgress(stage) {
    const step = stage === 'disclosure' ? 0 : stage === 'code' ? 1 : stage.startsWith('google') ? 2 : 3;
    document.querySelectorAll('[data-pb-progress]').forEach((element, index) => {
      element.classList.toggle('is-current', index === step);
      if (index === step) element.setAttribute('aria-current', 'step');
      else element.removeAttribute('aria-current');
    });
  }

  function showStage(stage) {
    if (!stages.includes(stage)) return;
    state.stage = stage;
    document.querySelectorAll('[data-pb-stage]').forEach((element) => {
      element.hidden = element.dataset.pbStage !== stage;
    });
    setProgress(stage);
    const heading = document.querySelector(`[data-pb-stage='${stage}'] h3, [data-pb-stage='${stage}'] h2`);
    requestAnimationFrame(() => heading?.focus?.());
  }

  function openAdmission(stage = 'disclosure', trigger = null) {
    state.lastTrigger = trigger || document.activeElement;
    preserveSafeReturnHash();
    dialog.inert = false;
    dialog.removeAttribute('inert');
    delete dialog.dataset.ddModalInert;
    showStage(stage);
    if (!dialog.open) dialog.showModal();
    global.syncModalIsolation?.();
    requestAnimationFrame(() => {
      const heading = dialog.querySelector(`[data-pb-stage='${stage}'] h3, [data-pb-stage='${stage}'] h2`);
      heading?.focus?.();
    });
  }

  async function resolveGlobalBetaPolicy() {
    if (typeof state.globalBetaEnabled === 'boolean') return state.globalBetaEnabled;
    if (!state.policyPromise) {
      state.policyPromise = Promise.resolve(privateBetaApi()?.policy?.())
        .then((policy) => policy?.enabled === true)
        .catch(() => false);
    }
    state.globalBetaEnabled = await state.policyPromise;
    return state.globalBetaEnabled;
  }

  async function openPrimaryAdmission(trigger = null) {
    if (!gateEnabled) {
      global.DueDiligencePhase2?.openSignIn?.({
        allowDismiss: true,
        title: 'Welcome to Due Diligence',
        copy: 'Sign in with Google when you are ready to begin a protected activity.',
      });
      return;
    }
    await resolveGlobalBetaPolicy();
    if (state.globalBetaEnabled) {
      openAdmission(currentSession()?.access_token ? 'google-intro' : 'google', trigger);
      return;
    }
    openAdmission('disclosure', trigger);
  }

  function closeAdmission() {
    if (dialog.open) dialog.close();
    global.syncModalIsolation?.();
    state.lastTrigger?.focus?.();
  }

  async function verifyCode(event) {
    event.preventDefault();
    if (state.busy) return;
    if (!state.disclosureEndReached || !allAcknowledged('pb-pre')) {
      setStatus('pb-code-status', 'Confirm all required acknowledgments to continue.', 'error');
      showStage('disclosure');
      return;
    }
    const input = document.getElementById('pb-access-code');
    const submit = document.getElementById('pb-code-submit');
    const api = privateBetaApi();
    if (!api) {
      setStatus('pb-code-status', 'Private-beta access is temporarily unavailable. Please try again shortly.', 'error');
      return;
    }
    state.busy = true;
    if (submit) submit.disabled = true;
    setStatus('pb-code-status', 'Verifying access securely…');
    try {
      await api.verifyCode({
        accessCode: input?.value || '',
        disclosureEndReached: true,
        acknowledgements: checkboxValues('pb-pre'),
      });
      if (input) input.value = '';
      setStatus('pb-code-status', 'Access code verified.', 'success');
      showStage('google-intro');
    } catch (error) {
      const isRateLimited = error?.status === 429;
      setStatus('pb-code-status', isRateLimited
        ? 'Private-beta access could not be verified. Wait before trying again.'
        : 'That access code isn’t recognized. Review the hint and try again.', 'error');
      input?.focus?.();
    } finally {
      state.busy = false;
      if (submit) submit.disabled = false;
    }
  }

  async function continueToGoogle() {
    if (currentSession()?.access_token) {
      if (state.globalBetaEnabled) {
        await syncAuthenticatedState({ authenticated: true });
        return;
      }
      showStage('final');
      return;
    }
    showStage('google');
  }

  function signInWithGoogle() {
    setStatus('pb-google-status', 'Opening Google securely…');
    if (typeof global.mockAuth !== 'function') {
      setStatus('pb-google-status', 'Google sign-in is temporarily unavailable. Please try again shortly.', 'error');
      return;
    }
    global.mockAuth('Google');
  }

  async function completeAdmission() {
    if (state.busy) return;
    if (!allAcknowledged('pb-final')) {
      setStatus('pb-final-status', 'Confirm all required acknowledgments to continue.', 'error');
      return;
    }
    const session = currentSession();
    const api = privateBetaApi();
    if (!session?.access_token || !api) {
      setStatus('pb-final-status', 'Your Google session could not be verified. Sign in again to continue.', 'error');
      showStage('google');
      return;
    }
    const button = document.getElementById('pb-final-continue');
    state.busy = true;
    if (button) button.disabled = true;
    setStatus('pb-final-status', 'Confirming private-beta access…');
    try {
      const result = await api.completeAdmission({
        authAccessToken: session.access_token,
        disclosureEndReached: true,
        acknowledgements: checkboxValues('pb-final'),
      });
      if (result.allowed !== true) throw new Error('Private-beta access was not granted.');
      setStatus('pb-final-status', 'Private-beta access confirmed.', 'success');
      showApplication();
    } catch (error) {
      const message = error?.code === 'PRIVATE_BETA_PENDING_REQUIRED'
        ? 'Your access-code verification expired. Verify the access code again.'
        : 'Private-beta access could not be completed. Please try again.';
      setStatus('pb-final-status', message, 'error');
      if (error?.code === 'PRIVATE_BETA_PENDING_REQUIRED') showStage('code');
    } finally {
      state.busy = false;
      updateFinalAction();
    }
  }

  async function syncAuthenticatedState(detail = {}) {
    const authenticated = detail.authenticated === true || Boolean(currentSession()?.access_token);
    if (!gateEnabled) {
      if (authenticated && applicationRouteRequested()) showApplication();
      else showLanding({ accessAllowed: true });
      return;
    }
    const api = privateBetaApi();
    if (!authenticated) {
      showLanding();
      if (api?.getPending?.()) {
        setStatus(
          'pb-google-status',
          'Your access code is still verified. Continue with Google to resume private-beta admission.',
        );
        openAdmission('google');
      } else if (new URLSearchParams(location.search).has('code')
          || new URLSearchParams(location.search).has('error')
          || new URLSearchParams(location.search).has('auth')) {
        setStatus(
          'pb-disclosure-status',
          'Google sign-in could not restore this browser’s admission checkpoint. Review the disclosure and verify the access code again.',
          'error',
        );
        openAdmission('disclosure');
      }
      return;
    }
    if (!api) {
      showLanding();
      return;
    }
    try {
      const access = await api.status(currentSession().access_token);
      if (access?.allowed === true) {
        if (applicationRouteRequested()) showApplication();
        else showLanding({ accessAllowed: true });
        return;
      }
    } catch {
      showLanding();
    }
    showLanding();
    if (api.getPending?.()) {
      openAdmission('final');
      return;
    }
    if (state.globalBetaEnabled) {
      setStatus(
        'pb-google-status',
        'Your signed-in account could not be verified for Beta All Access. Please try again.',
        'error',
      );
      openAdmission('google');
    } else {
      setStatus(
        'pb-disclosure-status',
        'Google sign-in succeeded, but this browser could not restore the private-beta admission checkpoint. Review the disclosure and verify the access code again; you will not need to sign in to Google a second time.',
        'error',
      );
      openAdmission('disclosure');
    }
  }

  function openLegalView(view) {
    global.DueDiligencePhase2?.openView?.(view);
  }

  function closePublicMenus({ restoreFocus = false } = {}) {
    document.querySelectorAll('[data-pb-menu-trigger]').forEach((trigger) => {
      const menu = document.getElementById(trigger.getAttribute('aria-controls'));
      const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', `Show ${trigger.dataset.pbMenuTrigger === 'barbound'
        ? 'BarBound' : `${trigger.dataset.pbMenuTrigger[0].toUpperCase()}${trigger.dataset.pbMenuTrigger.slice(1)}`} features`);
      if (menu) menu.hidden = true;
      if (restoreFocus && wasOpen) trigger.focus({ preventScroll: true });
    });
  }

  function togglePublicMenu(trigger, forceOpen = null) {
    const menu = document.getElementById(trigger?.getAttribute('aria-controls'));
    if (!trigger || !menu) return;
    const opening = forceOpen == null
      ? trigger.getAttribute('aria-expanded') !== 'true'
      : forceOpen === true;
    closePublicMenus();
    trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
    trigger.setAttribute('aria-label', `${opening ? 'Hide' : 'Show'} ${trigger.dataset.pbMenuTrigger === 'barbound'
      ? 'BarBound' : `${trigger.dataset.pbMenuTrigger[0].toUpperCase()}${trigger.dataset.pbMenuTrigger.slice(1)}`} features`);
    menu.hidden = !opening;
    if (opening) requestAnimationFrame(() => menu.querySelector('[role="menuitem"]')?.focus?.());
  }

  async function loadFeature(feature) {
    const loader = global.DueDiligenceFeatureLoader;
    if (!loader?.loadForFeature) return;
    await loader.loadForFeature(feature);
  }

  async function openProtectedFeature(feature, trigger = null) {
    const routes = {
      mock: '#mock-bar',
      'subject-matter': '#subject-matter',
      verdict: '#mock-bar',
      'bar-easy': '#bar-easy',
      quorum: '#quorum',
      retainer: '#pricing',
      'bar-feels': '#bar-feels',
      'chair-cases': '#chairs-cases',
      doctrines: '#doctrines',
      'anchor-cases': '#anchor-case-digests',
      'examination-room': '#examination-room',
    };
    const returnHash = routes[feature] || '#mock-bar';
    await global.DueDiligencePhase2?.whenAuthReady?.();
    if (!currentSession()?.access_token) {
      global.DueDiligencePhase2?.openSignIn?.({
        allowDismiss: true,
        routeBound: true,
        returnHash,
        title: feature === 'examination-room' ? 'Enter the Examination Room' : 'Continue to Due Diligence',
        copy: 'Use Google to continue. You will return to the exact feature you selected.',
      });
      return;
    }
    await loadFeature(feature);
    showApplication({ activateRoute: false });
    requestAnimationFrame(() => {
      if (feature === 'mock') {
        state.lastActivatedHash = 'mock-bar';
        global.showPage?.('mock', document.getElementById('spa-mock'));
      } else if (feature === 'subject-matter') {
        global.DueDiligenceExaminations?.openPerSubject?.();
      } else if (feature === 'verdict') {
        state.lastActivatedHash = 'mock-bar';
        global.showPage?.('mock', document.getElementById('spa-mock'));
        document.getElementById('tab-history')?.click?.();
      } else if (feature === 'bar-easy') {
        global.openBarEasy?.();
      } else if (feature === 'quorum') {
        global.DueDiligenceQuorum?.open?.(document.getElementById('spa-community'));
      } else if (feature === 'retainer') {
        openLegalView('pricing');
      } else if (feature === 'bar-feels') {
        global.openPremiumBarFeels?.();
      } else if (feature === 'chair-cases') {
        global.openChairCases?.();
      } else if (feature === 'doctrines') {
        global.openDoctrines?.();
      } else if (feature === 'anchor-cases') {
        global.openAnchorCases?.();
      } else if (feature === 'examination-room') {
        global.openExaminationRoom?.();
      }
      trigger?.blur?.();
    });
  }

  function bindEvents() {
    landing.addEventListener('click', async (event) => {
      const home = event.target.closest?.('[data-public-home]');
      if (home && !event.defaultPrevented && !event.target.closest?.('#brand-subtitle')) {
        event.preventDefault();
        closePublicMenus();
        if (typeof global.returnToPublicHomepage === 'function') await global.returnToPublicHomepage();
        else showPublicHomepage();
        return;
      }
      const feature = event.target.closest?.('[data-public-feature]');
      if (feature) {
        event.preventDefault();
        closePublicMenus();
        await openProtectedFeature(feature.dataset.publicFeature, feature);
        return;
      }
      const chamberLink = event.target.closest?.('[data-pb-chamber-link]');
      if (chamberLink) {
        closePublicMenus();
        return;
      }
      const trigger = event.target.closest?.('[data-pb-menu-trigger]');
      if (trigger) {
        event.preventDefault();
        togglePublicMenu(trigger);
        return;
      }
      if (!event.target.closest?.('.pb-chamber-menu')) closePublicMenus();
    });
    document.querySelectorAll('[data-pb-menu-trigger]').forEach((trigger) => {
      trigger.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Escape') closePublicMenus({ restoreFocus: true });
        else {
          togglePublicMenu(trigger, true);
          const items = [...document.getElementById(trigger.getAttribute('aria-controls'))
            ?.querySelectorAll('[role="menuitem"]') || []];
          items[event.key === 'ArrowUp' ? items.length - 1 : 0]?.focus?.();
        }
      });
    });
    document.querySelectorAll('.pb-chamber-dropdown').forEach((menu) => {
      menu.addEventListener('keydown', (event) => {
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') {
          event.preventDefault();
          closePublicMenus({ restoreFocus: true });
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          items[(index + step + items.length) % items.length]?.focus?.();
        }
      });
    });
    document.querySelectorAll('[data-pb-open-admission]').forEach((button) => {
      button.addEventListener('click', () => { openPrimaryAdmission(button); });
    });
    document.querySelectorAll('[data-pb-open-disclosure]').forEach((button) => {
      button.addEventListener('click', () => openAdmission('disclosure', button));
    });
    document.querySelectorAll('[data-pb-legal]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openLegalView(button.dataset.pbLegal);
      });
    });
    document.querySelectorAll('[data-public-action="docket"]').forEach((button) => {
      button.addEventListener('click', () => {
        if (currentSession()?.access_token) openLegalView('account');
        else global.DueDiligencePhase2?.openSignIn?.({ allowDismiss: true, returnHash: '#account' });
      });
    });
    document.getElementById('pb-dialog-close')?.addEventListener('click', closeAdmission);
    document.querySelectorAll('[data-pb-cancel]').forEach((button) => button.addEventListener('click', closeAdmission));
    document.getElementById('pb-disclosure-jump')?.addEventListener('click', () => {
      const end = document.getElementById('pb-disclosure-end');
      end?.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'end' });
      end?.focus({ preventScroll: true });
      markDisclosureEndReached();
    });
    const disclosureScroll = document.getElementById('pb-disclosure-scroll');
    disclosureScroll?.addEventListener('scroll', () => {
      if (disclosureScroll.scrollTop + disclosureScroll.clientHeight >= disclosureScroll.scrollHeight - 12) {
        markDisclosureEndReached();
      }
    }, { passive: true });
    document.querySelectorAll("input[id^='pb-pre-']").forEach((input) => input.addEventListener('change', updateDisclosureAction));
    document.querySelectorAll("input[id^='pb-final-']").forEach((input) => input.addEventListener('change', updateFinalAction));
    document.getElementById('pb-disclosure-continue')?.addEventListener('click', () => {
      if (!state.disclosureEndReached) {
        setStatus('pb-disclosure-status', 'Please scroll through and read the complete Beta Disclosure before agreeing.', 'error');
        return;
      }
      if (!allAcknowledged('pb-pre')) {
        setStatus('pb-disclosure-status', 'Confirm all required acknowledgments to continue.', 'error');
        return;
      }
      setStatus('pb-disclosure-status');
      showStage('code');
    });
    document.getElementById('pb-code-form')?.addEventListener('submit', verifyCode);
    document.getElementById('pb-code-back')?.addEventListener('click', () => showStage('disclosure'));
    document.getElementById('pb-google-intro-continue')?.addEventListener('click', continueToGoogle);
    document.getElementById('pb-google-intro-back')?.addEventListener('click', () => showStage('code'));
    document.getElementById('pb-google-signin')?.addEventListener('click', signInWithGoogle);
    document.getElementById('pb-google-back')?.addEventListener('click', () => showStage('google-intro'));
    document.getElementById('pb-final-continue')?.addEventListener('click', completeAdmission);
    document.getElementById('pb-final-back')?.addEventListener('click', () => showStage('google'));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeAdmission();
    });
    global.addEventListener('duediligence:session', (event) => {
      syncAuthenticatedState(event.detail || {});
    });
    global.addEventListener('popstate', () => {
      closePublicMenus();
      if (!applicationRouteRequested()) {
        showLanding({ accessAllowed: !gateEnabled || state.accessAllowed === true });
        renderPublicRoute({ focus: true });
        return;
      }
      if (currentSession()?.access_token && (!gateEnabled || state.accessAllowed === true)) {
        showApplication();
      }
    });
    global.addEventListener('hashchange', () => {
      closePublicMenus();
      if (!applicationRouteRequested()) {
        showLanding({ accessAllowed: !gateEnabled || state.accessAllowed === true });
        renderPublicRoute({ focus: true });
      }
    });
    const end = document.getElementById('pb-disclosure-end');
    if ('IntersectionObserver' in global && end && disclosureScroll) {
      const disclosureObserver = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting === true) markDisclosureEndReached();
      }, { root: disclosureScroll, threshold: .9 });
      disclosureObserver.observe(end);
    }
  }

  async function initialize() {
    await global.DueDiligencePhase2?.whenAuthReady?.();
    if (!gateEnabled) {
      bindEvents();
      if (currentSession()?.access_token && applicationRouteRequested()) showApplication();
      else {
        showLanding({ accessAllowed: true });
        renderPublicRoute({ focus: normalizedHash().startsWith('chamber/') });
      }
      return;
    }
    showLanding();
    bindEvents();
    updateDisclosureAction();
    updateFinalAction();
    await resolveGlobalBetaPolicy();
    syncAuthenticatedState({ authenticated: Boolean(currentSession()?.access_token) });
  }

  global.DueDiligencePublicHome = Object.freeze({
    show: showPublicHomepage,
    showApplication,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
