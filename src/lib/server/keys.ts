// Personal API keys: live verification with Google, encrypted storage, and the rule for
// which credentials a browser session runs on. Raw keys are never logged or returned.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { GeminiError, forgetKey, getServerKey, listModels, modelChain, probeText, synthesize } from "./gemini";
import { DATA_DIR } from "./media";
import { hasPreview, savePreview } from "./previews";
import { PREVIEW_TEXT, VOICES } from "../voices";
import type { KeyCheck, KeyVerification, PersonalKeyView } from "../types";

// ------------------------------------------------------------ encryption ---

let cachedSecret: Buffer | null = null;

/** AES key: from KEY_ENCRYPTION_SECRET, or a random secret kept in the data directory (0600). */
function secret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const env = process.env.KEY_ENCRYPTION_SECRET;
  if (env) return (cachedSecret = crypto.createHash("sha256").update(env).digest());
  const file = path.join(DATA_DIR, "secret.key");
  const read = () => {
    try {
      const b = fs.readFileSync(file);
      return b.length === 32 ? b : null;
    } catch {
      return null;
    }
  };
  let b = read();
  if (!b) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch {
      /* created concurrently */
    }
    b = read();
  }
  if (!b) throw new Error("The server could not create its key-encryption secret.");
  return (cachedSecret = b);
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

