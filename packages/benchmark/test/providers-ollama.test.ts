import { describe, expect, test } from "bun:test";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  createOllamaAdapter,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  probeOllama,
} from "../src/providers/ollama";

async function buildPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 10, y: 250, size: 12, font, color: rgb(0, 0, 0), maxWidth: 280 });
  }
  return doc.save();
}

function fakeFetch(
  handlers: Record<string, (req: Request) => Response | Promise<Response>>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const handler = handlers[url.pathname];
    if (!handler) throw new Error(`No fake handler for path ${url.pathname}`);
    return handler(req);
  }) as unknown as typeof fetch;
}

describe("probeOllama (no network)", () => {
  test("reports available:true with the parsed model list on a 200 /api/tags response", async () => {
    const fetchImpl = fakeFetch({
      "/api/tags": () =>
        new Response(
          JSON.stringify({ models: [{ name: "llama3.1:latest" }, { name: "mistral" }] }),
          {
            status: 200,
          },
        ),
    });
    const result = await probeOllama("http://localhost:11434", 1500, fetchImpl);
    expect(result.available).toBe(true);
    expect(result.models).toEqual(["llama3.1:latest", "mistral"]);
  });

  test("reports available:false on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({
      "/api/tags": () => new Response("nope", { status: 500 }),
    });
    const result = await probeOllama("http://localhost:11434", 1500, fetchImpl);
    expect(result.available).toBe(false);
    expect(result.models).toEqual([]);
  });

  test("reports available:false when the fetch rejects (connection refused)", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await probeOllama("http://127.0.0.1:1", 1500, fetchImpl);
    expect(result.available).toBe(false);
    expect(result.models).toEqual([]);
  });

  test("reports available:false when the request exceeds the timeout (abort)", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch;
    const result = await probeOllama("http://localhost:11434", 5, fetchImpl);
    expect(result.available).toBe(false);
    expect(result.models).toEqual([]);
  });
});

describe("createOllamaAdapter (no network)", () => {
  test("askWithPdf probes first; when unreachable, returns PROVIDER_NOT_CONFIGURED and isConfigured() reflects that probe", async () => {
    const fetchImpl = fakeFetch({
      "/api/tags": () => new Response("nope", { status: 500 }),
    });
    const adapter = createOllamaAdapter({ fetchImpl });
    expect(adapter.name).toBe("ollama");
    expect(adapter.model).toBe(DEFAULT_OLLAMA_MODEL);

    const pdfBytes = await buildPdf(["Some page text."]);
    const answer = await adapter.askWithPdf({ pdfBytes, prompt: "Summarize this." });
    expect(answer.error).toBe("PROVIDER_NOT_CONFIGURED");
    expect(answer.text).toBe("");
    expect(adapter.isConfigured()).toBe(false);
  });

  test("askWithPdf extracts page text and posts it to /api/chat with the outer prompt; maps usage + ingestion", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = fakeFetch({
      "/api/tags": () =>
        new Response(JSON.stringify({ models: [{ name: "llama3.1" }] }), { status: 200 }),
      "/api/chat": async (req) => {
        capturedBody = (await req.json()) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            message: { role: "assistant", content: "Method A was used." },
            done_reason: "stop",
            prompt_eval_count: 42,
            eval_count: 7,
          }),
          { status: 200 },
        );
      },
    });
    const adapter = createOllamaAdapter({ baseUrl: "http://localhost:11434", fetchImpl });
    const pdfBytes = await buildPdf(["Page one content.", "Page two content."]);

    const answer = await adapter.askWithPdf({
      pdfBytes,
      prompt: "Read the attached assignment PDF and respond.",
    });

    expect(answer.text).toBe("Method A was used.");
    expect(answer.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(answer.ingestion).toBe("text_extraction");
    expect(answer.error).toBeUndefined();
    expect(adapter.isConfigured()).toBe(true);

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.role).toBe("user");
    expect(body.messages[0]?.content).toContain("Read the attached assignment PDF and respond.");
    expect(body.messages[0]?.content).toContain("Page one content.");
    expect(body.messages[0]?.content).toContain("Page two content.");
  });

  test("askText posts prompt+text to /api/chat without page extraction", async () => {
    const fetchImpl = fakeFetch({
      "/api/tags": () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
      "/api/chat": () =>
        new Response(
          JSON.stringify({
            message: { role: "assistant", content: "paraphrased text" },
            prompt_eval_count: 10,
            eval_count: 5,
          }),
          { status: 200 },
        ),
    });
    const adapter = createOllamaAdapter({ fetchImpl });
    const answer = await adapter.askText({ prompt: "Paraphrase:", text: "Original text." });
    expect(answer.text).toBe("paraphrased text");
    expect(answer.ingestion).toBe("text_extraction");
  });

  test("uses an explicit model override, and defaults baseUrl to DEFAULT_OLLAMA_BASE_URL", async () => {
    const fetchImpl = fakeFetch({
      "/api/tags": () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
      "/api/chat": async (req) => {
        const body = (await req.json()) as { model: string };
        expect(body.model).toBe("llama3.1:8b");
        expect(req.url.startsWith(DEFAULT_OLLAMA_BASE_URL)).toBe(true);
        return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
      },
    });
    const adapter = createOllamaAdapter({ model: "llama3.1:8b", fetchImpl });
    expect(adapter.model).toBe("llama3.1:8b");
    await adapter.askText({ prompt: "p", text: "t" });
  });

  test("an unexpected error from /api/chat is surfaced as ProviderAnswer.error (no throw)", async () => {
    const fetchImpl = fakeFetch({
      "/api/tags": () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
      "/api/chat": () => new Response("boom", { status: 500 }),
    });
    const adapter = createOllamaAdapter({ fetchImpl });
    const answer = await adapter.askText({ prompt: "p", text: "t" });
    expect(answer.error).toBeDefined();
    expect(answer.text).toBe("");
  });
});
