/** Fixed-target public entry release. No database, account or secret writes. */
import { readFile, writeFile, mkdir, readdir, appendFile, rm } from 'node:fs/promises';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, CRITICAL_SOURCES, CRITICAL_ASSETS, REQUIRED_SUITE_GROUPS } from './debate-staging-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'artifacts/debate-local-rehearsal/production-release');
const exec = promisify(execFile), SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TARGET = Object.freeze({ repository: 'codingwally/Bar-Exam-simulator', owner: 'codingwally',
  worker: 'duediligence-gemini-examiner', alias: 'duediligence-api', origin: 'https://duediligence.ph',
  api: 'https://duediligence-api.wallyesteban1993.workers.dev', project: 'hbllomlijfznnuudpdvr' });
export const RELEASE_FLAGS = Object.freeze({ DEBATE_ROOM_ENABLED: 'true', DEBATE_MEDIA_ENABLED: 'false',
  DEBATE_SWEEPER_ENABLED: 'false', DEBATE_APPROVED_MAX_PARTICIPANTS: '0',
  DEBATE_RESULTS_EMAIL_MODE: 'suppressed', DEBATE_INVITATION_EMAIL_MODE: 'suppressed', DEBATE_PREVIEW_ACTOR_IDS: '' });
export const MIGRATIONS = ['supabase/migrations/20260909080139_debate_room_v3.sql', 'supabase/migrations/20260909080143_study_room_admission_v3.sql'];
export const OWN_SOURCES = ['.github/workflows/debate-v3-production-preview.yml', 'scripts/debate-production-preview.mjs', 'scripts/test-debate-production-preview.mjs'];
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const equal = (a, b) => hash(a) === hash(b);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
const gitHash = (sha, file) => hash(execFileSync('git', ['show', `${sha}:${file}`], { cwd: ROOT, windowsHide: true }));
const save = async (name, value) => { await mkdir(OUTPUT, { recursive: true }); await writeFile(path.join(OUTPUT, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); };
const safeCode = error => /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.code || '') ? error.code : 'PREVIEW_OPERATION_FAILED';

export function parseProductionBase(source, alias = false) {
  const setting = key => { const entries = [...source.matchAll(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'gm'))];
    need(entries.length <= 1, 'DUPLICATE_CONFIG'); return entries.length ? JSON.parse(entries[0][1]) : undefined; };
  need(setting('name') === (alias ? TARGET.alias : TARGET.worker) && setting('main') === (alias ? 'public-api-alias.mjs' : 'maintenance-entry.mjs'), 'WRONG_PRODUCTION_TARGET');
  need(!/^\s*(?:keep_vars\s*=|\[+(?:cache|exports|limits|env)(?:[.\]\s]))/m.test(source), 'UNREVIEWED_CONFIG');
  const vars = {}, block = source.match(/^\[vars\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] || '';
  for (const raw of block.split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(".*")$/.exec(line); need(m && !Object.hasOwn(vars, m[1]), 'UNREVIEWED_VARIABLE_SYNTAX'); vars[m[1]] = JSON.parse(m[2]); }
  need(!Object.keys(vars).some(key => key.startsWith('DEBATE_')), 'PREVIEW_FLAGS_IN_SHARED_CONFIG');
  if (!alias) need(vars.ALLOWED_ORIGIN === TARGET.origin && vars.STUDY_ROOM_ENABLED === 'true' && vars.OUTBOUND_EMAIL_MODE === 'suppressed', 'PROTECTED_CONFIG_CHANGED');
  const resourceSections = [...source.matchAll(/^\[\[([a-z_]+)\]\]/gm)].map(m => m[1]);
  need(resourceSections.every(name => name === 'rules' || alias && name === 'services'), 'UNREVIEWED_RESOURCE_BINDING');
  if (alias) need(setting('binding') === 'DUE_DILIGENCE_APPLICATION' && setting('service') === TARGET.worker && resourceSections.filter(x => x === 'services').length === 1, 'ALIAS_BINDING_CHANGED');
  return { source, alias, vars, date: setting('compatibility_date'), flags: setting('compatibility_flags') || [],
    region: setting('region') || null, crons: setting('crons') || [], previewUrls: setting('preview_urls'), workersDev: setting('workers_dev') };
}