function decrypt(stored: string): string | null {
  try {
    if (!stored.startsWith("v1:")) return null;
    const raw = Buffer.from(stored.slice(3), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const maskKey = (key: string) => `••••${key.slice(-4)}`;

/** Accept only something shaped like an API key (no spaces, sane length and characters). */
export function normalizeKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const k = input.trim().replace(/^["']|["']$/g, "");
  return /^[A-Za-z0-9._\-]{20,256}$/.test(k) ? k : null;
}

// ---------------------------------------------------------- verification ---

function toCheck(e: unknown, what: string): KeyCheck {
  if (e instanceof GeminiError) {
    if (e.kind === "quota-day") {
      const hours = e.retryAfterSec ? Math.max(1, Math.round(e.retryAfterSec / 3600)) : null;
      return {
        state: "limited",
        detail:
          `Google reports this key's daily quota for ${what} is used up` +
          (hours ? ` (resets in about ${hours} hour${hours === 1 ? "" : "s"})` : "") +
          ". It works again after the reset, or right away once billing is enabled for the key's project.",
      };
    }
    if (e.kind === "rate") {
      return { state: "limited", detail: `Google's per-minute rate limit for ${what} was hit just now. The key works — wait a minute and verify again.` };
    }
    return { state: "failed", detail: e.message };
  }
  return { state: "failed", detail: e instanceof Error ? e.message : "Unknown error." };
}

/**
 * Real verification against Google, in three steps:
 *  1. authenticate the key (model listing — free),
 *  2. one tiny real text-generation request,
 *  3. one short real Arabic speech request (stored as a voice preview when one is missing,
 *     so the request is not wasted).
 */
export async function verifyKey(apiKey: string): Promise<KeyVerification> {
  const v: KeyVerification = {
    auth: { state: "failed", detail: "" },
    text: { state: "failed", detail: "Not checked." },
    speech: { state: "failed", detail: "Not checked." },
    textModels: [],
    ttsModels: [],
    checkedAt: Date.now(),
  };

  let available: Set<string>;
  try {
    available = await listModels(apiKey, true);
    v.auth = { state: "ok", detail: `Google authenticated the key — ${available.size} generation models are available to it.` };
  } catch (e) {
    v.auth = toCheck(e, "authentication");
    if (v.auth.state !== "failed") v.auth = { state: "failed", detail: v.auth.detail };
    return v;
  }

  v.textModels = (await modelChain("text", apiKey)).filter((m) => available.has(m));
  v.ttsModels = (await modelChain("tts", apiKey)).filter((m) => available.has(m));

  const checkText = async (): Promise<KeyCheck> => {
    if (!v.textModels.length) return { state: "failed", detail: "This key has no access to a supported Gemini language model." };
    try {
      const { model } = await probeText({ apiKey });
      return { state: "ok", detail: `A real test request was answered by ${model}.` };
    } catch (e) {
      return toCheck(e, "language and translation models");
    }
  };

  const checkSpeech = async (): Promise<KeyCheck> => {
    if (!v.ttsModels.length) return { state: "failed", detail: "This key has no access to a Gemini speech (TTS) model." };
    let voice = "Kore";
    let text = "مرحباً بك.";
    let asPreview = false;
    for (const candidate of VOICES) {
      if (!(await hasPreview(candidate.id))) {
        voice = candidate.id;
        text = PREVIEW_TEXT;
        asPreview = true;
        break;
      }
    }
    try {
      const { pcm, model } = await synthesize([text], voice, { apiKey, fast: true, timeoutMs: 90_000 });
      if (pcm.length < 12_000) throw new Error("The speech model returned an empty recording.");
      if (asPreview) await savePreview(voice, pcm).catch(() => {});
      return { state: "ok", detail: `${(pcm.length / 48_000).toFixed(1)}s of real Arabic speech was generated by ${model}.` };
    } catch (e) {
      return toCheck(e, "Arabic speech models");
    }
  };

  [v.text, v.speech] = await Promise.all([checkText(), checkSpeech()]);
  v.checkedAt = Date.now();
  return v;
}

// --------------------------------------------------------------- storage ---

export async function saveSessionKey(sessionId: string, apiKey: string, verification: KeyVerification): Promise<PersonalKeyView> {
  const previous = await loadSessionKey(sessionId);
  if (previous && previous.apiKey !== apiKey) forgetKey(previous.apiKey);
  const now = new Date();
  const values = { sessionId, cipher: encrypt(apiKey), hint: maskKey(apiKey), verification, createdAt: now, verifiedAt: now };
  await db
    .insert(apiKeys)
    .values(values)
    .onConflictDoUpdate({ target: apiKeys.sessionId, set: { cipher: values.cipher, hint: values.hint, verification, createdAt: now, verifiedAt: now } });
  return { hint: values.hint, savedAt: now.toISOString(), verification };
}

export async function updateVerification(sessionId: string, verification: KeyVerification): Promise<void> {
  await db.update(apiKeys).set({ verification, verifiedAt: new Date() }).where(eq(apiKeys.sessionId, sessionId));
}

export async function loadSessionKey(sessionId: string): Promise<{ apiKey: string; view: PersonalKeyView } | null> {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.sessionId, sessionId));
  if (!row) return null;
  const apiKey = decrypt(row.cipher);
  if (!apiKey) {
    // Undecryptable (e.g. the server secret changed): drop it rather than keep dead data.
    await db.delete(apiKeys).where(eq(apiKeys.sessionId, sessionId));
    return null;
  }
  return { apiKey, view: { hint: row.hint, savedAt: row.createdAt.toISOString(), verification: row.verification } };
}

export async function deleteSessionKey(sessionId: string): Promise<boolean> {
  const existing = await loadSessionKey(sessionId);
  if (!existing) return false;
  forgetKey(existing.apiKey);
  await db.delete(apiKeys).where(eq(apiKeys.sessionId, sessionId));
  return true;
}

export type Credentials = {
  apiKey: string | null;
  source: "personal" | "server" | "none";
  hint: string | null;
};

/** A session runs on its own verified key when it has one, otherwise on the server's built-in key. */
export async function resolveCredentials(sessionId: string | null): Promise<Credentials> {
  if (sessionId) {
    const personal = await loadSessionKey(sessionId);
    if (personal) return { apiKey: personal.apiKey, source: "personal", hint: personal.view.hint };
  }
  const server = getServerKey();
  return server ? { apiKey: server, source: "server", hint: null } : { apiKey: null, source: "none", hint: null };
}
