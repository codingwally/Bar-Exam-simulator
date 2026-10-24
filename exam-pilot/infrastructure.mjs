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
if (mode === "provision") {
  if (
    !/^https:\/\/[a-zA-Z0-9-]+\.cloudflareaccess\.com\/?$/.test(
      process.env.ACCESS_TEAM_DOMAIN || "",
    ) ||
    !/^[a-zA-Z0-9_-]{16,200}$/.test(process.env.ACCESS_AUD || "")
  ) {
    throw new Error(
      "Configure a verified Cloudflare Access HTTPS team domain and application audience before provisioning a deployable service",
    );
  }
}
// Validate the local deployment template before any remote request can create
// resources. Keep the .jsonc template within the strict JSON subset.
const config = mode === "provision" ? JSON.parse(
  await readFile(new URL("./wrangler.example.jsonc", import.meta.url), "utf8"),
) : null;
if (mode === "provision") {
  if (
    config?.assets?.binding !== "ASSETS" ||
    config.d1_databases?.[0]?.binding !== "EXAM_DB" ||
    config.r2_buckets?.[0]?.binding !== "EXAM_BACKUPS" ||
    !config.vars || typeof config.vars !== "object" || Array.isArray(config.vars)
  ) throw new Error("The isolated examination deployment template is incomplete");
  config.main = fileURLToPath(new URL("./worker.mjs", import.meta.url));
  config.assets.directory = fileURLToPath(new URL("./public", import.meta.url));
  config.vars.ACCESS_TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN;
  config.vars.ACCESS_AUD = process.env.ACCESS_AUD;
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
  api("/r2/buckets"),
  api("/access/organizations"),
  api("/workers/subdomain"),
]);
const names = ["D1", "private R2", "Access organization", "Worker subdomain"];
checks.forEach((check, index) =>
  console.log(
    `${names[index]}: ${check.status === "fulfilled" ? "available" : check.reason.message}`,
  ),
);
if (mode === "check")
  process.exit(
    checks.slice(0, 2).every((check) => check.status === "fulfilled") ? 0 : 1,
  );
if (checks[0].status !== "fulfilled" || checks[1].status !== "fulfilled")
  throw new Error(
    "D1 and private R2 permissions are required before provisioning",
  );
const name = "duediligence-constitutional-exam";
let database = checks[0].value.find((item) => item.name === name);
if (!database) database = await api("/d1/database", "POST", { name });
const bucketName = `${name}-private`;
const buckets = checks[1].value.buckets || checks[1].value;
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
config.d1_databases[0].database_id = database.uuid;
await mkdir(new URL("./.wrangler", import.meta.url), { recursive: true });
await writeFile(
  new URL("./.wrangler/deploy.json", import.meta.url),
  JSON.stringify(config, null, 2),
);
console.log(
  `Verified isolated database ${database.uuid}; private bucket ${bucketName}; deployment config written`,
);
