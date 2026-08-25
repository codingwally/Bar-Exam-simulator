(function examinationRoomRenovation(global) {
  'use strict';

  const ROUTE = '#examination-room';

  function syncRouteClass() {
    const active = String(global.location?.hash || '').toLowerCase().startsWith(ROUTE);
    global.document?.body?.classList.toggle('dd26-examination-room-active', active);
  }

  syncRouteClass();
  global.addEventListener('hashchange', syncRouteClass, { passive: true });
  global.addEventListener('popstate', syncRouteClass, { passive: true });
}(window));
