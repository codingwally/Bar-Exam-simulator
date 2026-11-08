// Diagnostic instrumentation only. Never imported by the application.
export function instrumentStartup() {
  const log = name => console.info(`[exam-start] ${name}`);
  log('init');
  for (const name of ['localStorage', 'sessionStorage']) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor.configurable) Object.defineProperty(window, name, { ...descriptor, get() { log(`${name}.getter.before`); const result = descriptor.get.call(window); log(`${name}.getter.after`); return result; } });
  }
  for (const name of ['getItem', 'setItem', 'removeItem']) {
    const original = Storage.prototype[name];
    Storage.prototype[name] = function (...args) { log(`Storage.${name}.before`); const result = original.apply(this, args); log(`Storage.${name}.after`); return result; };
  }
  const random = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = function (...args) { log('crypto.randomUUID.before'); const result = random(...args); log('crypto.randomUUID.after'); return result; };
  const fetcher = window.fetch.bind(window);
  window.fetch = function (...args) {
    const path = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.origin).pathname;
    log(`fetch.before ${path}`); const result = fetcher(...args); log(`fetch.dispatched ${path}`);
    result.then(response => log(`fetch.response ${path} ${response.status}`), () => log(`fetch.rejected ${path}`)); return result;
  };
  if (navigator.serviceWorker) {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (...args) { log('serviceWorker.register.before'); const result = register(...args); log('serviceWorker.register.dispatched'); result.then(() => log('serviceWorker.register.resolved'), () => log('serviceWorker.register.rejected')); return result; };
  }
  document.addEventListener('DOMContentLoaded', () => log('DOMContentLoaded'));
  window.addEventListener('beforeunload', () => log('beforeunload'));
  window.addEventListener('pagehide', () => log('pagehide'));
}
