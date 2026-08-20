(function quorumFirstShell(global) {
  'use strict';

  const state = {
    initialized: false,
    open: false,
    restoreFocus: false,
  };

  function references() {
    const header = document.getElementById('site-header');
    const nav = document.getElementById('spa-nav');
    const toggle = document.getElementById('site-menu-toggle');
    const close = nav?.querySelector('[data-shell-menu-close]');
    const brand = header?.querySelector('[data-public-home]');
    const promos = [...document.querySelectorAll('#page-community .quorum-practice-card')];
    if (!header || !nav || !toggle || !close || !brand || !promos.length) return null;
    return { brand, close, header, nav, promos, toggle };
  }

  function focusable(nav) {
    return [...nav.querySelectorAll(
      'button:not([disabled]):not([tabindex="-1"]), a[href], summary, [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden && !element.closest('[hidden]'));
  }

  function synchronizeDrawer(refs, options = {}) {
    const open = refs.nav.classList.contains('is-open');
    const changed = state.open !== open;
    state.open = open;
    document.documentElement.classList.toggle('qfs-drawer-open', open);
    document.body.classList.toggle('qfs-drawer-open', open);
    refs.toggle.setAttribute('aria-expanded', String(open));
    refs.toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    refs.nav.setAttribute('aria-hidden', String(!open));
    refs.nav.inert = !open;
    refs.scrim.hidden = !open;

    if (open && changed && options.focusInside === true) {
      requestAnimationFrame(() => refs.close.focus({ preventScroll: true }));
    }
    if (!open && changed && (options.restoreFocus === true || state.restoreFocus)) {
      state.restoreFocus = false;
      requestAnimationFrame(() => refs.toggle.focus({ preventScroll: true }));
    }
  }

  function setDrawer(refs, open, options = {}) {
    state.restoreFocus = !open && options.restoreFocus === true;
    if (typeof global.setSiteMenuOpen === 'function') global.setSiteMenuOpen(open);
    else refs.nav.classList.toggle('is-open', open);
    synchronizeDrawer(refs, {
      focusInside: open && options.focusInside === true,
      restoreFocus: !open && options.restoreFocus === true,
    });
  }

  function makeScrim(header) {
    const existing = document.getElementById('qfs-menu-scrim');
    if (existing) return existing;
    const scrim = document.createElement('button');
    scrim.className = 'qfs-menu-scrim';
    scrim.id = 'qfs-menu-scrim';
    scrim.type = 'button';
    scrim.tabIndex = -1;
    scrim.hidden = true;
    scrim.setAttribute('aria-label', 'Close menu');
    header.append(scrim);
    return scrim;
  }

  function bindDrawer(refs) {
    refs.toggle.addEventListener('click', () => {
      queueMicrotask(() => synchronizeDrawer(refs, {
        focusInside: refs.nav.classList.contains('is-open'),
      }));
    });
    refs.close.addEventListener('click', () => setDrawer(refs, false, { restoreFocus: true }));
    refs.scrim.addEventListener('click', () => setDrawer(refs, false, { restoreFocus: true }));
    refs.nav.addEventListener('click', (event) => {
      if (event.target.closest('[data-public-feature], [data-pb-legal], [data-public-action], [data-quorum-view]')) {
        queueMicrotask(() => setDrawer(refs, false));
      }
    });
    refs.nav.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !state.open) return;
      const controls = focusable(refs.nav);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !state.open) return;
      event.preventDefault();
      setDrawer(refs, false, { restoreFocus: true });
    });
    new MutationObserver(() => synchronizeDrawer(refs))
      .observe(refs.nav, { attributes: true, attributeFilter: ['class'] });
  }

  function bindPracticePromo(refs) {
    for (const promo of refs.promos) {
      promo.classList.add('qfs-practice-promo');
      promo.querySelector('button')?.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('spa-mock')?.click();
      });
    }
  }

  function enforceVisibleLabels() {
    const labels = Object.freeze({
      'spa-community': 'Home',
      'spa-bar-easy': 'Guided Practice',
      'spa-jurisprudence': 'Doctrine Review',
      'spa-mock': 'Bar Question Practice',
      'spa-bar-feels': 'Bar Exam Simulation',
      'spa-pricing': 'Plans & Pricing',
      'spa-support': 'Support',
    });
    for (const [id, label] of Object.entries(labels)) {
      const control = document.getElementById(id);
      if (control) control.textContent = label;
    }
  }

  function initialize() {
    if (state.initialized) return true;
    const refs = references();
    if (!refs) return false;
    state.initialized = true;
    refs.scrim = makeScrim(refs.header);
    refs.header.classList.add('qfs-shell');
    refs.nav.classList.add('qfs-drawer');
    refs.toggle.classList.add('qfs-menu-toggle');
    refs.brand.setAttribute('href', '#quorum');
    refs.brand.setAttribute('aria-label', 'Due Diligence — Home');
    enforceVisibleLabels();
    bindDrawer(refs);
    bindPracticePromo(refs);
    synchronizeDrawer(refs);
    global.dispatchEvent(new CustomEvent('duediligence:quorum-first-shell-ready'));
    return true;
  }

  global.DueDiligenceQuorumFirstShell = Object.freeze({
    closeMenu() {
      const refs = references();
      if (!refs) return;
      refs.scrim = document.getElementById('qfs-menu-scrim');
      setDrawer(refs, false);
    },
    initialize,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
}(window));
