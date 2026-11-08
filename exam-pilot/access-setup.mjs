// Isolated exam admin Access only. Default/check is GET-only. Never prints credentials.
// API references: developers.cloudflare.com/workers/configuration/cloudflare-access/
// developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/
// developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const OWNER_EMAIL = "wallyesteban1993@gmail.com";
export const WORKER_NAME = "duediligence-constitutional-exam";
export const APP_NAME = "Due Diligence Exam Admin (isolated)";
export const POLICY_NAME = "Due Diligence Exam Admin - owner only";
export const PRIVATE_PATHS = [
  "/admin*",
  "/api/admin*",
  "/import.mjs",
  "/document-import.mjs",
  "/document-vendor/*",
];
const IDP_NAME = "Due Diligence Exam Admin - email code";
const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const fail = (message) => {
  throw new Error(message);
};

export function ownerOnly(policy) {
  return (
    !!policy &&
    policy.decision === "allow" &&
    policy.reusable !== false &&
    JSON.stringify(policy.include) ===
      JSON.stringify([{ email: { email: OWNER_EMAIL } }]) &&
    !(policy.exclude || []).length &&
    !(policy.require || []).length &&
    !policy.approval_required
  );
}
const policyIds = (policies) =>
  (policies || []).map((policy) =>
    typeof policy === "string" ? policy : policy.id,
  );
