import { describe, expect, test } from "bun:test";
import { capabilities } from "../src/capabilities";

describe("capabilities", () => {
  test("returns a boolean-shaped result and caches across calls", async () => {
    const a = await capabilities();
    const b = await capabilities();
    expect(typeof a.canvas).toBe("boolean");
    expect(typeof a.ocr).toBe("boolean");
    expect(typeof a.reasons).toBe("object");
    // Same cached promise resolution across calls.
    expect(a).toBe(b);
  });

  // This asserts the actual availability observed on the machine this round-2
  // build ran on (Bun 1.3.14, macOS arm64) — see the backend-r4 result memory
  // for the full availability report. Every downstream task that depends on
  // packages/robustness (r5a's robustness endpoints, r6's Robustness tab)
  // assumes both are true in this environment.
  test("canvas and OCR are both available in this environment", async () => {
    const caps = await capabilities();
    if (!caps.canvas) throw new Error(`canvas unavailable: ${caps.reasons.canvas}`);
    if (!caps.ocr) throw new Error(`ocr unavailable: ${caps.reasons.ocr}`);
    expect(caps.canvas).toBe(true);
    expect(caps.ocr).toBe(true);
  });
});
