import { describe, expect, test } from "bun:test";
import { sectionOrderMatch } from "../src/section-order";

describe("sectionOrderMatch", () => {
  test("detects markdown headings and checks order", () => {
    const text = "# Introduction\nSome text.\n\n## Methods\nMore text.\n\n## Results\nFinal text.";
    const result = sectionOrderMatch(["Introduction", "Methods", "Results"], text);
    expect(result.matched).toBe(true);
    expect(result.headings.map((h) => h.text)).toEqual(["Introduction", "Methods", "Results"]);
  });

  test("detects numbered headings ('1.' and '1)')", () => {
    const text = "1. Introduction\nSome text.\n2) Methods\nMore text.\n3. Results\nFinal text.";
    const result = sectionOrderMatch(["Introduction", "Methods", "Results"], text);
    expect(result.matched).toBe(true);
  });

  test("detects ALL-CAPS short lines as headings", () => {
    const text = "INTRODUCTION\nSome text.\nMETHODS\nMore text.\nRESULTS\nFinal text.";
    const result = sectionOrderMatch(["Introduction", "Methods", "Results"], text);
    expect(result.matched).toBe(true);
  });

  test("detects lines ending with a colon as headings", () => {
    const text = "Introduction:\nSome text.\nMethods:\nMore text.\nResults:\nFinal text.";
    const result = sectionOrderMatch(["Introduction", "Methods", "Results"], text);
    expect(result.matched).toBe(true);
  });

  test("fails when required sections appear out of order", () => {
    const text = "# Results\nFinal text.\n\n# Introduction\nSome text.";
    const result = sectionOrderMatch(["Introduction", "Results"], text);
    expect(result.matched).toBe(false);
  });

  test("fails when a required section heading is missing", () => {
    const text = "# Introduction\nSome text.\n\n# Results\nFinal text.";
    const result = sectionOrderMatch(["Introduction", "Methods", "Results"], text);
    expect(result.matched).toBe(false);
    expect(result.positions[1]).toBeNull();
  });

  test("empty text does not match a non-empty section list", () => {
    const result = sectionOrderMatch(["Introduction"], "");
    expect(result.matched).toBe(false);
    expect(result.headings).toEqual([]);
  });

  test("a long ALL-CAPS-like line (not short) is not treated as a heading", () => {
    const longCaps = "A".repeat(90);
    const text = `${longCaps}\nbody text here.`;
    const result = sectionOrderMatch([longCaps], text);
    expect(result.matched).toBe(false);
  });

  test("plain body sentences ending mid-paragraph are not falsely detected as headings", () => {
    const text =
      "This is just a normal paragraph without any heading markers at all, spanning one long line.";
    const result = sectionOrderMatch(["normal paragraph"], text);
    expect(result.matched).toBe(false);
    expect(result.headings).toEqual([]);
  });
});
