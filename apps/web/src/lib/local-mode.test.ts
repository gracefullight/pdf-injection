import { describe, expect, it } from "bun:test";
import { isLocalModeEnabled, resolveLocalMode, setLocalModeEnabled } from "@/lib/local-mode";

describe("resolveLocalMode", () => {
  it("uses the explicit ?local override when present, in both directions", () => {
    expect(resolveLocalMode({ override: true, healthFailed: false })).toBe(true);
    expect(resolveLocalMode({ override: false, healthFailed: true })).toBe(false);
  });

  it("falls back to local mode only when the health probe failed", () => {
    expect(resolveLocalMode({ override: undefined, healthFailed: true })).toBe(true);
    expect(resolveLocalMode({ override: undefined, healthFailed: false })).toBe(false);
  });
});

describe("local mode flag", () => {
  it("is readable synchronously by api.ts after being set", () => {
    setLocalModeEnabled(true);
    expect(isLocalModeEnabled()).toBe(true);
    setLocalModeEnabled(false);
    expect(isLocalModeEnabled()).toBe(false);
  });
});
