import { describe, expect, test } from "bun:test";
import type { PageGeometry } from "@pdf-injection/contracts";
import { compareGeometry } from "../src/compare-geometry";

function page(overrides: Partial<PageGeometry> = {}): PageGeometry {
  return {
    pageIndex: 0,
    mediaBox: [0, 0, 612, 792],
    cropBox: [0, 0, 612, 792],
    rotation: 0,
    width: 612,
    height: 792,
    ...overrides,
  };
}

describe("compareGeometry", () => {
  test("passes when before and after are identical", () => {
    const result = compareGeometry([page()], [page()]);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  test("passes for multi-page identical documents", () => {
    const before = [page({ pageIndex: 0 }), page({ pageIndex: 1, rotation: 90 })];
    const after = [page({ pageIndex: 0 }), page({ pageIndex: 1, rotation: 90 })];
    expect(compareGeometry(before, after).passed).toBe(true);
  });

  test("fails when page count differs", () => {
    const result = compareGeometry([page()], [page(), page({ pageIndex: 1 })]);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.field === "pageCount")).toBe(true);
  });

  test("fails and records a mismatch when mediaBox differs", () => {
    const result = compareGeometry([page()], [page({ mediaBox: [0, 0, 600, 792] })]);
    expect(result.passed).toBe(false);
    expect(result.mismatches).toContainEqual(
      expect.objectContaining({ pageIndex: 0, field: "mediaBox" }),
    );
  });

  test("fails and records a mismatch when cropBox differs", () => {
    const result = compareGeometry([page()], [page({ cropBox: [0, 0, 600, 792] })]);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.field === "cropBox")).toBe(true);
  });

  test("fails and records a mismatch when rotation differs", () => {
    const result = compareGeometry([page()], [page({ rotation: 90 })]);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.field === "rotation")).toBe(true);
  });

  test("fails and records a mismatch when width or height differs", () => {
    const result = compareGeometry([page()], [page({ width: 611 })]);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.field === "width")).toBe(true);
  });

  test("accumulates multiple mismatches across pages", () => {
    const before = [page({ pageIndex: 0 }), page({ pageIndex: 1 })];
    const after = [page({ pageIndex: 0, rotation: 90 }), page({ pageIndex: 1, height: 100 })];
    const result = compareGeometry(before, after);
    expect(result.passed).toBe(false);
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
  });
});
