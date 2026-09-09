/** Dedicated staging release gates. GET-only inspection; deployment belongs to the restricted workflow. */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET = Object.freeze({ worker: 'duediligence-examinations-staging', origin: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev', project: 'hlzqmreeoghbldnhlybr' });
const HASH = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const need = (value, code, message) => { if (!value) fail(code, message); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(canonical(value))).digest('hex');
const sorted = values => [...values].sort();
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Explicit preservation of capture 34349103999. This is not a new logging plan.
const REVIEWED_OBSERVABILITY = { enabled: true, head_sampling_rate: 1, redact_query_string: false,
  logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
  traces: { enabled: false, head_sampling_rate: 1, persist: true } };
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();

export function validateCaptureRequest({ event, env, head, gitStatus }) {
  const repo = 'codingwally/Bar-Exam-simulator', pr = event?.pull_request;
  need(env.GITHUB_EVENT_NAME === 'pull_request' && event?.action === 'labeled' && env.GITHUB_REPOSITORY === repo && event?.repository?.full_name === repo
    && env.GITHUB_ACTOR === 'codingwally' && env.GITHUB_TRIGGERING_ACTOR === 'codingwally' && event?.sender?.login === 'codingwally'
    && pr?.number === 356 && pr.state === 'open' && pr.head?.repo?.full_name === repo && pr.head?.ref === 'codex/debate-room-v3-20260909'
    && pr.base?.repo?.full_name === repo && pr.base?.ref === 'main' && SHA.test(pr.head?.sha || '')
    && event.label?.name === 'dv3-c-' + pr.head.sha && env.DEBATE_CANDIDATE_SHA === pr.head.sha
    && env.GITHUB_REF === 'refs/pull/356/merge' && head === pr.head.sha && gitStatus === '',
  'CAPTURE_AUTHORITY_REQUIRED', 'Only the current owner-labeled exact candidate in PR356 may capture staging through this path.');
  return pr.head.sha;
}

// Only parse the existing base's simple string/array settings. Unknown syntax fails closed.
export function parseBase(source) {
  const value = key => { const matches = [...source.matchAll(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'gm'))]; need(matches.length === 1, 'BASE_CONFIG_CHANGED', `Expected one ${key} setting in the reviewed staging base.`); return JSON.parse(matches[0][1].trim()); };
  const varsBlock = source.match(/^\[vars\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  need(varsBlock, 'BASE_CONFIG_CHANGED', 'The staging base needs its existing vars section.');
  const vars = {};
  for (const raw of varsBlock.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)\s*=\s*(".*")$/.exec(line); need(match, 'BASE_CONFIG_CHANGED', 'Unsupported staging variable syntax.');
    need(!Object.hasOwn(vars, match[1]), 'BASE_CONFIG_CHANGED', 'Duplicate staging variable.'); vars[match[1]] = JSON.parse(match[2]);
  }
  need(value('name') === TARGET.worker && value('main') === 'commercial-entry.mjs', 'WRONG_TARGET', 'Only the existing approved staging Worker entry is allowed.');
  need(vars.SUPABASE_URL === `https://${TARGET.project}.supabase.co` && vars.ALLOWED_ORIGIN === TARGET.origin, 'WRONG_TARGET', 'Only the approved staging project and origin are allowed.');
  need(vars.OUTBOUND_EMAIL_MODE === 'suppressed' && vars.STUDY_ROOM_ENABLED === 'true', 'BASE_CONFIG_CHANGED', 'Existing suppressed mail and Study Room settings must be preserved.');
  need(!/^\[\[(?:r2_buckets|kv_namespaces|d1_databases|services|queues|durable_objects)/m.test(source), 'RESOURCE_BINDING_CHANGED', 'A newly bound resource requires a separate reviewed preservation plan.');
  return { source, vars, compatibilityDate: value('compatibility_date'), compatibilityFlags: value('compatibility_flags'), region: value('region'), crons: value('crons') };
}
export function previewIds(value) {
  const ids = String(value || '').split(',').map(id => id.trim().toLowerCase()).filter(Boolean);
  need(ids.length > 0 && ids.length <= 30 && ids.every(id => UUID.test(id)) && new Set(ids).size === ids.length, 'PREVIEW_ALLOWLIST_REQUIRED', 'Supply 1-30 distinct approved account UUIDs, not names, emails or wildcard values.');
  return sorted(ids);
}
export function validatePolicy(policy) {
  need(policy.workerName === TARGET.worker && policy.publicUrl === TARGET.origin && policy.supabaseProjectRef === TARGET.project && policy.baseConfig === 'worker/wrangler.staging.toml', 'WRONG_TARGET', 'This package has no production or alternate target.');
  need(equal(policy.debateVars, { DEBATE_ROOM_ENABLED: 'false', DEBATE_MEDIA_ENABLED: 'false', DEBATE_SWEEPER_ENABLED: 'false', DEBATE_RESULTS_EMAIL_MODE: 'suppressed', DEBATE_INVITATION_EMAIL_MODE: 'suppressed', DEBATE_APPROVED_MAX_PARTICIPANTS: '0' }), 'UNSAFE_DEBATE_FLAGS', 'Initial staging must keep public access, provider media, mail and sweeping disabled.');
  need(equal(policy.migrations, ['supabase/migrations/20260909080139_debate_room_v3.sql', 'supabase/migrations/20260909080143_study_room_admission_v3.sql']), 'MIGRATION_SCOPE_CHANGED', 'Only the two newly reviewed Debate and Study admission migrations belong to this gate.');
  need(equal(sorted(policy.requiredSecretNames || []), sorted(['SUPABASE_SERVICE_ROLE_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'])), 'SECRET_REQUIREMENTS_CHANGED', 'Preserve the required existing Supabase and Study media secret bindings.');
}
export function buildConfig(base, policy, allowlist, outputDirectory, root = ROOT) {
  validatePolicy(policy); const ids = previewIds(allowlist);
  need(!Object.keys(base.vars).some(key => key.startsWith('DEBATE_')), 'BASE_CONFIG_CHANGED', 'Debate variables entered the shared base; review the overlay before proceeding.');
  need(base.compatibilityDate === policy.compatibilityDate && equal(base.compatibilityFlags, policy.compatibilityFlags) && base.region === policy.placementRegion && equal(base.crons, policy.crons), 'BASE_CONFIG_CHANGED', 'Compatibility, placement or cron changed from the reviewed staging baseline.');
  need(!/^\s*(?:\[+(?:cache|exports)(?:[.\]\s])|(?:cache|exports)(?:\s*=|\.))/m.test(base.source), 'BASE_CONFIG_CHANGED', 'The reviewed cache and export configuration is absent; new settings require a separate preservation review.');
  const observabilityBlocks = [...base.source.matchAll(/^\[observability\]\s*\r?\n[\s\S]*?(?=^\[(?!observability[.\]])|$(?![\s\S]))/gm)];
  const originalObservability = '[observability]\nenabled = true\n\n[observability.logs]\nenabled = true';
  need(observabilityBlocks.length === 1 && observabilityBlocks[0][0].replaceAll('\r\n', '\n').trim() === originalObservability, 'BASE_CONFIG_CHANGED', 'The staging base logging configuration changed; review it before adding the exact captured preservation settings.');
  let config = base.source.replace(/^main\s*=.*$/m, `main = ${JSON.stringify(path.join(root, 'worker/commercial-entry.mjs').replaceAll('\\', '/'))}`)
    .replace(/^directory\s*=\s*"\.\.\/\.staging-dist"$/m, `directory = ${JSON.stringify(path.join(root, '.staging-dist').replaceAll('\\', '/'))}`);
  need(!/^keep_vars\s*=/m.test(config), 'BASE_CONFIG_CHANGED', 'Review the shared base keep_vars setting before generating the overlay.');
  config = 'keep_vars = true\n' + config;
  const additions = { ...policy.debateVars, DEBATE_PREVIEW_ACTOR_IDS: ids.join(',') };
  config = config.replace(/^\[vars\]\s*$/m, '[vars]\n' + Object.entries(additions).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n'));
  const eol = base.source.includes('\r\n') ? '\r\n' : '\n';
  const observabilityText = Object.entries(REVIEWED_OBSERVABILITY).filter(([, value]) => typeof value !== 'object').map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
  const preservedObservability = ['[observability]', ...observabilityText, '', ...['logs','traces'].flatMap(section => [
    `[observability.${section}]`, ...Object.entries(REVIEWED_OBSERVABILITY[section]).map(([key, value]) => `${key} = ${JSON.stringify(value)}`), '',
  ]), ''].join(eol);
  config = config.replace(observabilityBlocks[0][0], preservedObservability);
  return { filename: path.join(outputDirectory, 'wrangler.debate-staging.toml'), text: config, hash: hash(config), previewActorIds: ids };
}

export function sanitizeBaseline({ deployments, settings, scriptSettings, version, schedules, subdomain, service }, base) {
  const deployment = deployments?.deployments?.[0];
  need(deployment?.versions?.length === 1 && deployment.versions[0].percentage === 100 && UUID.test(deployment.versions[0].version_id), 'SPLIT_OR_MISSING_DEPLOYMENT', 'Require one identified version serving 100% of staging traffic.');
  need(version?.id === deployment.versions[0].version_id, 'BASELINE_DRIFT', 'The active version changed during baseline capture.');
  need(Array.isArray(settings?.bindings), 'BASELINE_INCOMPLETE', 'Cloudflare settings did not provide its complete binding list.');
  const bindings = [], vars = {}, undisclosedVariableHashes = {};
  for (const binding of settings.bindings) {
    need(typeof binding.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.name), 'BASELINE_INCOMPLETE', 'A binding name was invalid.');
    need(['plain_text','secret_text'].includes(binding.type), 'RESOURCE_BINDING_CHANGED', 'An existing non-variable resource binding needs a reviewed preservation plan.');
    bindings.push({ name: binding.name, type: binding.type });
    if (binding.type === 'plain_text') {
      need(typeof binding.text === 'string', 'BASELINE_INCOMPLETE', 'A plain-text binding value is unavailable.');
      const safe = Object.hasOwn(base.vars, binding.name) && !/(?:KEY|SECRET|TOKEN|PASSWORD|PEPPER|RECIPIENT|VAPID|HMAC)/i.test(binding.name) || /^DEBATE_(?:ROOM_ENABLED|MEDIA_ENABLED|SWEEPER_ENABLED|RESULTS_EMAIL_MODE|INVITATION_EMAIL_MODE|APPROVED_MAX_PARTICIPANTS|PREVIEW_ACTOR_IDS)$/.test(binding.name);
      if (safe) vars[binding.name] = binding.text; else undisclosedVariableHashes[binding.name] = hash(binding.text);
    }
  }
  // These diagnostics retain only reviewed configuration fields, never raw API
  // objects (service metadata can also contain bindings and author details).
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const fieldNames = value => {
    need(object(value), 'BASELINE_INCOMPLETE', 'Expected a configuration metadata object.');
    const keys = Object.keys(value);
    need(keys.length <= 100 && keys.every(key => /^[A-Za-z_$][A-Za-z0-9_$-]{0,127}$/.test(key)), 'BASELINE_INCOMPLETE', 'Unexpected configuration metadata field names.');
    return sorted(keys);
  };
  const label = value => { need(typeof value === 'string' && /^[A-Za-z0-9_$.:/-]{1,255}$/.test(value), 'BASELINE_INCOMPLETE', 'Unexpected configuration metadata label.'); return value; };
  const booleans = (value, allowed) => {
    if (value == null) return null;
    fieldNames(value);
    return Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => {
      need(typeof value[key] === 'boolean', 'BASELINE_INCOMPLETE', 'A cache configuration flag was not boolean.'); return [key, value[key]];
    }));
  };
  const placement = value => {
    if (value == null) return null;
    fieldNames(value);
    const result = Object.fromEntries(['mode','region','host','hostname','hint'].filter(key => value[key] != null).map(key => [key, label(value[key])]));
    if (value.target != null) {
      const target = item => {
        if (Number.isSafeInteger(item) && item >= 0) return item; // Observed numeric ID: preserve it without interpreting it as a region.
        if (typeof item === 'string') return label(item);
        fieldNames(item);
        return Object.fromEntries(['region','host','hostname'].filter(key => item[key] != null).map(key => [key, label(item[key])]));
      };
      need(!Array.isArray(value.target) || value.target.length <= 30, 'BASELINE_INCOMPLETE', 'Unexpected placement target count.');
      result.target = Array.isArray(value.target) ? value.target.map(target) : target(value.target);
    }
    return result;
  };
  const exports = value => {
    if (value == null) return null;
    return Object.fromEntries(fieldNames(value).map(name => {
      const entry = value[name], presentFields = fieldNames(entry);
      return [name, { presentFields, ...Object.fromEntries(['type','state'].filter(key => entry[key] != null).map(key => [key, label(entry[key])])),
        cache: booleans(entry.cache, ['enabled']), cachePresentFields: entry.cache == null ? [] : fieldNames(entry.cache) }];
    }));
  };
  const metadata = value => ({ presentFields: fieldNames(value), placement: placement(value.placement),
    placementMode: value.placement_mode == null ? null : label(value.placement_mode),
    cacheOptions: booleans(value.cache_options, ['enabled','cross_version_cache']),
    cacheOptionsPresentFields: value.cache_options == null ? [] : fieldNames(value.cache_options), exports: exports(value.exports) });
  const runtime = version.resources?.script_runtime || {};
  need(object(service?.default_environment?.script), 'BASELINE_INCOMPLETE', 'The existing service default-environment script metadata was unavailable.');
  const captureSources = { schemaVersion: 1, settings: metadata(settings), runtime: metadata(runtime),
    service: { defaultEnvironment: label(service.default_environment.environment), script: metadata(service.default_environment.script) } };
  // The documented global field is cache_options; omitted flags remain unknown.
  // Capture every override separately so the reviewer can detect disagreement.
  const cacheCandidates = [
    ['version.resources.script_runtime.exports.default.cache.enabled', captureSources.runtime.exports?.default?.cache?.enabled],
    ['settings.exports.default.cache.enabled', captureSources.settings.exports?.default?.cache?.enabled],
    ['settings.cache_options.enabled', captureSources.settings.cacheOptions?.enabled],
  ];
  const selectedCache = cacheCandidates.find(([, value]) => typeof value === 'boolean');
  const state = { worker: TARGET.worker, origin: TARGET.origin, projectRef: TARGET.project,
    deploymentId: deployment.id, versionId: version.id, trafficPercent: 100,
    bindings: bindings.sort((a, b) => a.name.localeCompare(b.name)), vars, undisclosedVariableHashes,
    compatibilityDate: (settings.compatibility_date || runtime.compatibility_date || '').slice(0, 10),
    compatibilityFlags: sorted(settings.compatibility_flags || runtime.compatibility_flags || []),
    placement: captureSources.settings.placement, observability: scriptSettings.observability || settings.observability || null,
    logpush: scriptSettings.logpush ?? settings.logpush ?? false, tailConsumers: scriptSettings.tail_consumers || [],
    limits: runtime.limits || settings.limits || null, usageModel: runtime.usage_model || null,
    cache: selectedCache?.[1] ?? null, cacheSource: selectedCache?.[0] ?? null, captureSources,
    crons: sorted((schedules?.schedules || schedules || []).map(item => typeof item === 'string' ? item : item.cron)),
    workersDev: subdomain?.enabled, previewUrls: subdomain?.previews_enabled,
  };
  need(state.bindings.length === new Set(state.bindings.map(item => item.name)).size, 'BASELINE_INCOMPLETE', 'Duplicate remote binding names.');
  return { schemaVersion: 2, capturedAt: new Date().toISOString(), state, fingerprint: hash(state), secretValuesStored: false };
}
export function validateBaseline(baseline, base, policy, expectedHash, expectedVersion) {
  need(HASH.test(expectedHash || '') && baseline.fingerprint === expectedHash && hash(baseline.state) === expectedHash, 'BASELINE_DRIFT', 'The reviewed sanitized remote snapshot hash no longer matches.');
  const s = baseline.state;
  const sources = s.captureSources;
  need(baseline.schemaVersion === 2 && sources?.schemaVersion === 1, 'BASELINE_INCOMPLETE', 'Require the reviewed expanded cache and service-placement capture.');
  need(UUID.test(expectedVersion || '') && s.versionId === expectedVersion && s.trafficPercent === 100, 'BASELINE_DRIFT', 'The exact reviewed active Worker version must still serve all staging traffic.');
  need(s.worker === TARGET.worker && s.origin === TARGET.origin && s.projectRef === TARGET.project, 'WRONG_TARGET', 'The remote snapshot belongs to a different environment.');
  need(s.compatibilityDate === base.compatibilityDate && equal(s.compatibilityFlags, sorted(base.compatibilityFlags)) && equal(s.crons, sorted(base.crons)), 'BASELINE_SETTINGS_DRIFT', 'Compatibility or cron differs from the staging base.');
  need(equal(s.placement, { mode: 'targeted', target: [10] }) && equal(sources.settings?.placement, s.placement)
    && sources.service?.defaultEnvironment === 'production' && sources.service.script?.placementMode === 'targeted'
    && equal(sources.service.script.placement, { mode: 'targeted', target: [{ region: policy.placementRegion }] })
    && sources.runtime?.placement === null && sources.runtime?.placementMode === null,
  'BASELINE_SETTINGS_DRIFT', 'Require the observed settings placement and its same-capture explicit service region; numeric IDs are never interpreted as regions.');
  const cacheAbsent = metadata => metadata?.cacheOptions === null && metadata.exports === null && equal(metadata.cacheOptionsPresentFields, [])
    && Array.isArray(metadata.presentFields) && !metadata.presentFields.some(field => /^(?:cache|exports)(?:_|$)/.test(field));
  need(s.cache === null && s.cacheSource === null && [sources.settings, sources.runtime, sources.service.script].every(cacheAbsent),
    'UNREPRESENTED_REMOTE_SETTING', 'The reviewed cache and export settings must remain absent in every source. Omission does not mean disabled; any explicit setting needs review.');
  need(s.workersDev === true && s.previewUrls === true && s.tailConsumers.length === 0, 'BASELINE_SETTINGS_DRIFT', 'Routes, previews or tail consumers need review.');
  need(s.logpush === false && (!s.limits || Object.keys(s.limits).length === 0), 'UNREPRESENTED_REMOTE_SETTING', 'A custom remote Logpush or resource limit needs an explicit preservation overlay before deployment.');
  need(equal(s.observability, REVIEWED_OBSERVABILITY), 'UNREPRESENTED_REMOTE_SETTING', 'Logging, sampling, redaction and tracing must match the complete captured preservation overlay.');
  const secretNames = s.bindings.filter(item => item.type === 'secret_text').map(item => item.name);
  for (const required of policy.requiredSecretNames) need(secretNames.includes(required), 'REMOTE_SECRET_MISSING', `Required existing secret binding ${required} is unavailable; do not print or replace its value.`);
  for (const [key, value] of Object.entries(base.vars)) {
    const actual = Object.hasOwn(s.vars, key) ? s.vars[key] === value : s.undisclosedVariableHashes[key] === hash(value);
    need(actual, 'BASELINE_SETTINGS_DRIFT', `The existing base variable ${key} differs from current staging. Review it before deploying.`);
  }
  return true;
}
export function validatePreservation(before, after, additions) {
  need(before?.schemaVersion === 2 && after?.schemaVersion === 2 && before.state?.captureSources?.schemaVersion === 1 && after.state?.captureSources?.schemaVersion === 1
    && hash(before.state) === before.fingerprint && hash(after.state) === after.fingerprint,
  'POSTDEPLOY_SETTINGS_DRIFT', 'Preservation requires intact expanded snapshots including every cache, export and placement source.');
  const a = structuredClone(before.state), b = structuredClone(after.state);
  need(a.versionId !== b.versionId, 'DEPLOYMENT_UNCONFIRMED', 'A new exact active version has not been confirmed.');
  for (const key of ['versionId','deploymentId']) { delete a[key]; delete b[key]; }
  a.vars = { ...a.vars, ...additions };
  for (const name of Object.keys(additions)) if (!a.bindings.some(binding => binding.name === name)) a.bindings.push({ name, type: 'plain_text' });
  a.bindings.sort((left, right) => left.name.localeCompare(right.name));
  need(equal(a, b), 'POSTDEPLOY_SETTINGS_DRIFT', 'Staging settings or bindings changed beyond the reviewed Debate overlay. Stop; preserve evidence and use the reviewed rollback procedure.');
  return true;
}

export async function captureRemote({ token, accountId, fetcher = fetch, base }) {
  need(token && /^[a-f0-9]{32}$/i.test(accountId || ''), 'CI_CREDENTIAL_MISSING', 'Existing Cloudflare CI token/account credentials are required. No login or secret replacement is attempted.');
  const workerPrefix = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const prefix = `${workerPrefix}/scripts/${TARGET.worker}`;
  const getUrl = async url => {
    const response = await fetcher(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const body = await response.json().catch(() => null);
    need(response.ok && body?.success === true && body.result != null, 'CLOUDFLARE_READ_FAILED', `Cloudflare baseline read failed (${response.status}); raw response omitted.`);
    return body.result;
  };
  const get = suffix => getUrl(prefix + suffix);
  const deployments = await get('/deployments'), active = deployments?.deployments?.[0]?.versions;
  need(active?.length === 1 && UUID.test(active[0].version_id), 'BASELINE_INCOMPLETE', 'An exact active Worker version is required.');
  const [settings, scriptSettings, version, schedules, subdomain, service] = await Promise.all([get('/settings'), get('/script-settings'), get(`/versions/${active[0].version_id}`), get('/schedules'), get('/subdomain'), getUrl(`${workerPrefix}/services/${TARGET.worker}`)]);
  const rechecked = await get('/deployments');
  need(equal(rechecked.deployments?.[0], deployments.deployments[0]), 'BASELINE_DRIFT', 'Staging changed while the baseline was captured.');
  return sanitizeBaseline({ deployments, settings, scriptSettings, version, schedules, subdomain, service }, base);
}
export const REQUIRED_SUITE_GROUPS = Object.freeze([
  'server-domain-database', 'client-state-media-dates', 'study-admission-sql',
  'study-always-open', 'study-backgrounds', 'study-background-picker', 'study-hotfix-behavior', 'study-live',
  'local-http-boundaries', 'accelerated-organizer', 'eligible-tournament-exports', 'staging-preflight-gates', 'worker-configuration-contract',
]);
// The runner also discovers feature files. These explicit release dependencies
// prevent a fabricated or accidentally truncated manifest from passing by size.
export const CRITICAL_SOURCES = Object.freeze([
  'index.html', 'debate-room/index.html', 'study-room/index.html',
  'assets/debate-room.js', 'assets/debate-room.css', 'assets/debate-media.js', 'assets/debate-dates.js', 'assets/debate-entry.js',
  'assets/study-room-live.js', 'assets/study-room-live.css', 'assets/study-room-preview.js', 'assets/study-room-preview.css', 'assets/study-room-backgrounds.js',
  'assets/phase2-experience.js', 'assets/phase2-config.js', 'assets/phase2.css', 'assets/feature-loader.js', 'assets/vendor/supabase-2.49.8.umd.js',
  'worker/index.mjs', 'worker/commercial-entry.mjs', 'worker/wrangler.toml', 'worker/wrangler.staging.toml', 'worker/debate-staging-policy.json',
  'worker/package.json', 'worker/package-lock.json',
  'worker/debate-domain.mjs', 'worker/debate-fixtures.mjs', 'worker/debate-tournament.mjs', 'worker/debate-sanctions.mjs',
  'worker/debate-service.mjs', 'worker/debate-store.mjs', 'worker/debate-routes.mjs', 'worker/debate-integration.mjs',
  'worker/debate-media.mjs', 'worker/debate-documents.mjs', 'worker/debate-delivery.mjs', 'worker/debate-schema-draft.sql',
  'worker/study-room-core.mjs', 'worker/study-room-routes.mjs', 'worker/study-room-admission.mjs', 'worker/study-room-admission-schema-draft.sql',
  'supabase/migrations/20260909080139_debate_room_v3.sql', 'supabase/migrations/20260909080143_study_room_admission_v3.sql',
  '.github/workflows/debate-v3-staging.yml', 'scripts/debate-staging-release.mjs', 'scripts/test-debate-staging-release.mjs',
  '.github/workflows/debate-v3-production-preview.yml', 'scripts/debate-production-preview.mjs', 'scripts/test-debate-production-preview.mjs', 'scripts/test-debate-entry.mjs',
  'scripts/test-debate-v3.mjs', 'scripts/build-pages-artifact.mjs', 'scripts/build-staging-artifact.mjs',
  'scripts/test-feature-decommission-boundary.mjs', 'scripts/test-debate-artifact.mjs', 'scripts/test-worker-cpu-limit-contract.mjs',
  'scripts/test-debate-client-state.mjs', 'scripts/test-debate-desktop-layout.mjs', 'scripts/test-debate-media.mjs', 'scripts/test-debate-dates.mjs',
  'scripts/serve-debate-rehearsal.mjs', 'scripts/test-debate-rehearsal-server.mjs', 'scripts/test-debate-organizer-rehearsal.mjs', 'scripts/test-debate-tournament-export.mjs',
  'scripts/test-study-room-admission-sql.mjs', 'scripts/test-study-room-always-open.mjs', 'scripts/test-study-room-backgrounds.mjs',
  'scripts/test-study-room-background-picker.mjs', 'scripts/test-study-room-hotfix-behavior.mjs', 'scripts/test-study-room-live.mjs',
  '.github/workflows/debate-v3-capture.yml', 'scripts/debate-staging-fixtures.mjs', 'scripts/run-debate-staging-auth.mjs',
  'scripts/test-debate-wrangler-metadata.mjs',
  'scripts/debate-hosted-cleanup.mjs', 'scripts/debate-hosted-fixtures.mjs', 'scripts/run-debate-hosted-rehearsal.mjs',
  'scripts/debate-hosted-upload-diagnostic.mjs', 'scripts/test-debate-hosted-upload-diagnostic.mjs',
  'scripts/test-debate-hosted-cleanup.mjs', 'scripts/test-debate-hosted-fixtures.mjs', 'scripts/test-debate-hosted-driver.mjs',
  'scripts/test-debate-browser-hosted-organizer.mjs', 'scripts/test-debate-hosted-browser-safety.mjs',
  'scripts/resolve-debate-hosted-preparation.mjs', 'scripts/test-debate-hosted-preparation.mjs',
  'supabase/staging/debate-hosted-cleanup.sql', 'supabase/staging/debate-hosted-cleanup-event-ids-upgrade.sql', 'scripts/test-debate-hosted-atomic-cleanup.mjs',
  '.github/workflows/debate-v3-validation.yml',
  'assets/vendor/debate-fonts/fraunces-v38-latin-ext.woff2', 'assets/vendor/debate-fonts/fraunces-v38-latin.woff2',
  'assets/vendor/debate-fonts/inter-v20-latin-ext.woff2', 'assets/vendor/debate-fonts/inter-v20-latin.woff2',
  'assets/vendor/debate-fonts/Fraunces.OFL.txt', 'assets/vendor/debate-fonts/Inter.OFL.txt',
  'assets/vendor/debate-fonts/manifest.json', 'assets/vendor/debate-fonts/google-fonts-source.css.txt', 'assets/vendor/debate-fonts/SOURCE.md',
  'scripts/test-debate-staging-fixtures.mjs', 'scripts/debate-staging-dml-probe.mjs', 'scripts/test-debate-staging-dml-probe.mjs',
  'docs/debate-room-v3/evidence/staging-dml-rollback-probe.sql', 'docs/debate-room-v3/evidence/staging-dml-rollback-probe.readback.sql',
  'docs/debate-room-v3/evidence/staging-dml-rollback-probe.fixtures.json', 'docs/debate-room-v3/evidence/staging-dml-rollback-probe.manifest.json',
  'docs/debate-room-v3/evidence/staging-dml-rollback-probe.denials.json',
  'docs/debate-room-v3/evidence/staging-dml-rollback-probe-service-398557be.sql', 'docs/debate-room-v3/evidence/staging-dml-rollback-probe-service-398557be.readback.sql',
  'docs/debate-room-v3/evidence/staging-dml-rollback-probe-service-398557be.fixtures.json', 'docs/debate-room-v3/evidence/staging-dml-rollback-probe-service-398557be.manifest.json',
]);
export function validateEvidence({ review, suite, candidate, changedPaths, migrationHashes, sourceHashes }) {
  need(SHA.test(candidate || '') && review.candidateSha === candidate && suite.head === candidate && SHA.test(review.baseSha || ''), 'CANDIDATE_MISMATCH', 'Review, local evidence and checkout must identify the same exact commit.');
  need(suite.status === 'PASS_LOCAL_SUITE' && suite.gitStatus === '' && Array.isArray(suite.changedDuringRun) && suite.changedDuringRun.length === 0 && Array.isArray(suite.groups), 'LOCAL_SUITE_REQUIRED', 'Require the complete passing suite on unchanged committed source.');
  const groupNames = suite.groups.map(group => group?.name);
  need(suite.groups.every(group => typeof group?.name === 'string' && group.name.trim() === group.name && group.name.length > 0 && group.status === 'PASS' && group.exitCode === 0)
    && new Set(groupNames).size === groupNames.length && REQUIRED_SUITE_GROUPS.every(name => groupNames.includes(name)), 'LOCAL_SUITE_REQUIRED', 'Every required local verification group must pass exactly once, including export, staging and Worker configuration checks.');
  need(CRITICAL_SOURCES.every(file => Object.hasOwn(suite.sourceHashes || {}, file) && HASH.test(suite.sourceHashes[file]) && Object.hasOwn(sourceHashes || {}, file)), 'LOCAL_SUITE_REQUIRED', 'The local suite source manifest must cover the current critical application, migration, build and release files.');
  for (const [file, before] of Object.entries(suite.sourceHashes)) {
    need(!file.includes('..') && !file.includes('\\') && !path.isAbsolute(file) && HASH.test(before), 'INVALID_SOURCE_MANIFEST', 'Source manifest entries must be repository paths and SHA-256 hashes.');
    need(sourceHashes[file] === before, 'SOURCE_DRIFT', `Source changed after local verification: ${file}`);
  }
  need(equal(sorted(review.approvedPaths || []), sorted(changedPaths)) && review.studyRoomPreserved === true && review.recoveryPreserved === true && review.retiredRuntimeAbsent === true && review.evidenceReferences?.length > 0 && review.approvalReference?.trim(), 'SCOPE_REVIEW_REQUIRED', 'A concrete complete file scope and Study/recovery review reference are required.');
  const proof = review.databaseProof;
  need(proof?.schemaVersion === 2 && proof.projectRef === TARGET.project && proof.evidenceReference?.trim() && proof.reviewedBy?.trim() && Number.isFinite(Date.parse(proof.verifiedAt)) && !Object.hasOwn(proof, 'rollbackProbePassed'), 'DATABASE_PROOF_REQUIRED', 'Use the explicit local-installation, hosted-application, hosted-DML-rollback and privilege evidence schema; an ambiguous rollback flag is insufficient.');
  const evidence = item => item?.passed === true && typeof item.evidenceReference === 'string' && item.evidenceReference.trim() && HASH.test(item.artifactSha256 || '');
  need(evidence(proof.localInstallationRollback) && typeof proof.localInstallationRollback.engine === 'string' && proof.localInstallationRollback.engine.trim() && Array.isArray(proof.localInstallationRollback.adaptations)
    && evidence(proof.hostedApplication) && evidence(proof.hostedDmlRollback) && evidence(proof.hostedPrivilegesAndPreservation), 'DATABASE_PROOF_REQUIRED', 'Exact migration application, hosted transaction rollback, actual hosted privileges and preserved Study contracts must be independently recorded.');
  need(proof.hostedInstallationRollback?.status === 'NOT_RUN' && typeof proof.hostedInstallationRollback.reason === 'string' && proof.hostedInstallationRollback.reason.trim()
    && proof.fullAcceptance === false, 'DATABASE_PROOF_REQUIRED', 'This restricted preview path retains the unexecuted hosted installation rollback and full-acceptance gap.');
  need(equal(proof.migrationHashes, migrationHashes), 'MIGRATION_DRIFT', 'The reviewed two migration hashes differ from the candidate files.');
  need(equal(proof.localInstallationRollback.migrationHashes, migrationHashes) && equal(proof.hostedApplication.migrationHashes, migrationHashes), 'MIGRATION_DRIFT', 'Local installation and actual hosted application must both identify the exact two migration bodies.');
}

export const CRITICAL_ASSETS = Object.freeze(['index.html','debate-room/index.html','study-room/index.html','assets/debate-room.js','assets/debate-domain.js','assets/debate-sanctions.js','assets/debate-media.js','assets/debate-dates.js','assets/debate-entry.js','assets/debate-room.css','assets/study-room-live.js','assets/study-room-live.css','assets/study-room-preview.js','assets/phase2-experience.js','assets/feature-loader.js','assets/phase2.css','assets/vendor/supabase-2.49.8.umd.js','assets/phase2-config.js',
  'assets/vendor/debate-fonts/fraunces-v38-latin-ext.woff2', 'assets/vendor/debate-fonts/fraunces-v38-latin.woff2',
  'assets/vendor/debate-fonts/inter-v20-latin-ext.woff2', 'assets/vendor/debate-fonts/inter-v20-latin.woff2']);
const RETIRED_PUBLIC_FILES = ['assets/examination-room-2-store.js','assets/examination-room-renovation.js','assets/examination-room-renovation.css','assets/examination-room-beadle-class-list-template.xlsx','assets/feature-previews/examination-room.png','content/duediligence-2026/exam-room-schema.json'];
export async function inspectArtifact(directory, root = ROOT) {
  const files = [], walk = async (dir, prefix = '') => { for (const item of await readdir(dir, { withFileTypes: true })) { const name = prefix + item.name; need(!item.isSymbolicLink(), 'ARTIFACT_PRIVATE_FILE', 'Symlinks cannot enter the staging artifact.'); if (item.isDirectory()) await walk(path.join(dir, item.name), name + '/'); else files.push(name); } }; await walk(directory);
  need(!files.some(file => /(^|\/)(?:worker|supabase|scripts|docs|content|node_modules|\.git)(\/|$)|\.(?:sql|mjs)$/i.test(file) || RETIRED_PUBLIC_FILES.includes(file)) && !files.includes('CNAME'), 'ARTIFACT_PRIVATE_FILE', 'Private source, retired runtime or a production domain entered the staging artifact.');
  // Existing public compatibility surfaces remain byte-identical to the reviewed
  // candidate. The established decommission guard owns the retired runtime list.
  for (const file of files.filter(name => name.startsWith('examination-room/'))) need((await readFile(path.join(directory, file))).equals(await readFile(path.join(root, file))), 'ARTIFACT_SOURCE_MISMATCH', `An existing compatibility surface changed: ${file}`);
  const config = await readFile(path.join(directory, 'assets/phase2-config.js'), 'utf8');
  need(config.includes(TARGET.origin) && config.includes(TARGET.project) && !/hbllomlijfznnuudpdvr|duediligence-api\.wallyesteban1993/.test(config), 'WRONG_TARGET', 'The browser configuration was not sanitized for staging.');
  const hashes = {};
  for (const file of CRITICAL_ASSETS) {
    const bytes = await readFile(path.join(directory, file)); hashes[file] = hash(bytes);
    if (!['index.html','assets/phase2-config.js'].includes(file)) {
      const sourceFile = file === 'assets/debate-domain.js' ? 'worker/debate-domain.mjs' : file === 'assets/debate-sanctions.js' ? 'worker/debate-sanctions.mjs' : file;
      let expected = await readFile(path.join(root, sourceFile));
      if (file === 'assets/debate-domain.js') expected = Buffer.from(expected.toString('utf8').replace("'./debate-sanctions.mjs'", "'./debate-sanctions.js'"));
      need(bytes.equals(expected), 'ARTIFACT_SOURCE_MISMATCH', `Staging changed the reviewed Debate, Study or recovery asset: ${file}`);
    }
  }
  const page = await readFile(path.join(directory, 'debate-room/index.html'), 'utf8');
  need(!/DEBATE_LOCAL_REHEARSAL\s*[:=]\s*true|(?:unpkg|jsdelivr).*supabase/.test(page), 'LOCAL_BYPASS_IN_ARTIFACT', 'A local auth bypass or remote Supabase SDK entered the deployable page.');
  for (const match of page.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"?#]+)[^\"]*"/g)) if (match[1].startsWith('../')) {
    const target = path.resolve(directory, 'debate-room', match[1]); need(target.startsWith(path.resolve(directory) + path.sep) && (await stat(target)).isFile(), 'ARTIFACT_DEPENDENCY_MISSING', 'A Debate page dependency is missing or traverses outside the artifact.');
  }
  return { status: 'PASS_ARTIFACT_ONLY', hashes, fileCount: files.length };
}

export async function resolveStagingPublishableKey({ configuredKey = '', fetcher = fetch } = {}) {
  if (configuredKey) { need(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(configuredKey), 'PUBLIC_CONFIG_UNAVAILABLE', 'The configured staging publishable key is invalid.'); return { key: configuredKey, source: 'existing-ci-configuration' }; }
  const response = await fetcher(TARGET.origin + '/assets/phase2-config.js', { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  need(response.ok, 'PUBLIC_CONFIG_UNAVAILABLE', 'The current audited staging browser configuration is unavailable.');
  const source = await response.text(), keys = [...new Set(source.match(/sb_publishable_[A-Za-z0-9_-]{20,}/g) || [])];
  need(source.includes(`https://${TARGET.project}.supabase.co`) && source.includes(TARGET.origin) && !/hbllomlijfznnuudpdvr|duediligence-api\.wallyesteban1993/.test(source) && keys.length === 1, 'PUBLIC_CONFIG_UNAVAILABLE', 'The current public configuration must unambiguously identify the approved staging project and key.');
  return { key: keys[0], source: 'audited-current-staging-public-config', configHash: hash(source) };
}

export async function validateSmokeSessions({ allowedToken, deniedToken, publishableKey, allowlist, fetcher = fetch }) {
  const ids = previewIds(allowlist);
  need(allowedToken && deniedToken && allowedToken !== deniedToken && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey || ''), 'SMOKE_CREDENTIAL_MISSING', 'Two distinct staging sessions and the existing staging publishable key are required.');
  const actors = await Promise.all([allowedToken, deniedToken].map(async token => {
    const response = await fetcher(`https://${TARGET.project}.supabase.co/auth/v1/user`, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const user = await response.json().catch(() => null);
    need(response.ok && UUID.test(user?.id || ''), 'SMOKE_SESSION_INVALID', 'A staging smoke session is expired, invalid or belongs to another project; no deployment is permitted.');
    return user.id.toLowerCase();
  }));
  need(ids.includes(actors[0]) && !ids.includes(actors[1]) && actors[0] !== actors[1], 'SMOKE_ACCOUNT_SCOPE_WRONG', 'The two verified accounts must respectively be inside and outside the reviewed preview list.');
  return { status: 'PASS_STAGING_SESSION_SCOPE', verifiedAccounts: 2, tokensStored: false };
}

export async function smokeStaging({ allowedToken, deniedToken, manifest, fetcher = fetch }) {
  need(allowedToken && deniedToken && allowedToken !== deniedToken, 'SMOKE_CREDENTIAL_MISSING', 'Two distinct real staging sessions are required for allowlisted and excluded-account smoke.');
  // Model a fetch from the same-origin staging page: browsers omit Origin for
  // this GET. Supplying it here would hide an incompatible Worker boundary.
  const get = async (pathname, token) => fetcher(TARGET.origin + pathname, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', Referer: TARGET.origin + '/debate-room/', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20000) });
  // Static Assets serves directory indexes at their canonical trailing-slash
  // URLs. Request those directly; retain redirect:error so neither asset nor
  // authenticated requests can silently leave the reviewed origin.
  for (const [file, digest] of Object.entries(manifest.hashes)) {
    need(CRITICAL_ASSETS.includes(file) && HASH.test(digest), 'INVALID_SMOKE_MANIFEST', 'Smoke assets must be reviewed candidate paths and SHA-256 hashes.');
    const pathname = '/' + file.replace(/(^|\/)index\.html$/, '$1');
    const response = await get(pathname);
    need(response.ok && hash(new Uint8Array(await response.arrayBuffer())) === digest, 'DEPLOYED_ASSET_MISMATCH', `Hosted candidate asset differs: ${file}`);
  }
  const access = await get('/debate-room/access'); const accessBody = await access.json(); need(access.ok && accessBody.enabled === false, 'PUBLIC_ACCESS_OPEN', 'Debate public access must remain closed.');
  const anonymous = await get('/debate-room/events'); need(anonymous.status === 401, 'AUTH_SMOKE_FAILED', 'Anonymous event access must be denied.');
  const denied = await get('/debate-room/events', deniedToken), deniedBody = await denied.json(); need(denied.status === 403 && deniedBody.error?.code === 'DEBATE_PREVIEW_RESTRICTED', 'AUTH_SMOKE_FAILED', 'A real excluded account must fail the preview allowlist.');
  const allowed = await get('/debate-room/events', allowedToken), allowedBody = await allowed.json(); need(allowed.ok && allowedBody.ok === true && Array.isArray(allowedBody.events), 'AUTH_SMOKE_FAILED', 'A real allowlisted account must reach its authorized event list.');
  return { status: 'PASS_STAGING_ASSETS_AND_AUTH_ONLY', physicalMedia: false, fullOrganizerJourney: false, endurance90Minutes: false, capacity: false, realMail: false, publicLaunch: false };
}

async function main() {
  const mode = process.argv[2]; need(['capture','prepare','postflight','smoke'].includes(mode) && process.argv.length === 3, 'INVALID_MODE', 'Use capture, prepare, postflight or smoke; there is no production or migration command.');
  const policy = await readJson(path.join(ROOT, 'worker/debate-staging-policy.json')); validatePolicy(policy);
  const base = parseBase(await readFile(path.join(ROOT, policy.baseConfig), 'utf8'));
  const output = path.join(ROOT, 'artifacts/debate-local-rehearsal/staging-release'); await mkdir(output, { recursive: true });
  if (mode === 'smoke') { const result = await smokeStaging({ allowedToken: process.env.DEBATE_STAGING_ALLOWED_BEARER, deniedToken: process.env.DEBATE_STAGING_DENIED_BEARER, manifest: await readJson(path.join(output, 'artifact.json')) }); await writeFile(path.join(output, 'smoke.json'), JSON.stringify(result, null, 2)); console.log(result.status); return; }
  const baseline = await captureRemote({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, base });
  if (mode === 'postflight') {
    await writeFile(path.join(output, 'deployed-baseline.json'), JSON.stringify(baseline, null, 2));
    validatePreservation(await readJson(path.join(output, 'predeploy-baseline.json')), baseline, { ...policy.debateVars, DEBATE_PREVIEW_ACTOR_IDS: previewIds(process.env.DEBATE_PREVIEW_ACTOR_IDS).join(',') });
    console.log('PASS_STAGING_SETTINGS_PRESERVATION; authenticated smoke remains required.'); return;
  }
  await writeFile(path.join(output, mode === 'capture' ? 'baseline.json' : 'predeploy-baseline.json'), JSON.stringify(baseline, null, 2));
  if (mode === 'capture') { console.log(JSON.stringify({ status: 'READ_ONLY_BASELINE_CAPTURED', fingerprint: baseline.fingerprint, versionId: baseline.state.versionId })); return; }
  const candidate = process.env.DEBATE_CANDIDATE_SHA;
  need(SHA.test(candidate || '') && git(['rev-parse','HEAD']) === candidate && !git(['status','--porcelain','--untracked-files=all']), 'DIRTY_OR_WRONG_CANDIDATE', 'Commit and verify the exact candidate in a clean worktree before release.');
  need(process.env.DEBATE_STAGING_ALLOWED_BEARER && process.env.DEBATE_STAGING_DENIED_BEARER, 'SMOKE_CREDENTIAL_MISSING', 'Authenticated post-deploy smoke credentials must exist before changing staging.');
  validateBaseline(baseline, base, policy, process.env.DEBATE_EXPECTED_BASELINE_SHA256, process.env.DEBATE_EXPECTED_VERSION_ID);
  const review = JSON.parse(process.env.DEBATE_RELEASE_REVIEW || '{}');
  need(SHA.test(review.baseSha || ''), 'SCOPE_REVIEW_REQUIRED', 'The reviewed base commit is missing.'); git(['merge-base','--is-ancestor',review.baseSha,candidate]);
  const suite = await readJson(path.resolve(ROOT, process.env.DEBATE_LOCAL_SUITE_REPORT || 'missing-suite-report.json'));
  const sourceHashes = {}; for (const file of Object.keys(suite.sourceHashes || {})) { need(!file.includes('..') && !path.isAbsolute(file), 'INVALID_SOURCE_MANIFEST', 'Source manifest paths must stay in the repository.'); sourceHashes[file] = hash(await readFile(path.join(ROOT, file))); }
  const migrationHashes = {}; for (const file of policy.migrations) migrationHashes[file] = hash(await readFile(path.join(ROOT, file)));
  validateEvidence({ review, suite, candidate, changedPaths: git(['diff','--name-only',review.baseSha,candidate]).split('\n').filter(Boolean), migrationHashes, sourceHashes });
  const generated = buildConfig(base, policy, process.env.DEBATE_PREVIEW_ACTOR_IDS, output);
  const sessions = await validateSmokeSessions({ allowedToken: process.env.DEBATE_STAGING_ALLOWED_BEARER, deniedToken: process.env.DEBATE_STAGING_DENIED_BEARER, publishableKey: process.env.STAGING_SUPABASE_PUBLISHABLE_KEY, allowlist: process.env.DEBATE_PREVIEW_ACTOR_IDS });
  const artifact = await inspectArtifact(path.join(ROOT, '.staging-dist'));
  await writeFile(generated.filename, generated.text);
  await writeFile(path.join(output, 'artifact.json'), JSON.stringify({ ...artifact, candidateSha: candidate }, null, 2));
  await writeFile(path.join(output, 'auth-preflight.json'), JSON.stringify(sessions, null, 2));
  await writeFile(path.join(output, 'preflight.json'), JSON.stringify({ status: 'READY_FOR_AUTHORIZED_STAGING_DEPLOY_ONLY', candidateSha: candidate, baselineFingerprint: baseline.fingerprint, previousVersionId: baseline.state.versionId, configHash: generated.hash, baseConfigHash: hash(base.source), migrationHashes, approvalReference: review.approvalReference, publicLaunch: false, authenticatedSmokePending: true }, null, 2));
  console.log('READY_FOR_AUTHORIZED_STAGING_DEPLOY_ONLY; authenticated smoke and full staging rehearsal remain required.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${error.code || 'STAGING_GATE_FAILED'}: ${error.code ? error.message : 'Release preparation failed; raw error omitted to protect credentials.'}`); process.exitCode = 1; });
