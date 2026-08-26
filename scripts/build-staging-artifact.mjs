import { execFileSync } from 'node:child_process';
import {
  cp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesRoot = path.join(repositoryRoot, '.pages-dist');
const stagingRoot = path.join(repositoryRoot, '.staging-dist');

const stagingPublicUrl = String(process.env.STAGING_PUBLIC_URL || '').replace(/\/+$/, '');
const stagingSupabaseUrl = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const stagingPublishableKey = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const stagingWorkerUrl = String(process.env.STAGING_WORKER_URL || '').replace(/\/+$/, '');

if (
  stagingPublicUrl !== 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev'
  || stagingWorkerUrl !== stagingPublicUrl
  || stagingSupabaseUrl !== 'https://hlzqmreeoghbldnhlybr.supabase.co'
  || !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(stagingPublishableKey)
) {
  throw new Error('Refusing to build a staging artifact for an unapproved environment.');
}

execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

await rm(stagingRoot, { recursive: true, force: true });
await cp(pagesRoot, stagingRoot, { recursive: true, force: true });
await rm(path.join(stagingRoot, 'CNAME'), { force: true });

async function replaceIn(relativePath, replacements) {
  const filePath = path.join(stagingRoot, relativePath);
  let source = await readFile(filePath, 'utf8');
  for (const [search, replacement] of replacements) {
    const markerExists = search instanceof RegExp ? search.test(source) : source.includes(search);
    if (!markerExists) {
      throw new Error(`${relativePath} is missing the expected staging replacement marker.`);
    }
    source = search instanceof RegExp
      ? source.replace(search, replacement)
      : source.replaceAll(search, replacement);
  }
  await writeFile(filePath, source, 'utf8');
}

await replaceIn('assets/phase2-config.js', [
  ['https://hbllomlijfznnuudpdvr.supabase.co', stagingSupabaseUrl],
  ['sb_publishable_lQRSlxJPTDkKQIiT0hTfdg_ANVRUzym', stagingPublishableKey],
  ['https://duediligence.ph/?auth=callback', `${stagingPublicUrl}/?auth=callback`],
  ['https://duediligence-api.wallyesteban1993.workers.dev', stagingWorkerUrl],
  [
    /maintenance: Object\.freeze\(\{(\r?\n\s*)enabled: (?:true|false),/,
    'maintenance: Object.freeze({$1enabled: false,',
  ],
]);

await replaceIn('index.html', [
  ['https://duediligence-api.wallyesteban1993.workers.dev', stagingWorkerUrl],
]);

const stagedConfig = await readFile(
  path.join(stagingRoot, 'assets/phase2-config.js'),
  'utf8',
);
const stagedIndex = await readFile(path.join(stagingRoot, 'index.html'), 'utf8');
if (
  stagedConfig.includes('hbllomlijfznnuudpdvr')
  || stagedConfig.includes('duediligence-api.wallyesteban1993.workers.dev')
  || stagedIndex.includes('duediligence-api.wallyesteban1993.workers.dev')
) {
  throw new Error('Production backend configuration leaked into the staging artifact.');
}

console.log('Built sanitized staging artifact for the authorized staging backend.');
