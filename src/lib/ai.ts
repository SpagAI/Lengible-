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
    public kind: "rate_limit" | "not_configured" | "bad_output" | "provider",
  ) {
    super(message);
  }
}

export type GenerateOptions = {
  system?: string;
  // A JSON Schema; when given, the model must return JSON matching it.
  schema?: unknown;
  temperature?: number;
};

let client: GoogleGenAI | null = null;
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AIError("The Gemini API key isn't set up yet. Add GEMINI_API_KEY to your environment.", "not_configured");
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

async function callModel(prompt: string, opts: GenerateOptions): Promise<string> {
  const response = await getClient().models.generateContent({
    model: aiConfig.model,
    contents: prompt,
    config: {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? aiConfig.temperature,
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

async function callWithRetry(prompt: string, opts: GenerateOptions): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callModel(prompt, opts);
    } catch (err) {
      if (err instanceof AIError) throw err;
      if (isRetryable(err) && attempt < aiConfig.maxRetries) {
        await new Promise((r) => setTimeout(r, aiConfig.retryBaseDelayMs * 2 ** attempt));
        continue;
      }
      if (err instanceof ApiError && err.status === 429) {
        throw new AIError(
          "You've hit the free AI limit for now. Your saved questions and cards still work — try generating again in a minute or two.",
          "rate_limit",
        );
      }
      if (isRetryable(err)) {
        throw new AIError("The AI service is busy right now. Please try again shortly.", "provider");
      }
      throw new AIError("Something went wrong talking to the AI. Please try again.", "provider");
    }
  }
}

function cacheKey(prompt: string, opts: GenerateOptions) {
  return createHash("sha256")
    .update(JSON.stringify([aiConfig.model, opts.system ?? "", opts.schema ?? null, prompt]))
    .digest("hex");
}

// Generates text, reusing a saved answer when the exact same request was made before.
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
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
