// Static dev server with PRODUCTION CSP headers — the same policy vercel.json
// ships. Everything (spike, evals, rehearsal) runs through this so "works
// locally" means "works deployed". Port: 8080 (or PORT env).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const PORT = process.env.PORT || 8080;
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(fp);
    res.writeHead(200, {
      "Content-Type": MIME[extname(fp)] || "application/octet-stream",
      "Content-Security-Policy": CSP,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, () => console.log("gatehouse dev server: http://localhost:" + PORT + " (production CSP on)"));
