(function accessChoiceGate(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  if (!config?.supabase?.url || !config?.supabase?.publishableKey) return;

  const TRIAL_END_COPY = 'September 1, 2026 at 11:59 PM Philippine time';
  const state = {
    installed: false,
    observer: null,
    patchScheduled: false,
    choiceBusy: false,
    earlyAccessBypass: false,
    lastAccess: null,
    refreshTimer: null,
  };

  function phase4() {
    return global.DueDiligencePhase4 || global.DueDiligencePhase2 || null;
  }

  function session() {
    return phase4()?.getSession?.() || null;
  }

  function currentAccess() {
    return phase4()?.getAccess?.() || state.lastAccess || null;
  }

  function randomId(byteLength = 18) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function choiceRequired(access = currentAccess()) {
    return access?.choiceRequired === true
      || access?.planSelectionRequired === true
      || access?.basis === 'plan_selection_required';
  }

  function paymentRequired(access = currentAccess()) {
    return access?.paymentRequired === true
      || ['payment_required', 'trial_expired'].includes(access?.basis);
  }

  function mandatoryRetainer(access = currentAccess()) {
    return choiceRequired(access) || paymentRequired(access);
  }

  function toast(message, type = 'info') {
    global.toast?.(message, type);
  }

  function installToastCopyGuard() {
    if (global.toast?.__ddChoiceGuard === true) return;
    const original = global.toast;
    if (typeof original !== 'function') return;
    const guarded = function guardedToast(message, type, ...rest) {
      const copy = String(message || '').startsWith('Early Access is required.')
        ? 'Choose Free Trial or ₱149 Early Access before continuing.'
        : message;
      return original.call(this, copy, type, ...rest);
    };
    Object.defineProperty(guarded, '__ddChoiceGuard', { value: true });
    global.toast = guarded;
  }

  function ensureStyles() {
    if (document.getElementById('dd2-access-choice-style')) return;
    const style = document.createElement('style');
    style.id = 'dd2-access-choice-style';
    style.textContent = `
      #dd2-pricing-plans.dd2-access-choice-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        align-items: stretch;
      }
      #dd2-pricing-plans .dd2-plan[data-dd2-plan-choice] {
        position: relative;
        height: 100%;
      }
      #dd2-pricing-plans .dd2-plan[data-dd2-plan-choice]:not(.is-disabled) {
        cursor: pointer;
      }
      #dd2-pricing-plans .dd2-plan[data-dd2-plan-choice]:focus-visible {
        outline: 3px solid rgba(197, 160, 89, .42);
        outline-offset: 3px;
      }
      #dd2-pricing-plans .dd2-plan-trial {
        border-color: rgba(0, 33, 71, .18);
      }
      #dd2-pricing-plans .dd2-plan-choice-status {
        margin: 10px 0 0;
        font-size: 12px;
        color: var(--ink-soft, #475569);
      }
      #dd2-pricing-plans .dd2-plan-choice-status strong {
        color: var(--navy, #002147);
      }
      @media (max-width: 760px) {
        #dd2-pricing-plans.dd2-access-choice-grid {
          grid-template-columns: minmax(0, 1fr) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setMandatoryControls(required) {
    for (const id of ['dd2-native-close', 'dd2-native-back']) {
      const control = document.getElementById(id);
      if (!control) continue;
      control.hidden = required;
      control.disabled = required;
      if (required) control.setAttribute('aria-hidden', 'true');
      else control.removeAttribute('aria-hidden');
    }
    document.getElementById('dd2-native-view')
      ?.toggleAttribute('data-access-choice-required', required);
  }

  function trialAvailable(access) {
    if (access?.trialAvailable === false) return false;
    const trialEnd = Date.parse(access?.trialEndsAt || '2026-09-01T15:59:59.000Z');
    return Number.isFinite(trialEnd) && Date.now() <= trialEnd;
  }

  function trialCardMarkup(access) {
    const active = access?.basis === 'launch_trial' && access?.allowed === true;
    const selectedEarly = access?.selectedChoice === 'early_access';
    const available = trialAvailable(access);
    const entitled = access?.allowed === true && access?.unlimited === true && !active;
    let action = 'Start Free Trial';
    let disabled = false;
    if (active) {
      action = 'Free Trial active';
      disabled = true;
    } else if (entitled) {
      action = 'Access already active';
      disabled = true;
    } else if (selectedEarly && available) {
      action = 'Use Free Trial instead';
    } else if (!available) {
      action = 'Free Trial ended';
      disabled = true;
    }

    return `
      <article class="dd2-plan dd2-plan-trial${disabled ? ' is-disabled' : ''}"
        data-dd2-plan-choice="launch_trial" ${disabled ? '' : 'tabindex="0" role="button"'}>
        <div class="dd2-plan-head">
          <div><h3>Free Trial</h3><span class="dd2-badge">Explicit choice required</span></div>
          <div class="dd2-price">₱0<small>no payment</small></div>
        </div>
        <p>Unlimited access through ${TRIAL_END_COPY}. The trial starts only when you choose it.</p>
        <ul>
          <li>All currently protected practice features</li>
          <li>Saved progress and history remain attached to your account</li>
          <li>No automatic renewal and no payment required</li>
        </ul>
        <p class="dd2-plan-date"><strong>Trial ends:</strong> ${TRIAL_END_COPY}</p>
        <p class="dd2-plan-note">One launch trial per account. It is never activated automatically.</p>
        <button class="dd2-button ${disabled ? 'dd2-button-secondary' : 'dd2-button-primary'}"
          id="dd2-choose-launch-trial" type="button" ${disabled ? 'disabled' : ''}>${action}</button>
      </article>`;
  }

  function selectedChoiceCopy(access) {
    if (choiceRequired(access)) {
      return '<strong>Choose before continuing.</strong> Every new or existing ordinary account must select either the Free Trial or ₱149 Early Access. Signing in alone does not grant access.';
    }
    if (access?.basis === 'launch_trial') {
      return `<strong>Free Trial active.</strong> Your selected trial remains available through ${TRIAL_END_COPY}.`;
    }
    if (access?.basis === 'trial_expired') {
      return '<strong>Your Free Trial has ended.</strong> Choose Early Access and complete payment verification to continue using protected features.';
    }
    if (access?.selectedChoice === 'early_access' && paymentRequired(access)) {
      return '<strong>Early Access selected.</strong> Complete the ₱149 payment and submit proof to activate provisional access while verification is pending.';
    }
    return '<strong>Choose the access that applies to you.</strong> Free Trial and Early Access are account-bound and never activate automatically.';
  }

  function patchRetainer() {
    state.patchScheduled = false;
    ensureStyles();
    const host = document.getElementById('dd2-pricing-plans');
    if (!host) return;

    const access = currentAccess();
    const body = document.getElementById('dd2-native-body');
    const intro = body?.querySelector('.dd2-pricing-intro');
    if (intro) {
      const copy = selectedChoiceCopy(access);
      if (intro.innerHTML !== copy) intro.innerHTML = copy;
      intro.dataset.ddPaidCopy = 'true';
      intro.dataset.ddChoiceCopy = 'true';
    }

    host.classList.add('dd2-access-choice-grid');
    host.querySelectorAll('.dd2-plan').forEach((card) => {
      const title = card.querySelector('h3')?.textContent?.trim().toLowerCase();
      if (!card.hasAttribute('data-dd2-plan-choice')
          && ['free', 'free trial'].includes(title)) {
        card.remove();
      }
    });

    let trialCard = host.querySelector('[data-dd2-plan-choice="launch_trial"]');
    const trialMarkup = trialCardMarkup(access);
    if (!trialCard || trialCard.dataset.dd2State !== JSON.stringify({
      basis: access?.basis || null,
      selectedChoice: access?.selectedChoice || null,
      allowed: access?.allowed === true,
      available: trialAvailable(access),
    })) {
      const template = document.createElement('template');
      template.innerHTML = trialMarkup.trim();
      const replacement = template.content.firstElementChild;
      replacement.dataset.dd2State = JSON.stringify({
        basis: access?.basis || null,
        selectedChoice: access?.selectedChoice || null,
        allowed: access?.allowed === true,
        available: trialAvailable(access),
      });
      const earlyCard = host.querySelector('.dd2-plan-featured');
      if (trialCard) trialCard.replaceWith(replacement);
      else if (earlyCard) host.insertBefore(replacement, earlyCard);
      else host.prepend(replacement);
      trialCard = replacement;
    }

    const earlyCard = host.querySelector('.dd2-plan-featured');
    if (earlyCard) {
      earlyCard.dataset.dd2PlanChoice = 'early_access';
      const earlyButton = earlyCard.querySelector('#dd2-open-payment');
      if (earlyButton && !earlyButton.disabled) {
        earlyButton.textContent = access?.selectedChoice === 'early_access'
          ? 'Continue payment — ₱149'
          : 'Choose Early Access — ₱149';
      }
    }

    const mandatory = mandatoryRetainer(access);
    setMandatoryControls(mandatory);
    if (mandatory) {
      const kicker = document.getElementById('dd2-native-kicker');
      const title = document.getElementById('dd2-native-title');
      if (kicker) kicker.textContent = 'Retainer';
      if (title) title.textContent = choiceRequired(access)
        ? 'Choose Free Trial or Early Access'
        : 'Complete your Early Access subscription';
      if (choiceRequired(access)) {
        requestAnimationFrame(() => {
          document.getElementById('dd2-choose-launch-trial')?.focus?.({ preventScroll: true });
        });
      }
    }
  }

  function schedulePatch() {
    if (state.patchScheduled) return;
    state.patchScheduled = true;
    requestAnimationFrame(patchRetainer);
  }

  async function chooseAccess(choice) {
    if (state.choiceBusy) return;
    const activeSession = session();
    if (!activeSession?.access_token) {
      phase4()?.openSignIn?.();
      toast('Sign in with Google before choosing access.', 'warn');
      return;
    }

    state.choiceBusy = true;
    const trialButton = document.getElementById('dd2-choose-launch-trial');
    const earlyButton = document.getElementById('dd2-open-payment');
    if (trialButton) trialButton.disabled = true;
    if (earlyButton) earlyButton.disabled = true;
    const selectedButton = choice === 'launch_trial' ? trialButton : earlyButton;
    const originalLabel = selectedButton?.textContent || '';
    if (selectedButton) selectedButton.textContent = 'Recording your choice…';

    try {
      const endpoint = new URL('/rest/v1/rpc/phase4_choose_access', config.supabase.url);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: config.supabase.publishableKey,
          Authorization: `Bearer ${activeSession.access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          p_choice: choice,
          p_request_key: randomId(18),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.message || payload?.error_description || 'Your access choice could not be recorded.');
        error.status = response.status;
        throw error;
      }

      state.lastAccess = payload?.access || null;
      const refreshed = await phase4()?.refreshAccess?.({ enforce: false });
      if (refreshed) state.lastAccess = refreshed;
      schedulePatch();

      if (choice === 'launch_trial' && state.lastAccess?.allowed === true) {
        toast(`Free Trial selected. Access is active through ${TRIAL_END_COPY}.`, 'success');
        requestAnimationFrame(() => {
          const close = document.getElementById('dd2-native-close');
          if (close && !close.disabled) close.click();
        });
        return;
      }

      if (choice === 'early_access') {
        toast('Early Access selected. Complete the ₱149 payment and submit proof.', 'success');
        requestAnimationFrame(() => {
          const button = document.getElementById('dd2-open-payment');
          if (!button || button.disabled) return;
          state.earlyAccessBypass = true;
          button.click();
          queueMicrotask(() => {
            state.earlyAccessBypass = false;
          });
        });
      }
    } catch (error) {
      if (selectedButton) selectedButton.textContent = originalLabel;
      toast(error.message || 'Your access choice could not be recorded.', 'error');
    } finally {
      state.choiceBusy = false;
      schedulePatch();
    }
  }

  function installInteractionGuards() {
    document.addEventListener('click', (event) => {
      const trialTrigger = event.target.closest('#dd2-choose-launch-trial, [data-dd2-plan-choice="launch_trial"]');
      if (trialTrigger && !event.target.closest('a, input, select, textarea, label')) {
        const button = trialTrigger.matches('#dd2-choose-launch-trial')
          ? trialTrigger
          : trialTrigger.querySelector('#dd2-choose-launch-trial');
        if (!button || button.disabled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        chooseAccess('launch_trial');
        return;
      }

      const earlyButton = event.target.closest('#dd2-open-payment');
      if (!earlyButton || earlyButton.disabled || state.earlyAccessBypass) return;
      if (!session()?.access_token) return;
      const access = currentAccess();
      if (access?.selectedChoice === 'early_access') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseAccess('early_access');
    }, true);

    document.addEventListener('keydown', (event) => {
      const card = event.target.closest('[data-dd2-plan-choice="launch_trial"]');
      if (!card || !['Enter', ' '].includes(event.key)) return;
      const button = card.querySelector('#dd2-choose-launch-trial');
      if (!button || button.disabled) return;
      event.preventDefault();
      chooseAccess('launch_trial');
    }, true);
  }

  function requestAccessRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(async () => {
      if (!session()?.access_token) return;
      try {
        const access = await phase4()?.refreshAccess?.();
        if (access) state.lastAccess = access;
      } catch {
        // The existing access layer presents the actionable error.
      }
      schedulePatch();
    }, 80);
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    installToastCopyGuard();
    ensureStyles();
    installInteractionGuards();

    state.observer = new MutationObserver(schedulePatch);
    state.observer.observe(document.body, {
      subtree: true,
      childList: true,
    });

    global.addEventListener('duediligence:access', (event) => {
      state.lastAccess = event.detail || null;
      schedulePatch();
    });
    global.addEventListener('duediligence:session', (event) => {
      if (event.detail?.authenticated) requestAccessRefresh();
      else {
        state.lastAccess = null;
        schedulePatch();
      }
    });
    global.addEventListener('hashchange', requestAccessRefresh);
    global.addEventListener('pageshow', requestAccessRefresh);
    schedulePatch();
    requestAccessRefresh();
  }

  function waitForAccessLayer(attempt = 0) {
    if (phase4()?.refreshAccess && document.body) {
      install();
      return;
    }
    if (attempt >= 120) return;
    setTimeout(() => waitForAccessLayer(attempt + 1), 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForAccessLayer(), { once: true });
  } else {
    waitForAccessLayer();
  }
}(window));
