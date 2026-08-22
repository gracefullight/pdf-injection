import Anthropic, { APIError, RateLimitError } from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { withRetryOnce } from "./retry";
import type { AskTextInput, AskWithPdfInput, ProviderAdapter, ProviderAnswer } from "./types";

/** PS_ANTHROPIC_MODEL default per contract §0.2. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;
/** Client-side request timeout; retried requests reuse the same budget per call. */
const TIMEOUT_MS = 600_000;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Retry once on 429 (rate limit) or any 5xx APIError, per contract §2. */
function isRetryableAnthropicError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIError) {
    return typeof err.status === "number" && err.status >= 500;
  }
  return false;
}

function extractText(message: Message): string {
  return message.content
    .filter(
      (block): block is Extract<Message["content"][number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * `stop_reason === "refusal"` per contract §2 ("refusal = stop_reason
 * 'refusal'"); `stop_details?.category` (RefusalStopDetails) is recorded as
 * additional evidence when present but is not required for the boolean.
 */
function isRefusal(message: Message): boolean {
  return message.stop_reason === "refusal" || message.stop_details?.category != null;
}

export interface CreateAnthropicAdapterInput {
  apiKey?: string;
  model?: string;
}

/**
 * Anthropic provider adapter (packages/benchmark, contract §2 / §0.2).
 * Never constructs a network client when no API key is present — `isConfigured()`
 * is checked by callers (and internally) before any request is attempted.
 */
export function createAnthropicAdapter(input: CreateAnthropicAdapterInput = {}): ProviderAdapter {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const model = input.model ?? process.env.PS_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const configured = apiKey.length > 0;

  let client: Anthropic | null = null;
  function getClient(): Anthropic {
    if (!client) {
      // maxRetries: 0 — retry policy is owned entirely by withRetryOnce() below (1 retry on
      // 429/5xx per contract §2). Leaving the SDK's own maxRetries at its default (or 1) would
      // stack with withRetryOnce()'s own retry, multiplying real HTTP attempts (QA cycle-1 HIGH).
      client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
    }
    return client;
  }

  async function call(content: MessageParam["content"]): Promise<ProviderAnswer> {
    if (!configured) {
      return {
        text: "",
        stopReason: null,
        refusal: false,
        usage: { inputTokens: null, outputTokens: null },
        latencyMs: 0,
        error: "PROVIDER_NOT_CONFIGURED",
      };
    }

    const start = performance.now();
    try {
      const message = await withRetryOnce(
        () =>
          getClient().messages.create({
            model,
            max_tokens: MAX_TOKENS,
            messages: [{ role: "user", content }],
          }),
        isRetryableAnthropicError,
      );
      return {
        text: extractText(message),
        stopReason: message.stop_reason,
        refusal: isRefusal(message),
        usage: {
          inputTokens: message.usage.input_tokens ?? null,
          outputTokens: message.usage.output_tokens ?? null,
        },
        latencyMs: performance.now() - start,
        raw: message,
      };
    } catch (err) {
      return {
        text: "",
        stopReason: null,
        refusal: false,
        usage: { inputTokens: null, outputTokens: null },
        latencyMs: performance.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    name: "anthropic",
    model,
    isConfigured: () => configured,
    askWithPdf: ({ pdfBytes, prompt }: AskWithPdfInput) =>
      call([
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: toBase64(pdfBytes) },
        },
        { type: "text", text: prompt } satisfies TextBlockParam,
      ]),
    askText: ({ prompt, text }: AskTextInput) =>
      call([{ type: "text", text: `${prompt}\n\n${text}` } satisfies TextBlockParam]),
  };
}
