import { buildForecastResultPdf, forecastResultPdfFileName, FORECAST_PDF_VERSION } from '../worker/forecast-result-pdf.mjs';

// One disposable render worker per explicit download. No authentication token,
// network transport, persistent storage, telemetry, or model invocation here.
let started = false;
const allowedErrors = new Set(['BAR_FORECAST_EXPORT_NOT_READY', 'BAR_FORECAST_EXPORT_INVALID',
  'BAR_FORECAST_PDF_CHARACTER_UNAVAILABLE', 'BAR_FORECAST_PDF_SIZE_LIMIT']);
self.onmessage = async ({ data }) => {
  if (started) return;
  started = true;
  const requestId = data?.requestId;
  try {
    if (!data || Object.keys(data).sort().join(',') !== 'attempt,ownerId,requestId,type'
        || data.type !== 'render' || requestId !== 1 || typeof data.ownerId !== 'string'
        || !/^[a-f0-9-]{36}$/iu.test(data.ownerId)) throw new Error('INVALID_RENDER_REQUEST');
    const bytes = await buildForecastResultPdf({ attempt: data.attempt, ownerId: data.ownerId });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ type: 'result', requestId, attemptId: data.attempt.id,
      resultRevision: data.attempt.resultRevision, pdfVersion: FORECAST_PDF_VERSION,
      fileName: forecastResultPdfFileName(data.attempt), bytes: buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: requestId === 1 ? 1 : null,
      code: allowedErrors.has(error?.code) ? error.code : 'BAR_FORECAST_PDF_RENDER_FAILED' });
  } finally { self.close(); }
};
