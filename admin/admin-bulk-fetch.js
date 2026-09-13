(function installAdminBulkFetch(global) {
  'use strict';

  if (!global || typeof global.fetch !== 'function' || global.__dueDiligenceAdminBulkFetchInstalled) return;
  global.__dueDiligenceAdminBulkFetchInstalled = true;

  const nativeFetch = global.fetch.bind(global);
  const BULK_PAGE_SIZE = 500;
  const DIRECTORY_BULK_SECTIONS = new Set([
    'paid_subscribers',
    'business_revenue',
    'business_projections',
    'payments',
    'security',
  ]);
  const PHASE4_BULK_SECTIONS = new Set([
    'paid_subscribers',
    'business_revenue',
    'business_projections',
  ]);
  const PHASE4_BULK_DATA = new Set(['payments', 'refunds']);

  function currentSection() {
    return String(global.location?.hash || '')
      .replace(/^#/, '')
      .split('?')[0]
      .trim()
      .toLowerCase();
  }

  global.fetch = function adminBulkFetch(input, init) {
    try {
      const options = init || {};
      if (String(options.method || 'GET').toUpperCase() !== 'POST' || typeof options.body !== 'string') {
        return nativeFetch(input, init);
      }

      const rawUrl = typeof input === 'string' ? input : input?.url;
      if (!rawUrl) return nativeFetch(input, init);

      const url = new URL(rawUrl, global.location?.href || undefined);
      const section = currentSection();
      let body;
      let shouldBulk = false;

      if (url.pathname.endsWith('/admin/user-directory') && DIRECTORY_BULK_SECTIONS.has(section)) {
        body = JSON.parse(options.body);
        shouldBulk = Number(body?.limit) === 100;
      } else if (url.pathname.endsWith('/admin/phase4-data') && PHASE4_BULK_SECTIONS.has(section)) {
        body = JSON.parse(options.body);
        shouldBulk = Number(body?.limit) === 100
          && PHASE4_BULK_DATA.has(String(body?.section || '').trim().toLowerCase());
      }

      if (!shouldBulk || !body || typeof body !== 'object' || Array.isArray(body)) {
        return nativeFetch(input, init);
      }

      body.limit = BULK_PAGE_SIZE;
      body.bulk = true;
      return nativeFetch(input, { ...options, body: JSON.stringify(body) });
    } catch (_error) {
      return nativeFetch(input, init);
    }
  };
})(window);
