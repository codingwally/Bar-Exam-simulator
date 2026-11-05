// SYNTHETIC LOCAL REHEARSAL ONLY. This module is never imported by worker.mjs.
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./worker.mjs";
import { createTestDatabase } from "./test-support.mjs";
const root = fileURLToPath(new URL("./public/", import.meta.url));
const evidence = fileURLToPath(
  new URL("./.wrangler/local-backups/", import.meta.url),
);
const db = createTestDatabase();
const objects = new Map();
const env = {
  EXAM_DB: db,
  EXAM_BACKUPS: {
    async put(key, data, options) {
      objects.set(key, options);
      await mkdir(evidence, { recursive: true });
      await writeFile(resolve(evidence, key.replaceAll("/", "_")), data);
    },
    async head(key) {
      return objects.get(key);
    },
  },
  ASSETS: {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const path = resolve(root, `.${pathname}`);
      if (!path.startsWith(root) || pathname.includes(".."))
        return new Response("Not found", { status: 404 });
      try {
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css",
          ".mjs": "text/javascript",
          ".woff2": "font/woff2",
          ".svg": "image/svg+xml",
          ".txt": "text/plain",
        };
        return new Response(await readFile(path), {
          headers: {
            "Content-Type": mime[extname(path)] || "application/octet-stream",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
// Optional local-only rehearsal of the real built-in login boundary. The key
// must be synthetic; this setting is never read by the deployed Worker.
const realAdminLogin = process.env.EXAM_QA_ADMIN_SECRET;
if (realAdminLogin) {
  env.ADMIN_AUTH_MODE = "password";
  env.ADMIN_LOGIN_SECRET = realAdminLogin;
  env.ADMIN_EMAILS = "qa-examiner@example.invalid";
}
const app = createApp(realAdminLogin ? {} : {
  adminAuthenticator: async (request) => {
    if (request.headers.get("x-qa-anonymous") === "true")
      throw new Error("Synthetic anonymous access denied");
    return { email: "qa-examiner@example.invalid" };
  },
});
const tls =
  process.env.EXAM_QA_TLS_KEY && process.env.EXAM_QA_TLS_CERT
    ? {
        key: readFileSync(process.env.EXAM_QA_TLS_KEY),
        cert: readFileSync(process.env.EXAM_QA_TLS_CERT),
      }
    : null;
const handleRequest = async (incoming, outgoing) => {
  try {
    const origin = `${tls ? "https" : "http"}://localhost:${server.address().port}`;
    const url = new URL(incoming.url, origin);
    if (url.pathname.startsWith("/__qa/")) {
      // This process binds only to loopback; controls never exist in the Worker.
      if (url.pathname === "/__qa/open")
        db.sqlite
          .prepare(
            "UPDATE exams SET starts_at=?,ends_at=? WHERE slug='official'",
          )
          .run(Date.now() - 1000, Date.now() + 3600000);
      if (url.pathname === "/__qa/close") {
        db.sqlite
          .prepare("UPDATE exams SET ends_at=? WHERE slug='official'")
          .run(Date.now() - 1000);
        db.sqlite
          .prepare("UPDATE attempts SET deadline_at=? WHERE exam_id='official'")
          .run(Date.now() - 1000);
      }
      if (url.pathname === "/__qa/expire-practice")
        db.sqlite
          .prepare(
            "UPDATE attempts SET deadline_at=? WHERE exam_id='practice' AND status!='finalized'",
          )
          .run(Date.now() - 1000);
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ ok: true }));
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(!["GET", "HEAD"].includes(incoming.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await app.fetch(request, env, {
      waitUntil: (promise) => promise.catch(() => {}),
    });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500);
    outgoing.end("Local rehearsal error");
    console.error(error.message);
  }
};
const server = tls
  ? createHttpsServer(tls, handleRequest)
  : createServer(handleRequest);
server.listen(Number(process.env.EXAM_QA_PORT || 8797), "127.0.0.1", () =>
  console.log(
    `Synthetic exam rehearsal: ${tls ? "https" : "http"}://localhost:${server.address().port}`,
  ),
);
process.on("SIGINT", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
