import { describe, expect, it } from "bun:test";
import { parseContentDispositionFilename } from "@/lib/content-disposition";

describe("parseContentDispositionFilename", () => {
  it("parses a quoted filename", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="assignment.injected.pdf"',
        "fallback.pdf",
      ),
    ).toBe("assignment.injected.pdf");
  });

  it("parses an unquoted filename", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=report.json", "fallback.json"),
    ).toBe("report.json");
  });

  it("parses the RFC 5987 filename* form", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''report%20final.json",
        "fallback.json",
      ),
    ).toBe("report final.json");
  });

  it("falls back when the header is null", () => {
    expect(parseContentDispositionFilename(null, "fallback.pdf")).toBe("fallback.pdf");
  });

  it("falls back when the header has no filename", () => {
    expect(parseContentDispositionFilename("attachment", "fallback.pdf")).toBe("fallback.pdf");
  });
});
