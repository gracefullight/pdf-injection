import { describe, expect, it } from "bun:test";
import { canvasToImageBytes } from "./rasterize-pdf";

describe("canvasToImageBytes", () => {
  it("converts canvas using toBlob when available", async () => {
    const dummyBytes = new Uint8Array([1, 2, 3, 4]);
    const fakeBlob = {
      arrayBuffer: async () => dummyBytes.buffer,
    } as unknown as Blob;

    const fakeCanvas = {
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(fakeBlob);
      },
    } as unknown as HTMLCanvasElement;

    const result = await canvasToImageBytes(fakeCanvas, "image/png");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(dummyBytes);
  });

  it("throws an error when toBlob returns null", async () => {
    const fakeCanvas = {
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(null);
      },
    } as unknown as HTMLCanvasElement;

    await expect(canvasToImageBytes(fakeCanvas, "image/png")).rejects.toThrow(
      "Canvas toBlob returned null",
    );
  });

  it("falls back to toDataURL when toBlob is unavailable", async () => {
    // "AQIDBA==" is base64 for bytes [1, 2, 3, 4]
    const fakeCanvas = {
      toBlob: undefined,
      toDataURL: () => "data:image/png;base64,AQIDBA==",
    } as unknown as HTMLCanvasElement;

    const result = await canvasToImageBytes(fakeCanvas, "image/png");
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
