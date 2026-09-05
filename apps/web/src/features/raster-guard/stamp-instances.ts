import type { GuardChannel, GuardInstance, GuardPlan } from "@pdf-injection/raster-guard";

/**
 * The painter: writes a planned instance into the page bitmap.
 *
 * The context is expected to already carry a `scale(rasterScale, rasterScale)`
 * transform, so everything here is expressed in **PDF points** and a CSS
 * `Npx` font size means N points. That keeps this module in the same units as
 * `@pdf-injection/raster-guard`, which never has to know the raster resolution.
 *
 * The 2D surface is narrowed to the handful of members actually used, the same
 * way `packages/pdf-engine`'s `CanvasContext2DLike` does, so the wrapping and
 * placement logic is unit-testable with a fake context and no DOM.
 */
export interface StampContext2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
  font: string;
  fillStyle: string;
  textBaseline: string;
  globalAlpha: number;
}

/**
 * Narrows a DOM 2D context to `StampContext2D`.
 *
 * A direct structural match is impossible: the DOM types `fillStyle` as
 * `string | CanvasGradient | CanvasPattern` and `textBaseline` as a string
 * union, while the painter only ever assigns plain strings. Adapting keeps that
 * assignment type-safe instead of casting the whole context — the same approach
 * `packages/pdf-engine`'s `inject-image-only-browser.ts` takes.
 */
export function adaptStampContext(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): StampContext2D {
  return {
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    translate: (x, y) => ctx.translate(x, y),
    rotate: (radians) => ctx.rotate(radians),
    fillText: (text, x, y) => ctx.fillText(text, x, y),
    measureText: (text) => ctx.measureText(text),
    get font() {
      return ctx.font;
    },
    set font(value: string) {
      ctx.font = value;
    },
    get fillStyle() {
      return typeof ctx.fillStyle === "string" ? ctx.fillStyle : "";
    },
    set fillStyle(value: string) {
      ctx.fillStyle = value;
    },
    get textBaseline() {
      return ctx.textBaseline;
    },
    set textBaseline(value: string) {
      ctx.textBaseline = value as CanvasTextBaseline;
    },
    get globalAlpha() {
      return ctx.globalAlpha;
    },
    set globalAlpha(value: number) {
      ctx.globalAlpha = value;
    },
  };
}

/**
 * Kept deliberately narrow and metric-stable rather than `system-ui`: the
 * legibility model assumes a 0.7 cap-height ratio, and a system stack resolves
 * to a different face on every platform, which would quietly invalidate the
 * prediction the coverage report is built on.
 */
export const STAMP_FONT_STACK = "Helvetica, Arial, sans-serif";

/** The watermark rung is painted bold: heavier strokes carry more low-frequency energy, which is exactly what survives a downscale. */
const BOLD_CHANNELS: GuardChannel[] = ["lowfreq_watermark"];

export function fontStringFor(instance: GuardInstance): string {
  const weight = BOLD_CHANNELS.includes(instance.channel) ? "700" : "400";
  return `${weight} ${instance.fontSizePt}px ${STAMP_FONT_STACK}`;
}

/** Greedy wrap using the context's real metrics. Hard `\n` breaks are always honoured. */
export function wrapWithMeasure(
  ctx: Pick<StampContext2D, "measureText">,
  text: string,
  maxWidthPt: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    let current = "";
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (current.length === 0 || ctx.measureText(candidate).width <= maxWidthPt) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  return lines;
}

/**
 * Paints one instance and returns the lines it drew.
 *
 * Rotation is applied about the rect's top-left corner, matching
 * `edgeStripRect()`'s contract: that rect is returned in the instance's own
 * pre-rotation frame, so `-90deg` sends the block up the left edge.
 */
export function stampInstance(ctx: StampContext2D, instance: GuardInstance): string[] {
  ctx.save();
  try {
    ctx.font = fontStringFor(instance);
    ctx.fillStyle = instance.colorHex;
    ctx.globalAlpha = instance.opacity;
    ctx.textBaseline = "top";
    ctx.translate(instance.rect.x, instance.rect.y);
    if (instance.rotationDeg !== 0) ctx.rotate((instance.rotationDeg * Math.PI) / 180);

    const lines = wrapWithMeasure(ctx, instance.text, instance.rect.width);
    lines.forEach((line, index) => {
      if (line.length > 0) ctx.fillText(line, 0, index * instance.lineHeightPt);
    });
    return lines;
  } finally {
    ctx.restore();
  }
}

/** Paints every instance the plan places on one page. Returns how many it painted. */
export function stampPageInstances(
  ctx: StampContext2D,
  plan: GuardPlan,
  pageIndex: number,
): number {
  const instances = plan.instances.filter((instance) => instance.pageIndex === pageIndex);
  for (const instance of instances) stampInstance(ctx, instance);
  return instances.length;
}
