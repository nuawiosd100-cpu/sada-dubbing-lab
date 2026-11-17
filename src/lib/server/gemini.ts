/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only Google AI Studio (Gemini) client. API keys never leave the server.
// Every call can run on a specific key (a visitor's personal key) or on the server's built-in key.
import crypto from "node:crypto";
import { abortError, getFfmpeg, run } from "./media";
import type { Gender, Speaker, SpeakerAge } from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiErrorKind =
  | "config"
  | "auth"
  | "quota-day"
  | "rate"
  | "not-found"
  | "invalid"
  | "server"
  | "network"
  | "blocked";

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  model?: string;
  retryAfterSec?: number;
  constructor(kind: GeminiErrorKind, message: string, model?: string, retryAfterSec?: number) {
    super(message);
    this.name = "GeminiError";
    this.kind = kind;
    this.model = model;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Per-key state. `exhausted` holds models that reported a used-up daily quota: `until` is
 * Google's reset estimate (shown to the user); `recheckAt` is when we try the model again
 * anyway — soon, because a rejected request costs nothing and quota can return early
 * (rolling windows, billing being enabled).
 */
type KeyState = {
  exhausted: Map<string, { until: number; recheckAt: number }>;
  models: { at: number; names: Set<string> } | null;
};
const g = globalThis as typeof globalThis & { __geminiKeyStates?: Map<string, KeyState> };
const states: Map<string, KeyState> = (g.__geminiKeyStates ??= new Map());
const RECHECK_MS = 5 * 60_000;

// State is indexed by a hash, so raw keys are never used as map keys or logged.
const keyId = (apiKey: string) => crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 32);

function stateFor(apiKey: string): KeyState {
  const id = keyId(apiKey);
  let s = states.get(id);
  if (!s) {
    s = { exhausted: new Map(), models: null };
    states.set(id, s);
  }
  return s;
}

export function forgetKey(apiKey: string): void {
  states.delete(keyId(apiKey));
}

/** The key configured in the server environment (may be absent). */
export function getServerKey(): string | null {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_AI_STUDIO_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    null
  );
}

function requireKey(apiKey?: string | null): string {
  const key = apiKey || getServerKey();
  if (!key) {
    throw new GeminiError(
      "config",
      "No Google AI Studio API key is active. Paste your key in the “Google AI key” panel to activate the service.",
    );
  }
  return key;
}

const DEFAULT_TEXT = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];
const DEFAULT_TTS = [
  "gemini-3.8-flash-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-pro-preview-tts",
];

const envList = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function classify(status: number, json: any, model?: string): GeminiError {
  const err = json?.error ?? {};
  const msg = String(err.message ?? `HTTP ${status}`).split("\n")[0].trim();
  const details: any[] = Array.isArray(err.details) ? err.details : [];
  const reason = details.find((d) => d?.reason)?.reason;
  if (status === 401 || status === 403 || reason === "API_KEY_INVALID" || /API key (not valid|expired)/i.test(msg)) {
    return new GeminiError("auth", `Google rejected the API key: ${msg}`, model);
  }
  if (status === 404) return new GeminiError("not-found", msg, model);
  if (status === 429) {
    const retry = details.find((d) => String(d?.["@type"] ?? "").includes("RetryInfo"))?.retryDelay;
    const retryAfterSec = retry ? parseFloat(String(retry)) : undefined;
    const violations: any[] = details.find((d) => String(d?.["@type"] ?? "").includes("QuotaFailure"))?.violations ?? [];
    const perDay = violations.some((v) => /PerDay/i.test(String(v?.quotaId ?? "")));
    const freeTier = violations.some((v) => /FreeTier/i.test(String(v?.quotaId ?? "")));
    const limit = violations.find((v) => /PerDay/i.test(String(v?.quotaId ?? "")))?.quotaValue;
    if (perDay || (retryAfterSec ?? 0) > 180) {
      const tier = freeTier ? " on the Gemini free tier" : "";
      const lim = limit ? ` (limit: ${limit} requests/day)` : "";
      return new GeminiError("quota-day", `Daily request quota reached for ${model}${tier}${lim}.`, model, retryAfterSec);
    }
    return new GeminiError("rate", `Rate limit reached for ${model}.`, model, retryAfterSec);
  }
  if (status >= 500) return new GeminiError("server", msg, model);
  return new GeminiError("invalid", msg, model);
}

