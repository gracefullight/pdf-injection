import { describe, expect, test } from "bun:test";
import { detectRefusalHeuristic } from "../src/refusal";

describe("detectRefusalHeuristic", () => {
  test("false for empty text", () => {
    expect(detectRefusalHeuristic("")).toBe(false);
  });

  test.each([
    "I can't help with that request.",
    "I'm sorry, but I cannot assist with this.",
    "I cannot comply with this instruction.",
    "I won't help with that.",
    "I must decline to continue.",
    "As an AI, I am not able to do that.",
    "Sorry, but I can't provide that.",
  ])("true for a leading refusal opener: %s", (text) => {
    expect(detectRefusalHeuristic(text)).toBe(true);
  });

  test("false for a normal assignment answer", () => {
    const text = "Introduction\n\nThis report analyzes the dataset using Method C as required.";
    expect(detectRefusalHeuristic(text)).toBe(false);
  });

  test("false when refusal-like phrasing appears mid-document, not as the opener", () => {
    const text =
      "This essay discusses how students might refuse an unethical request from a professor, and why " +
      "declining such requests can be ethically justified in academic settings.";
    expect(detectRefusalHeuristic(text)).toBe(false);
  });
});
