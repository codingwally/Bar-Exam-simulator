import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = (...parts) => path.join(root, 'assets', 'brand', ...parts);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function assertPng(name, width, height) {
  const bytes = await readFile(brand(name));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} must be a PNG`);
  assert.equal(bytes.readUInt32BE(16), width, `${name} width`);
  assert.equal(bytes.readUInt32BE(20), height, `${name} height`);
}

const master = await readFile(brand('logo1-master.png'));
assert.equal(
  sha256(master),
  '6D284C91CE34D208252F5311A4CD3397FC00251E6968BFA620182138A1206CF5',
  'The approved official logo master must remain byte-for-byte unchanged.',
);
assert.equal(master.readUInt32BE(16), 1024);
assert.equal(master.readUInt32BE(20), 1536);

await Promise.all([
  assertPng('favicon-16.png', 16, 16),
  assertPng('favicon-32.png', 32, 32),
  assertPng('favicon-48.png', 48, 48),
  assertPng('apple-touch-icon.png', 180, 180),
  assertPng('icon-192.png', 192, 192),
  assertPng('icon-512.png', 512, 512),
  assertPng('social-card-1200x630.png', 1200, 630),
]);

const ico = await readFile(brand('favicon.ico'));
assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved field');
assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
assert.ok(ico.readUInt16LE(4) >= 1, 'ICO must contain an image');

const index = await readFile(path.join(root, 'index.html'), 'utf8');
const admin = await readFile(path.join(root, 'admin', 'index.html'), 'utf8');
assert.match(index, /<img class="[^"]*\bpb-crest\b[^"]*" src="assets\/brand\/icon-192\.png"/);
assert.match(index, /<img class="[^"]*\bcrest\b[^"]*" src="assets\/brand\/icon-192\.png"/);
assert.match(admin, /<img src="\.\.\/assets\/brand\/icon-192\.png"/);
assert.doesNotMatch(index, /<svg class="(?:pb-crest|crest)"/);
assert.doesNotMatch(admin, /<svg[^>]*>\s*<path d="M24 7v29/);

console.log('Official logo, favicon, social-card, and active-branding tests passed.');
