import { describe, expect, test } from "bun:test";
import {
  ALL_CONDITIONS,
  DEFAULT_OUTER_PROMPT,
  ExperimentConfigError,
  parseExperimentConfig,
  parseExperimentConfigJson,
  resolveConditions,
  toModelTestRequest,
} from "../src/config";

const VALID_CONFIG = {
  jobRef: "tests/fixtures/five-page-text.pdf",
  providers: [{ name: "mock" }],
  conditions: ["original", "white_text"],
  repeats: 3,
  outerPrompt: DEFAULT_OUTER_PROMPT,
  acknowledgeExternalTransfer: false,
  notes: "smoke test",
};

describe("parseExperimentConfig", () => {
  test("accepts a valid config (matches research/experiment-configs/example-matrix.json shape)", () => {
    const parsed = parseExperimentConfig(VALID_CONFIG);
    expect(parsed.jobRef).toBe(VALID_CONFIG.jobRef);
    expect(parsed.providers).toEqual([{ name: "mock", model: undefined }]);
    expect(parsed.conditions).toEqual(["original", "white_text"]);
    expect(parsed.repeats).toBe(3);
  });

  test('accepts conditions: "all"', () => {
    const parsed = parseExperimentConfig({ ...VALID_CONFIG, conditions: "all" });
    expect(parsed.conditions).toBe("all");
  });

  test("accepts the 4 round-3 probe conditions (image_only, freetext_annot, acroform_field, info_dict)", () => {
    const parsed = parseExperimentConfig({
      ...VALID_CONFIG,
      conditions: ["image_only", "freetext_annot", "acroform_field", "info_dict"],
    });
    expect(parsed.conditions).toEqual([
      "image_only",
      "freetext_annot",
      "acroform_field",
      "info_dict",
    ]);
  });

  test("rejects a non-object", () => {
    expect(() => parseExperimentConfig("not an object")).toThrow(ExperimentConfigError);
    expect(() => parseExperimentConfig(null)).toThrow(ExperimentConfigError);
    expect(() => parseExperimentConfig([])).toThrow(ExperimentConfigError);
  });

  test("rejects a missing/empty jobRef", () => {
    expect(() => parseExperimentConfig({ ...VALID_CONFIG, jobRef: "" })).toThrow(
      ExperimentConfigError,
    );
    const { jobRef: _jobRef, ...withoutJobRef } = VALID_CONFIG;
    expect(() => parseExperimentConfig(withoutJobRef)).toThrow(ExperimentConfigError);
  });

  test("rejects an empty providers array", () => {
    expect(() => parseExperimentConfig({ ...VALID_CONFIG, providers: [] })).toThrow(
      ExperimentConfigError,
    );
  });

  test("rejects an invalid provider name", () => {
    expect(() =>
      parseExperimentConfig({ ...VALID_CONFIG, providers: [{ name: "gemini" }] }),
    ).toThrow(ExperimentConfigError);
  });

  test("rejects an invalid condition value", () => {
    expect(() =>
      parseExperimentConfig({ ...VALID_CONFIG, conditions: ["not_a_real_condition"] }),
    ).toThrow(ExperimentConfigError);
  });

  test("rejects duplicate conditions", () => {
    expect(() =>
      parseExperimentConfig({ ...VALID_CONFIG, conditions: ["original", "original"] }),
    ).toThrow(ExperimentConfigError);
  });

  test("rejects repeats outside [1, 10]", () => {
    expect(() => parseExperimentConfig({ ...VALID_CONFIG, repeats: 0 })).toThrow(
      ExperimentConfigError,
    );
    expect(() => parseExperimentConfig({ ...VALID_CONFIG, repeats: 11 })).toThrow(
      ExperimentConfigError,
    );
    expect(() => parseExperimentConfig({ ...VALID_CONFIG, repeats: 1.5 })).toThrow(
      ExperimentConfigError,
    );
  });

  test("rejects a missing/empty outerPrompt", () => {
    expect(() => parseExperimentConfig({ ...VALID_CONFIG, outerPrompt: "" })).toThrow(
      ExperimentConfigError,
    );
  });

  test("requires acknowledgeExternalTransfer:true when a non-mock provider is present", () => {
    expect(() =>
      parseExperimentConfig({
        ...VALID_CONFIG,
        providers: [{ name: "anthropic" }],
        acknowledgeExternalTransfer: false,
      }),
    ).toThrow(ExperimentConfigError);

    expect(() =>
      parseExperimentConfig({
        ...VALID_CONFIG,
        providers: [{ name: "anthropic" }],
        acknowledgeExternalTransfer: true,
      }),
    ).not.toThrow();
  });

  test("mock-only configs do not require acknowledgeExternalTransfer", () => {
    const { acknowledgeExternalTransfer: _ack, ...withoutAck } = VALID_CONFIG;
    expect(() => parseExperimentConfig(withoutAck)).not.toThrow();
  });
});

