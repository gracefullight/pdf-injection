import { describe, expect, it } from "bun:test";
import {
  calculateSizeDelta,
  FORMAT_OPTIONS,
  formatBytes,
  RESOLUTION_OPTIONS,
} from "./rasterizer-helpers";

describe("rasterizer-helpers", () => {
  describe("formatBytes", () => {
    it("formats bytes under 1 KB as B", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(0)).toBe("0 B");
    });

    it("formats bytes in KB with one decimal place", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(2048 + 512)).toBe("2.5 KB");
    });

    it("formats bytes in MB with one decimal place", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
    });
  });

  describe("calculateSizeDelta", () => {
    it("calculates percentage increase correctly", () => {
      const delta = calculateSizeDelta(1000, 1500);
      expect(delta.isIncrease).toBe(true);
      expect(delta.percent).toBe(50);
      expect(delta.label).toBe("+50%");
    });

    it("calculates percentage decrease correctly", () => {
      const delta = calculateSizeDelta(1000, 600);
      expect(delta.isIncrease).toBe(false);
      expect(delta.percent).toBe(40);
      expect(delta.label).toBe("-40%");
    });

    it("handles zero original bytes safely", () => {
      const delta = calculateSizeDelta(0, 1000);
      expect(delta.percent).toBe(0);
      expect(delta.label).toBe("0%");
    });
  });

  describe("options presets", () => {
    it("provides standard resolution options including recommended 2.0x", () => {
      expect(RESOLUTION_OPTIONS.length).toBeGreaterThanOrEqual(3);
      const recommended = RESOLUTION_OPTIONS.find((opt) => opt.scale === 2.0);
      expect(recommended).toBeDefined();
      expect(recommended?.label).toContain("Recommended");
      expect(recommended?.dpi).toBe(144);
    });

    it("provides PNG and JPEG format options", () => {
      const formats = FORMAT_OPTIONS.map((f) => f.format);
      expect(formats).toContain("image/png");
      expect(formats).toContain("image/jpeg");
    });
  });
});
