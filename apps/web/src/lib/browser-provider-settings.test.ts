import { describe, expect, it } from "bun:test";
import {
  clearBrowserProviderKey,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENAI_MODEL,
  emptyBrowserProviderSettings,
  loadBrowserProviderSettings,
  saveBrowserProviderSettings,
} from "@/lib/browser-provider-settings";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const FILLED = {
  openAiApiKey: "  sk-test  ",
  openAiModel: "  test-model  ",
  anthropicApiKey: "sk-ant-test",
  anthropicModel: "claude-test",
  googleApiKey: "goog-test",
  googleModel: "gemini-test",
};

describe("browser provider settings", () => {
  it("keeps every API key in session storage and every model in local storage", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    saveBrowserProviderSettings(FILLED, session, local);

    expect(loadBrowserProviderSettings(session, local)).toEqual({
      openAiApiKey: "sk-test",
      openAiModel: "test-model",
      anthropicApiKey: "sk-ant-test",
      anthropicModel: "claude-test",
      googleApiKey: "goog-test",
      googleModel: "gemini-test",
    });
    expect(local.getItem("pdf-injection.openaiApiKey")).toBeNull();
    expect(local.getItem("pdf-injection.anthropicApiKey")).toBeNull();
    expect(local.getItem("pdf-injection.googleApiKey")).toBeNull();
  });

  it("clears every secret by default and retains the model preferences", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    saveBrowserProviderSettings(FILLED, session, local);
    clearBrowserProviderKey(session);

    const loaded = loadBrowserProviderSettings(session, local);
    expect(loaded.openAiApiKey).toBe("");
    expect(loaded.anthropicApiKey).toBe("");
    expect(loaded.googleApiKey).toBe("");
    expect(loaded.openAiModel).toBe("test-model");
    expect(loaded.googleModel).toBe("gemini-test");
  });

  it("clears one vendor's key without touching the others", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    saveBrowserProviderSettings(FILLED, session, local);
    clearBrowserProviderKey(session, "anthropic");

    const loaded = loadBrowserProviderSettings(session, local);
    expect(loaded.anthropicApiKey).toBe("");
    expect(loaded.openAiApiKey).toBe("sk-test");
    expect(loaded.googleApiKey).toBe("goog-test");
  });

  it("uses non-secret default models when no settings exist", () => {
    expect(loadBrowserProviderSettings(memoryStorage(), memoryStorage())).toEqual(
      emptyBrowserProviderSettings(),
    );
    expect(emptyBrowserProviderSettings()).toEqual({
      openAiApiKey: "",
      openAiModel: DEFAULT_OPENAI_MODEL,
      anthropicApiKey: "",
      anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      googleApiKey: "",
      googleModel: DEFAULT_GOOGLE_MODEL,
    });
  });
});
