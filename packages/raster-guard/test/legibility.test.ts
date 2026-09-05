import { describe, expect, it } from "bun:test";
import {
  assessInstance,
  assessPlan,
  capHeightPx,
  compositeOver,
  contrastRatio,
  minimumLegibleFontSizePt,
  providerPxPerPoint,
  relativeLuminance,
} from "../src/legibility";
import { CLAUDE_STANDARD_TIER, PROVIDER_PROFILES } from "../src/provider-profiles";
import type { GuardInstance, GuardPlan, PageSize } from "../src/types";

const LETTER: PageSize = { widthPt: 612, heightPt: 792 };

function instance(overrides: Partial<GuardInstance> = {}): GuardInstance {
  return {
    id: "footer_notice-p0",
    channel: "footer_notice",
    pageIndex: 0,
    rect: { x: 28, y: 700, width: 556, height: 60 },
    fontSizePt: 11,
    lineHeightPt: 13.75,
    colorHex: "#1a1a1a",
    opacity: 1,
    rotationDeg: 0,
    text: "notice",
    ...overrides,
  };
}

describe("relativeLuminance / contrastRatio", () => {
  it("matches the WCAG anchors for black and white", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 3);
  });

  it("is order independent and accepts 3-digit hex", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(contrastRatio("#000", "#fff"), 6);
  });

  it("rejects a value that is not a colour", () => {
    expect(() => contrastRatio("rgb(0,0,0)", "#ffffff")).toThrow();
  });
});

describe("compositeOver", () => {
  it("flattens alpha ink to the solid colour the provider actually receives", () => {
    expect(compositeOver("#000000", "#ffffff", 0.2)).toBe("#cccccc");
    expect(compositeOver("#000000", "#ffffff", 0)).toBe("#ffffff");
    expect(compositeOver("#000000", "#ffffff", 1)).toBe("#000000");
  });
});

describe("providerPxPerPoint", () => {
  it("applies ChatGPT's short-edge pass, the harshest of the three", () => {
    // 612pt short edge at scale 2 = 1224px, fitted to a 768px short edge.
    const pxPerPoint = providerPxPerPoint(PROVIDER_PROFILES.chatgpt, LETTER, 2);
    expect(pxPerPoint).toBeCloseTo(768 / 612, 4);
  });

  it("leaves a Letter page at 144 DPI untouched on Claude's high-resolution tier", () => {
    // 1224x1584 costs ceil(1224/28) * ceil(1584/28) = 44 * 57 = 2508 visual
    // tokens, inside the 4784-token budget, and neither edge exceeds 2576px.
    expect(providerPxPerPoint(PROVIDER_PROFILES.claude, LETTER, 2)).toBe(2);
  });

  it("reproduces Anthropic's own documented standard-tier example", () => {
    // The docs work through a 1075x1520 scan: 39 x 55 = 2145 tokens, over the
    // 1568-token standard-tier budget, so it resizes to 924x1307 even though
    // neither edge exceeded the 1568px edge limit. Treating the page as
    // 1075x1520 "points" at scale 1 makes the factor directly checkable.
    const scale = providerPxPerPoint(CLAUDE_STANDARD_TIER, { widthPt: 1075, heightPt: 1520 }, 1);
    expect(Math.round(1075 * scale)).toBe(924);
    expect(Math.round(1520 * scale)).toBe(1307);
  });

  it("gives the standard tier markedly less detail than the high-resolution tier", () => {
    const standard = providerPxPerPoint(CLAUDE_STANDARD_TIER, LETTER, 2);
    const high = providerPxPerPoint(PROVIDER_PROFILES.claude, LETTER, 2);
    expect(standard).toBeLessThan(high);
    expect(high / standard).toBeGreaterThan(1.2);
  });

  it("never reports more detail than we rendered, even when the provider upscales", () => {
    const pxPerPoint = providerPxPerPoint(PROVIDER_PROFILES.chatgpt, LETTER, 0.5);
    expect(pxPerPoint).toBe(0.5);
  });

  it("keeps ChatGPT the harshest of the three, which is what sizes the plan", () => {
    const chatgpt = providerPxPerPoint(PROVIDER_PROFILES.chatgpt, LETTER, 2);
    const claude = providerPxPerPoint(PROVIDER_PROFILES.claude, LETTER, 2);
    const gemini = providerPxPerPoint(PROVIDER_PROFILES.gemini, LETTER, 2);
    expect(chatgpt).toBeLessThan(claude);
    expect(chatgpt).toBeLessThan(gemini);
  });
});

