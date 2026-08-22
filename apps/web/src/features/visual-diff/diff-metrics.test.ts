import { describe, expect, it } from "bun:test";
import {
  aggregateVisualDiff,
  computePageDiff,
  type RawImage,
} from "@/features/visual-diff/diff-metrics";

function solidImage(
  width: number,
  height: number,
  [r, g, b, a]: [number, number, number, number],
): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width, height };
}

describe("computePageDiff", () => {
  it("reports zero diff for identical images", () => {
    const source = solidImage(4, 4, [255, 255, 255, 255]);
    const output = solidImage(4, 4, [255, 255, 255, 255]);
    const result = computePageDiff(source, output, 0, "render_mode_3");
    expect(result.changedPixels).toBe(0);
    expect(result.changedPixelRatio).toBe(0);
    expect(result.maxChannelDelta).toBe(0);
    expect(result.meanAbsoluteDifference).toBe(0);
    expect(result.passed).toBe(true);
  });

  it("detects a fully-changed image and fails render_mode_3's tight threshold", () => {
    const source = solidImage(4, 4, [255, 255, 255, 255]);
    const output = solidImage(4, 4, [0, 0, 0, 255]);
    const result = computePageDiff(source, output, 0, "render_mode_3");
    expect(result.changedPixels).toBe(16);
    expect(result.changedPixelRatio).toBe(1);
    expect(result.maxChannelDelta).toBe(255);
    expect(result.passed).toBe(false);
  });

  it("visible_positive_control always passes regardless of diff magnitude", () => {
    const source = solidImage(4, 4, [255, 255, 255, 255]);
    const output = solidImage(4, 4, [0, 0, 0, 255]);
    const result = computePageDiff(source, output, 0, "visible_positive_control");
    expect(result.passed).toBe(true);
  });

  it("throws on mismatched dimensions", () => {
    const source = solidImage(4, 4, [255, 255, 255, 255]);
    const output = solidImage(2, 2, [255, 255, 255, 255]);
    expect(() => computePageDiff(source, output, 0, "white_text")).toThrow();
  });
});

describe("aggregateVisualDiff", () => {
  it("passes only when every page passes and the overall ratio is within threshold", () => {
    const passingPage = computePageDiff(
      solidImage(4, 4, [255, 255, 255, 255]),
      solidImage(4, 4, [255, 255, 255, 255]),
      0,
      "white_text",
    );
    const aggregate = aggregateVisualDiff([passingPage], "white_text");
    expect(aggregate.changedPixelRatio).toBe(0);
    expect(aggregate.passed).toBe(true);
  });

  it("fails when any single page fails even if the blended ratio looks small", () => {
    const bigPassingPage = computePageDiff(
      solidImage(100, 100, [255, 255, 255, 255]),
      solidImage(100, 100, [255, 255, 255, 255]),
      0,
      "render_mode_3",
    );
    const smallFailingPage = computePageDiff(
      solidImage(4, 4, [255, 255, 255, 255]),
      solidImage(4, 4, [0, 0, 0, 255]),
      1,
      "render_mode_3",
    );
    const aggregate = aggregateVisualDiff([bigPassingPage, smallFailingPage], "render_mode_3");
    expect(smallFailingPage.passed).toBe(false);
    expect(aggregate.passed).toBe(false);
  });
});
