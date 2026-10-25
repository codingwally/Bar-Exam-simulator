// Run only with a scoped Cloudflare credential in the environment. Never prints it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token)
  throw new Error("Cloudflare account credentials are not configured");
const mode = process.argv[2] || "check";
if (!["check", "provision"].includes(mode))
  throw new Error("Use check or provision");
let access = {};
if (mode === "provision") {
  try {
    access = JSON.parse(
      await readFile(
        new URL("./.wrangler/access-env.json", import.meta.url),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const accessDomain =
  process.env.ACCESS_TEAM_DOMAIN || access.ACCESS_TEAM_DOMAIN;
const accessAudience = process.env.ACCESS_AUD || access.ACCESS_AUD;
const authMode = process.env.ADMIN_AUTH_MODE || "access";
if (!["access", "password"].includes(authMode))
  throw new Error("Choose access or password for ADMIN_AUTH_MODE");
if (mode === "provision") {
  if (
    authMode === "access" &&
    (!/^https:\/\/[a-zA-Z0-9-]+\.cloudflareaccess\.com\/?$/.test(
      accessDomain || "",
    ) ||
      !/^[a-zA-Z0-9_-]{16,200}$/.test(accessAudience || ""))
  ) {
    throw new Error(
      "Configure a verified Cloudflare Access HTTPS team domain and application audience before provisioning a deployable service",
    );
  }
}
// Validate the local deployment template before any remote request can create
// resources. Keep the .jsonc template within the strict JSON subset.
const config =
  mode === "provision"
    ? JSON.parse(
        await readFile(
          new URL("./wrangler.example.jsonc", import.meta.url),
          "utf8",
        ),
      )
    : null;
if (mode === "provision") {
  if (
    config?.assets?.binding !== "ASSETS" ||
    config.d1_databases?.[0]?.binding !== "EXAM_DB" ||
    (config.r2_buckets && config.r2_buckets[0]?.binding !== "EXAM_BACKUPS") ||
    !config.vars ||
    typeof config.vars !== "object" ||
    Array.isArray(config.vars)
  )
    throw new Error(
      "The isolated examination deployment template is incomplete",
    );
  config.main = fileURLToPath(new URL("./worker.mjs", import.meta.url));
  config.assets.directory = fileURLToPath(new URL("./public", import.meta.url));
  config.vars.ACCESS_TEAM_DOMAIN = accessDomain;
  config.vars.ACCESS_AUD = accessAudience;
  config.vars.ADMIN_AUTH_MODE = authMode;
  if (authMode === "password") {
    config.vars.ACCESS_TEAM_DOMAIN = "";
    config.vars.ACCESS_AUD = "";
  }
  const spreadsheet = process.env.GOOGLE_SPREADSHEET_ID || config.vars.GOOGLE_SPREADSHEET_ID || "";
  if (spreadsheet && !/^[A-Za-z0-9_-]{20,200}$/.test(spreadsheet))
    throw new Error("Configure a valid private Google spreadsheet identifier");
  config.vars.GOOGLE_SPREADSHEET_ID = spreadsheet;
  const emailEnabled = process.env.EMAIL_DELIVERY_ENABLED ?? config.vars.EMAIL_DELIVERY_ENABLED ?? "false";
  if (!["true", "false"].includes(emailEnabled))
    throw new Error("EMAIL_DELIVERY_ENABLED must be true or false");
  config.vars.EMAIL_DELIVERY_ENABLED = emailEnabled;
}
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    const codes = (result.errors || []).map((error) => error.code).join(",");
    throw new Error(
      `Cloudflare ${method} ${path.split("?")[0]} failed: HTTP ${response.status}; codes ${codes}`,
    );
  }
  return result.result;
}
const checks = await Promise.allSettled([
  api("/d1/database?per_page=100"),
  authMode === "access" ? api("/access/organizations") : Promise.resolve(null),
  api("/workers/subdomain"),
]);
const names = [
  "D1",
  authMode === "access"
    ? "Access organization"
    : "Built-in professor sign-in (no Zero Trust subscription)",
  "Worker subdomain",
];
checks.forEach((check, index) =>
  console.log(
    `${names[index]}: ${check.status === "fulfilled" ? "available" : check.reason.message}`,
  ),
);
if (mode === "check")
  process.exit(checks.every((check) => check.status === "fulfilled") ? 0 : 1);
if (checks[0].status !== "fulfilled")
  throw new Error("D1 permissions are required before provisioning");
if (checks[2].status !== "fulfilled" || !checks[2].value?.subdomain)
  throw new Error(
    "An existing Worker subdomain is required before provisioning",
  );
const name = "duediligence-constitutional-exam";
let database = checks[0].value.find((item) => item.name === name);
if (!database) database = await api("/d1/database", "POST", { name });
// CREATE TABLE IF NOT EXISTS cannot upgrade an old table. Refuse a partial or
// pre-library database before issuing schema.sql; never silently alter records.
const schemaInfo = await api(`/d1/database/${database.uuid}/query`, "POST", {
  sql: "PRAGMA table_info(exams)",
});
if (!Array.isArray(schemaInfo) || !Array.isArray(schemaInfo[0]?.results))
  throw new Error("Cloudflare did not confirm the existing exam schema");
const columns = new Set(schemaInfo[0].results.map((column) => column.name));
if (
  columns.size &&
  ![
    "duration_minutes",
    "instructions",
    "archived_at",
    "source_text",
    "source_name",
    "source_format",
  ].every((name) => columns.has(name))
)
  throw new Error(
    "Existing exam database requires the reviewed 0002_practice_library.sql migration exactly once before deployment; no schema changes were issued",
  );
// Free practice deployment creates no R2 subscription or bucket. An explicitly
// configured R2 binding retains the stricter private-bucket verification below.
if (config.r2_buckets?.length) {
  const bucketName = `${name}-private`;
  const bucketResult = await api("/r2/buckets");
  const buckets = bucketResult.buckets || bucketResult;
  if (!buckets.some((item) => item.name === bucketName))
    await api("/r2/buckets", "POST", { name: bucketName });
  // Newly created R2 buckets are private. Verify public access was never enabled.
  const publicAccess = await api(`/r2/buckets/${bucketName}/domains/managed`);
  if (typeof publicAccess.enabled !== "boolean")
    throw new Error(
      "Cloudflare did not confirm the backup bucket public-access state",
    );
  if (publicAccess.enabled)
    throw new Error(
      "Exam backup bucket has public access enabled; refusing release",
    );
  const customAccess = await api(`/r2/buckets/${bucketName}/domains/custom`);
  if (!Array.isArray(customAccess.domains))
    throw new Error(
      "Cloudflare did not confirm the backup bucket custom-domain state",
    );
  if (customAccess.domains.length)
    throw new Error(
      "Exam backup bucket has a custom public domain; refusing release",
    );
}
config.d1_databases[0].database_id = database.uuid;
await mkdir(new URL("./.wrangler", import.meta.url), { recursive: true });
await writeFile(
  new URL("./.wrangler/deploy.json", import.meta.url),
  JSON.stringify(config, null, 2),
);
console.log(
  `Verified isolated database ${database.uuid}; ${config.r2_buckets?.length ? "private R2 configured" : "free practice deployment without R2"}; deployment config written`,
);
