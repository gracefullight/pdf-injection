import { describe, expect, test } from "bun:test";
import {
  isDistributionRequest,
  isModelTestRequest,
  isRobustnessRequest,
  isSubmissionFields,
  isVariantSpecArray,
  parseStudentIds,
  parseVariantSpecs,
} from "../src/validators-research";

const SIGNAL = { type: "methodology_label" as const, value: "Method C", aliases: ["method c"] };

describe("isVariantSpecArray / parseVariantSpecs", () => {
  test("accepts a valid 2-variant array", () => {
    const variants = [
      { label: "A", instruction: "Use Method A", expectedSignals: [SIGNAL] },
      { label: "B", instruction: "Use Method B", expectedSignals: [SIGNAL] },
    ];
    expect(isVariantSpecArray(variants)).toBe(true);
    expect(parseVariantSpecs(JSON.stringify(variants), 8)).toEqual(variants);
  });

  test("rejects fewer than 2 variants", () => {
    expect(isVariantSpecArray([{ label: "A", instruction: "x", expectedSignals: [SIGNAL] }])).toBe(
      false,
    );
  });

  test("parseVariantSpecs throws on malformed JSON", () => {
    expect(() => parseVariantSpecs("not json", 8)).toThrow();
  });

  test("parseVariantSpecs throws when exceeding maxVariants", () => {
    const variants = Array.from({ length: 3 }, (_, i) => ({
      label: String(i),
      instruction: "x",
      expectedSignals: [SIGNAL],
    }));
    expect(() => parseVariantSpecs(JSON.stringify(variants), 2)).toThrow();
  });

  test("parseVariantSpecs throws on duplicate labels", () => {
    const variants = [
      { label: "A", instruction: "x", expectedSignals: [SIGNAL] },
      { label: "A", instruction: "y", expectedSignals: [SIGNAL] },
    ];
    expect(() => parseVariantSpecs(JSON.stringify(variants), 8)).toThrow();
  });
});

describe("isDistributionRequest", () => {
  test("accepts a valid round_robin request", () => {
    expect(isDistributionRequest({ studentIds: ["s1", "s2"], strategy: "round_robin" })).toBe(true);
  });

  test("accepts a valid seeded_hash request with a seed", () => {
    expect(
      isDistributionRequest({ studentIds: ["s1"], strategy: "seeded_hash", seed: "abc" }),
    ).toBe(true);
  });

  test("rejects an unknown strategy", () => {
    expect(isDistributionRequest({ studentIds: ["s1"], strategy: "random" })).toBe(false);
  });

  test("rejects an empty studentIds array", () => {
    expect(isDistributionRequest({ studentIds: [], strategy: "round_robin" })).toBe(false);
  });
});

describe("parseStudentIds", () => {
  test("accepts a valid array under the limit", () => {
    expect(parseStudentIds(JSON.stringify(["s1", "s2"]), 500)).toEqual(["s1", "s2"]);
  });

  test("throws on malformed JSON", () => {
    expect(() => parseStudentIds("not json", 500)).toThrow();
  });

  test("throws when exceeding maxStudentKeys", () => {
    expect(() => parseStudentIds(JSON.stringify(["s1", "s2", "s3"]), 2)).toThrow();
  });

  test("throws on duplicate ids", () => {
    expect(() => parseStudentIds(JSON.stringify(["s1", "s1"]), 500)).toThrow();
  });
});

