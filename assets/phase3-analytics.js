(function dueDiligenceAnalytics(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  if (!config?.workerUrl) return;

  const KEYS = Object.freeze({
    visitor: 'duediligence.analytics.visitor.v1',
    session: 'duediligence.analytics.session.v1',
    landing: 'duediligence.analytics.landing.v1',
  });
  const state = {
    visitorId: null,
    sessionId: null,
    startedAt: Date.now(),
    lastQuestionKey: '',
    heartbeat: null,
  };

  function uuid(storageKey, sessionOnly = false) {
    const storage = sessionOnly ? sessionStorage : localStorage;
    try {
      const existing = storage.getItem(storageKey);
      if (/^[0-9a-f-]{36}$/i.test(existing || '')) return existing;
      const value = crypto.randomUUID();
      storage.setItem(storageKey, value);
      return value;
    } catch {
      return crypto.randomUUID();
    }
  }

  function eventKey() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  function deviceCategory() {
    const width = Math.max(document.documentElement.clientWidth || 0, global.innerWidth || 0);
    return width < 700 ? 'mobile' : width < 1100 ? 'tablet' : 'desktop';
  }

  function safeReferralHost() {
    if (!document.referrer) return null;
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      return host === location.hostname ? null : host.slice(0, 253);
    } catch {
      return null;
    }
  }

  function campaign() {
    const params = new URLSearchParams(location.search);
    return {
      utmSource: params.get('utm_source')?.slice(0, 120) || null,
      utmMedium: params.get('utm_medium')?.slice(0, 120) || null,
      utmCampaign: params.get('utm_campaign')?.slice(0, 160) || null,
    };
  }

  function pageArea() {
    if (location.pathname.startsWith('/admin')) return 'admin';
    if (location.hash) return location.hash.replace(/^#/, '').slice(0, 80) || 'home';
    return 'mock_bar';
  }

  function authHeaders() {
    const token = global.DueDiligencePhase2?.getSession?.()?.access_token;
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(global.DueDiligencePrivateBeta?.accessHeaders?.() || {}),
    };
  }

  function landingArea() {
    try {
      return sessionStorage.getItem(KEYS.landing) || pageArea();
    } catch {
      return pageArea();
    }
  }

  async function track(eventType, fields = {}, options = {}) {
    if (!state.visitorId || !state.sessionId) return false;
    const payload = {
      sessionId: state.sessionId,
      visitorId: state.visitorId,
      eventKey: eventKey(),
      eventType,
      pageArea: fields.pageArea || pageArea(),
      deviceCategory: deviceCategory(),
      referralHost: safeReferralHost(),
      landingArea: landingArea(),
      ...campaign(),
      ...fields,
    };
    try {
      const response = await fetch(`${config.workerUrl}/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
        keepalive: options.keepalive === true,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function observeQuestions() {
    const main = document.getElementById('main');
    if (!main) return;
    const check = () => {
      const label = main.querySelector('.q-label')?.textContent || '';
      const prompt = main.querySelector('.q-text');
      if (!prompt) return;
      const questionId = prompt.closest('[data-question-id]')?.dataset.questionId
        || label.match(/[A-Z]{2,5}-\d{3}|Q\.\d+/i)?.[0]
        || '';
      const subject = document.querySelector('.index-tabs button.active')?.textContent?.trim() || null;
      const key = `${subject}:${questionId}:${prompt.textContent?.slice(0, 80)}`;
      if (key === state.lastQuestionKey) return;
      state.lastQuestionKey = key;
      track('question_viewed', { subject, questionId: questionId || null });
    };
    new MutationObserver(check).observe(main, { childList: true, subtree: true });
    check();
  }

  function bindIntentEvents() {
    document.addEventListener('click', (event) => {
      const subjectButton = event.target.closest?.('#subject-tabs button');
      if (subjectButton) track('subject_selected', { subject: subjectButton.textContent.trim() });
      if (event.target.closest?.('[data-dd2-view="pricing"], #btn-subscribe')) track('pricing_viewed');
      if (event.target.closest?.('#dd2-google-signin, #dd2-account-signin, #dd2-reminder-signin')) {
        track('sign_in_started');
      }
    }, { passive: true });
  }

  function heartbeat() {
    if (document.visibilityState !== 'visible') return;
    track('session_heartbeat');
  }

  function initialize() {
    state.visitorId = uuid(KEYS.visitor);
    state.sessionId = uuid(KEYS.session, true);
    try {
      if (!sessionStorage.getItem(KEYS.landing)) sessionStorage.setItem(KEYS.landing, pageArea());
    } catch {
      // Landing area remains derivable for this request.
    }
    track('session_start');
    track('page_view');
    state.heartbeat = global.setInterval(heartbeat, 90_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        track('page_view');
        heartbeat();
      }
    });
    global.addEventListener('pagehide', () => {
      track('session_end', {
        durationMs: Math.min(14_400_000, Math.max(0, Date.now() - state.startedAt)),
      }, { keepalive: true });
    });
    observeQuestions();
    bindIntentEvents();
  }

  global.DueDiligenceAnalytics = Object.freeze({
    track,
    contextHeaders: () => ({
      'X-DD-Session-ID': state.sessionId || '',
      'X-DD-Visitor-ID': state.visitorId || '',
      'X-DD-Event-Key': eventKey(),
      'X-DD-Page-Area': pageArea(),
    }),
    identifiers: () => ({ visitorId: state.visitorId, sessionId: state.sessionId }),
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
