import { GeminiError, exhaustedModels, getServerKey, listModels, modelChain } from "@/lib/server/gemini";
import { CHUNK_SIZE, MAX_UPLOAD_BYTES, getSession, json } from "@/lib/server/http";
import { loadSessionKey, resolveCredentials } from "@/lib/server/keys";
import { ffmpegVersion } from "@/lib/server/media";
import { ytDlpInstalled } from "@/lib/server/youtube";
import type { ServerStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live backend status for this browser session. The AI check calls Google's (free) model
// listing with the credentials the session actually runs on, so "connected" means that
// key was really accepted. No key is ever included in the response.
export async function GET(req: Request) {
  const session = getSession(req);
  const cred = await resolveCredentials(session);
  const personal = session ? await loadSessionKey(session) : null;
  const status: ServerStatus = {
    ai: {
      source: cred.source,
      keyHint: cred.hint,
      configured: cred.source !== "none",
      ok: false,
      error: null,
      textModels: [],
      ttsModels: [],
      exhausted: [],
    },
    personalKey: personal?.view ?? null,
    serverKeyAvailable: !!getServerKey(),
    ffmpeg: { ok: false, version: null, error: null },
    youtube: { installed: ytDlpInstalled() },
    limits: { chunkSize: CHUNK_SIZE, maxUploadBytes: MAX_UPLOAD_BYTES },
  };
  if (!cred.apiKey) {
    status.ai.error = "No API key is active. Paste your Google AI Studio key in the “Google AI key” panel to activate the service.";
  } else {
    try {
      await listModels(cred.apiKey, true);
      status.ai.textModels = await modelChain("text", cred.apiKey);
      status.ai.ttsModels = await modelChain("tts", cred.apiKey);
      status.ai.ok = true;
      status.ai.exhausted = exhaustedModels(cred.apiKey);
    } catch (e) {
      status.ai.error = e instanceof GeminiError ? e.message : `Could not verify the API key: ${(e as Error).message}`;
    }
  }
  try {
    status.ffmpeg.version = await ffmpegVersion();
    status.ffmpeg.ok = true;
  } catch (e) {
    status.ffmpeg.error = (e as Error).message;
  }
  return json(status);
}
