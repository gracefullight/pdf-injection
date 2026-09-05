/**
 * The legibility model: given a painted instance and a provider's ingestion
 * geometry, will the model still be able to read it?
 *
 * Two independent failure modes, deliberately kept separate because they pull
 * in opposite directions:
 *
 * 1. **Size.** Every provider downsamples a page before the model sees it.
 *    Small glyphs lose their strokes first. Bigger type survives.
 * 2. **Contrast.** Faint ink survives resampling almost perfectly (it is
 *    low-frequency information) but dies to lossy re-encoding and to a
 *    quantizer that flattens near-white gradients.
 *
 * The interesting consequence, and the reason `lowfreq_watermark` exists: the
 * conventional hidden-instruction recipe (tiny, dark, in a margin) optimises
 * exactly the wrong variable. Under a pipeline that scales a Letter page down
 * to a 768px short edge, 5pt type has a cap height of about 4 provider pixels
 * and is gone. Large, very faint type at the same *human* salience keeps a
 * 30px cap height and only has to clear the contrast floor.
 */

import { getProviderProfile } from "./provider-profiles";
import type {
  GuardInstance,
  GuardPlan,
  InstanceLegibility,
  LegibilityVerdict,
  PageSize,
  ProviderCoverage,
  ProviderProfile,
  VisionProviderId,
} from "./types";

/**
 * Cap height as a fraction of font size. 0.7 is the value for the sans-serif
 * faces every runtime here resolves for the stamp (Helvetica's is 0.717,
 * Arial's 0.716, Liberation Sans' 0.729); using one constant keeps the
 * prediction stable across the browser's font resolution, which we do not
 * control.
 */
export const CAP_HEIGHT_RATIO = 0.7;

/** sRGB relative luminance (WCAG 2.x definition) of an `#rrggbb` color. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors, always >= 1. */
export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const a = relativeLuminance(foregroundHex);
  const b = relativeLuminance(backgroundHex);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Alpha-composites `foregroundHex` at `opacity` over `backgroundHex`.
 *
 * Painted ink at 8% alpha is not an 8%-alpha color to the model — by the time
 * the page is a flat JPEG it is a solid, very slightly grey pixel. Compositing
 * first is what makes the contrast check match what the provider receives.
 */
export function compositeOver(
  foregroundHex: string,
  backgroundHex: string,
  opacity: number,
): string {
  const alpha = clamp(opacity, 0, 1);
  const fg = parseHex(foregroundHex);
  const bg = parseHex(backgroundHex);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return toHex(mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b));
}

/**
 * Provider pixels per PDF point, after every rescaling pass in the profile.
 *
 * `rasterScale` is how many pixels per point *we* rendered the page at. A
 * provider can only ever remove detail from that, so an upscaling pass (a page
 * whose short edge is already below the provider's target) is clamped to 1: it
 * changes the pixel count without adding readable detail, and counting it would
 * make the model claim legibility it cannot deliver.
 */
export function providerPxPerPoint(
  profile: ProviderProfile,
  page: PageSize,
  rasterScale: number,
): number {
  const srcW = page.widthPt * rasterScale;
  const srcH = page.heightPt * rasterScale;
  if (srcW <= 0 || srcH <= 0) return 0;
  return rasterScale * providerImageScale(profile, srcW, srcH);
}

/**
 * The resampling factor a provider applies to an image of the given pixel size,
 * always in `(0, 1]`.
 *
 * This is the single definition of a provider's downscale. Both the legibility
 * prediction and the "what the model sees" preview call it, so the number in
 * the coverage table and the pixels on screen can never drift apart — they did
 * once, when the preview carried its own copy of the arithmetic.
 *
 * Upscaling is clamped away: a provider that stretches a small page to meet a
 * short-edge target adds pixels but no detail, and counting it would let the
 * model claim legibility it cannot deliver.
 */
