/**
 * The scale ladder: choose sizes, colours and positions so that whatever a
 * provider does to the page, at least one painted copy of the notice is still
 * readable.
 *
 * ## Why a ladder rather than one stamp
 *
 * The three pipelines Raster Guard targets disagree by more than 2x on how
 * much page detail survives to the model. A single stamp sized for the most
 * detail-preserving one is invisible to the most aggressive one; sized for the
 * aggressive one it is conspicuous everywhere else. So the plan emits rungs
 * that fail in *different* directions and rolls them up with a best-instance
 * rule (`assessPlan`):
 *
 * - `footer_notice` — sized from the harshest target pipeline's floor, so it is
 *   the rung that carries a downscaling provider.
 * - `margin_microtext` — sized from the gentlest pipeline's floor. Smaller and
 *   less conspicuous; only pipelines that keep detail can read it.
 * - `lowfreq_watermark` — large and faint. Downscaling barely touches it
 *   because it is low-frequency information; its risk is contrast, not size.
 * - `edge_band` — rotated into the outer margin, where content never reaches.
 *
 * Sizing runs per page, because a plan may span mixed page geometry and the
 * px-per-point a provider ends up at depends on the page's own dimensions.
 */

import type { ExpectedSignal } from "@pdf-injection/contracts";
import { minimumLegibleFontSizePt } from "./legibility";
import {
  blockRectInBand,
  claimBandSpan,
  edgeStripRect,
  findFreeBands,
  pickBand,
} from "./placement";
import { getProviderProfile } from "./provider-profiles";
import { advanceRatioFor, estimateBlockHeightPt, fontSizeToFitWidthPt } from "./text-fit";
import type {
  GuardChannel,
  GuardInstance,
  GuardPlan,
  PageLayout,
  PlanWarning,
  SalienceTier,
  VisionProviderId,
} from "./types";

/** Ink and opacity per channel per tier. Tiers move human salience only. */
const TIER_INK: Record<
  SalienceTier,
  Record<GuardChannel, { colorHex: string; opacity: number }>
> = {
  overt: {
    footer_notice: { colorHex: "#1a1a1a", opacity: 1 },
    margin_microtext: { colorHex: "#333333", opacity: 1 },
    lowfreq_watermark: { colorHex: "#000000", opacity: 0.2 },
    edge_band: { colorHex: "#333333", opacity: 1 },
  },
  subtle: {
    footer_notice: { colorHex: "#6b6b6b", opacity: 1 },
    margin_microtext: { colorHex: "#777777", opacity: 1 },
    lowfreq_watermark: { colorHex: "#000000", opacity: 0.14 },
    edge_band: { colorHex: "#808080", opacity: 1 },
  },
  covert: {
    footer_notice: { colorHex: "#8a8a8a", opacity: 0.55 },
    margin_microtext: { colorHex: "#999999", opacity: 0.7 },
    lowfreq_watermark: { colorHex: "#000000", opacity: 0.1 },
    edge_band: { colorHex: "#a0a0a0", opacity: 0.7 },
  },
};

/** Channels each tier turns on by default. */
export const TIER_CHANNELS: Record<SalienceTier, GuardChannel[]> = {
  overt: ["footer_notice"],
  subtle: ["footer_notice", "lowfreq_watermark", "margin_microtext"],
  covert: ["lowfreq_watermark", "margin_microtext", "edge_band"],
};

const LINE_HEIGHT_RATIO = 1.25;
const MARGIN_X_PT = 28;
const EDGE_STRIP_THICKNESS_RATIO = 1.6;
/** Never plan type smaller than this, whatever the arithmetic says. */
const MIN_FONT_SIZE_PT = 4.5;
/**
 * Floor for the watermark's type size.
 *
 * Low enough that a long institution name still fits on one line across a
 * portrait page, and still roughly three times body-text size — at 16pt the cap
 * height is 14 provider pixels even on the harshest pipeline, well clear of its
 * 9px floor, so the rung's binding constraint stays contrast rather than size.
 */
const WATERMARK_MIN_FONT_PT = 16;
const WATERMARK_MAX_FONT_PT = 76;

