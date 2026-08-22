import { describe, expect, it } from "bun:test";
import { ApiRequestError, resolveEdenDomain, unwrapEden } from "@/lib/api";

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

  it("falls back to a generic VALIDATION_ERROR when the error envelope doesn't have the expected shape", () => {
    let caught: unknown;
    try {
      unwrapEden({ data: null, error: { unexpected: true }, status: 500 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(500);
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
