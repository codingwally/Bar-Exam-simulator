(function phase2Configuration(global) {
  'use strict';

  global.DueDiligencePhase2Config = Object.freeze({
    version: 'phase2-beta-2026-07-28',
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
      termsVersion: 'terms-beta-v1-2026-08-15',
      privacyVersion: 'privacy-beta-v1-2026-08-15',
      marketingConsentVersion: 'marketing-beta-v1-2026-08-15',
    }),
    features: Object.freeze({
      payments: false,
      subscriptionEnforcement: false,
      coachingBooking: false,
      emailSignIn: false,
      adminDashboard: false,
    }),
    plans: Object.freeze({
      catalogVersion: 'planned-pricing-beta-v1-2026-07-28',
      notice: 'Planned pricing — subject to finalization.',
      items: Object.freeze([
        Object.freeze({
          id: 'early_access_beta',
          name: 'Early Access Beta Testing',
          pricePhp: 149,
          previewStatus: 'planned',
          provisionalCopy: true,
          futureEntitlementKey: 'plan.early_access_beta',
          featurePlaceholders: Object.freeze([]),
        }),
        Object.freeze({
          id: 'standard',
          name: 'Standard',
          pricePhp: 249,
          previewStatus: 'planned',
          provisionalCopy: true,
          futureEntitlementKey: 'plan.standard',
          featurePlaceholders: Object.freeze([]),
        }),
        Object.freeze({
          id: 'premium',
          name: 'Premium',
          pricePhp: 499,
          previewStatus: 'planned',
          provisionalCopy: true,
          futureEntitlementKey: 'plan.premium',
          featurePlaceholders: Object.freeze([
            'All features unlocked',
            'Scheduled in-person coaching',
            'Direct access',
          ]),
          futureCoaching: Object.freeze({
            credits: null,
            appointmentCapacity: null,
            timezone: 'Asia/Manila',
            location: null,
            reschedulingRules: null,
            cancellationRules: null,
            directAccessRules: null,
          }),
        }),
      ]),
    }),
  });
})(window);
