import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CONTENT_ROOT = new URL('../content/duediligence-2026/', import.meta.url);
const DEFAULT_SOURCE_VERSION = '2026.1';
const SOURCE_STATUS = 'AI_PREPARED_BETA';
const PRODUCTION_REF = 'hbllomlijfznnuudpdvr';
const STAGING_REF = 'hlzqmreeoghbldnhlybr';
const REQUEST_TIMEOUT_MS = 60_000;

const COLLECTIONS = Object.freeze([
  Object.freeze({ file: 'bar-easy.json', contentType: 'bar_easy', sourceVersion: DEFAULT_SOURCE_VERSION, title: (row) => `${row.id} — ${row.syllabus_topic}` }),
  Object.freeze({ file: 'doctrines.json', contentType: 'doctrine', sourceVersion: DEFAULT_SOURCE_VERSION, title: (row) => row.doctrine_title }),
  Object.freeze({ file: 'chairs-cases.json', contentType: 'chair_case', sourceVersion: DEFAULT_SOURCE_VERSION, title: (row) => row.short_title || row.case_title }),
  Object.freeze({ file: 'anchor-cases.json', contentType: 'anchor_case', sourceVersion: DEFAULT_SOURCE_VERSION, title: (row) => row.short_title || row.case_title }),
  Object.freeze({ file: 'bar-forecast.json', contentType: 'bar_forecast_question', sourceVersion: '2026.3', title: (row) => `${row.editorial_ref} — ${row.title}` }),
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function contentChecksum(payload) {
  return createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

export function supabaseServiceHeaders(key, additionalHeaders = {}) {
  for (const headerName of Object.keys(additionalHeaders)) {
    if (['apikey', 'authorization'].includes(headerName.toLowerCase())) {
      throw new Error(`${headerName} cannot override a Supabase service credential header.`);
    }
  }
  return {
    ...additionalHeaders,
    apikey: key,
    ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
  };
}

function requiredText(value, label, maximum) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximum) throw new Error(`${label} is invalid.`);
  return text;
}

export function transformContentRow(row, collection) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Content row must be an object.');
  const sourceVersion = requiredText(row.version, `${collection.file} version`, 40);
  const sourceStatus = requiredText(row.status, `${collection.file} status`, 80);
  if (sourceVersion !== collection.sourceVersion || sourceStatus !== SOURCE_STATUS) {
    throw new Error(`${row.id || collection.file}: source version/status is not approved for this beta import.`);
  }
  const id = requiredText(row.id, `${collection.file} id`, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) throw new Error(`${row.id}: normalized id is invalid.`);
  const subject = requiredText(row.subject, `${row.id} subject`, 160);
  const title = requiredText(collection.title(row), `${row.id} title`, 500);
  const payload = stableValue(row);
  return {
    id,
    content_type: collection.contentType,
    subject,
    title,
    source_version: sourceVersion,
    source_status: SOURCE_STATUS,
    payload,
    checksum: contentChecksum(payload),
  };
}

async function loadJson(file) {
  const parsed = JSON.parse(await readFile(new URL(file, CONTENT_ROOT), 'utf8'));
  if (!parsed || !Array.isArray(parsed.rows) || parsed.count !== parsed.rows.length) {
    throw new Error(`${file}: declared count does not match rows.`);
  }
  return parsed.rows;
}

export async function buildImportRows() {
  const rows = [];
  const counts = {};
  for (const collection of COLLECTIONS) {
    const sourceRows = await loadJson(collection.file);
    const transformed = sourceRows.map((row) => transformContentRow(row, collection));
    rows.push(...transformed);
    counts[collection.contentType] = transformed.length;
  }
  const ids = rows.map((row) => row.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Duplicate normalized content ids: ${[...new Set(duplicates)].join(', ')}`);
  return { rows, counts, total: rows.length };
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const environmentIndex = argv.indexOf('--environment');
  const environment = environmentIndex >= 0 ? argv[environmentIndex + 1] : 'dry-run';
  const contentTypeIndex = argv.indexOf('--content-type');
  const contentType = contentTypeIndex >= 0 ? String(argv[contentTypeIndex + 1] || '') : '';
  const productionConfirmationIndex = argv.indexOf('--confirm-production');
  const productionConfirmation = productionConfirmationIndex >= 0 ? argv[productionConfirmationIndex + 1] : '';
  if (apply && !['staging', 'production'].includes(environment)) {
    throw new Error('Use --environment staging or --environment production with --apply.');
  }
  if (contentType && !COLLECTIONS.some((collection) => collection.contentType === contentType)) {
    throw new Error(`Unknown content type: ${contentType}.`);
  }
  return { apply, environment, contentType, productionConfirmation };
}

function expectedRef(environment) {
  return environment === 'production' ? PRODUCTION_REF : STAGING_REF;
}

function verifiedEndpoint(environment) {
  const ref = expectedRef(environment);
  const rawUrl = String(process.env.DD2026_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.DD2026_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!rawUrl || !key) throw new Error('Supabase URL and service-role credentials must be supplied through the secure environment.');
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== `${ref}.supabase.co`) {
    throw new Error(`Target identity mismatch. Expected ${ref}; no request was sent.`);
  }
  return { ref, url, key };
}

async function applyImport(rows, environment, productionConfirmation) {
  const target = verifiedEndpoint(environment);
  if (environment === 'production' && productionConfirmation !== PRODUCTION_REF) {
    throw new Error('Production confirmation is missing or incorrect; no request was sent.');
  }
  const endpoint = new URL('/rest/v1/rpc/dd2026_import_content_batch', target.url);
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: supabaseServiceHeaders(target.key, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ p_actor_user_id: null, p_rows: rows }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Content import failed with HTTP ${response.status}; no credential was logged.`);
  return { targetRef: target.ref, result };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = await buildImportRows();
  const selectedRows = options.contentType
    ? manifest.rows.filter((row) => row.content_type === options.contentType)
    : manifest.rows;
  const selectedCounts = options.contentType
    ? { [options.contentType]: selectedRows.length }
    : manifest.counts;
  if (options.contentType && selectedRows.length < 1) {
    throw new Error(`No rows matched content type ${options.contentType}.`);
  }
  const report = {
    ok: true,
    mode: options.apply ? 'apply' : 'dry-run',
    environment: options.apply ? options.environment : null,
    contentType: options.contentType || null,
    sourceVersions: Object.fromEntries(COLLECTIONS.map((collection) => [
      collection.contentType,
      collection.sourceVersion,
    ])),
    sourceStatus: SOURCE_STATUS,
    counts: selectedCounts,
    total: selectedRows.length,
    duplicateIds: [],
  };
  if (options.apply) {
    const applied = await applyImport(selectedRows, options.environment, options.productionConfirmation);
    report.targetRef = applied.targetRef;
    report.result = applied.result;
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
