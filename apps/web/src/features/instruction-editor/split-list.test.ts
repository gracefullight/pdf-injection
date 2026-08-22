import { describe, expect, test } from "bun:test";
import { splitList } from "./signal-builder";

describe("splitList", () => {
  test("splits on commas, trims, drops empties", () => {
    expect(splitList("robustness, limitations")).toEqual(["robustness", "limitations"]);
    expect(splitList("a,,b ,")).toEqual(["a", "b"]);
  });
  test("partial typing keeps already-complete items and ignores a dangling separator", () => {
    expect(splitList("method c,")).toEqual(["method c"]);
    expect(splitList("method c, the ")).toEqual(["method c", "the"]);
  });
});
