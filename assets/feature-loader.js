(function dueDiligenceFeatureLoader(global) {
  'use strict';

  const loadedScripts = new Map();
  const loadedStyles = new Map();
  const featurePromises = new Map();
  const prefetchedAssets = new Set();

  const manifests = Object.freeze({
    quorum: Object.freeze({
      styles: ['assets/lex-forum.css?v=post-body-only-20260823-1'],
      scripts: ['assets/lex-forum.js?v=post-body-only-20260823-1'],
    }),
    examinations: Object.freeze({
      styles: [
        'assets/examinations.css?v=subject-matter-gil-fixes-20260817-5',
        'assets/study-workspace.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
      ],
      scripts: [
        'assets/study-workspace.js?v=syllabus-review-20260823-1',
        'assets/examinations.js?v=question-randomization-20260825-1',
      ],
    }),
    content: Object.freeze({
      styles: [
        'assets/duediligence-2026.css?v=guided-random-access-20260822-1',
        'assets/study-workspace.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
      ],
      scripts: [
        'assets/study-workspace.js?v=syllabus-review-20260823-1',
        'assets/duediligence-2026.js?v=content-runtime-20260826-1',
      ],
    }),
  });

  const featureGroups = Object.freeze({
    quorum: 'quorum',
    'subject-matter': 'examinations',
    'bar-feels': 'examinations',
    'bar-easy': 'content',
    verdict: 'content',
    'chair-cases': 'content',
    doctrines: 'content',
    'anchor-cases': 'content',
  });

  const protectedFeatureRoutes = Object.freeze({
    'subject-matter': '#subject-matter',
    'bar-feels': '#bar-feels',
    'bar-easy': '#bar-easy',
    verdict: '#verdict',
    doctrines: '#doctrines',
  });

  const protectedPageRoutes = Object.freeze({
    mock: '#mock-bar',
    'mock-bar': '#mock-bar',
    midterms: '#subject-matter',
    'subject-matter': '#subject-matter',
    'bar-feels': '#bar-feels',
    'bar-easy': '#bar-easy',
    doctrines: '#doctrines',
    verdict: '#verdict',
  });

  function hasResolvedAllowedAccess(access) {
    const unresolvedProfile = access?.basis === 'profile_required'
      || (access?.commercialLaunchEnabled === true && access?.profileCompleted === false);
    return access?.allowed === true
      && access?.termsRequired !== true
      && access?.reauthenticationRequired !== true
      && !unresolvedProfile;
  }

  async function ensureProtectedAccess(routeHash) {
    const phase4 = global.DueDiligencePhase4;
    if (!routeHash) return true;
    if (typeof phase4?.ensureProtectedAccess !== 'function') {
      global.toast?.('Access verification is still loading. Please try again.', 'warn');
      return false;
    }
    if (hasResolvedAllowedAccess(phase4.getAccess?.())) return true;
    try {
      return await phase4.ensureProtectedAccess(routeHash);
    } catch (error) {
      global.toast?.(error?.message || 'Your access could not be verified.', 'warn');
      return false;
    }
  }

  function loadStyle(href) {
    if (loadedStyles.has(href)) return loadedStyles.get(href);
    const existing = [...document.styleSheets]
      .map((sheet) => sheet.href || '')
      .some((value) => value && new URL(value, location.href).href === new URL(href, location.href).href);
    if (existing) {
      const ready = Promise.resolve();
      loadedStyles.set(href, ready);
      return ready;
    }
    const pending = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.ddFeatureAsset = 'style';
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(new Error(`Unable to load ${href}`)), { once: true });
      document.head.append(link);
    });
    loadedStyles.set(href, pending);
    return pending;
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.ddFeatureAsset = 'script';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
      document.body.append(script);
    });
    loadedScripts.set(src, pending);
    return pending;
  }

  function prefetchAsset(url, as) {
    const absolute = new URL(url, location.href).href;
    if (prefetchedAssets.has(absolute)) return;
    prefetchedAssets.add(absolute);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = as;
    link.href = url;
    link.dataset.ddFeaturePrefetch = as;
    link.addEventListener('error', () => prefetchedAssets.delete(absolute), { once: true });
    document.head.append(link);
  }

  function prefetchGroup(group) {
    const manifest = manifests[group];
    if (!manifest || featurePromises.has(group)) return;
    manifest.styles.forEach((href) => prefetchAsset(href, 'style'));
    manifest.scripts.forEach((src) => prefetchAsset(src, 'script'));
  }

  function scheduleSignedInPrefetch() {
    const run = async () => {
      try {
        await global.DueDiligencePhase2?.whenAuthReady?.();
        if (!global.DueDiligencePhase2?.getSession?.()?.access_token) return;
        prefetchGroup('content');
        global.setTimeout(() => prefetchGroup('examinations'), 800);
      } catch {
        // Prefetching is opportunistic and must never block navigation.
      }
    };
    const schedule = () => {
      if (typeof global.requestIdleCallback === 'function') {
        global.requestIdleCallback(run, { timeout: 2500 });
      } else {
        global.setTimeout(run, 1200);
      }
    };
    if (document.readyState === 'complete') schedule();
    else global.addEventListener('load', schedule, { once: true });
  }

  async function loadGroup(group) {
    if (!manifests[group]) return;
    if (featurePromises.has(group)) return featurePromises.get(group);
    const pending = (async () => {
      await Promise.all(manifests[group].styles.map(loadStyle));
      for (const script of manifests[group].scripts) await loadScript(script);
    })();
    featurePromises.set(group, pending);
    try {
      await pending;
    } catch (error) {
      featurePromises.delete(group);
      throw error;
    }
  }

  async function loadForFeature(feature, options = {}) {
    const routeHash = protectedFeatureRoutes[feature];
    if (routeHash && options.skipAccessCheck !== true) {
      const allowed = await ensureProtectedAccess(routeHash);
      if (!allowed) return false;
    }
    await loadGroup(featureGroups[feature] || feature);
    return true;
  }

  function deferredFunction(feature, globalName) {
    return async (...args) => {
      const placeholder = global[globalName];
      if (!await loadForFeature(feature)) return null;
      const implementation = global[globalName];
      if (typeof implementation !== 'function' || implementation === placeholder) {
        throw new Error('This feature could not be opened. Please refresh and try again.');
      }
      return implementation(...args);
    };
  }

  function installPageRouterGuard() {
    const originalShowPage = global.showPage;
    if (typeof originalShowPage !== 'function' || originalShowPage.__ddAccessGuarded === true) return;

    const guardedShowPage = function guardedShowPage(page, element, options = {}) {
      const routeHash = protectedPageRoutes[String(page || '').trim().toLowerCase()];
      if (!routeHash || options?.accessVerified === true) {
        return originalShowPage.call(this, page, element, options);
      }

      const access = global.DueDiligencePhase4?.getAccess?.();
      if (hasResolvedAllowedAccess(access)) {
        return originalShowPage.call(this, page, element, {
          ...options,
          accessVerified: true,
        });
      }

      ensureProtectedAccess(routeHash).then((allowed) => {
        if (!allowed) return;
        originalShowPage.call(global, page, element, {
          ...options,
          accessVerified: true,
        });
      }).catch(() => {});
      return false;
    };

    Object.defineProperty(guardedShowPage, '__ddAccessGuarded', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    global.showPage = guardedShowPage;
  }

  global.DueDiligenceFeatureLoader = Object.freeze({ loadForFeature, loadGroup });
  global.openBarEasy = deferredFunction('bar-easy', 'openBarEasy');
  global.openChairCases = deferredFunction('chair-cases', 'openChairCases');
  global.openDoctrines = deferredFunction('doctrines', 'openDoctrines');
  global.openAnchorCases = deferredFunction('anchor-cases', 'openAnchorCases');
  global.DueDiligenceQuorum = Object.freeze({
    open: async (...args) => {
      const placeholder = global.DueDiligenceQuorum;
      if (!await loadForFeature('quorum', { skipAccessCheck: true })) return null;
      if (global.DueDiligenceQuorum === placeholder) throw new Error('Home could not be opened.');
      return global.DueDiligenceQuorum.open(...args);
    },
  });
  global.DueDiligenceExaminations = Object.freeze({
    openPerSubject: async (...args) => {
      const placeholder = global.DueDiligenceExaminations;
      if (!await loadForFeature('subject-matter')) return null;
      if (global.DueDiligenceExaminations === placeholder) throw new Error('Syllabus-Based Review could not be opened.');
      return global.DueDiligenceExaminations.openPerSubject(...args);
    },
  });

  installPageRouterGuard();
  scheduleSignedInPrefetch();
}(window));
