import { describe, expect, it } from "bun:test";
import { callOpenAiWithPdf } from "@/lib/openai-browser-client";

describe("callOpenAiWithPdf", () => {
  it("sends the session key only in the Authorization header", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          id: "resp_test",
          created_at: 1,
          model: "test-model",
          output: [
            {
              type: "message",
              role: "assistant",
              id: "msg_test",
              content: [
                {
                  type: "output_text",
                  text: "model answer",
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await callOpenAiWithPdf(
      {
        apiKey: "sk-session-only",
        model: "test-model",
        pdfBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        filename: "assignment.pdf",
        prompt: "Read this PDF.",
      },
      request,
    );

    expect(capturedUrl).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toBe("Bearer sk-session-only");
    expect(capturedInit?.body).not.toContain("sk-session-only");
    expect(capturedInit?.body).toContain("application/pdf");
    expect(capturedInit?.body).toContain("assignment.pdf");
    expect(result.outputText).toBe("model answer");
  });

  it("rejects before making a request when the key is empty", async () => {
    let called = false;
    const request = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;

    await expect(
      callOpenAiWithPdf(
        {
          apiKey: " ",
          model: "test-model",
          pdfBytes: new Uint8Array(),
          filename: "assignment.pdf",
          prompt: "Read this PDF.",
        },
        request,
      ),
    ).rejects.toThrow("Enter an OpenAI API key");
    expect(called).toBe(false);
  });
});
