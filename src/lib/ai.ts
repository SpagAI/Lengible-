import "server-only";
import { createHash } from "node:crypto";
import { GoogleGenAI, ApiError } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { aiConfig, keyFor, providerName, type ModelChoice, type Provider } from "@/config/ai";
import { createClient } from "@/lib/supabase/server";

// The only file that talks to an AI provider: Google Gemini, Anthropic Claude or OpenAI ChatGPT,
// chosen in src/config/ai.ts (AI_PROVIDER for Lengible, ALLY_PROVIDER for the Ally chat).

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
  // Several files (e.g. one image per slide), sent in order before the prompt.
  files?: { mimeType: string; data: string }[];
  // Set false for answers that should differ each time (e.g. a new day's quiz).
  cache?: boolean;
  // "ally": the Ally chat, which can use its own provider and model.
  purpose?: "ally";
};

let gemini: GoogleGenAI | null = null;
let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;
const notSet = (provider: Provider) =>
  new AIError(`The ${providerName[provider]} API key isn't set up yet. Add ${keyFor[provider]} to your environment (Vercel → Settings → Environment Variables).`, "not_configured");

function geminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw notSet("gemini");
  // GEMINI_BASE_URL is optional: point it at a proxy or a local stand-in for testing.
  const baseUrl = process.env.GEMINI_BASE_URL;
  gemini ??= new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  return gemini;
}
function anthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw notSet("anthropic");
  // Retries are handled below (with the fallback model), so the SDK's own are off.
  anthropic ??= new Anthropic({ maxRetries: 0 });
  return anthropic;
}
function openaiClient() {
  if (!process.env.OPENAI_API_KEY) throw notSet("openai");
  openai ??= new OpenAI({ maxRetries: 0 });
  return openai;
}

// Structured output schemas: objects closed to extra keys (Claude and ChatGPT require it).
function closeObjects(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = closeObjects(v);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}
const filesOf = (opts: GenerateOptions) => [...(opts.file ? [opts.file] : []), ...(opts.files ?? [])];

async function callGemini(prompt: string, opts: GenerateOptions, model: string): Promise<string> {
  const files = filesOf(opts);
  const response = await geminiClient().models.generateContent({
    model,
    contents: files.length ? [{ role: "user", parts: [...files.map((f) => ({ inlineData: f })), { text: prompt }] }] : prompt,
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

async function callClaude(prompt: string, opts: GenerateOptions, model: string): Promise<string> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...filesOf(opts).map((f) =>
      f.mimeType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } } as const)
        : ({ type: "image", source: { type: "base64", media_type: f.mimeType as "image/jpeg", data: f.data } } as const),
    ),
    { type: "text", text: prompt },
  ];
  // Current Claude models choose how much to think by themselves (effort sets how hard); sampling settings aren't used.
  const response = await anthropicClient().beta.messages.create({
    model,
    max_tokens: opts.maxOutputTokens ?? 16000,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content }],
    output_config: {
      effort: aiConfig.anthropicEffort,
      ...(opts.schema ? { format: { type: "json_schema" as const, schema: closeObjects(opts.schema) as Record<string, unknown> } } : {}),
    },
    // If Claude's safety checks decline a request, another Claude model answers instead.
    ...(/^claude-(opus-5|fable-5|sonnet-5-5)/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as never } : {}),
  });
  if (response.stop_reason === "refusal") throw new AIError("Claude declined this request. Try rephrasing it.", "bad_output");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (!text) throw new AIError("The AI returned an empty answer. Please try again.", "bad_output");
  return text;
}

async function callOpenAI(prompt: string, opts: GenerateOptions, model: string): Promise<string> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    ...filesOf(opts).map((f) =>
      f.mimeType === "application/pdf"
        ? ({ type: "file", file: { filename: "file.pdf", file_data: `data:application/pdf;base64,${f.data}` } } as const)
        : ({ type: "image_url", image_url: { url: `data:${f.mimeType};base64,${f.data}` } } as const),
    ),
    { type: "text", text: prompt },
  ];
  const response = await openaiClient().chat.completions.create({
    model,
    messages: [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), { role: "user", content: parts }],
    ...(opts.maxOutputTokens ? { max_completion_tokens: opts.maxOutputTokens } : {}),
    ...(opts.schema ? { response_format: { type: "json_schema" as const, json_schema: { name: "output", schema: closeObjects(opts.schema) as Record<string, unknown>, strict: false } } } : {}),
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new AIError("The AI returned an empty answer. Please try again.", "bad_output");
  return text;
}

function callModel(prompt: string, opts: GenerateOptions, provider: Provider, model: string): Promise<string> {
  if (provider === "anthropic") return callClaude(prompt, opts, model);
  if (provider === "openai") return callOpenAI(prompt, opts, model);
  return callGemini(prompt, opts, model);
}