function uris(app) {
  return [
    ...new Set(
      [
        app.domain,
        ...(app.self_hosted_domains || []),
        ...(app.destinations || []).map((item) => item.uri),
      ]
        .filter(Boolean)
        .map((uri) => uri.replace(/^https:\/\//, "").replace(/\/$/, "")),
    ),
  ];
}
function hostnamePatternMatches(pattern, hostname) {
  const host = pattern.replace(/^https?:\/\//, "").split("/")[0];
  return new RegExp(
    `^${host
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  ).test(hostname);
}
function validateApp(app, hostname, policyId) {
  const expected = PRIVATE_PATHS.map((path) => `${hostname}${path}`).sort();
  if (
    app.name !== APP_NAME ||
    app.type !== "self_hosted" ||
    JSON.stringify(uris(app).sort()) !== JSON.stringify(expected) ||
    app.destinations?.some(
      (item) => item.type !== "public" || item.overrides?.length,
    ) ||
    JSON.stringify(policyIds(app.policies)) !== JSON.stringify([policyId]) ||
    !Array.isArray(app.allowed_idps) ||
    app.allowed_idps.length !== 1 ||
    typeof app.aud !== "string" ||
    !/^[a-zA-Z0-9_-]{16,200}$/.test(app.aud)
  )
    fail(
      "Existing or returned exam Access application does not match the isolated owner-only configuration",
    );
}

export async function runAccessSetup({
  mode = "check",
  accountId,
  token,
  fetcher = fetch,
} = {}) {
  if (!["check", "setup"].includes(mode)) fail("Use check or setup");
  if (
    !/^[a-fA-F0-9]{32}$/.test(accountId || "") ||
    typeof token !== "string" ||
    !token.trim()
  )
    fail("Cloudflare account ID and API token must be configured");
  const base = `/accounts/${accountId}`;
  async function call(path, method = "GET", body) {
    if (mode === "check" && method !== "GET")
      fail("Check mode cannot mutate Cloudflare");
    let response;
    try {
      response = await fetcher(`${API_ORIGIN}${base}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      fail(`Cloudflare ${method} ${path.split("?")[0]} could not be reached`);
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      fail(
        `Cloudflare ${method} ${path.split("?")[0]} returned an unreadable response`,
      );
    }
    if (!response.ok || envelope.success !== true)
      fail(
        `Cloudflare ${method} ${path.split("?")[0]} failed: HTTP ${response.status}; codes ${(envelope.errors || []).map((error) => Number(error.code)).join(",") || "none"}`,
      );
    return envelope;
  }
  const get = async (path) => (await call(path)).result;
  async function list(path) {
    const found = [];
    for (let page = 1; page <= 100; page++) {
      const data = await call(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(data.result))
        fail(`Cloudflare ${path} did not return a complete collection`);
      found.push(...data.result);
      if (
        data.result_info?.total_pages
          ? page >= data.result_info.total_pages
          : data.result.length < 100
      )
        return found;
    }
    fail(`Cloudflare ${path} exceeded the safe pagination limit`);
  }
  // Read every prerequisite and the existing Access inventory before creating anything.
  const organization = await get("/access/organizations");
  const authDomain = organization?.auth_domain;
  if (
    typeof authDomain !== "string" ||
    !/^[a-zA-Z0-9-]+\.cloudflareaccess\.com$/.test(authDomain)
  )
    fail("A verified Cloudflare Zero Trust team domain is required");
  const subdomain = (await get("/workers/subdomain"))?.subdomain;
  if (
    typeof subdomain !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
  )
    fail(
      "An existing Workers subdomain is required; this script never creates or changes it",
    );
  const hostname = `${WORKER_NAME}.${subdomain}.workers.dev`;
  const apps = await list("/access/apps");
  const policies = await list("/access/policies");
  const providers = await list("/access/identity_providers");
  const namedApps = apps.filter((app) => app.name === APP_NAME);
  const namedPolicies = policies.filter(
    (policy) => policy.name === POLICY_NAME,
  );
  if (namedApps.length > 1 || namedPolicies.length > 1)
    fail("Duplicate isolated Access resource names require review");
  for (const app of apps) {
    if (app.name === APP_NAME) continue;
    if (
      uris(app).some((uri) => hostnamePatternMatches(uri, hostname)) ||
      app.destinations?.some((destination) =>
        [
          "all_workers",
          "all_preview_workers",
          "worker",
          "preview_worker",
        ].includes(destination.type),
      )
    )
      fail(
        "An existing Access application may overlap the isolated exam hostname; refusing changes",
      );
  }
  let policy = namedPolicies[0],
    app = namedApps[0];
  if (policy && !ownerOnly(policy))
    fail(
      "Existing isolated reusable policy is not restricted exclusively to the owner",
    );
  if (app) {
    if (!policy)
      fail(
        "Existing exam Access application has no recognized isolated reusable policy",
      );
    app = await get(`/access/apps/${app.id}`);
    validateApp(app, hostname, policy.id);
    const attached = await list(`/access/apps/${app.id}/policies`);
    if (
      attached.length !== 1 ||
      attached[0].id !== policy.id ||
      !ownerOnly(attached[0])
    )
      fail("Existing exam Access policy attachment is not owner-only");
    if (!providers.some((provider) => provider.id === app.allowed_idps[0]))
      fail("Existing exam Access identity provider could not be verified");
  }
  const plan = {
    mode,
    workerHostname: hostname,
    ownerEmail: OWNER_EMAIL,
    ACCESS_TEAM_DOMAIN: `https://${authDomain}`,
    protectedPaths: PRIVATE_PATHS,
    readPreflight: "passed",
    writePermissions: "not proven by read-only checks",
    applicationName: APP_NAME,
    policyName: POLICY_NAME,
  };
  if (mode === "check")
    return {
      ...plan,
      status: app ? "existing-configuration-verified" : "ready-to-create",
      ACCESS_AUD: app?.aud || null,
    };
  let provider = app
    ? providers.find((provider) => provider.id === app.allowed_idps[0])
    : providers.find((provider) => provider.type === "onetimepin") ||
      providers.find((provider) => provider.type === "cloudflare");
  if (!provider)
    provider = (
      await call("/access/identity_providers", "POST", {
        name: IDP_NAME,
        type: "onetimepin",
        config: {},
      })
    ).result;
  if (!provider?.id) fail("Cloudflare did not confirm an identity provider");
  if (!policy)
    policy = (
      await call("/access/policies", "POST", {
        name: POLICY_NAME,
        decision: "allow",
        include: [{ email: { email: OWNER_EMAIL } }],
        exclude: [],
        require: [],
        session_duration: "1h",
      })
    ).result;
  if (!policy?.id || !ownerOnly(policy))
    fail("Cloudflare did not confirm the owner-only reusable policy");
  if (!app)
    app = (
      await call("/access/apps", "POST", {
        name: APP_NAME,
        type: "self_hosted",
        domain: `${hostname}/admin*`,
        destinations: PRIVATE_PATHS.map((path) => ({
          type: "public",
          uri: `${hostname}${path}`,
        })),
        policies: [{ id: policy.id, precedence: 1 }],
        allowed_idps: [provider.id],
        auto_redirect_to_identity: true,
        app_launcher_visible: false,
        session_duration: "1h",
      })
    ).result;
  if (!app?.id)
    fail("Cloudflare did not confirm the isolated Access application");
  // Never emit deployable values before readback confirms both destinations and exactly one owner-only policy.
  app = await get(`/access/apps/${app.id}`);
  validateApp(app, hostname, policy.id);
  policy = await get(`/access/policies/${policy.id}`);
  const attached = await list(`/access/apps/${app.id}/policies`);
  if (
    !ownerOnly(policy) ||
    attached.length !== 1 ||
    attached[0].id !== policy.id ||
    !ownerOnly(attached[0])
  )
    fail(
      "Access readback did not confirm the owner-only reusable policy and attachment",
    );
  return {
    ...plan,
    status: "verified",
    ACCESS_AUD: app.aud,
    applicationId: app.id,
    policyId: policy.id,
    identityProviderId: provider.id,
    identityProviderType: provider.type,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const mode = process.argv[2] || "check";
    const result = await runAccessSetup({
      mode,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
    if (mode === "setup") {
      await mkdir(new URL("./.wrangler/", import.meta.url), {
        recursive: true,
      });
      await writeFile(
        new URL("./.wrangler/access-env.json", import.meta.url),
        JSON.stringify(result, null, 2),
        { mode: 0o600 },
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
