import fsp from "node:fs/promises";
import { GeminiError, synthesize } from "@/lib/server/gemini";
import { getSession, json } from "@/lib/server/http";
import { resolveCredentials } from "@/lib/server/keys";
import { hasPreview, previewPath, savePreview } from "@/lib/server/previews";
import { PREVIEW_TEXT, PREVIEW_TEXT_EN, resolveVoice } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inflight = new Map<string, Promise<Buffer>>();

// Real Arabic sample spoken by the selected voice. Generated once (with the session's
// active API key), then served from disk for everyone.
export async function GET(req: Request, ctx: { params: Promise<{ voice: string }> }) {
  const { voice: id } = await ctx.params;
  const voice = resolveVoice(id);
  if (!voice) return json({ error: "Unknown voice." }, 404);
  const language = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "ar";
  try {
    let wav: Buffer;
    if (await hasPreview(voice.id, language)) {
      wav = await fsp.readFile(previewPath(voice.id, language));
    } else {
      const cred = await resolveCredentials(getSession(req));
      if (!cred.apiKey) {
        return json({ error: "No API key is active. Add your Google AI Studio key in the “Google AI key” panel to hear voice previews." }, 503);
      }
      const cacheKey = `${voice.id}:${language}`;
      let p = inflight.get(cacheKey);
      if (!p) {
        p = (async () => {
          const { pcm } = await synthesize([language === "en" ? PREVIEW_TEXT_EN : PREVIEW_TEXT], voice.id, { apiKey: cred.apiKey, language });
          return savePreview(voice.id, pcm, language);
        })().finally(() => inflight.delete(cacheKey));
        inflight.set(cacheKey, p);
      }
      wav = await p;
    }
    return new Response(new Uint8Array(wav), {
      headers: { "Content-Type": "audio/wav", "Content-Length": String(wav.length), "Cache-Control": "private, max-age=86400" },
    });
  } catch (e) {
    const quota = e instanceof GeminiError && (e.kind === "quota-day" || e.kind === "rate");
    return json({ error: e instanceof Error ? e.message : "Voice preview failed." }, quota ? 429 : 502);
  }
}