export interface BuildGuardPlanInput {
  pages: PageLayout[];
  /** Full notice, with hard line breaks. */
  noticeText: string;
  /**
   * Short form used when a page's free margin cannot fit `noticeText`.
   * Defaults to `noticeText`, which just means the fallback is a no-op.
   */
  compactNoticeText?: string;
  /** Condensed single line for the watermark rung. */
  watermarkText: string;
  tier: SalienceTier;
  targetProviders: VisionProviderId[];
  /** Pixels per point the page will be rendered at before stamping. */
  rasterScale: number;
  /** Defaults to `TIER_CHANNELS[tier]`. */
  channels?: GuardChannel[];
  /** Paint on every page (default) or only the first. */
  scope?: "all" | "first";
  expectedSignals?: ExpectedSignal[];
}

export function buildGuardPlan(input: BuildGuardPlanInput): GuardPlan {
  const channels = input.channels ?? TIER_CHANNELS[input.tier];
  const scope = input.scope ?? "all";
  const pages = scope === "first" ? input.pages.slice(0, 1) : input.pages;
  const instances: GuardInstance[] = [];
  const warnings: PlanWarning[] = [];

  if (input.targetProviders.length === 0) {
    warnings.push({
      code: "no_target_providers",
      message:
        "No target assistant selected, so nothing sizes the plan. Sizes fall back to a Letter-page default.",
    });
  }

  for (const page of pages) {
    // Narrowed as each rung claims its space, so two rungs on one page can
    // never be handed the same band.
    let bands = findFreeBands(page);
    const harshestFloorPt = fontFloor(input, page, "harshest");
    const gentlestFloorPt = fontFloor(input, page, "gentlest");

    for (const channel of channels) {
      const built = buildInstance({
        channel,
        page,
        bands,
        input,
        harshestFloorPt,
        gentlestFloorPt,
      });
      if (built.instance) {
        instances.push(built.instance);
        // The rotated edge strip lives in the side margin, outside the
        // horizontal-band model entirely, so it claims nothing.
        if (built.instance.rotationDeg === 0) {
          const { y, height } = built.instance.rect;
          bands = claimBandSpan(bands, y, y + height);
        }
      }
      if (built.warning) warnings.push(built.warning);
    }
  }

  return {
    instances,
    noticeText: input.noticeText,
    compactNoticeText: input.compactNoticeText ?? input.noticeText,
    watermarkText: input.watermarkText,
    tier: input.tier,
    targetProviders: input.targetProviders,
    expectedSignals: input.expectedSignals ?? [],
    warnings,
  };
}

interface BuildInstanceInput {
  channel: GuardChannel;
  page: PageLayout;
  bands: ReturnType<typeof findFreeBands>;
  input: BuildGuardPlanInput;
  harshestFloorPt: number;
  gentlestFloorPt: number;
}

