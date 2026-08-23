import { describe, expect, it } from "bun:test";
import { ApiRequestError, resolveEdenDomain, unwrapEden } from "@/lib/api";
import { readErrorPayload } from "@/lib/eden-client";

describe("resolveEdenDomain", () => {
  it("resolves the default relative base URL to the page origin, so Vite's dev proxy still applies", () => {
    expect(resolveEdenDomain("/api", "http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("falls back to a hardcoded dev origin when no page origin is available (e.g. non-browser eval)", () => {
    expect(resolveEdenDomain("/api", undefined)).toBe("http://localhost:5173");
  });

  it("passes an absolute base URL through unchanged when it has no trailing /api", () => {
    expect(resolveEdenDomain("http://localhost:3001", "http://localhost:5173")).toBe(
      "http://localhost:3001",
    );
  });

  it("strips a trailing /api suffix from an absolute base URL", () => {
    expect(resolveEdenDomain("http://localhost:3001/api", "http://localhost:5173")).toBe(
      "http://localhost:3001",
    );
  });

  it("strips a trailing /api/ (with slash) suffix too", () => {
    expect(resolveEdenDomain("http://localhost:3001/api/", "http://localhost:5173")).toBe(
      "http://localhost:3001",
    );
  });

  it("works with https origins", () => {
    expect(resolveEdenDomain("https://api.example.com/api", "https://app.example.com")).toBe(
      "https://api.example.com",
    );
  });
});

describe("unwrapEden", () => {
  it("returns data unchanged when error is null", () => {
    const result = unwrapEden<{ ok: true }>({ data: { ok: true }, error: null, status: 200 });
    expect(result).toEqual({ ok: true });
  });

  it("returns data unchanged when error is undefined", () => {
    const result = unwrapEden<{ ok: true }>({ data: { ok: true }, error: undefined, status: 200 });
    expect(result).toEqual({ ok: true });
  });

  it("throws ApiRequestError with the code/message/details from Eden's error envelope", () => {
    const edenResult = {
      data: null,
      error: {
        status: 404,
        value: {
          error: {
            code: "JOB_NOT_FOUND",
            message: "This job does not exist or has expired.",
            details: { foo: "bar" },
          },
        },
      },
      status: 404,
    };

    let caught: unknown;
    try {
      unwrapEden(edenResult);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.status).toBe(404);
    expect(error.code).toBe("JOB_NOT_FOUND");
    expect(error.message).toBe("This job does not exist or has expired.");
    expect(error.details).toEqual({ foo: "bar" });
  });

  it("maps a non-envelope error response to API_UNAVAILABLE, never VALIDATION_ERROR", () => {
    // Regression: a static host (GitHub Pages) with no API backend answers POST /api/v1/jobs
    // with a bodyless 405; this used to surface as VALIDATION_ERROR ("The request contains
    // invalid or missing fields"), blaming the user's input for a deployment problem.
    let caught: unknown;
    try {
      unwrapEden({ data: null, error: { status: 405, value: "" }, status: 405 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.code).toBe("API_UNAVAILABLE");
    expect(error.status).toBe(405);
    expect(error.message).toContain("HTTP 405");
    expect(error.message).toContain("VITE_API_BASE_URL");
  });

  it("also maps an unexpected-shape error object (e.g. gateway JSON) to API_UNAVAILABLE", () => {
    let caught: unknown;
    try {
      unwrapEden({ data: null, error: { unexpected: true }, status: 500 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.code).toBe("API_UNAVAILABLE");
    expect(error.status).toBe(500);
  });

  it("readErrorPayload: a non-JSON 404 from a static host becomes API_UNAVAILABLE", async () => {
    const payload = await readErrorPayload(
      new Response("<!doctype html><title>404</title>", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );
    // `code` is typed as the server's ApiErrorCode union; the synthetic client-only code is
    // deliberately outside it (see `apiUnavailableError`), hence the widening to string.
    expect(payload.code as string).toBe("API_UNAVAILABLE");
    expect(payload.message).toContain("HTTP 404");
  });

  it("also narrows an error envelope with no `.value` wrapper (error is the payload directly)", () => {
    let caught: unknown;
    try {
      unwrapEden({
        data: null,
        error: {
          error: {
            code: "JOB_FORBIDDEN",
            message: "Missing or invalid access token for this job.",
          },
        },
        status: 403,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.code).toBe("JOB_FORBIDDEN");
    expect(error.status).toBe(403);
  });
});
