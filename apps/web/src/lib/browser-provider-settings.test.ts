import { describe, expect, it } from "bun:test";
import {
  clearBrowserProviderKey,
  DEFAULT_OPENAI_MODEL,
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

describe("browser provider settings", () => {
  it("keeps the API key in session storage and the model in local storage", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    saveBrowserProviderSettings(
      { openAiApiKey: "  sk-test  ", openAiModel: "  test-model  " },
      session,
      local,
    );
    expect(loadBrowserProviderSettings(session, local)).toEqual({
      openAiApiKey: "sk-test",
      openAiModel: "test-model",
    });
    expect(local.getItem("pdf-injection.openaiApiKey")).toBeNull();
  });

  it("clears only the secret and retains the model preference", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    saveBrowserProviderSettings(
      { openAiApiKey: "sk-test", openAiModel: "test-model" },
      session,
      local,
    );
    clearBrowserProviderKey(session);
    expect(loadBrowserProviderSettings(session, local)).toEqual({
      openAiApiKey: "",
      openAiModel: "test-model",
    });
  });

  it("uses a non-secret default model when no settings exist", () => {
    expect(loadBrowserProviderSettings(memoryStorage(), memoryStorage())).toEqual({
      openAiApiKey: "",
      openAiModel: DEFAULT_OPENAI_MODEL,
    });
  });
});
