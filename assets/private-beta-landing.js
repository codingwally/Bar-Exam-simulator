(function privateBetaLanding(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const landing = document.getElementById('private-beta-landing');
  const siteHeader = document.getElementById('site-header');
  const appShell = document.getElementById('authenticated-app-shell');
  const dialog = document.getElementById('private-beta-dialog');
  if (!landing || !siteHeader || !appShell || !dialog) return;

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
    routeActivationVersion: 0,
    quorumHomePromise: null,
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

  function requestedApplicationRoute(hash = location.hash) {
    return normalizedHash(hash).split(/[/?]/, 1)[0];
  }

  function renderPublicRoute({ focus = false } = {}) {
    const home = document.getElementById('public-platform');
    const view = document.getElementById('pb-chamber-view');
    if (!home || !view) return;
    setHidden(home, false);
    setHidden(view, true);
    view.replaceChildren();
    global.activatePrimaryMenuItem?.('');
    if (focus) requestAnimationFrame(() => home.querySelector('h1')?.focus?.({ preventScroll: true }));
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
    const route = requestedApplicationRoute(hash);
    if (state.lastActivatedHash === route && route !== 'examination-room') return;
    if (!['mock', 'mock-bar', 'subject-matter', 'bar-feels', 'verdict', 'examination-room'].includes(route)) return;
    const activationVersion = ++state.routeActivationVersion;
    const ownerUserId = String(currentSession()?.user?.id || '').trim();
    const isCurrent = () => activationVersion === state.routeActivationVersion
      && requestedApplicationRoute() === route
      && String(currentSession()?.user?.id || '').trim() === ownerUserId;
    if (route === 'examination-room') {
      const routeModuleWasLoaded = typeof global.DueDiligence2026?.restoreRoute === 'function';
      await loadFeature('examination-room');
      if (!isCurrent()) return;
      state.lastActivatedHash = route;
      if (routeModuleWasLoaded) {
        requestAnimationFrame(() => global.DueDiligence2026?.restoreRoute?.());
      }
      return;
    }
    if (route === 'subject-matter' || route === 'bar-feels' || route === 'verdict') await loadFeature(route);
    if (!isCurrent()) return;
    if (route === 'subject-matter') {
      if (typeof global.DueDiligenceExaminations?.restoreRoute !== 'function') {
        throw new Error('Subject Matter could not be restored. Please refresh and try again.');
      }
      const outcome = await global.DueDiligenceExaminations.restoreRoute('per_subject', { isCurrent });
      if (!isCurrent()) return;
      if (outcome?.status === 'retryable_error') return;
      if (outcome?.status !== 'restored') await global.DueDiligenceExaminations.openPerSubject?.();
      if (isCurrent()) state.lastActivatedHash = route;
      return;
    }
    if (route === 'bar-feels') {
      const outcome = await global.openPremiumBarFeels?.({ restoreActive: true, isCurrent });
      if (!isCurrent()) return;
      if (outcome?.status !== 'retryable_error') state.lastActivatedHash = route;
      return;
    }
    if (route === 'verdict') {
      if (typeof global.openVerdictDashboard !== 'function') {
        throw new Error('The Verdict could not be opened. Please refresh and try again.');
      }
      state.lastActivatedHash = route;
      global.openVerdictDashboard();
      return;
    }
    global.showPage?.('mock', document.getElementById('spa-mock'), { history: false });
    if (isCurrent()) state.lastActivatedHash = route;
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
    if (options.activateRoute !== false) {
      activateApplicationRoute(returnHash || location.hash).catch((error) => {
        global.toast?.(error?.message || 'This page could not be opened. Please try again.', 'warn');
      });
    }
    requestAnimationFrame(() => siteHeader.querySelector('.brand')?.focus?.({ preventScroll: true }));
  }

  function openQuorumHome(trigger = null) {
    if (state.quorumHomePromise) return state.quorumHomePromise;
    state.quorumHomePromise = openProtectedFeature('quorum', trigger)
      .finally(() => { state.quorumHomePromise = null; });
    return state.quorumHomePromise;
  }

  async function showPublicHomepage(options = {}) {
    if (dialog.open) dialog.close();
    state.lastActivatedHash = '';
    if (currentSession()?.access_token) {
      await openQuorumHome(siteHeader.querySelector('.brand'));
      return;
    }
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
      requestAnimationFrame(() => siteHeader.querySelector('.brand')?.focus?.({ preventScroll: true }));
    }
  }

  function normalizeSafeReturnHash(value) {
    const hash = String(value || '');
    if (/^#[a-z0-9][a-z0-9-]{0,64}$/i.test(hash) && !/^#(?:admin|auth|callback)/i.test(hash)) return hash;
    if (!hash.startsWith('#examination-room?')) return '';
    const parameters = new URLSearchParams(hash.slice('#examination-room?'.length));
    const allowed = new Set(['exam', 'submission', 'question', 'role']);
    const keys = [...parameters.keys()];
    if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) return '';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const examId = String(parameters.get('exam') || '');
    const submissionId = String(parameters.get('submission') || '');
    const question = String(parameters.get('question') || '');
    const role = String(parameters.get('role') || '');
    if (!uuid.test(examId) || (submissionId && !uuid.test(submissionId))
        || (question && (!/^\d{1,3}$/.test(question) || Number(question) < 1 || Number(question) > 200))
        || (role && !['student', 'professor'].includes(role))
        || (question && !submissionId)
        || (submissionId && role !== 'professor')) return '';
    const safe = new URLSearchParams({ exam: examId });
    if (role) safe.set('role', role);
    if (submissionId) safe.set('submission', submissionId);
    if (question) safe.set('question', question);
    return `#examination-room?${safe}`;
  }

  function safeReturnHash() {
    const value = global.sessionStorage?.getItem('duediligence.private-beta.return.v1') || '';
    global.sessionStorage?.removeItem('duediligence.private-beta.return.v1');
    return normalizeSafeReturnHash(value);
  }

  function preserveSafeReturnHash() {
    const hash = normalizeSafeReturnHash(location.hash || '');
    if (hash) global.sessionStorage?.setItem('duediligence.private-beta.return.v1', hash);
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
      setStatus('pb-code-status', 'Controlled access is temporarily unavailable. Please try again shortly.', 'error');
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
        ? 'Controlled access could not be verified. Wait before trying again.'
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
    setStatus('pb-final-status', 'Confirming access…');
    try {
      const result = await api.completeAdmission({
        authAccessToken: session.access_token,
        disclosureEndReached: true,
        acknowledgements: checkboxValues('pb-final'),
      });
      if (result.allowed !== true) throw new Error('Access was not granted.');
      setStatus('pb-final-status', 'Access confirmed.', 'success');
      showApplication();
    } catch (error) {
      const message = error?.code === 'PRIVATE_BETA_PENDING_REQUIRED'
        ? 'Your access-code verification expired. Verify the access code again.'
        : 'Access could not be completed. Please try again.';
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
      else if (authenticated) await openQuorumHome();
      else {
        showLanding({ accessAllowed: true });
        if (!authenticated && requestedApplicationRoute() === 'examination-room') {
          await openProtectedFeature('examination-room');
        }
      }
      return;
    }
    const api = privateBetaApi();
    if (!authenticated) {
      showLanding();
      if (requestedApplicationRoute() === 'examination-room') {
        await openProtectedFeature('examination-room');
        return;
      }
      if (api?.getPending?.()) {
        setStatus(
          'pb-google-status',
          'Your access code is still verified. Continue with Google to resume secure access.',
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
        else await openQuorumHome();
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
        'Your signed-in account could not be verified for access. Please try again.',
        'error',
      );
      openAdmission('google');
    } else {
      setStatus(
        'pb-disclosure-status',
        'Google sign-in succeeded, but this browser could not restore the secure-access checkpoint. Review the disclosure and verify the access code again; you will not need to sign in to Google a second time.',
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
    if (!loader?.loadForFeature) return false;
    return await loader.loadForFeature(feature);
  }

  async function openProtectedFeature(feature, trigger = null) {
    const routes = {
      mock: '#mock-bar',
      'subject-matter': '#subject-matter',
      verdict: '#verdict',
      'bar-easy': '#bar-easy',
      quorum: '#quorum',
      retainer: '#pricing',
      'bar-feels': '#bar-feels',
      'chair-cases': '#chairs-cases',
      doctrines: '#doctrines',
      'anchor-cases': '#anchor-case-digests',
      'examination-room': '#examination-room',
    };
    const returnHash = feature === 'examination-room'
      ? normalizeSafeReturnHash(location.hash) || routes[feature]
      : routes[feature] || '#mock-bar';
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
    if (feature !== 'retainer') {
      const allowed = await global.DueDiligencePhase4?.ensureProtectedAccess?.(returnHash);
      if (allowed !== true) return;
    }
    const loaded = feature === 'mock' || feature === 'retainer'
      ? true
      : await loadFeature(feature);
    if (loaded === false) return;
    showApplication({ activateRoute: false });
    requestAnimationFrame(() => {
      if (feature === 'mock') {
        state.lastActivatedHash = 'mock-bar';
        global.showPage?.('mock', document.getElementById('spa-mock'));
      } else if (feature === 'subject-matter') {
        global.DueDiligenceExaminations?.openPerSubject?.();
      } else if (feature === 'verdict') {
        const url = new URL(location.href);
        url.hash = routes.verdict;
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        if (`${location.pathname}${location.search}${location.hash}` !== nextUrl) {
          history.pushState({ ...(history.state || {}), dueDiligenceRoute: 'verdict' }, '', nextUrl);
        }
        state.lastActivatedHash = 'verdict';
        global.openVerdictDashboard?.();
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
    });
  }

  function bindEvents() {
    const handlePublicNavigation = async (event) => {
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
    };
    [landing, siteHeader].forEach((root) => root.addEventListener('click', handlePublicNavigation));
    document.addEventListener('click', (event) => {
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
        setStatus('pb-disclosure-status', 'Please scroll through and read the complete Platform Disclosure before agreeing.', 'error');
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
        if (currentSession()?.access_token && (!gateEnabled || state.accessAllowed === true)) {
          openQuorumHome();
        } else {
          showLanding({ accessAllowed: !gateEnabled || state.accessAllowed === true });
          renderPublicRoute({ focus: true });
        }
        return;
      }
      if (currentSession()?.access_token && (!gateEnabled || state.accessAllowed === true)) {
        showApplication();
      } else if (!currentSession()?.access_token && requestedApplicationRoute() === 'examination-room') {
        openProtectedFeature('examination-room');
      }
    });
    global.addEventListener('hashchange', () => {
      closePublicMenus();
      if (!applicationRouteRequested()) {
        if (currentSession()?.access_token && (!gateEnabled || state.accessAllowed === true)) {
          openQuorumHome();
        } else {
          showLanding({ accessAllowed: !gateEnabled || state.accessAllowed === true });
          renderPublicRoute({ focus: true });
        }
      } else if (currentSession()?.access_token && (!gateEnabled || state.accessAllowed === true)) {
        showApplication();
      } else if (!currentSession()?.access_token && requestedApplicationRoute() === 'examination-room') {
        openProtectedFeature('examination-room');
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
      else if (currentSession()?.access_token) await openQuorumHome();
      else {
        showLanding({ accessAllowed: true });
        renderPublicRoute({ focus: normalizedHash().startsWith('chamber/') });
        if (requestedApplicationRoute() === 'examination-room') {
          await openProtectedFeature('examination-room');
        }
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
