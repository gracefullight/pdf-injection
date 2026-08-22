import { extractPagesText } from "@pdf-injection/validation";
import type { AskTextInput, AskWithPdfInput, ProviderAdapter, ProviderAnswer } from "./types";

/** PDFI_OLLAMA_MODEL default per contract addendum §6, used only when a request omits `model`. */
export const DEFAULT_OLLAMA_MODEL = "llama3.1";
/** OLLAMA_BASE_URL default per contract addendum §6. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
/** `GET {base}/api/tags` probe timeout, per contract addendum §6 ("1500 ms timeout"). */
const PROBE_TIMEOUT_MS = 1500;

export interface ProbeOllamaResult {
  available: boolean;
  models: string[];
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

/**
 * Probes `GET {baseUrl}/api/tags` (Ollama's "list local models" endpoint)
 * with a bounded timeout. Never throws — connection failures, non-2xx
 * responses, and timeouts all resolve `{ available: false, models: [] }`.
 * Used both by `GET /api/v1/health.features.ollama` (apps/api, cached 10s)
 * and by `createOllamaAdapter` itself before every request.
 */
export async function probeOllama(
  baseUrl: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeOllamaResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { available: false, models: [] };
    const body = (await res.json()) as OllamaTagsResponse;
    const models = Array.isArray(body.models)
      ? body.models
          .map((m) => m.name ?? m.model ?? "")
          .filter((name): name is string => name.length > 0)
      : [];
    return { available: true, models };
  } catch {
    // Connection refused, DNS failure, abort (timeout), or a malformed JSON
    // body — all treated the same: Ollama is not usable right now.
    return { available: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface CreateOllamaAdapterInput {
  /** Defaults to `process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL`. */
  baseUrl?: string;
  /** Defaults to `process.env.PDFI_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL`. */
  model?: string;
  /** Defaults to the global `fetch`; inject a fake in tests to avoid any real network I/O. */
  fetchImpl?: typeof fetch;
}

/**
 * Ollama local provider adapter (packages/benchmark, contract addendum §6).
 * Never gated by `PDFI_ALLOW_EXTERNAL_PROVIDERS` / `acknowledgeExternalTransfer`
 * (never leaves the machine) — apps/api's service layer enforces that
 * distinction; this adapter only concerns itself with talking to Ollama.
 *
 * Ollama cannot ingest a PDF document directly, so `askWithPdf` extracts all
 * page text server-side (`@pdf-injection/validation`'s `extractPagesText`)
 * and sends `outerPrompt + "\n\n---\n<PDF text>"` as a single user chat
 * message to `POST {base}/api/chat` (`stream:false`). `ProviderAnswer.usage`
 * is mapped from Ollama's `prompt_eval_count`/`eval_count`.
 *
 * `isConfigured()` reflects the outcome of the LAST probe performed by this
 * adapter instance (an internal `GET /api/tags` check run at the start of
 * every `askWithPdf`/`askText` call) — `false` until the first call
 * completes, since establishing "configured" requires an actual reachability
 * check rather than the presence of an env var (unlike anthropic/openai).
 */
export function createOllamaAdapter(input: CreateOllamaAdapterInput = {}): ProviderAdapter {
  const baseUrl = input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  const model = input.model ?? process.env.PDFI_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const fetchImpl = input.fetchImpl ?? fetch;

  let configured = false;

  async function chat(content: string): Promise<ProviderAnswer> {
    const start = performance.now();

    const probe = await probeOllama(baseUrl, PROBE_TIMEOUT_MS, fetchImpl);
    configured = probe.available;
    if (!probe.available) {
      return {
        text: "",
        stopReason: null,
        refusal: false,
        usage: { inputTokens: null, outputTokens: null },
        latencyMs: performance.now() - start,
        ingestion: "text_extraction",
        error: "PROVIDER_NOT_CONFIGURED",
      };
    }

    try {
      const res = await fetchImpl(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content }],
        }),
      });
      if (!res.ok) {
        return {
          text: "",
          stopReason: null,
          refusal: false,
          usage: { inputTokens: null, outputTokens: null },
          latencyMs: performance.now() - start,
          ingestion: "text_extraction",
          error: `Ollama request failed with status ${res.status}`,
        };
      }
      const body = (await res.json()) as OllamaChatResponse;
      return {
        text: body.message?.content ?? "",
        stopReason: body.done_reason ?? null,
        // Ollama's /api/chat has no structured refusal signal; runMatrix's
        // detectRefusalHeuristic() runs over `text` regardless of this flag.
        refusal: false,
        usage: {
          inputTokens: body.prompt_eval_count ?? null,
          outputTokens: body.eval_count ?? null,
        },
        latencyMs: performance.now() - start,
        ingestion: "text_extraction",
        raw: body,
      };
    } catch (err) {
      return {
        text: "",
        stopReason: null,
        refusal: false,
        usage: { inputTokens: null, outputTokens: null },
        latencyMs: performance.now() - start,
        ingestion: "text_extraction",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    name: "ollama",
    model,
    isConfigured: () => configured,
    async askWithPdf({ pdfBytes, prompt }: AskWithPdfInput): Promise<ProviderAnswer> {
      const pages = await extractPagesText(pdfBytes);
      const content = `${prompt}\n\n---\n${pages.join("\n\n")}`;
      return chat(content);
    },
    askText: ({ prompt, text }: AskTextInput) => chat(`${prompt}\n\n${text}`),
  };
}