describe("parseExperimentConfigJson", () => {
  test("parses valid JSON", () => {
    const parsed = parseExperimentConfigJson(JSON.stringify(VALID_CONFIG));
    expect(parsed.jobRef).toBe(VALID_CONFIG.jobRef);
  });

  test("throws ExperimentConfigError on malformed JSON", () => {
    expect(() => parseExperimentConfigJson("{not valid json")).toThrow(ExperimentConfigError);
  });
});

describe("resolveConditions", () => {
  test('resolves "all" to every BenchmarkCondition', () => {
    expect(resolveConditions("all")).toEqual(ALL_CONDITIONS);
  });

  test("passes an explicit array through unchanged", () => {
    expect(resolveConditions(["original", "xmp_only"])).toEqual(["original", "xmp_only"]);
  });

  test('resolves "all" to include unicode_tags, 6 legacy conditions plus the 4 round-3 probe conditions (10 total)', () => {
    expect(ALL_CONDITIONS).toContain("unicode_tags");
    expect(ALL_CONDITIONS).toContain("image_only");
    expect(ALL_CONDITIONS).toContain("freetext_annot");
    expect(ALL_CONDITIONS).toContain("acroform_field");
    expect(ALL_CONDITIONS).toContain("info_dict");
    expect(ALL_CONDITIONS).toHaveLength(10);
  });

  test("resolves an explicit array containing unicode_tags unchanged", () => {
    expect(resolveConditions(["original", "unicode_tags"])).toEqual(["original", "unicode_tags"]);
  });
});

describe("research/experiment-configs/example-matrix.json (integration)", () => {
  test("the real example file on disk parses successfully", async () => {
    const path = new URL(
      "../../../research/experiment-configs/example-matrix.json",
      import.meta.url,
    );
    const json = await Bun.file(path).text();
    expect(() => parseExperimentConfigJson(json)).not.toThrow();
    const parsed = parseExperimentConfigJson(json);
    expect(parsed.providers).toEqual([{ name: "mock", model: undefined }]);
  });
});

describe("toModelTestRequest", () => {
  test("maps an ExperimentConfig to the wire-level ModelTestRequest, dropping jobRef/notes", () => {
    const config = parseExperimentConfig(VALID_CONFIG);
    const request = toModelTestRequest(config);
    expect(request).toEqual({
      providers: [{ name: "mock", model: undefined }],
      conditions: ["original", "white_text"],
      repeats: 3,
      outerPrompt: DEFAULT_OUTER_PROMPT,
      acknowledgeExternalTransfer: false,
    });
    expect((request as unknown as Record<string, unknown>).jobRef).toBeUndefined();
  });

  test("defaults acknowledgeExternalTransfer to false when absent", () => {
    const { acknowledgeExternalTransfer: _ack, ...withoutAck } = VALID_CONFIG;
    const config = parseExperimentConfig(withoutAck);
    expect(toModelTestRequest(config).acknowledgeExternalTransfer).toBe(false);
  });
});

describe("ollama provider (addendum §6) — local, no acknowledgement required", () => {
  test("accepts providers: [{ name: 'ollama' }] with acknowledgeExternalTransfer omitted/false, like mock", () => {
    const { acknowledgeExternalTransfer: _ack, ...withoutAck } = VALID_CONFIG;
    const config = parseExperimentConfig({ ...withoutAck, providers: [{ name: "ollama" }] });
    expect(config.providers).toEqual([{ name: "ollama", model: undefined }]);
    expect(toModelTestRequest(config).acknowledgeExternalTransfer).toBe(false);
  });

  test("still requires acknowledgeExternalTransfer when mixed with a real external provider", () => {
    expect(() =>
      parseExperimentConfig({
        ...VALID_CONFIG,
        providers: [{ name: "ollama" }, { name: "anthropic" }],
        acknowledgeExternalTransfer: false,
      }),
    ).toThrow(ExperimentConfigError);
  });
});
