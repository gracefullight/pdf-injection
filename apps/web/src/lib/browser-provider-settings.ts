const OPENAI_API_KEY_STORAGE_KEY = "pdf-injection.openaiApiKey";
const OPENAI_MODEL_STORAGE_KEY = "pdf-injection.openaiModel";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

export interface BrowserProviderSettings {
  openAiApiKey: string;
  openAiModel: string;
}

export function loadBrowserProviderSettings(
  session: Pick<Storage, "getItem"> = sessionStorage,
  local: Pick<Storage, "getItem"> = localStorage,
): BrowserProviderSettings {
  return {
    openAiApiKey: session.getItem(OPENAI_API_KEY_STORAGE_KEY) ?? "",
    openAiModel: local.getItem(OPENAI_MODEL_STORAGE_KEY) || DEFAULT_OPENAI_MODEL,
  };
}

export function saveBrowserProviderSettings(
  settings: BrowserProviderSettings,
  session: Pick<Storage, "setItem" | "removeItem"> = sessionStorage,
  local: Pick<Storage, "setItem"> = localStorage,
): void {
  const apiKey = settings.openAiApiKey.trim();
  const model = settings.openAiModel.trim() || DEFAULT_OPENAI_MODEL;

  if (apiKey) session.setItem(OPENAI_API_KEY_STORAGE_KEY, apiKey);
  else session.removeItem(OPENAI_API_KEY_STORAGE_KEY);
  local.setItem(OPENAI_MODEL_STORAGE_KEY, model);
}

export function clearBrowserProviderKey(
  session: Pick<Storage, "removeItem"> = sessionStorage,
): void {
  session.removeItem(OPENAI_API_KEY_STORAGE_KEY);
}
