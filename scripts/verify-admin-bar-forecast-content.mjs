import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  buildImportRows,
  contentChecksum,
  stableJson,
  supabaseServiceHeaders,
} from './import-duediligence-2026-content.mjs';

const FORECAST_CONTENT_TYPE = 'bar_forecast_question';
const FORECAST_SOURCE_VERSION = '2026.3';
const FORECAST_SOURCE_STATUS = 'AI_PREPARED_BETA';
const FORECAST_COUNT = 120;
const PRODUCTION_REF = 'hbllomlijfznnuudpdvr';
const STAGING_REF = 'hlzqmreeoghbldnhlybr';
const REQUEST_TIMEOUT_MS = 30_000;

const hashEntries = (entries) => `sha256:${createHash('sha256')
  .update(stableJson(entries), 'utf8')
  .digest('hex')}`;

export async function buildForecastContentManifest() {
  const imported = await buildImportRows();
  const rows = imported.rows
    .filter((row) => row.content_type === FORECAST_CONTENT_TYPE)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (rows.length !== FORECAST_COUNT) {
    throw new Error(`Expected ${FORECAST_COUNT} Forecast rows; found ${rows.length}.`);
  }
  for (const row of rows) {
    if (row.source_version !== FORECAST_SOURCE_VERSION
        || row.source_status !== FORECAST_SOURCE_STATUS
        || contentChecksum(row.payload) !== row.checksum) {
      throw new Error(`${row.id}: Forecast source version, status, or payload checksum drifted.`);
    }
  }
  const entries = rows.map(({ id, subject, title, checksum }) => Object.freeze({
    id,
    subject,
    title,
    checksum,
  }));
  return Object.freeze({
    count: rows.length,
    sha256: hashEntries(entries),
    sourceVersion: FORECAST_SOURCE_VERSION,
    sourceStatus: FORECAST_SOURCE_STATUS,
    entries: Object.freeze(entries),
  });
}

function expectedRef(environment) {
  if (environment === 'staging') return STAGING_REF;
  if (environment === 'production') return PRODUCTION_REF;
  throw new Error('Use --environment staging or --environment production with --verify.');
}

function verifiedEndpoint(environment, productionConfirmation) {
  const ref = expectedRef(environment);
  if (environment === 'production' && productionConfirmation !== PRODUCTION_REF) {
    throw new Error('Production confirmation is missing or incorrect; no request was sent.');
  }
  const rawUrl = String(
    process.env.DD2026_SUPABASE_URL || process.env.SUPABASE_URL || '',
  ).trim();
  const key = String(
    process.env.DD2026_SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || '',
  ).trim();
  if (!rawUrl || !key) {
    throw new Error('Supabase URL and service-role credentials must be supplied through the secure environment.');
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== `${ref}.supabase.co`) {
    throw new Error(`Target identity mismatch. Expected ${ref}; no request was sent.`);
  }
  return Object.freeze({ ref, url, key });
}

async function fetchRows(target, pathname, search, fetchImpl) {
  const endpoint = new URL(pathname, target.url);
  for (const [key, value] of Object.entries(search)) endpoint.searchParams.set(key, value);
  const response = await fetchImpl(endpoint, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: supabaseServiceHeaders(target.key, {
      Accept: 'application/json',
    }),
  });
  if (!response.ok) {
    throw new Error(`Forecast verification failed with HTTP ${response.status}; no credential was logged.`);
  }
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body)) throw new Error('Forecast verification returned a non-array response.');
  return body;
}

