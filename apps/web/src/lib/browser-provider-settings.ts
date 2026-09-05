/**
 * Bring-your-own-key settings for the three assistants this app can call
 * directly from the browser.
 *
 * Keys live in `sessionStorage` (gone when the tab closes, never written to
 * disk by this app) and model names in `localStorage` (a preference, not a
 * secret). No key ever passes through this project's own API server.
 */

/** Which vendor a stored credential belongs to. */
export type BrowserVendor = "openai" | "anthropic" | "google";

const API_KEY_STORAGE_KEYS: Record<BrowserVendor, string> = {
  openai: "pdf-injection.openaiApiKey",
  anthropic: "pdf-injection.anthropicApiKey",
  google: "pdf-injection.googleApiKey",
};

const MODEL_STORAGE_KEYS: Record<BrowserVendor, string> = {
  openai: "pdf-injection.openaiModel",
  anthropic: "pdf-injection.anthropicModel",
  google: "pdf-injection.googleModel",
};

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_GOOGLE_MODEL = "gemini-3-pro";

const DEFAULT_MODELS: Record<BrowserVendor, string> = {
  openai: DEFAULT_OPENAI_MODEL,
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  google: DEFAULT_GOOGLE_MODEL,
};

export const ALL_BROWSER_VENDORS: BrowserVendor[] = ["openai", "anthropic", "google"];

export interface BrowserProviderSettings {
  openAiApiKey: string;
  openAiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  googleApiKey: string;
  googleModel: string;
}

export function loadBrowserProviderSettings(
  session: Pick<Storage, "getItem"> = sessionStorage,
  local: Pick<Storage, "getItem"> = localStorage,
): BrowserProviderSettings {
  return {
    openAiApiKey: readKey(session, "openai"),
    openAiModel: readModel(local, "openai"),
    anthropicApiKey: readKey(session, "anthropic"),
    anthropicModel: readModel(local, "anthropic"),
    googleApiKey: readKey(session, "google"),
    googleModel: readModel(local, "google"),
  };
}

export function saveBrowserProviderSettings(
  settings: BrowserProviderSettings,
  session: Pick<Storage, "setItem" | "removeItem"> = sessionStorage,
  local: Pick<Storage, "setItem"> = localStorage,
): void {
  writeKey(session, "openai", settings.openAiApiKey);
  writeKey(session, "anthropic", settings.anthropicApiKey);
  writeKey(session, "google", settings.googleApiKey);
  writeModel(local, "openai", settings.openAiModel);
  writeModel(local, "anthropic", settings.anthropicModel);
  writeModel(local, "google", settings.googleModel);
}

/** Forgets stored API keys — one vendor's, or every vendor's when none is named. Model preferences are kept. */
export function clearBrowserProviderKey(
  session: Pick<Storage, "removeItem"> = sessionStorage,
  vendor?: BrowserVendor,
): void {
  const vendors = vendor ? [vendor] : ALL_BROWSER_VENDORS;
  for (const target of vendors) session.removeItem(API_KEY_STORAGE_KEYS[target]);
}

/** Blank settings with each vendor's default model — the shape a fresh tab loads. */
export function emptyBrowserProviderSettings(): BrowserProviderSettings {
  return {
    openAiApiKey: "",
    openAiModel: DEFAULT_OPENAI_MODEL,
    anthropicApiKey: "",
    anthropicModel: DEFAULT_ANTHROPIC_MODEL,
    googleApiKey: "",
    googleModel: DEFAULT_GOOGLE_MODEL,
  };
}

function readKey(session: Pick<Storage, "getItem">, vendor: BrowserVendor): string {
  return session.getItem(API_KEY_STORAGE_KEYS[vendor]) ?? "";
}

function readModel(local: Pick<Storage, "getItem">, vendor: BrowserVendor): string {
  return local.getItem(MODEL_STORAGE_KEYS[vendor]) || DEFAULT_MODELS[vendor];
}

function writeKey(
  session: Pick<Storage, "setItem" | "removeItem">,
  vendor: BrowserVendor,
  value: string,
): void {
  const key = value.trim();
  if (key) session.setItem(API_KEY_STORAGE_KEYS[vendor], key);
  else session.removeItem(API_KEY_STORAGE_KEYS[vendor]);
}

function writeModel(local: Pick<Storage, "setItem">, vendor: BrowserVendor, value: string): void {
  local.setItem(MODEL_STORAGE_KEYS[vendor], value.trim() || DEFAULT_MODELS[vendor]);
}
