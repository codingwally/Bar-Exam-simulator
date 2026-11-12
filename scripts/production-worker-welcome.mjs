import { randomBytes, createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[a-f0-9]{32}$/i.test(account || '')) throw new Error('Existing Cloudflare production credentials are unavailable.');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/duediligence-gemini-examiner`;
const hash = value => createHash('sha256').update(value).digest('hex');
async function api(path, options = {}) {
  const response = await fetch(base + path, { ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Cloudflare ${options.method || 'GET'} ${path} HTTP ${response.status}; codes: ${(body.errors || []).map(x => x.code).join(',')}`);
  }
  return response;
}
async function json(path, options) {
  const body = await (await api(path, options)).json();
  if (!body.success) throw new Error('Cloudflare operation did not succeed');
  return body.result;
}
async function active() {
  const deployment = (await json('/deployments')).deployments[0];
  if (deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) throw new Error('Refusing to alter a split deployment.');
  return deployment.versions[0].version_id;
}
async function deploy(versionId, message) {
  await json('/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }], annotations: { 'workers/message': message } }) });
}
// Preserve raw module bytes, including the PNG, instead of decoding multipart fields as UTF-8.
function modules(bytes, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw new Error('Multipart bundle unavailable');
  const marker = Buffer.from('--' + (boundary[1] || boundary[2]).trim());
  const result = [];
  let position = bytes.indexOf(marker);
  while (position >= 0) {
    position += marker.length;
    if (bytes.subarray(position, position + 2).toString() === '--') break;
    if (bytes.subarray(position, position + 2).toString() !== '\r\n') throw new Error('Invalid multipart boundary');
    const headerEnd = bytes.indexOf('\r\n\r\n', position + 2);
    const next = bytes.indexOf(Buffer.concat([Buffer.from('\r\n'), marker]), headerEnd + 4);
    if (headerEnd < 0 || next < 0) throw new Error('Invalid multipart bundle');
    const headers = bytes.subarray(position + 2, headerEnd).toString();
    const nameMatch = /\bname=(?:"([^"]+)"|([^;\r\n]+))/.exec(headers);
    const name = nameMatch?.[1] || nameMatch?.[2]?.trim();
    const type = /^Content-Type:\s*([^\r\n]+)/im.exec(headers)?.[1] || (name?.endsWith('.js') ? 'application/javascript+module' : 'application/octet-stream');
    if (!name || !type) throw new Error('Module name or content type missing');
    result.push({ name, type, bytes: bytes.subarray(headerEnd + 4, next) });
    position = next + 2;
  }
  return result;
}
const originalVersion = await active();
const settings = await json('/settings');
if (!settings.bindings.some(b => b.name === 'RESEND_API_KEY' && b.type === 'secret_text')) throw new Error('Existing Resend secret missing');
if (settings.bindings.some(b => !['plain_text', 'secret_text', 'json'].includes(b.type))) throw new Error('Unreviewed resource bindings');
const originalSettingsHash = hash(JSON.stringify(settings));
const source = await api('');
let main = source.headers.get('cf-entrypoint');
let downloaded = modules(Buffer.from(await source.arrayBuffer()), source.headers.get('content-type') || '');
// Cloudflare's script download returns the latest uploaded bundle, even after
// traffic is restored to an older version. Strip only our own inactive wrapper,
// and require the exact original version and captured module hashes.
if (main === 'authorized-welcome-test-entry.mjs') {
  const baseline = {
    'maintenance-entry.js': '8d427ebeaac24df3ef4637b3030e875ce287dcb71727fb7bd77de5ae66d9583f',
    './8e867ae37cbf46a42986c8731bce699464545fd8-bpi-instapay-149.png': '00df8567b0068b980d2135bcc74dd2963e8398ae472209e9c84f89f6b0f3c1b9',
  };
  if (originalVersion !== 'c276a6aa-69da-439d-bf25-426bdc9780a9') throw new Error('Original production version changed');
  downloaded = downloaded.filter(m => !['authorized-welcome-test-entry.mjs', 'authorized-welcome-test-helper.mjs'].includes(m.name));
  if (downloaded.length !== 2 || downloaded.some(m => hash(m.bytes) !== baseline[m.name])) throw new Error('Original module bytes differ');
  main = 'maintenance-entry.js';
}
if (!main || !downloaded.some(m => m.name === main) || !/^[\w.-]+\.js$/.test(main)) throw new Error('Module entrypoint unavailable');
const authorization = 'Bearer ' + randomBytes(32).toString('hex');
console.log('::add-mask::' + authorization);
const requestKey = process.env.GITHUB_RUN_ID;
if (!/^\d+$/.test(requestKey || '')) throw new Error('Workflow run ID required');
const configuration = { tokenHash: hash(authorization), expiresAt: Date.now() + 8 * 60 * 1000, requestKey };
const wrapperName = 'authorized-welcome-test-entry.mjs';
const helperName = 'authorized-welcome-test-helper.mjs';
if (downloaded.some(m => [wrapperName, helperName].includes(m.name))) throw new Error('A prior test version is already active');
const upload = new FormData();
for (const module of downloaded) upload.set(module.name, new Blob([module.bytes], { type: module.type }), module.name);
upload.set(helperName, new Blob([await readFile(new URL('./welcome-test-worker.mjs', import.meta.url))], { type: 'application/javascript+module' }), helperName);
upload.set(wrapperName, new Blob([`import original from './${main}';\nexport * from './${main}';\nimport {createWelcomeWorker} from './${helperName}';\nexport default createWelcomeWorker(original, ${JSON.stringify(configuration)});\n`], { type: 'application/javascript+module' }), wrapperName);
const metadata = { main_module: wrapperName, bindings: settings.bindings.filter(b => b.type !== 'secret_text'), keep_bindings: ['secret_text'] };
for (const key of ['compatibility_date', 'compatibility_flags', 'placement', 'usage_model', 'limits']) {
  if (settings[key] != null) metadata[key] = settings[key];
}
upload.set('metadata', JSON.stringify(metadata));
if (await active() !== originalVersion) throw new Error('Production deployment changed during preparation');
const uploaded = await json('/versions?bindings_inherit=strict', { method: 'POST', body: upload });
console.log(JSON.stringify({ originalVersion, testVersion: uploaded.id, existingModuleCount: downloaded.length, existingSourceSha256: downloaded.map(m => ({ name: m.name, sha256: hash(m.bytes) })) }));
if (await active() !== originalVersion) throw new Error('Production deployment changed before test activation');
let activated = false;
try {
  activated = true; // Also restore if the deployment response is lost.
  await deploy(uploaded.id, 'Authorized fixed-recipient welcome email test');
  if (await active() !== uploaded.id) throw new Error('Test version activation not confirmed');
  const endpoint = 'https://duediligence-api.wallyesteban1993.workers.dev/_internal/authorized-welcome-email-test';
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = await fetch(endpoint + '/ready', { method: 'POST', headers: { Authorization: authorization, Origin: 'https://duediligence.ph' }, signal: AbortSignal.timeout(10000) });
    const state = await probe.json().catch(() => ({}));
    if (state.ready === true && state.requestKey === requestKey) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Temporary test route did not become ready; no send attempted');
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: authorization, Origin: 'https://duediligence.ph' }, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  console.log(JSON.stringify({ sendHttpStatus: response.status, ...result }));
  if (!response.ok || result.accepted?.length !== 2) throw new Error('Welcome email acceptance was not confirmed');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Welcome back email accepted by Resend:\n\n${result.accepted.map(x => `- ${x.to}: ${x.id}`).join('\n')}\n`);
  await new Promise(resolve => setTimeout(resolve, 4000));
  const statusResponse = await fetch(endpoint + '/status', { method: 'POST', headers: { Authorization: authorization, Origin: 'https://duediligence.ph', 'Content-Type': 'application/json' }, body: JSON.stringify(result.accepted.map(x => x.id)), signal: AbortSignal.timeout(40000) });
  console.log(JSON.stringify({ deliveryStatusHttpStatus: statusResponse.status, ...await statusResponse.json() }));
} finally {
  if (activated) {
    const currentVersion = await active();
    if (currentVersion === uploaded.id || currentVersion === originalVersion) {
      if (currentVersion !== originalVersion) await deploy(originalVersion, 'Restore original Worker after welcome email test');
      if (await active() !== originalVersion) throw new Error('Original Worker version restoration not confirmed');
      if (hash(JSON.stringify(await json('/settings'))) !== originalSettingsHash) throw new Error('Worker settings differ after restoration');
      console.log(JSON.stringify({ restoredOriginalVersion: originalVersion, settingsPreserved: true }));
    } else {
      throw new Error('Another production deployment occurred; refusing to overwrite it during restoration');
    }
  }
}
