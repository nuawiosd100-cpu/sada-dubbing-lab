// The dubbing engine: a small in-process job queue plus the five real processing stages.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, transcripts, videos } from "@/db/schema";
import * as audio from "./audio";
import { GeminiError, detectLanguage, synthesize, transcribeChunk, verifySpeakerGenders } from "./gemini";
import { resolveCredentials } from "./keys";
import { separateCinematicAudio, type StemSet } from "./separation";
import { exists, ffmpegProgress, ffmpegQuiet, jobDir, outputPath, removeDir, sourcePath, videoDir } from "./media";
import { VOICES, dialectById, resolveVoice, voiceById } from "../voices";
import {
  DEFAULT_SETTINGS,
  type CastEntry,
  type JobResult,
  type JobSettings,
  type LogEntry,
  type Segment,
  type Speaker,
  type StageKey,
  type StageState,
} from "../types";

const MAX_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS ?? 1));
const TTS_CONCURRENCY = Math.max(1, Number(process.env.TTS_CONCURRENCY ?? 2));
const MAX_TEMPO = 1.5;
const INTERRUPTED =
  "Processing was interrupted by a server restart. Press Resume to continue — finished steps are reused.";

type Live = {
  id: string;
  abort: AbortController;
  stages: StageState[];
  logs: LogEntry[];
  timer: ReturnType<typeof setTimeout> | null;
};
type QueueState = { queue: string[]; live: Map<string, Live>; initialized: Promise<void> | null };
const gq = globalThis as typeof globalThis & { __dubQueue?: QueueState };
const q: QueueState = (gq.__dubQueue ??= { queue: [], live: new Map(), initialized: null });

export const STAGE_DEFS: { key: StageKey; label: string }[] = [
  { key: "extract", label: "Audio extraction" },
  { key: "separate", label: "AI dialogue, effects & music separation" },
  { key: "detect", label: "Language detection" },
  { key: "translate", label: "Transcription & Arabic translation" },
  { key: "voice", label: "Dub voice generation" },
  { key: "render", label: "Final video rendering" },
];

export const freshStages = (): StageState[] =>
  STAGE_DEFS.map((s) => ({ ...s, status: "pending", progress: 0, detail: "" }));

export function sanitizeSettings(input: unknown): JobSettings {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pct = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d;
  };
  const speakerVoices: Record<string, string> = {};
  if (i.speakerVoices && typeof i.speakerVoices === "object") {
    for (const [k, v] of Object.entries(i.speakerVoices as Record<string, unknown>)) {
      const selected = resolveVoice(v);
      if (/^[A-Z0-9]{1,8}$/.test(k) && selected) speakerVoices[k] = selected.id;
    }
  }
  const voice = resolveVoice(i.voice)?.id ?? DEFAULT_SETTINGS.voice;
  // One voice reads the entire video unless the user explicitly chooses automatic casting.
  const castMode: JobSettings["castMode"] = i.castMode === "cast" ? "cast" : "single";
  const added = Array.isArray(i.voiceList)
    ? i.voiceList.map((v) => resolveVoice(v)?.id).filter((v): v is string => !!v)
    : [];
  // Added voices are kept in both modes. Single mode uses only `voice` for speech,
  // but must not discard the user's saved cast when a job is submitted.
  const voiceList = Array.from(new Set([voice, ...added]));
  return {
    voice,
    voiceList,
    castMode,
    speakerVoices,
    dialect: dialectById(String(i.dialect)).id,
    targetLanguage: i.targetLanguage === "en" ? "en" : "ar",
    dubVolume: pct(i.dubVolume, DEFAULT_SETTINGS.dubVolume),
    originalVolume: pct(i.originalVolume, DEFAULT_SETTINGS.originalVolume),
    ducking: i.ducking !== false,
    clarity: i.clarity !== false,
    reduceDialogue: i.reduceDialogue === true,
    audioMode: i.audioMode === "stems" ? "stems" : "classic",
    separationModel: i.separationModel === "tiger" ? "tiger" : "mrx",
    dubEnabled: i.dubEnabled !== false,
    dialogueEnabled: i.dialogueEnabled === true,
    effectsEnabled: i.effectsEnabled !== false,
    musicEnabled: i.musicEnabled !== false,
    dialogueVolume: pct(i.dialogueVolume, DEFAULT_SETTINGS.dialogueVolume),
    effectsVolume: pct(i.effectsVolume, DEFAULT_SETTINGS.effectsVolume),
    musicVolume: pct(i.musicVolume, DEFAULT_SETTINGS.musicVolume),
    ttsMode: i.ttsMode === "precise" ? "precise" : "economy",
  };
}

/** Once per server process: anything still marked as in-flight was orphaned by a restart. */
export function ensureInit(): Promise<void> {
  if (!q.initialized) {
    q.initialized = (async () => {
      await db
        .update(jobs)
        .set({ status: "failed", error: INTERRUPTED, finishedAt: new Date() })
        .where(inArray(jobs.status, ["queued", "running"]));
      await db
        .update(videos)
        .set({ status: "failed", error: "The import was interrupted by a server restart. Please import the video again." })
        .where(eq(videos.status, "importing"));
    })().catch(() => {});
  }
  return q.initialized;
}

export function enqueue(jobId: string): void {
  q.queue.push(jobId);
  pump();
}

function pump(): void {
  while (q.live.size < MAX_JOBS && q.queue.length) {
    const id = q.queue.shift() as string;
    const live: Live = { id, abort: new AbortController(), stages: freshStages(), logs: [], timer: null };
    q.live.set(id, live);
    void runJob(live).finally(() => {
      q.live.delete(id);
      pump();
    });
  }
}

