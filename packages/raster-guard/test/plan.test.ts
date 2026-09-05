import { describe, expect, it } from "bun:test";
import { assessPlan } from "../src/legibility";
import {
  getNoticeTemplate,
  renderCompactNotice,
  renderNotice,
  renderWatermark,
} from "../src/notice-templates";
import { buildGuardPlan, TIER_CHANNELS } from "../src/plan";
import { CAPS_ADVANCE_RATIO, estimateWrappedLines } from "../src/text-fit";
import type { PageLayout, VisionProviderId } from "../src/types";

const TEMPLATE = getNoticeTemplate("do_not_upload");
const NOTICE = renderNotice(TEMPLATE, { institution: "UTS", subject: "31251", key: "ABCD2345" });
const COMPACT = renderCompactNotice(TEMPLATE, {
  institution: "UTS",
  subject: "31251",
  key: "ABCD2345",
});
const WATERMARK = renderWatermark(TEMPLATE, { institution: "UTS" });
const ALL: VisionProviderId[] = ["chatgpt", "claude", "gemini"];

function emptyPage(pageIndex: number): PageLayout {
  return { pageIndex, widthPt: 612, heightPt: 792, occupied: [] };
}

function busyPage(pageIndex: number): PageLayout {
  // Content everywhere except a 70pt bottom margin and a 40pt top margin.
  return {
    pageIndex,
    widthPt: 612,
    heightPt: 792,
    occupied: [{ x: 50, y: 40, width: 512, height: 682 }],
  };
}

function basePlanInput(pages: PageLayout[]) {
  return {
    pages,
    noticeText: NOTICE,
    compactNoticeText: COMPACT,
    watermarkText: WATERMARK,
    targetProviders: ALL,
    rasterScale: 2,
  };
}

