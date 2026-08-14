import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = await readFile(path.join(root, 'index.html'), 'utf8');
const admin = await readFile(path.join(root, 'admin/index.html'), 'utf8');
const build = await readFile(path.join(root, 'scripts/build-pages-artifact.mjs'), 'utf8');
const favicon = await readFile(path.join(root, 'favicon.svg'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
const robots = await readFile(path.join(root, 'robots.txt'), 'utf8');
const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');

assert.match(index, /<html lang="en-PH">/);
assert.match(
  index,
  /<title>Due Diligence — A Friend on Your Journey Through the Study of Law<\/title>/,
);
assert.match(
  index,
  /<meta name="description" content="A Philippine legal-education platform for Bar-style essay practice, course-based study, academic community, and controlled examinations\.">/,
);
assert.match(index, /<link rel="canonical" href="https:\/\/duediligence\.ph\/">/);
assert.match(index, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
assert.match(index, /<meta property="og:title" content="Due Diligence — A Friend on Your Journey Through the Study of Law">/);
assert.match(index, /<meta property="og:url" content="https:\/\/duediligence\.ph\/">/);
assert.match(index, /<meta property="og:locale" content="en_PH">/);
assert.match(index, /<meta property="og:image" content="https:\/\/duediligence\.ph\/assets\/brand\/social-card-1200x630\.png">/);
assert.match(index, /<meta name="twitter:card" content="summary_large_image">/);
assert.match(index, /<link rel="manifest" href="manifest\.webmanifest">/);
assert.match(index, /assets\/brand\/favicon-32\.png/);
assert.match(index, /<script type="application\/ld\+json">[\s\S]*"@type": "EducationalApplication"/);
assert.match(index, /"audienceType": "Philippine law students and Bar candidates"/);
const schemaSource = index.match(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
)?.[1];
assert.ok(schemaSource, 'EducationalApplication structured data must be present.');
assert.doesNotThrow(() => JSON.parse(schemaSource), 'Structured data must be valid JSON.');

assert.doesNotMatch(index, /PH Bar Essay Trainer/);
assert.doesNotMatch(index, /Advanced Pro Repository/);
assert.doesNotMatch(index, /PH Bar Exam Simulator/);

assert.match(
  index,
  /<span class="brand-sub pb-brand-sub" id="brand-subtitle">Amicus in Itinere Iuris<\/span>/,
);
assert.match(
  index,
  /<span class="brand-meaning" id="brand-subtitle-meaning" role="tooltip">A friend on the journey of law\.<\/span>/,
);
assert.match(
  index,
  /<a class="brand pb-brand" href="\/" data-public-home aria-label="Due Diligence homepage" aria-describedby="brand-subtitle-meaning">/,
);
assert.match(index, /\.brand:hover:not\(\[data-meaning-dismissed="true"\]\) \.brand-meaning/);
assert.match(index, /\.brand:focus-visible:not\(\[data-meaning-dismissed="true"\]\) \.brand-meaning/);
assert.match(index, /\.brand\[data-meaning-open="true"\] \.brand-meaning/);
assert.match(index, /function setupBrandMeaningTooltip\(\)/);
assert.match(index, /data-meaning-dismissed/);
assert.match(index, /brand\.addEventListener\('pointerleave'/);
assert.match(index, /brand\.addEventListener\('focusout'/);
assert.match(index, /document\.addEventListener\('visibilitychange'/);
assert.match(index, /window\.addEventListener\('blur'/);

assert.doesNotMatch(
  index,
  /<h3>What do you want to ask or share about law school\?<\/h3>/,
);
assert.match(index, /<label class="sr-only" for="lex-post-body">Share with Quorum<\/label>/);
assert.match(index, /placeholder="What do you want to ask or share about law school\?"/);

assert.match(
  index,
  /<a href="#partnership" data-dd2-view="partnership"[^>]*>Quid Pro Quo<\/a>/,
);
assert.doesNotMatch(index, /id="spa-partner"/);

assert.match(build, /'robots\.txt'/);
assert.match(build, /'sitemap\.xml'/);
assert.match(admin, /<meta name="robots" content="noindex,nofollow">/);
assert.match(favicon, /<svg\b/);
assert.deepEqual(manifest.icons.map(({ src, sizes }) => [src, sizes]), [
  ['assets/brand/icon-192.png', '192x192'],
  ['assets/brand/icon-512.png', '512x512'],
]);
assert.match(robots, /^User-agent: \*\r?\nAllow: \/\r?\nDisallow: \/admin\//);
assert.match(robots, /Sitemap: https:\/\/duediligence\.ph\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/duediligence\.ph\/<\/loc>/);
assert.doesNotMatch(sitemap, /\/admin\//);

console.log('Beta-readiness copy, accessibility, and SEO contract tests passed.');
