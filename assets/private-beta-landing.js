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
    'explore-academy',
    'explore-commons',
    'explore-barbound',
    'explore-examination-room',
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

  function showLanding(options = {}) {
    document.body.classList.add('private-beta-public');
    setHidden(landing, false);
    setHidden(appShell, true);
    const accessAllowed = options.accessAllowed === true
      || !gateEnabled
      || state.accessAllowed === true;
    publishAccessState(accessAllowed);
  }

  function activateApplicationRoute(hash) {
    const route = normalizedHash(hash).split(/[/?]/, 1)[0];
    if (state.lastActivatedHash === route) return;
    if (!['mock', 'mock-bar', 'subject-matter'].includes(route)) return;
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

  async function openProtectedFeature(feature, trigger = null) {
    const routes = {
      mock: '#mock-bar',
      quorum: '#quorum',
      'bar-feels': '#bar-feels',
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
    showApplication({ activateRoute: false });
    requestAnimationFrame(() => {
      if (feature === 'mock') {
        state.lastActivatedHash = 'mock-bar';
        global.showPage?.('mock', document.getElementById('spa-mock'));
      } else if (feature === 'quorum') {
        global.showPage?.('community', document.getElementById('spa-community'));
      } else if (feature === 'bar-feels') {
        global.openPremiumBarFeels?.();
      } else if (feature === 'examination-room') {
        global.openExaminationRoom?.();
      }
      trigger?.blur?.();
    });
  }

  function bindEvents() {
    document.querySelectorAll('[data-public-home]').forEach((link) => {
      link.addEventListener('click', async (event) => {
        if (event.defaultPrevented || event.target.closest?.('#brand-subtitle')) return;
        event.preventDefault();
        if (typeof global.returnToPublicHomepage === 'function') {
          await global.returnToPublicHomepage();
        } else {
          showPublicHomepage();
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
    document.querySelectorAll('[data-protected-feature]').forEach((button) => {
      button.addEventListener('click', () => openProtectedFeature(button.dataset.protectedFeature, button));
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
      if (!applicationRouteRequested()) {
        showLanding({ accessAllowed: !gateEnabled || state.accessAllowed === true });
        return;
      }
      if (currentSession()?.access_token && (!gateEnabled || state.accessAllowed === true)) {
        showApplication();
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
      else showLanding({ accessAllowed: true });
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
