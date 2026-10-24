import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("./", import.meta.url));
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".wrangler", "public"].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await discover(path)));
    else if (entry.name.endsWith(".test.mjs")) files.push(path);
  }
  return files;
}
const files = (await discover(root)).sort();
if (!files.length)
  throw new Error("No examination verification tests were found");
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
