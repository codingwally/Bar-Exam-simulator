import assert from 'node:assert/strict';

const siteOrigin = 'https://duediligence.ph';
const apiOrigin = 'https://api.duediligence.ph';
const oldPublicHostFragment = 'duediligence-gemini-examiner';

const forbiddenPublicSignatures = Object.freeze([
  /\bgemini\b/i,
  /\bgemini[-_.\s]*\d/i,
  /duediligence-gemini-examiner/i,
  /generativelanguage\.googleapis\.com/i,
  /@google\/generative-ai/i,
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bclaude(?:[-_.\s]*\d)?\b/i,
  /\bgpt(?:[-_.\s]*\d)/i,
  /\bdeepseek\b/i,
  /\bmistral\b/i,
  /\bllama(?:[-_.\s]*\d)/i,
  /\bgrok\b/i,
  /\b\d+(?:\.\d+)*[-_.\s]*flash(?:[-_.\s]*lite)?\b/i,
]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchText(url, { attempts = 24, require = null } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': 'Due-Diligence-AI-Model-Branding-Audit/1.0',
        },
      });
      const text = await response.text();
      if (response.status >= 500) {
        throw new Error(`${url} returned HTTP ${response.status}`);
      }
      if (require && !require.test(text)) {
        throw new Error(`${url} has not published the expected release marker yet`);
      }
      return { url: response.url, status: response.status, text, headers: response.headers };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(5_000);
    }
  }
  throw lastError;
}

function assertProviderNeutral(label, entries) {
  const violations = [];
  for (const [url, text] of entries) {
    for (const pattern of forbiddenPublicSignatures) {
      if (pattern.test(text)) violations.push(`${url}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], `${label} disclosed named AI providers or models:\n${violations.join('\n')}`);
}

const landing = await fetchText(`${siteOrigin}/?branding_audit=${Date.now()}`, {
  require: /https:\/\/api\.duediligence\.ph/,
});
assertProviderNeutral('Pass 1/5 — live landing page', [[landing.url, landing.text]]);
assert.doesNotMatch(landing.text, new RegExp(oldPublicHostFragment, 'i'));
console.log('PASS 1/5: live landing-page HTML is provider-neutral.');

const discovered = new Set([
  '/assets/phase2-config.js',
  '/assets/phase2-experience.js',
  '/assets/examinations.js',
  '/assets/duediligence-2026.js',
  '/assets/study-workspace.js',
  '/assets/private-beta-landing.js',
  '/assets/private-workspace.js',
  '/assets/feature-loader.js',
  '/service-worker.js',
]);
for (const match of landing.text.matchAll(/(?:src|href)=["']([^"'#?]+(?:\.js|\.css|\.svg|\.txt|\.xml|\.webmanifest))["']/gi)) {
  const candidate = new URL(match[1], siteOrigin);
  if (candidate.origin === siteOrigin) discovered.add(`${candidate.pathname}${candidate.search}`);
}
const applicationAssets = [];
for (const relative of [...discovered].sort()) {
  const response = await fetchText(new URL(relative, siteOrigin));
  applicationAssets.push([response.url, response.text]);
}
assertProviderNeutral('Pass 2/5 — live application assets', applicationAssets);
console.log(`PASS 2/5: scanned ${applicationAssets.length} live application assets.`);

const pageUrls = [
  `${siteOrigin}/admin/`,
  `${siteOrigin}/offline.html`,
  `${siteOrigin}/robots.txt`,
  `${siteOrigin}/sitemap.xml`,
  `${siteOrigin}/manifest.webmanifest`,
  `${siteOrigin}/?view=terms`,
  `${siteOrigin}/?view=privacy`,
  `${siteOrigin}/?view=support`,
];
const pageEntries = [];
for (const url of pageUrls) {
  const response = await fetchText(url);
  pageEntries.push([response.url, response.text]);
}
assertProviderNeutral('Pass 3/5 — live secondary pages and metadata', pageEntries);
console.log(`PASS 3/5: scanned ${pageEntries.length} live secondary pages and metadata resources.`);

const api = await fetchText(`${apiOrigin}/?branding_audit=${Date.now()}`);
assert.equal(new URL(api.url).hostname, 'api.duediligence.ph');
assert.doesNotMatch(`${api.url}\n${api.text}`, /workers\.dev|duediligence-gemini-examiner/i);
assertProviderNeutral('Pass 4/5 — live AI API endpoint', [[api.url, api.text]]);
console.log(`PASS 4/5: neutral AI API endpoint responded with HTTP ${api.status}.`);

const allLiveEntries = [[landing.url, landing.text], ...applicationAssets, ...pageEntries, [api.url, api.text]];
assertProviderNeutral('Pass 5/5 — aggregate live-site scan', allLiveEntries);
assert.ok(allLiveEntries.some(([, text]) => /AI model/i.test(text)), 'The generic AI model wording was not found.');
console.log(`PASS 5/5: aggregate live scan passed across ${allLiveEntries.length} fetched resources.`);
console.log('Five-pass live AI model branding audit passed.');