export async function cancelJob(jobId: string): Promise<void> {
  const idx = q.queue.indexOf(jobId);
  if (idx >= 0) {
    q.queue.splice(idx, 1);
    await db.update(jobs).set({ status: "canceled", finishedAt: new Date() }).where(eq(jobs.id, jobId));
    return;
  }
  const live = q.live.get(jobId);
  if (live) live.abort.abort();
  else {
    await db
      .update(jobs)
      .set({ status: "canceled", finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])));
  }
}

export async function waitForJobToStop(jobId: string, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (q.live.has(jobId) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
}

async function flush(live: Live, extra: Partial<typeof jobs.$inferInsert> = {}): Promise<void> {
  if (live.timer) {
    clearTimeout(live.timer);
    live.timer = null;
  }
  await db
    .update(jobs)
    .set({ stages: live.stages, logs: live.logs, ...extra })
    .where(eq(jobs.id, live.id));
}

function schedule(live: Live): void {
  if (live.timer) return;
  live.timer = setTimeout(() => {
    live.timer = null;
    void flush(live).catch(() => {});
  }, 500);
}

// ------------------------------------------------------------ helpers ------

type Line = { idx: number; start: number; end: number; speaker: string; text: string };

function planChunks(duration: number, silences: [number, number][]): [number, number][] {
  const TARGET = 240;
  const WINDOW = 45;
  const cuts = [0];
  while (duration - cuts[cuts.length - 1] > TARGET * 1.4) {
    const ideal = cuts[cuts.length - 1] + TARGET;
    let best = ideal;
    let bestLen = 0;
    for (const [s, e] of silences) {
      const mid = (s + e) / 2;
      if (mid < ideal - WINDOW) continue;
      if (mid > ideal + WINDOW) break;
      if (e - s > bestLen) {
        bestLen = e - s;
        best = mid;
      }
    }
    cuts.push(best);
  }
  return cuts.map((c, i) => [c, i + 1 < cuts.length ? cuts[i + 1] : duration]);
}

const translatedText = (s: Segment): string => (s.translation ?? s.arabic ?? "").trim();

/** Sort, clamp and snap utterance starts to the nearest real speech onset. */
function finalizeSegments(all: Segment[], silences: [number, number][], duration: number): Segment[] {
  const onsets = silences.map(([, e]) => e).filter((e) => e > 0);
  const segs = all.filter((s) => translatedText(s)).sort((a, b) => a.start - b.start);
  for (const s of segs) {
    let best = -1;
    let bestDist = 0.6;
    for (const o of onsets) {
      if (o < s.start - 0.6) continue;
      if (o > s.start + 0.6) break;
      const d = Math.abs(o - s.start);
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
    if (best >= 0) s.start = best;
    s.start = Math.max(0, Math.min(s.start, Math.max(0, duration - 0.2)));
    s.end = Math.min(Math.max(s.end, s.start + 0.3), Math.max(duration, s.start + 0.3));
    s.start = Math.round(s.start * 100) / 100;
    s.end = Math.round(s.end * 100) / 100;
  }
  return segs;
}

/**
 * Keep one independently placed clip per source utterance. Economy batching still combines
 * several lines in one TTS request, but each translated utterance is aligned to its own onset
 * instead of letting a merged recording drift across several lines of dialogue.
 */
export function buildLines(segments: Segment[]): Line[] {
  return segments
    .filter((s) => translatedText(s))
    .map((s, idx) => ({ idx, start: s.start, end: s.end, speaker: s.speaker, text: translatedText(s) }));
}

export function assignVoices(speakers: Speaker[], lines: Line[], s: JobSettings) {
  const stats = new Map<string, { lines: number; seconds: number }>();
  for (const l of lines) {
    const st = stats.get(l.speaker) ?? { lines: 0, seconds: 0 };
    st.lines++;
    st.seconds += l.end - l.start;
    stats.set(l.speaker, st);
  }
  const info = new Map(speakers.map((sp) => [sp.id, sp] as const));
  const order = Array.from(stats.keys()).sort((a, b) => stats.get(b)!.seconds - stats.get(a)!.seconds);
  const primary = voiceById(s.voice) ?? VOICES[0];
  const voiceOf = new Map<string, string>();
  const used = new Set<string>();
  if (s.castMode === "cast") {
    for (const id of order) {
      const chosen = s.speakerVoices[id];
      if (chosen) {
        voiceOf.set(id, chosen);
        used.add(chosen);
      }
    }
  }
  if (s.castMode === "cast") {
    // In automatic casting the selected voice really is the lead voice: it goes to the
    // largest matching speaker, before the remaining speakers are assigned other voices.
    const lead = order.find((id) => {
      if (voiceOf.has(id)) return false;
      const g = info.get(id)?.gender ?? "unknown";
      return g === primary.gender || g === "unknown";
    });
    if (lead) {
      voiceOf.set(lead, primary.id);
      used.add(primary.id);
    }
  }
  const fixed = new Set([...Object.values(s.speakerVoices), ...used]); // explicit choices + the lead
  // Automatic casting may only use voices the user added with + (plus explicit speaker choices).
  const rosterIds = Array.from(new Set([primary.id, ...s.voiceList, ...Object.values(s.speakerVoices)]));
  const roster = rosterIds.map((id) => voiceById(id)).filter((v): v is (typeof VOICES)[number] => !!v);
  const pools: Record<"male" | "female", string[]> = { male: [], female: [] };
  for (const v of roster) if (!fixed.has(v.id)) pools[v.gender].push(v.id);
  const next = { male: 0, female: 0 };
  for (const id of order) {
    if (voiceOf.has(id)) continue;
    if (s.castMode === "single") {
      voiceOf.set(id, primary.id);
      continue;
    }
    const g = info.get(id)?.gender ?? "unknown";
    const gender = g === "unknown" ? primary.gender : g;
    const pool = pools[gender];
    // Unused voices first, the lead voice last. With fewer voices than speakers, they are reused.
    const pick = pool.length ? pool[next[gender]++ % pool.length] : primary.id;
    voiceOf.set(id, pick);
  }
  const cast: CastEntry[] = order.map((id) => ({
    speaker: id,
    gender: info.get(id)?.gender ?? "unknown",
    description: info.get(id)?.description ?? "",
    genderConfidence: info.get(id)?.genderConfidence,
    genderSource: info.get(id)?.genderSource,
    lines: stats.get(id)!.lines,
    seconds: Math.round(stats.get(id)!.seconds * 10) / 10,
    voice: voiceOf.get(id)!,
  }));
  return { voiceOf, cast };
}

const withPunct = (t: string) => (/[.!?؟…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const textWeight = (t: string) => t.replace(/[\s.,!?؟،؛:"'()\-–—…]/g, "").length + 2;

function buildFilterGraph(s: JobSettings, channels: number): string {
  const dubGain = (s.dubVolume / 100).toFixed(3);
  const origGain = (s.originalVolume / 100).toFixed(3);
  const clarity = s.clarity
    ? "highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=0.125:ratio=3:attack=5:release=150:makeup=2,"
    : "";
  const g: string[] = [
    `[1:a]aresample=48000,${clarity}volume=${dubGain},aformat=sample_fmts=fltp:channel_layouts=stereo,apad[dub]`,
  ];
  if (s.originalVolume <= 0) {
    g.push("[dub]alimiter=limit=0.95[out]");
    return g.join(";");
  }
  const orig = "[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  if (s.reduceDialogue && channels >= 2) {
    // Centre-channel cancellation: removes centre-panned speech, keeps stereo music/effects and bass.
    g.push(
      `${orig},asplit=2[oa][ob]`,
      "[oa]lowpass=f=170[olow]",
      "[ob]highpass=f=170,pan=stereo|c0=c0-c1|c1=c1-c0[oside]",
      `[olow][oside]amix=inputs=2:normalize=0,volume=${origGain}[orig]`,
    );
  } else {
    g.push(`${orig},volume=${origGain}[orig]`);
  }
  if (s.ducking) {
    g.push(
      "[dub]asplit=2[dubm][sc]",
      "[orig][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]",
      "[duck][dubm]amix=inputs=2:normalize=0:duration=first[mix]",
    );
  } else {
    g.push("[orig][dub]amix=inputs=2:normalize=0:duration=first[mix]");
  }
  g.push("[mix]alimiter=limit=0.95[out]");
  return g.join(";");
}

/** Four independently gated channels fed by three real AI-separated source stems. */
export function buildStemFilterGraph(s: JobSettings): string {
  const dubOn = s.dubEnabled && s.dubVolume > 0;
  const dubGain = (s.dubEnabled ? s.dubVolume / 100 : 0).toFixed(3);
  const clarity = s.clarity
    ? "highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=0.125:ratio=3:attack=5:release=150:makeup=2,"
    : "";
  const g: string[] = [
    `[1:a]aresample=48000,${clarity}volume=${dubGain},aformat=sample_fmts=fltp:channel_layouts=stereo,apad[dub]`,
  ];
  const layers = [
    { input: 2, on: s.dialogueEnabled, volume: s.dialogueVolume, name: "dialogue" },
    { input: 3, on: s.effectsEnabled, volume: s.effectsVolume, name: "effects" },
    { input: 4, on: s.musicEnabled, volume: s.musicVolume, name: "music" },
  ].filter((layer) => layer.on && layer.volume > 0);
  for (const layer of layers) {
    g.push(`[${layer.input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${(layer.volume / 100).toFixed(3)}[${layer.name}]`);
  }
  if (!layers.length) {
    // Dialogue off means its input is never referenced by the mix at all.
    g.push("[dub]alimiter=limit=0.95[out]");
    return g.join(";");
  }
  if (layers.length === 1) g.push(`[${layers[0].name}]anull[orig]`);
  else g.push(`${layers.map((l) => `[${l.name}]`).join("")}amix=inputs=${layers.length}:normalize=0:duration=longest[orig]`);
  if (!dubOn) {
    // Keep the zero-gain dub input connected; FFmpeg rejects an unused apad output.
    g.push("[orig][dub]amix=inputs=2:normalize=0:duration=first[mix]", "[mix]alimiter=limit=0.95[out]");
  } else if (s.ducking) {
    g.push(
      "[dub]asplit=2[dubm][sc]",
      "[orig][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]",
      "[duck][dubm]amix=inputs=2:normalize=0:duration=first[mix]",
      "[mix]alimiter=limit=0.95[out]",
    );
  } else {
    g.push("[orig][dub]amix=inputs=2:normalize=0:duration=first[mix]", "[mix]alimiter=limit=0.95[out]");
  }
  return g.join(";");
}

const errorMessage = (e: unknown): string => {
  if (e instanceof GeminiError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 700 ? `${m.slice(0, 700)}…` : m;
};

function genderFromDescription(description: string): Speaker["gender"] {
  const d = description.toLowerCase();
  if (/\b(female|woman|girl|actress|mother|sister|female narrator|female speaker)\b/.test(d)) return "female";
  if (/\b(male|man|boy|actor|father|brother|male narrator|male speaker)\b/.test(d)) return "male";
  return "unknown";
}

/** Keep the human-readable speaker description consistent with an audio-verified gender. */
function reconcileDescription(description: string, gender: "male" | "female"): string {
  const female: Record<string, string> = { male: "female", man: "woman", boy: "girl", actor: "actress", father: "mother", brother: "sister" };
  const male: Record<string, string> = { female: "male", woman: "man", girl: "boy", actress: "actor", mother: "father", sister: "brother" };
  const replacements = gender === "female" ? female : male;
  return description.replace(/\b(male|female|man|woman|boy|girl|actor|actress|father|mother|brother|sister)\b/gi, (word) => {
    const replacement = replacements[word.toLowerCase()];
    if (!replacement) return word;
    return /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}

/** Verify speaker genders from their actual source-audio samples before assigning voices. */
async function checkSpeakerGenders(
  speakers: Speaker[],
  segments: Segment[],
  wavPath: string,
  scratchDir: string,
  apiKey: string,
  signal: AbortSignal,
  log: (msg: string, level?: LogEntry["level"]) => void,
): Promise<{ speakers: Speaker[]; verified: number }> {
  const initial = speakers.map((sp) => {
    if (sp.gender !== "unknown") return { ...sp, genderSource: sp.genderSource ?? ("script" as const) };
    const inferred = genderFromDescription(sp.description);
    return inferred === "unknown" ? { ...sp } : { ...sp, gender: inferred, genderSource: "description" as const, genderConfidence: 0.65 };
  });
  const totals = new Map<string, number>();
  for (const s of segments) totals.set(s.speaker, (totals.get(s.speaker) ?? 0) + Math.max(0, s.end - s.start));
  const selected = [...initial].sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0)).slice(0, 12);
  const samples: { id: string; audio: Buffer; mimeType: string }[] = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      const sp = selected[i];
      const best = segments
        .filter((s) => s.speaker === sp.id && s.end - s.start >= 0.35)
        .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
      if (!best) continue;
      const file = path.join(scratchDir, `speaker-${i}.mp3`);
      await ffmpegQuiet(
        ["-ss", Math.max(0, best.start).toFixed(3), "-t", Math.min(8, best.end - best.start).toFixed(3), "-i", wavPath,
          "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", file],
        signal,
      );
      samples.push({ id: sp.id, audio: await fsp.readFile(file), mimeType: "audio/mp3" });
      await fsp.rm(file, { force: true });
    }
    if (!samples.length) return { speakers: initial, verified: 0 };
    const { votes, model } = await verifySpeakerGenders(samples, { apiKey, signal, onNotice: (m) => log(m, "warn") });
    let corrected = 0;
    const checked = initial.map((sp) => {
      const vote = votes.get(sp.id);
      if (!vote || vote.gender === "unknown" || vote.confidence < 0.55) return sp;
      if (sp.gender !== "unknown" && sp.gender !== vote.gender) corrected++;
      return { ...sp, description: reconcileDescription(sp.description, vote.gender), gender: vote.gender, genderConfidence: vote.confidence, genderSource: "audio" as const };
    });
    log(`Speaker voice check: ${votes.size} speaker${votes.size === 1 ? "" : "s"} heard in the source audio${corrected ? ` · ${corrected} gender assignment${corrected === 1 ? "" : "s"} corrected` : ""} · ${model}.`);
    return { speakers: checked, verified: votes.size };
  } catch (e) {
    if (signal.aborted) throw e;
    log(`The extra speaker voice check was unavailable (${errorMessage(e)}); using the gender information from transcription instead.`, "warn");
    return { speakers: initial, verified: 0 };
  } finally {
    await Promise.all(selected.map((_, i) => fsp.rm(path.join(scratchDir, `speaker-${i}.mp3`), { force: true }).catch(() => {})));
  }
}

// ------------------------------------------------------------- runner ------

async function runJob(live: Live): Promise<void> {
  const signal = live.abort.signal;
  let current: StageKey = "extract";
  const log = (msg: string, level: LogEntry["level"] = "info") => {
    live.logs.push({ t: Date.now(), msg, level });
    if (live.logs.length > 60) live.logs.splice(0, live.logs.length - 60);
    schedule(live);
  };
  const set = (key: StageKey, patch: Partial<StageState>) => {
    const st = live.stages.find((s) => s.key === key);
    if (st) Object.assign(st, patch);
    schedule(live);
  };
  const begin = async (key: StageKey, detail: string, progress: number | null = 0) => {
    current = key;
    set(key, { status: "running", detail, progress });
    await flush(live, { stage: key });
  };
  const finish = async (key: StageKey, detail: string, cached = false) => {
    set(key, { status: cached ? "cached" : "done", detail, progress: 1 });
    await flush(live);
  };

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, live.id));
    if (!job || job.status !== "queued") return;
    const [video] = await db.select().from(videos).where(eq(videos.id, job.videoId));
    if (!video || video.status !== "ready") throw new Error("The source video is no longer available.");
    const settings = sanitizeSettings(job.settings);
    const dialect = dialectById(settings.dialect);
    // Arabic keeps the original cache keys. English gets an independent cache namespace.
    const cacheDialect = settings.targetLanguage === "en" ? "en" : dialect.id;
    const targetPrompt = settings.targetLanguage === "en" ? "natural, fluent English for film dubbing" : dialect.prompt;
    const targetName = settings.targetLanguage === "en" ? "English" : "Arabic";
    const vdir = videoDir(video.id);
    const jdir = jobDir(live.id);
    const src = sourcePath(video.id);
    await fsp.mkdir(jdir, { recursive: true });
    await flush(live, { status: "running", startedAt: new Date(), stage: "extract", error: null });
    log(`Job started for "${video.title}".`);

    // Credentials for this run: the session's own verified key, else the server's built-in key.
    const cred = await resolveCredentials(job.sessionId);
    if (!cred.apiKey) {
      throw new Error("No API key is active. Paste your Google AI Studio key in the “Google AI key” panel, then press Resume.");
    }
    const apiKey = cred.apiKey;
    log(cred.source === "personal" ? `Running on your personal API key (${cred.hint}).` : "Running on the server's built-in API key.");

    // ---- 1. Audio extraction ------------------------------------------------
    const wavPath = path.join(vdir, "audio.wav");
    const silPath = path.join(vdir, "silences.json");
    let silences: [number, number][] = [];
    if ((await exists(wavPath)) && (await exists(silPath))) {
      silences = JSON.parse(await fsp.readFile(silPath, "utf8"));
      current = "extract";
      await finish("extract", "Audio track already extracted for this video", true);
    } else {
      await begin("extract", "Decoding the audio track with FFmpeg");
      const tmp = path.join(vdir, "audio.tmp.wav");
      let buf = "";
      let open: number | null = null;
      await ffmpegProgress(
        ["-i", src, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-af", "silencedetect=noise=-32dB:d=0.3", "-c:a", "pcm_s16le", tmp],
        video.durationSec ?? 0,
        (p) => set("extract", { progress: p }),
        signal,
        (chunk) => {
          buf += chunk;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
            const b = /silence_end:\s*(-?[\d.]+)/.exec(line);
            if (a) open = Math.max(0, Number(a[1]));
            else if (b && open !== null) {
              silences.push([open, Number(b[1])]);
              open = null;
            }
          }
        },
      );
      await fsp.rename(tmp, wavPath);
      await fsp.writeFile(silPath, JSON.stringify(silences));
      await finish("extract", `Audio extracted · ${silences.length} pauses mapped for timing`);
      log("Audio track extracted (16 kHz mono) and pauses mapped.");
    }
    const wavBytes = (await fsp.stat(wavPath)).size;
    const duration = video.durationSec && video.durationSec > 0 ? video.durationSec : wavBytes / 32000;

    // ---- Optional cinematic AI stem separation ------------------------------
    let stems: StemSet | null = null;
    if (settings.audioMode === "stems") {
      await begin("separate", `Preparing ${settings.separationModel === "tiger" ? "TIGER high-quality" : "MRX fast"} cinematic separation`, 0);
      try {
        stems = await separateCinematicAudio({
          videoId: video.id,
          source: src,
          durationSec: duration,
          model: settings.separationModel,
          signal,
          log,
          onProgress: (fraction, detail) => set("separate", { progress: fraction, detail }),
        });
        await finish(
          "separate",
          `${settings.separationModel === "tiger" ? "TIGER-DnR" : "MRX"} · dialogue + effects + music${stems.cached ? " · reused from cache" : " · separated on this server"}`,
          stems.cached,
        );
      } catch (err) {
        // A cancelled job must stay cancelled, not silently downgrade.
        if (signal.aborted) throw err;
        stems = null;
        const reason = err instanceof Error ? err.message : String(err);
        log(`AI 3-stem separation unavailable (${reason}). Falling back to the classic audio mix so the dub still completes.`, "warn");
        await finish("separate", `AI separation unavailable · classic audio mix used instead (${reason.slice(0, 140)})`);
      }
    } else {
      current = "separate";
      await finish("separate", "Not requested · classic audio mix", true);
    }

    // ---- 2. Language detection ---------------------------------------------
    let language = video.language;
    let languageCode = video.languageCode;
    if (language && languageCode) {
      current = "detect";
      await finish("detect", `${language} (${languageCode}) · detected earlier for this video`, true);
    } else {
      await begin("detect", "Sending an audio sample to Gemini", null);
      const sample = path.join(jdir, "sample.mp3");
      const enc = ["-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", sample];
      if (duration <= 100) {
        await ffmpegQuiet(["-i", wavPath, "-t", "90", ...enc], signal);
      } else {
        const w = [0.04, 0.35, 0.65].map((f) => Math.floor(f * duration));
        const sel = w.map((a) => `between(t,${a},${a + 30})`).join("+");
        await ffmpegQuiet(["-i", wavPath, "-af", `aselect='${sel}',asetpts=N/SR/TB`, ...enc], signal);
      }
      const det = await detectLanguage(await fsp.readFile(sample), "audio/mp3", {
        signal,
        apiKey,
        onNotice: (m) => log(m, "warn"),
      });
      await fsp.rm(sample, { force: true });
      language = det.language;
      languageCode = det.languageCode;
      await db.update(videos).set({ language, languageCode }).where(eq(videos.id, video.id));
      if (!det.hasSpeech) log("No clear speech was found in the audio sample; continuing with full transcription.", "warn");
      if (languageCode === settings.targetLanguage) log(`The source already appears to be ${language}; it will be re-voiced in ${targetName}.`, "warn");
      await finish("detect", `${language} (${languageCode}) · ${Math.round(det.confidence * 100)}% confidence · ${det.model}`);
      log(`Source language detected: ${language}.`);
    }

    // ---- 3. Transcription + Arabic translation -----------------------------
    let segments: Segment[];
    let speakers: Speaker[];
    let textModel: string | null = null;
    const [cachedScript] = await db
      .select()
      .from(transcripts)
.where(and(eq(transcripts.videoId, video.id), eq(transcripts.dialect, cacheDialect)));
    if (cachedScript) {
      segments = cachedScript.segments;
      speakers = cachedScript.speakers;
      textModel = cachedScript.model;
      current = "translate";
      await finish("translate", `${segments.length} translated utterances reused from the earlier run`, true);
    } else {
      const chunks = planChunks(duration, silences);
      await begin("translate", `Part 1 of ${chunks.length}`, 0);
      const cdir = path.join(vdir, `script-${cacheDialect}`);
      await fsp.mkdir(cdir, { recursive: true });
      const all: Segment[] = [];
      const known = new Map<string, Speaker>();
      for (let i = 0; i < chunks.length; i++) {
        const [a, b] = chunks[i];
        const cacheFile = path.join(cdir, `${i}-${Math.round(a * 1000)}-${Math.round(b * 1000)}.json`);
        let res: { speakers: Speaker[]; segments: Segment[]; model: string } | null = null;
        if (await exists(cacheFile)) {
          res = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
        } else {
          set("translate", { detail: `Part ${i + 1} of ${chunks.length} · listening and translating` });
          const clip = path.join(jdir, `chunk-${i}.mp3`);
          await ffmpegQuiet(
            ["-ss", a.toFixed(3), "-t", (b - a).toFixed(3), "-i", wavPath, "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", clip],
            signal,
          );
          const out = await transcribeChunk(
            await fsp.readFile(clip),
            "audio/mp3",
            { language: language ?? "the original language", dialectPrompt: targetPrompt, targetLanguage: settings.targetLanguage, clipSeconds: b - a, knownSpeakers: Array.from(known.values()) },
            { signal, apiKey, onNotice: (m) => log(m, "warn") },
          );
          await fsp.rm(clip, { force: true });
          const len = b - a;
          res = {
            speakers: out.speakers,
            model: out.model,
            segments: out.segments
              .filter((s) => s.start < len + 1)
              .map((s) => ({
                start: a + Math.max(0, Math.min(s.start, len)),
                end: a + Math.max(0, Math.min(Math.max(s.end, s.start + 0.3), len + 0.5)),
                speaker: s.speaker,
                text: s.text,
                arabic: s.arabic,
                translation: s.translation,
              })),
          };
          await fsp.writeFile(cacheFile, JSON.stringify(res));
        }
        if (res) {
          textModel = res.model;
          for (const sp of res.speakers) {
            const prev = known.get(sp.id);
            if (!prev || (prev.gender === "unknown" && sp.gender !== "unknown")) known.set(sp.id, sp);
          }
          for (const s of res.segments) {
            if (!known.has(s.speaker)) known.set(s.speaker, { id: s.speaker, gender: "unknown", description: "" });
            all.push(s);
          }
        }
        set("translate", {
          progress: (i + 1) / chunks.length,
          detail: `Part ${i + 1} of ${chunks.length} done · ${all.length} utterances so far`,
        });
      }
      segments = finalizeSegments(all, silences, duration);
      speakers = Array.from(known.values());
      if (!segments.length) {
        throw new Error("No spoken dialogue was detected in this video, so there is nothing to dub.");
      }
      await db
        .insert(transcripts)
        .values({ id: crypto.randomUUID(), videoId: video.id, dialect: cacheDialect, model: textModel, segments, speakers })
        .onConflictDoUpdate({
          target: [transcripts.videoId, transcripts.dialect],
          set: { segments, speakers, model: textModel },
        });
      await finish("translate", `${segments.length} utterances · ${speakers.length} speaker${speakers.length === 1 ? "" : "s"} · ${textModel}`);
      log(`Dialogue transcribed and translated to ${settings.targetLanguage === "en" ? "English" : dialect.label}: ${segments.length} utterances, ${speakers.length} speaker(s).`);
    }

    if (settings.castMode === "cast" && speakers.length) {
      current = "translate";
      await begin("translate", "Listening to each speaker to verify male and female voices", null);
      const checked = await checkSpeakerGenders(speakers, segments, wavPath, jdir, apiKey, signal, log);
      speakers = checked.speakers;
      await db.update(transcripts).set({ speakers }).where(and(eq(transcripts.videoId, video.id), eq(transcripts.dialect, cacheDialect)));
      await finish(
        "translate",
        `${segments.length} utterances · ${speakers.length} speaker${speakers.length === 1 ? "" : "s"} · ${checked.verified ? `${checked.verified} voice-checked from source audio` : "script gender data"} · ${textModel}`,
        !!cachedScript && checked.verified === 0,
      );
    }

    // ---- 4. Arabic voice generation ----------------------------------------
    const lines = buildLines(segments);
    const { voiceOf, cast } = assignVoices(speakers, lines, settings);
    const tdir = path.join(vdir, "tts");
    await fsp.mkdir(tdir, { recursive: true });
    // v2: clips cached before the Arabic-first TTS prompt were added can begin with
    // an English word, so they must be regenerated instead of reused.
    const clipPath = (l: Line) =>
      path.join(
        tdir,
        `${crypto.createHash("sha1").update(`v2|${settings.targetLanguage === "en" ? "en|" : ""}${voiceOf.get(l.speaker)}|${settings.ttsMode}|${l.text}`).digest("hex")}.pcm`,
      );
    // Lines with identical text and voice share one clip, so each is only generated once.
    const pending: Line[] = [];
    const share = new Map<string, number>();
    const have = new Map<string, boolean>();
    for (const l of lines) {
      const p = clipPath(l);
      share.set(p, (share.get(p) ?? 0) + 1);
      if (!have.has(p)) {
        const ok = await exists(p);
        have.set(p, ok);
        if (!ok) pending.push(l);
      }
    }
    const weightOf = (l: Line) => share.get(clipPath(l)) ?? 1;
    const ttsModels = new Set<string>();
    current = "voice";
    if (!pending.length) {
      await finish("voice", `All ${lines.length} lines already voiced with this cast`, true);
    } else {
      let done = lines.filter((l) => have.get(clipPath(l))).length;
      await begin("voice", `${done} of ${lines.length} lines voiced`, done / lines.length);
      log(`Generating ${targetName} speech: ${pending.length} unique line(s) to voice (${cast.map((c) => `${c.speaker}→${c.voice}`).join(", ")}).`);

      const maxLines = settings.ttsMode === "precise" ? 1 : 8;
      const byVoice = new Map<string, Line[]>();
      for (const l of pending) {
        const v = voiceOf.get(l.speaker) as string;
        const arr = byVoice.get(v) ?? [];
        arr.push(l);
        byVoice.set(v, arr);
      }
      const batches: { voice: string; lines: Line[] }[] = [];
      for (const [voice, ls] of byVoice) {
        let cur: Line[] = [];
        let chars = 0;
        for (const l of ls) {
          if (cur.length && (cur.length >= maxLines || chars + l.text.length > 520)) {
            batches.push({ voice, lines: cur });
            cur = [];
            chars = 0;
          }
          cur.push(l);
          chars += l.text.length;
        }
        if (cur.length) batches.push({ voice, lines: cur });
      }
      batches.sort((x, y) => x.lines[0].idx - y.lines[0].idx);

      const report = () =>
        set("voice", {
          progress: done / lines.length,
          detail: `${done} of ${lines.length} lines voiced${ttsModels.size ? ` · ${Array.from(ttsModels).join(", ")}` : ""}`,
        });

      const processBatch = async (voice: string, batch: Line[]): Promise<void> => {
        try {
          const { pcm, model } = await synthesize(batch.map((l) => withPunct(l.text)), voice, {
            signal,
            apiKey,
            language: settings.targetLanguage,
            onNotice: (m) => log(m, "warn"),
          });
          if (!ttsModels.has(model)) {
            ttsModels.add(model);
            log(`${targetName} speech is being generated by ${model}.`);
          }
          const samples = audio.toSamples(pcm);
          const parts = batch.length === 1 ? [samples] : audio.splitByLines(samples, batch.map((l) => textWeight(l.text)));
          if (!parts) {
            // The lines could not be separated with confidence: never guess, generate smaller batches instead.
            const mid = Math.ceil(batch.length / 2);
            log(`A ${batch.length}-line recording could not be separated cleanly; generating it again in smaller batches.`, "warn");
            await processBatch(voice, batch.slice(0, mid));
            await processBatch(voice, batch.slice(mid));
            return;
          }
          const redo: Line[] = [];
          for (let i = 0; i < batch.length; i++) {
            const clip = audio.normalize(audio.trimSilence(parts[i] ?? new Int16Array(0)));
            if (clip.length < audio.RATE * 0.15) {
              if (batch.length > 1) redo.push(batch[i]);
              else {
                done += weightOf(batch[i]);
                log(`Line ${batch[i].idx + 1} produced no usable audio and was skipped.`, "warn");
              }
              continue;
            }
            await fsp.writeFile(clipPath(batch[i]), audio.toBuffer(clip));
            done += weightOf(batch[i]);
          }
          report();
          for (const l of redo) await processBatch(voice, [l]);
        } catch (e) {
          if (signal.aborted) throw e;
          if (e instanceof GeminiError && (e.kind === "quota-day" || e.kind === "auth" || e.kind === "config")) throw e;
          if (batch.length > 1) {
            const mid = Math.ceil(batch.length / 2);
            log(`A batch of ${batch.length} lines failed (${errorMessage(e)}); retrying in smaller batches.`, "warn");
            await processBatch(voice, batch.slice(0, mid));
            await processBatch(voice, batch.slice(mid));
          } else {
            done += weightOf(batch[0]);
            report();
            log(`Line ${batch[0].idx + 1} could not be voiced and was skipped: ${errorMessage(e)}`, "warn");
          }
        }
      };

      let next = 0;
      let fatal: unknown = null;
      const workers = Array.from({ length: Math.min(TTS_CONCURRENCY, batches.length) }, async () => {
        while (next < batches.length && !fatal) {
          const b = batches[next++];
          try {
            await processBatch(b.voice, b.lines);
          } catch (e) {
            fatal = fatal ?? e;
          }
        }
      });
      await Promise.all(workers);
      if (fatal) {
        set("voice", { detail: `${done} of ${lines.length} lines voiced before stopping — progress is saved` });
        throw fatal;
      }
      let okCount = 0;
      for (const l of lines) if (await exists(clipPath(l))) okCount++;
      await finish("voice", `${okCount} of ${lines.length} lines voiced · ${Array.from(ttsModels).join(", ")}`);
    }

    const voiced: Line[] = [];
    for (const l of lines) if (await exists(clipPath(l))) voiced.push(l);
    if (!voiced.length) throw new Error("No Arabic speech could be generated for this video.");
    const missing = lines.length - voiced.length;

    // ---- 5. Final rendering -------------------------------------------------
    await begin("render", "Timing the Arabic lines to the picture", 0);
    const dubPath = path.join(jdir, "dub.pcm");
    const ws = fs.createWriteStream(dubPath);
    const write = (b: Buffer) => new Promise<void>((res, rej) => ws.write(b, (err) => (err ? rej(err) : res())));
    let written = 0; // samples
    let stretched = 0;
    let maxLag = 0;
    let endCut = false;
    const cues: NonNullable<JobResult["cues"]> = [];
    for (let i = 0; i < voiced.length; i++) {
      if (signal.aborted) throw new Error("Canceled");
      const line = voiced[i];
      let clip: Buffer = await fsp.readFile(clipPath(line));
      const start = Math.max(line.start, written / audio.RATE + (i ? 0.08 : 0));
      const isLast = i + 1 >= voiced.length;
      // Most lines may borrow the pause before the next line. The last line has a hard limit —
      // the end of the video — so it gets no overrun tolerance and a small safety margin.
      const avail = isLast
        ? Math.max(duration - start - 0.3, 0.4)
        : Math.max(voiced[i + 1].start - start - 0.08, line.end - start, 0.4);
      const dur = clip.length / 2 / audio.RATE;
      let tempo = 1;
      if (dur > avail * (isLast ? 1 : 1.03)) {
        tempo = Math.min(dur / avail, MAX_TEMPO);
        clip = await audio.stretch(clip, tempo, signal);
        stretched++;
      }
      if (isLast && start + clip.length / 2 / audio.RATE > duration + 0.05) endCut = true;
      maxLag = Math.max(maxLag, start - line.start);
      const startSample = Math.round(start * audio.RATE);
      let gap = startSample - written;
      while (gap > 0) {
        const k = Math.min(gap, audio.RATE * 5);
        await write(Buffer.alloc(k * 2));
        gap -= k;
      }
      await write(clip);
      written = Math.max(written, startSample) + clip.length / 2;
      cues.push({
        start: Math.round((startSample / audio.RATE) * 1000) / 1000,
        end: Math.round((written / audio.RATE) * 1000) / 1000,
        sourceStart: line.start,
        speaker: line.speaker,
        voice: voiceOf.get(line.speaker) ?? settings.voice,
        tempo: Math.round(tempo * 1000) / 1000,
      });
      if (i % 10 === 0) set("render", { progress: (0.1 * (i + 1)) / voiced.length });
    }
    await new Promise<void>((res) => ws.end(() => res()));

    const graph = stems ? buildStemFilterGraph(settings) : buildFilterGraph(settings, video.audioChannels ?? 2);
    const stemInputs = stems ? ["-i", stems.dialogue, "-i", stems.effects, "-i", stems.music] : [];
    const out = outputPath(live.id);
    const tmpOut = path.join(jdir, "output.tmp.mp4");
    const render = async (copy: boolean) => {
      const vcodec = copy
        ? ["-c:v", "copy", ...(video.videoCodec === "hevc" ? ["-tag:v", "hvc1"] : [])]
        : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p"];
      set("render", { detail: copy ? "Mixing audio · original picture kept bit-for-bit" : "Mixing audio and re-encoding picture to H.264" });
      await ffmpegProgress(
        ["-i", src, "-f", "s16le", "-ar", String(audio.RATE), "-ac", "1", "-i", dubPath, ...stemInputs, "-filter_complex", graph,
          "-map", "0:v:0", "-map", "[out]", ...vcodec, "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
          "-movflags", "+faststart", "-t", duration.toFixed(3), "-f", "mp4", tmpOut],
        duration,
        (p) => set("render", { progress: 0.1 + 0.9 * p }),
        signal,
      );
    };
    let copied = ["h264", "hevc", "av1", "vp9", "mpeg4"].includes(video.videoCodec ?? "");
    if (copied) {
      try {
        await render(true);
      } catch (e) {
        if (signal.aborted) throw e;
        copied = false;
        log("The original video stream can't be placed in MP4 as-is; re-encoding the picture instead.", "warn");
        await render(false);
      }
    } else {
      await render(false);
    }
    await fsp.rename(tmpOut, out);
    await fsp.rm(dubPath, { force: true });
    const outputSize = (await fsp.stat(out)).size;

    const notes: string[] = [];
    if (stretched) notes.push(`${stretched} line${stretched === 1 ? " was" : "s were"} sped up (max ${MAX_TEMPO}×) to fit the original timing.`);
    if (maxLag > 1.5) notes.push(`Dense dialogue: some Arabic lines start up to ${maxLag.toFixed(1)}s after the original line.`);
    if (missing) notes.push(`${missing} line${missing === 1 ? "" : "s"} could not be voiced and stayed silent.`);
    if (endCut) notes.push(`The final Arabic line is longer than the video that remains, even at ${MAX_TEMPO}× speed, so its ending is cut off.`);
    if (settings.reduceDialogue && (video.audioChannels ?? 2) < 2) notes.push("Dialogue reduction was not applied because the source audio is mono.");
    const result: JobResult = {
      language: language ?? "Unknown",
      languageCode: languageCode ?? "und",
      dialect: dialect.id,
      lines: lines.length,
      voicedLines: voiced.length,
      skippedLines: missing,
      cast,
      textModel,
      ttsModels: Array.from(ttsModels),
      videoCopied: copied,
      durationSec: duration,
      notes,
      keySource: cred.source === "personal" ? "personal" : "server",
      cues,
      separation: stems ? { model: settings.separationModel, cached: stems.cached } : undefined,
      targetLanguage: settings.targetLanguage,
    };
    set("render", { status: "done", progress: 1, detail: copied ? "Rendered · original video quality preserved" : "Rendered · picture re-encoded to H.264" });
    log(`${targetName}-dubbed video is ready.`);
    await flush(live, { status: "completed", stage: "done", finishedAt: new Date(), result, outputSize });
  } catch (e) {
    const canceled = signal.aborted;
    const st = live.stages.find((s) => s.key === current);
    if (st && st.status === "running") st.status = canceled ? "pending" : "failed";
    const message = canceled ? "Processing was canceled." : errorMessage(e);
    live.logs.push({ t: Date.now(), msg: message, level: canceled ? "warn" : "error" });
    await flush(live, {
      status: canceled ? "canceled" : "failed",
      error: canceled ? null : message,
      finishedAt: new Date(),
    }).catch(() => {});
    if (canceled) await removeDir(jobDir(live.id));
  }
}
