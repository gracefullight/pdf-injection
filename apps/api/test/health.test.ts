import { describe, expect, test } from "bun:test";
import { testApp } from "./helpers";

describe("GET /api/v1/health", () => {
  test("returns ok status, version, qpdfAvailable, and round-2 feature flags", async () => {
    const { app } = testApp();
    const res = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(body.qpdfAvailable).toBe(false);
    expect(body.features).toEqual({
      externalProviders: false,
      researchMode: false,
      ocrAvailable: expect.any(Boolean),
      canvasAvailable: expect.any(Boolean),
      koPayload: expect.any(Boolean),
      zhPayload: expect.any(Boolean),
      ollama: {
        available: expect.any(Boolean),
        baseUrl: expect.any(String),
        models: expect.any(Array),
      },
    });
  });

  test("features.externalProviders / researchMode reflect config", async () => {
    const { app } = testApp({ allowExternalProviders: true, researchMode: true });
    const res = await app.handle(new Request("http://localhost/api/v1/health"));
    const body = await res.json();
    expect(body.features.externalProviders).toBe(true);
    expect(body.features.researchMode).toBe(true);
  });

  test("sets security headers", async () => {
    const { app } = testApp();
    const res = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  describe("features.ollama (round-2 addendum §6)", () => {
    test("unreachable Ollama base URL -> available:false, no throw, echoes the configured baseUrl", async () => {
      const { app } = testApp({ ollamaBaseUrl: "http://127.0.0.1:1" });
      const res = await app.handle(new Request("http://localhost/api/v1/health"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.features.ollama).toEqual({
        available: false,
        baseUrl: "http://127.0.0.1:1",
        models: [],
      });
    });

    test("a running fake Ollama /api/tags server -> available:true with its model list", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/tags") {
            return new Response(JSON.stringify({ models: [{ name: "llama3.1" }] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response("not found", { status: 404 });
        },
      });
      try {
        const { app } = testApp({ ollamaBaseUrl: `http://127.0.0.1:${server.port}` });
        const res = await app.handle(new Request("http://localhost/api/v1/health"));
        const body = await res.json();
        expect(body.features.ollama).toEqual({
          available: true,
          baseUrl: `http://127.0.0.1:${server.port}`,
          models: ["llama3.1"],
        });
      } finally {
        server.stop(true);
      }
    });
  });
});
