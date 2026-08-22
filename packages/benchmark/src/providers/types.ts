import type { ProviderName } from "@pdf-injection/contracts";

/** Token usage as reported by the provider. Either field is `null` when the provider omits it (e.g. `mock`, or an error response). */
export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Normalized answer shape every ProviderAdapter returns, regardless of the
 * underlying vendor SDK. `error` is set (and `text` left `""`) when the call
 * failed after retries, or when the adapter is not configured — callers
 * (packages/benchmark's runMatrix, apps/api) map a non-null `error` to
 * ModelTestResult.error / PROVIDER_ERROR / PROVIDER_NOT_CONFIGURED as
 * appropriate.
 */
export interface ProviderAnswer {
  text: string;
  stopReason: string | null;
  refusal: boolean;
  usage: ProviderUsage;
  latencyMs: number;
  raw?: unknown;
  error?: string;
}

export interface AskWithPdfInput {
  pdfBytes: Uint8Array;
  prompt: string;
  filename?: string;
}

export interface AskTextInput {
  prompt: string;
  text: string;
}

/**
 * Uniform interface implemented by every provider (anthropic, openai, mock).
 * `askWithPdf` is used by the Phase 3 model-test matrix; `askText` is used by
 * Phase 5 robustness transforms (paraphrase / translation) in
 * packages/robustness.
 */
export interface ProviderAdapter {
  readonly name: ProviderName;
  readonly model: string;
  /** True when the adapter can make a real network call (has credentials). `mock` is always `true`. */
  isConfigured(): boolean;
  askWithPdf(input: AskWithPdfInput): Promise<ProviderAnswer>;
  askText(input: AskTextInput): Promise<ProviderAnswer>;
}
