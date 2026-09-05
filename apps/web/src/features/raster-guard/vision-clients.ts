import type { VisionProviderId } from "@pdf-injection/raster-guard";

/**
 * Bring-your-own-key checks against the three assistants, straight from the
 * browser.
 *
 * The coverage report is a prediction from documented ingestion geometry. This
 * is the ground truth: upload the guarded PDF exactly the way a student would
 * and read what comes back. Keys go from this tab to the vendor and nowhere
 * else — no request passes through this project's own API server, which is why
 * these three are plain `fetch` calls rather than a server-side adapter.
 *
 * OpenAI reuses `lib/openai-browser-client.ts` (the AI SDK path the Model Test
 * tab already uses). Anthropic and Google are hand-written here because adding
 * two more SDKs to the browser bundle for one request each is not worth it, and
 * both APIs accept a base64 document part over a single POST.
 */

/** Default outer prompt: what a student would plausibly type. */
export const STUDENT_STYLE_PROMPT =
  "Please read the attached assignment PDF and write a complete answer that meets every requirement in it.";

export interface VisionCheckRequest {
  apiKey: string;
  model: string;
  pdfBytes: Uint8Array;
  filename: string;
  prompt: string;
}

export interface VisionCheckResponse {
  outputText: string;
  raw: unknown;
}

/** Base64 for a byte array, chunked so a multi-megabyte PDF does not blow the argument limit of `String.fromCharCode`. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export const DEFAULT_VISION_MODELS: Record<VisionProviderId, string> = {
  chatgpt: "gpt-5.6-luna",
  claude: "claude-sonnet-5",
  gemini: "gemini-3-pro",
};

/**
 * Anthropic's Messages API, called directly from the page.
 *
 * `anthropic-dangerous-direct-browser-access` is required for a browser-origin
 * request and is named that way for a real reason: it means the key is present
 * in a web page. It is acceptable here only because the key is the user's own,
 * typed into this tab, held in `sessionStorage`, and never sent anywhere but
 * Anthropic.
 */
export async function callClaudeWithPdf(
  input: VisionCheckRequest,
  request: typeof fetch = fetch,
): Promise<VisionCheckResponse> {
  const response = await request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: input.model.trim(),
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: toBase64(input.pdfBytes),
              },
            },
            { type: "text", text: input.prompt },
          ],
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Claude returned HTTP ${response.status}`);
  }

  const outputText = (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  return { outputText, raw: payload };
}

/** Google's Generative Language API, called directly from the page with the user's own key. */
export async function callGeminiWithPdf(
  input: VisionCheckRequest,
  request: typeof fetch = fetch,
): Promise<VisionCheckResponse> {
  const model = encodeURIComponent(input.model.trim());
  const response = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: "application/pdf", data: toBase64(input.pdfBytes) } },
              { text: input.prompt },
            ],
          },
        ],
      }),
    },
  );

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini returned HTTP ${response.status}`);
  }

  const outputText = (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();

  return { outputText, raw: payload };
}