/** Models a key can call with generateContent (cached for 10 minutes; costs no quota). */
export async function listModels(apiKey?: string | null, force = false): Promise<Set<string>> {
  const key = requireKey(apiKey);
  const ks = stateFor(key);
  if (!force && ks.models && Date.now() - ks.models.at < 600_000) return ks.models.names;
  let res: Response;
  try {
    res = await fetch(`${BASE}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new GeminiError("network", `Could not reach the Gemini API: ${(e as Error).message}`);
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw classify(res.status, json);
  const names = new Set<string>();
  for (const m of json.models ?? []) {
    if ((m.supportedGenerationMethods ?? []).includes("generateContent")) {
      names.add(String(m.name).replace(/^models\//, ""));
    }
  }
  ks.models = { at: Date.now(), names };
  return names;
}

export async function modelChain(kind: "text" | "tts", apiKey?: string | null): Promise<string[]> {
  const override = envList(kind === "text" ? "GEMINI_TEXT_MODELS" : "GEMINI_TTS_MODELS");
  const pref = override.length ? override : kind === "text" ? DEFAULT_TEXT : DEFAULT_TTS;
  let available: Set<string> | null = null;
  try {
    available = await listModels(apiKey);
  } catch (e) {
    if (e instanceof GeminiError && (e.kind === "auth" || e.kind === "config")) throw e;
  }
  if (!available) return pref;
  const chain = pref.filter((m) => available.has(m));
  if (kind === "tts" && !override.length) {
    for (const m of available) if (/tts/i.test(m) && !chain.includes(m)) chain.push(m);
  }
  return chain.length ? chain : pref;
}

export function exhaustedModels(apiKey?: string | null): { model: string; until: number }[] {
  const key = apiKey || getServerKey();
  if (!key) return [];
  const ks = stateFor(key);
  const now = Date.now();
  const out: { model: string; until: number }[] = [];
  for (const [model, e] of ks.exhausted) {
    if (e.until > now) out.push({ model, until: e.until });
    else ks.exhausted.delete(model);
  }
  return out;
}

export type CallOpts = {
  signal?: AbortSignal;
  onNotice?: (msg: string) => void;
  timeoutMs?: number;
  /** Key to run this call on. Omitted = the server's built-in key. */
  apiKey?: string | null;
  /** Don't wait out rate limits or retry server errors (used for key verification). */
  fast?: boolean;
  /** Spoken output language for TTS. Defaults to Arabic for backwards compatibility. */
  language?: "ar" | "en";
};

async function callModel(model: string, body: unknown, opts: CallOpts): Promise<any> {
  const key = requireKey(opts.apiKey);
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 240_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (opts.signal?.aborted) throw abortError();
    if ((e as Error).name === "TimeoutError" || timeout.aborted) {
      throw new GeminiError("network", `${model} did not answer within ${Math.round((opts.timeoutMs ?? 240_000) / 1000)}s`, model);
    }
    throw new GeminiError("network", `Network error calling ${model}: ${(e as Error).message}`, model);
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    if (opts.signal?.aborted) throw abortError();
    if (timeout.aborted) {
      throw new GeminiError("network", `${model} did not finish answering within ${Math.round((opts.timeoutMs ?? 240_000) / 1000)}s`, model);
    }
    json = {};
  }
  if (!res.ok) throw classify(res.status, json, model);
  return json;
}

/**
 * Call the first model in the chain that can serve the request. Per-minute rate
 * limits are waited out; daily quota / unknown-model errors move on to the next model.
 */
async function generate(
  chain: string[],
  purpose: string,
  body: unknown,
  validate: (json: any, model: string) => void,
  opts: CallOpts,
): Promise<{ json: any; model: string }> {
  const ks = stateFor(requireKey(opts.apiKey));
  const isTransient = (e: GeminiError) => e.kind === "server" || e.kind === "network";
  const rounds = opts.fast ? 1 : 3;
  let errors: GeminiError[] = [];
  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      // Every model failed, and at least one only temporarily: pause, then try the chain again.
      const wait = 20 * round;
      opts.onNotice?.(`Gemini is temporarily unavailable for ${purpose}; trying again in ${wait}s.`);
      await sleep(wait * 1000, opts.signal);
    }
    errors = [];
    const result = await tryChain();
    if (result) return result;
    if (!errors.some(isTransient) || !errors.every((e) => isTransient(e) || e.kind === "quota-day")) break;
  }
  if (errors.length && errors.every((e) => e.kind === "quota-day")) {
    const soonest = Math.min(...errors.map((e) => e.retryAfterSec ?? 86_400));
    const hours = Math.max(1, Math.round(soonest / 3600));
    throw new GeminiError(
      "quota-day",
      `The Gemini API daily quota for ${purpose} is used up on the active API key (tried: ${chain.join(", ")}). ` +
        `It resets in about ${hours} hour${hours === 1 ? "" : "s"}. To continue sooner, enable billing for the key's project in Google AI Studio or activate a different key in the “Google AI key” panel, then press Resume — finished work is kept.`,
      undefined,
      soonest,
    );
  }
  throw errors[errors.length - 1] ?? new GeminiError("invalid", `No Gemini model is available for ${purpose}.`);

  async function tryChain(): Promise<{ json: any; model: string } | null> {
  for (const model of chain) {
    const known = ks.exhausted.get(model);
    if (known && known.recheckAt > Date.now()) {
      errors.push(new GeminiError("quota-day", `Daily request quota reached for ${model}.`, model, Math.max(60, (known.until - Date.now()) / 1000)));
      continue;
    }
    let attempt = 0;
    let transientRetries = 0;
    for (;;) {
      try {
        const json = await callModel(model, body, opts);
        validate(json, model);
        ks.exhausted.delete(model);
        return { json, model };
      } catch (e) {
        if (opts.signal?.aborted || (e as Error).name === "AbortError") throw abortError();
        const ge = e instanceof GeminiError ? e : new GeminiError("network", (e as Error).message, model);
        if (ge.kind === "auth" || ge.kind === "config") throw ge;
        if (ge.kind === "quota-day") {
          const waitMs = Math.max(60, ge.retryAfterSec ?? 3600) * 1000;
          ks.exhausted.set(model, { until: Date.now() + waitMs, recheckAt: Date.now() + Math.min(waitMs, RECHECK_MS) });
          opts.onNotice?.(`${ge.message} Trying the next available model.`);
          errors.push(ge);
          break;
        }
        if (ge.kind === "rate" && !opts.fast && attempt < 6) {
          const wait = Math.min(Math.ceil(ge.retryAfterSec ?? 20) + 1, 75);
          opts.onNotice?.(`Gemini rate limit reached on ${model}; waiting ${wait}s before continuing.`);
          await sleep(wait * 1000, opts.signal);
          attempt++;
          continue;
        }
        if (isTransient(ge) && !opts.fast && transientRetries < 1) {
          // One visible retry on the same model, then move on: other models can serve the request.
          transientRetries++;
          opts.onNotice?.(`Temporary problem with ${model} (${ge.message.slice(0, 120)}); retrying once.`);
          await sleep(3000, opts.signal);
          continue;
        }
        if (!opts.fast && ge.kind !== "rate") {
          opts.onNotice?.(`${model} could not serve this request (${ge.message.slice(0, 120)}); switching to the next model.`);
        }
        errors.push(ge);
        break;
      }
    }
  }
  return null;
  }
}

