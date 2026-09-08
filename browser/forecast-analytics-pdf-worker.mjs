import { createForecastAnalyticsPdf } from '../worker/forecast-analytics-pdf.mjs';
import { FORECAST_ANALYTICS_VERSION, forecastAnalyticsFileName } from '../worker/forecast-analytics-core.mjs';

// One disposable, network-free worker per explicit period download. Its serial
// protocol bounds retained answers to one member and never returns partial PDF.
let document = null; let identity = null; let busy = false; let completed = 0; let closed = false;
const allowedErrors = new Set(['BAR_FORECAST_EXPORT_NOT_READY', 'BAR_FORECAST_EXPORT_INVALID',
  'BAR_FORECAST_PDF_CHARACTER_UNAVAILABLE', 'BAR_FORECAST_PDF_SIZE_LIMIT',
  'BAR_FORECAST_ANALYTICS_INVALID', 'BAR_FORECAST_ANALYTICS_SIZE_LIMIT']);
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function fail(error) {
  if (closed) return;
  closed = true;
  self.postMessage({ type: 'error', requestId: 1,
    code: allowedErrors.has(error?.code) ? error.code : 'BAR_FORECAST_PDF_RENDER_FAILED' });
  document = null; identity = null; self.close();
}
self.onmessage = async ({ data }) => {
  if (closed) return;
  try {
    if (busy || !data || data.requestId !== 1) throw new Error('INVALID_SCOPE_SEQUENCE');
    busy = true;
    if (data.type === 'start') {
      if (document || identity || !exact(data, ['type', 'requestId', 'ownerId', 'scope'])
          || typeof data.ownerId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(data.ownerId)) throw new Error('INVALID_SCOPE_START');
      identity = { ownerId: data.ownerId, scopeId: data.scope?.id, scopeHash: data.scope?.scopeHash,
        totalAttempts: data.scope?.manifest?.length };
      document = await createForecastAnalyticsPdf({ scope: data.scope, ownerId: data.ownerId });
      if (closed) return;
      self.postMessage({ type: 'ready', requestId: 1, scopeId: identity.scopeId, scopeHash: identity.scopeHash,
        totalAttempts: identity.totalAttempts, pdfVersion: FORECAST_ANALYTICS_VERSION });
    } else if (data.type === 'append') {
      if (!document || !exact(data, ['type', 'requestId', 'index', 'attempt']) || data.index !== completed) throw new Error('INVALID_SCOPE_MEMBER');
      const progress = await document.append(data.attempt);
      if (closed) return;
      completed++;
      self.postMessage({ type: 'progress', requestId: 1, scopeId: identity.scopeId, scopeHash: identity.scopeHash,
        ...progress });
    } else if (data.type === 'finish') {
      if (!document || !exact(data, ['type', 'requestId']) || completed !== identity.totalAttempts) throw new Error('INCOMPLETE_SCOPE');
      const bytes = await document.finish();
      if (closed) return;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      self.postMessage({ type: 'result', requestId: 1, scopeId: identity.scopeId, scopeHash: identity.scopeHash,
        completedAttempts: completed, pdfVersion: FORECAST_ANALYTICS_VERSION,
        fileName: forecastAnalyticsFileName(identity.scopeId), bytes: buffer }, [buffer]);
      closed = true; document = null; identity = null; self.close();
    } else throw new Error('INVALID_SCOPE_OPERATION');
  } catch (error) { fail(error); }
  finally { busy = false; }
};
