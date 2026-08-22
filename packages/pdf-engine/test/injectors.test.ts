import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { injectRenderMode3 } from "../src/inject-render-mode-3";
import { injectVisibleControl } from "../src/inject-visible-control";
import { injectWhiteText } from "../src/inject-white-text";
import { decodeAllStreamsAsText } from "./pdf-bytes-helpers";

async function freshDoc() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc;
}

describe("injectWhiteText", () => {
  test("draws white text and returns a bounding box + fontSize", async () => {
    const doc = await freshDoc();
    const result = await injectWhiteText({
      doc,
      pageIndex: 0,
      instruction: "hidden instruction text",
      position: "bottom",
    });
    expect(result.fontSize).toBe(1);
    expect(result.boundingBox).toHaveLength(4);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  test("output content stream sets the fill color to white (1 1 1 rg)", async () => {
    const doc = await freshDoc();
    await injectWhiteText({
      doc,
      pageIndex: 0,
      instruction: "white text marker",
      position: "bottom",
    });
    const bytes = await doc.save();
    const content = decodeAllStreamsAsText(bytes);
    expect(content).toMatch(/1 1 1 rg/);
  });
});

describe("injectRenderMode3", () => {
  test("draws invisible text and returns a bounding box + fontSize", async () => {
    const doc = await freshDoc();
    const result = await injectRenderMode3({
      doc,
      pageIndex: 0,
      instruction: "invisible instruction text",
      position: "bottom",
    });
    expect(result.fontSize).toBe(1);
    expect(result.boundingBox).toHaveLength(4);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  test("output content stream contains the `3 Tr` render-mode-3 operator", async () => {
    const doc = await freshDoc();
    await injectRenderMode3({
      doc,
      pageIndex: 0,
      instruction: "render mode 3 marker",
      position: "bottom",
    });
    const bytes = await doc.save();
    const content = decodeAllStreamsAsText(bytes);
    expect(content).toMatch(/3 Tr/);
  });

  test("does not set a visible fill color operator for the injected text", async () => {
    const doc = await freshDoc();
    await injectRenderMode3({
      doc,
      pageIndex: 0,
      instruction: "render mode 3 marker two",
      position: "bottom",
    });
    const bytes = await doc.save();
    const content = decodeAllStreamsAsText(bytes);
    expect(content).not.toMatch(/0 0 0 rg/);
  });
});

describe("injectVisibleControl", () => {
  test("draws visible black text at fontSize 9 regardless of requested fontSize", async () => {
    const doc = await freshDoc();
    const result = await injectVisibleControl({
      doc,
      pageIndex: 0,
      instruction: "visible control instruction",
      position: "bottom",
      fontSize: 1,
    });
    expect(result.fontSize).toBe(9);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  test("output content stream sets the fill color to black (0 0 0 rg or 0 g)", async () => {
    const doc = await freshDoc();
    await injectVisibleControl({
      doc,
      pageIndex: 0,
      instruction: "visible control marker",
      position: "top",
    });
    const bytes = await doc.save();
    const content = decodeAllStreamsAsText(bytes);
    expect(content).toMatch(/0 0 0 rg|0 g/);
  });
});
