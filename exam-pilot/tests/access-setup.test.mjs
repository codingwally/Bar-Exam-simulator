import test from "node:test";
import assert from "node:assert/strict";
import {
  runAccessSetup,
  ownerOnly,
  OWNER_EMAIL,
  PRIVATE_PATHS,
  POLICY_NAME,
} from "../access-setup.mjs";

const accountId = "a".repeat(32),
  token = "private-token-must-not-appear";
function mockCloudflare({
  forbidden,
  apps = [],
  providers = [{ id: "idp-existing", type: "cloudflare" }],
  policyTamper = false,
} = {}) {
  const calls = [],
    policies = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace(
      `/client/v4/accounts/${accountId}`,
      "",
    );
    calls.push({
      path,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null,
    });
    if (path === forbidden)
      return Response.json(
        { success: false, errors: [{ code: 10000, message: token }] },
        { status: 403 },
      );
    let result;
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      if (path === "/access/policies") {
        result = { ...body, id: "policy-isolated", reusable: true };
        policies.push(result);
      } else if (path === "/access/apps") {
        result = {
          ...body,
          id: "app-isolated",
          aud: "audience-confirmed-by-cloudflare-1234",
        };
        apps.push(result);
      } else if (path === "/access/identity_providers") {
        result = { ...body, id: "idp-created" };
        providers.push(result);
      } else throw new Error(`Unexpected mutation ${path}`);
    } else if (path === "/access/organizations")
      result = { auth_domain: "exam-team.cloudflareaccess.com" };
    else if (path === "/workers/subdomain")
      result = { subdomain: "synthetic-owner" };
    else if (path === "/access/apps") result = apps;
    else if (path === "/access/policies") result = policies;
    else if (path === "/access/identity_providers") result = providers;
    else if (path === "/access/apps/app-isolated") result = apps[0];
    else if (path === "/access/policies/policy-isolated")
      result = policyTamper
        ? { ...policies[0], include: [{ everyone: {} }] }
        : policies[0];
    else if (path === "/access/apps/app-isolated/policies") result = policies;
    else throw new Error(`Unexpected read ${path}`);
    return Response.json({
      success: true,
      result,
      result_info: { total_pages: 1 },
    });
  };
  return { calls, fetcher, apps, policies };
}
test("Access preflight is GET-only, derives actual team/host and does not claim write authority", async () => {
  const cf = mockCloudflare();
  const result = await runAccessSetup({
    mode: "check",
    accountId,
    token,
    fetcher: cf.fetcher,
  });
  assert.ok(cf.calls.every((call) => call.method === "GET"));
  assert.equal(
    result.ACCESS_TEAM_DOMAIN,
    "https://exam-team.cloudflareaccess.com",
  );
  assert.equal(
    result.workerHostname,
    "duediligence-constitutional-exam.synthetic-owner.workers.dev",
  );
  assert.equal(result.ACCESS_AUD, null);
  assert.match(result.writePermissions, /not proven/);
  assert.equal(JSON.stringify(result).includes(token), false);
});
test("missing Access permission fails before any mutation and never prints provider secrets", async () => {
  const cf = mockCloudflare({ forbidden: "/access/organizations" });
  await assert.rejects(
    runAccessSetup({ mode: "setup", accountId, token, fetcher: cf.fetcher }),
    (error) => /HTTP 403/.test(error.message) && !error.message.includes(token),
  );
  assert.ok(cf.calls.every((call) => call.method === "GET"));
});
test("setup creates one owner-only reusable policy and links all private paths to the same audience", async () => {
  const cf = mockCloudflare();
  const result = await runAccessSetup({
    mode: "setup",
    accountId,
    token,
    fetcher: cf.fetcher,
  });
  const writes = cf.calls.filter((call) => call.method !== "GET");
  assert.deepEqual(
    writes.map((call) => call.path),
    ["/access/policies", "/access/apps"],
  );
  assert.deepEqual(writes[0].body.include, [{ email: { email: OWNER_EMAIL } }]);
  assert.equal(writes[0].body.name, POLICY_NAME);
  assert.deepEqual(writes[1].body.policies, [
    { id: "policy-isolated", precedence: 1 },
  ]);
  assert.deepEqual(
    writes[1].body.destinations.map((item) => item.uri),
    PRIVATE_PATHS.map((path) => `${result.workerHostname}${path}`),
  );
  assert.equal(result.ACCESS_AUD, "audience-confirmed-by-cloudflare-1234");
  assert.equal(result.status, "verified");
  assert.ok(
    writes[1].body.destinations.every(
      (item) => !/\/practice|\/exam\/|student\./.test(item.uri),
    ),
  );
  cf.calls.length = 0;
  const rerun = await runAccessSetup({
    mode: "setup",
    accountId,
    token,
    fetcher: cf.fetcher,
  });
  assert.equal(rerun.applicationId, result.applicationId);
  assert.ok(cf.calls.every((call) => call.method === "GET"));
});
test("an unknown existing wildcard Access app prevents all setup writes", async () => {
  const cf = mockCloudflare({
    apps: [
      {
        id: "unrelated-app",
        name: "Existing account policy",
        domain: "*.workers.dev",
      },
    ],
  });
  await assert.rejects(
    runAccessSetup({ mode: "setup", accountId, token, fetcher: cf.fetcher }),
    /overlap/,
  );
  assert.ok(cf.calls.every((call) => call.method === "GET"));
});
test("setup uses an isolated OTP only if no known usable provider exists", async () => {
  const cf = mockCloudflare({ providers: [] });
  await runAccessSetup({
    mode: "setup",
    accountId,
    token,
    fetcher: cf.fetcher,
  });
  const idp = cf.calls.find(
    (call) =>
      call.method === "POST" && call.path === "/access/identity_providers",
  );
  assert.equal(idp.body.type, "onetimepin");
  assert.deepEqual(idp.body.config, {});
});
test("readback rejects a broadened policy and never returns a deployable audience", async () => {
  const cf = mockCloudflare({ policyTamper: true });
  await assert.rejects(
    runAccessSetup({ mode: "setup", accountId, token, fetcher: cf.fetcher }),
    /readback/,
  );
  assert.equal(
    ownerOnly({ decision: "allow", include: [{ everyone: {} }] }),
    false,
  );
  assert.equal(
    ownerOnly({
      decision: "allow",
      include: [{ email: { email: OWNER_EMAIL } }],
      reusable: false,
    }),
    false,
  );
});
