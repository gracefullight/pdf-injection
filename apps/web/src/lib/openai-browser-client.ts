import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

export interface OpenAiPdfRequest {
  apiKey: string;
  model: string;
  pdfBytes: Uint8Array;
  filename: string;
  prompt: string;
}

export interface OpenAiPdfResponse {
  outputText: string;
  raw: unknown;
}

export async function callOpenAiWithPdf(
  input: OpenAiPdfRequest,
  request: typeof fetch = fetch,
): Promise<OpenAiPdfResponse> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("Enter an OpenAI API key in Settings before running a model test.");
  const model = input.model.trim();
  if (!model) throw new Error("Enter an OpenAI model in Settings before running a model test.");

  const openai = createOpenAI({ apiKey, fetch: request });
  const result = await generateText({
    model: openai.responses(model),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          {
            type: "file",
            data: input.pdfBytes,
            mediaType: "application/pdf",
            filename: input.filename,
          },
        ],
      },
    ],
    providerOptions: {
      openai: {
        store: false,
      },
    },
  });

  return {
    outputText: result.text,
    raw: {
      finishReason: result.finishReason,
      providerMetadata: result.providerMetadata,
      usage: result.usage,
    },
  };
}
