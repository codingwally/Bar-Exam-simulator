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
      payments: true,
      subscriptionEnforcement: true,
      coachingBooking: false,
      emailSignIn: false,
      adminDashboard: true,
    }),
    plans: Object.freeze({
      catalogVersion: 'phase4-beta-pricing-v1-2026-07-28',
      notice: 'Manual, non-recurring access in Philippine pesos. Activation follows payment verification.',
      items: Object.freeze([
        Object.freeze({
          id: 'early_access_beta',
          name: 'Early Access Beta',
          pricePhp: 149,
          durationDays: 30,
          previewStatus: 'active',
          provisionalCopy: false,
          futureEntitlementKey: 'plan.early_access_beta',
          featurePlaceholders: Object.freeze([]),
        }),
        Object.freeze({
          id: 'standard',
          name: 'Standard',
          pricePhp: 249,
          durationDays: 30,
          previewStatus: 'active',
          provisionalCopy: false,
          futureEntitlementKey: 'plan.standard',
          featurePlaceholders: Object.freeze([]),
        }),
        Object.freeze({
          id: 'premium',
          name: 'Premium',
          pricePhp: 499,
          durationDays: null,
          previewStatus: 'disabled',
          provisionalCopy: false,
          futureEntitlementKey: 'plan.premium',
          featurePlaceholders: Object.freeze([
            'Held in Abeyance',
            'Further proceedings pending. Premium enrollment is not yet available.',
          ]),
        }),
      ]),
    }),
  });
})(window);