export async function verifyForecastContent({
  environment,
  productionConfirmation = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const manifest = await buildForecastContentManifest();
  const target = verifiedEndpoint(environment, productionConfirmation);
  const items = await fetchRows(target, '/rest/v1/dd2026_content_items', {
    content_type: `eq.${FORECAST_CONTENT_TYPE}`,
    select: 'id,subject,title,current_published_version_id',
    order: 'id.asc',
    limit: String(FORECAST_COUNT + 1),
  }, fetchImpl);
  if (items.length !== FORECAST_COUNT) {
    throw new Error(`Forecast content count mismatch: expected ${FORECAST_COUNT}; found ${items.length}.`);
  }
  const expectedById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const itemIds = new Set();
  for (const item of items) {
    const id = String(item.id || '');
    const expected = expectedById.get(id);
    if (!expected || itemIds.has(id)
        || item.subject !== expected.subject
        || item.title !== expected.title) {
      throw new Error(`${id || 'unknown'}: Forecast item identity, subject, or title drifted.`);
    }
    itemIds.add(id);
  }
  const versionIds = items.map((item) => String(item.current_published_version_id || ''));
  if (versionIds.some((id) => !/^[0-9a-f-]{36}$/iu.test(id))
      || new Set(versionIds).size !== FORECAST_COUNT) {
    throw new Error('Every Forecast item must reference one unique published version.');
  }
  const currentVersionByContentId = new Map(items.map((item) => [
    String(item.id || ''),
    String(item.current_published_version_id || ''),
  ]));

  const versions = [];
  for (let offset = 0; offset < versionIds.length; offset += 50) {
    const chunk = versionIds.slice(offset, offset + 50);
    versions.push(...await fetchRows(target, '/rest/v1/dd2026_content_versions', {
      id: `in.(${chunk.join(',')})`,
      select: 'id,content_id,checksum,source_version,source_status,lifecycle_state,payload',
      order: 'content_id.asc',
      limit: String(chunk.length),
    }, fetchImpl));
  }
  if (versions.length !== FORECAST_COUNT) {
    throw new Error(`Forecast published-version count mismatch: expected ${FORECAST_COUNT}; found ${versions.length}.`);
  }

  const remoteEntries = [];
  const seenContentIds = new Set();
  for (const version of versions) {
    const contentId = String(version.content_id || '');
    const checksum = String(version.checksum || '').toLowerCase();
    if (seenContentIds.has(contentId)
        || expectedById.get(contentId)?.checksum !== checksum
        || currentVersionByContentId.get(contentId) !== String(version.id || '')
        || version.source_version !== FORECAST_SOURCE_VERSION
        || version.source_status !== FORECAST_SOURCE_STATUS
        || version.lifecycle_state !== 'published'
        || !version.payload
        || contentChecksum(version.payload) !== checksum) {
      throw new Error(`${contentId || 'unknown'}: published Forecast content drifted from the reviewed manifest.`);
    }
    seenContentIds.add(contentId);
    const expected = expectedById.get(contentId);
    remoteEntries.push({
      id: contentId,
      subject: expected.subject,
      title: expected.title,
      checksum,
    });
  }
  remoteEntries.sort((left, right) => left.id.localeCompare(right.id));
  const remoteHash = hashEntries(remoteEntries);
  if (remoteHash !== manifest.sha256) {
    throw new Error('Forecast content manifest checksum mismatch.');
  }

  return Object.freeze({
    ok: true,
    targetRef: target.ref,
    count: remoteEntries.length,
    sha256: remoteHash,
    sourceVersion: FORECAST_SOURCE_VERSION,
    sourceStatus: FORECAST_SOURCE_STATUS,
  });
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : '';
}

export async function main(argv = process.argv.slice(2)) {
  const manifest = await buildForecastContentManifest();
  if (argv.includes('--print-attestation')) {
    process.stdout.write(manifest.sha256);
    return manifest.sha256;
  }
  const report = argv.includes('--verify')
    ? await verifyForecastContent({
      environment: argumentValue(argv, '--environment'),
      productionConfirmation: argumentValue(argv, '--confirm-production'),
    })
    : {
      ok: true,
      count: manifest.count,
      sha256: manifest.sha256,
      sourceVersion: manifest.sourceVersion,
      sourceStatus: manifest.sourceStatus,
    };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
