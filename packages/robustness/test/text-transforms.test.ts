import { describe, expect, test } from "bun:test";
import { transformText } from "../src/text-transforms";

const SAMPLE =
  "This assignment asks students to analyze the significant robustness and limitations of the proposed approach. " +
  "The methodology is comprehensive and the findings are substantial. " +
  "Method C outperforms the other methods on the provided dataset. " +
  "Therefore we conclude the approach is robust. " +
  "Furthermore the results demonstrate consistent gains across every condition tested.";

describe("transformText — human_edit", () => {
  test("is deterministic for the same seed and input", async () => {
    const a = await transformText("human_edit", SAMPLE, { seed: "seed-1" });
    const b = await transformText("human_edit", SAMPLE, { seed: "seed-1" });
    expect(a.available).toBe(true);
    expect(a.provider).toBe("mock");
    expect(a.text).toBe(b.text);
  });

  test("different seeds tend to produce different output", async () => {
    const a = await transformText("human_edit", SAMPLE, { seed: "seed-1" });
    const b = await transformText("human_edit", SAMPLE, { seed: "wildly-different-seed-42" });
    expect(a.text).not.toBe(b.text);
  });

  test("never drops a protected term", async () => {
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const result = await transformText("human_edit", SAMPLE, {
        seed,
        protectedTerms: ["Method"],
      });
      expect(result.available).toBe(true);
      expect(result.text?.toLowerCase()).toContain("method");
    }
  });

  test("edits a single-sentence input without losing it entirely", async () => {
    const result = await transformText("human_edit", "Only one sentence here.", { seed: "solo" });
    expect(result.available).toBe(true);
    expect(result.text).not.toBe("");
  });
});

describe("transformText — paraphrase (mock)", () => {
  test("is deterministic for the same seed and input", async () => {
    const a = await transformText("paraphrase", SAMPLE, { seed: "p-1" });
    const b = await transformText("paraphrase", SAMPLE, { seed: "p-1" });
    expect(a.available).toBe(true);
    expect(a.provider).toBe("mock");
    expect(a.text).toBe(b.text);
  });

  test("substitutes known academic-vocabulary synonyms", async () => {
    const result = await transformText(
      "paraphrase",
      "The results are significant and the approach is robust.",
      {
        seed: "syn-check",
      },
    );
    expect(result.available).toBe(true);
    expect(result.text).toContain("notable");
    expect(result.text).not.toContain("significant");
  });

  test("uses the provided TextProvider instead of the mock table when given", async () => {
    const result = await transformText("paraphrase", SAMPLE, {
      provider: {
        name: "mock-provider",
        askText: async ({ text }) => ({ text: `PARAPHRASED:${text.length}` }),
      },
    });
    expect(result.available).toBe(true);
    expect(result.provider).toBe("mock-provider");
    expect(result.text).toBe(`PARAPHRASED:${SAMPLE.length}`);
  });

  test("reports available:false with the provider's error when the provider call fails", async () => {
    const result = await transformText("paraphrase", SAMPLE, {
      provider: {
        name: "flaky",
        askText: async () => {
          throw new Error("network down");
        },
      },
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("network down");
    expect(result.text).toBeNull();
  });

  // Cycle 3 QA fix (HIGH): r3's real ProviderAdapter.askText never throws on
  // failure — it *resolves* with `error` set and `text: ""`. Fabricating
  // `available:true, text:""` here would feed an empty "transformed" sample
  // into survival.ts and misreport it as 0% signal survival.
  test("reports available:false with the resolved error when the provider resolves with { error } instead of throwing", async () => {
    const result = await transformText("paraphrase", SAMPLE, {
      provider: {
        name: "anthropic",
        askText: async () => ({ text: "", error: "PROVIDER_NOT_CONFIGURED" }),
      },
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.text).toBeNull();
    expect(result.provider).toBe("anthropic");
  });

  test("reports available:false when the provider resolves with empty text and no error field", async () => {
    const result = await transformText("paraphrase", SAMPLE, {
      provider: {
        name: "odd-provider",
        askText: async () => ({ text: "" }),
      },
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("empty result");
    expect(result.text).toBeNull();
  });
});

describe("transformText — translation", () => {
  test("is gated: unavailable without a provider", async () => {
    const result = await transformText("translation", SAMPLE, {});
    expect(result.available).toBe(false);
    expect(result.reason).toBe("translation requires a configured provider");
    expect(result.text).toBeNull();
  });

  test("calls the provider with a translate prompt including the target language", async () => {
    let capturedPrompt = "";
    const result = await transformText("translation", SAMPLE, {
      targetLanguage: "Korean",
      provider: {
        name: "mock-translator",
        askText: async ({ prompt }) => {
          capturedPrompt = prompt;
          return { text: "번역된 텍스트" };
        },
      },
    });
    expect(result.available).toBe(true);
    expect(result.provider).toBe("mock-translator");
    expect(result.text).toBe("번역된 텍스트");
    expect(capturedPrompt).toContain("Korean");
    expect(capturedPrompt).toContain(SAMPLE);
  });

  // Cycle 3 QA fix (HIGH), translation side.
  test("reports available:false with the resolved error when the provider resolves with { error } instead of throwing", async () => {
    const result = await transformText("translation", SAMPLE, {
      targetLanguage: "Korean",
      provider: {
        name: "openai",
        askText: async () => ({ text: "", error: "RATE_LIMITED" }),
      },
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("RATE_LIMITED");
    expect(result.text).toBeNull();
    expect(result.provider).toBe("openai");
  });
});
