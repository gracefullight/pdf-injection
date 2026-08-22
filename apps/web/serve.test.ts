import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "./serve";

// Regression test for the QA HIGH finding in
// .agents/state/memories/result-qa-r1b-session-20260822-132343.md:
// a crafted request path (a percent-encoded slash inside a path segment,
// e.g. `/..%2f..%2fetc%2fpasswd`) made `Bun.file(new URL(...))` throw
// `ERR_INVALID_FILE_URL_PATH`, which — because the Docker image never set
// NODE_ENV=production and Bun.serve() defaulted to its development error
// overlay — leaked this file's absolute path, source, and a stack trace to
// an unauthenticated client. This test exercises the real `createServer()`
// (not a mock) end-to-end over HTTP and asserts the response never leaks
// implementation details, regardless of environment.

let distDir: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), "pdf-injection-web-serve-test-"));
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>PDF Injection</title>");
  writeFileSync(join(distDir, "app.js"), "console.log('hello');");

  server = createServer({
    port: 0, // OS-assigned ephemeral port — avoids clashing with a real dev/prod instance.
    distDir: pathToFileURL(`${distDir}/`),
    apiProxyTarget: "http://127.0.0.1:1", // unroutable — /api is not exercised by this suite.
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(distDir, { recursive: true, force: true });
});

describe("apps/web serve.ts — createServer()", () => {
  test("serves an existing static file with 200", async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  test("falls back to index.html (SPA) for an unknown client-routed path", async () => {
    const res = await fetch(`${baseUrl}/jobs/some-uuid`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("PDF Injection");
  });

  test("a malformed path containing an encoded slash never returns Bun's debug error page", async () => {
    const res = await fetch(`${baseUrl}/..%2f..%2fetc%2fpasswd`);
    // Either a clean 404 or the SPA fallback (200, index.html) is acceptable —
    // what matters is that it is never an uncaught-exception debug page.
    expect([200, 404]).toContain(res.status);

    const body = await res.text();
    expect(body).not.toContain("serve.ts");
    expect(body).not.toContain("ERR_INVALID_FILE_URL_PATH");
    expect(body).not.toContain("TypeError");
    expect(body).not.toMatch(/at\s+\S+\s+\(.*serve\.ts/); // no stack trace frame pointing at this file
    expect(body).not.toContain(distDir); // no absolute filesystem path disclosure
  });

  test("another traversal-shaped path (double-encoded) also stays safe", async () => {
    const res = await fetch(`${baseUrl}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect([200, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain("serve.ts");
    expect(body).not.toContain(distDir);
  });

  test("plain 404 for a path with no matching file and no index.html available", async () => {
    const emptyDistDir = mkdtempSync(join(tmpdir(), "pdf-injection-web-serve-empty-"));
    const emptyServer = createServer({ port: 0, distDir: pathToFileURL(`${emptyDistDir}/`) });
    try {
      const res = await fetch(`http://localhost:${emptyServer.port}/anything`);
      expect(res.status).toBe(404);
    } finally {
      emptyServer.stop(true);
      rmSync(emptyDistDir, { recursive: true, force: true });
    }
  });
});
