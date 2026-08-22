import { probeOllama } from "@pdf-injection/benchmark";
import type { AppConfig } from "../config";

export interface OllamaStatus {
  available: boolean;
  baseUrl: string;
  models: string[];
}

/** Contract addendum §6: `GET /api/v1/health.features.ollama` — probed via `GET {base}/api/tags`, cached 10s. */
const CACHE_MS = 10_000;

/**
 * Per-`AppConfig` probe cache (keyed by object identity, not `WeakMap`
 * across processes — one entry per running server / per test's own config
 * instance, so parallel tests using different `testConfig()` objects never
 * share a cached result). Never throws: `probeOllama` itself only resolves
 * `{available:false, models:[]}` on any failure (unreachable, non-2xx,
 * timeout, malformed body), and this wrapper defensively catches anyway.
 */
const cache = new WeakMap<AppConfig, { status: OllamaStatus; expiresAt: number }>();

/**
 * Shared by `GET /api/v1/health` (features.ollama) and the model-tests /
 * robustness services' provider gating (round-2 addendum §6: "ollama" is
 * LOCAL — no `PDFI_ALLOW_EXTERNAL_PROVIDERS` gate, but still needs an
 * availability check to return 422 `PROVIDER_NOT_CONFIGURED` instead of
 * letting a doomed request run all the way to a `PROVIDER_ERROR`).
 */
export async function getOllamaStatus(config: AppConfig): Promise<OllamaStatus> {
  const now = Date.now();
  const cached = cache.get(config);
  if (cached && cached.expiresAt > now) {
    return cached.status;
  }

  let status: OllamaStatus;
  try {
    const probe = await probeOllama(config.ollamaBaseUrl);
    status = { available: probe.available, baseUrl: config.ollamaBaseUrl, models: probe.models };
  } catch {
    status = { available: false, baseUrl: config.ollamaBaseUrl, models: [] };
  }

  cache.set(config, { status, expiresAt: now + CACHE_MS });
  return status;
}

/**
 * `@pdf-injection/benchmark`'s `createProvider({ name: "ollama" })` resolves
 * `baseUrl`/`model` from an `env` record (`OLLAMA_BASE_URL` /
 * `PDFI_OLLAMA_MODEL`, matching anthropic/openai's own env-driven
 * resolution). apps/api resolves those same two values through `AppConfig`
 * (with its own default-when-empty handling — see `loadConfig`), which is
 * the single source of truth `assertProvidersAllowed`'s gating check
 * (`getOllamaStatus`, above) already uses. This merges `config`'s resolved
 * values into `process.env` before the adapter is actually constructed for
 * a real request, so the gating check and the executed request always agree
 * on which Ollama server is being talked to — even in tests that override
 * `AppConfig.ollamaBaseUrl` without touching `process.env.OLLAMA_BASE_URL`.
 */
export function ollamaProviderEnv(config: AppConfig): Record<string, string | undefined> {
  return {
    ...process.env,
    OLLAMA_BASE_URL: config.ollamaBaseUrl,
    PDFI_OLLAMA_MODEL: config.ollamaModel,
  };
}
