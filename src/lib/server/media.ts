import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
export const BIN_DIR = path.join(DATA_DIR, "bin");
export const videoDir = (id: string) => path.join(DATA_DIR, "videos", id);
export const jobDir = (id: string) => path.join(DATA_DIR, "jobs", id);
export const sourcePath = (id: string) => path.join(videoDir(id), "source.bin");
export const outputPath = (jobId: string) => path.join(jobDir(jobId), "output.mp4");

export const exists = (p: string) =>
  fsp.access(p).then(
    () => true,
    () => false,
  );

export function abortError(): Error {
  const e = new Error("Canceled");
  e.name = "AbortError";
  return e;
}

export type RunOpts = {
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  input?: Buffer;
  binary?: boolean;
};
export type RunResult = { code: number; stdout: string; stderr: string; stdoutBuffer?: Buffer };

/** Spawn a process (never through a shell) and collect its output. */
export function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError());
    const child = spawn(cmd, args, { stdio: [opts.input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const bufs: Buffer[] = [];
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => opts.signal?.removeEventListener("abort", onAbort);

    child.stdout?.on("data", (d: Buffer) => {
      if (opts.binary) return void bufs.push(d);
      const s = d.toString();
      if (opts.onStdout) opts.onStdout(s);
      else if (stdout.length < 48_000_000) stdout += s;
    });
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      opts.onStderr?.(s);
      stderr += s;
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    });
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      if (opts.signal?.aborted) return reject(abortError());
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        stdoutBuffer: opts.binary ? Buffer.concat(bufs) : undefined,
      });
    });
    if (opts.input && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(opts.input);
    }
  });
}

export const lastLines = (s: string, n = 4) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(" | ")
    .slice(-600);

export async function download(url: string, dest: string, gunzip = false): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = `${dest}.part`;
  const src = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
  if (gunzip) await streamPipeline(src, zlib.createGunzip(), fs.createWriteStream(tmp));
  else await streamPipeline(src, fs.createWriteStream(tmp));
  await fsp.chmod(tmp, 0o755);
  await fsp.rename(tmp, dest);
}

// ---------------------------------------------------------------- ffmpeg ----

let ffmpegPromise: Promise<string> | null = null;

async function works(bin: string): Promise<boolean> {
  try {
    return (await run(bin, ["-version"])).code === 0;
  } catch {
    return false;
  }
}

async function resolveFfmpeg(): Promise<string> {
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    path.join(BIN_DIR, "ffmpeg"),
    "ffmpeg",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (await works(c)) return c;

  // Last resort: fetch a static build so the server can still process video.
  if (process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64")) {
    const dest = path.join(BIN_DIR, "ffmpeg");
    await download(
      `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-${process.arch}.gz`,
      dest,
      true,
    );
    if (await works(dest)) return dest;
  }
  throw new Error("FFmpeg is not available on the server and could not be installed automatically.");
}

export function getFfmpeg(): Promise<string> {
  if (!ffmpegPromise) {
    ffmpegPromise = resolveFfmpeg().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

export async function ffmpegVersion(): Promise<string> {
  const ff = await getFfmpeg();
  const r = await run(ff, ["-version"]);
  return /ffmpeg version (\S+)/.exec(r.stdout)?.[1] ?? "unknown";
}

export type Probe = {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
};

const toSec = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** Inspect a media file by parsing `ffmpeg -i` (no separate ffprobe binary needed). */
export async function probe(file: string): Promise<Probe> {
  const ff = await getFfmpeg();
  const r = await run(ff, ["-hide_banner", "-i", file]);
  const out = r.stderr;
  const lines = out.split(/\r?\n/);
  const vLine = lines.find((l) => /Stream #.*: Video:/.test(l) && !/attached pic/.test(l));
  const aLine = lines.find((l) => /Stream #.*: Audio:/.test(l));
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  let durationSec = dur ? toSec(dur[1], dur[2], dur[3]) : 0;

  const size = vLine ? /,\s*(\d{2,5})x(\d{2,5})[\s,\[]/.exec(vLine + " ") : null;
  let audioChannels: number | null = null;
  if (aLine) {
    if (/\bmono\b/.test(aLine)) audioChannels = 1;
    else if (/\bstereo\b/.test(aLine)) audioChannels = 2;
    else if (/\b5\.1/.test(aLine)) audioChannels = 6;
    else if (/\b7\.1/.test(aLine)) audioChannels = 8;
    else audioChannels = Number(/(\d+) channels/.exec(aLine)?.[1] ?? 2);
  }

  if (!durationSec && (vLine || aLine)) {
    // Some recordings (e.g. browser WebM) carry no duration header: measure it.
    const m = await run(ff, ["-hide_banner", "-i", file, "-map", "0", "-c", "copy", "-f", "null", "-"]);
    const times = [...m.stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = times[times.length - 1];
    if (last) durationSec = toSec(last[1], last[2], last[3]);
  }

  return {
    durationSec,
    hasVideo: !!vLine,
    hasAudio: !!aLine,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    videoCodec: vLine ? (/Video:\s*(\w+)/.exec(vLine)?.[1] ?? null) : null,
    audioCodec: aLine ? (/Audio:\s*(\w+)/.exec(aLine)?.[1] ?? null) : null,
    audioChannels,
  };
}

/** Run ffmpeg and report real progress (encoded time / total duration). */
export async function ffmpegProgress(
  args: string[],
  totalSec: number,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
  onStderr?: (chunk: string) => void,
): Promise<RunResult> {
  const ff = await getFfmpeg();
  const r = await run(ff, ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", ...args], {
    signal,
    onStderr,
    onStdout: (chunk) => {
      for (const m of chunk.matchAll(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)) {
        if (totalSec > 0) onProgress(Math.max(0, Math.min(1, toSec(m[1], m[2], m[3]) / totalSec)));
      }
    },
  });
  if (r.code !== 0) throw new Error(`FFmpeg failed: ${lastLines(r.stderr)}`);
  return r;
}

export async function ffmpegQuiet(args: string[], signal?: AbortSignal): Promise<void> {
  const ff = await getFfmpeg();
  const r = await run(ff, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...args], { signal });
  if (r.code !== 0) throw new Error(`FFmpeg failed: ${lastLines(r.stderr)}`);
}

export async function removeDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}
