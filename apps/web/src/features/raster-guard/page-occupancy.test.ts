import { describe, expect, it } from "bun:test";
import { inkBoxesFromImageData, sampleBackgroundHex } from "@/features/raster-guard/page-occupancy";

/** Builds an RGBA buffer of the given size, white except for the rows in `inkedRows`. */
function image(width: number, height: number, inkedRows: number[] = [], value = 0) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const y of inkedRows) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  return { data, width, height };
}

describe("inkBoxesFromImageData", () => {
  it("finds no ink on a blank page", () => {
    expect(inkBoxesFromImageData(image(20, 40), 612, 792, { rasterScale: 2 })).toEqual([]);
  });

  it("marks the band containing a drawn row, in page points", () => {
    const boxes = inkBoxesFromImageData(image(20, 40, [20]), 612, 792, {
      rasterScale: 2,
      rowHeightPt: 4,
    });
    expect(boxes).toHaveLength(1);
    // rowHeightPt 4 at scale 2 scans 8px bands, so row 20 lands in the band
    // starting at pixel row 16 — 16/40 of the way down an 792pt page.
    expect(boxes[0]?.y).toBeCloseTo(316.8, 1);
    expect(boxes[0]?.height).toBeCloseTo(158.4, 1);
    expect(boxes[0]?.width).toBe(612);
  });

  it("ignores near-white anti-aliasing noise rather than calling every row occupied", () => {
    const noisy = image(20, 40, [10], 250);
    expect(inkBoxesFromImageData(noisy, 612, 792, { rasterScale: 2 })).toEqual([]);
  });

  it("catches a scanned page, which has ink but no text items at all", () => {
    const scanned = image(20, 40, [5, 6, 7, 8, 20, 21, 30]);
    const boxes = inkBoxesFromImageData(scanned, 612, 792, { rasterScale: 2, rowHeightPt: 4 });
    expect(boxes.length).toBeGreaterThan(1);
  });

  it("returns nothing for a zero-sized image", () => {
    expect(inkBoxesFromImageData(image(0, 0), 612, 792, { rasterScale: 2 })).toEqual([]);
  });
});

describe("sampleBackgroundHex", () => {
  it("reads white paper as white", () => {
    expect(
      sampleBackgroundHex(image(20, 40), { x: 0, y: 0, width: 612, height: 100 }, 612, 792),
    ).toBe("#ffffff");
  });

  it("darkens when the notice sits over a shaded band", () => {
    const shaded = image(20, 40, [0, 1, 2, 3], 100);
    const hex = sampleBackgroundHex(shaded, { x: 0, y: 0, width: 612, height: 79 }, 612, 792);
    expect(hex).not.toBe("#ffffff");
    expect(Number.parseInt(hex.slice(1, 3), 16)).toBeLessThan(255);
  });

  it("falls back to white for a degenerate rectangle", () => {
    expect(sampleBackgroundHex(image(20, 40), { x: 0, y: 0, width: 0, height: 0 }, 612, 792)).toBe(
      "#ffffff",
    );
  });
});