// Retain all variable values as hashes, including ordinary plaintext. Only known
// typed configuration fields are recorded; raw provider objects never leave memory.
export function sanitizeScript(raw, worker) {
  need([TARGET.worker, TARGET.alias].includes(worker), 'WRONG_PRODUCTION_TARGET');
  const deployment = raw.deployments?.deployments?.[0], active = deployment?.versions;
  need(UUID.test(deployment?.id || '') && active?.length === 1 && active[0].percentage === 100 && UUID.test(active[0].version_id)
    && raw.version?.id === active[0].version_id, 'UNSTABLE_WORKER_VERSION');
  const bindings = raw.settings?.bindings;
  need(Array.isArray(bindings) && bindings.length < 200, 'BINDINGS_UNAVAILABLE');
  const safeBindings = bindings.map(binding => {
    need(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(binding.name || ''), 'INVALID_BINDING');
    if (binding.type === 'plain_text') { need(typeof binding.text === 'string', 'INVALID_BINDING'); return { name: binding.name, type: binding.type, valueSha256: hash(binding.text) }; }
    if (binding.type === 'secret_text') return { name: binding.name, type: binding.type };
    need(worker === TARGET.alias && binding.type === 'service' && binding.name === 'DUE_DILIGENCE_APPLICATION'
      && binding.service === TARGET.worker && (!binding.environment || binding.environment === 'production') && !binding.entrypoint, 'UNREVIEWED_RESOURCE_BINDING');
    return { name: binding.name, type: binding.type, service: binding.service, environment: binding.environment || null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  need(new Set(safeBindings.map(b => b.name)).size === safeBindings.length, 'DUPLICATE_BINDING');
  const runtime = raw.version.resources?.script_runtime || {}, service = raw.service?.default_environment;
  need(service?.environment === 'production' && service.script, 'SERVICE_METADATA_UNAVAILABLE');
  for (const value of [raw.settings, runtime, service.script]) need(!Object.keys(value).some(key => /^(?:cache|exports)(?:_|$)/.test(key)), 'UNREPRESENTED_CACHE_CONFIG');
  const logs = raw.scriptSettings?.observability || raw.settings.observability;
  need(logs && typeof logs === 'object' && !Array.isArray(logs), 'OBSERVABILITY_UNAVAILABLE');
  const allowed = { enabled: 'boolean', head_sampling_rate: 'number', redact_query_string: 'boolean',
    logs: { enabled: 'boolean', head_sampling_rate: 'number', persist: 'boolean', invocation_logs: 'boolean' },
    traces: { enabled: 'boolean', head_sampling_rate: 'number', persist: 'boolean' } };
  const typed = (value, shape) => { need(value && typeof value === 'object' && !Array.isArray(value), 'UNREPRESENTED_OBSERVABILITY');
    for (const [key, item] of Object.entries(value)) { need(Object.hasOwn(shape, key), 'UNREPRESENTED_OBSERVABILITY');
      if (typeof shape[key] === 'object') typed(item, shape[key]); else need(typeof item === shape[key] && (typeof item !== 'number' || Number.isFinite(item) && item >= 0 && item <= 1), 'UNREPRESENTED_OBSERVABILITY'); } };
  typed(logs, allowed);
  const placement = service.script.placement;
  const region = placement?.mode === 'targeted' && placement.target?.length === 1 && placement.target[0]?.region;
  need(placement == null || region === 'gcp:us-east4', 'UNREPRESENTED_PLACEMENT');
  const logpush = raw.scriptSettings?.logpush ?? raw.settings.logpush ?? false;
  const tail = raw.scriptSettings?.tail_consumers || raw.settings.tail_consumers || [];
  const limits = runtime.limits || raw.settings.limits || {};
  need(logpush === false && Array.isArray(tail) && tail.length === 0 && Object.keys(limits).length === 0, 'UNREPRESENTED_RUNTIME_SETTING');
  need(!runtime.assets && !service.script.has_assets, 'UNEXPECTED_PRODUCTION_ASSETS');
  need(typeof raw.subdomain?.enabled === 'boolean' && typeof raw.subdomain.previews_enabled === 'boolean', 'ROUTES_UNAVAILABLE');
  const crons = (raw.schedules?.schedules || raw.schedules || []).map(x => typeof x === 'string' ? x : x.cron);
  need(crons.every(x => typeof x === 'string' && /^[\d*/ ,\-]+$/.test(x)), 'INVALID_SCHEDULE');
  return { worker, deploymentId: deployment.id, versionId: raw.version.id, bindings: safeBindings,
    date: raw.settings.compatibility_date || runtime.compatibility_date, flags: [...(raw.settings.compatibility_flags || runtime.compatibility_flags || [])].sort(),
    region: region || null, placementSha256: hash({ settings: raw.settings.placement || null, runtime: runtime.placement || null, service: placement || null }),
    observability: logs, logpush, tailConsumers: [], limits: {}, usageModel: runtime.usage_model || raw.settings.usage_model || null,
    workersDev: raw.subdomain.enabled, previewUrls: raw.subdomain.previews_enabled, crons: [...crons].sort(),
    // Settings metadata does not include deploy timestamps. Retain non-secret
    // tags/annotations only as digests and refuse their loss on readback.
    annotationsSha256: hash(raw.settings.annotations || null), tagsSha256: hash(raw.settings.tags || null) };
}

export function validateBaseAgainstRemote(base, state) {
  const priorProductionCrons=['*/2 * * * *'], currentProductionCrons=['*/2 * * * *','* * * * *'].sort();
  const schedulesMatch=base.alias ? base.crons.length === 0 && state.crons.length === 0 :
    equal([...base.crons].sort(),currentProductionCrons) &&
      (equal(state.crons,priorProductionCrons) || equal(state.crons,currentProductionCrons));
  need(state.worker === (base.alias ? TARGET.alias : TARGET.worker) && state.date === base.date
    && equal(state.flags, [...base.flags].sort()) && state.region === base.region && schedulesMatch
    && state.previewUrls === base.previewUrls && (base.workersDev == null || base.workersDev === state.workersDev), 'BASELINE_CONFIG_DRIFT');
  for (const [name, value] of Object.entries(base.vars)) need(state.bindings.some(b => b.name === name && b.type === 'plain_text' && b.valueSha256 === hash(value)), 'BASELINE_VARIABLE_DRIFT');
  if (!base.alias) for (const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','MAINTENANCE_SIGNING_KEY'])
    need(state.bindings.some(b => b.name === name && ['secret_text','plain_text'].includes(b.type)), 'EXISTING_SECRET_REQUIRED');
  need(!state.bindings.some(b => b.name.startsWith('DEBATE_') && !Object.hasOwn(RELEASE_FLAGS, b.name)), 'UNREVIEWED_DEBATE_BINDING');
  return true;
}
export function buildProductionConfig(base, state, root = ROOT) {
  validateBaseAgainstRemote(base, state);
  const additions = base.alias ? {} : { ...RELEASE_FLAGS };
  let source = base.source.replace(/^main\s*=.*$/m, `main = ${JSON.stringify(path.join(root, 'worker', base.alias ? 'public-api-alias.mjs' : 'maintenance-entry.mjs').replaceAll('\\', '/'))}`);
  source = 'keep_vars = true\n' + source;
  if (base.workersDev == null) source = `workers_dev = ${state.workersDev}\n` + source;
  if (!base.alias) source = source.replace(/^\[vars\]\s*$/m, '[vars]\n' + Object.entries(additions).map(([key,value]) => `${key} = ${JSON.stringify(value)}`).join('\n'));
  // This release does not activate the pending minute sweeper schedule. Preserve
  // either reviewed live baseline exactly, independently of the shared TOML.
  if (!base.alias) source=source.replace(/^crons\s*=.*$/m,`crons = ${JSON.stringify(state.crons)}`);
  const blocks = [...source.matchAll(/^\[observability\]\s*\r?\n[\s\S]*?(?=^\[(?!observability[.\]])|$(?![\s\S]))/gm)];
  need(blocks.length === 1, 'OBSERVABILITY_CONFIG_CHANGED');
  const table = (object, section) => `[${section}]\n` + Object.entries(object).filter(([,v]) => typeof v !== 'object').map(([key,value]) => `${key} = ${JSON.stringify(value)}`).join('\n') + '\n\n'
    + Object.entries(object).filter(([,v]) => typeof v === 'object').map(([key,value]) => table(value, `${section}.${key}`)).join('');
  source = source.replace(blocks[0][0], table(state.observability, 'observability'));
  return { source, additions, sha256: hash(source) };
}
export function validatePreservation(before, after, additions = {}) {
  const expected = structuredClone(before), actual = structuredClone(after);
  for (const value of [expected, actual]) { delete value.versionId; delete value.deploymentId; }
  for (const [name, value] of Object.entries(additions)) {
    const previous = expected.bindings.find(b => b.name === name);
    need(!previous || previous.type === 'plain_text', 'PREVIEW_BINDING_TYPE_CHANGED');
    expected.bindings = expected.bindings.filter(b => b.name !== name);
    expected.bindings.push({ name, type: 'plain_text', valueSha256: hash(value) });
  }
  expected.bindings.sort((a,b) => a.name.localeCompare(b.name));
  need(equal(expected, actual), 'PRODUCTION_PRESERVATION_FAILED'); return true;
}

export function validateDatabaseProof(proof, migrationHashes) {
  need(proof?.schemaVersion === 1 && proof.projectRef === TARGET.project && typeof proof.reviewedBy === 'string' && proof.reviewedBy.trim()
    && HASH.test(proof.evidenceSha256 || '') && typeof proof.evidenceReference === 'string' && proof.evidenceReference.trim()
    && Number.isFinite(Date.parse(proof.verifiedAt)) && equal(proof.migrationHashes, migrationHashes), 'PRODUCTION_DATABASE_PROOF_REQUIRED');
  for (const flag of ['exactApplicationVerified','dmlRollbackVerified','privilegesVerified','studyPreserved']) need(proof[flag] === true, 'PRODUCTION_DATABASE_PROOF_REQUIRED');
  need(proof.fullAcceptance === false, 'PRODUCTION_DATABASE_PROOF_REQUIRED');
}
export function validateStorageEvidence(proof) {
  need(proof?.projectRef === TARGET.project && proof.bucket === 'debate-private-v3' && HASH.test(proof.evidenceSha256 || '')
    && proof.evidenceReference?.trim(), 'STORAGE_EVIDENCE_REQUIRED');
  need(proof.verifiedPrivate === true && proof.status === 'VERIFIED', 'STORAGE_EVIDENCE_REQUIRED');
  return { status:proof.status, verifiedPrivate:proof.verifiedPrivate, evidenceSha256:proof.evidenceSha256,
    evidenceReference:proof.evidenceReference, projectRef:TARGET.project, bucket:proof.bucket, storageApiUploadDownloadVerified:false };
}
export function validateExternalDatabaseRecord(record, proof) {
  need(record?.projectRef === TARGET.project && record.fullAcceptance === false && record.exactStoredMigrationSqlMatchesReviewedSources === true,
    'EXTERNAL_DATABASE_RECORD_MISMATCH');
  for (const flag of ['exactApplicationVerified','dmlRollbackVerified','privilegesVerified','studyPreserved'])
    need(record[flag] === true && record[flag] === proof[flag], 'EXTERNAL_DATABASE_RECORD_MISMATCH');
  need(equal(Object.fromEntries((record.applicationRecords || []).map(item=>[item.path,item.sha256])),proof.migrationHashes), 'EXTERNAL_DATABASE_RECORD_MISMATCH');
}
export function validateExternalStorageRecord(record) {
  const bucket=record?.storage?.independentReadback;
  need(record?.projectRef === TARGET.project && record.storage.configurationVerified === true && bucket?.length === 1
    && bucket[0].id === 'debate-private-v3' && bucket[0].public === false && bucket[0].file_size_limit === 10485760
    && equal([...(bucket[0].allowed_mime_types || [])].sort(),['application/pdf','image/jpeg','image/png','text/csv']), 'EXTERNAL_STORAGE_RECORD_MISMATCH');
}
export function validateSerializedMetadata(metadata, base, state, additions) {
  need(metadata.compatibility_date === base.date && equal(metadata.compatibility_flags || [],base.flags)
    && equal(metadata.observability,state.observability), 'SERIALIZED_CONFIG_DRIFT');
  need(equal([...(metadata.keep_bindings || [])].sort(),['json','plain_text','secret_key','secret_text']), 'SERIALIZED_KEEP_BINDINGS_MISSING');
  need(!['cache','cache_options','exports','limits'].some(key => Object.hasOwn(metadata,key)), 'SERIALIZED_UNAPPROVED_SETTING');
  need(state.region ? equal(metadata.placement,{mode:'targeted',region:state.region}) : metadata.placement == null, 'SERIALIZED_PLACEMENT_DRIFT');
  const expected = Object.entries({...base.vars,...additions}).map(([name,text]) => ({name,type:'plain_text',text}));
  if (base.alias) {
    const actual = (metadata.bindings || []).filter(b => b.type === 'service');
    need(actual.length === 1 && actual[0].name === 'DUE_DILIGENCE_APPLICATION' && actual[0].service === TARGET.worker
      && (!actual[0].environment || actual[0].environment === 'production') && !actual[0].entrypoint, 'SERIALIZED_ALIAS_CHANGED');
  }
  const actualVars = (metadata.bindings || []).filter(b => b.type === 'plain_text').sort((a,b)=>a.name.localeCompare(b.name));
  need(equal(actualVars,expected.sort((a,b)=>a.name.localeCompare(b.name))), 'SERIALIZED_VARIABLE_DRIFT');
  need((metadata.bindings || []).every(b => b.type === 'plain_text' || base.alias && b.type === 'service'), 'SERIALIZED_RESOURCE_CHANGED');
  return true;
}
export function validateRun(run, type, candidate) {
  need(run?.repository?.full_name === TARGET.repository && run.head_repository?.full_name === TARGET.repository
    && run.status === 'completed' && run.conclusion === 'success', 'UNTRUSTED_EVIDENCE_RUN');
  if (type === 'staging') need(run.path === '.github/workflows/debate-v3-staging.yml' && run.event === 'workflow_dispatch'
    && run.head_sha === candidate && run.head_branch === 'main' && run.actor?.login === TARGET.owner && run.triggering_actor?.login === TARGET.owner, 'UNTRUSTED_STAGING_RUN');
  else need(run.path === '.github/workflows/debate-v3-validation.yml' && run.event === 'pull_request'
    && SHA.test(run.head_sha || ''), 'UNTRUSTED_CI_RUN');
  return true;
}
export function validateStagingDriver(driver, candidate) {
  need(driver?.sourceSha === candidate && driver.mode === 'deploy' && driver.status === 'PASS_STAGING_ASSETS_AND_AUTH_ONLY'
    && driver.target?.worker === 'duediligence-examinations-staging' && driver.target?.project === 'hlzqmreeoghbldnhlybr'
    && driver.deploymentState === 'VERSION_AND_PRESERVATION_VERIFIED' && UUID.test(driver.deployedVersionId || '')
    && HASH.test(driver.deployedFingerprint || '') && driver.authenticatedAccounts === 2
    && driver.cleanup === 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED'
    && driver.credentialsStored === false, 'EXACT_STAGING_AUTH_AND_ASSETS_REQUIRED');
  need(['prepare','deploy','postflight','smoke'].every(label => driver.steps?.filter(s => s.label === label && s.status === 'PASS' && s.exitCode === 0).length === 1), 'EXACT_STAGING_AUTH_AND_ASSETS_REQUIRED');
}
export function validateSuite(suite, sourceHash) {
  need(suite.status === 'PASS_LOCAL_SUITE' && suite.gitStatus === '' && suite.changedDuringRun?.length === 0
    && REQUIRED_SUITE_GROUPS.every(name => suite.groups?.filter(g => g.name === name && g.status === 'PASS' && g.exitCode === 0).length === 1), 'EXACT_CI_SUITE_REQUIRED');
  need([...CRITICAL_SOURCES, ...OWN_SOURCES].every(file => HASH.test(suite.sourceHashes?.[file] || '')), 'CI_SOURCE_MANIFEST_INCOMPLETE');
  for (const [file, digest] of Object.entries(suite.sourceHashes)) {
    need(/^[a-zA-Z0-9_.\/-]+$/.test(file) && !file.split('/').includes('..') && !path.isAbsolute(file) && HASH.test(digest), 'INVALID_CI_SOURCE_PATH');
    need(sourceHash(file) === digest, 'CI_SOURCE_DRIFT');
  }
}

async function requestJson(url, token, fetcher = fetch) {
  const response = await fetcher(url, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => null);
  need(response.ok && body, 'PROVIDER_READ_FAILED'); return body;
}
const gh = route => requestJson(`https://api.github.com/repos/${TARGET.repository}/${route}`, process.env.GH_TOKEN);
export async function captureProduction({ token, accountId, fetcher = fetch }) {
  need(token && /^[a-f0-9]{32}$/i.test(accountId || ''), 'EXISTING_CI_CREDENTIALS_REQUIRED');
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const get = async suffix => { const body = await requestJson(prefix + suffix, token, fetcher); need(body.success === true && body.result != null, 'CLOUDFLARE_READ_FAILED'); return body.result; };
  const result = {};
  for (const worker of [TARGET.worker, TARGET.alias]) {
    const script = '/scripts/' + worker, deployments = await get(script + '/deployments');
    const versionId = deployments?.deployments?.[0]?.versions?.[0]?.version_id; need(UUID.test(versionId || ''), 'WORKER_VERSION_UNAVAILABLE');
    const [settings, scriptSettings, version, schedules, subdomain, service] = await Promise.all([
      get(script + '/settings'), get(script + '/script-settings'), get(script + '/versions/' + versionId),
      get(script + '/schedules'), get(script + '/subdomain'), get('/services/' + worker)]);
    need(equal(deployments.deployments[0], (await get(script + '/deployments')).deployments?.[0]), 'CAPTURE_VERSION_CHANGED');
    result[worker] = sanitizeScript({ deployments, settings, scriptSettings, version, schedules, subdomain, service }, worker);
  }
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), projectRef: TARGET.project,
    scripts: result, fingerprint: hash(result), secretValuesStored: false };
}
async function currentPages(expected) {
  const deployments = await gh('deployments?environment=github-pages&per_page=100');
  let authoritative;
  for (const deployment of deployments) {
    const status = (await gh(`deployments/${deployment.id}/statuses?per_page=1`))[0], state = status?.state;
    if (['inactive','failure','error'].includes(state)) continue;
    // Only this release's pending GitHub environment record is non-authoritative.
    const ownRun = `https://github.com/${TARGET.repository}/actions/runs/${process.env.GITHUB_RUN_ID}/`;
    if (deployment.sha === process.env.DEBATE_PREVIEW_CANDIDATE && ['queued','pending','in_progress'].includes(state)
      && [status?.log_url, status?.target_url].some(url => typeof url === 'string' && url.startsWith(ownRun))
      && expected !== deployment.sha) continue;
    authoritative = { sha: deployment.sha, state, id: deployment.id }; break;
  }
  need(authoritative?.sha === expected && authoritative.state === 'success', 'PAGES_BASELINE_CHANGED'); return authoritative;
}
async function trustedCandidate() {
  const env = process.env, candidate = env.DEBATE_PREVIEW_CANDIDATE;
  need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === TARGET.repository && env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_ACTOR === TARGET.owner && env.GITHUB_TRIGGERING_ACTOR === TARGET.owner
    && SHA.test(candidate || '') && env.GITHUB_SHA === candidate && git('rev-parse','HEAD') === candidate, 'EXACT_OWNER_MAIN_REQUIRED');
  need((await gh('git/ref/heads/main')).object?.sha === candidate, 'MAIN_CHANGED'); return candidate;
}
async function findReceipt(directory, predicate) {
  const matches = [];
  const walk = async folder => { for (const entry of await readdir(folder, { withFileTypes: true })) {
    need(!entry.isSymbolicLink(), 'EVIDENCE_SYMLINK'); const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(file); else if (entry.isFile() && file.endsWith('.json')) {
      const bytes = await readFile(file); let value; try { value = JSON.parse(bytes); } catch { continue; }
      if (predicate(value, hash(bytes))) matches.push({ file, value, sha256: hash(bytes) });
    }
  } }; await walk(directory); need(matches.length === 1, 'EVIDENCE_RECEIPT_NOT_UNIQUE'); return matches[0];
}
async function reviewGates(review, candidate, resolveArtifacts = false) {
  need(review?.schemaVersion === 1 && review.approvalReference?.trim() && review.publicLaunch === true && review.fullAcceptance === false
    && review.accessPolicy === 'all-signed-in-paid-and-unpaid' && review.unverifiedCapabilitiesAcknowledged === true
    && SHA.test(review.expectedPagesSha || '') && HASH.test(review.baselineSha256 || '') && HASH.test(review.stagingDriverSha256 || '')
    && /^[1-9][0-9]{5,18}$/.test(review.ciRunId || '') && /^[1-9][0-9]{5,18}$/.test(review.stagingRunId || ''), 'REVIEW_REQUIRED');
  const migrationHashes = Object.fromEntries(MIGRATIONS.map(file => [file, gitHash(candidate, file)]));
  validateDatabaseProof(review.databaseProof, migrationHashes);
  const externalRecord = proof => {
    need(/^docs\/debate-room-v3\/evidence\/production-[a-z0-9-]+\.json$/.test(proof?.evidenceReference || ''), 'EXTERNAL_PROOF_PATH_INVALID');
    const bytes=execFileSync('git',['show',`${candidate}:${proof.evidenceReference}`],{cwd:ROOT,windowsHide:true});
    need(hash(bytes)===proof.evidenceSha256,'EXTERNAL_PROOF_DIGEST_MISMATCH');return JSON.parse(bytes);
  };
  validateExternalDatabaseRecord(externalRecord(review.databaseProof),review.databaseProof);
  validateStorageEvidence(review.storageProof); validateExternalStorageRecord(externalRecord(review.storageProof));
  for (const flag of ['studyPreserved','recoveryPreserved','pricingPreserved','superiorTaskClear']) need(review[flag] === true, 'PRESERVATION_REVIEW_REQUIRED');
  const changes = git('diff','--name-only',review.expectedPagesSha,candidate).split('\n').filter(Boolean).sort();
  need(Array.isArray(review.approvedPaths) && equal([...review.approvedPaths].sort(), changes), 'EXACT_REVIEWED_SCOPE_REQUIRED');
  const [ci, staging] = await Promise.all([gh(`actions/runs/${review.ciRunId}`), gh(`actions/runs/${review.stagingRunId}`)]);
  validateRun(ci, 'ci', candidate); validateRun(staging, 'staging', candidate);
  // Resolve the merged PR even when GitHub's completed run omits pull_requests.
  const prs = (await gh(`commits/${ci.head_sha}/pulls`)).filter(pr => pr.head?.sha === ci.head_sha && pr.base?.ref === 'main' && pr.head?.repo?.full_name === TARGET.repository);
  need(prs.length === 1, 'CI_PR_UNRESOLVED'); const pr = await gh(`pulls/${prs[0].number}`);
  need(pr.merged === true && pr.head.sha === ci.head_sha && pr.base.repo.full_name === TARGET.repository, 'CI_PR_NOT_MERGED');
  need((await gh(`git/commits/${ci.head_sha}`)).tree?.sha === git('rev-parse',`${candidate}^{tree}`), 'CI_TREE_MISMATCH');
  if (!resolveArtifacts) return { ci, staging };
  const suite = await findReceipt(path.join(OUTPUT, 'ci'), value => value.status === 'PASS_LOCAL_SUITE');
  need(SHA.test(suite.value.head || '') && (await gh(`git/commits/${suite.value.head}`)).tree?.sha === git('rev-parse',`${candidate}^{tree}`), 'CI_CHECKOUT_TREE_MISMATCH');
  validateSuite(suite.value, file => gitHash(candidate, file));
  const driver = await findReceipt(path.join(OUTPUT, 'staging'), (value, digest) => digest === review.stagingDriverSha256);
  validateStagingDriver(driver.value, candidate);
  return { ciRunId: review.ciRunId, stagingRunId: review.stagingRunId, suiteSha256: suite.sha256, stagingDriverSha256: driver.sha256, sourceCount: Object.keys(suite.value.sourceHashes).length };
}
async function scopedChild(label, args, env) {
  try { const result = await exec(process.execPath, args, { cwd: path.join(ROOT,'worker'), env, windowsHide: true, timeout: 12 * 60000, maxBuffer: 4 * 1024 * 1024 });
    return { label, status: 'PASS', stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr), rawOutputStored: false };
  } catch (error) { return { label, status: 'FAIL', exitCode: Number.isInteger(error.code) ? error.code : null,
    stdoutSha256: hash(error.stdout || ''), stderrSha256: hash(error.stderr || ''), rawOutputStored: false, outcomeUnconfirmed: true }; }
}
async function signedOutSmoke() {
  const records = [];
  for (const api of [TARGET.api, `https://${TARGET.worker}.wallyesteban1993.workers.dev`]) {
    for (const [route, method, expected] of [['/debate-room/access','GET',200], ['/debate-room/events','GET',401], ['/plans','POST',200], ['/admin/pricing/query','POST',401]]) {
      const response = await fetch(api + route, { method, redirect: 'error', cache: 'no-store', headers: { Origin: TARGET.origin, ...(method === 'POST' ? { 'Content-Type':'application/json' } : {}) }, ...(method === 'POST' ? { body:'{}' } : {}), signal: AbortSignal.timeout(20000) });
      const value = await response.json().catch(() => null);
      need(response.status === expected || route === '/admin/pricing/query' && response.status === 403, 'PRODUCTION_BOUNDARY_FAILED');
      if (route.endsWith('/access')) need(value?.enabled === true && value.signInRequired === true, 'PUBLIC_ENTRY_NOT_ENABLED');
      if (route === '/plans') need(value?.ok === true && Array.isArray(value.plans) && UUID.test(value.revisionId || ''), 'PRICING_SMOKE_FAILED');
      records.push({ api, route, status: response.status });
    }
  } return records;
}
async function runOperation(mode) {
  need(['capture','provenance','prepare','deploy','pages-gate','verify-pages'].includes(mode), 'INVALID_OPERATION');
  const candidate = await trustedCandidate(), review = JSON.parse(process.env.DEBATE_PREVIEW_REVIEW || '{}');
  const capture = () => captureProduction({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID });
  if (mode === 'capture') { const baseline = await capture(); await save('baseline.json', baseline); console.log(JSON.stringify({ status:'PASS_READ_ONLY_CAPTURE', fingerprint:baseline.fingerprint })); return; }
  if (mode === 'provenance') { await reviewGates(review, candidate); await appendFile(process.env.GITHUB_OUTPUT, `ci_run_id=${review.ciRunId}\nstaging_run_id=${review.stagingRunId}\n`); return; }
  if (mode === 'pages-gate') { const receipt = await json(path.join(OUTPUT,'release.json')); need(receipt.candidate === candidate && receipt.status === 'PASS_PUBLIC_WORKER_BOUNDARIES', 'WORKER_GATE_REQUIRED');
    await currentPages(review.expectedPagesSha); need((await capture()).fingerprint===receipt.production?.fingerprint,'WORKER_CHANGED_BEFORE_PAGES'); return; }
  if (mode === 'verify-pages') {
    const assets = [...new Set([...CRITICAL_ASSETS, 'service-worker.js','admin/index.html','assets/pricing-renderer.js','assets/pricing-renderer.css','assets/pricing-checkout-safety.js','assets/vendor/591.supabase.js'])];
    let lastCode = 'PAGES_ASSETS_UNVERIFIED', observations;
    for (let attempt = 0; attempt < 24; attempt++) { try {
      await currentPages(candidate); observations = [];
      for (const file of ['.well-known/duediligence-release.txt', ...assets]) {
        const response = await fetch(`${TARGET.origin}/${file.replace(/index\.html$/, '')}?release=${candidate}`, { redirect:'error', cache:'no-store', signal:AbortSignal.timeout(20000) });
        need(response.ok, 'LIVE_ASSET_UNAVAILABLE'); const bytes = Buffer.from(await response.arrayBuffer());
        need(hash(bytes) === hash(await readFile(path.join(ROOT,'.pages-dist',file))), 'LIVE_ASSET_HASH_MISMATCH'); observations.push({ file, sha256:hash(bytes) });
      } break;
    } catch (error) { lastCode = safeCode(error); if (attempt === 23) throw Object.assign(new Error(lastCode),{code:lastCode}); await new Promise(resolve => setTimeout(resolve,5000)); } }
    await save('pages-verification.json',{ status:'PASS_PUBLIC_ENTRY_ASSETS', candidate, observations, authenticatedPaidUnpaidJourney:'NOT_RUN', physicalMedia:false, fullAcceptance:false, publicLaunch:true }); return;
  }
  const evidence = await reviewGates(review,candidate,true), baseline = await capture();
  need(baseline.fingerprint === review.baselineSha256 && baseline.scripts[TARGET.worker].versionId === review.workerVersionId
    && baseline.scripts[TARGET.alias].versionId === review.aliasVersionId, 'REVIEWED_BASELINE_CHANGED');
  const base = parseProductionBase(await readFile(path.join(ROOT,'worker/wrangler.toml'),'utf8'));
  const alias = parseProductionBase(await readFile(path.join(ROOT,'worker/wrangler.public-api.toml'),'utf8'),true);
  const configs = [base,alias].map(b => buildProductionConfig(b,baseline.scripts[b.alias ? TARGET.alias : TARGET.worker]));
  const storage = validateStorageEvidence(review.storageProof);
  await currentPages(review.expectedPagesSha); await save('predeploy-baseline.json',baseline);
  const receipt = { schemaVersion:1, candidate, startedAt:new Date().toISOString(), status:'PASS_PREPARATION_ONLY', evidence, storage,
    baselineFingerprint:baseline.fingerprint, steps:[], databaseProofSha256:hash(review.databaseProof), approvalReference:review.approvalReference,
    publicLaunchAuthorized:true, publicLaunch:false, accessPolicy:'all-signed-in-paid-and-unpaid', fullAcceptance:false, authenticatedPaidUnpaidJourney:'NOT_RUN',
    unverifiedCapabilities:['complete hosted rehearsal','physical media','capacity and provider budget','real mail'], secretValuesStored:false };
  await save('release.json',receipt);
  const tooling = path.join(ROOT,'artifacts/debate-local-rehearsal/production-tooling/node_modules/wrangler');
  need((await json(path.join(tooling,'package.json'))).version === '4.114.0', 'PINNED_WRANGLER_REQUIRED');
  const wrapper = path.join(tooling,'bin/wrangler.js'), childEnv = { PATH:process.env.PATH, HOME:process.env.HOME,
    CI:'true', WRANGLER_SEND_METRICS:'false', CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID:process.env.CLOUDFLARE_ACCOUNT_ID };
  const filenames = configs.map((_,index) => path.join(process.env.RUNNER_TEMP,`debate-preview-${index}.toml`));
  const multipartFiles = filenames.map(file => file + '.multipart');
  try {
    for (let index=0;index<configs.length;index++) await writeFile(filenames[index],configs[index].source,{mode:0o600,flag:'wx'});
    for (let index=0;index<configs.length;index++) {
      const dry = await scopedChild('dry-run-'+index,[wrapper,'deploy','--dry-run','--keep-vars','--config',filenames[index],'--outfile',multipartFiles[index]],childEnv);
      receipt.steps.push(dry); await save('release.json',receipt); need(dry.status === 'PASS','WRANGLER_DRY_RUN_FAILED');
      const bytes = await readFile(multipartFiles[index]), boundary = /^--([A-Za-z0-9_-]{16,100})\r\n/.exec(bytes.subarray(0,150).toString())?.[1];
      need(boundary,'UPLOAD_METADATA_UNAVAILABLE');
      const form = await new Response(bytes,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData();
      need(form.getAll('metadata').length === 1,'UPLOAD_METADATA_UNAVAILABLE'); const part=form.get('metadata');
      const metadata=JSON.parse(typeof part === 'string' ? part : await part.text());
      validateSerializedMetadata(metadata,index === 0 ? base : alias,baseline.scripts[index === 0 ? TARGET.worker : TARGET.alias],configs[index].additions);
      receipt.steps.push({label:'actual-upload-metadata-'+index,status:'PASS',metadataSha256:hash(metadata),rawMetadataStored:false}); await save('release.json',receipt);
    }
    if (mode === 'prepare') return;
    await trustedCandidate(); await currentPages(review.expectedPagesSha);
    need((await capture()).fingerprint === baseline.fingerprint,'BASELINE_CHANGED_BEFORE_DEPLOY');
    for (let index=0;index<configs.length;index++) {
      receipt.status = 'DEPLOY_REQUESTED_OUTCOME_UNCONFIRMED'; await save('release.json',receipt);
      const step = await scopedChild('deploy-'+index,[wrapper,'deploy','--keep-vars','--config',filenames[index]],childEnv);
      receipt.steps.push(step); await save('release.json',receipt); need(step.status === 'PASS','WORKER_DEPLOYMENT_UNCONFIRMED');
      const current = await capture(), key = index === 0 ? TARGET.worker : TARGET.alias;
      validatePreservation(baseline.scripts[key], current.scripts[key], configs[index].additions);
      if (index === 0) need(equal(current.scripts[TARGET.alias],baseline.scripts[TARGET.alias]),'ALIAS_CHANGED_DURING_RELEASE');
      await save('deployed-baseline.json',current);
    }
    const current = await capture();
    validatePreservation(baseline.scripts[TARGET.worker],current.scripts[TARGET.worker],configs[0].additions);
    validatePreservation(baseline.scripts[TARGET.alias],current.scripts[TARGET.alias]);
    receipt.production = current; receipt.boundaries = await signedOutSmoke(); receipt.status='PASS_PUBLIC_WORKER_BOUNDARIES'; receipt.publicApiAccessEnabled=true;
    receipt.completedAt=new Date().toISOString(); await save('release.json',receipt);
  } catch(error) { receipt.status='FAIL_PUBLIC_ENTRY_RELEASE'; receipt.failureCode=safeCode(error); await save('release.json',receipt); throw error; }
  finally { for (const file of [...filenames,...multipartFiles]) await rm(file,{force:true}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runOperation(process.argv[2]).catch(error => {
  console.error(safeCode(error)); process.exitCode=1;
});
