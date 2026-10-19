import "server-only";
import { createHash } from "node:crypto";
import { GoogleGenAI, ApiError } from "@google/genai";
import { aiConfig } from "@/config/ai";
import { createClient } from "@/lib/supabase/server";

// The only file that talks to an AI provider. To switch providers, rewrite
// callModel() below and keep the exported functions' signatures the same.

export class AIError extends Error {
  constructor(
    message: string,
    public kind: "rate_limit" | "busy" | "not_configured" | "bad_output" | "provider",
  ) {
    super(message);
  }
}

export type GenerateOptions = {
  system?: string;
  // A JSON Schema; when given, the model must return JSON matching it.
  schema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  // A file for the model to read (image or PDF), sent alongside the prompt.
  file?: { mimeType: string; data: string };
  // Set false for answers that should differ each time (e.g. a new day's quiz).
  cache?: boolean;
};

let client: GoogleGenAI | null = null;
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AIError("The Gemini API key isn't set up yet. Add GEMINI_API_KEY to your environment.", "not_configured");
  }
  // GEMINI_BASE_URL is optional: point it at a proxy or a local stand-in for testing.
  const baseUrl = process.env.GEMINI_BASE_URL;
  client ??= new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  return client;
}

async function callModel(prompt: string, opts: GenerateOptions, model = aiConfig.model): Promise<string> {
  const response = await getClient().models.generateContent({
    model,
    contents: opts.file ? [{ role: "user", parts: [{ inlineData: opts.file }, { text: prompt }] }] : prompt,
    config: {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? aiConfig.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      ...(opts.schema ? { responseMimeType: "application/json", responseJsonSchema: opts.schema } : {}),
    },
  });
  const text = response.text;
  if (!text) throw new AIError("The AI returned an empty answer. Please try again.", "bad_output");
  return text;
}

function isRetryable(err: unknown) {
  return err instanceof ApiError && (err.status === 429 || err.status === 500 || err.status === 503);
}

async function tryModel(model: string, prompt: string, opts: GenerateOptions, retries: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callModel(prompt, opts, model);
    } catch (err) {
      if (err instanceof AIError || !isRetryable(err) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, aiConfig.retryBaseDelayMs * 2 ** attempt));
    }
  }
}

// Tries the main model (with retries), then the backup model, then explains what went wrong.
async function callWithRetry(prompt: string, opts: GenerateOptions): Promise<string> {
  let err: unknown;
  try {
    return await tryModel(aiConfig.model, prompt, opts, aiConfig.maxRetries);
  } catch (e) {
    err = e;
  }
  if (isRetryable(err) && aiConfig.fallbackModel && aiConfig.fallbackModel !== aiConfig.model) {
    try {
      return await tryModel(aiConfig.fallbackModel, prompt, opts, 1);
    } catch (e) {
      err = e;
    }
  }
  if (err instanceof AIError) throw err;
  if (err instanceof ApiError && err.status === 429) {
    throw new AIError(
      "You've used today's free AI allowance for now (Google's limit). Everything done so far is saved — try again in a few minutes, or tomorrow if it keeps happening.",
      "rate_limit",
    );
  }
  if (isRetryable(err)) {
    throw new AIError("Google's AI servers are overloaded at the moment (not a problem with your file). Everything done so far is saved — try again in a few minutes.", "busy");
  }
  throw new AIError("Something went wrong talking to the AI. Please try again.", "provider");
}

function cacheKey(prompt: string, opts: GenerateOptions) {
  return createHash("sha256")
    .update(JSON.stringify([aiConfig.model, opts.system ?? "", opts.schema ?? null, prompt, opts.file?.data ?? ""]))
    .digest("hex");
}

// Generates text, reusing a saved answer when the exact same request was made before.
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  if (opts.cache === false) return callWithRetry(prompt, opts);
  const key = cacheKey(prompt, opts);
  const supabase = await createClient();

  const { data: cached } = await supabase.from("ai_cache").select("output").eq("key", key).maybeSingle();
  if (cached) return cached.output;

  const output = await callWithRetry(prompt, opts);
  await supabase.from("ai_cache").upsert({ key, model: aiConfig.model, output });
  return output;
}

// Same as generateText, but parses the JSON the model returns.
export async function generateJSON<T>(prompt: string, schema: unknown, opts: Omit<GenerateOptions, "schema"> = {}): Promise<T> {
  const text = await generateText(prompt, { ...opts, schema });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AIError("The AI returned something unreadable. Please try again.", "bad_output");
  }
}

export function isAIConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}
