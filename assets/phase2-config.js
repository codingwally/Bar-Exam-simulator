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
    guest: Object.freeze({
      gradeLimit: 3,
      deviceStorageKey: 'duediligence.guest.device.v1',
      deviceCookieName: 'dd_guest_device',
      reminderStorageKey: 'duediligence.guest.reminder.v1',
    }),
    legal: Object.freeze({
      termsVersion: 'terms-beta-v2-2026-07-28',
      privacyVersion: 'privacy-beta-v2-2026-07-28',
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
      catalogVersion: 'beta-pricing-concealed-2026-07-30',
      notice: 'Pricing will be announced after beta testing.',
      items: Object.freeze([
        Object.freeze({
          id: 'premium',
          name: 'Premium',
          pricingHidden: true,
          previewStatus: 'beta',
          featurePlaceholders: Object.freeze([
            'All published Subject Matter practice categories',
            'Premium-only Bar Feels',
            'Private TXT and DOCX examination uploads',
            'Automated and Human Examiner review routes',
          ]),
        }),
      ]),
    }),
  });
})(window);

(function loadExplicitRetainerChoice(global) {
  'use strict';

  if (global.__ddExplicitRetainerChoiceLoader === true) return;
  global.__ddExplicitRetainerChoiceLoader = true;

  const script = document.createElement('script');
  script.src = 'assets/access-choice-gate.js?v=explicit-retainer-choice-20260818-1';
  script.async = false;
  script.dataset.ddExplicitRetainerChoice = 'true';
  document.head.appendChild(script);
})(window);
