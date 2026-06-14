// BYO-key AI settings, persisted in localStorage on the client only.
//
// Privacy: the API key never goes through Penta's app DB or the Rust vault — it
// lives in the browser/webview store and is passed per-request to the core,
// which forwards it to the chosen provider and never logs it.
import type { AiProviderKind, AiSettings } from "@/lib/api";

const KEY = "penta.ai.settings";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "ollama",
  model: "",
  api_key: "",
  base_url: "",
};

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore malformed storage
  }
  return { ...DEFAULT_AI_SETTINGS };
}

export function saveAiSettings(s: AiSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  ollama: "Local (Ollama)",
  anthropic: "Anthropic (BYO key)",
  open_ai_compatible: "OpenAI-compatible",
};

/** Whether this provider sends data off-device. */
export function isCloud(p: AiProviderKind): boolean {
  return p !== "ollama";
}
