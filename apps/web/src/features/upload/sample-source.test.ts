import { describe, expect, it } from "bun:test";
import {
  buildSampleFile,
  decideSampleCheckboxAction,
  SAMPLE_PDF_FILENAME,
} from "@/features/upload/sample-source";

describe("decideSampleCheckboxAction", () => {
  it("always fetches when checked, regardless of what's currently loaded", () => {
    expect(decideSampleCheckboxAction(true, null)).toEqual({ type: "fetch" });
    expect(decideSampleCheckboxAction(true, "manual")).toEqual({ type: "fetch" });
    expect(decideSampleCheckboxAction(true, "sample")).toEqual({ type: "fetch" });
  });

  it("clears the source when unchecked while the sample is the active source", () => {
    expect(decideSampleCheckboxAction(false, "sample")).toEqual({ type: "clear" });
  });

  it("does nothing when unchecked but a manual upload already replaced the sample", () => {
    expect(decideSampleCheckboxAction(false, "manual")).toEqual({ type: "ignore" });
  });

  it("does nothing when unchecked with nothing loaded (e.g. a cancelled in-flight fetch)", () => {
    expect(decideSampleCheckboxAction(false, null)).toEqual({ type: "ignore" });
  });
});

describe("buildSampleFile", () => {
  it("builds a File with the sample's fixed name and a PDF mime type", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const file = buildSampleFile(bytes);
    expect(file.name).toBe(SAMPLE_PDF_FILENAME);
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(bytes.length);
  });
});
