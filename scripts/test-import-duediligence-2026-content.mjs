import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildImportRows,
  contentChecksum,
  stableJson,
  transformContentRow,
} from './import-duediligence-2026-content.mjs';

test('prepared 2026 content builds an exact idempotent 360-row manifest', async () => {
  const manifest = await buildImportRows();
  assert.equal(manifest.total, 360);
  assert.deepEqual(manifest.counts, {
    bar_easy: 50,
    doctrine: 100,
    chair_case: 30,
    anchor_case: 60,
    bar_forecast_question: 120,
  });
  assert.equal(new Set(manifest.rows.map((row) => row.id)).size, 360);
  assert.ok(manifest.rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum)));
  assert.ok(manifest.rows
    .filter((row) => row.content_type === 'bar_forecast_question')
    .every((row) => row.source_version === '2026.3'));
});

test('checksum is stable across object key order', () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(contentChecksum({ b: 2, a: 1 }), contentChecksum({ a: 1, b: 2 }));
});

test('transform rejects unpublished or wrong-version data', () => {
  const collection = {
    file: 'test.json', contentType: 'bar_easy', sourceVersion: '2026.1', title: (row) => row.title,
  };
  const base = {
    id: 'EASY-TEST-001', subject: 'Labor Law', title: 'Test item',
    version: '2026.1', status: 'AI_PREPARED_BETA',
  };
  assert.equal(transformContentRow(base, collection).id, 'easy-test-001');
  assert.throws(() => transformContentRow({ ...base, status: 'DRAFT' }, collection), /not approved/);
  assert.throws(() => transformContentRow({ ...base, version: '2026.2' }, collection), /not approved/);
});

test('transform accepts only the approved Forecast source version', () => {
  const collection = {
    file: 'bar-forecast.json',
    contentType: 'bar_forecast_question',
    sourceVersion: '2026.3',
    title: (row) => row.title,
  };
  const base = {
    id: 'BP26-TEST-001', subject: 'Civil Law', title: 'Test forecast item',
    version: '2026.3', status: 'AI_PREPARED_BETA',
  };
  const transformed = transformContentRow(base, collection);
  assert.equal(transformed.source_version, '2026.3');
  assert.equal(transformed.content_type, 'bar_forecast_question');
  assert.throws(() => transformContentRow({ ...base, version: '2026.1' }, collection), /not approved/);
});
