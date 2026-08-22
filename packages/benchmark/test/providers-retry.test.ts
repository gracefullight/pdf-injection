import { afterAll, describe, expect, mock, test } from "bun:test";

// QA cycle-1 HIGH regression: the SDK clients must be constructed with
// maxRetries: 0 (retry policy owned entirely by withRetryOnce()). Before the
// fix, `new Anthropic({..., maxRetries: 1})` / `new OpenAI({..., maxRetries: 1})`
// meant the SDK itself silently retried once internally on a retryable
// error, *underneath* withRetryOnce()'s own retry — up to 4 real HTTP
// attempts per call instead of the contract's "1 retry" (2 total attempts).
//
// This stubs the vendor SDK modules (via bun:test's mock.module, registered
// before the adapters are imported) so we can count exactly how many times
// the underlying `messages.create()` / `responses.create()` is invoked,
// without any real network I/O.

let anthropicCreateCalls = 0;
let anthropicLastOptions: Record<string, unknown> | undefined;
let anthropicMode: "retryable" | "non-retryable" = "retryable";

class FakeAnthropicRateLimitError extends Error {
  status = 429;
}
class FakeAnthropicApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

mock.module("@anthropic-ai/sdk", () => {
  class FakeAnthropicClient {
    messages = {
      create: async () => {
        anthropicCreateCalls++;
        if (anthropicMode === "retryable") throw new FakeAnthropicRateLimitError("rate limited");
        throw new FakeAnthropicApiError(400, "bad request");
      },
    };
    constructor(options: Record<string, unknown>) {
      anthropicLastOptions = options;
    }
  }
  return {
    default: FakeAnthropicClient,
    APIError: FakeAnthropicApiError,
    RateLimitError: FakeAnthropicRateLimitError,
  };
});

let openaiCreateCalls = 0;
let openaiLastOptions: Record<string, unknown> | undefined;
let openaiMode: "retryable" | "non-retryable" = "retryable";

class FakeOpenAiRateLimitError extends Error {
  status = 429;
}
class FakeOpenAiApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

mock.module("openai", () => {
  class FakeOpenAiClient {
    responses = {
      create: async () => {
        openaiCreateCalls++;
        if (openaiMode === "retryable") throw new FakeOpenAiRateLimitError("rate limited");
        throw new FakeOpenAiApiError(400, "bad request");
      },
    };
    constructor(options: Record<string, unknown>) {
      openaiLastOptions = options;
    }
  }
  return {
    default: FakeOpenAiClient,
    APIError: FakeOpenAiApiError,
    RateLimitError: FakeOpenAiRateLimitError,
  };
});

const { createAnthropicAdapter } = await import("../src/providers/anthropic");
const { createOpenAiAdapter } = await import("../src/providers/openai");

afterAll(() => {
  mock.restore();
});

describe("retry-count stacking regression (QA cycle-1 HIGH)", () => {
  test("anthropic: a persistently-retryable error results in exactly 2 total SDK calls (1 initial + 1 retry)", async () => {
    anthropicMode = "retryable";
    anthropicCreateCalls = 0;
    const adapter = createAnthropicAdapter({ apiKey: "sk-test-not-real", model: "claude-test" });
    const answer = await adapter.askWithPdf({
      pdfBytes: new Uint8Array([1, 2, 3]),
      prompt: "hello",
    });

    expect(anthropicCreateCalls).toBe(2);
    expect(answer.error).toBeTruthy();
    expect(answer.text).toBe("");
    // Confirms the fix: the SDK client itself must not also retry (maxRetries: 0) —
    // otherwise this count would be 3 or 4, not 2.
    expect(anthropicLastOptions?.maxRetries).toBe(0);
  });

  test("anthropic: a non-retryable (4xx) error results in exactly 1 SDK call (no retry)", async () => {
    anthropicMode = "non-retryable";
    anthropicCreateCalls = 0;
    const adapter = createAnthropicAdapter({ apiKey: "sk-test-not-real", model: "claude-test" });
    const answer = await adapter.askWithPdf({
      pdfBytes: new Uint8Array([1, 2, 3]),
      prompt: "hello",
    });

    expect(anthropicCreateCalls).toBe(1);
    expect(answer.error).toBeTruthy();
  });

  test("openai: a persistently-retryable error results in exactly 2 total SDK calls (1 initial + 1 retry)", async () => {
    openaiMode = "retryable";
    openaiCreateCalls = 0;
    const adapter = createOpenAiAdapter({ apiKey: "sk-test-not-real", model: "gpt-test" });
    const answer = await adapter.askWithPdf({
      pdfBytes: new Uint8Array([1, 2, 3]),
      prompt: "hello",
    });

    expect(openaiCreateCalls).toBe(2);
    expect(answer.error).toBeTruthy();
    expect(answer.text).toBe("");
    expect(openaiLastOptions?.maxRetries).toBe(0);
  });

  test("openai: a non-retryable (4xx) error results in exactly 1 SDK call (no retry)", async () => {
    openaiMode = "non-retryable";
    openaiCreateCalls = 0;
    const adapter = createOpenAiAdapter({ apiKey: "sk-test-not-real", model: "gpt-test" });
    const answer = await adapter.askWithPdf({
      pdfBytes: new Uint8Array([1, 2, 3]),
      prompt: "hello",
    });

    expect(openaiCreateCalls).toBe(1);
    expect(answer.error).toBeTruthy();
  });
});
