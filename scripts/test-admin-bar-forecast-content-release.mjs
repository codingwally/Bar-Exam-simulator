import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildImportRows } from './import-duediligence-2026-content.mjs';
import {
  buildForecastContentManifest,
  verifyForecastContent,
} from './verify-admin-bar-forecast-content.mjs';
import {
  BAR_FORECAST_APPROVED_SET_IDS,
  BAR_FORECAST_SUBJECTS,
  forecastSetId,
  validatedForecastRows,
} from '../worker/bar-forecast-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await buildForecastContentManifest();
assert.equal(manifest.count, 120);
assert.equal(manifest.entries.length, 120);
assert.match(manifest.sha256, /^sha256:[0-9a-f]{64}$/u);
assert.equal(manifest.sourceVersion, '2026.3');
assert.equal(manifest.sourceStatus, 'AI_PREPARED_BETA');
assert.equal(new Set(manifest.entries.map(({ id }) => id)).size, 120);
const scopedDryRun = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'scripts', 'import-duediligence-2026-content.mjs'),
  '--content-type', 'bar_forecast_question',
], { cwd: root, encoding: 'utf8' }));
assert.equal(scopedDryRun.contentType, 'bar_forecast_question');
assert.equal(scopedDryRun.total, 120);
assert.deepEqual(scopedDryRun.counts, { bar_forecast_question: 120 });

const imported = await buildImportRows();
const forecastRows = imported.rows.filter((row) => row.content_type === 'bar_forecast_question');
for (const subject of BAR_FORECAST_SUBJECTS) {
  const envelopes = forecastRows
    .filter((row) => row.subject === subject)
    .map((row) => ({
      id: row.id,
      contentType: row.content_type,
      subject: row.subject,
      title: row.title,
      version: row.source_version,
      checksum: row.checksum,
      payload: row.payload,
    }));
  const actualSetId = await forecastSetId(validatedForecastRows(envelopes, subject));
  assert.equal(
    BAR_FORECAST_APPROVED_SET_IDS[subject],
    actualSetId,
    `${subject} must match the independently pinned Worker question-set manifest`,
  );
}
const versionIdByContentId = new Map(forecastRows.map((row, index) => [
  row.id,
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
]));
const versions = forecastRows.map((row) => ({
  id: versionIdByContentId.get(row.id),
  content_id: row.id,
  checksum: row.checksum,
  source_version: row.source_version,
  source_status: row.source_status,
  lifecycle_state: 'published',
  payload: row.payload,
}));
const items = forecastRows.map((row) => ({
  id: row.id,
  subject: row.subject,
  title: row.title,
  current_published_version_id: versionIdByContentId.get(row.id),
}));

const requests = [];
const fetchImpl = async (input, init) => {
  const url = new URL(input);
  requests.push({ url, init });
  if (url.pathname.endsWith('/dd2026_content_items')) {
    return { ok: true, status: 200, json: async () => items };
  }
  if (url.pathname.endsWith('/dd2026_content_versions')) {
    const requested = new Set(
      String(url.searchParams.get('id') || '')
        .replace(/^in\.\(/u, '')
        .replace(/\)$/u, '')
        .split(','),
    );
    return {
      ok: true,
      status: 200,
      json: async () => versions.filter((version) => requested.has(version.id)),
    };
  }
  return { ok: false, status: 404, json: async () => null };
};

const savedUrl = process.env.DD2026_SUPABASE_URL;
const savedKey = process.env.DD2026_SUPABASE_SERVICE_ROLE_KEY;
try {
  process.env.DD2026_SUPABASE_URL = 'https://hlzqmreeoghbldnhlybr.supabase.co';
  process.env.DD2026_SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret';
  const verified = await verifyForecastContent({ environment: 'staging', fetchImpl });
  assert.deepEqual(verified, {
    ok: true,
    targetRef: 'hlzqmreeoghbldnhlybr',
    count: 120,
    sha256: manifest.sha256,
    sourceVersion: '2026.3',
    sourceStatus: 'AI_PREPARED_BETA',
  });
  assert.equal(requests.length, 4, 'One item request and three bounded version requests are expected.');
  assert.ok(requests.every(({ url }) => url.hostname === 'hlzqmreeoghbldnhlybr.supabase.co'));
  assert.ok(requests.every(({ init }) => init.headers.Authorization === 'Bearer test-service-role-secret'));
  const originalTitle = items[0].title;
  items[0].title = `${originalTitle} drift`;
  await assert.rejects(
    verifyForecastContent({ environment: 'staging', fetchImpl }),
    /identity, subject, or title drifted/u,
  );
  items[0].title = originalTitle;
  const firstVersion = items[0].current_published_version_id;
  items[0].current_published_version_id = items[1].current_published_version_id;
  items[1].current_published_version_id = firstVersion;
  await assert.rejects(
    verifyForecastContent({ environment: 'staging', fetchImpl }),
    /published Forecast content drifted/u,
  );
  items[1].current_published_version_id = items[0].current_published_version_id;
  items[0].current_published_version_id = firstVersion;

  process.env.DD2026_SUPABASE_URL = 'https://hbllomlijfznnuudpdvr.supabase.co';
  await assert.rejects(
    verifyForecastContent({ environment: 'production', fetchImpl }),
    /Production confirmation is missing or incorrect/u,
  );
  process.env.DD2026_SUPABASE_URL = 'https://wrong-project.supabase.co';
  await assert.rejects(
    verifyForecastContent({ environment: 'staging', fetchImpl }),
    /Target identity mismatch/u,
  );
} finally {
  if (savedUrl === undefined) delete process.env.DD2026_SUPABASE_URL;
  else process.env.DD2026_SUPABASE_URL = savedUrl;
  if (savedKey === undefined) delete process.env.DD2026_SUPABASE_SERVICE_ROLE_KEY;
  else process.env.DD2026_SUPABASE_SERVICE_ROLE_KEY = savedKey;
}

const verifierSource = await readFile(
  path.join(root, 'scripts', 'verify-admin-bar-forecast-content.mjs'),
  'utf8',
);
assert.match(verifierSource, /DD2026_SUPABASE_SERVICE_ROLE_KEY/u);
assert.match(verifierSource, /no credential was logged/u);
assert.match(verifierSource, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/u);
assert.doesNotMatch(verifierSource, /console\.(?:log|error)\([^\n]*(?:target\.key|process\.env)/u);
const importerSource = await readFile(
  path.join(root, 'scripts', 'import-duediligence-2026-content.mjs'),
  'utf8',
);
assert.match(importerSource, /--content-type/u);
assert.match(importerSource, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/u);

console.log(JSON.stringify({
  ok: true,
  count: manifest.count,
  sha256: manifest.sha256,
  remoteVerification: 'exact-current-published-payloads',
}));