function textOf(json: any, model: string): string {
  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p: any) => typeof p?.text === "string" && !p.thought)
    .map((p: any) => p.text)
    .join("");
  if (!text) {
    const why = cand?.finishReason ?? json?.promptFeedback?.blockReason ?? "no content";
    throw new GeminiError("blocked", `${model} returned no text (${why}).`, model);
  }
  return text;
}

function parseJson(text: string, model: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new GeminiError("invalid", `${model} returned malformed JSON.`, model);
  }
}

/** One tiny real generation request: proves a key can actually generate (not just authenticate). */
export async function probeText(opts: CallOpts = {}): Promise<{ model: string }> {
  const chain = [...(await modelChain("text", opts.apiKey))].reverse();
  const body = {
    contents: [{ parts: [{ text: "Reply with the single word: ready" }] }],
    generationConfig: { temperature: 0 },
  };
  const { model } = await generate(chain, "text generation", body, () => {}, {
    ...opts,
    fast: true,
    timeoutMs: opts.timeoutMs ?? 30_000,
  });
  return { model };
}

// ------------------------------------------------------ language detection ---

export type Detection = { language: string; languageCode: string; hasSpeech: boolean; confidence: number; model: string };

export async function detectLanguage(audio: Buffer, mimeType: string, opts: CallOpts = {}): Promise<Detection> {
  // Cheapest models first: identifying a language is easy, so save the stronger models' quota.
  const chain = [...(await modelChain("text", opts.apiKey))].reverse();
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: audio.toString("base64") } },
          {
            text:
              "Listen to this audio taken from a video. Identify the main language spoken in the dialogue. " +
              "Return JSON with: language (English name of the language, e.g. \"English\", \"Hindi\"), " +
              "languageCode (ISO 639-1 code), hasSpeech (false if there is no intelligible speech), " +
              "confidence (0 to 1). If there is no speech, use language \"Unknown\" and languageCode \"und\".",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          language: { type: "STRING" },
          languageCode: { type: "STRING" },
          hasSpeech: { type: "BOOLEAN" },
          confidence: { type: "NUMBER" },
        },
        required: ["language", "languageCode", "hasSpeech", "confidence"],
      },
    },
  };
  let parsed: any = null;
  const { model } = await generate(chain, "language detection", body, (json, m) => {
    parsed = parseJson(textOf(json, m), m);
  }, opts);
  return {
    language: String(parsed?.language || "Unknown"),
    languageCode: String(parsed?.languageCode || "und").toLowerCase().slice(0, 8),
    hasSpeech: parsed?.hasSpeech !== false,
    confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0))),
    model,
  };
}

