// Disk cache for the Arabic voice samples (shared by the preview route and key verification).
import fsp from "node:fs/promises";
import path from "node:path";
import { normalize, toBuffer, toSamples, trimSilence, wavFromPcm } from "./audio";
import { DATA_DIR, exists } from "./media";

// Bump this whenever the TTS prompt changes: samples cached before the Arabic-first
// direction was added can start with an English word and must not be reused.
const PREVIEW_VERSION = "v2";
export const previewPath = (voiceId: string, language: "ar" | "en" = "ar") =>
  path.join(DATA_DIR, "previews", `${voiceId}${language === "en" ? ".en" : ""}.${PREVIEW_VERSION}.wav`);
export const hasPreview = (voiceId: string, language: "ar" | "en" = "ar") => exists(previewPath(voiceId, language));

export async function savePreview(voiceId: string, pcm: Buffer, language: "ar" | "en" = "ar"): Promise<Buffer> {
  const wav = wavFromPcm(toBuffer(normalize(trimSilence(toSamples(pcm)))));
  const file = previewPath(voiceId, language);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, wav);
  return wav;
}
