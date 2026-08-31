// Static dev server with PRODUCTION CSP headers — the same policy vercel.json
// ships. Everything (spike, evals, rehearsal) runs through this so "works
// locally" means "works deployed". Port: 8080 (or PORT env), loopback only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const HOST = "127.0.0.1";
const PORT = process.env.PORT || 8080;
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const BASE_HEADERS = {
  "Content-Security-Policy": CSP,
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

export function isAllowedHost(host, port = PORT) {
  if (typeof host !== "string") return false;
  const value = host.toLowerCase();
  return new Set([
    "127.0.0.1",
    "localhost",
    `127.0.0.1:${port}`,
    `localhost:${port}`,
  ]).has(value);
}

export function createGatehouseServer() {
  let server;
  server = createServer(async (req, res) => {
    const address = server.address();
    const boundPort = address && typeof address === "object" ? address.port : PORT;
    if (!isAllowedHost(req.headers.host, boundPort)) {
      res.writeHead(403, BASE_HEADERS); res.end("forbidden"); return;
    }
    try {
      let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = normalize(join(ROOT, p));
      const rel = relative(ROOT, fp);
      const hidden = rel.split(sep).some(part => part.startsWith("."));
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || hidden) {
        res.writeHead(403, BASE_HEADERS); res.end(); return;
      }
      const body = await readFile(fp);
      res.writeHead(200, {
        "Content-Type": MIME[extname(fp)] || "application/octet-stream",
        ...BASE_HEADERS,
      });
      res.end(body);
    } catch {
      res.writeHead(404, BASE_HEADERS); res.end("not found");
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createGatehouseServer().listen(
    PORT,
    HOST,
    () => console.log("gatehouse dev server: http://" + HOST + ":" + PORT + " (production CSP on)"),
  );
}
