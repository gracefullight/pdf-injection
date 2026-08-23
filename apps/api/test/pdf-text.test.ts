import { describe, expect, test } from "bun:test";
import { extractFullPdfText } from "../src/lib/pdf-text";
import { fixtureFile } from "./helpers";

describe("extractFullPdfText", () => {
  test("does not emit the missing standard font data warning", async () => {
    const file = await fixtureFile("one-page-text.pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const messages: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => messages.push(args);

    try {
      const text = await extractFullPdfText(bytes);
      expect(text).toContain("This assignment asks students");
    } finally {
      console.log = originalLog;
    }

    expect(messages.flat().join(" ")).not.toContain("standardFontDataUrl");
  });
});
