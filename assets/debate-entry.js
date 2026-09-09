(function debateEntry(global) {
  'use strict';
  const returnKey = 'duediligence.debate.auth-return.v3';
  const callbackArrived = /(?:[?&]auth=callback|[?&]code=)/.test(global.location.search);
  let generation = 0;
  const session = () => global.DueDiligencePhase4?.getSession?.() || global.DueDiligencePhase2?.getSession?.() || null;
  function resume() {
    if (!callbackArrived || !session()?.access_token) return;
    let saved; try { saved = JSON.parse(global.sessionStorage.getItem(returnKey)); } catch { return; }
    if (!saved) return;
    global.sessionStorage.removeItem(returnKey);
    if (!Number.isFinite(saved.at) || Date.now() - saved.at > 1800000) return;
    let url; try { url = new URL(saved.path, global.location.origin); } catch { return; }
    if (url.origin === global.location.origin && url.pathname === '/debate-room/') global.location.replace(url.pathname + url.search + url.hash);
  }
  async function refresh() {
    const version = ++generation, base = global.DueDiligencePhase2Config?.workerUrl;
    if (!base) return;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const token = session()?.access_token;
      const response = await fetch(`${base.replace(/\/$/, '')}/debate-room/access`, { cache: 'no-store', credentials: 'omit', headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
      const result = await response.json();
      if (version !== generation) return;
      document.querySelectorAll('[data-debate-room-entry]').forEach(link => { link.hidden = !(response.ok && result.enabled === true); });
      resume();
    } catch { /* A feature preflight must never block the main site's bootstrap. */ }
    finally { clearTimeout(timer); }
  }
  global.addEventListener('duediligence:session', () => { resume(); refresh(); });
  global.setTimeout(refresh, 500);
})(window);
