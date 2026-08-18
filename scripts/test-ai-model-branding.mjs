import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesRoot = path.join(root, '.pages-dist');

execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: root,
  stdio: 'pipe',
});

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

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

function assertProviderNeutral(label, entries) {
  const violations = [];
  for (const [relativePath, text] of entries) {
    for (const pattern of forbiddenPublicSignatures) {
      if (pattern.test(text)) {
        violations.push(`${relativePath}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, [], `${label} disclosed named AI providers or models:\n${violations.join('\n')}`);
}

const files = await walk(pagesRoot);
const textFiles = files.filter((file) => /\.(?:html?|js|css|svg|txt|xml|webmanifest)$/i.test(file));
const entries = await Promise.all(textFiles.map(async (file) => [
  file,
  await readFile(path.join(pagesRoot, file), 'utf8'),
]));

const htmlEntries = entries.filter(([file]) => /\.html?$/i.test(file));
assert.ok(htmlEntries.length >= 3, 'The public HTML page inventory must include the landing, admin, and offline pages.');
assertProviderNeutral('Pass 1/5 — every public HTML page', htmlEntries);
console.log(`PASS 1/5: scanned ${htmlEntries.length} public HTML pages.`);

const javascriptEntries = entries.filter(([file]) => /\.js$/i.test(file));
assert.ok(javascriptEntries.length >= 10, 'The public JavaScript inventory is unexpectedly incomplete.');
assertProviderNeutral('Pass 2/5 — every public JavaScript and configuration asset', javascriptEntries);
console.log(`PASS 2/5: scanned ${javascriptEntries.length} public JavaScript/configuration assets.`);

const supportingEntries = entries.filter(([file]) => /\.(?:css|svg|txt|xml|webmanifest)$/i.test(file));
assertProviderNeutral('Pass 3/5 — every public style and metadata asset', supportingEntries);
console.log(`PASS 3/5: scanned ${supportingEntries.length} public style and metadata assets.`);

const index = await readFile(path.join(pagesRoot, 'index.html'), 'utf8');
const config = await readFile(path.join(pagesRoot, 'assets/phase2-config.js'), 'utf8');
const worker = await readFile(path.join(root, 'worker/index.mjs'), 'utf8');
const wrangler = await readFile(path.join(root, 'worker/wrangler.toml'), 'utf8');
assert.match(index, /https:\/\/api\.duediligence\.ph/);
assert.match(config, /workerUrl:\s*'https:\/\/api\.duediligence\.ph'/);
assert.doesNotMatch(`${index}\n${config}`, /workers\.dev|duediligence-gemini-examiner/i);
assert.match(worker, /modelUsed:\s*'AI model'/);
assert.doesNotMatch(worker, /modelUsed:\s*[A-Za-z_$][\w$]*\.model/);
assert.match(wrangler, /workers_dev\s*=\s*false/);
assert.match(wrangler, /pattern\s*=\s*"api\.duediligence\.ph"[\s\S]*custom_domain\s*=\s*true/);
console.log('PASS 4/5: verified the neutral endpoint and generic public API model metadata.');

assertProviderNeutral('Pass 5/5 — complete built Pages artifact', entries);
const combined = entries.map(([file, text]) => `\n--- ${file} ---\n${text}`).join('');
assert.doesNotMatch(combined, /workers\.dev/i);
assert.match(combined, /AI model/i);
console.log(`PASS 5/5: aggregate scan passed across all ${textFiles.length} public text assets.`);
console.log('Five-pass AI model branding audit passed.');
