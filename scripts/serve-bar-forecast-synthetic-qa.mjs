import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostname = '127.0.0.1';
const configuredPort = Number(process.env.DD_SYNTHETIC_QA_PORT || 4179);
const port = Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65_535
  ? configuredPort
  : 4179;
const qaPath = '/__qa__/bar-forecast-synthetic.html';
const allowedFiles = new Map([
  [qaPath, 'docs/evidence/bar-forecast-examplify-audit-20260901/local-preview.html'],
  ['/assets/bar-forecast.css', 'assets/bar-forecast.css'],
  ['/assets/bar-forecast.js', 'assets/bar-forecast.js'],
  ['/assets/icons/navigation/flag.svg', 'assets/icons/navigation/flag.svg'],
  ['/assets/bar-forecast/forecast-workspace-preview.webp', 'assets/bar-forecast/forecast-workspace-preview.webp'],
]);
const contentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

function send(response, status, body = '', headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-DueDiligence-Local-Mode': 'synthetic-qa-explicit-path',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
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
  const relativeFile = allowedFiles.get(pathname);
  if (!relativeFile) {
    send(response, 404, 'Synthetic QA is available only at its explicit test path.');
    return;
  }
  try {
    const file = path.join(repositoryRoot, relativeFile);
    let contents = await readFile(file);
    if (pathname === '/assets/bar-forecast.js') {
      const source = contents.toString('utf8');
      const guard = '|| syntheticQaContent) {';
      if (!source.includes(guard)) throw new Error('Forecast synthetic-content guard changed.');
      contents = Buffer.from(source.replace(guard, '|| false) {'), 'utf8');
    }
    const headers = {
      'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
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
  console.log(`Synthetic Forecast QA only: http://${hostname}:${listeningPort}${qaPath}`);
});
