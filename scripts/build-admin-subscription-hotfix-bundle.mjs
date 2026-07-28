import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = '20260731_009_admin_subscription_actions_hotfix.sql';
const version = '20260731009';
const name = '009_admin_subscription_actions_hotfix';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(tmpdir(), `due-diligence-admin-subscription-hotfix-${process.pid}.sql`);

if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const source = await readFile(
  path.join(root, 'supabase', 'migrations', sourceFile),
  'utf8',
);
if ((source.match(/^\s*begin;\s*$/gim) || []).length !== 1
    || (source.match(/^\s*commit;\s*$/gim) || []).length !== 1) {
  throw new Error('The hotfix migration must contain exactly one outer transaction.');
}

const hash = createHash('sha256').update(source).digest('hex');
const body = source
  .replace(/^\s*begin;\s*$/im, '')
  .replace(/^\s*commit;\s*$/im, '')
  .trim();
const bundle = `-- Generated from ${sourceFile}; no credentials are included.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $migration_guard$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '${version}'
  ) then
    raise exception 'Migration ${version} is already recorded';
  end if;
end
$migration_guard$;

${body}

insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${version}',
  array['sha256:${hash}'],
  '${name}'
);

commit;
`;

await writeFile(outputPath, bundle, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({
  outputPath,
  sourceFile,
  version,
  sha256: createHash('sha256').update(bundle).digest('hex'),
  sourceSha256: hash,
  bytes: Buffer.byteLength(bundle),
}, null, 2));