export function providerImageScale(
  profile: ProviderProfile,
  sourceWidthPx: number,
  sourceHeightPx: number,
): number {
  if (sourceWidthPx <= 0 || sourceHeightPx <= 0) return 1;

  const longFit = Math.min(1, profile.maxLongEdgePx / Math.max(sourceWidthPx, sourceHeightPx));
  let scale = longFit;

  if (profile.shortEdgeTargetPx !== null) {
    const shortAfterFit = Math.min(sourceWidthPx, sourceHeightPx) * longFit;
    scale *= Math.min(1, profile.shortEdgeTargetPx / shortAfterFit);
  }

  if (profile.maxPixels !== null) {
    const area = sourceWidthPx * scale * (sourceHeightPx * scale);
    if (area > profile.maxPixels) scale *= Math.sqrt(profile.maxPixels / area);
  }

  if (profile.patchPx !== null && profile.maxVisualTokens !== null) {
    scale *= patchBudgetFit(
      Math.round(sourceWidthPx * scale),
      Math.round(sourceHeightPx * scale),
      profile.patchPx,
      profile.maxVisualTokens,
      profile.maxLongEdgePx,
    );
  }

  return scale;
}

/**
 * The extra downscale a patch-token budget forces, as a factor in (0, 1].
 *
 * Ported from Anthropic's published reference implementation: an image costs
 * `ceil(w/patch) * ceil(h/patch)` visual tokens, and the accepted size is the
 * largest aspect-preserving one whose token cost fits the budget *and* whose
 * patch-padded edges fit the long-edge limit. The vendor solves it by binary
 * search rather than in closed form, because the ceilings make the cost a step
 * function; this does the same so the two agree exactly.
 *
 * The documented worked example is the check: a 1075x1520 page costs
 * 39 x 55 = 2145 tokens, over the 1568-token standard-tier budget, and resizes
 * to 924x1307 even though neither edge exceeded the 1568px edge limit.
 */
function patchBudgetFit(
  width: number,
  height: number,
  patchPx: number,
  maxTokens: number,
  maxEdgePx: number,
): number {
  if (width <= 0 || height <= 0) return 1;

  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / patchPx) * patchPx <= maxEdgePx &&
    Math.ceil(h / patchPx) * patchPx <= maxEdgePx &&
    Math.ceil(w / patchPx) * Math.ceil(h / patchPx) <= maxTokens;

  if (fits(width, height)) return 1;

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const aspect = longEdge / shortEdge;

  let low = 1; // always fits
  let high = longEdge; // never fits
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const other = Math.max(Math.round(mid / aspect), 1);
    if (fits(mid, other)) low = mid;
    else high = mid;
  }

  return low / longEdge;
}

/** Predicted cap height, in provider pixels, of an instance's glyphs. */
export function capHeightPx(fontSizePt: number, pxPerPoint: number): number {
  return fontSizePt * CAP_HEIGHT_RATIO * pxPerPoint;
}

export interface AssessInstanceInput {
  instance: GuardInstance;
  profile: ProviderProfile;
  page: PageSize;
  rasterScale: number;
  /** Paper color under the instance, `#rrggbb`. White for a margin band; sample the render for anything else. */
  backgroundHex: string;
}