// HTTP status of a provider error (any of the three SDKs).
const statusOf = (err: unknown) =>
  err instanceof ApiError || err instanceof Anthropic.APIError || err instanceof OpenAI.APIError ? Number((err as { status?: number }).status) : undefined;

function isRetryable(err: unknown) {
  const status = statusOf(err);
  return status === 429 || status === 500 || status === 503 || status === 529 || (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError);
}

async function tryModel(choice: ModelChoice, model: string, prompt: string, opts: GenerateOptions, retries: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callModel(prompt, opts, choice.provider, model);
    } catch (err) {
      if (err instanceof AIError || !isRetryable(err) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, aiConfig.retryBaseDelayMs * 2 ** attempt));
    }
  }
}

// Tries the main model (with retries), then the backup model, then explains what went wrong.
async function callWithRetry(prompt: string, opts: GenerateOptions): Promise<string> {
  const choice = opts.purpose === "ally" ? aiConfig.ally : aiConfig;
  let err: unknown;
  try {
    return await tryModel(choice, choice.model, prompt, opts, aiConfig.maxRetries);
  } catch (e) {
    err = e;
  }
  if (isRetryable(err) && choice.fallbackModel && choice.fallbackModel !== choice.model) {
    try {
      return await tryModel(choice, choice.fallbackModel, prompt, opts, 1);
    } catch (e) {
      err = e;
    }
  }
  if (err instanceof AIError) throw err;
  const status = statusOf(err);
  if (status === 429) {
    throw new AIError(
      `You've used your ${providerName[choice.provider]} AI allowance for now. Everything done so far is saved — try again in a few minutes, or tomorrow if it keeps happening.`,
      "rate_limit",
    );
  }
  if (isRetryable(err)) {
    throw new AIError(`${providerName[choice.provider]}'s AI servers are overloaded at the moment (not a problem with your file). Everything done so far is saved — try again in a few minutes.`, "busy");
  }
  if (status === 401 || status === 403) throw new AIError(`The ${providerName[choice.provider]} API key was refused. Check ${keyFor[choice.provider]} in your environment.`, "not_configured");
  console.error("AI call failed", err);
  throw new AIError("Something went wrong talking to the AI. Please try again.", "provider");
}

function cacheKey(prompt: string, opts: GenerateOptions) {
  return createHash("sha256")
    .update(JSON.stringify([opts.purpose === "ally" ? `${aiConfig.ally.provider}:${aiConfig.ally.model}` : `${aiConfig.provider}:${aiConfig.model}`, opts.system ?? "", opts.schema ?? null, prompt, opts.file?.data ?? "", (opts.files ?? []).map((f) => f.data)]))
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
  await supabase.from("ai_cache").upsert({ key, model: opts.purpose === "ally" ? aiConfig.ally.model : aiConfig.model, output });
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
  return Boolean(process.env[keyFor[aiConfig.provider]]);
}
// e.g. "Gemini (gemini-flash-latest)", for showing which AI is in use.
export const aiLabel = (purpose?: "ally") => {
  const c = purpose === "ally" ? aiConfig.ally : aiConfig;
  return `${providerName[c.provider]} (${c.model})`;
};

// ——— Search by meaning ———
// Turns text into a list of 768 numbers ("embedding") so pages and questions can be matched by meaning.
// Uses Gemini (gemini-embedding-001) when GEMINI_API_KEY is set, otherwise OpenAI; null when neither is set up.
export const EMBED_DIMS = 768;
export type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY";

export function canEmbed() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

export async function embedTexts(texts: string[], task: EmbedTask): Promise<number[][] | null> {
  if (!texts.length) return [];
  const clipped = texts.map((t) => t.slice(0, 8000) || " ");
  for (let attempt = 0; ; attempt++) {
    try {
      if (process.env.GEMINI_API_KEY) {
        const r = await geminiClient().models.embedContent({
          model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",
          contents: clipped,
          config: { outputDimensionality: EMBED_DIMS, taskType: task },
        });
        return (r.embeddings ?? []).map((e) => e.values ?? []);
      }
      if (process.env.OPENAI_API_KEY) {
        const r = await openaiClient().embeddings.create({ model: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small", input: clipped, dimensions: EMBED_DIMS });
        return r.data.map((d) => d.embedding);
      }
      return null;
    } catch (err) {
      if (!isRetryable(err) || attempt >= aiConfig.maxRetries) {
        if (statusOf(err) === 429) throw new AIError("You've used your AI allowance for search indexing for now. It carries on in a few minutes.", "rate_limit");
        if (isRetryable(err)) throw new AIError("The AI servers are busy. Search indexing carries on in a few minutes.", "busy");
        throw err;
      }
      await new Promise((r) => setTimeout(r, aiConfig.retryBaseDelayMs * 2 ** attempt));
    }
  }
}

// Postgres (pgvector) wants "[0.1,0.2,…]".
export const toVector = (v: number[]) => `[${v.join(",")}]`;
