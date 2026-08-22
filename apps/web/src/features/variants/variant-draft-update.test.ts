import { describe, expect, it } from "bun:test";
import {
  updateStudentKeyedDraft,
  updateVariantDraft,
} from "@/features/variants/variant-draft-update";
import { defaultStudentKeyedDraft, defaultVariantDraft } from "@/features/variants/variant-types";

describe("updateVariantDraft", () => {
  it("clears acknowledgedWarnings when the instruction changes", () => {
    const variant = { ...defaultVariantDraft("A"), acknowledgedWarnings: ["jailbreak_phrasing"] };
    const next = updateVariantDraft(variant, { instruction: "new text" });
    expect(next.instruction).toBe("new text");
    expect(next.acknowledgedWarnings).toEqual([]);
  });

  it("clears acknowledgedWarnings when signals change", () => {
    const variant = { ...defaultVariantDraft("A"), acknowledgedWarnings: ["jailbreak_phrasing"] };
    const next = updateVariantDraft(variant, {
      signals: [{ type: "exact_phrase", value: "x", caseSensitive: false }],
    });
    expect(next.acknowledgedWarnings).toEqual([]);
  });

  it("does not touch acknowledgedWarnings when the patch is the acknowledgement itself", () => {
    const variant = { ...defaultVariantDraft("A"), acknowledgedWarnings: [] };
    const next = updateVariantDraft(variant, { acknowledgedWarnings: ["jailbreak_phrasing"] });
    expect(next.acknowledgedWarnings).toEqual(["jailbreak_phrasing"]);
  });

  it("does not touch acknowledgedWarnings for an unrelated patch (e.g. label)", () => {
    const variant = { ...defaultVariantDraft("A"), acknowledgedWarnings: ["jailbreak_phrasing"] };
    const next = updateVariantDraft(variant, { label: "B" });
    expect(next.acknowledgedWarnings).toEqual(["jailbreak_phrasing"]);
  });
});

describe("updateStudentKeyedDraft", () => {
  it("clears acknowledgedWarnings when the instruction template changes", () => {
    const draft = { ...defaultStudentKeyedDraft(), acknowledgedWarnings: ["jailbreak_phrasing"] };
    const next = updateStudentKeyedDraft(draft, { instructionTemplate: "new {{KEY}} text" });
    expect(next.acknowledgedWarnings).toEqual([]);
  });

  it("clears acknowledgedWarnings when expected signals change", () => {
    const draft = { ...defaultStudentKeyedDraft(), acknowledgedWarnings: ["jailbreak_phrasing"] };
    const next = updateStudentKeyedDraft(draft, {
      expectedSignals: [{ type: "exact_phrase", value: "{{KEY}}", caseSensitive: true }],
    });
    expect(next.acknowledgedWarnings).toEqual([]);
  });

  it("does not touch acknowledgedWarnings for an unrelated patch (e.g. keyLength)", () => {
    const draft = { ...defaultStudentKeyedDraft(), acknowledgedWarnings: ["jailbreak_phrasing"] };
    const next = updateStudentKeyedDraft(draft, { keyLength: 12 });
    expect(next.acknowledgedWarnings).toEqual(["jailbreak_phrasing"]);
  });
});
