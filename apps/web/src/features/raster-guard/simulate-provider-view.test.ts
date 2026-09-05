import { describe, expect, it } from "bun:test";
import { PROVIDER_PROFILES, providerImageScale } from "@pdf-injection/raster-guard";
import { providerTargetSize } from "@/features/raster-guard/simulate-provider-view";

describe("providerTargetSize", () => {
  it("reduces a Letter page rendered at 144 DPI to ChatGPT's 768px short edge", () => {
    const size = providerTargetSize(PROVIDER_PROFILES.chatgpt, 1224, 1584);
    expect(size.width).toBe(768);
    expect(size.height).toBe(993);
    expect(size.scale).toBeCloseTo(768 / 1224, 5);
  });

  it("leaves a Letter page at 144 DPI untouched on Claude's high-resolution tier", () => {
    // 44 x 57 = 2508 visual tokens, inside the 4784-token budget.
    expect(providerTargetSize(PROVIDER_PROFILES.claude, 1224, 1584)).toEqual({
      width: 1224,
      height: 1584,
      scale: 1,
    });
  });

  it("applies Claude's patch-token budget once the page is large enough", () => {
    // 3000x4000 costs ceil(3000/28) * ceil(4000/28) = 108 * 143 = 15444 tokens.
    const size = providerTargetSize(PROVIDER_PROFILES.claude, 3000, 4000);
    expect(size.scale).toBeLessThan(1);
    expect(Math.ceil(size.width / 28) * Math.ceil(size.height / 28)).toBeLessThanOrEqual(4784);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2576);
  });

  it("matches the coverage model exactly, so the preview cannot drift from the prediction", () => {
    for (const profile of Object.values(PROVIDER_PROFILES)) {
      const size = providerTargetSize(profile, 1224, 1584);
      expect(size.scale).toBe(providerImageScale(profile, 1224, 1584));
    }
  });

  it("leaves a page Gemini can take at full size untouched", () => {
    const size = providerTargetSize(PROVIDER_PROFILES.gemini, 1224, 1584);
    expect(size).toEqual({ width: 1224, height: 1584, scale: 1 });
  });

  it("never upscales, so the preview cannot flatter a small page", () => {
    const size = providerTargetSize(PROVIDER_PROFILES.chatgpt, 300, 400);
    expect(size.scale).toBe(1);
    expect(size.width).toBe(300);
  });

  it("handles a zero-sized source without dividing by zero", () => {
    expect(providerTargetSize(PROVIDER_PROFILES.claude, 0, 0)).toEqual({
      width: 0,
      height: 0,
      scale: 1,
    });
  });
});