// ------------------------------------------- transcription + translation ---

export type RawSegment = { start: number; end: number; speaker: string; text: string; arabic?: string; translation?: string };
export type ChunkResult = { speakers: Speaker[]; segments: RawSegment[]; model: string };

/** "MM:SS.d", "H:MM:SS", "83.4" -> seconds */
export function parseTimestamp(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return NaN;
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

const normGender = (v: unknown): Gender => {
  const s = String(v ?? "").toLowerCase();
  return s === "male" || s === "female" ? s : "unknown";
};

const normAge = (v: unknown): SpeakerAge => {
  const s = String(v ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "child" || s === "kid" || s === "young_child") return "child";
  if (s === "young" || s === "teen" || s === "teenager" || s === "young_adult") return "young";
  if (s === "adult") return "adult";
  if (s === "mature" || s === "older" || s === "senior" || s === "elderly") return "mature";
  return "unknown";
};

export async function transcribeChunk(
  audio: Buffer,
  mimeType: string,
  ctx: { language: string; dialectPrompt: string; targetLanguage: "ar" | "en"; clipSeconds: number; knownSpeakers: Speaker[] },
  opts: CallOpts = {},
): Promise<ChunkResult> {
  const known = ctx.knownSpeakers.length
    ? "\nSpeakers already identified earlier in this same video (reuse a label when the voice matches its description; " +
      "create a new label, continuing the numbering, only for a genuinely new voice):\n" +
      ctx.knownSpeakers.map((s) => `- ${s.id}: ${s.gender}, ${s.age ?? "unknown age"}, ${s.description}`).join("\n") +
      "\n"
    : "";
  const targetName = ctx.targetLanguage === "en" ? "English" : "Arabic";
  const translationRules = ctx.targetLanguage === "en"
    ? "Write natural, fluent English phrased the way a voice actor would say it aloud. Do not leave Arabic words untranslated unless they are proper names."
    : "Write in Arabic script and phrased the way a voice actor would say it aloud. Write numbers out as Arabic words. No transliteration.";
  const prompt = `You are preparing a professional ${targetName} dubbing script from the attached audio clip (about ${Math.round(
    ctx.clipSeconds,
  )} seconds long), which is part of a longer video. The spoken language is ${ctx.language}.

Transcribe every spoken utterance and translate it into ${ctx.dialectPrompt}.

Rules:
- Split speech into short utterances: one sentence or breath group each, ideally 2 to 9 seconds. Never merge two different speakers into one utterance.
- "start" and "end" are timestamps measured from the beginning of THIS clip, formatted MM:SS.mmm (minutes, seconds, milliseconds), for example "01:23.456". Mark exactly where the voice starts and stops; the ${targetName} voice is placed at these millisecond times, so precision is critical.
- "speaker" is a stable label for each distinct voice: "S1", "S2", and so on. Tell speakers apart by how their voices sound.
- In "speakers", list every label you used with its gender ("male", "female" or "unknown"), an age band ("child", "young", "adult", "mature" or "unknown") estimated from the voice pitch, and a short English description of the voice and role (for example "young girl, child", "deep-voiced older man, narrator"). The age band decides whether a child/teen or mature voice is used.
- "text" is the exact wording in the original language.
- "translation" is a faithful, natural, fluent translation into ${ctx.dialectPrompt}. ${translationRules} Keep it about as long as the original so it can be spoken in the same amount of time. No notes, no brackets, no speaker names.
- Ignore music, sung lyrics, sound effects, noise and silence. If the clip contains no speech, return empty arrays.
${known}`;

  const body = {
    contents: [{ parts: [{ inlineData: { mimeType, data: audio.toString("base64") } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          speakers: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                gender: { type: "STRING", enum: ["male", "female", "unknown"] },
                age: { type: "STRING", enum: ["child", "young", "adult", "mature", "unknown"] },
                description: { type: "STRING" },
              },
              required: ["id", "gender", "description"],
            },
          },
          segments: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                start: { type: "STRING" },
                end: { type: "STRING" },
                speaker: { type: "STRING" },
                text: { type: "STRING" },
                translation: { type: "STRING" },
              },
              required: ["start", "end", "speaker", "text", "translation"],
            },
          },
        },
        required: ["speakers", "segments"],
      },
    },
  };

  let parsed: any = null;
  const { model } = await generate(await modelChain("text", opts.apiKey), "transcription and translation", body, (json, m) => {
    const p = parseJson(textOf(json, m), m);
    if (!p || !Array.isArray(p.segments)) throw new GeminiError("invalid", `${m} returned an unexpected script format.`, m);
    parsed = p;
    // Time allowed per model scales with the clip: 2 minutes for short clips, up to 7 for full 4-minute parts.
  }, { ...opts, timeoutMs: Math.round(Math.min(420, Math.max(120, 90 + ctx.clipSeconds * 1.2)) * 1000) });

  const label = (v: unknown) => String(v ?? "S1").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "S1";
  const speakers: Speaker[] = (Array.isArray(parsed.speakers) ? parsed.speakers : []).map((s: any) => ({
    id: label(s?.id),
    gender: normGender(s?.gender),
    age: normAge(s?.age),
    description: String(s?.description ?? "").slice(0, 160),
  }));
  const segments: RawSegment[] = [];
  for (const s of parsed.segments as any[]) {
    const start = parseTimestamp(s?.start);
    let end = parseTimestamp(s?.end);
    const translated = String(s?.translation ?? "").trim();
    if (Number.isNaN(start) || !translated) continue;
    if (Number.isNaN(end) || end <= start) end = start + Math.max(1, translated.length / 14);
    segments.push({
      start,
      end,
      speaker: label(s?.speaker),
      text: String(s?.text ?? "").trim(),
      ...(ctx.targetLanguage === "en" ? { translation: translated } : { arabic: translated }),
    });
  }
  return { speakers, segments, model };
}

