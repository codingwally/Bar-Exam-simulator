import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(repositoryRoot, '.pages-dist');
const hostname = '127.0.0.1';
const configuredPort = Number(process.env.DD_PRODUCT_PREVIEW_PORT || 4178);
const port = Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65_535
  ? configuredPort
  : 4178;
const deniedPath = /^\/(?:docs|content|worker|supabase|scripts|\.git)(?:\/|$)/iu;
const qaSentinel = /(?:SYNTHETIC-UI-(?:\d{1,3}|\$\{)|Synthetic interface-test question\s+(?:\d{1,3}|\$\{)|Mock Permit\s+(?:\d{1,3}|\$\{)|local-preview-token|Synthetic UI QA Harness|__DD_BAR_FORECAST_SYNTHETIC_QA__)/iu;
const textFile = /\.(?:css|html|js|json|svg|txt|webmanifest|xml)$/iu;
const contentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
});

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function assertNoQaPayload(relativeFile, contents) {
  if (textFile.test(relativeFile) && qaSentinel.test(contents.toString('utf8'))) {
    throw new Error(`Synthetic Forecast QA content was found in ${relativeFile}.`);
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function attestArtifactTree() {
  execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GITHUB_SHA: process.env.GITHUB_SHA || '0123456789abcdef0123456789abcdef01234567',
    },
    stdio: 'pipe',
  });
  const resolvedRoot = await realpath(artifactRoot);
  const hashes = new Map();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`The product preview artifact contains a link: ${entryPath}`);
      }
      const resolved = await realpath(entryPath);
      if (!pathIsInside(resolvedRoot, resolved)) {
        throw new Error(`The product preview artifact escapes its root: ${entryPath}`);
      }
      if (stats.isDirectory()) {
        await walk(entryPath);
      } else if (stats.isFile()) {
        const contents = await readFile(resolved);
        const relativeFile = path.relative(resolvedRoot, resolved);
        assertNoQaPayload(relativeFile, contents);
        hashes.set(relativeFile, sha256(contents));
      } else {
        throw new Error(`The product preview artifact contains an unsupported entry: ${entryPath}`);
      }
    }
  }
  await walk(resolvedRoot);
  const index = await readFile(path.join(resolvedRoot, 'index.html'), 'utf8');
  if (!/<title>Due Diligence — Philippine Bar Exam Simulator<\/title>/u.test(index)) {
    throw new Error('The product preview root did not pass its title attestation.');
  }
  const forecastRuntime = await readFile(path.join(resolvedRoot, 'assets', 'bar-forecast.js'), 'utf8');
  if (!/\|\| syntheticQaContent\) \{/u.test(forecastRuntime)
      || /isExplicitLoopbackQaHarness|__DD_BAR_FORECAST_SYNTHETIC_QA__|ddBarForecastQa|\|\| false\) \{/u.test(forecastRuntime)) {
    throw new Error('The product preview Forecast runtime did not pass its QA-isolation attestation.');
  }
  return Object.freeze({ root: resolvedRoot, hashes });
}

const artifactAttestation = await attestArtifactTree();
const artifactRealRoot = artifactAttestation.root;
const artifactHashes = artifactAttestation.hashes;

function send(response, status, body = '', headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-DueDiligence-Local-Mode': 'product-source-no-auth-proxy',
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    send(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', `http://${hostname}`).pathname);
  } catch (_error) {
    send(response, 400, 'Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (deniedPath.test(pathname)) {
    send(response, 404, 'Not found');
    return;
  }
  const file = path.resolve(artifactRoot, `.${pathname}`);
  if (!pathIsInside(artifactRoot, file)) {
    send(response, 403, 'Forbidden');
    return;
  }
  try {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Unsupported preview entry.');
    const resolved = await realpath(file);
    if (!pathIsInside(artifactRealRoot, resolved)) throw new Error('Preview path escaped artifact.');
    const contents = await readFile(resolved);
    const relativeFile = path.relative(artifactRealRoot, resolved);
    assertNoQaPayload(relativeFile, contents);
    if (artifactHashes.get(relativeFile) !== sha256(contents)) {
      throw new Error('Preview artifact changed after startup.');
    }
    const headers = {
      'Content-Type': contentTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(contents.byteLength),
    };
    send(response, 200, request.method === 'HEAD' ? '' : contents, headers);
  } catch (_error) {
    send(response, 404, 'Not found');
  }
});

server.listen(port, hostname, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(`DueDiligence product-source preview: http://${hostname}:${listeningPort}/`);
});
