import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const templateText = await readFile(
  new URL("./wrangler.example.jsonc", import.meta.url),
  "utf8",
);
const source = await readFile(
  new URL("./infrastructure.mjs", import.meta.url),
  "utf8",
);

async function provisionFixture(
  configText,
  { columns = [], existing = false, publicBucket = false } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "dd-exam-provision-"));
  const trace = join(directory, "fetches.json");
  await writeFile(join(directory, "infrastructure.mjs"), source);
  await writeFile(join(directory, "wrangler.example.jsonc"), configText);
  // Every request is intercepted before the real CLI module loads. These
  // synthetic credentials cannot reach Cloudflare or create live resources.
  await writeFile(
    join(directory, "mock-fetch.mjs"),
    `
    import { writeFileSync } from "node:fs";
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: options.method || "GET" });
      writeFileSync(process.env.EXAM_TEST_TRACE, JSON.stringify(calls));
      let result = {};
      if (path.endsWith("/d1/database")) result = options.method === "POST" ? { uuid: "synthetic-database-id" } : ${JSON.stringify(existing ? [{ name: "duediligence-constitutional-exam", uuid: "synthetic-database-id" }] : [])};
      else if (path.endsWith("/query")) result = [{ results: ${JSON.stringify(columns.map((name) => ({ name })))} }];
      else if (path.endsWith("/r2/buckets")) result = { buckets: [] };
      else if (path.endsWith("/domains/managed")) result = { enabled: ${JSON.stringify(publicBucket)} };
      else if (path.endsWith("/domains/custom")) result = { domains: [] };
      return Response.json({ success: true, result });
    };
  `,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(directory, "mock-fetch.mjs")).href,
      join(directory, "infrastructure.mjs"),
      "provision",
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: "synthetic-account",
        CLOUDFLARE_API_TOKEN: "synthetic-not-a-real-credential",
        ACCESS_TEAM_DOMAIN: "https://synthetic.cloudflareaccess.com",
        ACCESS_AUD: "synthetic-application-audience",
        EXAM_TEST_TRACE: trace,
      },
    },
  );
  const calls = JSON.parse(await readFile(trace, "utf8").catch(() => "[]"));
  return { directory, result, calls };
}
async function cleanup(directory) {
  assert.ok(
    resolve(directory).startsWith(
      `${resolve(tmpdir())}${sep}dd-exam-provision-`,
    ),
  );
  await rm(directory, { recursive: true, force: true });
}

test("deployment template uses strict JSON accepted by the provisioning parser", () => {
  const config = JSON.parse(templateText);
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.d1_databases[0].binding, "EXAM_DB");
  assert.equal(
    config.r2_buckets,
    undefined,
    "default free deployment must not require an R2 subscription",
  );
});

test("invalid deployment JSON fails before any fetch or resource creation", async () => {
  const fixture = await provisionFixture('{"name":"invalid",}');
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /SyntaxError/);
    assert.deepEqual(fixture.calls, []);
  } finally {
    await cleanup(fixture.directory);
  }
});

test("incomplete deployment bindings fail before any fetch", async () => {
  const fixture = await provisionFixture('{"assets":{},"vars":{}}');
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /deployment template is incomplete/);
    assert.deepEqual(fixture.calls, []);
  } finally {
    await cleanup(fixture.directory);
  }
});

test("valid deployment preflight produces the isolated config through mocked APIs", async () => {
  const fixture = await provisionFixture(templateText);
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const config = JSON.parse(
      await readFile(
        join(fixture.directory, ".wrangler", "deploy.json"),
        "utf8",
      ),
    );
    assert.equal(config.d1_databases[0].database_id, "synthetic-database-id");
    assert.equal(
      config.vars.ACCESS_TEAM_DOMAIN,
      "https://synthetic.cloudflareaccess.com",
    );
    assert.equal(config.vars.ACCESS_AUD, "synthetic-application-audience");
    assert.equal(
      fixture.calls.filter((call) => call.method === "POST").length,
      2,
    );
    assert.equal(
      fixture.calls.some((call) => call.path.includes("/r2/")),
      false,
    );
  } finally {
    await cleanup(fixture.directory);
  }
});

test("pre-library existing database blocks schema deployment without altering any records", async () => {
  const fixture = await provisionFixture(templateText, {
    existing: true,
    columns: ["id", "slug", "title"],
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(
      fixture.result.stderr,
      /0002_practice_library.sql migration exactly once/,
    );
    assert.deepEqual(
      fixture.calls
        .filter((call) => call.method === "POST")
        .map((call) => call.path),
      [
        "/client/v4/accounts/synthetic-account/d1/database/synthetic-database-id/query",
      ],
    );
  } finally {
    await cleanup(fixture.directory);
  }
});

test("existing rebuilt schema remains deployable without replaying ALTER TABLE", async () => {
  const fixture = await provisionFixture(templateText, {
    existing: true,
    columns: [
      "id",
      "duration_minutes",
      "instructions",
      "archived_at",
      "source_text",
      "source_name",
      "source_format",
    ],
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(
      fixture.calls.filter((call) => call.method === "POST").length,
      1,
    );
  } finally {
    await cleanup(fixture.directory);
  }
});

test("explicit optional R2 configuration still refuses a public backup bucket", async () => {
  const config = JSON.parse(templateText);
  config.r2_buckets = [
    {
      binding: "EXAM_BACKUPS",
      bucket_name: "duediligence-constitutional-exam-private",
    },
  ];
  const fixture = await provisionFixture(JSON.stringify(config), {
    publicBucket: true,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(
      fixture.result.stderr,
      /public access enabled; refusing release/,
    );
  } finally {
    await cleanup(fixture.directory);
  }
});
