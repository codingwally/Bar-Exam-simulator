(function phase2Configuration(global) {
  'use strict';

  global.DueDiligencePhase2Config = Object.freeze({
    version: 'phase4-beta-2026-07-28',
    supabase: Object.freeze({
      url: 'https://hbllomlijfznnuudpdvr.supabase.co',
      publishableKey: 'sb_publishable_lQRSlxJPTDkKQIiT0hTfdg_ANVRUzym',
      oauthRedirectUrl: 'https://duediligence.ph/?auth=callback',
    }),
    workerUrl: 'https://duediligence-gemini-examiner.wallyesteban1993.workers.dev',
    maintenance: Object.freeze({
      enabled: true,
      tokenStorageKey: 'duediligence.maintenance.access.v1',
      headerName: 'X-DD-Maintenance-Access',
      unlockPath: '/maintenance/unlock',
      statusPath: '/maintenance/status',
      gateScriptUrl: '/assets/maintenance-gate.js?v=maintenance-lock-20260820-2',
    }),
    guest: Object.freeze({
      enabled: false,
      gradeLimit: 3,
      deviceStorageKey: 'duediligence.guest.device.v1',
      deviceCookieName: 'dd_guest_device',
      reminderStorageKey: 'duediligence.guest.reminder.v1',
    }),
    legal: Object.freeze({
      termsVersion: 'terms-commercial-v1-2026-08-18',
      privacyVersion: 'privacy-commercial-v1-2026-08-18',
      aiImprovementConsentVersion: 'ai-improvement-beta-v1-2026-07-28',
    }),
    features: Object.freeze({
      privateBetaGate: false,
      payments: false,
      subscriptionEnforcement: true,
      coachingBooking: false,
      emailSignIn: false,
      adminDashboard: true,
      examinationRoom2: true,
    }),
    plans: Object.freeze({
      catalogVersion: 'commercial-two-plan-2026-08-20',
      notice: 'Choose Free or the one-time Early Access offer.',
      items: Object.freeze([
        Object.freeze({
          id: 'free',
          name: 'Free',
          pricingHidden: false,
          previewStatus: 'active',
          featurePlaceholders: Object.freeze([
            'Five successful submissions per Philippine day',
            'One shared allowance across examination tracks',
          ]),
        }),
        Object.freeze({
          id: 'early_access_beta',
          name: 'Early Access',
          pricingHidden: false,
          previewStatus: 'active',
          featurePlaceholders: Object.freeze([
            'Unlimited access through October 1, 2026',
            'One-time payment with no automatic renewal',
          ]),
        }),
      ]),
    }),
  });
})(window);

(function loadMaintenancePasswordGate(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const maintenance = config?.maintenance;
  if (!maintenance?.enabled || !global.document || global.__ddMaintenanceGateLoader) return;
  global.__ddMaintenanceGateLoader = true;

  global.document.documentElement.dataset.ddMaintenance = 'locked';

  if (!global.document.getElementById('dd-maintenance-bootstrap-style')) {
    const style = global.document.createElement('style');
    style.id = 'dd-maintenance-bootstrap-style';
    style.textContent = [
      'html[data-dd-maintenance="locked"] body{',
      'visibility:hidden!important;',
      'background:#081225!important;',
      '}',
      'html[data-dd-maintenance="locked"] #dd-maintenance-gate{',
      'visibility:visible!important;',
      '}',
    ].join('');
    global.document.head.appendChild(style);
  }

  if (
    typeof global.fetch === 'function'
    && typeof global.Headers === 'function'
    && typeof global.Request === 'function'
    && global.fetch.__ddMaintenanceAware !== true
  ) {
    const nativeFetch = global.fetch.bind(global);
    const workerBase = String(config.workerUrl || '').replace(/\/+$/, '');
    const maintenanceFetch = function maintenanceAwareFetch(input, init = {}) {
      const rawUrl = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : '');
      const isWorkerRequest = rawUrl === workerBase || rawUrl.startsWith(`${workerBase}/`);
      if (!isWorkerRequest) return nativeFetch(input, init);

      const isRequest = input instanceof global.Request;
      const headers = new global.Headers(isRequest ? input.headers : undefined);
      new global.Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
      let token = '';
      try {
        token = global.localStorage?.getItem(maintenance.tokenStorageKey) || '';
      } catch {
        token = '';
      }
      if (token) headers.set(maintenance.headerName, token);

      if (isRequest) {
        return nativeFetch(new global.Request(input, { ...init, headers }));
      }
      return nativeFetch(input, { ...init, headers });
    };
    Object.defineProperty(maintenanceFetch, '__ddMaintenanceAware', { value: true });
    global.fetch = maintenanceFetch;
  }

  if (global.document.querySelector('script[data-dd-maintenance-gate="true"]')) return;
  const script = global.document.createElement('script');
  script.src = maintenance.gateScriptUrl;
  script.async = false;
  script.dataset.ddMaintenanceGate = 'true';
  global.document.head.appendChild(script);
})(window);
