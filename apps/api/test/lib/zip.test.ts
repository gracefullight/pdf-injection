import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { buildZip, jsonZipEntry } from "../../src/lib/zip";

describe("buildZip", () => {
  test("round-trips multiple entries readable by fflate's own unzipSync", () => {
    const pdfBytesA = new Uint8Array([1, 2, 3, 4]);
    const pdfBytesB = new Uint8Array([5, 6, 7]);
    const zipBytes = buildZip([
      { path: "doc.A.injected.pdf", data: pdfBytesA },
      { path: "doc.B.injected.pdf", data: pdfBytesB },
      jsonZipEntry("manifest.json", { hello: "world" }),
    ]);

    const unzipped = unzipSync(zipBytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      "doc.A.injected.pdf",
      "doc.B.injected.pdf",
      "manifest.json",
    ]);
    expect(unzipped["doc.A.injected.pdf"]).toEqual(pdfBytesA);
    expect(unzipped["doc.B.injected.pdf"]).toEqual(pdfBytesB);
    expect(JSON.parse(strFromU8(unzipped["manifest.json"]!))).toEqual({ hello: "world" });
  });

  test("rejects an entry path containing a path separator (Zip Slip / CWE-22 defense in depth)", () => {
    expect(() => buildZip([{ path: "../../etc/passwd", data: new Uint8Array([1]) }])).toThrow();
    expect(() => buildZip([{ path: "sub/dir/file.pdf", data: new Uint8Array([1]) }])).toThrow();
    expect(() => buildZip([{ path: "sub\\dir\\file.pdf", data: new Uint8Array([1]) }])).toThrow();
  });

  test("allows a flat filename containing literal dots (not a traversal vector without a separator)", () => {
    const zipBytes = buildZip([{ path: "stem...injected.pdf", data: new Uint8Array([1]) }]);
    expect(Object.keys(unzipSync(zipBytes))).toEqual(["stem...injected.pdf"]);
  });
});
