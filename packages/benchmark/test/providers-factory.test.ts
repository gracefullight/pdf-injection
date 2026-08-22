import { describe, expect, test } from "bun:test";
import { createProvider } from "../src/providers/factory";

describe("createProvider gating (no network)", () => {
  test("anthropic is not configured when no API key is present in env", () => {
    const provider = createProvider({ name: "anthropic", env: {} });
    expect(provider.name).toBe("anthropic");
    expect(provider.isConfigured()).toBe(false);
  });

  test("openai is not configured when no API key is present in env", () => {
    const provider = createProvider({ name: "openai", env: {} });
    expect(provider.name).toBe("openai");
    expect(provider.isConfigured()).toBe(false);
  });

  test("mock is always configured", () => {
    const provider = createProvider({ name: "mock", env: {} });
    expect(provider.name).toBe("mock");
    expect(provider.isConfigured()).toBe(true);
  });

  test("anthropic becomes configured once an API key is present, without making a network call", () => {
    const provider = createProvider({
      name: "anthropic",
      env: { ANTHROPIC_API_KEY: "sk-test-not-real" },
    });
    expect(provider.isConfigured()).toBe(true);
  });

  test("openai becomes configured once an API key is present, without making a network call", () => {
    const provider = createProvider({
      name: "openai",
      env: { OPENAI_API_KEY: "sk-test-not-real" },
    });
    expect(provider.isConfigured()).toBe(true);
  });

  test("an unconfigured anthropic adapter's askWithPdf resolves with PROVIDER_NOT_CONFIGURED (no network attempted)", async () => {
    const provider = createProvider({ name: "anthropic", env: {} });
    const answer = await provider.askWithPdf({
      pdfBytes: new Uint8Array([1, 2, 3]),
      prompt: "hello",
    });
    expect(answer.error).toBe("PROVIDER_NOT_CONFIGURED");
    expect(answer.text).toBe("");
  });

  test("an unconfigured openai adapter's askWithPdf resolves with PROVIDER_NOT_CONFIGURED (no network attempted)", async () => {
    const provider = createProvider({ name: "openai", env: {} });
    const answer = await provider.askWithPdf({
      pdfBytes: new Uint8Array([1, 2, 3]),
      prompt: "hello",
    });
    expect(answer.error).toBe("PROVIDER_NOT_CONFIGURED");
    expect(answer.text).toBe("");
  });

  test("model defaults come from env, and an explicit model overrides them", () => {
    const withDefault = createProvider({ name: "anthropic", env: {} });
    expect(withDefault.model).toBe("claude-opus-5");

    const withEnvOverride = createProvider({
      name: "openai",
      env: { PS_OPENAI_MODEL: "gpt-5.5-mini" },
    });
    expect(withEnvOverride.model).toBe("gpt-5.5-mini");

    const withExplicitOverride = createProvider({
      name: "anthropic",
      model: "claude-opus-5-20260101",
      env: {},
    });
    expect(withExplicitOverride.model).toBe("claude-opus-5-20260101");
  });
});
