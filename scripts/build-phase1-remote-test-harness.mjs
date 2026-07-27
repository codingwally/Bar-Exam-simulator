import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const harnessRoot = path.resolve(process.argv[2] || "");

assert.equal(
  path.basename(harnessRoot),
  "phase1c-staging-harness",
  "Refusing to write outside the named Phase 1C staging harness.",
);
assert.ok(
  !harnessRoot.startsWith(`${repositoryRoot}${path.sep}`),
  "The staging harness must remain outside the repository.",
);

const tests = [
  {
    source: "supabase/tests/20260727_002_auth_user_data_analytics_foundation_test.sql",
    target:
      "supabase/migrations/20260727000300_structural_pgtap_staging_only.sql",
  },
  {
    source: "supabase/tests/20260727_003_phase1_behavioral_security_test.sql",
    target:
      "supabase/migrations/20260727000400_behavioral_pgtap_staging_only.sql",
  },
];

const assertionFunctions = [
  "has_column",
  "has_table",
  "policies_are",
  "function_returns",
  "has_function",
  "col_default_is",
  "isnt",
  "ok",
  "is",
  "lives_ok",
  "throws_ok",
].join("|");

for (const { source, target } of tests) {
  const sourcePath = path.join(repositoryRoot, source);
  const targetPath = path.join(harnessRoot, target);
  const original = await readFile(sourcePath, "utf8");
  const withoutBegin = original.replace(/^begin;\r?\n/im, "");
  const migrationSafe = withoutBegin.replace(/\r?\nrollback;\s*$/i, "\n");
  const fatalHelper = `
create or replace function pg_temp.phase1_require_ok(p_result text)
returns text
language plpgsql
as $phase1_require_ok$
begin
  if p_result not like 'ok%' then
    raise exception 'PHASE1_PGTAP_ASSERTION_FAILED: %', p_result;
  end if;
  return p_result;
end
$phase1_require_ok$;
`;
  const withFatalHelper = migrationSafe.replace(
    /select plan\(/i,
    `${fatalHelper}\nselect plan(`,
  );
  const fatalAssertions = withFatalHelper.replace(
    new RegExp(
      `^select\\s+(${assertionFunctions})\\s*\\([\\s\\S]*?\\);`,
      "gim",
    ),
    (statement) =>
      statement
        .replace(/^select\s+/i, "select pg_temp.phase1_require_ok(")
        .replace(/\);\s*$/, "));"),
  );
  const remoteRunnable = fatalAssertions
    .replace(
      /do \$phase1_structural_finish\$[\s\S]*?\$phase1_structural_finish\$;/i,
      "select 1;",
    )
    .replace(
      /do \$phase1_behavioral_finish\$[\s\S]*?\$phase1_behavioral_finish\$;/i,
      "select 1;",
    )
    .concat("\nset local role postgres;\n");

  assert.notEqual(withoutBegin, original, `${source} must begin a transaction`);
  assert.notEqual(
    migrationSafe,
    withoutBegin,
    `${source} must end with rollback`,
  );
  assert.match(
    migrationSafe,
    /PHASE1_(?:STRUCTURAL|BEHAVIORAL)_PGTAP_FAILED/,
    `${source} source must include a fatal finish guard`,
  );

  assert.match(
    remoteRunnable,
    /pg_temp\.phase1_require_ok\(/,
    `${source} assertions must be fatal in the remote harness`,
  );

  await writeFile(targetPath, remoteRunnable, "utf8");
}

console.log("Prepared fatal pgTAP migrations in the external staging harness.");
