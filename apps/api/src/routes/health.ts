import type { HealthResponse } from "@pdf-injection/contracts";
import { chineseFontAvailable, koreanFontAvailable } from "@pdf-injection/pdf-engine";
import { capabilities } from "@pdf-injection/robustness";
import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { getOllamaStatus } from "../services/ollama-status";

const APP_VERSION = "0.1.0";

export function healthRoutes(config: AppConfig) {
  return new Elysia().get("/api/v1/health", async (): Promise<HealthResponse> => {
    const [caps, koPayload, zhPayload, ollama] = await Promise.all([
      capabilities(),
      koreanFontAvailable(),
      chineseFontAvailable(),
      getOllamaStatus(config),
    ]);
    return {
      status: "ok",
      version: APP_VERSION,
      qpdfAvailable: config.qpdfEnabled && Bun.which("qpdf") !== null,
      features: {
        externalProviders: config.allowExternalProviders,
        researchMode: config.researchMode,
        ocrAvailable: caps.ocr,
        canvasAvailable: caps.canvas,
        koPayload,
        zhPayload,
        ollama,
      },
    };
  });
}
