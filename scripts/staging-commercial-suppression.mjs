import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const COMMERCIAL_STAGE = Object.freeze({
  accountId: 'b81da9b789fa3ee6653c89d2c95e8d2d',
  workerName: 'duediligence-examinations-staging',
  projectRef: 'hlzqmreeoghbldnhlybr',
  supabaseUrl: 'https://hlzqmreeoghbldnhlybr.supabase.co',
  workerUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const DEFAULT_SOURCE = `function notificationMode(env) {
  const mode = String(env?.PAYMENT_NOTIFICATION_EMAIL_MODE || 'suppressed')
    .trim()
    .toLowerCase();
  return ['enabled', 'suppressed'].includes(mode) ? mode : 'suppressed';
}`;

export function commercialDeploymentMarker(sourceSha, workflowRunId, workflowRunAttempt) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.match(workflowRunId, /^[1-9][0-9]*$/u);
  assert.match(workflowRunAttempt, /^[1-9][0-9]*$/u);
  return `astra-commercial-stage:${workflowRunId}:${workflowRunAttempt}:${sourceSha}`;
}

// Wrangler 4.114.0 ordinary deploy emits a version ID, NOT a deployment ID.
// The protected collector binds it to Cloudflare's deployment ID using the
// exact unique command message plus 100% version association. This adapter
// independently GETs current deployment and exact immutable version metadata.
// A source SHA alone or source TOML never constitutes deployment evidence.
export function createCommercialSuppressionVerifier({ evidence, sourceSha, sourceText,
  apiToken, request = fetch, now = Date.now }) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(evidence?.schemaVersion, 1);
  assert.equal(evidence?.kind, 'protected-workflow-worker-deployment');
  assert.equal(evidence?.sourceSha, sourceSha);
  assert.equal(evidence?.accountId, COMMERCIAL_STAGE.accountId);
  assert.equal(evidence?.workerName, COMMERCIAL_STAGE.workerName);
  assert.match(evidence?.workflowRunId, /^[1-9][0-9]+$/u);
  assert.equal(evidence?.provenance, 'wrangler-version-cloudflare-deployment-message-v1');
  assert.equal(evidence?.wranglerVersion, '4.114.0');
  assert.match(evidence?.wranglerOutputSha256, /^[a-f0-9]{64}$/u);
  const marker = commercialDeploymentMarker(sourceSha, evidence.workflowRunId, evidence.workflowRunAttempt);
  assert.equal(evidence?.deploymentMessage, marker);
  assert.match(evidence?.deploymentId, UUID); assert.match(evidence?.versionId, UUID);
  assert.ok(typeof apiToken === 'string' && apiToken.length >= 20);
  const normalized = sourceText.replaceAll('\r\n', '\n');
  const sourceHash = createHash('sha256').update(normalized).digest('hex');
  assert.equal(evidence?.commercialEntryLfSha256, sourceHash);
  assert.equal(normalized.split(DEFAULT_SOURCE).length, 2, 'Missing-mode default source changed');
  const base = `https://api.cloudflare.com/client/v4/accounts/${COMMERCIAL_STAGE.accountId}/workers/scripts/${COMMERCIAL_STAGE.workerName}`;
  async function get(suffix) {
    const response = await request(`${base}${suffix}`, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'Deployed suppression metadata is unreadable');
    const data = await response.json();
    assert.equal(data?.success, true, 'Deployed suppression metadata failed');
    return data.result;
  }
  return async function verify() {
    try {
      const deployments = await get('/deployments');
      assert.ok(Array.isArray(deployments?.deployments) && deployments.deployments.length > 0);
      const current = deployments.deployments[0];
      assert.equal(current.id, evidence.deploymentId);
      assert.deepEqual(current.versions, [{ version_id: evidence.versionId, percentage: 100 }]);
      assert.equal(current.annotations?.['workers/message'], marker);
      assert.ok(Number.isFinite(Date.parse(current.created_on)) && Date.parse(current.created_on) <= now() + 60000);
      const version = await get(`/versions/${evidence.versionId}`);
      assert.equal(version.id, evidence.versionId);
      assert.ok(Array.isArray(version.resources?.bindings));
      const bindings = version.resources.bindings;
      const getBinding = name => {
        const matches = bindings.filter(item => item.name === name);
        assert.ok(matches.length <= 1, 'Duplicate deployed binding'); return matches[0];
      };
      const target = getBinding('SUPABASE_URL');
      assert.equal(target?.type, 'plain_text'); assert.equal(target?.text, COMMERCIAL_STAGE.supabaseUrl);
      const mode = getBinding('PAYMENT_NOTIFICATION_EMAIL_MODE');
      // Secret/unknown, explicit enabled, invalid, and empty bindings all fail.
      // Absence is allowed only with the exact source implementation pinned above.
      assert.ok(!mode || (mode.type === 'plain_text' && mode.text === 'suppressed'));
      const again = await get('/deployments');
      assert.deepEqual(again?.deployments?.[0], current, 'Deployment changed during suppression preflight');
      return { deploymentId: current.id, versionId: version.id, workflowRunId: evidence.workflowRunId,
        sourceSha, commercialEntryLfSha256: sourceHash, observedAt: new Date(now()).toISOString(),
        paymentNotificationMode: 'suppressed', modeBasis: mode ? 'deployed-plain-text' : 'deployed-binding-absent-pinned-source-default',
        deployedBundleBytesIndependentlyCompared: false };
    } catch {
      throw new Error('Commercial staging suppression evidence is missing, unreadable, or changed; no fixture operation authorized');
    }
  };
}
