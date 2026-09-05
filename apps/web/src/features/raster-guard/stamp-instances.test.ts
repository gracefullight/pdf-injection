import { describe, expect, it } from "bun:test";
import type { GuardInstance, GuardPlan } from "@pdf-injection/raster-guard";
import {
  fontStringFor,
  type StampContext2D,
  stampInstance,
  stampPageInstances,
  wrapWithMeasure,
} from "@/features/raster-guard/stamp-instances";

interface Call {
  op: string;
  args: unknown[];
}

/** Fake 2D context: records every call and measures 5 units per character. */
function fakeContext(): StampContext2D & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    font: "",
    fillStyle: "",
    textBaseline: "",
    globalAlpha: 1,
    save: () => calls.push({ op: "save", args: [] }),
    restore: () => calls.push({ op: "restore", args: [] }),
    translate: (x, y) => calls.push({ op: "translate", args: [x, y] }),
    rotate: (radians) => calls.push({ op: "rotate", args: [radians] }),
    fillText: (text, x, y) => calls.push({ op: "fillText", args: [text, x, y] }),
    measureText: (text) => ({ width: text.length * 5 }),
  };
}

function instance(overrides: Partial<GuardInstance> = {}): GuardInstance {
  return {
    id: "footer_notice-p0",
    channel: "footer_notice",
    pageIndex: 0,
    rect: { x: 28, y: 700, width: 100, height: 40 },
    fontSizePt: 10,
    lineHeightPt: 12.5,
    colorHex: "#6b6b6b",
    opacity: 1,
    rotationDeg: 0,
    text: "alpha beta gamma delta",
    ...overrides,
  };
}

describe("wrapWithMeasure", () => {
  it("wraps to the given width using the context's own metrics", () => {
    // 5 units per character, so a 30-unit line holds six characters.
    expect(wrapWithMeasure(fakeContext(), "alpha beta gamma", 30)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("honours hard line breaks and keeps blank lines", () => {
    expect(wrapWithMeasure(fakeContext(), "one\n\ntwo", 1000)).toEqual(["one", "", "two"]);
  });

  it("never drops a word that cannot fit on its own line", () => {
    const lines = wrapWithMeasure(fakeContext(), "supercalifragilistic tiny", 10);
    expect(lines.join(" ")).toContain("supercalifragilistic");
  });
});

describe("fontStringFor", () => {
  it("paints the watermark bold and everything else regular", () => {
    expect(fontStringFor(instance({ channel: "lowfreq_watermark", fontSizePt: 46 }))).toBe(
      "700 46px Helvetica, Arial, sans-serif",
    );
    expect(fontStringFor(instance())).toBe("400 10px Helvetica, Arial, sans-serif");
  });
});

describe("stampInstance", () => {
  it("draws each wrapped line one line height apart from the rect origin", () => {
    const ctx = fakeContext();
    const lines = stampInstance(ctx, instance({ rect: { x: 28, y: 700, width: 30, height: 40 } }));

    expect(lines).toEqual(["alpha", "beta", "gamma", "delta"]);
    const fills = ctx.calls.filter((call) => call.op === "fillText");
    expect(fills.map((call) => call.args[2])).toEqual([0, 12.5, 25, 37.5]);
    expect(ctx.calls.find((call) => call.op === "translate")?.args).toEqual([28, 700]);
  });

  it("saves and restores around every instance, so ink never leaks to the next one", () => {
    const ctx = fakeContext();
    stampInstance(ctx, instance());
    expect(ctx.calls[0]?.op).toBe("save");
    expect(ctx.calls.at(-1)?.op).toBe("restore");
  });

  it("rotates only when the instance asks for it", () => {
    const upright = fakeContext();
    stampInstance(upright, instance());
    expect(upright.calls.some((call) => call.op === "rotate")).toBe(false);

    const edge = fakeContext();
    stampInstance(edge, instance({ channel: "edge_band", rotationDeg: -90 }));
    expect(edge.calls.find((call) => call.op === "rotate")?.args[0]).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("applies the instance's ink and opacity", () => {
    const ctx = fakeContext();
    stampInstance(ctx, instance({ colorHex: "#000000", opacity: 0.14 }));
    expect(ctx.fillStyle).toBe("#000000");
    expect(ctx.globalAlpha).toBe(0.14);
    expect(ctx.textBaseline).toBe("top");
  });

  it("skips blank lines instead of drawing empty strings", () => {
    const ctx = fakeContext();
    stampInstance(
      ctx,
      instance({ text: "one\n\ntwo", rect: { x: 0, y: 0, width: 1000, height: 40 } }),
    );
    const fills = ctx.calls.filter((call) => call.op === "fillText");
    expect(fills).toHaveLength(2);
  });
});

describe("stampPageInstances", () => {
  const plan: GuardPlan = {
    instances: [instance(), instance({ id: "footer_notice-p1", pageIndex: 1 })],
    noticeText: "n",
    compactNoticeText: "n",
    watermarkText: "w",
    tier: "subtle",
    targetProviders: ["chatgpt"],
    expectedSignals: [],
    warnings: [],
  };

  it("paints only the instances belonging to the given page", () => {
    const ctx = fakeContext();
    expect(stampPageInstances(ctx, plan, 1)).toBe(1);
    expect(ctx.calls.filter((call) => call.op === "translate")).toHaveLength(1);
  });

  it("paints nothing for a page with no instances", () => {
    const ctx = fakeContext();
    expect(stampPageInstances(ctx, plan, 5)).toBe(0);
    expect(ctx.calls).toEqual([]);
  });
});