// --------------------------------------- speaker voice/gender verification ---

export type GenderVote = { gender: Gender; confidence: number; age?: SpeakerAge; ageConfidence?: number };

/**
 * Listen to labelled samples from the source soundtrack and verify the perceived
 * presentation of each speaker's voice. This is a separate check from transcription,
 * so a wrong or missing gender in the script can be corrected before casting.
 */
export async function verifySpeakerGenders(
  samples: { id: string; audio: Buffer; mimeType: string }[],
  opts: CallOpts = {},
): Promise<{ votes: Map<string, GenderVote>; model: string }> {
  if (!samples.length) return { votes: new Map(), model: "" };
  const parts: unknown[] = [];
  for (const sample of samples.slice(0, 12)) {
    parts.push({ text: `Audio sample for speaker ${sample.id}:` });
    parts.push({ inlineData: { mimeType: sample.mimeType, data: sample.audio.toString("base64") } });
  }
  parts.push({
    text:
      "Listen to every labelled speaker sample above. For each speaker, classify the perceived presentation of the VOICE as male, female, or unknown, " +
      "and also estimate its apparent age band as child, young, adult, mature, or unknown. " +
      "Use pitch, timbre and vocal delivery in the actual audio, not the person's name, language, words, or story role. " +
      "A noticeably high, small voice should be child or young; a deep, seasoned voice should be mature. " +
      "Use unknown only for a genuinely ambiguous voice or a sample without clear speech. Return one result for every supplied speaker id, " +
      "with confidence from 0 to 1 for both fields. Do not infer gender or age from the Arabic translation or from another speaker.",
  });
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          speakers: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                gender: { type: "STRING", enum: ["male", "female", "unknown"] },
                confidence: { type: "NUMBER" },
                age: { type: "STRING", enum: ["child", "young", "adult", "mature", "unknown"] },
                ageConfidence: { type: "NUMBER" },
              },
              required: ["id", "gender", "confidence"],
            },
          },
        },
        required: ["speakers"],
      },
    },
  };
  let parsed: any = null;
  const { model } = await generate([...(await modelChain("text", opts.apiKey))].reverse(), "speaker voice verification", body, (json, m) => {
    const p = parseJson(textOf(json, m), m);
    if (!p || !Array.isArray(p.speakers)) throw new GeminiError("invalid", `${m} returned an unexpected speaker-check format.`, m);
    parsed = p;
  }, { ...opts, timeoutMs: 180_000 });
  const valid = new Set(samples.map((s) => s.id));
  const votes = new Map<string, GenderVote>();
  for (const item of parsed.speakers as any[]) {
    const id = String(item?.id ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!valid.has(id)) continue;
    votes.set(id, {
      gender: normGender(item?.gender),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence ?? 0))),
      age: normAge(item?.age),
      ageConfidence: Math.max(0, Math.min(1, Number(item?.ageConfidence ?? item?.confidence ?? 0))),
    });
  }
  return { votes, model };
}

