(function debateEntry(global) {
  'use strict';
  const returnKey = 'duediligence.debate.auth-return.v3';
  const callbackArrived = /(?:[?&]auth=callback|[?&]code=)/.test(global.location.search);
  let generation = 0;
  const session = () => global.DueDiligencePhase4?.getSession?.() || global.DueDiligencePhase2?.getSession?.() || null;
  const setVisible = visible => {
    global.document?.querySelectorAll?.('[data-debate-room-entry]').forEach(link => { link.hidden = !visible; });
  };
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
    if (!base) {
      // Navigation availability is not an authorization decision. The Debate
      // page and Worker remain authoritative if bootstrap configuration is late.
      setVisible(true);
      return;
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const token = session()?.access_token;
      const response = await fetch(`${base.replace(/\/$/, '')}/debate-room/access`, { cache: 'no-store', credentials: 'omit', headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (version !== generation) return;
      if (response.ok && result?.enabled === true) {
        setVisible(true);
      } else if (response.ok && result?.enabled === false) {
        // Only an explicit authoritative disabled response may remove the entry.
        setVisible(false);
      } else if (response.status === 404 || response.status === 410) {
        setVisible(false);
      } else {
        // Rate limits, 5xx responses, malformed transient responses and other
        // transport problems must not make an already-public feature disappear.
        setVisible(true);
      }
      resume();
    } catch {
      // A feature preflight must never block the main site's bootstrap or hide
      // a public navigation entry. Access is still enforced by the Debate page.
      if (version === generation) setVisible(true);
    }
    finally { clearTimeout(timer); }
  }
  // Debate Room is a public navigation destination. Do not render it hidden for
  // several seconds while a health/availability preflight is pending.
  setVisible(true);
  global.addEventListener('duediligence:session', () => { resume(); refresh(); });
  global.setTimeout(refresh, 500);
})(window);
