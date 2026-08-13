(function dueDiligenceFeatureLoader(global) {
  'use strict';

  const loadedScripts = new Map();
  const loadedStyles = new Map();
  const featurePromises = new Map();

  const manifests = Object.freeze({
    quorum: Object.freeze({
      styles: ['assets/lex-forum.css?v=master-experience-20260813-1'],
      scripts: ['assets/lex-forum.js?v=master-experience-20260813-1'],
    }),
    examinations: Object.freeze({
      styles: [
        'assets/examinations.css?v=design-correction-20260814-1',
        'assets/study-workspace.css?v=master-experience-20260813-1',
      ],
      scripts: [
        'assets/study-workspace.js?v=master-experience-20260813-1',
        'assets/examinations.js?v=design-correction-20260814-1',
      ],
    }),
    content: Object.freeze({
      styles: [
        'assets/duediligence-2026.css?v=master-experience-20260813-1',
        'assets/study-workspace.css?v=master-experience-20260813-1',
      ],
      scripts: [
        'assets/study-workspace.js?v=master-experience-20260813-1',
        'assets/duediligence-2026.js?v=master-experience-20260813-1',
      ],
    }),
    examinationRoom: Object.freeze({
      styles: ['assets/duediligence-2026.css?v=master-experience-20260813-1'],
      scripts: [
        'assets/examination-room-2-store.js?v=master-experience-20260813-1',
        'assets/duediligence-2026.js?v=master-experience-20260813-1',
      ],
    }),
  });

  const featureGroups = Object.freeze({
    quorum: 'quorum',
    'subject-matter': 'examinations',
    'bar-feels': 'examinations',
    'bar-easy': 'content',
    'chair-cases': 'content',
    doctrines: 'content',
    'anchor-cases': 'content',
    'examination-room': 'examinationRoom',
  });

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

  function loadForFeature(feature) {
    return loadGroup(featureGroups[feature] || feature);
  }

  function deferredFunction(feature, globalName) {
    return async (...args) => {
      const placeholder = global[globalName];
      await loadForFeature(feature);
      const implementation = global[globalName];
      if (typeof implementation !== 'function' || implementation === placeholder) {
        throw new Error('This feature could not be opened. Please refresh and try again.');
      }
      return implementation(...args);
    };
  }

  global.DueDiligenceFeatureLoader = Object.freeze({ loadForFeature, loadGroup });
  global.openPremiumBarFeels = deferredFunction('bar-feels', 'openPremiumBarFeels');
  global.openBarEasy = deferredFunction('bar-easy', 'openBarEasy');
  global.openChairCases = deferredFunction('chair-cases', 'openChairCases');
  global.openDoctrines = deferredFunction('doctrines', 'openDoctrines');
  global.openAnchorCases = deferredFunction('anchor-cases', 'openAnchorCases');
  global.openExaminationRoom = deferredFunction('examination-room', 'openExaminationRoom');
  global.DueDiligenceQuorum = Object.freeze({
    open: async (...args) => {
      const placeholder = global.DueDiligenceQuorum;
      await loadForFeature('quorum');
      if (global.DueDiligenceQuorum === placeholder) throw new Error('Quorum could not be opened.');
      return global.DueDiligenceQuorum.open(...args);
    },
  });
  global.DueDiligenceExaminations = Object.freeze({
    openPerSubject: async (...args) => {
      const placeholder = global.DueDiligenceExaminations;
      await loadForFeature('subject-matter');
      if (global.DueDiligenceExaminations === placeholder) throw new Error('Subject Matter could not be opened.');
      return global.DueDiligenceExaminations.openPerSubject(...args);
    },
  });
}(window));
