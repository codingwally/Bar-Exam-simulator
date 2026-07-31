import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = await readFile(path.join(root, 'index.html'), 'utf8');
const admin = await readFile(path.join(root, 'admin/index.html'), 'utf8');
const build = await readFile(path.join(root, 'scripts/build-pages-artifact.mjs'), 'utf8');
const favicon = await readFile(path.join(root, 'favicon.svg'), 'utf8');
const robots = await readFile(path.join(root, 'robots.txt'), 'utf8');
const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');

assert.match(index, /<html lang="en-PH">/);
assert.match(
  index,
  /<title>Due Diligence — Philippine Law School &amp; Bar Review<\/title>/,
);
assert.match(
  index,
  /<meta name="description" content="Study Philippine law and prepare for the Bar with source-based essay practice, ALAC feedback, Subject Matter examinations, Mock Bar sessions, and a law-school community\.">/,
);
assert.match(index, /<link rel="canonical" href="https:\/\/duediligence\.ph\/">/);
assert.match(index, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
assert.match(index, /<meta property="og:title" content="Due Diligence — Philippine Law School &amp; Bar Review">/);
assert.match(index, /<meta property="og:url" content="https:\/\/duediligence\.ph\/">/);
assert.match(index, /<meta property="og:locale" content="en_PH">/);
assert.match(index, /<meta property="og:image" content="https:\/\/duediligence\.ph\/favicon\.svg">/);
assert.match(index, /<meta name="twitter:card" content="summary">/);
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
  /<div class="brand-sub" id="brand-subtitle">Amicus in Itinere Iuris<\/div>/,
);
assert.match(
  index,
  /<span class="brand-meaning" id="brand-subtitle-meaning" role="tooltip">A friend on the journey of law\.<\/span>/,
);
assert.match(
  index,
  /<a class="brand" href="\/" aria-label="Due Diligence home" aria-describedby="brand-subtitle-meaning">/,
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
  /id="spa-partner"[\s\S]*?data-dd2-view="partnership">Quid Pro Quo<\/button>/,
);
assert.match(
  index,
  /<a href="#partnership" data-dd2-view="partnership">Partnerships<\/a>/,
);

assert.match(build, /'robots\.txt'/);
assert.match(build, /'sitemap\.xml'/);
assert.match(admin, /<meta name="robots" content="noindex,nofollow">/);
assert.match(favicon, /<svg\b/);
assert.match(robots, /^User-agent: \*\r?\nAllow: \/\r?\nDisallow: \/admin\//);
assert.match(robots, /Sitemap: https:\/\/duediligence\.ph\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/duediligence\.ph\/<\/loc>/);
assert.doesNotMatch(sitemap, /\/admin\//);

console.log('Beta-readiness copy, accessibility, and SEO contract tests passed.');