describe("isModelTestRequest", () => {
  // Note: this asserts BenchmarkConditionSchema accepts "unicode_tags" for the
  // `conditions` field of POST /api/v1/jobs/:jobId/model-tests. It does NOT
  // verify that POST /api/v1/jobs accepts `injectionMode: "unicode_tags"` —
  // that field is gated at runtime by a separate hardcoded array in
  // apps/api/src/services/job.service.ts, verified in
  // apps/api/test/unicode-tags.test.ts (task-3). Do not conflate the two.
  test("accepts conditions including unicode_tags", () => {
    expect(
      isModelTestRequest({
        providers: [{ name: "mock" }],
        conditions: ["unicode_tags"],
        repeats: 1,
        acknowledgeExternalTransfer: false,
      }),
    ).toBe(true);
  });

  // Round-3 probe conditions (see packages/pdf-engine's image_only /
  // freetext_annot / acroform_field / info_dict injectors). Same caveat as
  // the unicode_tags note above: this only asserts the wire schema accepts
  // them for `conditions`, not that POST /api/v1/jobs accepts them as an
  // `injectionMode` (apps/api's own hardcoded gate, out of this package's
  // scope).
  test("accepts conditions including the round-3 probe modes", () => {
    expect(
      isModelTestRequest({
        providers: [{ name: "mock" }],
        conditions: ["image_only", "freetext_annot", "acroform_field", "info_dict", "actual_text"],
        repeats: 1,
        acknowledgeExternalTransfer: false,
      }),
    ).toBe(true);
  });

  test("accepts a valid request with explicit conditions", () => {
    expect(
      isModelTestRequest({
        providers: [{ name: "mock" }],
        conditions: ["original", "white_text"],
        repeats: 1,
        acknowledgeExternalTransfer: true,
      }),
    ).toBe(true);
  });

  test("accepts conditions: 'all'", () => {
    expect(
      isModelTestRequest({
        providers: [{ name: "anthropic", model: "claude-opus-5" }],
        conditions: "all",
        repeats: 3,
        outerPrompt: "Read the PDF.",
        acknowledgeExternalTransfer: true,
      }),
    ).toBe(true);
  });

  test("rejects an empty providers array", () => {
    expect(
      isModelTestRequest({
        providers: [],
        conditions: "all",
        repeats: 1,
        acknowledgeExternalTransfer: true,
      }),
    ).toBe(false);
  });

  test("rejects a non-boolean acknowledgeExternalTransfer", () => {
    expect(
      isModelTestRequest({
        providers: [{ name: "mock" }],
        conditions: "all",
        repeats: 1,
        acknowledgeExternalTransfer: "yes",
      }),
    ).toBe(false);
  });

  test("rejects repeats < 1", () => {
    expect(
      isModelTestRequest({
        providers: [{ name: "mock" }],
        conditions: "all",
        repeats: 0,
        acknowledgeExternalTransfer: true,
      }),
    ).toBe(false);
  });
});

describe("isRobustnessRequest", () => {
  test("accepts a valid request with a custom text source", () => {
    expect(
      isRobustnessRequest({
        pdfTransforms: ["print_to_pdf"],
        textTransforms: ["human_edit"],
        textSource: { kind: "custom", texts: ["some text"] },
        providers: [{ name: "mock" }],
        repeats: 1,
        acknowledgeExternalTransfer: false,
      }),
    ).toBe(true);
  });

  test("accepts a model_test_run text source", () => {
    expect(
      isRobustnessRequest({
        pdfTransforms: [],
        textTransforms: [],
        textSource: { kind: "model_test_run", runId: "abc" },
        providers: [],
        repeats: 1,
        acknowledgeExternalTransfer: false,
      }),
    ).toBe(true);
  });

  test("rejects an invalid textSource kind", () => {
    expect(
      isRobustnessRequest({
        pdfTransforms: [],
        textTransforms: [],
        textSource: { kind: "bogus" },
        providers: [],
        repeats: 1,
        acknowledgeExternalTransfer: false,
      }),
    ).toBe(false);
  });
});

describe("isSubmissionFields", () => {
  test("accepts a valid candidate submission", () => {
    expect(
      isSubmissionFields({ label: "candidate", acknowledgeNoRealStudentData: true, text: "hello" }),
    ).toBe(true);
  });

  test("rejects acknowledgeNoRealStudentData: false", () => {
    expect(isSubmissionFields({ label: "candidate", acknowledgeNoRealStudentData: false })).toBe(
      false,
    );
  });

  test("rejects an unknown label", () => {
    expect(isSubmissionFields({ label: "unknown", acknowledgeNoRealStudentData: true })).toBe(
      false,
    );
  });
});
