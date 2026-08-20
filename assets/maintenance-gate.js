(function maintenancePasswordGate(global) {
  'use strict';

  const config = global.DueDiligencePhase2Config;
  const maintenance = config?.maintenance;
  if (
    !maintenance?.enabled
    || !config?.workerUrl
    || !global.document
    || !global.location
    || typeof global.fetch !== 'function'
    || global.__ddMaintenanceGateInstalled
  ) return;
  global.__ddMaintenanceGateInstalled = true;

  const document = global.document;
  const storage = (() => {
    try {
      return global.localStorage;
    } catch {
      return null;
    }
  })();

  function storedToken() {
    try {
      return storage?.getItem(maintenance.tokenStorageKey) || '';
    } catch {
      return '';
    }
  }

  function saveToken(token) {
    try {
      if (token) storage?.setItem(maintenance.tokenStorageKey, token);
      else storage?.removeItem(maintenance.tokenStorageKey);
    } catch {
      // Private browsing may deny persistence; the page remains safely locked.
    }
  }

  function injectStyles() {
    if (document.getElementById('dd-maintenance-style')) return;
    const style = document.createElement('style');
    style.id = 'dd-maintenance-style';
    style.textContent = `
      html[data-dd-maintenance="locked"] body {
        overflow: hidden !important;
        visibility: visible !important;
        background: #081225 !important;
      }
      html[data-dd-maintenance="locked"] body > *:not(#dd-maintenance-gate) {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      #dd-maintenance-gate {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        visibility: visible !important;
        pointer-events: auto !important;
        display: grid;
        place-items: center;
        padding: 24px;
        overflow: auto;
        color: #0f172a;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 50% 10%, rgba(197,160,89,.15), transparent 34%),
          linear-gradient(145deg, #002147 0%, #081225 58%, #0f172a 100%);
      }
      #dd-maintenance-gate * { box-sizing: border-box; }
      #dd-maintenance-gate .dd-maintenance-card {
        width: min(100%, 520px);
        padding: clamp(28px, 6vw, 48px);
        border: 1px solid rgba(197,160,89,.42);
        border-radius: 22px;
        background: rgba(250,249,246,.98);
        box-shadow: 0 28px 80px rgba(0,0,0,.38);
        text-align: center;
      }
      #dd-maintenance-gate .dd-maintenance-mark {
        width: 62px;
        height: 62px;
        margin: 0 auto 18px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(197,160,89,.65);
        border-radius: 50%;
        color: #c5a059;
        background: #002147;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 21px;
        font-weight: 700;
        letter-spacing: .08em;
      }
      #dd-maintenance-gate .dd-maintenance-kicker {
        margin: 0 0 8px;
        color: #8a6d24;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      #dd-maintenance-gate h1 {
        margin: 0;
        color: #002147;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(27px, 6vw, 40px);
        line-height: 1.14;
      }
      #dd-maintenance-gate .dd-maintenance-copy {
        margin: 18px auto 26px;
        color: #475569;
        line-height: 1.7;
      }
      #dd-maintenance-gate form { display: grid; gap: 12px; text-align: left; }
      #dd-maintenance-gate label {
        color: #1e293b;
        font-size: 13px;
        font-weight: 700;
      }
      #dd-maintenance-gate input {
        width: 100%;
        margin-top: 7px;
        padding: 14px 15px;
        border: 1px solid rgba(15,23,42,.18);
        border-radius: 11px;
        color: #0f172a;
        background: #fff;
        font: inherit;
        letter-spacing: .2em;
      }
      #dd-maintenance-gate input:focus {
        outline: none;
        border-color: #c5a059;
        box-shadow: 0 0 0 3px rgba(197,160,89,.2);
      }
      #dd-maintenance-gate button {
        width: 100%;
        padding: 14px 18px;
        border: 0;
        border-radius: 11px;
        color: #fff;
        background: #002147;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      #dd-maintenance-gate button:hover { background: #0b315d; }
      #dd-maintenance-gate button:disabled { cursor: wait; opacity: .68; }
      #dd-maintenance-status {
        min-height: 22px;
        margin: 2px 0 0;
        color: #7a1f2b;
        font-size: 13px;
        text-align: center;
      }
      #dd-maintenance-status[data-kind="checking"] { color: #475569; }
      #dd-maintenance-gate .dd-maintenance-note {
        margin: 18px 0 0;
        color: #64748b;
        font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  function gateMarkup() {
    return `
      <main id="dd-maintenance-gate" role="main" aria-labelledby="dd-maintenance-title">
        <section class="dd-maintenance-card">
          <div class="dd-maintenance-mark" aria-hidden="true">DD</div>
          <p class="dd-maintenance-kicker">Maintenance in progress</p>
          <h1 id="dd-maintenance-title">We are improving Due Diligence.</h1>
          <p class="dd-maintenance-copy">The platform is temporarily closed while we rebuild key parts of the experience. We will return as a better, stronger, and more reliable version.</p>
          <form id="dd-maintenance-form" novalidate>
            <label for="dd-maintenance-password">Maintenance password
              <input id="dd-maintenance-password" name="maintenance-password" type="password" inputmode="numeric" autocomplete="current-password" maxlength="32" required aria-describedby="dd-maintenance-status">
            </label>
            <button id="dd-maintenance-submit" type="submit">Enter website</button>
            <p id="dd-maintenance-status" role="status" aria-live="polite"></p>
          </form>
          <p class="dd-maintenance-note">Authorized testing access is remembered in this browser for seven days.</p>
        </section>
      </main>`;
  }

  function ensureGate() {
    injectStyles();
    document.documentElement.dataset.ddMaintenance = 'locked';
    let gate = document.getElementById('dd-maintenance-gate');
    if (!gate) {
      document.body.insertAdjacentHTML('beforeend', gateMarkup());
      gate = document.getElementById('dd-maintenance-gate');
      bindForm();
    }
    return gate;
  }

  function setStatus(message, kind = 'error') {
    const status = document.getElementById('dd-maintenance-status');
    if (!status) return;
    status.textContent = message || '';
    status.dataset.kind = kind;
  }

  function unlockPage() {
    document.documentElement.dataset.ddMaintenance = 'open';
    document.getElementById('dd-maintenance-gate')?.remove();
    global.dispatchEvent(new CustomEvent('duediligence:maintenance-unlocked'));
  }

  async function maintenanceRequest(path, body = {}, explicitToken = '') {
    const headers = { 'Content-Type': 'application/json' };
    if (explicitToken) headers[maintenance.headerName] = explicitToken;
    const response = await global.fetch(`${config.workerUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(
        payload?.error?.message || 'Maintenance access could not be verified.',
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function verifyExistingToken() {
    const token = storedToken();
    if (!token) return false;
    setStatus('Verifying saved maintenance access…', 'checking');
    try {
      await maintenanceRequest(maintenance.statusPath, {}, token);
      unlockPage();
      return true;
    } catch {
      saveToken('');
      setStatus('');
      return false;
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const input = document.getElementById('dd-maintenance-password');
    const button = document.getElementById('dd-maintenance-submit');
    const password = String(input?.value || '').trim();
    if (!password) {
      setStatus('Enter the maintenance password.');
      input?.focus();
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Checking password…';
    }
    setStatus('Verifying maintenance access…', 'checking');
    try {
      const payload = await maintenanceRequest(maintenance.unlockPath, { password });
      saveToken(payload.token);
      await maintenanceRequest(maintenance.statusPath, {}, payload.token);
      setStatus('Access granted. Opening Due Diligence…', 'checking');
      unlockPage();
    } catch (error) {
      setStatus(error.message || 'The password is incorrect.');
      if (input) {
        input.value = '';
        input.focus();
      }
      if (button) {
        button.disabled = false;
        button.textContent = 'Enter website';
      }
    }
  }

  function bindForm() {
    document.getElementById('dd-maintenance-form')
      ?.addEventListener('submit', submitPassword);
  }

  async function start() {
    ensureGate();
    const unlocked = await verifyExistingToken();
    if (!unlocked) {
      document.getElementById('dd-maintenance-password')?.focus({ preventScroll: true });
    }
  }

  global.DueDiligenceMaintenance = Object.freeze({
    isEnabled: true,
    clearAccess() {
      saveToken('');
      global.location.reload();
    },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
