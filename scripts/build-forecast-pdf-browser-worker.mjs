import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromWorker = createRequire(path.join(root, 'worker/package.json'));

// The same build function is used by Pages/staging packaging and byte-parity
// tests. Returning bytes keeps the caller's output directory explicit.
export async function buildForecastPdfBrowserWorker() {
  const { build } = fromWorker('esbuild');
  const result = await build({ entryPoints: [path.join(root, 'browser/forecast-result-pdf-worker.mjs')],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
    minify: true, sourcemap: false, legalComments: 'inline', metafile: true });
  const code = result.outputFiles[0].contents;
  const text = new TextDecoder().decode(code);
  // The renderer must not bring server provider/configuration or private source
  // questions into the browser bundle through its shared imports.
  if (/gemini|generativelanguage|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|buildBarForecastGradingPrompt|content\/question-bank/iu.test(text)) {
    throw new Error('The PDF browser bundle contains a server-only dependency.');
  }
  return { code, inputs: Object.keys(result.metafile.inputs) };
}
