import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAllowedHost } from "../scripts/dev-server.mjs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("S1 page keeps scripts external under production CSP", async () => {
  const page = await read("../dev/s1.html");
  assert.match(page, /<script type="module" src="\/src\/sandbox\/s1-dev\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});

test("development server serves the production CSP on loopback only", async () => {
  const server = await read("../scripts/dev-server.mjs");

  assert.match(server, /const HOST = "127\.0\.0\.1"/);
  assert.match(server, /createGatehouseServer\(\)\.listen\([\s\S]*PORT,[\s\S]*HOST,/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /X-Frame-Options/);
  assert.match(server, /Referrer-Policy/);
  assert.match(server, /Permissions-Policy/);
  assert.match(server, /frame-ancestors 'none'/);
  assert.match(server, /relative\(ROOT, fp\)/);
  assert.match(server, /part\.startsWith\("\."\)/);
  assert.match(server, /writeHead\(403, BASE_HEADERS\)/);
  assert.match(server, /writeHead\(404, BASE_HEADERS\)/);
});

test("development server rejects DNS-rebinding Host values", () => {
  assert.equal(isAllowedHost("127.0.0.1:8080"), true);
  assert.equal(isAllowedHost("localhost:8080"), true);
  assert.equal(isAllowedHost("127.0.0.1"), true);
  assert.equal(isAllowedHost("localhost"), true);
  assert.equal(isAllowedHost("attacker.example"), false);
  assert.equal(isAllowedHost("127.0.0.1.attacker.example:8080"), false);
  assert.equal(isAllowedHost(undefined), false);
});

test("deployment and checker enforce the complete security header baseline", async () => {
  const checker = await read("../scripts/check-headers.sh");
  const deployment = JSON.parse(await read("../vercel.json"));
  const headers = Object.fromEntries(
    deployment.headers[0].headers.map(({ key, value }) => [key, value]),
  );

  assert.match(checker, /Content-Security-Policy mismatch/);
  assert.match(checker, /Cache-Control mismatch/);
  assert.match(checker, /X-Content-Type-Options mismatch/);
  assert.match(checker, /X-Frame-Options mismatch/);
  assert.match(checker, /Referrer-Policy mismatch/);
  assert.match(checker, /Permissions-Policy mismatch/);
  assert.match(checker, /Origin-Agent-Cluster opts out/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Permissions-Policy"], "camera=(), geolocation=(), microphone=()");
});

test("SYNC-0 harness preserves the opaque iframe and termination invariants", async () => {
  const parent = await read("../src/sandbox/spike.js");
  const inner = await read("../src/sandbox/spike-inner.js");

  assert.match(parent, /document\.open\(\)/);
  assert.match(parent, /document\.close\(\)/);
  assert.match(parent, /iframe\.sandbox = "allow-scripts"/);
  assert.doesNotMatch(parent, /allow-same-origin/);
  assert.match(parent, /<script src="\/src\/sandbox\/spike-inner\.js"><\/script>/);
  assert.match(inner, /new Worker\(url\)/);
  assert.match(inner, /while \(true\) \{\}/);
  assert.match(inner, /worker\.terminate\(\)/);
  assert.match(inner, /nextMessage\(probe, 2_000\)/);
  assert.match(inner, /typeof self\.dayjs/);
});
