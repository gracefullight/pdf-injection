import type { ProviderName } from "@pdf-injection/contracts";
import { createAnthropicAdapter, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { createMockAdapter, DEFAULT_MOCK_MODEL, type MockContext } from "./mock";
import { createOpenAiAdapter, DEFAULT_OPENAI_MODEL } from "./openai";
import type { ProviderAdapter } from "./types";

export interface CreateProviderInput {
  name: ProviderName;
  /** Overrides the env-derived default model id. */
  model?: string;
  /** Defaults to `process.env`; pass an explicit object in tests to avoid relying on ambient env vars. */
  env?: Record<string, string | undefined>;
  /** Only consumed when `name === "mock"`; ignored otherwise. */
  mockContext?: MockContext;
}

/** Per-provider default model id, in case a caller wants it without constructing an adapter. */
export const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  openai: DEFAULT_OPENAI_MODEL,
  mock: DEFAULT_MOCK_MODEL,
};

/**
 * Builds a `ProviderAdapter` for `name`. Never makes a network call itself —
 * callers must check `isConfigured()` before using `anthropic`/`openai`
 * adapters for real requests (contract §2: gated behind
 * `PS_ALLOW_EXTERNAL_PROVIDERS`, `acknowledgeExternalTransfer`, and the
 * relevant API key). `mock` is always configured.
 */
export function createProvider(input: CreateProviderInput): ProviderAdapter {
  const env = input.env ?? process.env;
  switch (input.name) {
    case "anthropic":
      return createAnthropicAdapter({
        apiKey: env.ANTHROPIC_API_KEY,
        model: input.model ?? env.PS_ANTHROPIC_MODEL,
      });
    case "openai":
      return createOpenAiAdapter({
        apiKey: env.OPENAI_API_KEY,
        model: input.model ?? env.PS_OPENAI_MODEL,
      });
    case "mock":
      return createMockAdapter({ model: input.model, context: input.mockContext });
    default: {
      const exhaustive: never = input.name;
      throw new Error(`Unknown provider name: ${String(exhaustive)}`);
    }
  }
}
