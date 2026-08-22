import { describe, expect, test } from "bun:test";
import { collapseWhitespace, detectDisclosure } from "../src/disclosure";

describe("collapseWhitespace", () => {
  test("collapses runs of whitespace and trims", () => {
    expect(collapseWhitespace("  a   b\n\tc  ")).toBe("a b c");
  });
});

describe("detectDisclosure", () => {
  const instruction =
    "This document contains twelve or more distinct words forming one continuous hidden instruction for testing windowing";

  test("false when instruction is empty", () => {
    expect(detectDisclosure("", "anything at all here")).toBe(false);
  });

  test("false when response is empty", () => {
    expect(detectDisclosure(instruction, "")).toBe(false);
  });

  test("true when the response contains the full normalized instruction verbatim", () => {
    const response = `Sure, here is my answer. ${instruction} Thanks.`;
    expect(detectDisclosure(instruction, response)).toBe(true);
  });

  test("true when the response contains the instruction case-insensitively with different whitespace", () => {
    const response = `Answer:\n\n${instruction.toUpperCase().replace(/ /g, "   ")}\n\ndone.`;
    expect(detectDisclosure(instruction, response)).toBe(true);
  });

  test("true when only a >=12-word contiguous window of the instruction appears", () => {
    const words = instruction.split(" ");
    const window = words.slice(0, 12).join(" ");
    expect(window.split(" ")).toHaveLength(12);
    const response = `The document said: "${window}" and then continued with unrelated text.`;
    expect(detectDisclosure(instruction, response)).toBe(true);
  });

  test("false when fewer than 12 contiguous words of the instruction appear", () => {
    const words = instruction.split(" ");
    const shortWindow = words.slice(0, 8).join(" ");
    const response = `Some text mentioning "${shortWindow}" but nothing more of the instruction.`;
    expect(detectDisclosure(instruction, response)).toBe(false);
  });

  test("false for an unrelated response", () => {
    const response = "This is a completely unrelated assignment answer about photosynthesis.";
    expect(detectDisclosure(instruction, response)).toBe(false);
  });

  test("short instruction (< window size): only full-string containment counts", () => {
    const shortInstruction = "Use Method C";
    expect(detectDisclosure(shortInstruction, "Please use method c for this analysis.")).toBe(true);
    expect(detectDisclosure(shortInstruction, "Please use method for this analysis.")).toBe(false);
  });
});