// ------------------------------------------------------- Arabic speech ---

async function toPcm24k(data: Buffer, mime: string, signal?: AbortSignal): Promise<Buffer> {
  const m = mime.toLowerCase();
  const convert = async (inputArgs: string[]) => {
    const ff = await getFfmpeg();
    const r = await run(
      ff,
      ["-hide_banner", "-loglevel", "error", ...inputArgs, "-f", "s16le", "-ar", "24000", "-ac", "1", "pipe:1"],
      { input: data, binary: true, signal },
    );
    if (r.code !== 0 || !r.stdoutBuffer?.length) throw new Error("Could not decode the generated speech audio.");
    return r.stdoutBuffer;
  };
  if (m.startsWith("audio/l16") || m.startsWith("audio/pcm")) {
    const rate = Number(/rate=(\d+)/.exec(m)?.[1] ?? 24000);
    return rate === 24000 ? data : convert(["-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0"]);
  }
  return convert(["-i", "pipe:0"]);
}

/**
 * Generate Arabic speech for one or more lines with a Gemini prebuilt voice.
 * Returns 24 kHz mono 16-bit PCM. Multiple lines are read in order with pauses
 * between them (the caller splits them apart again).
 */
export async function synthesize(
  lines: string[],
  voice: string,
  opts: CallOpts = {},
): Promise<{ pcm: Buffer; model: string }> {
  const languageName = opts.language === "en" ? "English" : "Arabic";
  const rules =
    opts.language === "en"
      ? "Language: English. Speak ONLY the transcript text, from the very first word. Never read these notes and never add an introduction or spoken label."
      : "Language: Arabic. Speak ONLY the transcript text, in Arabic script, from the very first word. " +
        "Never begin with an English word or greeting, never read these notes, and never translate or transliterate the transcript. " +
        "No introduction and no spoken label: the first sound must be the first Arabic word of the transcript.";
  // Google's documented TTS layout: directions live in DIRECTOR'S NOTES; only the
  // TRANSCRIPT section is spoken. Keeping the direction text out of the spoken line
  // stops some voices from reading an English word before they switch to Arabic.
  const text =
    "### DIRECTOR'S NOTES\n" +
    `Style: Professional ${languageName} film dubbing. Natural, clear and expressive, like a voice actor.\n` +
    (lines.length > 1 ? "Pacing: Conversational. After each transcript line, stop for a full one-second pause before the next line.\n" : "") +
    `${rules}\n\n` +
    `#### TRANSCRIPT\n${lines.join("\n\n")}`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  let inline: { data: string; mimeType: string } | null = null;
  const { model } = await generate(await modelChain("tts", opts.apiKey), `${languageName} voice generation`, body, (json, m) => {
    const cand = json?.candidates?.[0];
    const part = (cand?.content?.parts ?? []).find((p: any) => p?.inlineData?.data);
    if (!part) {
      const why = cand?.finishReason ?? json?.promptFeedback?.blockReason ?? "no audio";
      throw new GeminiError("blocked", `${m} returned no audio (${why}).`, m);
    }
    inline = { data: part.inlineData.data, mimeType: String(part.inlineData.mimeType ?? "audio/L16;rate=24000") };
  }, { ...opts, timeoutMs: opts.timeoutMs ?? 300_000 });
  const got = inline as { data: string; mimeType: string } | null;
  if (!got) throw new GeminiError("blocked", "No audio was returned.");
  const pcm = await toPcm24k(Buffer.from(got.data, "base64"), got.mimeType, opts.signal);
  return { pcm, model };
}