function buildInstance(args: BuildInstanceInput): {
  instance: GuardInstance | null;
  warning: PlanWarning | null;
} {
  const { channel, page, bands, input, harshestFloorPt, gentlestFloorPt } = args;
  const ink = TIER_INK[input.tier][channel];
  const id = `${channel}-p${page.pageIndex}`;
  const usableWidth = Math.max(1, page.widthPt - MARGIN_X_PT * 2);

  if (channel === "lowfreq_watermark") {
    // The watermark line is set in capitals, which are much wider per character
    // than prose; estimating it at the prose ratio oversizes it by about a
    // third and it wraps out of the single line reserved for it.
    const advanceRatio = advanceRatioFor(input.watermarkText);
    // Rounded *down* to the half point: this size was solved to fill the
    // available width, so rounding it up is what makes the line wrap.
    const fontSizePt = floorHalf(
      clamp(
        fontSizeToFitWidthPt(input.watermarkText, usableWidth, advanceRatio),
        WATERMARK_MIN_FONT_PT,
        WATERMARK_MAX_FONT_PT,
      ),
    );
    // Height comes from the wrapped estimate rather than one line: at the
    // minimum font size a long institution name can still wrap, and the band
    // has to be tall enough for what actually gets painted.
    const neededHeight = estimateBlockHeightPt(
      input.watermarkText,
      fontSizePt,
      fontSizePt * LINE_HEIGHT_RATIO,
      usableWidth,
      advanceRatio,
    );
    const band = pickBand(bands, neededHeight, "largest");
    if (!band) {
      return {
        instance: null,
        warning: {
          code: "no_free_band",
          channel,
          pageIndex: page.pageIndex,
          message: `Page ${page.pageIndex + 1} has no content-free band tall enough for the watermark (${neededHeight.toFixed(0)}pt). This rung is skipped on that page.`,
        },
      };
    }
    return {
      instance: {
        id,
        channel,
        pageIndex: page.pageIndex,
        rect: blockRectInBand({ page, band, neededHeightPt: neededHeight, marginXPt: MARGIN_X_PT }),
        fontSizePt,
        lineHeightPt: fontSizePt * LINE_HEIGHT_RATIO,
        colorHex: ink.colorHex,
        opacity: ink.opacity,
        rotationDeg: 0,
        text: input.watermarkText,
      },
      warning: null,
    };
  }

  if (channel === "edge_band") {
    const fontSizePt = Math.max(MIN_FONT_SIZE_PT, roundHalf(harshestFloorPt));
    return {
      instance: {
        id,
        channel,
        pageIndex: page.pageIndex,
        rect: edgeStripRect(page, fontSizePt * EDGE_STRIP_THICKNESS_RATIO, "left"),
        fontSizePt,
        lineHeightPt: fontSizePt * LINE_HEIGHT_RATIO,
        colorHex: ink.colorHex,
        opacity: ink.opacity,
        // -90deg: the block runs bottom-to-top along the left edge.
        rotationDeg: -90,
        text: singleLine(input.watermarkText),
      },
      warning: null,
    };
  }

  // footer_notice / margin_microtext — both paint the notice into a band.
  //
  // The full notice is tried first and the compact form is the fallback,
  // because a page with an ordinary print margin has room for three lines but
  // not for nine. Dropping to the short form keeps the rung (and with it the
  // response sentence and reference code) rather than losing the page.
  // The small rung is sized *at* the gentlest pipeline's floor, not below it.
  // Shading it smaller to look more discreet costs it the one provider it
  // exists to reach, which would leave a rung that reads for nobody.
  const fontSizePt = Math.max(
    MIN_FONT_SIZE_PT,
    roundHalf(channel === "footer_notice" ? harshestFloorPt : gentlestFloorPt),
  );
  const lineHeightPt = fontSizePt * LINE_HEIGHT_RATIO;
  const preference = channel === "footer_notice" ? "bottom" : "top";
  const compactText = input.compactNoticeText ?? input.noticeText;

  const candidates =
    compactText === input.noticeText ? [input.noticeText] : [input.noticeText, compactText];

  for (const text of candidates) {
    const neededHeight = estimateBlockHeightPt(text, fontSizePt, lineHeightPt, usableWidth);
    const band = pickBand(bands, neededHeight, preference);
    if (!band) continue;

    return {
      instance: {
        id,
        channel,
        pageIndex: page.pageIndex,
        rect: blockRectInBand({
          page,
          band,
          neededHeightPt: neededHeight,
          marginXPt: MARGIN_X_PT,
          anchor: channel === "footer_notice" ? "bottom" : "top",
        }),
        fontSizePt,
        lineHeightPt,
        colorHex: ink.colorHex,
        opacity: ink.opacity,
        rotationDeg: 0,
        text,
      },
      warning:
        text === input.noticeText
          ? null
          : {
              code: "compact_notice_used",
              channel,
              pageIndex: page.pageIndex,
              message: `Page ${page.pageIndex + 1} had no band tall enough for the full notice, so the ${channel.replace("_", " ")} rung uses the short form there. The response sentence and reference code are unchanged.`,
            },
    };
  }

  const fullHeight = estimateBlockHeightPt(input.noticeText, fontSizePt, lineHeightPt, usableWidth);
  return {
    instance: null,
    warning: {
      code: "no_free_band",
      channel,
      pageIndex: page.pageIndex,
      message: `Page ${page.pageIndex + 1} has no content-free band tall enough for the ${fullHeight.toFixed(0)}pt ${channel.replace("_", " ")} block, or for its short form. This rung is skipped on that page; free up a margin or shorten the notice.`,
    },
  };
}

/**
 * The font size floor for a page, taken from either the target provider that
 * degrades the page most (`harshest` — the size the primary rung must clear) or
 * least (`gentlest` — what the small rung can get away with).
 */
function fontFloor(
  input: BuildGuardPlanInput,
  page: PageLayout,
  which: "harshest" | "gentlest",
): number {
  const floors = input.targetProviders.map((id) =>
    minimumLegibleFontSizePt(getProviderProfile(id), page, input.rasterScale),
  );
  if (floors.length === 0) return which === "harshest" ? 10.5 : 7;
  return which === "harshest" ? Math.max(...floors) : Math.min(...floors);
}

function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Up to the next half point — for a size that must clear a floor. */
function roundHalf(value: number): number {
  return Math.ceil(value * 2) / 2;
}

/** Down to the previous half point — for a size that must stay under a ceiling. */
function floorHalf(value: number): number {
  return Math.floor(value * 2) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
