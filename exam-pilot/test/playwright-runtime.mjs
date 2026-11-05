import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function loadPlaywright() {
  if (process.env.DD_PLAYWRIGHT_MODULE) return require(process.env.DD_PLAYWRIGHT_MODULE);
  try { return require('playwright'); }
  catch (error) {
    throw new Error('Install Playwright in this checkout, or set DD_PLAYWRIGHT_MODULE to an available Playwright module directory.', { cause: error });
  }
}