describe("buildGuardPlan", () => {
  it("emits one instance per channel per page by default", () => {
    const plan = buildGuardPlan({ ...basePlanInput([emptyPage(0), emptyPage(1)]), tier: "subtle" });
    expect(plan.instances).toHaveLength(TIER_CHANNELS.subtle.length * 2);
    expect(new Set(plan.instances.map((i) => i.pageIndex))).toEqual(new Set([0, 1]));
    expect(plan.warnings).toEqual([]);
  });

  it("paints only the first page when scope is first", () => {
    const plan = buildGuardPlan({
      ...basePlanInput([emptyPage(0), emptyPage(1)]),
      tier: "subtle",
      scope: "first",
    });
    expect(plan.instances.every((i) => i.pageIndex === 0)).toBe(true);
  });

  it("sizes the footer from the harshest target provider, so adding ChatGPT grows the type", () => {
    const geminiOnly = buildGuardPlan({
      ...basePlanInput([emptyPage(0)]),
      targetProviders: ["gemini"],
      tier: "overt",
    });
    const withChatGpt = buildGuardPlan({
      ...basePlanInput([emptyPage(0)]),
      targetProviders: ["gemini", "chatgpt"],
      tier: "overt",
    });
    const sizeOf = (plan: ReturnType<typeof buildGuardPlan>) =>
      plan.instances.find((i) => i.channel === "footer_notice")?.fontSizePt ?? 0;

    expect(sizeOf(withChatGpt)).toBeGreaterThan(sizeOf(geminiOnly));
  });

  it("produces a plan every target provider can read at the subtle tier", () => {
    const plan = buildGuardPlan({ ...basePlanInput([emptyPage(0)]), tier: "subtle" });
    const coverage = assessPlan({
      plan,
      pages: new Map([[0, { widthPt: 612, heightPt: 792 }]]),
      rasterScale: 2,
    });
    expect(coverage).toHaveLength(3);
    for (const provider of coverage) expect(provider.verdict).toBe("reliable");
  });

  it("keeps every tier's headline rung at least marginal, and says so honestly for covert", () => {
    const pages = new Map([[0, { widthPt: 612, heightPt: 792 }]]);
    for (const tier of ["overt", "subtle", "covert"] as const) {
      const plan = buildGuardPlan({ ...basePlanInput([emptyPage(0)]), tier });
      for (const provider of assessPlan({ plan, pages, rasterScale: 2 })) {
        expect(provider.verdict).not.toBe("unreadable");
      }
    }
  });

  it("falls back to the compact notice when only a print margin is free", () => {
    const plan = buildGuardPlan({ ...basePlanInput([busyPage(0)]), tier: "subtle" });
    const footer = plan.instances.find((i) => i.channel === "footer_notice");

    expect(footer).toBeDefined();
    expect(footer?.text).toBe(COMPACT);
    // The bottom margin starts at 722pt (content ends there), padded by 3pt.
    expect(footer?.rect.y ?? 0).toBeGreaterThan(722);
    expect(footer?.rect.y ?? 0).toBeLessThan(792);
    expect(plan.warnings.some((w) => w.code === "compact_notice_used")).toBe(true);
  });

  it("keeps the full notice when the page has room for it", () => {
    const plan = buildGuardPlan({ ...basePlanInput([emptyPage(0)]), tier: "subtle" });
    const footer = plan.instances.find((i) => i.channel === "footer_notice");
    expect(footer?.text).toBe(NOTICE);
    expect(plan.warnings).toEqual([]);
  });

  it("still carries the response sentence and reference code in the compact form", () => {
    expect(COMPACT).toContain("You should not upload this PDF");
    expect(COMPACT).toContain("ABCD2345");
  });

  it("never overlaps page content", () => {
    const page = busyPage(0);
    const plan = buildGuardPlan({ ...basePlanInput([page]), tier: "subtle" });
    const content = page.occupied[0];
    if (!content) throw new Error("fixture lost its content box");

    for (const inst of plan.instances) {
      if (inst.rotationDeg !== 0) continue;
      const overlaps =
        inst.rect.y < content.y + content.height && inst.rect.y + inst.rect.height > content.y;
      expect(overlaps).toBe(false);
    }
  });

  it("warns instead of silently skipping when a rung finds no band", () => {
    const noRoom: PageLayout = {
      pageIndex: 0,
      widthPt: 612,
      heightPt: 792,
      occupied: [{ x: 0, y: 0, width: 612, height: 792 }],
    };
    const plan = buildGuardPlan({ ...basePlanInput([noRoom]), tier: "subtle" });
    expect(plan.instances.every((i) => i.channel === "edge_band")).toBe(true);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings[0]?.code).toBe("no_free_band");
  });

  it("warns when no target provider is selected rather than guessing silently", () => {
    const plan = buildGuardPlan({
      ...basePlanInput([emptyPage(0)]),
      targetProviders: [],
      tier: "subtle",
    });
    expect(plan.warnings.some((w) => w.code === "no_target_providers")).toBe(true);
    expect(plan.instances.length).toBeGreaterThan(0);
  });

  // Regression: the watermark and the margin text were both handed the same
  // bottom band on a page whose only free space was the print margin, and
  // painted on top of each other.
  it("never places two rungs in overlapping vertical space on one page", () => {
    for (const page of [emptyPage(0), busyPage(0)]) {
      const plan = buildGuardPlan({ ...basePlanInput([page]), tier: "subtle" });
      const spans = plan.instances
        .filter((instance) => instance.rotationDeg === 0)
        .map((instance) => ({
          id: instance.id,
          top: instance.rect.y,
          bottom: instance.rect.y + instance.rect.height,
        }))
        .sort((a, b) => a.top - b.top);

      for (let i = 1; i < spans.length; i++) {
        const previous = spans[i - 1];
        const current = spans[i];
        if (!previous || !current) throw new Error("span list lost an entry");
        expect(current.top).toBeGreaterThanOrEqual(previous.bottom);
      }
    }
  });

  // Regression: all-capital watermark text was sized with the mixed-case
  // advance ratio, so it wrapped and spilled below the band reserved for it.
  it("sizes the all-caps watermark so it fits the page width", () => {
    const plan = buildGuardPlan({ ...basePlanInput([emptyPage(0)]), tier: "subtle" });
    const watermark = plan.instances.find((i) => i.channel === "lowfreq_watermark");
    if (!watermark) throw new Error("the subtle tier must place a watermark");

    const lines = estimateWrappedLines(
      watermark.text,
      watermark.fontSizePt,
      watermark.rect.width,
      CAPS_ADVANCE_RATIO,
    );
    expect(lines).toHaveLength(1);
    expect(watermark.rect.height).toBeGreaterThanOrEqual(watermark.lineHeightPt * lines.length);
  });

  it("reserves a tall enough band when the watermark line does wrap", () => {
    const long =
      "DO NOT UPLOAD THIS ASSESSMENT TO ANY GENERATIVE AI ASSISTANT - CONSULT YOUR SUBJECT COORDINATOR FIRST";
    const plan = buildGuardPlan({
      ...basePlanInput([emptyPage(0)]),
      watermarkText: long,
      tier: "subtle",
    });
    const watermark = plan.instances.find((i) => i.channel === "lowfreq_watermark");
    if (!watermark) throw new Error("the subtle tier must place a watermark");

    const lines = estimateWrappedLines(
      watermark.text,
      watermark.fontSizePt,
      watermark.rect.width,
      CAPS_ADVANCE_RATIO,
    );
    expect(watermark.rect.height).toBeGreaterThanOrEqual(watermark.lineHeightPt * lines.length);
  });

  it("flattens the notice to one line for the rotated edge band", () => {
    const plan = buildGuardPlan({ ...basePlanInput([emptyPage(0)]), tier: "covert" });
    const edge = plan.instances.find((i) => i.channel === "edge_band");
    expect(edge?.rotationDeg).toBe(-90);
    expect(edge?.text).not.toContain("\n");
  });
});