/** Predicts what one provider makes of one painted instance. */
export function assessInstance(input: AssessInstanceInput): InstanceLegibility {
  const { instance, profile, page, rasterScale, backgroundHex } = input;
  const pxPerPoint = providerPxPerPoint(profile, page, rasterScale);
  const cap = capHeightPx(instance.fontSizePt, pxPerPoint);
  const inkHex = compositeOver(instance.colorHex, backgroundHex, instance.opacity);
  const ratio = contrastRatio(inkHex, backgroundHex);

  const reasons: string[] = [];
  const sizeVerdict = tier(cap, profile.legibleCapHeightPx, profile.marginalCapHeightPx);
  const contrastVerdict = tier(ratio, profile.legibleContrastRatio, profile.marginalContrastRatio);

  if (sizeVerdict === "unreadable") {
    reasons.push(
      `Cap height falls to ${cap.toFixed(1)}px after ${profile.label} rescales the page, below the ${profile.marginalCapHeightPx}px floor. Raise the font size.`,
    );
  } else if (sizeVerdict === "marginal") {
    reasons.push(
      `Cap height of ${cap.toFixed(1)}px is under ${profile.label}'s ${profile.legibleCapHeightPx}px reliable threshold.`,
    );
  }

  if (contrastVerdict === "unreadable") {
    reasons.push(
      `Contrast of ${ratio.toFixed(2)}:1 is below the ${profile.marginalContrastRatio}:1 floor${profile.lossyRecompression ? " and this pipeline re-encodes lossily, which flattens near-white ink further" : ""}. Darken the ink or raise the opacity.`,
    );
  } else if (contrastVerdict === "marginal") {
    reasons.push(
      `Contrast of ${ratio.toFixed(2)}:1 is under ${profile.label}'s ${profile.legibleContrastRatio}:1 reliable threshold.`,
    );
  }

  return {
    instanceId: instance.id,
    providerId: profile.id,
    pxPerPoint,
    capHeightPx: cap,
    contrastRatio: ratio,
    verdict: worst(sizeVerdict, contrastVerdict),
    reasons,
  };
}

export interface AssessPlanInput {
  plan: GuardPlan;
  /** Page sizes by 0-based index. Instances on a page with no entry here are skipped. */
  pages: Map<number, PageSize>;
  rasterScale: number;
  backgroundHex?: string;
  providers?: VisionProviderId[];
}

/**
 * Rolls the per-instance predictions up to one verdict per provider.
 *
 * The rollup takes the **best** instance, not the average: the notice only has
 * to be read once, and a plan that ships one reliable footer plus three
 * marginal fallbacks is a good plan, not a three-quarters-failed one.
 */
export function assessPlan(input: AssessPlanInput): ProviderCoverage[] {
  const providers = input.providers ?? input.plan.targetProviders;
  const backgroundHex = input.backgroundHex ?? "#ffffff";

  return providers.map((providerId) => {
    const profile = getProviderProfile(providerId);
    const perInstance: InstanceLegibility[] = [];

    for (const instance of input.plan.instances) {
      const page = input.pages.get(instance.pageIndex);
      if (!page) continue;
      perInstance.push(
        assessInstance({ instance, profile, page, rasterScale: input.rasterScale, backgroundHex }),
      );
    }

    const best = perInstance.reduce<InstanceLegibility | null>(
      (winner, candidate) =>
        winner === null || rank(candidate.verdict) > rank(winner.verdict) ? candidate : winner,
      null,
    );

    return {
      providerId,
      label: profile.label,
      verdict: best?.verdict ?? "unreadable",
      bestInstanceId: best?.instanceId ?? null,
      perInstance,
    };
  });
}

/**
 * The smallest font size, in points, whose cap height still clears a
 * provider's reliable floor after that provider's rescaling.
 *
 * This is what makes the plan *provider-aware* rather than a fixed stamp size:
 * the ladder in `plan.ts` sizes its type from this number for the harshest
 * pipeline in the target set, instead of picking a size that happens to look
 * right at 100% zoom on the author's screen.
 */
export function minimumLegibleFontSizePt(
  profile: ProviderProfile,
  page: PageSize,
  rasterScale: number,
): number {
  const pxPerPoint = providerPxPerPoint(profile, page, rasterScale);
  if (pxPerPoint <= 0) return Number.POSITIVE_INFINITY;
  return profile.legibleCapHeightPx / (CAP_HEIGHT_RATIO * pxPerPoint);
}

function tier(value: number, reliable: number, floor: number): LegibilityVerdict {
  if (value >= reliable) return "reliable";
  if (value >= floor) return "marginal";
  return "unreadable";
}

function rank(verdict: LegibilityVerdict): number {
  return verdict === "reliable" ? 2 : verdict === "marginal" ? 1 : 0;
}

function worst(a: LegibilityVerdict, b: LegibilityVerdict): LegibilityVerdict {
  return rank(a) <= rank(b) ? a : b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.trim().replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a #rrggbb color: "${hex}"`);
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}
