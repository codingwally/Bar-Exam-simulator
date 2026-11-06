import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const QR_VERSION = '84959f96cfa8cbe9';
export const QR_PATH = '/assets/payments/bpi-instapay-199-qr.png';

export function patchImageSource(source) {
  const before = 'src="${escapeHtml(qrUrl)}"';
  const after = 'src="${escapeHtml(qrUrl === \'/assets/payments/bpi-instapay-199-qr.png\' ? qrUrl + \'?payment-qr=84959f96cfa8cbe9\' : qrUrl)}"';
  assert.equal(source.split(before).length, 2, 'Expected exactly one checkout QR image');
  return source.replace(before, after);
}

export function patchIndex(source) {
  const pricing = 'assets/pricing-renderer.js?v=regular-checkout-r2"';
  assert.equal(source.split(pricing).length, 2, 'Expected one regular pricing renderer script URL');
  let result = source.replace(pricing, 'assets/pricing-renderer.js?v=regular-checkout-r2&amp;payment-qr=' + QR_VERSION + '"');
  const re = /(<script src="assets\/phase2-experience\.js\?[^\"]+)("\s*><\/script>)/gu;
  const matches = [...result.matchAll(re)];
  assert.equal(matches.length, 1, 'Expected one checkout experience script URL');
  result = result.replace(matches[0][0], matches[0][1] + '&amp;payment-qr=' + QR_VERSION + matches[0][2]);
  return result;
}

export async function patchRelease(root) {
  assert.ok(root && !root.includes('..'), 'An explicit release-directory root is required');
  const changes = [
    ['index.html', patchIndex],
    ['assets/pricing-renderer.js', patchImageSource],
    ['assets/phase2-experience.js', patchImageSource],
  ];
  for (const [file, patch] of changes) {
    const target = resolve(root, file);
    const before = await readFile(target, 'utf8');
    const after = patch(before);
    assert.notEqual(after, before, 'The checkout cache-busting patch must change ' + file);
    await writeFile(target, after, 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await patchRelease(process.argv[2]);
}
