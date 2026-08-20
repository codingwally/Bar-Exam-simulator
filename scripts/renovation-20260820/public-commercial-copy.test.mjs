import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const publicRuntimeFiles = Object.freeze([
  'assets/phase2-config.js',
  'assets/phase2-experience.js',
  'assets/phase4-experience.js',
  'assets/free-trial-five-daily.js',
  'assets/private-beta-landing.js',
  'assets/private-beta-session.js',
]);

function quotedSegments(line) {
  const segments = [];
  let index = 0;
  while (index < line.length) {
    const quote = line[index];
    if (!['\'', '"', '`'].includes(quote)) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let value = '';
    let closed = false;
    while (cursor < line.length) {
      if (line[cursor] === '\\') {
        value += line[cursor];
        if (cursor + 1 < line.length) {
          value += line[cursor + 1];
          cursor += 2;
          continue;
        }
      }
      if (line[cursor] === quote) {
        closed = true;
        cursor += 1;
        break;
      }
      value += line[cursor];
      cursor += 1;
    }
    if (closed) segments.push(value);
    index = closed ? cursor : index + 1;
  }
  return segments;
}

function publicCopyCandidates(source) {
  const candidates = [];
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const value of quotedSegments(line)) {
      candidates.push({ line: index + 1, value });
    }

    // Public legal/admission templates span lines. Inspect only rendered text,
    // never tag names or attributes such as legacy CSS classes and DOM IDs.
    if (/<\/?[A-Za-z][^>]*>/.test(line)) {
      const visible = line.replace(/<[^>]*>/g, ' ');
      if (visible.trim()) candidates.push({ line: index + 1, value: visible });
    }
  }
  return candidates;
}

function decodeVisibleText(value) {
  return value
    .replace(/\$\{[\s\S]*?\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|#39|#x27);/gi, ' ')
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\(['"`\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isInternalCompatibilityToken(rawValue, visibleText) {
  const raw = rawValue.trim();
  const token = visibleText.trim();
  if (!raw || !token || /\s/.test(token) || /<[^>]+>/.test(raw)) return false;
  if (/^(?:premium|standard|beta|retainer)$/i.test(token)) {
    return token === token.toLowerCase();
  }
  return token.startsWith('/')
    || token.startsWith('#')
    || token.startsWith('.')
    || token.includes('://')
    || token.includes('@')
    || /(?:^|[._:/-])(?:premium|standard|beta|retainer)(?:[._:/-]|$)/i.test(token);
}

function legacyCommercialLabel(visibleText) {
  if (/\b(?:premium|beta|retainer)\b/i.test(visibleText)) return true;
  if (!/\bstandard\b/i.test(visibleText)) return false;
  return /^standard$/i.test(visibleText)
    || /\b(?:plan|pricing|price|access|account|subscription|tier|free|trial|early|paid|payment)\b|₱/i
      .test(visibleText);
}

function concise(value) {
  return value.length > 150 ? `${value.slice(0, 147)}...` : value;
}

test('internal compatibility identifiers remain outside the public-copy rule', () => {
  for (const token of [
    'beta',
    'premium',
    'standard',
    'retainer',
    'phase4-beta-2026-07-28',
    '/beta/access/policy',
    'duediligence:private-beta-access',
    'mailto:premium@duediligence.ph',
  ]) {
    assert.equal(
      isInternalCompatibilityToken(token, decodeVisibleText(token)),
      true,
      `${token} must remain available as an internal compatibility token`,
    );
  }
  for (const copy of ['Premium', 'Standard plan', 'Founding Beta access']) {
    assert.equal(
      isInternalCompatibilityToken(copy, decodeVisibleText(copy)),
      false,
      `${copy} is user-facing copy, not an internal compatibility token`,
    );
  }
});

test('initial public HTML contains no legacy Premium, Standard, Beta, or Retainer plan copy', () => {
  const visibleNodes = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .split(/<[^>]*>/g)
    .map(decodeVisibleText)
    .filter(Boolean);
  const violations = visibleNodes.filter(legacyCommercialLabel).map(concise);

  assert.equal(
    violations.length,
    0,
    `public HTML exposes retired commercial labels:\n${violations.join('\n')}`,
  );
});

test('public access, pricing, legal, and admission runtime copy uses only current plan language', () => {
  const violations = [];

  for (const file of publicRuntimeFiles) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    for (const literal of publicCopyCandidates(source)) {
      const visible = decodeVisibleText(literal.value);
      if (!visible || isInternalCompatibilityToken(literal.value, visible)) continue;
      if (legacyCommercialLabel(visible)) {
        violations.push(`${file}:${literal.line}: ${concise(visible)}`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    [
      'public runtime copy exposes retired Premium, Standard, Beta, or Retainer terminology.',
      'Internal route names, event names, version strings, and lowercase plan codes are intentionally allowed.',
      ...violations,
    ].join('\n'),
  );
});
