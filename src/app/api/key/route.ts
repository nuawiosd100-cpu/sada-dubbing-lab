import { getSession, json } from "@/lib/server/http";
import {
  deleteSessionKey,
  loadSessionKey,
  normalizeKey,
  saveSessionKey,
  updateVerification,
  verifyKey,
} from "@/lib/server/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Simple per-session limiter so this endpoint can't be used to hammer Google with guesses.
const gl = globalThis as typeof globalThis & { __keyAttempts?: Map<string, number[]> };
const attempts: Map<string, number[]> = (gl.__keyAttempts ??= new Map());
function allow(session: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60_000;
  // Server-wide cap as well: session ids are chosen by the browser, so a per-session limit alone could be sidestepped.
  const all = (attempts.get("*") ?? []).filter((t) => now - t < windowMs);
  const recent = (attempts.get(session) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= 8 || all.length >= 60) {
    attempts.set(session, recent);
    attempts.set("*", all);
    return false;
  }
  recent.push(now);
  all.push(now);
  attempts.set(session, recent);
  attempts.set("*", all);
  if (attempts.size > 5000) for (const k of attempts.keys()) if (k !== "*" && k !== session) attempts.delete(k);
  return true;
}

// What the browser may see about its stored key: a masked hint and the verification result.
export async function GET(req: Request) {
  const session = getSession(req);
  if (!session) return json({ personalKey: null });
  const existing = await loadSessionKey(session);
  return json({ personalKey: existing?.view ?? null });
}

// { key }                -> verify a new key with Google and, if Google accepts it, activate it
// { action: "reverify" } -> run the live checks again on the stored key
export async function POST(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const body = (await req.json().catch(() => null)) as { key?: unknown; action?: string } | null;
  if (!allow(session)) {
    return json({ error: "Too many verification attempts. Please wait a few minutes and try again." }, 429);
  }

  if (body?.action === "reverify") {
    const existing = await loadSessionKey(session);
    if (!existing) return json({ error: "No personal key is stored for this browser." }, 404);
    const verification = await verifyKey(existing.apiKey);
    await updateVerification(session, verification);
    return json({ personalKey: { ...existing.view, verification } });
  }

  const key = normalizeKey(body?.key);
  if (!key) {
    return json(
      { error: "That doesn't look like a Google AI Studio API key. Paste it exactly as shown in Google AI Studio, with no spaces." },
      400,
    );
  }
  const verification = await verifyKey(key);
  if (verification.auth.state !== "ok") {
    // Not stored: Google did not accept it (or could not be reached).
    return json({ error: verification.auth.detail || "Google did not accept this key.", verification }, 422);
  }
  const personalKey = await saveSessionKey(session, key, verification);
  return json({ personalKey });
}

// Remove the personal key; the session falls back to the server's built-in key (if any).
export async function DELETE(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const removed = await deleteSessionKey(session);
  return json({ removed });
}
