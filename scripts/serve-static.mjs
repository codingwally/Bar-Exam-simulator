import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const root = process.cwd();
const port = Number(process.env.DD_PREVIEW_PORT || 4173);
const workerEndpoint = 'https://duediligence-api.wallyesteban1993.workers.dev';
const useWorkerProxy = process.env.DD_WORKER_PROXY === '1' || process.argv.includes('--worker-proxy');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
};

http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (useWorkerProxy && pathname === '/__examiner' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const upstream = await fetch(workerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://duediligence.ph',
        },
        body: Buffer.concat(chunks),
      });
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: false, error: { code: 'PREVIEW_PROXY_ERROR', message: 'Local preview could not reach the examiner.' } }));
    }
    return;
  }
  const relativePath = pathname === '/'
    ? 'index.html'
    : pathname.endsWith('/')
      ? `${pathname.replace(/^\/+/, '')}index.html`
      : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    let file = await fs.readFile(target);
    if (useWorkerProxy && relativePath === 'index.html') {
      file = Buffer.from(file.toString('utf8').replace(workerEndpoint, '/__examiner'));
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Due Diligence preview: http://127.0.0.1:${port}\n`);
});
