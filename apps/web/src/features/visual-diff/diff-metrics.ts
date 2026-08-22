import type { InjectionMode } from "@pdf-injection/contracts";
import { diffThreshold } from "@pdf-injection/contracts";
import pixelmatch from "pixelmatch";

/**
 * Raw RGBA pixel buffer, decoupled from `ImageData`/canvas so this module stays
 * unit-testable under `bun test` without a DOM. In the browser these come from
 * `canvas.getContext("2d").getImageData(...)`.
 */
export interface RawImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface PageDiffResult {
  pageIndex: number;
  width: number;
  height: number;
  changedPixels: number;
  changedPixelRatio: number;
  maxChannelDelta: number;
  meanAbsoluteDifference: number;
  passed: boolean;
}

/** pixelmatch's own per-pixel color-distance threshold (PRD §13.4 / brief: 0.1). */
const PIXELMATCH_THRESHOLD = 0.1;

function toUint8ClampedArray(data: Uint8ClampedArray | Uint8Array): Uint8ClampedArray {
  return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
}

/** Computes pixelmatch-based diff metrics for a single rendered page pair. */
export function computePageDiff(
  source: RawImage,
  output: RawImage,
  pageIndex: number,
  mode: InjectionMode,
): PageDiffResult {
  if (source.width !== output.width || source.height !== output.height) {
    throw new Error(
      `Page ${pageIndex}: source/output canvas dimensions differ (${source.width}x${source.height} vs ${output.width}x${output.height})`,
    );
  }

  const { width, height } = source;
  const totalPixels = width * height;
  const diffBuffer = new Uint8ClampedArray(totalPixels * 4);

  const changedPixels = pixelmatch(
    toUint8ClampedArray(source.data),
    toUint8ClampedArray(output.data),
    diffBuffer,
    width,
    height,
    {
      threshold: PIXELMATCH_THRESHOLD,
    },
  );

  let maxChannelDelta = 0;
  let sumAbsDiff = 0;
  const srcData = source.data;
  const outData = output.data;
  for (let i = 0; i < srcData.length; i += 1) {
    const delta = Math.abs(srcData[i]! - outData[i]!);
    if (delta > maxChannelDelta) maxChannelDelta = delta;
    sumAbsDiff += delta;
  }
  const meanAbsoluteDifference = srcData.length > 0 ? sumAbsDiff / srcData.length : 0;
  const changedPixelRatio = totalPixels > 0 ? changedPixels / totalPixels : 0;
  const passed = changedPixelRatio <= diffThreshold(mode);

  return {
    pageIndex,
    width,
    height,
    changedPixels,
    changedPixelRatio,
    maxChannelDelta,
    meanAbsoluteDifference,
    passed,
  };
}

export interface VisualDiffAggregate {
  changedPixelRatio: number;
  passed: boolean;
}

/** Aggregates per-page diff results into the overall `changedPixelRatio`/`passed` posted to /client-validation. */
export function aggregateVisualDiff(
  pages: PageDiffResult[],
  mode: InjectionMode,
): VisualDiffAggregate {
  const totalChanged = pages.reduce((sum, page) => sum + page.changedPixels, 0);
  const totalPixels = pages.reduce((sum, page) => sum + page.width * page.height, 0);
  const changedPixelRatio = totalPixels > 0 ? totalChanged / totalPixels : 0;
  const passed = pages.every((page) => page.passed) && changedPixelRatio <= diffThreshold(mode);
  return { changedPixelRatio, passed };
}
