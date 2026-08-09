import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildImportRows,
  contentChecksum,
  stableJson,
  transformContentRow,
} from './import-duediligence-2026-content.mjs';

test('prepared 2026 content builds an exact idempotent 240-row manifest', async () => {
  const manifest = await buildImportRows();
  assert.equal(manifest.total, 240);
  assert.deepEqual(manifest.counts, {
    bar_easy: 50,
    doctrine: 100,
    chair_case: 30,
    anchor_case: 60,
  });
  assert.equal(new Set(manifest.rows.map((row) => row.id)).size, 240);
  assert.ok(manifest.rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum)));
});

test('checksum is stable across object key order', () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(contentChecksum({ b: 2, a: 1 }), contentChecksum({ a: 1, b: 2 }));
});

test('transform rejects unpublished or wrong-version data', () => {
  const collection = { file: 'test.json', contentType: 'bar_easy', title: (row) => row.title };
  const base = {
    id: 'EASY-TEST-001', subject: 'Labor Law', title: 'Test item',
    version: '2026.1', status: 'AI_PREPARED_BETA',
  };
  assert.equal(transformContentRow(base, collection).id, 'easy-test-001');
  assert.throws(() => transformContentRow({ ...base, status: 'DRAFT' }, collection), /not approved/);
  assert.throws(() => transformContentRow({ ...base, version: '2026.2' }, collection), /not approved/);
});
