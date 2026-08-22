import OpenAI, { APIError, RateLimitError } from "openai";
import type { Response, ResponseInputItem } from "openai/resources/responses/responses";
import { withRetryOnce } from "./retry";
import type { AskTextInput, AskWithPdfInput, ProviderAdapter, ProviderAnswer } from "./types";

/** PDFI_OPENAI_MODEL default per contract §0.2. */
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const TIMEOUT_MS = 600_000;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Retry once on 429 (rate limit) or any 5xx APIError, per contract §2. */
function isRetryableOpenAiError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIError) {
    return typeof err.status === "number" && err.status >= 500;
  }
  return false;
}

/** True when any output item is a `message` whose content includes a `refusal` part. */
function isRefusal(res: Response): boolean {
  return res.output.some(
    (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
  );
}

export interface CreateOpenAiAdapterInput {
  apiKey?: string;
  model?: string;
}

/**
 * OpenAI provider adapter (packages/benchmark, contract §2 / §0.2) built on
 * the Responses API. Never constructs a network client when no API key is
 * present.
 */
export function createOpenAiAdapter(input: CreateOpenAiAdapterInput = {}): ProviderAdapter {
  const apiKey = input.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  const model = input.model ?? process.env.PDFI_OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const configured = apiKey.length > 0;

  let client: OpenAI | null = null;
  function getClient(): OpenAI {
    if (!client) {
      // maxRetries: 0 — retry policy is owned entirely by withRetryOnce() below (1 retry on
      // 429/5xx per contract §2). Leaving the SDK's own maxRetries at its default (or 1) would
      // stack with withRetryOnce()'s own retry, multiplying real HTTP attempts (QA cycle-1 HIGH).
      client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
    }
    return client;
  }

  async function call(content: ResponseInputItem[]): Promise<ProviderAnswer> {
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
      const res = await withRetryOnce(
        () =>
          getClient().responses.create({
            model,
            input: content,
          }),
        isRetryableOpenAiError,
      );
      return {
        text: res.output_text,
        stopReason: res.status ?? null,
        refusal: isRefusal(res),
        usage: {
          inputTokens: res.usage?.input_tokens ?? null,
          outputTokens: res.usage?.output_tokens ?? null,
        },
        latencyMs: performance.now() - start,
        raw: res,
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
    name: "openai",
    model,
    isConfigured: () => configured,
    askWithPdf: ({ pdfBytes, prompt, filename }: AskWithPdfInput) =>
      call([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: filename ?? "assignment.pdf",
              file_data: `data:application/pdf;base64,${toBase64(pdfBytes)}`,
            },
            { type: "input_text", text: prompt },
          ],
        },
      ]),
    askText: ({ prompt, text }: AskTextInput) =>
      call([{ role: "user", content: [{ type: "input_text", text: `${prompt}\n\n${text}` }] }]),
  };
}
