// AI settings live here so the model can be switched without touching code.
// "gemini-flash-latest" always points at Google's current Flash model on the free tier.
// To pin a specific model, set GEMINI_MODEL in your environment (e.g. "gemini-2.5-flash").
export const aiConfig = {
  provider: "gemini" as const,
  model: process.env.GEMINI_MODEL || "gemini-flash-latest",
  // Retries for temporary failures (rate limits, overloaded model).
  maxRetries: 2,
  retryBaseDelayMs: 2000,
  temperature: 0.4,
};