describe("assessInstance", () => {
  it("passes an ordinary dark footer on every provider", () => {
    for (const profile of Object.values(PROVIDER_PROFILES)) {
      const result = assessInstance({
        instance: instance(),
        profile,
        page: LETTER,
        rasterScale: 2,
        backgroundHex: "#ffffff",
      });
      expect(result.verdict).toBe("reliable");
      expect(result.reasons).toEqual([]);
    }
  });

  it("calls tiny dark microtext unreadable and says why", () => {
    const result = assessInstance({
      instance: instance({ fontSizePt: 4.5 }),
      profile: PROVIDER_PROFILES.chatgpt,
      page: LETTER,
      rasterScale: 2,
      backgroundHex: "#ffffff",
    });
    expect(result.verdict).toBe("unreadable");
    expect(result.reasons.join(" ")).toContain("Cap height");
  });

  it("keeps a large faint watermark legible where small dark text has already failed", () => {
    const small = assessInstance({
      instance: instance({ fontSizePt: 4.5 }),
      profile: PROVIDER_PROFILES.chatgpt,
      page: LETTER,
      rasterScale: 2,
      backgroundHex: "#ffffff",
    });
    const watermark = assessInstance({
      instance: instance({
        id: "lowfreq_watermark-p0",
        channel: "lowfreq_watermark",
        fontSizePt: 46,
        colorHex: "#000000",
        opacity: 0.2,
      }),
      profile: PROVIDER_PROFILES.chatgpt,
      page: LETTER,
      rasterScale: 2,
      backgroundHex: "#ffffff",
    });

    expect(small.verdict).toBe("unreadable");
    expect(watermark.verdict).toBe("reliable");
  });

  it("fails ink that is too faint to survive re-encoding", () => {
    const result = assessInstance({
      instance: instance({ colorHex: "#000000", opacity: 0.02 }),
      profile: PROVIDER_PROFILES.claude,
      page: LETTER,
      rasterScale: 2,
      backgroundHex: "#ffffff",
    });
    expect(result.verdict).toBe("unreadable");
    expect(result.reasons.join(" ")).toContain("Contrast");
  });
});

describe("assessPlan", () => {
  const plan: GuardPlan = {
    instances: [instance({ id: "margin_microtext-p0", fontSizePt: 4.5 }), instance()],
    noticeText: "notice",
    compactNoticeText: "notice",
    watermarkText: "DO NOT UPLOAD",
    tier: "subtle",
    targetProviders: ["chatgpt"],
    expectedSignals: [],
    warnings: [],
  };

  it("rolls up to the best instance, because one legible copy is enough", () => {
    const [coverage] = assessPlan({
      plan,
      pages: new Map([[0, LETTER]]),
      rasterScale: 2,
    });
    expect(coverage?.verdict).toBe("reliable");
    expect(coverage?.bestInstanceId).toBe("footer_notice-p0");
    expect(coverage?.perInstance).toHaveLength(2);
  });

  it("reports unreadable when no instance lands on a known page", () => {
    const [coverage] = assessPlan({ plan, pages: new Map(), rasterScale: 2 });
    expect(coverage?.verdict).toBe("unreadable");
    expect(coverage?.bestInstanceId).toBeNull();
  });
});

describe("minimumLegibleFontSizePt", () => {
  it("derives a footer size that then passes its own assessment", () => {
    const floor = minimumLegibleFontSizePt(PROVIDER_PROFILES.chatgpt, LETTER, 2);
    const result = assessInstance({
      instance: instance({ fontSizePt: Math.ceil(floor * 2) / 2 }),
      profile: PROVIDER_PROFILES.chatgpt,
      page: LETTER,
      rasterScale: 2,
      backgroundHex: "#ffffff",
    });
    expect(result.verdict).toBe("reliable");
  });

  it("agrees with capHeightPx at the floor", () => {
    const profile = PROVIDER_PROFILES.gemini;
    const floor = minimumLegibleFontSizePt(profile, LETTER, 2);
    const cap = capHeightPx(floor, providerPxPerPoint(profile, LETTER, 2));
    expect(cap).toBeCloseTo(profile.legibleCapHeightPx, 6);
  });
});
