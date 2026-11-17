// Orchestrates real cinematic dialogue/music/effects separation in a bounded-memory worker.
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { DATA_DIR, exists, getFfmpeg, lastLines, run, videoDir } from "./media";

export type SeparationModel = "mrx" | "tiger";
export type StemSet = {
  model: SeparationModel;
  directory: string;
  dialogue: string;
  effects: string;
  music: string;
  cached: boolean;
};

export const separationDirectory = (videoId: string, model: SeparationModel) => path.join(videoDir(videoId), `stems-${model}`);

/** cgroup limit on containers, host memory elsewhere. Null means unknown/unlimited. */
export async function memoryLimitBytes(): Promise<number | null> {
  for (const file of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const raw = (await fsp.readFile(file, "utf8")).trim();
      if (raw === "max") return null;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n < 1e15) return n;
    } catch {
      // not a cgroup v1/v2 host
    }
  }
  return os.totalmem();
}

export const MIN_SEPARATION_MEMORY = 3 * 1024 ** 3;

async function validCached(videoId: string, model: SeparationModel, duration: number): Promise<StemSet | null> {
  const directory = separationDirectory(videoId, model);
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(directory, "metadata.json"), "utf8")) as { model?: string; durationSec?: number };
    if (meta.model !== model || Math.abs((meta.durationSec ?? 0) - duration) > 0.2) return null;
    const files = [path.join(directory, "dialogue.flac"), path.join(directory, "effects.flac"), path.join(directory, "music.flac")];
    for (const file of files) {
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat || stat.size < 100) return null;
    }
    return { model, directory, dialogue: files[0], effects: files[1], music: files[2], cached: true };
  } catch {
    return null;
  }
}

export async function separateCinematicAudio(options: {
  videoId: string;
  source: string;
  durationSec: number;
  model: SeparationModel;
  signal: AbortSignal;
  onProgress: (fraction: number, detail: string) => void;
  log: (message: string, level?: "info" | "warn" | "error") => void;
}): Promise<StemSet> {
  const { videoId, source, durationSec, model, signal, onProgress, log } = options;
  const cached = await validCached(videoId, model, durationSec);
  if (cached) return cached;

  const memory = await memoryLimitBytes();
  if (memory !== null && memory < MIN_SEPARATION_MEMORY) {
    throw new Error(
      `AI audio separation needs about 4 GB of memory, but this server only has ${(memory / 1024 ** 3).toFixed(0)} GB, so it was skipped.`,
    );
  }

  const directory = separationDirectory(videoId, model);
  await fsp.mkdir(directory, { recursive: true });
  const script = path.join(process.cwd(), "scripts", "separate-audio.mjs");
  if (!(await exists(script))) throw new Error("The cinematic separation worker is missing from the server deployment.");
  const ffmpeg = await getFfmpeg();
  let buffer = "";
  let workerError = "";
  let inner = 0;
  let innerTotal = 1;
  const result = await run(
    process.execPath,
    [script, "--input", source, "--out", directory, "--duration", durationSec.toFixed(3), "--model", model, "--ffmpeg", ffmpeg, "--cache", path.join(DATA_DIR, "models")],
    {
      signal,
      onStdout: (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          let event: { type?: string; outer?: number; total?: number; inner?: number; innerTotal?: number; message?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "model") {
            onProgress(0, `${model === "tiger" ? "TIGER" : "MRX"} cinematic model is loading`);
          } else if (event.type === "chunk" && event.outer && event.total) {
            inner = event.inner ?? 0;
            innerTotal = Math.max(1, event.innerTotal ?? 1);
            const fraction = ((event.outer - 1) + inner / innerTotal) / event.total;
            onProgress(fraction, `Separating part ${event.outer} of ${event.total} · inference window ${inner}/${innerTotal}`);
          } else if (event.type === "outer-done" && event.outer && event.total) {
            onProgress(event.outer / event.total, `Part ${event.outer} of ${event.total} separated into dialogue, effects and music`);
          } else if (event.type === "error") {
            workerError = event.message ?? "Cinematic separation failed.";
          }
        }
      },
    },
  );
  if (result.code !== 0) {
    if (workerError) throw new Error(`AI audio separation failed: ${workerError}`);
    const detail = lastLines(result.stderr);
    // A worker killed by the OS (out of memory) exits with a negative/null code and
    // writes no stderr, which used to surface as a blank "AI audio separation failed: ".
    if (result.code < 0 || !detail) {
      throw new Error(
        "AI audio separation needs about 4 GB of memory, but this server only has 1 GB, " +
          "so the separation worker was stopped before it finished.",
      );
    }
    throw new Error(`AI audio separation failed: ${detail}`);
  }
  const done = await validCached(videoId, model, durationSec);
  if (!done) throw new Error("AI audio separation ended without three usable stem files.");
  log(`Cinematic soundtrack separated with ${model === "tiger" ? "TIGER-DnR (high quality)" : "MRX (fast)"}: dialogue, effects and music.`);
  return { ...done, cached: false };
}
