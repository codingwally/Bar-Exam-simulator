(function permanentFreeCompatibility(global) {
  'use strict';

  // Retained only for cache-safe compatibility with older Pages documents.
  // Current access copy and behavior are rendered natively by Phase 2 and
  // enforced server-side by Phase 4.
  global.DueDiligencePermanentFree = Object.freeze({ dailyLimit: 5 });
}(window));
