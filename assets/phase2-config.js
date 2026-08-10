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
      marketingConsentVersion: 'marketing-beta-v1-2026-08-15',
      aiImprovementConsentVersion: 'ai-improvement-beta-v1-2026-07-28',
    }),
    features: Object.freeze({
      privateBetaGate: true,
      payments: false,
      subscriptionEnforcement: true,
      coachingBooking: false,
      emailSignIn: false,
      adminDashboard: true,
      examinationRoom2: false,
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
