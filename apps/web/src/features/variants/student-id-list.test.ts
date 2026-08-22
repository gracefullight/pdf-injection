import { describe, expect, it } from "bun:test";
import { parseStudentIdList } from "@/features/variants/student-id-list";

describe("parseStudentIdList", () => {
  it("returns an empty result for blank input", () => {
    expect(parseStudentIdList("")).toEqual({ ids: [], duplicates: [], blankLines: 1 });
  });

  it("trims whitespace and drops blank lines", () => {
    const result = parseStudentIdList("  s001  \n\nS002\n   \n");
    expect(result.ids).toEqual(["s001", "S002"]);
    expect(result.blankLines).toBe(3);
  });

  it("dedupes exact-match repeats while preserving first-seen order", () => {
    const result = parseStudentIdList("s001\ns002\ns001\ns003\ns002");
    expect(result.ids).toEqual(["s001", "s002", "s003"]);
    expect(result.duplicates).toEqual(["s001", "s002"]);
  });

  it("treats ids differing only in case as distinct", () => {
    const result = parseStudentIdList("s001\nS001");
    expect(result.ids).toEqual(["s001", "S001"]);
    expect(result.duplicates).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const result = parseStudentIdList("s001\r\ns002\r\n");
    expect(result.ids).toEqual(["s001", "s002"]);
  });
});
