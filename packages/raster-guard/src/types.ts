/**
 * Raster Guard — types for the post-rasterization (pixel-space) instruction
 * channel.
 *
 * Every other injection mode in this repo writes a PDF *object* (page text,
 * annotation, form field, metadata). Raster Guard writes **pixels**: the page
 * is rendered to a bitmap and the notice is painted into that bitmap before
 * the image is re-embedded, so the output PDF carries no text object at all.
 * That is what makes the channel survive the rasterize/print-to-PDF sanitizer
 * every text-borne channel dies to (see `docs/raster-guard.md`).
 *
 * ## Coordinate convention
 *
 * All rectangles here are in **PDF points with a top-left origin**
 * (x right, y down) — canvas convention, not PDF's bottom-left convention.
 * The web layer draws straight onto a canvas whose transform is
 * `scale(rasterScale)`, so keeping one convention end to end removes a class
 * of flip bugs. `pdf-lib` never sees these rects; only the flattened image does.
 */

import type { ExpectedSignal } from "@pdf-injection/contracts";

/** Rectangle in PDF points, top-left origin. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The document-ingestion pipelines Raster Guard plans against. */
export type VisionProviderId = "chatgpt" | "claude" | "gemini";

/**
 * How loudly the notice is painted.
 *
 * The tiers trade *human* salience, never model legibility: every tier is
 * planned to clear its target providers' legibility floor, or the coverage
 * report says so explicitly.
 */
export type SalienceTier = "overt" | "subtle" | "covert";

/**
 * A pixel-space placement strategy.
 *
 * - `footer_notice` — ordinary-size dark text in the bottom margin. Reads as a
 *   document footer to a human; the highest-confidence channel for every
 *   provider.
 * - `margin_microtext` — small text in a page margin. Survives providers that
 *   tile at high detail; the first channel to die under aggressive downscaling.
 * - `lowfreq_watermark` — large, very faint glyphs across a free band. The
 *   inverse of microtext: it lives in the **low-frequency** band of the image,
 *   so downscaling and lossy recompression preserve it almost perfectly while a
 *   skimming human reads past it.
 * - `edge_band` — rotated text along the outer edge, where page content
 *   effectively never reaches.
 */
export type GuardChannel = "footer_notice" | "margin_microtext" | "lowfreq_watermark" | "edge_band";

/** One painted copy of the notice on one page. */
export interface GuardInstance {
  /** Stable id — `${channel}-p${pageIndex}`. Used as a React key and in the coverage report. */
  id: string;
  channel: GuardChannel;
  /** 0-based page index this instance is painted on. */
  pageIndex: number;
  /** Where the block goes, in points (top-left origin). */
  rect: Rect;
  /** Font size in points, before any provider-side rescaling. */
  fontSizePt: number;
  /** Baseline-to-baseline distance, in points. */
  lineHeightPt: number;
  /** Ink color, `#rrggbb`. */
  colorHex: string;
  /** 0..1 alpha the ink is painted at. Combined with `colorHex` to get effective contrast. */
  opacity: number;
  /** Clockwise rotation in degrees, applied about the rect's top-left corner. Only `edge_band` uses a non-zero value. */
  rotationDeg: number;
  /** Text this instance paints. Usually the full notice; `lowfreq_watermark` paints a condensed form. */
  text: string;
}

/** A complete, page-by-page paint plan for one document. */
export interface GuardPlan {
  instances: GuardInstance[];
  /** The full notice text every `footer_notice`/`margin_microtext`/`edge_band` instance paints. */
  noticeText: string;
  /** The short form a rung falls back to on a page whose only free space is a print margin. */
  compactNoticeText: string;
  /** The condensed single-line form `lowfreq_watermark` paints. */
  watermarkText: string;
  tier: SalienceTier;
  targetProviders: VisionProviderId[];
  /** Signals an instructor can score a suspected AI-assisted submission against. */
  expectedSignals: ExpectedSignal[];
  /** Non-blocking notes raised while planning (e.g. a channel that found no free band). */
  warnings: PlanWarning[];
}

export interface PlanWarning {
  code: string;
  message: string;
  pageIndex?: number;
  channel?: GuardChannel;
}

/** Page size in points. */
export interface PageSize {
  widthPt: number;
  heightPt: number;
}

/** A page's size plus the boxes its own content already occupies. */
export interface PageLayout extends PageSize {
  pageIndex: number;
  /** Bounding boxes of the page's own text/graphics, points, top-left origin. */
  occupied: Rect[];
}

/**
 * How one provider turns an uploaded page into the pixels its model actually
 * sees, plus the legibility floors used to judge a plan against it.
 *
 * These numbers come from vendor documentation, not from measurement by this
 * project — see `provider-profiles.ts` for each field's `sourceNote` and
 * `docs/raster-guard.md` for why they are treated as an estimate that must be
 * re-checked, never as a guarantee.
 */
export interface ProviderProfile {
  id: VisionProviderId;
  label: string;
  /** The page raster is fitted so its longest edge is at most this many pixels. */
  maxLongEdgePx: number;
  /** After the long-edge fit, the shortest edge is scaled down to this. `null` when the provider does not do a second pass. */
  shortEdgeTargetPx: number | null;
  /**
   * Patch edge, in pixels, for a provider that budgets visual tokens per patch
   * (Anthropic: 28). `null` for providers that do not.
   */
  patchPx: number | null;
  /** Visual-token budget spent as `ceil(w/patch) * ceil(h/patch)`. `null` when the provider has none. */
  maxVisualTokens: number | null;
  /** Hard cap on total pixels after fitting. `null` when the provider has none. */
  maxPixels: number | null;
  /** Tile edge the fitted page is split into before encoding. Informational — reported, not used by the legibility math. */
  tilePx: number;
  /** Whether the provider re-encodes lossily before the model sees the page. Low-contrast ink is the first casualty. */
  lossyRecompression: boolean;
  /** Cap height, in provider pixels, at or above which text reads reliably. */
  legibleCapHeightPx: number;
  /** Cap height below which text is treated as unreadable; between the two is "marginal". */
  marginalCapHeightPx: number;
  /** Ink/paper contrast ratio (WCAG formula) at or above which text reads reliably. */
  legibleContrastRatio: number;
  /** Contrast ratio below which text is treated as unreadable. */
  marginalContrastRatio: number;
  /** Where the rescaling numbers come from. */
  sourceNote: string;
  /** What this profile cannot know, stated so a verdict is never read as more certain than it is. */
  uncertaintyNote: string;
}

export type LegibilityVerdict = "reliable" | "marginal" | "unreadable";

/** What one provider is predicted to make of one painted instance. */
export interface InstanceLegibility {
  instanceId: string;
  providerId: VisionProviderId;
  /** Provider pixels per PDF point, after every rescaling pass the profile describes. */
  pxPerPoint: number;
  /** Predicted cap height of the instance's glyphs, in provider pixels. */
  capHeightPx: number;
  /** WCAG contrast ratio of the instance's effective ink against its local background. */
  contrastRatio: number;
  verdict: LegibilityVerdict;
  /** Why the verdict is not `reliable`. Empty when it is. */
  reasons: string[];
}

/** Per-provider rollup: the best instance wins, because one legible copy is enough. */
export interface ProviderCoverage {
  providerId: VisionProviderId;
  label: string;
  verdict: LegibilityVerdict;
  /** The instance that produced `verdict`. `null` only when the plan has no instances. */
  bestInstanceId: string | null;
  perInstance: InstanceLegibility[];
}
