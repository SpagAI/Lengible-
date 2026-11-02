// AI settings live here so the provider and model can be switched without touching code.
//
// Lengible (reading files, quizzes, flashcards) and Ally (the chat) can each use a different provider:
//   AI_PROVIDER   = gemini | anthropic | openai   (default gemini)
//   ALLY_PROVIDER = gemini | anthropic | openai   (default: same as AI_PROVIDER)
// Each provider needs its own key: GEMINI_API_KEY, ANTHROPIC_API_KEY (Claude) or OPENAI_API_KEY (ChatGPT).
// Models can be pinned per provider (GEMINI_MODEL, ANTHROPIC_MODEL, OPENAI_MODEL, and *_FALLBACK_MODEL),
// and Ally's separately with ALLY_MODEL / ALLY_FALLBACK_MODEL. GEMINI_EXTRA_MODELS adds more models to fall back on.

export type Provider = "gemini" | "anthropic" | "openai";
// extraModels: more models tried, in order, when the main and backup models have used up their allowance.
// On Gemini's free plan each model has its own allowance, so each one adds to what can be done in a day.
export type ModelChoice = { provider: Provider; model: string; fallbackModel: string; extraModels: string[] };

const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];
const pick = (v: string | undefined, fallback: Provider): Provider => (PROVIDERS.includes(v as Provider) ? (v as Provider) : fallback);

// Defaults for each provider: a capable main model, and a second one used when the main one is busy or out of quota.
const defaults: Record<Provider, { model: string; fallback: string }> = {
  // "gemini-flash-latest" always points at Google's current Flash model on the free tier.
  gemini: { model: process.env.GEMINI_MODEL || "gemini-flash-latest", fallback: process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest" },
  anthropic: { model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5", fallback: process.env.ANTHROPIC_FALLBACK_MODEL || "claude-sonnet-5-5" },
  openai: { model: process.env.OPENAI_MODEL || "gpt-5", fallback: process.env.OPENAI_FALLBACK_MODEL || "gpt-5-mini" },
};

const choice = (provider: Provider, model?: string, fallback?: string): ModelChoice => ({
  provider,
  model: model || defaults[provider].model,
  fallbackModel: fallback || defaults[provider].fallback,
  // e.g. GEMINI_EXTRA_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite (names as listed in AI Studio's rate limits page).
  extraModels: (process.env[`${provider.toUpperCase()}_EXTRA_MODELS`] ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
});

const mainProvider = pick(process.env.AI_PROVIDER, "gemini");
const allyProvider = pick(process.env.ALLY_PROVIDER, mainProvider);

export const aiConfig = {
  ...choice(mainProvider),
  // Ally, the chat assistant.
  ally: choice(allyProvider, process.env.ALLY_MODEL, process.env.ALLY_FALLBACK_MODEL),
  // Retries for temporary failures (rate limits, overloaded model): waits 2s, 4s, 8s.
  maxRetries: 3,
  retryBaseDelayMs: 2000,
  temperature: 0.4,
  // Claude only: how hard it thinks (low | medium | high). Lower is faster and cheaper.
  anthropicEffort: (process.env.ANTHROPIC_EFFORT || "medium") as "low" | "medium" | "high",
};

export const keyFor: Record<Provider, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };
export const providerName: Record<Provider, string> = { gemini: "Gemini", anthropic: "Claude", openai: "ChatGPT" };
