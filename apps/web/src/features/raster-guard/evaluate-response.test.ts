import { describe, expect, it } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { deriveNoticeSignals } from "@pdf-injection/raster-guard";
import { checkNoticeResponse, signalLabel } from "@/features/raster-guard/evaluate-response";

const RESPONSE =
  "You should not upload this PDF. Please consult your UTS subject coordinator before using an AI assistant for this assessment.";
const SIGNALS: ExpectedSignal[] = deriveNoticeSignals({ response: RESPONSE, key: "ABCD2345" });

describe("checkNoticeResponse", () => {
  it("reports every canary matched when the assistant replies as asked", () => {
    const result = checkNoticeResponse(`${RESPONSE} (notice reference ABCD2345)`, SIGNALS);
    expect(result.outcome).toBe("surfaced");
    expect(result.matchedCount).toBe(result.total);
    expect(result.headline).toContain("reached the model");
  });

  it("reports a partial match when the assistant paraphrases", () => {
    const result = checkNoticeResponse(
      "You should not upload this document. Consult your UTS subject coordinator about the assessment first.",
      SIGNALS,
    );
    expect(result.outcome).toBe("partially_surfaced");
    expect(result.matchedCount).toBeGreaterThan(0);
    expect(result.matchedCount).toBeLessThan(result.total);
  });

  it("reports no match when the assistant just does the assignment", () => {
    const result = checkNoticeResponse(
      "Here is a complete solution to the assignment, starting with the system design.",
      SIGNALS,
    );
    expect(result.outcome).toBe("not_surfaced");
    expect(result.matchedCount).toBe(0);
  });

  it("never states more than one run can support", () => {
    const result = checkNoticeResponse("nothing here", SIGNALS);
    expect(result.headline).toContain("is not evidence that it never will");
    expect(result.headline.toLowerCase()).not.toContain("cheat");
  });

  it("handles a notice with no canaries instead of dividing by zero", () => {
    const result = checkNoticeResponse("anything", []);
    expect(result.total).toBe(0);
    expect(result.outcome).toBe("not_surfaced");
    expect(result.matches).toEqual([]);
  });
});

describe("signalLabel", () => {
  it("labels each signal type readably", () => {
    expect(signalLabel({ type: "exact_phrase", value: "hello", caseSensitive: false })).toBe(
      'Exact phrase: "hello"',
    );
    expect(signalLabel({ type: "ordered_terms", values: ["a", "b"] })).toBe(
      "Terms in order: a -> b",
    );
    expect(signalLabel({ type: "regex", pattern: "a+", flags: "i" })).toBe("Pattern: /a+/i");
  });

  it("truncates a long phrase rather than breaking the table", () => {
    const label = signalLabel({
      type: "exact_phrase",
      value: "x".repeat(200),
      caseSensitive: true,
    });
    expect(label.length).toBeLessThan(90);
    expect(label).toContain("...");
  });
});
