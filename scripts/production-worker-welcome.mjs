const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[a-f0-9]{32}$/i.test(account || '')) throw new Error('Existing Cloudflare production credentials are unavailable.');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/duediligence-gemini-examiner`;
async function get(path) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cloudflare read ${path} failed: HTTP ${response.status}`);
  return response;
}
const deployment = (await (await get('/deployments')).json()).result.deployments[0];
if (deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) throw new Error('Refusing to alter a split deployment.');
const versionId = deployment.versions[0].version_id;
const settings = (await (await get('/settings')).json()).result;
const version = (await (await get('/versions/' + versionId)).json()).result;
const response = await get('');
const parts = await response.formData();
console.log(JSON.stringify({ versionId, settingsKeys: Object.keys(settings), versionKeys: Object.keys(version),
  resourceKeys: Object.keys(version.resources || {}), runtime: version.resources?.script_runtime,
  bindings: settings.bindings.map(({name,type})=>({name,type})),
  entrypoint: response.headers.get('cf-entrypoint'),
  parts: [...parts].map(([name,value])=>({ name, type: value.type, size: value.size })) }));
